from db import run_auth, ok, fail, parse_json_body, ApiError, now_bangkok
from validation import (
    STATUS_NAME_BY_KEY,
    apply_transition,
    build_claims,
    load_claim_any,
    log_action,
    parse_claim_id,
    path_claim_id,
    status_filter,
    status_id_by_name,
    status_key,
    ACTION_PRINTED,
)


def lambda_handler(event, context):
    """ใช้ run_auth พร้อม admin_only=True ตรวจสิทธิ์ admin อัตโนมัติ"""
    return run_auth(event, lambda conn, auth: _route_admin(conn, auth, event), admin_only=True)


def _route_admin(conn, auth, event):
    route_key = event.get("routeKey") or ""
    path = (event.get("requestContext") or {}).get("http", {}).get("path") or ""
    method = (
        event.get("httpMethod")
        or (event.get("requestContext") or {}).get("http", {}).get("method")
        or ""
    ).upper()

    # Route 1: POST /admin/claims/send-to-finance
    if method == "POST" and path.endswith("/admin/claims/send-to-finance"):
        return _admin_send_to_finance(conn, auth, event)

    # Route 2: GET /admin/claims
    if method == "GET" and path == "/admin/claims":
        return _admin_list_claims(conn, auth, event)

    # Route 3: POST /admin/claims/{id}/review
    if method == "POST" and path.endswith("/review"):
        return _admin_review_claim(conn, auth, event)

    # Route 4: POST /admin/claims/{id}/printed
    if method == "POST" and path.endswith("/printed"):
        return _admin_mark_printed(conn, auth, event)

    # Route 5: POST /admin/claims/{id}/documents-received
    if method == "POST" and path.endswith("/documents-received"):
        return _admin_documents_received(conn, auth, event)

    # Route 6: GET /admin/claims/{id}
    if method == "GET" and "/admin/claims/" in path:
        return _admin_get_claim(conn, auth, event)

    raise ApiError(404, "ไม่พบ Route ที่เรียก")


# ---------------------------------------------------------------- Handlers
def _admin_list_claims(conn, auth, event):
    """GET /admin/claims: ดึงคำขอทั้งหมด พร้อมนับจำนวนแยกตามสถานะ (AD1, AD2)"""
    params = event.get("queryStringParameters") or {}
    role_filter = params.get("role")
    status_param = params.get("status")
    month_filter = params.get("month")  # YYYY-MM
    offering_filter = params.get("offeringId")
    print_method_filter = params.get("printMethod")
    search_q = params.get("q")

    # 1. นับจำนวนแยกตามสถานะ (counts)
    counts = {}
    with conn.cursor() as cur:
        cur.execute(
            """SELECT s.statusName, COUNT(c.claimId) AS cnt
               FROM claims c
               JOIN `status` s ON s.statusId = c.statusId
               GROUP BY s.statusName"""
        )
        for r in cur.fetchall():
            key = status_key(r["statusName"])
            counts[key] = int(r["cnt"])

    # 2. ค้นหาแบบมีตัวกรอง
    where_clauses = ["1=1"]
    args = []

    if status_param:
        sql_st, st_args = status_filter(status_param)
        where_clauses.append(sql_st)
        args.extend(st_args)

    if month_filter:
        where_clauses.append("DATE_FORMAT(c.dayClaim, '%%Y-%%m') = %s")
        args.append(month_filter)

    if search_q:
        where_clauses.append(
            "(u.name LIKE %s OR u.lastName LIKE %s OR CAST(c.claimId AS CHAR) LIKE %s)"
        )
        q_like = f"%{search_q.strip()}%"
        q_id = search_q.strip().lstrip("cC")
        args.extend([q_like, q_like, f"%{q_id}%"])

    sql = f"""
        SELECT DISTINCT c.claimId
        FROM claims c
        JOIN user_information u ON u.userId = c.userId
        JOIN user_role r ON r.roleId = u.roleId
        LEFT JOIN work_information w ON w.claimId = c.claimId
        WHERE {" AND ".join(where_clauses)}
        ORDER BY c.claimId DESC
    """

    with conn.cursor() as cur:
        cur.execute(sql, args)
        claim_ids = [r["claimId"] for r in cur.fetchall()]

    claims_data = build_claims(conn, claim_ids)

    # 3. กรองเพิ่มใน Python สำหรับฟิลด์ย่อย (role, offering, printMethod)
    filtered = []
    for cl in claims_data:
        if role_filter and cl["role"] != role_filter:
            continue
        if print_method_filter and cl["printMethod"] != print_method_filter:
            continue
        filtered.append(cl)

    return ok(200, {"counts": counts, "items": filtered})


def _admin_get_claim(conn, auth, event):
    """GET /admin/claims/{id}: ดูรายละเอียดคำขอสำหรับตรวจ (AD3)"""
    claim_id = path_claim_id(event)

    # ตรวจสอบว่ามีคำขออยู่จริง
    load_claim_any(conn, claim_id)

    claims = build_claims(conn, [claim_id])
    if not claims:
        raise ApiError(404, "ไม่พบคำขอ")

    return ok(200, claims[0])


def _admin_review_claim(conn, auth, event):
    """POST /admin/claims/{id}/review: อนุมัติ (approve), ไม่อนุมัติ (reject), หรือส่งกลับแก้ไข (return) (AD4)"""
    claim_id = path_claim_id(event)
    body = parse_json_body(event)

    decision = str(body.get("decision") or "").strip().lower()
    note = body.get("note")
    work_ids = body.get("workIds")  # รายการ workId ที่ต้องแก้ (กรณี return)

    if decision not in ("approve", "reject", "return"):
        raise ApiError(400, "decision ต้องเป็น 'approve', 'reject' หรือ 'return'")

    # ปรับ action ให้ตรงกับ State Machine ใน validation.py
    action_map = {"approve": "approve", "reject": "reject", "return": "return"}
    action = action_map[decision]

    # ถ้าเลือก return สามารถระบุหมายเหตุพร้อมแนบ workIds
    final_note = note
    if decision == "return" and work_ids and isinstance(work_ids, list):
        ids_str = ",".join(str(wid) for wid in work_ids)
        final_note = f"{note or ''} [workIds:{ids_str}]".strip()

    # เปลี่ยนสถานะคำขอผ่าน State Machine กลาง
    result = apply_transition(
        conn,
        claim_id=claim_id,
        action=action,
        actor_user_id=auth["userId"],
        actor_is_admin=True,
        note=final_note,
    )

    conn.commit()
    return ok(200, {"message": f"เปลี่ยนสถานะสำเร็จเป็น {result['to']}"})


def _admin_mark_printed(conn, auth, event):
    """POST /admin/claims/{id}/printed: บันทึกว่าเจ้าหน้าที่พิมพ์เอกสารแล้ว (AD5)"""
    claim_id = path_claim_id(event)

    claim = load_claim_any(conn, claim_id)

    # บันทึกกิจกรรมลง audit log (claim_actions)
    log_action(
        conn,
        claim_id=claim_id,
        actor_user_id=auth["userId"],
        action=ACTION_PRINTED,
        from_status_id=claim["statusId"],
        to_status_id=claim["statusId"],
        note="เจ้าหน้าที่พิมพ์เอกสารเรียบร้อยแล้ว",
    )

    conn.commit()
    return ok(200, {"message": "บันทึกสถานะการพิมพ์สำเร็จ"})


def _admin_documents_received(conn, auth, event):
    """POST /admin/claims/{id}/documents-received: รับเอกสารฉบับเซ็นชื่อแล้ว (approved -> documents_received) (AD5, AD7)"""
    claim_id = path_claim_id(event)

    result = apply_transition(
        conn,
        claim_id=claim_id,
        action="receive_documents",
        actor_user_id=auth["userId"],
        actor_is_admin=True,
    )

    conn.commit()
    return ok(200, {"message": f"เปลี่ยนสถานะสำเร็จเป็น {result['to']}"})


def _admin_send_to_finance(conn, auth, event):
    """POST /admin/claims/send-to-finance: ส่งการเงินเป็นชุด (documents_received -> sent_to_finance) (AD6)"""
    body = parse_json_body(event)
    raw_ids = body.get("claimIds")

    if not raw_ids or not isinstance(raw_ids, list):
        raise ApiError(400, "claimIds ต้องเป็น array ของรหัสคำขอ")

    claim_ids = [parse_claim_id(cid) for cid in raw_ids]

    # เปลี่ยนสถานะทีละใบผ่าน State Machine
    updated_ids = []
    for cid in claim_ids:
        apply_transition(
            conn,
            claim_id=cid,
            action="send_to_finance",
            actor_user_id=auth["userId"],
            actor_is_admin=True,
        )
        updated_ids.append(f"c{cid:03d}")

    conn.commit()
    return ok(
        200,
        {
            "message": f"ส่งการเงินสำเร็จจำนวน {len(updated_ids)} รายการ",
            "updatedClaims": updated_ids,
        },
    )