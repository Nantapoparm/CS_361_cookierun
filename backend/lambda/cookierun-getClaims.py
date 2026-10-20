from db import run_auth, ok, ApiError
from validation import (
    STATUS_DRAFT,
    parse_term,
    parse_int,
    build_claims,
    status_filter,
)


def lambda_handler(event, context):
    return run_auth(event, lambda conn, auth: _list(conn, auth, event))


def _list(conn, auth, event):
    user_id = auth["userId"]
    is_admin = auth["isAdmin"]
    params = event.get("queryStringParameters") or {}

    # 1. ตรวจสอบสิทธิ์กรณีมีการส่ง userId ใน Query String
    q_user = params.get("userId")
    if q_user not in (None, "") and str(q_user) != str(user_id) and not is_admin:
        raise ApiError(403, "ไม่มีสิทธิ์ดูคำขอของผู้ใช้อื่น")

    # หากระบุ q_user และเป็น admin ให้ค้นหาตาม q_user ได้
    target_user_id = q_user if (q_user and is_admin) else user_id

    sql = "SELECT c.claimId FROM claims c WHERE c.userId = %s"
    args = [target_user_id]

    status_id = params.get("statusId")
    status = (params.get("status") or "").strip().lower()

    # 2. กรองตามสถานะคำขอ (Status Filter)
    if status_id not in (None, ""):
        sql += " AND c.statusId = %s"
        args.append(parse_int(status_id, "statusId"))
    elif status:
        if status == "draft":
            sql += " AND c.statusId = %s"
            args.append(STATUS_DRAFT)
        elif status == "submitted":
            # V3: submitted ใน Query String ของหน้าฝั่งผู้ใช้ หมายถึงคำขอที่ยื่นแล้วทั้งหมด (ไม่ใช่ draft)
            sql += " AND c.statusId <> %s"
            args.append(STATUS_DRAFT)
        else:
            # รองรับการส่งชื่อสถานะแบบเจาะจงใน V3 เช่น approved, returned ฯลฯ
            try:
                st_sql, st_args = status_filter(status)
                sql += f" AND {st_sql}"
                args.extend(st_args)
            except ApiError:
                raise ApiError(400, "status ไม่ถูกต้อง")

    # 3. กรองตามภาคการศึกษา (Term Filter)
    term = params.get("term")
    if term not in (None, ""):
        semester, year = parse_term(term)
        sql += """ AND (
            EXISTS (
                SELECT 1 FROM work_information w
                JOIN course_offerings co ON co.offeringId = w.offeringId
                WHERE w.claimId = c.claimId
                  AND co.semester = %s AND co.academicYear = %s)
            OR NOT EXISTS (
                SELECT 1 FROM work_information w3
                WHERE w3.claimId = c.claimId AND w3.offeringId IS NOT NULL)
        )"""
        args += [semester, year]

    sql += " ORDER BY c.claimId DESC"

    # 4. ดึงข้อมูลคำขอจาก DB
    with conn.cursor() as cur:
        cur.execute(sql, args)
        ids = [r["claimId"] for r in cur.fetchall()]

    # 5. ประกอบร่างข้อมูลรูปแบบ Swagger และคืนค่า
    return ok(200, build_claims(conn, ids))