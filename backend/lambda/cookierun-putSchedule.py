import json
import os
import datetime as dt
from decimal import Decimal
import pymysql

DB_HOST = os.environ.get('DB_HOST')
DB_USER = os.environ.get('DB_USER')
DB_PASSWORD = os.environ.get('DB_PASSWORD')
DB_NAME = os.environ.get('DB_NAME')

def open_connection():
    return pymysql.connect(
        host=DB_HOST,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME,
        charset='utf8mb4',
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=10
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
        'body': json.dumps({'success': True, 'data': data}, default=_json_default, ensure_ascii=False)
    }

def fail(status, code, message):
    return {
        'statusCode': status,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps({'success': False, 'error': {'code': code, 'message': message}}, ensure_ascii=False)
    }

def get_user_id(connection, event):
    claims = (((event.get('requestContext') or {}).get('authorizer') or {}).get('jwt') or {}).get('claims') or {}
    sub = str(claims.get('sub') or '').strip()
    if not sub:
        return None
    with connection.cursor() as cursor:
        cursor.execute("SELECT userId FROM user_information WHERE cognitoSub = %s", (sub,))
        row = cursor.fetchone()
    return row['userId'] if row else None

def update_schedule(connection, historyId, userId, courseId, startTime, endTime, description, room):
    with connection.cursor() as cursor:
        sql = """
            UPDATE teaching_histories 
            SET courseId = %s, startTime = %s, endTime = %s, description = %s, room = %s
            WHERE historyId = %s AND userId = %s
        """
        cursor.execute(sql, (courseId, startTime, endTime, description, room, historyId, userId))
        connection.commit()
        return cursor.rowcount

def lambda_handler(event, context):
    connection = None
    try:
        connection = open_connection()
        userId = get_user_id(connection, event)
        if not userId:
            return fail(403, 'FORBIDDEN', 'ไม่พบผู้ใช้ที่ผูกกับบัญชีนี้')

        path_params = event.get('pathParameters') or {}
        historyId = path_params.get('id')

        if not historyId:
            return fail(400, 'VALIDATION_ERROR', 'กรุณาระบุ ID ของคาบสอนที่ต้องการแก้ไข')

        body = event.get('body', '{}')
        if isinstance(body, str):
            body = json.loads(body)

        courseId = body.get('courseId')
        startTime = body.get('startTime')
        endTime = body.get('endTime')
        description = body.get('description', '')
        room = body.get('room', '')

        if not all([courseId, startTime, endTime]):
            return fail(400, 'VALIDATION_ERROR', 'กรุณาส่งข้อมูล courseId, startTime และ endTime ให้ครบถ้วน')

        rowcount = update_schedule(connection, historyId, userId, courseId, startTime, endTime, description, room)
        if rowcount == 0:
            return fail(404, 'NOT_FOUND', 'ไม่พบข้อมูลคาบสอน หรือคุณไม่มีสิทธิ์แก้ไข')

        return ok({'message': 'แก้ไขคาบสอนสำเร็จ!'})

    except Exception as e:
        print(f"เกิดข้อผิดพลาด: {e}")
        return fail(500, 'INTERNAL_ERROR', 'เกิดข้อผิดพลาดภายในระบบ')

    finally:
        close_connection(connection)