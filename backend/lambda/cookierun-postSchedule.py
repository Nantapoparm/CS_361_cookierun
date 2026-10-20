import json
import os
import datetime as dt
from decimal import Decimal

import pymysql

DB_HOST = os.environ.get('DB_HOST')
DB_USER = os.environ.get('DB_USER')
DB_PASSWORD = os.environ.get('DB_PASSWORD')
DB_NAME = os.environ.get('DB_NAME')

DEFAULT_SESSION_ID = 2
MAX_WEEKS = 26  # กันเลือกวันสิ้นสุดผิดจนสร้างคาบเป็นร้อยแถว


# ---------------------------------------------------------------- DB / response

def open_connection():
    return pymysql.connect(
        host=DB_HOST,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME,
        charset='utf8mb4',
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=10,
    )


def close_connection(connection):
    if connection and connection.open:
        connection.close()


def _json_default(o):
    if isinstance(o, (dt.datetime, dt.date)):
        return o.isoformat()
    if isinstance(o, Decimal):
        return float(o)
    return str(o)


def ok(data):
    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps({'success': True, 'data': data}, default=_json_default, ensure_ascii=False),
    }


def fail(status, code, message):
    return {
        'statusCode': status,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps({'success': False, 'error': {'code': code, 'message': message}}, ensure_ascii=False),
    }


# ---------------------------------------------------------------- helpers

def get_user_id(connection, event):
    """sub จาก JWT (HTTP API: requestContext.authorizer.jwt.claims) → userId ผ่าน user_information.cognitoSub"""
    claims = (((event.get('requestContext') or {}).get('authorizer') or {}).get('jwt') or {}).get('claims') or {}
    sub = str(claims.get('sub') or '').strip()
    if not sub:
        return None
    with connection.cursor() as cursor:
        cursor.execute("SELECT userId FROM user_information WHERE cognitoSub = %s", (sub,))
        row = cursor.fetchone()
    return row['userId'] if row else None


def weekly_slots(start_time, end_time, repeat_until):
    """[(start, end), ...] คาบแรก + ทุก 7 วันจนถึง repeat_until (ไม่ส่ง = คาบเดียว)
    รูปแบบวันที่ผิด → ValueError"""
    start = dt.datetime.fromisoformat(start_time)
    end = dt.datetime.fromisoformat(end_time)
    last = dt.date.fromisoformat(repeat_until) if repeat_until else start.date()
    slots = []
    while start.date() <= last:
        slots.append((start, end))
        start += dt.timedelta(days=7)
        end += dt.timedelta(days=7)
    return slots


def insert_periods(connection, user_id, course_id, slots, description, room, session_id):
    """insert ทุกคาบแล้ว commit ครั้งเดียว"""
    with connection.cursor() as cursor:
        for start, end in slots:
            cursor.execute(
                """INSERT INTO teaching_histories
                       (userId, courseId, startTime, endTime, description, room, sessionId)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                (user_id, course_id, start, end, description, room, session_id),
            )
    connection.commit()


# ---------------------------------------------------------------- handler

def lambda_handler(event, context):
    connection = None
    try:
        connection = open_connection()
        user_id = get_user_id(connection, event)
        if not user_id:
            return fail(403, 'FORBIDDEN', 'ไม่พบผู้ใช้ที่ผูกกับบัญชีนี้')

        body = event.get('body') or '{}'
        if isinstance(body, str):
            body = json.loads(body)

        course_id = body.get('courseId')
        start_time = body.get('startTime')
        end_time = body.get('endTime')
        description = body.get('description', '')
        room = body.get('room', '')
        session_id = body.get('sessionId', DEFAULT_SESSION_ID)
        repeat_until = body.get('repeatUntil')

        if not all([course_id, start_time, end_time]):
            return fail(400, 'VALIDATION_ERROR', 'ข้อมูลไม่ครบถ้วน กรุณาระบุ courseId, startTime และ endTime')

        try:
            slots = weekly_slots(start_time, end_time, repeat_until)
        except ValueError:
            return fail(400, 'VALIDATION_ERROR', 'startTime / endTime / repeatUntil รูปแบบวันที่ไม่ถูกต้อง')
        if not slots:
            return fail(400, 'VALIDATION_ERROR', 'repeatUntil ต้องไม่ก่อนวันของคาบแรก')
        if len(slots) > MAX_WEEKS:
            return fail(400, 'VALIDATION_ERROR', f'สร้างได้ไม่เกิน {MAX_WEEKS} สัปดาห์ต่อครั้ง')

        insert_periods(connection, user_id, course_id, slots, description, room, session_id)

        return ok({
            'message': 'บันทึกประวัติการสอนสำเร็จ!',
            'userId': user_id,
            'sessionId': session_id,
            'count': len(slots),
        })

    except Exception as e:
        if connection and connection.open:
            connection.rollback()
        print(f"เกิดข้อผิดพลาด: {e}")
        return fail(500, 'INTERNAL_ERROR', 'เกิดข้อผิดพลาดภายในระบบ')

    finally:
        close_connection(connection)

