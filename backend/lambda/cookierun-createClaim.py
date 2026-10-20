import re
import datetime as dt
from decimal import Decimal
from db import run_auth, ok, parse_json_body, ApiError
from validation import (
    STATUS_DRAFT,
    MAX_NOTE_LENGTH,
    get_user,
    get_offering,
    write_work_items,
    build_claims,
)


def lambda_handler(event, context):
    return run_auth(event, lambda conn, auth: _create(conn, auth["userId"], event))


def parse_offering_id(value):
    if isinstance(value, bool) or not re.fullmatch(r"\d+", str(value or "").strip()):
        raise ApiError(400, "กรุณาระบุ offeringId เป็นจำนวนเต็ม")
    return int(str(value).strip())


def parse_month(value):
    month = str(value or "").strip()
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        raise ApiError(400, "กรุณาระบุ month ในรูปแบบ YYYY-MM")
    return month


def parse_time(value, field):
    # รับ "09:30" หรือ "09:30:00"
    m = re.fullmatch(r"([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?", str(value or "").strip())
    if not m:
        raise ApiError(400, f"{field} ต้องเป็นรูปแบบ HH:MM")
    return dt.time(int(m.group(1)), int(m.group(2)), int(m.group(3) or 0))


def parse_items(items, month, offering):
    if not isinstance(items, list) or not items:
        raise ApiError(400, "items ต้องเป็น array และมีอย่างน้อย 1 รายการ")
    rows = []
    for i, item in enumerate(items, start=1):
        label = f"แถวที่ {i}"
        if not isinstance(item, dict):
            raise ApiError(400, f"{label}: ต้องเป็น object")
        try:
            work_date = dt.date.fromisoformat(str(item.get("workDate") or "").strip())
        except ValueError:
            raise ApiError(400, f"{label}: workDate ต้องเป็นรูปแบบ YYYY-MM-DD")
        if work_date.strftime("%Y-%m") != month:
            raise ApiError(400, f"{label}: วันที่ต้องอยู่ในเดือน {month}")
        start = parse_time(item.get("startTime"), f"{label}: startTime")
        end = parse_time(item.get("endTime"), f"{label}: endTime")
        if end <= start:
            raise ApiError(400, f"{label}: เวลาสิ้นสุดต้องหลังเวลาเริ่ม")
        remark = item.get("Remark", item.get("remark")) or ""
        if not isinstance(remark, str):
            raise ApiError(400, f"{label}: Remark ต้องเป็นข้อความ")
        remark = remark.strip()
        if len(remark) > MAX_NOTE_LENGTH:
            raise ApiError(400, f"{label}: หมายเหตุต้องไม่เกิน {MAX_NOTE_LENGTH} ตัวอักษร")
        minutes = (end.hour * 60 + end.minute) - (start.hour * 60 + start.minute)
        rows.append({
            "workDate": work_date,
            "startTime": start,
            "endTime": end,
            "hours": (Decimal(minutes) / Decimal(60)).quantize(Decimal("0.01")),
            "remark": remark,
            "offeringId": offering["offeringId"],
            "sessionId": offering["sessionId"],
        })

    # คาบวันเดียวกันห้ามเวลาซ้อนกัน
    rows.sort(key=lambda r: (r["workDate"], r["startTime"]))
    for a, b in zip(rows, rows[1:]):
        if a["workDate"] == b["workDate"] and b["startTime"] < a["endTime"]:
            raise ApiError(400, f"วันที่ {a['workDate']} มีคาบเวลาซ้อนกัน")
    return rows


def _create(conn, user_id, event):
    body = parse_json_body(event)
    get_user(conn, user_id)
    offering_id = parse_offering_id(body.get("offeringId"))
    month = parse_month(body.get("month"))

    offering = get_offering(conn, offering_id)
    if not offering:
        raise ApiError(404, "ไม่พบรายวิชานี้ในระบบ")

    rows = parse_items(body.get("items"), month, offering)

    with conn.cursor() as cur:
        # 1 วิชา / 1 เดือน มีได้ 1 คำขอ (ยกเว้นใบที่ถูกปฏิเสธ)
        cur.execute(
            """SELECT c.claimId
               FROM claims c
               JOIN `status` st ON st.statusId = c.statusId
               JOIN work_information w ON w.claimId = c.claimId
               WHERE c.userId = %s AND w.offeringId = %s
                 AND DATE_FORMAT(w.workDate, '%%Y-%%m') = %s
                 AND st.statusName <> 'Rejected'
               LIMIT 1""",
            (user_id, offering_id, month),
        )
        dup = cur.fetchone()
        if dup:
            raise ApiError(409, f"มีคำขอ #{dup['claimId']} ของวิชานี้ในเดือน {month} อยู่แล้ว")

        # dayClaim ตั้งตอนยื่น (submitClaim)
        cur.execute(
            "INSERT INTO claims (userId, statusId) VALUES (%s, %s)",
            (user_id, STATUS_DRAFT),
        )
        claim_id = cur.lastrowid

    write_work_items(conn, claim_id, user_id, rows)
    conn.commit()

    return ok(201, build_claims(conn, [claim_id])[0])