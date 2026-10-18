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
        request_context = event.get('requestContext', {})
        authorizer = request_context.get('authorizer', {})
        userId = authorizer.get('userId') or authorizer.get('claims', {}).get('sub')

        path_params = event.get('pathParameters') or {}
        historyId = path_params.get('id')

        body = event.get('body', '{}')
        if isinstance(body, str):
            body = json.loads(body)
            
        if not userId:
            userId = body.get('userId')

        if not historyId or not userId:
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'ข้อมูล ID หรือ userId ไม่ครบถ้วน'})
            }

        courseId = body.get('courseId')
        startTime = body.get('startTime')
        endTime = body.get('endTime')
        description = body.get('description', '')
        room = body.get('room', '')

        if not all([courseId, startTime, endTime]):
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'กรุณาส่งข้อมูล courseId, startTime และ endTime ให้ครบถ้วน'})
            }

        connection = open_connection()
        rowcount = update_schedule(connection, historyId, userId, courseId, startTime, endTime, description, room)
        
        if rowcount == 0:
            return {
                'statusCode': 404,
                'body': json.dumps({'error': 'ไม่พบข้อมูลคาบสอน หรือคุณไม่มีสิทธิ์แก้ไข'})
            }

        return {
            'statusCode': 200,
            'body': json.dumps({'message': 'แก้ไขคาบสอนสำเร็จ!'})
        }

    except Exception as e:
        print(f"เกิดข้อผิดพลาด: {e}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }
        
    finally:
        close_connection(connection)