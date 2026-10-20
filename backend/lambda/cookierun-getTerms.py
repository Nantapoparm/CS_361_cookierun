"""
GET /terms
ดึงรายการภาคการศึกษาและรอบการเบิก (ใช้กับ Dropdown เลือกเทอม)
ผู้รับผิดชอบ: คนที่ 3 (V3-07 / V3-84)

ความเปลี่ยนแปลงสำหรับ V3:
  - ใช้ run_auth เพื่อระบุตัวตนผู้ใช้จาก Cognito JWT Token
  - แปลงปีการศึกษา ค.ศ. -> พ.ศ. ตาม ACADEMIC_YEAR_OFFSET ผ่าน term_label()
  - คืนข้อมูลโครงสร้างมาตรฐาน Swagger
"""
from db import run_auth, ok
from validation import term_label, billing_cycles, default_term


def lambda_handler(event, context):
    return run_auth(event, lambda conn, auth: _terms(conn))


def _terms(conn):
    with conn.cursor() as cur:
        cur.execute(
            """SELECT DISTINCT semester, academicYear FROM course_offerings
               ORDER BY academicYear DESC, semester DESC"""
        )
        rows = cur.fetchall()

    # แปลง semester + academicYear ใน DB เป็น label พ.ศ. เช่น "1-2569"
    labels = [term_label(r["semester"], r["academicYear"]) for r in rows]

    # หากเทอมเริ่มต้นใน config (default_term) ยังไม่มีใน DB ให้ใส่เพิ่มไว้กัน Dropdown ว่าง
    def_term = default_term()
    if def_term not in labels:
        labels.append(def_term)
        labels.sort(key=lambda x: (x.split("-")[1], x.split("-")[0]), reverse=True)

    data = [
        {
            "id": label,
            "name": f"ภาคการศึกษาที่ {label.split('-')[0]}/{label.split('-')[1]}",
            "billingCycles": billing_cycles(),
        }
        for label in labels
    ]

    return ok(200, data)