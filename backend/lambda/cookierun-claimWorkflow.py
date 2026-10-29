"""
Lambda Function: cookierun-claimWorkflow
รองรับ Endpoints เกี่ยวกับ Workflow ฝั่งผู้ใช้ใน V3:
  1. PUT /claims/{id}/print-method  -> update_print_method (เปลี่ยนช่องทางยื่น)
  2. GET /claims/{id}/actions       -> list_claim_actions (ดูประวัติการดำเนินการ)
  3. POST /claims/{id}/cancel       -> cancel_claim (ผู้ขอยกเลิกคำขอ submitted -> draft) 

Lambda URI ใน openapi.yaml: cookierun-claimWorkflow
"""
import os
from db import run_auth, ok, parse_json_body, ApiError, to_utc_z
from validation import (
    ACTIONS_COLUMNS,
    ACTIONS_TABLE,
    STATUS_KEY_BY_NAME,
    actions_enabled,
    apply_transition,
    load_owned_claim,
    log_action,
    parse_print_method,
    path_claim_id,
    print_method_key,
    print_status_id,
    status_key,
    ACTION_PRINT_METHOD_CHANGED,
)


def lambda_handler(event, context):
    return run_auth(event, lambda conn, auth: _route_workflow(conn, auth, event))


def _route_workflow(conn, auth, event):
    path = (event.get("requestContext") or {}).get("http", {}).get("path") or ""
    method = (
        event.get("httpMethod")
        or (event.get("requestContext") or {}).get("http", {}).get("method")
        or ""
    ).upper()

    # Route 1: PUT /claims/{id}/print-method
    if method == "PUT" and path.endswith("/print-method"):
        return _update_print_method(conn, auth, event)

    # Route 2: GET /claims/{id}/actions
    if method == "GET" and path.endswith("/actions"):
        return _list_claim_actions(conn, auth, event)

    # Route 3: POST /claims/{id}/cancel (FIX-04)
    if method == "POST" and path.endswith("/cancel"):
        return _cancel_claim(conn, auth, event)

    raise ApiError(404, "ไม่พบ Route ที่เรียก")


# ---------------------------------------------------------------- Handlers
def _update_print_method(conn, auth, event):
    """PUT /claims/{id}/print-method: เปลี่ยนช่องทางยื่นเอกสาร (self_print -> sign_with_staff)
    เปลี่ยนได้จนกว่าเจ้าหน้าที่จะตรวจเสร็จ (ต้องไม่อยู่ในสถานะสิ้นสุดแล้ว)"""
    user_id = auth["userId"]
    claim_id = path_claim_id(event)
    body = parse_json_body(event)

    # 1. ตรวจสอบสิทธิ์เจ้าของคำขอ
    claim = load_owned_claim(conn, claim_id, user_id, for_update=True)

    # 2. ตรวจสอบรูปแบบ printMethod ที่ส่งมา
    new_method = parse_print_method(body.get("printMethod"))
    new_status_id = print_status_id(new_method)

    old_method = print_method_key(claim["printStatus"])

    # 3. อัปเดต printStatus ลงตาราง claims
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE claims SET printStatus = %s WHERE claimId = %s",
            (new_status_id, claim_id),
        )

    # 4. บันทึกประวัติลง claims_histories (ถ้าเปิดใช้งาน)
    log_action(
        conn,
        claim_id=claim_id,
        actor_user_id=user_id,
        action=ACTION_PRINT_METHOD_CHANGED,
        from_status_id=claim["statusId"],
        to_status_id=claim["statusId"],
        note=f"เปลี่ยนช่องทางยื่นจาก {old_method or 'ยังไม่เลือก'} เป็น {new_method}",
    )

    conn.commit()

    return ok(
        200,
        {
            "message": "เปลี่ยนช่องทางยื่นสำเร็จ",
            "claimId": f"c{claim_id:03d}",
            "printMethod": new_method,
        },
    )


def _list_claim_actions(conn, auth, event):
    """GET /claims/{id}/actions: ประวัติการดำเนินการของคำขอ (จาก claims_histories)
    ผู้ใช้ทั่วไปเห็นเฉพาะคำขอของตนเอง"""
    user_id = auth["userId"]
    claim_id = path_claim_id(event)

    # 1. ตรวจสอบความเป็นเจ้าของคำขอ (ไม่ใช่เจ้าของจะตอบ 403/404)
    load_owned_claim(conn, claim_id, user_id)

    # 2. ตรวจสอบว่าระบบเปิดใช้งาน Audit Log หรือยัง
    if not actions_enabled():
        return ok(200, [])

    c = ACTIONS_COLUMNS
    id_col = f", ca.{c['id']}" if c.get("id") else ""
    sql = f"""
        SELECT 
            ca.{c['action']} AS action,
            s_from.statusName AS fromStatusName,
            s_to.statusName AS toStatusName,
            CONCAT(u.name, ' ', u.lastName) AS actorName,
            ca.{c['note']} AS note,
            ca.{c['at']} AS createdAt
        FROM {ACTIONS_TABLE} ca
        LEFT JOIN `status` s_from ON s_from.statusId = ca.{c['from']}
        LEFT JOIN `status` s_to ON s_to.statusId = ca.{c['to']}
        LEFT JOIN user_information u ON u.userId = ca.{c['actor']}
        WHERE ca.{c['claim']} = %s
        ORDER BY ca.{c['at']} ASC{id_col}
    """

    with conn.cursor() as cur:
        try:
            cur.execute(sql, (claim_id,))
            rows = cur.fetchall()
        except Exception:
            return ok(200, [])

    # 3. จัดรูปแบบ Response ให้อยู่ในโครงสร้างตาม openapi.yaml
    actions_data = []
    for r in rows:
        actions_data.append(
            {
                "action": r["action"],
                "fromStatus": status_key(r["fromStatusName"]) if r["fromStatusName"] else None,
                "toStatus": status_key(r["toStatusName"]) if r["toStatusName"] else None,
                "actor": r["actorName"] or "ระบบ",
                "note": r["note"],
                "createdAt": to_utc_z(r["createdAt"]),
            }
        )

    return ok(200, actions_data)


# FIX-04: POST /claims/{id}/cancel
def _cancel_claim(conn, auth, event):
    """POST /claims/{id}/cancel: ผู้ขอยกเลิกคำขอตนเอง (submitted -> draft)"""
    user_id = auth["userId"]
    claim_id = path_claim_id(event)
    body = parse_json_body(event)

    # 1. ตรวจสอบความเป็นเจ้าของคำขอ
    load_owned_claim(conn, claim_id, user_id, for_update=True)

    reason = body.get("reason")
    if reason and not isinstance(reason, str):
        raise ApiError(400, "reason ต้องเป็นข้อความ")

    # 2. เปลี่ยนสถานะ submitted -> draft
    result = apply_transition(
        conn,
        claim_id=claim_id,
        action="cancel",
        actor_user_id=user_id,
        actor_is_admin=False,
        note=reason.strip() if reason else None,
    )

    conn.commit()

    return ok(
        200,
        {
            "message": "ยกเลิกคำขอสำเร็จ คำขอกลับเป็นร่าง",
            "claimId": f"c{claim_id:03d}",
            "from": result["from"],
            "to": result["to"],
        },
    )