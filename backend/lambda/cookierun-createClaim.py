
from db import run_auth, ok, parse_json_body, ApiError
from validation import (
    STATUS_DRAFT,
    get_user,
    parse_term,
    validate_work_items,
    validate_billing_cycle,
    write_work_items,
    build_claims,
    create_course_offering,
    handle_create_course_offering,
)


def lambda_handler(event, context):
    request_context = event.get("requestContext") or {}
    http = request_context.get("http") or {}

    method = (event.get("httpMethod") or http.get("method") or "").upper()
    path = (
        event.get("resource")
        or event.get("rawPath")
        or event.get("path")
        or ""
    ).rstrip("/")

    # รองรับ Route พิเศษ /course-offerings หากส่งเข้ามาที่ Lambda ตัวนี้
    if path == "/course-offerings" and method in ("POST", "OPTIONS"):
        return handle_create_course_offering(event)

    # Route หลัก POST /claims
    if path == "/claims" and method in ("POST", "OPTIONS"):
        return run_auth(event, lambda conn, auth: _create(conn, auth["userId"], event))

    return {
        "statusCode": 404,
        "headers": {"Content-Type": "application/json"},
        "body": '{"success":false,"error":{"code":"NOT_FOUND","message":"Route not found"}}',
    }


def _create(conn, user_id, event):
    body = parse_json_body(event)
    get_user(conn, user_id)

    # 1. ตรวจสอบ term
    term = body.get("term")
    if not isinstance(term, str) or not term.strip():
        raise ApiError(400, "ต้องระบุ term เช่น 1-2569")

    term = term.strip()
    sem_val, year_val = parse_term(term)  # แปลง term (รองรับ ACADEMIC_YEAR_OFFSET)

    # 2. ตรวจสอบ billingCycle
    if body.get("billingCycle") is None:
        raise ApiError(400, "ต้องระบุ billingCycle")

    validate_billing_cycle(body)

    # 3. จัดการรายการ items (ถ้ามี)
    items = body.get("items")
    rows = []

    if items is not None:
        if not isinstance(items, list):
            raise ApiError(400, "items ต้องเป็น array")

        course_codes = {}
        course_names = set()

        for i, item in enumerate(items, start=1):
            label = f"items[{i}]"

            if not isinstance(item, dict):
                raise ApiError(400, f"{label} ต้องเป็น object")

            code = item.get("courseCode")
            if not isinstance(code, str) or not code.strip():
                raise ApiError(400, f"{label}: ต้องระบุ courseCode")

            code = code.strip()
            if len(code) > 30:
                raise ApiError(400, f"{label}: courseCode ยาวเกิน 30 ตัวอักษร")

            course_codes.setdefault(code.casefold(), code)

            # ตรวจสอบชื่อวิชา (ถ้ามี)
            name = item.get("courseName", code)
            if isinstance(name, str):
                name = name.strip()
                if len(name) > 255:
                    raise ApiError(400, f"{label}: courseName ยาวเกิน 255 ตัวอักษร")
                if name:
                    course_names.add(name)

        if len(course_codes) > 1:
            raise ApiError(
                400,
                "ทุกรายการในคำขอเดียวกันต้องเป็นวิชา (courseCode) เดียวกัน",
            )

        if len(course_names) > 1:
            raise ApiError(
                400,
                "ทุกรายการในคำขอเดียวกันต้องใช้ชื่อวิชา (courseName) เดียวกัน",
            )

        # หากมีวิชาส่งมา ให้ตรวจสอบ/สร้างใน DB
        if course_codes:
            course_code = next(iter(course_codes.values()))
            course_name = next(iter(course_names), course_code)

            with conn.cursor() as cur:
                # 3.1 ค้นหาการเปิดสอนวิชานี้ในเทอมดังกล่าว
                cur.execute(
                    """
                    SELECT offeringId FROM course_offerings 
                    WHERE courseId = %s AND academicYear = %s AND semester = %s
                    """,
                    (course_code, year_val, sem_val),
                )
                offering = cur.fetchone()

                # หากยังไม่มี ให้เปิดสอนวิชานี้ให้อัตโนมัติ
                if offering is None:
                    create_course_offering(
                        conn,
                        {
                            "courseCode": course_code,
                            "term": term,
                        },
                    )

                # 3.2 บันทึก/อัปเดตชื่อวิชาลงตาราง courses_name
                cur.execute(
                    """
                    SELECT courseId FROM courses_name WHERE courseId = %s
                    """,
                    (course_code,),
                )
                db_course = cur.fetchone()

                if db_course:
                    cur.execute(
                        """
                        UPDATE courses_name 
                        SET courseName = %s 
                        WHERE courseId = %s
                        """,
                        (course_name, course_code),
                    )
                else:
                    cur.execute(
                        """
                        INSERT INTO courses_name (courseId, courseName) 
                        VALUES (%s, %s)
                        """,
                        (course_code, course_name),
                    )

        # 3.3 ตรวจสอบความถูกต้องของรายการงานที่จะเขียนลง DB
        rows, _ = validate_work_items(conn, items, term)

    # 4. บันทึกคำขอลงตาราง claims ( statusId = 1 / Draft )
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO claims (userId, statusId) VALUES (%s, %s)",
            (user_id, STATUS_DRAFT),
        )
        claim_id = cur.lastrowid

    # 5. เขียนรายการงานลงตาราง work_information (ถ้ามี)
    if rows:
        write_work_items(conn, claim_id, user_id, rows)

    # 6. คืนค่าผลลัพธ์รูปแบบ Swagger
    data = build_claims(conn, [claim_id])[0]
    result = ok(201, data)
    conn.commit()

    return result