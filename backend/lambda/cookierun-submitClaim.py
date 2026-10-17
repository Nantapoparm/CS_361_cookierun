from decimal import Decimal
from db import run_auth, ok, parse_json_body, ApiError
from validation import (
    path_claim_id,
    load_owned_claim,
    get_user,
    get_offering,
    get_rate,
    get_rule,
    find_already_claimed_date,
    term_hours_used,
    parse_print_method,
    print_status_id,
    apply_transition,
    build_claims,
)


def lambda_handler(event, context):
    return run_auth(event, lambda conn, auth: _submit(conn, auth, event))


def _submit(conn, auth, event):
    user_id = auth["userId"]
    claim_id = path_claim_id(event)
    body = parse_json_body(event)

    # 1. ตรวจสอบและรับค่า printMethod (sign_with_staff หรือ self_print)
    print_method = parse_print_method(body.get("printMethod"))
    p_status_id = print_status_id(print_method)

    # 2. ล็อกแถว claim และ user เพื่อป้องกัน Race Condition ตอนยื่นพร้อมกัน
    claim = load_owned_claim(conn, claim_id, user_id, for_update=True)
    user = get_user(conn, user_id, for_update=True)

    # 3. ตรวจสอบว่ามีรายการงานในคำขอนี้หรือไม่
    with conn.cursor() as cur:
        cur.execute(
            """SELECT DISTINCT offeringId, sessionId 
               FROM work_information 
               WHERE claimId = %s""",
            (claim_id,),
        )
        offering_rows = cur.fetchall()

    if not offering_rows:
        raise ApiError(400, "ยังไม่มีรายการงานในคำขอนี้ ไม่สามารถยื่นได้")

    offering_id = offering_rows[0]["offeringId"]
    session_id = offering_rows[0]["sessionId"]

    # 4. ตรวจสอบว่ามีการเบิกซ้ำวันและวิชาเดียวกันในคำขออื่นหรือไม่
    duplicate_date = find_already_claimed_date(conn, claim_id, user_id)
    if duplicate_date:
        raise ApiError(
            409,
            f"วันที่ {duplicate_date} ในวิชานี้เคยถูกยื่นเบิกไปแล้วในคำขออื่น",
        )

    # 5. ตรวจสอบอัตราค่าตอบแทนและกฎเพดานชั่วโมง/เงิน
    offering = get_offering(conn, offering_id)
    role_id = user["roleId"]

    rate_row = get_rate(conn, session_id, role_id)
    if not rate_row:
        raise ApiError(400, "ไม่พบอัตราค่าตอบแทนสำหรับบทบาทนี้ในโครงการที่เลือก")

    rate_per_hour = Decimal(str(rate_row["compensationPerHour"]))

    rule_row = get_rule(conn, session_id, role_id)
    max_hours = Decimal(str(rule_row["maxHoursPerTerm"])) if rule_row and rule_row["maxHoursPerTerm"] else None
    max_amount_per_day = Decimal(str(rule_row["maxAmountPerDay"])) if rule_row and rule_row["maxAmountPerDay"] else None

    # 6. คำนวณชั่วโมงและยอดเงินในคำขอนี้
    with conn.cursor() as cur:
        cur.execute(
            """SELECT workDate, hours 
               FROM work_information 
               WHERE claimId = %s""",
            (claim_id,),
        )
        items = cur.fetchall()

    claim_hours = sum((Decimal(str(item["hours"])) for item in items), Decimal("0.00"))

    # 6.1 ตรวจสอบเพดานชั่วโมงรวมต่อภาคการศึกษา
    if max_hours:
        used_hours = term_hours_used(
            conn,
            user_id,
            session_id,
            offering["semester"],
            offering["academicYear"],
            exclude_claim_id=claim_id,
        )
        if (used_hours + claim_hours) > max_hours:
            raise ApiError(
                400,
                f"จำนวนชั่วโมงเบิกรวมในภาคการศึกษานี้ ({used_hours + claim_hours} ชม.) เกินเพดานสูงสุด ({max_hours} ชม.)",
            )

    # 6.2 ตรวจสอบยอดเงินต่อวัน
    if max_amount_per_day:
        daily_amounts = {}
        for item in items:
            w_date = item["workDate"]
            hrs = Decimal(str(item["hours"]))
            daily_amounts[w_date] = daily_amounts.get(w_date, Decimal("0.00")) + (hrs * rate_per_hour)
            if daily_amounts[w_date] > max_amount_per_day:
                raise ApiError(
                    400,
                    f"ยอดเงินเบิกในวันที่ {w_date} เกินเพดานสูงสุดต่อวัน ({max_amount_per_day:,.2f} บาท)",
                )

    # 7. อัปเดตช่องทางยื่นเอกสาร (printStatus)
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE claims SET printStatus = %s WHERE claimId = %s",
            (p_status_id, claim_id),
        )

    # 8. เปลี่ยนสถานะเป็น submitted ผ่าน State Machine (บันทึก dayClaim + Audit Log)
    apply_transition(
        conn,
        claim_id=claim_id,
        action="submit",
        actor_user_id=user_id,
        actor_is_admin=auth["isAdmin"],
        stamp_day=True,
    )

    conn.commit()

    # 9. ดึงข้อมูลคำขอที่ยื่นเสร็จแล้วส่งกลับตามรูปแบบ Swagger
    data = build_claims(conn, [claim_id])[0]
    return ok(200, data)