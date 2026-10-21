"""
Lambda Function: cookierun-generatePdf
GET /claims/{id}/pdf?type=claim|makeup|blank
สร้าง PDF แล้วเก็บใน S3 (bucket หลักฐาน) และคืน Presigned URL อายุสั้น

Handler: generate_pdf.lambda_handler
ต้องมีในแพ็กเกจ/Layer: db.py, validation.py, pdf.py, pymysql, fpdf2, uharfbuzz, pypdf
env: UPLOADS_BUCKET (บังคับ), DB_*, DIRECTOR_NAME (ไม่บังคับ), PDF_URL_EXPIRES (วินาที ค่าเริ่มต้น 300)
"""
import os

import boto3
from botocore.config import Config

import pdf
from db import ApiError, ok, run_auth
from validation import (
    build_claims,
    load_claim_any,
    path_claim_id,
    year_offset,
)

_s3 = boto3.client("s3", config=Config(signature_version="s3v4"))

# สถานะที่เจ้าหน้าที่ตรวจผ่านแล้ว: ออกฉบับพิมพ์จริง (ไม่มีลายน้ำ)
FINAL_STATUSES = ("approved", "documents_received", "sent_to_finance")
# สถานะที่ยังไม่ผ่านการตรวจ: ออกได้เฉพาะฉบับตัวอย่าง (ลายน้ำ "ตัวอย่าง")
PREVIEW_STATUSES = ("draft", "submitted", "returned")
# rejected ไม่ออกเอกสาร -> 409

URL_EXPIRES = int(os.environ.get("PDF_URL_EXPIRES", "300"))


def lambda_handler(event, context):
    return run_auth(event, lambda conn, auth: _handle(conn, auth, event))


def _handle(conn, auth, event):
    params = event.get("queryStringParameters") or {}
    kind = (params.get("type") or "claim").strip().lower()
    if kind not in ("claim", "makeup", "blank"):
        raise ApiError(400, "type ต้องเป็น claim, makeup หรือ blank")
    if kind == "makeup":
        raise ApiError(400, "ยังไม่รองรับแบบฟอร์มขอสอนชดเชย (type=makeup)")

    claim_id = path_claim_id(event)
    claim = load_claim_any(conn, claim_id)  # ไม่พบ = 404
    if claim["userId"] != auth["userId"] and not auth["isAdmin"]:
        raise ApiError(403, "ไม่มีสิทธิ์เข้าถึงคำขอนี้")

    info = build_claims(conn, [claim_id])
    if not info:
        raise ApiError(404, "ไม่พบคำขอ")
    c = info[0]
    role = c["role"]

    # นักศึกษาช่วยงานได้ฟอร์มเปล่าเสมอ (เขียนลายมือ) แม้ขอ type=claim
    if kind == "blank" or role == "student_helper":
        body = pdf.generate_blank_pdf(role)
        key = f"pdf/blank-{role}.pdf"
    else:
        status = c["status"]
        if status in FINAL_STATUSES:
            preview = False
        elif status in PREVIEW_STATUSES:
            preview = True
        else:
            raise ApiError(409, f"สถานะ {status} ไม่สามารถออกเอกสารได้")
        body = pdf.generate_pdf_from_template(_build_data(c), role, preview=preview)
        key = f"pdf/c{claim_id:03d}{'-preview' if preview else ''}.pdf"

    bucket = os.environ.get("UPLOADS_BUCKET")
    if not bucket:
        raise ApiError(500, "ยังไม่ได้ตั้งค่า UPLOADS_BUCKET", code="INTERNAL_ERROR")
    _s3.put_object(Bucket=bucket, Key=key, Body=body, ContentType="application/pdf")
    url = _s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key, "ResponseContentType": "application/pdf"},
        ExpiresIn=URL_EXPIRES,
    )
    return ok(200, {"downloadUrl": url, "expiresIn": URL_EXPIRES})


def _build_data(c):
    """ประกอบ dict data ให้ pdf.generate_pdf_from_template จากผล build_claims"""
    items = c.get("items") or []
    is_ta = pdf.is_ta_role(c["role"])
    first_date = items[0]["workDate"] if items else None
    year = c.get("academicYear")

    rows = [
        {
            "date": pdf.thai_date(i["workDate"]),
            "time": pdf.format_time_range(i["startTime"], i["endTime"], i["hours"]),
            "note": i.get("Remark") or "",
            "hours": i["hours"],
        }
        for i in items
    ]
    return {
        "semester": c.get("semester"),
        # academicYear ใน DB + ส่วนต่าง = ปี พ.ศ. (offset 0 = DB เก็บ พ.ศ. อยู่แล้ว)
        "academicYearBE": (year + year_offset()) if year is not None else "",
        "courseLine": f"{c.get('courseId') or ''} {c.get('courseName') or ''}".strip().upper(),
        "lecturer": None if is_ta else c.get("requesterName"),
        "taName": c.get("requesterName") if is_ta else None,
        "monthLabel": pdf.thai_month_label(first_date) if first_date else "",
        "courseKind": None,  # TODO: ติ๊กภาคทฤษฎี/ปฏิบัติ ต้องอ่านจาก teaching_histories (type)
        "rows": rows,
        "totalHours": c.get("totalHours"),
        "directorName": os.environ.get("DIRECTOR_NAME") or None,
    }
