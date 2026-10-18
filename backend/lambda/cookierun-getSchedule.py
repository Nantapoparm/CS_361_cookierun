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

def get_teaching_histories_by_month(connection, userId, target_month):
    with connection.cursor() as cursor:
        sql = """
            SELECT 
                t.historyId, 
                t.userId, 
                t.courseId, 
                c.courseName, 
                t.startTime, 
                t.endTime, 
                t.description, 
                t.room,
                t.sessionId
            FROM teaching_histories t
            JOIN courses_name c ON t.courseId = c.courseId
            WHERE t.userId = %s AND DATE_FORMAT(t.startTime, '%%Y-%%m') = %s
            ORDER BY t.startTime ASC
        """
        cursor.execute(sql, (userId, target_month))
        return cursor.fetchall()

def lambda_handler(event, context):
    connection = None
    try:
        request_context = event.get('requestContext', {})
        authorizer = request_context.get('authorizer', {})
        
        userId = authorizer.get('userId') or authorizer.get('claims', {}).get('sub')

        query_params = event.get('queryStringParameters') or {}
        if not userId:
            userId = query_params.get('userId')

        target_month = query_params.get('month')

        if not userId or not target_month:
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'กรุณาระบุ userId และ month ในรูปแบบ YYYY-MM'})
            }

        connection = open_connection()
        schedules = get_teaching_histories_by_month(connection, userId, target_month)
            
        return {
            'statusCode': 200,
            'body': json.dumps(schedules, default=str)
        }
        
    except Exception as e:
        print(f"เกิดข้อผิดพลาด: {e}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }
        
    finally:
        close_connection(connection)