
import io
import os
import boto3
from botocore.config import Config
from db import run_auth, ok, ApiError
from validation import (
    load_claim_any,
    load_owned_claim,
    build_claims,
    log_action,
    path_claim_id,
    status_key,
    STATUS_APPROVED,
    ACTION_PDF_DOWNLOADED
)

# S3 Client Configuration
S3_BUCKET = os.environ.get("S3_UPLOADS_BUCKET", "cookierun-uploads")
EXPIRATION_SECONDS = 300


def lambda_handler(event, context):
    return run_auth(event, lambda conn, auth: _generate_pdf(conn, auth, event))


def _generate_pdf(conn, auth, event):
    user_id = auth["userId"]
    is_admin = auth["isAdmin"]
    claim_id = path_claim_id(event)

    params = event.get("queryStringParameters") or {}
    pdf_type = params.get("type", "claim").lower()  # claim | makeup | blank

    if pdf_type not in ("claim", "makeup", "blank"):
        raise ApiError(400, "type ต้องเป็น 'claim', 'makeup' หรือ 'blank'")

    # 1. ตรวจสอบสิทธิ์การเข้าถึงคำขอ (Admin ดูได้ทั้งหมด / ผู้ใช้ทั่วไปดูได้เฉพาะคำขอของตนเอง)
    if is_admin:
        claim_db = load_claim_any(conn, claim_id)
    else:
        claim_db = load_owned_claim(conn, claim_id, user_id)

    # 2. ดึงข้อมูลคำขอเต็มในรูปแบบ Swagger
    claims_data = build_claims(conn, [claim_id])
    if not claims_data:
        raise ApiError(404, "ไม่พบข้อมูลคำขอ")
    claim_info = claims_data[0]

    current_status = claim_info["status"]
    role = claim_info["role"]

    # 3. เงื่อนไขความปลอดภัย: type=claim จะดาวน์โหลดได้ต่อเมื่อ approved ขึ้นไป (ยกเว้น admin)
    if pdf_type == "claim" and not is_admin:
        if current_status not in ("approved", "documents_received", "sent_to_finance"):
            raise ApiError(
                409,
                "สามารถดาวน์โหลดแบบฟอร์มฉบับพิมพ์จริงได้เมื่อเจ้าหน้าที่ตรวจผ่าน (Approved) แล้วเท่านั้น"
            )

    # 4. นักศึกษาช่วยงาน (student_helper) จะได้แบบฟอร์มเปล่าเสมอ
    if role == "student_helper":
        pdf_type = "blank"

    # 5. สร้างเนื้อหาไฟล์ PDF (Binary Buffer)
    pdf_buffer = _build_pdf_bytes(claim_info, pdf_type)

    # 6. อัปโหลดไฟล์ PDF ขึ้น S3 Bucket
    file_key = f"pdf/c{claim_id:03d}_{pdf_type}.pdf"
    s3_client = boto3.client("s3", config=Config(signature_version="s3v4"))

    try:
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=file_key,
            Body=pdf_buffer.getvalue(),
            ContentType="application/pdf"
        )
    except Exception as e:
        raise ApiError(500, f"เกิดข้อผิดพลาดในการบันทึก PDF ลง S3: {str(e)}")

    # 7. สร้าง Presigned URL อายุ 300 วินาที
    try:
        presigned_url = s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": S3_BUCKET, "Key": file_key},
            ExpiresIn=EXPIRATION_SECONDS
        )
    except Exception as e:
        raise ApiError(500, f"เกิดข้อผิดพลาดในการสร้าง Presigned URL: {str(e)}")

    # 8. บันทึก Audit Log ลง claim_actions
    log_action(
        conn,
        claim_id=claim_id,
        actor_user_id=user_id,
        action=ACTION_PDF_DOWNLOADED,
        from_status_id=claim_db["statusId"],
        to_status_id=claim_db["statusId"],
        note=f"ดาวน์โหลด PDF ประเภท {pdf_type}"
    )
    conn.commit()

    # 9. คืนค่าตาม openapi.yaml
    return ok(
        200,
        {
            "downloadUrl": presigned_url,
            "expiresIn": EXPIRATION_SECONDS
        }
    )


def _build_pdf_bytes(claim_info, pdf_type):
    """
    สร้างไบนารี PDF ด้วย FPDF / ReportLab
    หมายเหตุ: ตัวย่อยสำหรับการวาดตารางและตัวอักษรภาษาไทย
    """
    buffer = io.BytesIO()

    # สามารถใช้ ReportLab หรือ fpdf2 ในการ Render ได้ตามต้องการ
    # ตัวอย่างโครงสร้างสตรีมอย่างง่าย (สามารถใช้ template จริงของคณะ):
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    c = canvas.Canvas(buffer, pagesize=A4)
    c.setFont("Helvetica-Bold", 16)
    
    if pdf_type == "blank":
        c.drawString(100, 800, "BLANK FORM - FOR STUDENT HELPER")
    elif pdf_type == "makeup":
        c.drawString(100, 800, f"MAKEUP CLASS FORM - CLAIM {claim_info['id']}")
    else:
        c.drawString(100, 800, f"TEACHING COMPENSATION CLAIM - {claim_info['id']}")

    c.setFont("Helvetica", 12)
    c.drawString(100, 760, f"User ID: {claim_info['userId']}")
    c.drawString(100, 740, f"Term: {claim_info['term']}")
    c.drawString(100, 720, f"Total Hours: {claim_info['totalHours']}")
    c.drawString(100, 700, f"Total Amount: {claim_info['totalAmount']} THB")

    c.showPage()
    c.save()

    buffer.seek(0)
    return buffer