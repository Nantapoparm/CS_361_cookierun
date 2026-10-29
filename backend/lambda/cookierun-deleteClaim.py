"""
Lambda Function: cookierun-deleteClaim
รองรับ DELETE /claims/{id} 
ลบคำขอที่เป็นร่าง (Draft) ของตนเอง
"""
from db import run_auth, ok, ApiError
from validation import path_claim_id, load_owned_claim, STATUS_DRAFT


def lambda_handler(event, context):
    return run_auth(event, lambda conn, auth: _delete_claim(conn, auth, event))


def _delete_claim(conn, auth, event):
    user_id = auth["userId"]
    claim_id = path_claim_id(event)

    # 1. ตรวจสิทธิ์ความเป็นเจ้าของคำขอ
    claim = load_owned_claim(conn, claim_id, user_id, for_update=True)

    # 2. ตรวจสอบว่าต้องเป็นสถานะ Draft เท่านั้น
    if claim["statusId"] != STATUS_DRAFT:
        raise ApiError(409, "ลบได้เฉพาะคำขอที่เป็นร่าง (Draft) เท่านั้น")

    # 3. ลบข้อมูลใน work_information, claims_histories และ claims ใน Transaction เดียวกัน
    with conn.cursor() as cur:
        cur.execute("DELETE FROM work_information WHERE claimId = %s", (claim_id,))
        cur.execute("DELETE FROM claims_histories WHERE claimId = %s", (claim_id,))
        cur.execute("DELETE FROM claims WHERE claimId = %s", (claim_id,))

    conn.commit()

    return ok(
        200,
        {
            "message": "ลบร่างคำขอสำเร็จ",
            "claimId": f"c{claim_id:03d}",
        },
    )