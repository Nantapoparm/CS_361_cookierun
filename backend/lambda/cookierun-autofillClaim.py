
from decimal import Decimal
from db import run_auth, ok, parse_json_body, ApiError, now_bangkok
from validation import (
    STATUS_DRAFT,
    get_user,
    get_offering,
    get_rate,
    get_rule,
    term_hours_used,
    build_claims,
    MAX_NOTE_LENGTH
)

def lambda_handler(event, context):
    return run_auth(event, lambda conn, auth: _autofill(conn, auth, event))


def _autofill(conn, auth, event):
    user_id = auth["userId"]
    body = parse_json_body(event)

    # 1. ตรวจสอบพารามิเตอร์นำเข้าตาม Request Body ใน openapi.yaml
    offering_id = body.get("offeringId")
    month_str = body.get("month")  # รูปแบบ YYYY-MM เช่น "2026-10"

    if not offering_id or not isinstance(offering_id, int):
        raise ApiError(400, "กรุณาระบุ offeringId เป็นจำนวนเต็ม")
    if not month_str or not isinstance(month_str, str) or len(month_str) != 7:
        raise ApiError(400, "กรุณาระบุ month ในรูปแบบ YYYY-MM")

    # 2. อ่านข้อมูลวิชา/โครงการ (course_offerings + session)
    offering = get_offering(conn, offering_id)
    if not offering:
        raise ApiError(404, "ไม่พบรายวิชานี้ในระบบ")

    session_id = offering["sessionId"]
    semester = offering["semester"]
    academic_year = offering["academicYear"]

    # 3. ตรวจสอบว่าเคยมีคำขอในวิชา (offeringId) และเดือนนี้แล้วหรือยัง (ตอบ 409 ตาม spec)
    with conn.cursor() as cur:
        cur.execute(
            """SELECT c.claimId 
               FROM claims c
               JOIN work_information w ON w.claimId = c.claimId
               WHERE c.userId = %s 
                 AND w.offeringId = %s 
                 AND DATE_FORMAT(w.workDate, '%%Y-%%m') = %s
               LIMIT 1""",
            (user_id, offering_id, month_str),
        )
        if cur.fetchone():
            raise ApiError(409, f"มีคำขอเบิกวิชานี้ในเดือน {month_str} อยู่แล้วในระบบ")

    # 4. ดึงคาบสอนประจำเดือนจากตารางปฏิทิน (teaching_histories)
    start_date_str = f"{month_str}-01"
    with conn.cursor() as cur:
        cur.execute(
            """SELECT historyId, startTime, endTime, description 
               FROM teaching_histories 
               WHERE userId = %s 
                 AND courseId = %s 
                 AND DATE_FORMAT(startTime, '%%Y-%%m') = %s
               ORDER BY startTime""",
            (user_id, offering["courseId"], month_str),
        )
        schedules = cur.fetchall()

    # หากเดือนนั้นไม่มีคาบในปฏิทิน ให้ตอบ 200 ผลว่าง สำหรับหน้า ST3 (ตาม openapi.yaml)
    if not schedules:
        return ok(200, None)

    # 5. ดึงข้อมูลผู้ใช้เพื่อตรวจสอบสิทธิ์/อัตราค่าตอบแทน
    user = get_user(conn, user_id)
    role_id = user["roleId"]

    rate_row = get_rate(conn, session_id, role_id)
    rate_per_hour = Decimal(str(rate_row["compensationPerHour"])) if rate_row else Decimal("0.00")

    rule_row = get_rule(conn, session_id, role_id)
    max_hours_per_term = Decimal(str(rule_row["maxHoursPerTerm"])) if rule_row and rule_row["maxHoursPerTerm"] else None
    max_amount_per_day = Decimal(str(rule_row["maxAmountPerDay"])) if rule_row and rule_row["maxAmountPerDay"] else None

    # 6. เตรียมคำนวณและสร้างรายการงาน
    work_items = []
    total_hours_new = Decimal("0.00")
    daily_amounts = {}

    for sch in schedules:
        st = sch["startTime"]
        et = sch["endTime"]
        w_date = st.date()
        
        # คำนวณชั่วโมง
        diff_seconds = (et - st).total_seconds()
        hours = Decimal(str(round(diff_seconds / 3600.0, 2)))
        
        note = sch.get("description") or ""
        if len(note) > MAX_NOTE_LENGTH:
            note = note[:MAX_NOTE_LENGTH]

        total_hours_new += hours
        
        # ตรวจสอบเพดานเงินต่อวัน
        item_amount = hours * rate_per_hour
        daily_amounts[w_date] = daily_amounts.get(w_date, Decimal("0.00")) + item_amount
        if max_amount_per_day and daily_amounts[w_date] > max_amount_per_day:
            raise ApiError(400, f"วันที่ {w_date} มียอดเบิกเกินเพดานสูงสุดต่อวัน ({max_amount_per_day:,.2f} บาท)")

        work_items.append({
            "workDate": w_date,
            "startTime": st.time(),
            "endTime": et.time(),
            "hours": hours,
            "Remark": note  # แก้ให้ตรงกับคอลัมน์ Remark ใน DB (pim.txt)
        })

    # 7. ตรวจสอบเพดานชั่วโมงรวมต่อภาคการศึกษา
    if max_hours_per_term:
        used_hours = term_hours_used(conn, user_id, session_id, semester, academic_year, exclude_claim_id=0)
        if (used_hours + total_hours_new) > max_hours_per_term:
            raise ApiError(
                400, 
                f"ชั่วโมงเบิกรวมในภาคการศึกษานี้เกินเพดานสูงสุดที่อนุญาต ({max_hours_per_term} ชม.)"
            )

    # 8. บันทึกลง Database
    with conn.cursor() as cur:
        # 8.1 สร้างหัวคำขอ (claims)
        cur.execute(
            """INSERT INTO claims (userId, statusId, dayClaim) 
               VALUES (%s, %s, %s)""",
            (user_id, STATUS_DRAFT, now_bangkok().date()),
        )
        claim_id = cur.lastrowid

        # 8.2 บันทึกรายการคาบงาน (work_information) โดยใช้คอลัมน์ Remark (R ตัวใหญ่)
        for item in work_items:
            cur.execute(
                """INSERT INTO work_information 
                   (userId, sessionId, offeringId, claimId, workDate, startTime, endTime, hours, Remark)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (
                    user_id,
                    session_id,
                    offering_id,
                    claim_id,
                    item["workDate"],
                    item["startTime"],
                    item["endTime"],
                    item["hours"],
                    item["Remark"]
                ),
            )

    conn.commit()

    # 9. คืนค่ารูปแบบ Claim Object (201 Created) ตาม openapi.yaml
    claim_data = build_claims(conn, [claim_id])[0]
    return ok(201, claim_data)