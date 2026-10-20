import re
import datetime as dt
from decimal import Decimal
from db import run_auth, ok, parse_json_body, ApiError
from validation import (
    MAX_NOTE_LENGTH,
    path_claim_id,
    load_owned_claim,
    require_draft,
    get_offering,
    write_work_items,
    build_claims,
)


def lambda_handler(event, context):
    return run_auth(event, lambda conn, auth: _update(conn, auth["userId"], event))


def parse_time(value, field):
    # รับ "09:30" หรือ "09:30:00"
    m = re.fullmatch(r"([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?", str(value or "").strip())
    if not m:
        raise ApiError(400, f"{field} ต้องเป็นรูปแบบ HH:MM")
    return dt.time(int(m.group(1)), int(m.group(2)), int(m.group(3) or 0))


def parse_items(items, month, offering):
    # เหมือนใน createClaim
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

    rows.sort(key=lambda r: (r["workDate"], r["startTime"]))
    for a, b in zip(rows, rows[1:]):
        if a["workDate"] == b["workDate"] and b["startTime"] < a["endTime"]:
            raise ApiError(400, f"วันที่ {a['workDate']} มีคาบเวลาซ้อนกัน")
    return rows


def _update(conn, user_id, event):
    claim_id = path_claim_id(event)

    # ต้องเป็นของผู้ใช้ และอยู่ในสถานะร่าง / ถูกส่งกลับ
    claim = load_owned_claim(conn, claim_id, user_id, for_update=True)
    require_draft(claim, "คำขอนี้ไม่อยู่ในสถานะที่แก้ไขได้")

    body = parse_json_body(event)
    if body.get("items") is None:
        # ไม่มีอะไรให้แก้ — คืนคำขอเดิม
        return ok(200, build_claims(conn, [claim_id])[0])

    # วิชา + เดือน ของคำขอเดิม (จากคาบที่บันทึกไว้)
    with conn.cursor() as cur:
        cur.execute(
            """SELECT offeringId, DATE_FORMAT(workDate, '%%Y-%%m') AS month
               FROM work_information WHERE claimId = %s
               ORDER BY workDate LIMIT 1""",
            (claim_id,),
        )
        cur_row = cur.fetchone()

    if cur_row:
        offering_id, month = cur_row["offeringId"], cur_row["month"]
    else:
        raw_id = body.get("offeringId")
        month = str(body.get("month") or "").strip()
        if isinstance(raw_id, bool) or not re.fullmatch(r"\d+", str(raw_id or "").strip()):
            raise ApiError(400, "คำขอนี้ยังไม่มีคาบ ต้องระบุ offeringId")
        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
            raise ApiError(400, "คำขอนี้ยังไม่มีคาบ ต้องระบุ month ในรูปแบบ YYYY-MM")
        offering_id = int(str(raw_id).strip())

    offering = get_offering(conn, offering_id)
    if not offering:
        raise ApiError(404, "ไม่พบรายวิชานี้ในระบบ")

    rows = parse_items(body["items"], month, offering)
    write_work_items(conn, claim_id, user_id, rows)
    conn.commit()

    return ok(200, build_claims(conn, [claim_id])[0])