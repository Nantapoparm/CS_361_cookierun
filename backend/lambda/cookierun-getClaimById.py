"""
GET /claims/{id}
ดึงรายละเอียดคำขอฉบับเดียว (รูปแบบเดียวกับ Swagger)
ผู้รับผิดชอบ: คนที่ 3 (V3-07 / V3-84)

ความเปลี่ยนแปลงสำหรับ V3:
  - ใช้ run_auth ระบุตัวตนผู้ใช้จาก Cognito JWT Token แทน Header X-User-Id
  - อนุญาตให้ Admin ดูรายละเอียดได้ทุกคำขอ ส่วนผู้ใช้ทั่วไปดูได้เฉพาะของตนเอง
  - คืนค่าผลลัพธ์ผ่าน build_claims() รูปแบบมาตรฐาน V3
"""
from db import run_auth, ok, ApiError
from validation import (
    path_claim_id,
    load_owned_claim,
    load_claim_any,
    build_claims,
)


def lambda_handler(event, context):
    return run_auth(event, lambda conn, auth: _get(conn, auth, event))


def _get(conn, auth, event):
    user_id = auth["userId"]
    is_admin = auth["isAdmin"]
    claim_id = path_claim_id(event)

    # 1. ตรวจสอบสิทธิ์การเข้าถึง (Admin ดูได้ทั้งหมด / ผู้ใช้ทั่วไปดูได้เฉพาะคำขอของตนเอง)
    if is_admin:
        load_claim_any(conn, claim_id)
    else:
        load_owned_claim(conn, claim_id, user_id)

    # 2. ดึงข้อมูลคำขอและประกอบโครงสร้าง Swagger
    claims_data = build_claims(conn, [claim_id])
    if not claims_data:
        raise ApiError(404, "ไม่พบคำขอ")

    return ok(200, claims_data[0])