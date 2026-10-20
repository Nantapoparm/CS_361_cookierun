import re
from decimal import Decimal
from db import run_auth, ok, parse_json_body, ApiError
from validation import get_user, get_offering, get_rate

# ประเภทคาบเก็บใน teaching_histories.description (ไม่มีคอลัมน์ kind)
CANCELLED = ("cancelled", "canceled", "งดสอน")
MAKEUP = ("makeup", "make-up", "สอนชดเชย", "ชดเชย")


def lambda_handler(event, context):
    return run_auth(event, lambda conn, auth: _autofill(conn, auth, event))


def parse_offering_id(value):
    # รับทั้ง 2 และ "2" ; bool เป็น subclass ของ int จึงต้องกันไว้
    if isinstance(value, bool) or not re.fullmatch(r"\d+", str(value or "").strip()):
        raise ApiError(400, "กรุณาระบุ offeringId เป็นจำนวนเต็ม")
    return int(str(value).strip())


def parse_month(value):
    month = str(value or "").strip()
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        raise ApiError(400, "กรุณาระบุ month ในรูปแบบ YYYY-MM")
    return month


def _autofill(conn, auth, event):
    user_id = auth["userId"]
    body = parse_json_body(event)
    offering_id = parse_offering_id(body.get("offeringId"))
    month = parse_month(body.get("month"))

    offering = get_offering(conn, offering_id)
    if not offering:
        raise ApiError(404, "ไม่พบรายวิชานี้ในระบบ")
    session_id = offering["sessionId"]

    with conn.cursor() as cur:
        # คาบของวิชานี้ (courseId + sessionId เดียวกับ offering) ในเดือนนั้น
        cur.execute(
            """SELECT t.historyId, t.startTime, t.endTime, t.description, t.room, c.courseName
               FROM teaching_histories t
               LEFT JOIN courses_name c ON c.courseId = t.courseId
               WHERE t.userId = %s
                 AND t.courseId = %s
                 AND (t.sessionId = %s OR t.sessionId IS NULL)
                 AND DATE_FORMAT(t.startTime, '%%Y-%%m') = %s
               ORDER BY t.startTime""",
            (user_id, offering["courseId"], session_id, month),
        )
        schedules = cur.fetchall()

        # บอกหน้าเว็บว่ามีคำขอวิชานี้เดือนนี้อยู่แล้วหรือยัง (POST /claims จะตอบ 409 ถ้าซ้ำ)
        cur.execute(
            """SELECT c.claimId
               FROM claims c
               JOIN work_information w ON w.claimId = c.claimId
               WHERE c.userId = %s AND w.offeringId = %s
                 AND DATE_FORMAT(w.workDate, '%%Y-%%m') = %s
               LIMIT 1""",
            (user_id, offering_id, month),
        )
        existing = cur.fetchone()

    items = []
    for sch in schedules:
        kind = str(sch.get("description") or "").strip().lower()
        if kind in CANCELLED:  # คาบงดสอนไม่เบิก
            continue
        st, et = sch["startTime"], sch["endTime"]
        if not st or not et or et <= st:
            continue
        items.append({
            "workId": None,
            "historyId": sch["historyId"],
            "workDate": st.date().isoformat(),
            "startTime": st.strftime("%H:%M"),
            "endTime": et.strftime("%H:%M"),
            "hours": round((et - st).total_seconds() / 3600.0, 2),
            # description เก็บประเภทคาบ ไม่ใช่หมายเหตุ → Remark ว่าง ยกเว้นคาบชดเชย
            "Remark": "สอนชดเชย" if kind in MAKEUP else "",
            "kind": "makeup" if kind in MAKEUP else "regular",
            "room": sch.get("room") or "",
        })

    if not items:
        return ok(200, None)

    user = get_user(conn, user_id)
    rate_row = get_rate(conn, session_id, user["roleId"])
    rate = Decimal(str(rate_row["compensationPerHour"])) if rate_row else Decimal("0")
    total_hours = sum(Decimal(str(x["hours"])) for x in items)

    return ok(200, {
        "claimId": None,
        "existingClaimId": existing["claimId"] if existing else None,
        "status": "draft",
        "offeringId": offering_id,
        "courseId": offering["courseId"],
        "courseName": schedules[0].get("courseName") or offering["courseId"],
        "sessionId": session_id,
        "semester": offering["semester"],
        "academicYear": offering["academicYear"],
        "month": month,
        "ratePerHour": float(rate),
        "totalHours": float(total_hours),
        "totalAmount": float(total_hours * rate),
        "items": items,
    })