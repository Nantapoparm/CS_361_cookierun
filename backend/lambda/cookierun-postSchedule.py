import json
import os
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
        connect_timeout=5
    )

def close_connection(connection):
    if connection and connection.open:
        connection.close()

def insert_teaching_history(connection, userId, courseId, startTime, endTime, description, room, sessionId):
    with connection.cursor() as cursor:
        sql = """
            INSERT INTO teaching_histories (userId, courseId, startTime, endTime, description, room, sessionId) 
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """
        cursor.execute(sql, (userId, courseId, startTime, endTime, description, room, sessionId))
        connection.commit()

def lambda_handler(event, context):
    connection = None
    try:
        request_context = event.get('requestContext', {})
        authorizer = request_context.get('authorizer', {})
        
        userId = authorizer.get('userId') or authorizer.get('claims', {}).get('sub')

        body = event.get('body', '{}')
        if isinstance(body, str):
            body = json.loads(body)
            
        if not userId:
            userId = body.get('userId')

        courseId = body.get('courseId')
        startTime = body.get('startTime')
        endTime = body.get('endTime')
        description = body.get('description', '')
        room = body.get('room', '')
        
        # ดึง sessionId จาก body ถ้าไม่มีให้ใช้ค่าเริ่มต้นเป็น 2 ตามที่คุณต้องการ
        sessionId = body.get('sessionId', 2)

        if not all([userId, courseId, startTime, endTime]):
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'ข้อมูลไม่ครบถ้วน หรือยังไม่ได้เข้าสู่ระบบ (Unauthorized)'})
            }

        connection = open_connection()
        insert_teaching_history(connection, userId, courseId, startTime, endTime, description, room, sessionId)
            
        return {
            'statusCode': 200,
            'body': json.dumps({'message': 'บันทึกประวัติการสอนสำเร็จ!', 'userId': userId, 'sessionId': sessionId})
        }
        
    except Exception as e:
        print(f"เกิดข้อผิดพลาด: {e}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }
        
    finally:
        close_connection(connection)