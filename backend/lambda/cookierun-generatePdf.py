import json
import os
import re
import datetime as dt
from decimal import Decimal
import pymysql

DB_HOST = os.environ.get('DB_HOST')
DB_USER = os.environ.get('DB_USER')
DB_PASSWORD = os.environ.get('DB_PASSWORD')
DB_NAME = os.environ.get('DB_NAME')

KINDS = {
    'regular': 'regular', 'ตามตาราง': 'regular', 'ปกติ': 'regular',
    'cancelled': 'cancelled', 'canceled': 'cancelled', 'งดสอน': 'cancelled',
    'makeup': 'makeup', 'make-up': 'makeup', 'สอนชดเชย': 'makeup', 'ชดเชย': 'makeup',
}

def kind_of(description):
    return KINDS.get(str(description or '').strip().lower(), 'regular')

def open_connection():
    return pymysql.connect(
        host=DB_HOST,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME,
        charset='utf8mb4',
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=5
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


OFFERING_OF_PERIOD = """
    (SELECT co.offeringId FROM course_offerings co
     WHERE co.courseId = t.courseId
       AND (t.sessionId IS NULL OR co.sessionId = t.sessionId)
     ORDER BY
       (co.semester = CASE WHEN MONTH(t.startTime) >= 8 THEN 1
                           WHEN MONTH(t.startTime) <= 5 THEN 2 ELSE 3 END
        AND co.academicYear = YEAR(t.startTime) + 543 - (MONTH(t.startTime) < 8)) DESC,
       co.academicYear DESC, co.semester DESC
     LIMIT 1)
"""

def get_teaching_histories_by_month(connection, userId, target_month):
    with connection.cursor() as cursor:
        sql = f"""
            SELECT
                t.historyId,
                t.courseId,
                c.courseName,
                t.startTime,
                t.endTime,
                t.description,
                t.room,
                t.sessionId,
                {OFFERING_OF_PERIOD} AS offeringId
            FROM teaching_histories t
            LEFT JOIN courses_name c ON t.courseId = c.courseId
            WHERE t.userId = %s AND DATE_FORMAT(t.startTime, '%%Y-%%m') = %s
            ORDER BY t.startTime ASC
        """
        cursor.execute(sql, (userId, target_month))
        rows = cursor.fetchall()

    for r in rows:
        r['kind'] = kind_of(r.get('description'))
        # [แก้] ล้างเฉพาะคำที่เป็นประเภทคาบ — หมายเหตุของนักศึกษาช่วยงานเก็บในคอลัมน์นี้ด้วย
        if str(r.get('description') or '').strip().lower() in KINDS:
            r['description'] = ''

    total_count = len(rows)

    return rows, total_count

# [เพิ่ม] offeringId ทั้งหมดที่ผู้ใช้คนนี้มีคาบอยู่ (ทุกเดือน ไม่แยก role)
def get_my_offering_ids(connection, userId):
    with connection.cursor() as cursor:
        cursor.execute(
            f"""SELECT DISTINCT {OFFERING_OF_PERIOD} AS offeringId
                FROM teaching_histories t
                WHERE t.userId = %s""",
            (userId,),
        )
        return [r['offeringId'] for r in cursor.fetchall() if r['offeringId'] is not None]

# [เพิ่ม] ภาคของเดือน (กฎเดียวกับ termOfDate ในหน้าเว็บ) : '2026-10' → (1, 2569)
def term_of_month(target_month):
    year, mon = int(target_month[:4]), int(target_month[5:7])
    semester = 1 if mon >= 8 else 2 if mon <= 5 else 3
    return semester, year + 543 - (1 if mon < 8 else 0)

# [แก้] ทุกวิชาที่เปิดในภาคของเดือนที่ขอ (ยังไม่มีภาคนั้นในตาราง → ภาคล่าสุด)
def get_all_courses(connection, target_month):
    semester, academic_year = term_of_month(target_month)
    with connection.cursor() as cursor:
        cursor.execute(
            """SELECT 1 FROM course_offerings WHERE semester = %s AND academicYear = %s LIMIT 1""",
            (semester, academic_year),
        )
        if not cursor.fetchone():
            cursor.execute("""SELECT semester, academicYear FROM course_offerings
                              ORDER BY academicYear DESC, semester DESC LIMIT 1""")
            latest = cursor.fetchone()
            if not latest:
                return []
            semester, academic_year = latest['semester'], latest['academicYear']
        cursor.execute(
            """SELECT co.courseId, c.courseName, co.offeringId, co.sessionId, co.semester, co.academicYear
               FROM course_offerings co
               LEFT JOIN courses_name c ON co.courseId = c.courseId
               WHERE co.semester = %s AND co.academicYear = %s
               ORDER BY co.courseId""",
            (semester, academic_year),
        )
        return cursor.fetchall()

def lambda_handler(event, context):
    connection = None
    try:
        query_params = event.get('queryStringParameters') or {}
        target_month = str(query_params.get('month') or '').strip()
        if not re.fullmatch(r'\d{4}-\d{2}', target_month):
            return fail(400, 'VALIDATION_ERROR', 'month ต้องเป็นรูปแบบ YYYY-MM')

        connection = open_connection()
        userId = get_user_id(connection, event)
        if not userId:
            return fail(403, 'FORBIDDEN', 'ไม่พบผู้ใช้ที่ผูกกับบัญชีนี้')

        periods, count = get_teaching_histories_by_month(connection, userId, target_month)
        all_courses = get_all_courses(connection, target_month)
        my_offering_ids = get_my_offering_ids(connection, userId)  # [เพิ่ม]

        return ok({
            'month': target_month,
            'count': count,
            'periods': periods,
            # [แก้] courses = วิชาที่ผู้ใช้มีคาบ (กล่องสรุป / หน้าภาพรวม / แท็บสร้างคำขอ)
            'courses': [c for c in all_courses if c['offeringId'] in my_offering_ids],
            # [เพิ่ม] allCourses = ทุกวิชาในภาค ใช้เป็นตัวเลือกตอนเพิ่มคาบ (คนที่ยังไม่มีคาบจะได้เพิ่มคาบแรกได้)
            'allCourses': all_courses,
            'offeringIds': my_offering_ids,  # [เพิ่ม]
        })

    except Exception as e:
        print(f"เกิดข้อผิดพลาด: {e}")
        return fail(500, 'INTERNAL_ERROR', 'เกิดข้อผิดพลาดภายในระบบ')

    finally:
        close_connection(connection)

