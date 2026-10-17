
from db import run_auth, ok, parse_json_body, ApiError
from validation import (
    path_claim_id,
    load_owned_claim,
    require_draft,
    default_term,
    validate_work_items,
    validate_billing_cycle,
    write_work_items,
    build_claims,
    term_label,
)


def lambda_handler(event, context):
    return run_auth(event, lambda conn, auth: _update(conn, auth["userId"], event))


def _update(conn, user_id, event):
    claim_id = path_claim_id(event)

    # 1. ตรวจสอบสิทธิ์ความเป็นเจ้าของคำขอ และสถานะ (ต้องเป็น Draft หรือ Returned)
    claim = load_owned_claim(conn, claim_id, user_id, for_update=True)
    require_draft(claim, "คำขอนี้ไม่อยู่ในสถานะที่แก้ไขได้")

    body = parse_json_body(event)

    # 2. ตรวจสอบรูปแบบ billingCycle (ถ้ามีการส่งมา)
    if body.get("billingCycle") is not None:
        validate_billing_cycle(body)

    # 3. จัดการรายการ items (ถ้ามีการส่งมา)
    if body.get("items") is not None:
        term = body.get("term")

        # หากไม่ได้ระบุ term ใน Body ให้ดึง term เดิมจากรายการงานใน DB
        if not term:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT co.semester, co.academicYear 
                    FROM work_information wi 
                    JOIN course_offerings co ON wi.offeringId = co.offeringId 
                    WHERE wi.claimId = %s LIMIT 1
                    """,
                    (claim_id,),
                )
                row = cur.fetchone()
                if row and row.get("semester") is not None:
                    term = term_label(row["semester"], row["academicYear"])
                else:
                    term = default_term()

        items = body["items"]
        if not isinstance(items, list):
            raise ApiError(400, "items ต้องเป็น array")

        # ตรวจสอบความถูกต้องของ items และเขียนทับข้อมูลใหม่ลง work_information
        rows, _ = validate_work_items(conn, items, term)
        write_work_items(conn, claim_id, user_id, rows)

    conn.commit()

    # 4. ส่งคืนข้อมูลคำขอฉบับอัปเดตตามรูปแบบ Swagger
    return ok(200, build_claims(conn, [claim_id])[0])