"""
Lambda Function: cookierun-admin
รองรับ Endpoints ฝั่ง เจ้าหน้าที่ (Admin) ใน V3
"""
import logging
import re
from datetime import date

from db import run_auth, ok, parse_json_body, ApiError
from validation import (
    ACTION_PRINTED,
    STATUS_NAME_BY_KEY,
    STATUS_DRAFT,
    action_stats,
    apply_transition,
    build_claims,
    load_claim_any,
    log_action,
    parse_claim_id,
    parse_int,
    path_claim_id,
    status_key,
)

logger = logging.getLogger()

MONTH_RE = re.compile(r"(\d{4})-(0[1-9]|1[0-2])")
MAX_REVIEW_NOTE_LENGTH = 500


def lambda_handler(event, context):
    return run_auth(event, lambda conn, auth: _route_admin(conn, auth, event), admin_only=True)


def _request_path(event):
    http = (event.get("requestContext") or {}).get("http") or {}
    path = http.get("path") or event.get("rawPath") or event.get("path") or ""
    return path.rstrip("/")


def _route_admin(conn, auth, event):
    path = _request_path(event)
    method = (
        event.get("httpMethod")
        or ((event.get("requestContext") or {}).get("http") or {}).get("method")
        or ""
    ).upper()

    # FIX-03: POST /admin/claims/mark-paid
    if method == "POST" and path.endswith("/admin/claims/mark-paid"):
        return _admin_mark_paid(conn, auth, event)

    if method == "POST" and path.endswith("/admin/claims/send-to-finance"):
        return _admin_send_to_finance(conn, auth, event)

    if method == "GET" and path.endswith("/admin/claims"):
        return _admin_list_claims(conn, auth, event)

    if method == "POST" and path.endswith("/review"):
        return _admin_review_claim(conn, auth, event)

    if method == "POST" and path.endswith("/printed"):
        return _admin_mark_printed(conn, auth, event)

    if method == "POST" and path.endswith("/documents-received"):
        return _admin_documents_received(conn, auth, event)

    # FIX-04: POST /admin/claims/{id}/cancel
    if method == "POST" and path.endswith("/cancel"):
        return _admin_cancel_claim(conn, auth, event)

    # GET /admin/claims/{id} (ไม่รวม path ย่อยอื่น)
    if method == "GET" and re.search(r"/admin/claims/[^/]+$", path):
        return _admin_get_claim(conn, auth, event)

    raise ApiError(404, "ไม่พบ Route ที่เรียก")


def _month_range(value):
    """'2026-10' -> (2026-10-01, 2026-11-01) ไม่ตรงรูปแบบ -> 400"""
    m = MONTH_RE.fullmatch(str(value).strip())
    if not m:
        raise ApiError(400, "month ต้องเป็นรูปแบบ YYYY-MM")
    y, mo = int(m.group(1)), int(m.group(2))
    return date(y, mo, 1), date(y + (mo == 12), mo % 12 + 1, 1)


# ---------------------------------------------------------------- Handlers
def _admin_list_claims(conn, auth, event):
    """GET /admin/claims: รายการคำขอ + counts ตามสถานะ (ไม่รวม Draft)"""
    params = event.get("queryStringParameters") or {}
    role_filter = (params.get("role") or "").strip().lower()
    status_param = (params.get("status") or "").strip().lower()
    month_filter = params.get("month")  # YYYY-MM = เดือนที่ทำงาน (workDate)
    offering_filter = params.get("offeringId")
    print_method_filter = params.get("printMethod")
    search_q = (params.get("q") or "").strip()

    # FIX-04: กรอง Draft ออกเสมอฝั่งเจ้าหน้าที่
    draft_exclude_sql = f"c.statusId <> {STATUS_DRAFT}"

    month_sql, month_args = "", []
    if month_filter:
        start, end = _month_range(month_filter)
        month_sql = (
            "EXISTS (SELECT 1 FROM work_information wm WHERE wm.claimId = c.claimId "
            "AND wm.workDate >= %s AND wm.workDate < %s)"
        )
        month_args = [start, end]

    # 1) counts (ไม่นับ Draft)
    counts_where = [draft_exclude_sql]
    counts_args = []
    if month_sql:
        counts_where.append(month_sql)
        counts_args.extend(month_args)

    counts_sql = (
        "SELECT s.statusName, COUNT(c.claimId) AS cnt "
        "FROM claims c JOIN `status` s ON s.statusId = c.statusId "
        f"WHERE {' AND '.join(counts_where)} "
        "GROUP BY s.statusName"
    )
    counts = {}
    with conn.cursor() as cur:
        cur.execute(counts_sql, counts_args)
        for r in cur.fetchall():
            counts[status_key(r["statusName"])] = int(r["cnt"])

    # 2) รายการคำขอ (ไม่ดึง Draft)
    where, args = [draft_exclude_sql], []
    if month_sql:
        where.append(month_sql)
        args.extend(month_args)

    if status_param:
        name = STATUS_NAME_BY_KEY.get(status_param)
        if name is None:
            raise ApiError(400, f"status ต้องเป็นหนึ่งใน: {', '.join(STATUS_NAME_BY_KEY)}")
        where.append("c.statusId = (SELECT statusId FROM `status` WHERE statusName = %s)")
        args.append(name)

    if offering_filter:
        if not str(offering_filter).isdigit():
            raise ApiError(400, "offeringId ต้องเป็นจำนวนเต็ม")
        where.append(
            "EXISTS (SELECT 1 FROM work_information wo WHERE wo.claimId = c.claimId "
            "AND wo.offeringId = %s)"
        )
        args.append(int(offering_filter))

    if search_q:
        like = f"%{search_q}%"
        digits = re.fullmatch(r"[cC]?(\d+)", search_q)
        cond = "u.name LIKE %s OR u.lastName LIKE %s OR CONCAT(u.name, ' ', u.lastName) LIKE %s"
        args.extend([like, like, like])
        if digits:
            cond += " OR c.claimId = %s"
            args.append(int(digits.group(1)))
        where.append(f"({cond})")

    sql = f"""
        SELECT c.claimId
        FROM claims c
        JOIN user_information u ON u.userId = c.userId
        WHERE {" AND ".join(where)}
        ORDER BY c.claimId DESC
    """
    with conn.cursor() as cur:
        cur.execute(sql, args)
        claim_ids = [r["claimId"] for r in cur.fetchall()]

    if not claim_ids:
        return ok(200, {"counts": counts, "items": []})

    items = build_claims(conn, claim_ids)

    # 3) role / printMethod กรองหลัง build
    if role_filter:
        items = [c for c in items if str(c.get("role") or "").lower() == role_filter]
    if print_method_filter:
        items = [c for c in items if c.get("printMethod") == print_method_filter]

    return ok(200, {"counts": counts, "items": items})


def _admin_get_claim(conn, auth, event):
    claim_id = path_claim_id(event)
    load_claim_any(conn, claim_id)  # ไม่พบ = 404
    claims = build_claims(conn, [claim_id], with_actions=True)
    if not claims:
        raise ApiError(404, "ไม่พบคำขอ")
    return ok(200, claims[0])


def _parse_review_work_ids(conn, claim_id, raw):
    if raw is None or raw == []:
        return None
    if not isinstance(raw, list):
        raise ApiError(400, "workIds ต้องเป็น array")
    work_ids = sorted({parse_int(w, "workIds") for w in raw})
    marks = ",".join(["%s"] * len(work_ids))
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT workId FROM work_information WHERE claimId = %s AND workId IN ({marks})",
            (claim_id, *work_ids),
        )
        found = {r["workId"] for r in cur.fetchall()}
    if found != set(work_ids):
        raise ApiError(400, "workIds มีรายการที่ไม่อยู่ในคำขอนี้")
    return work_ids


def _admin_review_claim(conn, auth, event):
    claim_id = path_claim_id(event)
    body = parse_json_body(event)

    decision = str(body.get("decision") or "").strip().lower()
    if decision not in ("approve", "reject", "return"):
        raise ApiError(400, "decision ต้องเป็น 'approve', 'reject' หรือ 'return'")

    note = body.get("note")
    if note is not None and not isinstance(note, str):
        raise ApiError(400, "note ต้องเป็นข้อความ")
    if note and len(note.strip()) > MAX_REVIEW_NOTE_LENGTH:
        raise ApiError(400, f"note ยาวเกิน {MAX_REVIEW_NOTE_LENGTH} ตัวอักษร")

    work_ids = None
    if decision in ("return", "reject"):
        work_ids = _parse_review_work_ids(conn, claim_id, body.get("workIds"))

    result = apply_transition(
        conn, claim_id=claim_id, action=decision,
        actor_user_id=auth["userId"], actor_is_admin=True,
        note=note, work_ids=work_ids,
    )
    conn.commit()
    return ok(200, {"message": f"เปลี่ยนสถานะสำเร็จเป็น {result['to']}", **result})


def _admin_mark_printed(conn, auth, event):
    claim_id = path_claim_id(event)
    claim = load_claim_any(conn, claim_id)
    if (action_stats(conn, [claim_id]).get(claim_id) or {}).get("printedAt"):
        raise ApiError(409, "คำขอนี้ถูกบันทึกว่าพิมพ์แล้ว")
    log_action(
        conn, claim_id, auth["userId"], ACTION_PRINTED,
        from_status_id=claim["statusId"], to_status_id=claim["statusId"],
        note="เจ้าหน้าที่พิมพ์เอกสารเรียบร้อยแล้ว",
    )
    conn.commit()
    return ok(200, {"message": "บันทึกสถานะการพิมพ์สำเร็จ"})


def _admin_documents_received(conn, auth, event):
    claim_id = path_claim_id(event)
    result = apply_transition(
        conn, claim_id=claim_id, action="receive_documents",
        actor_user_id=auth["userId"], actor_is_admin=True,
    )
    conn.commit()
    return ok(200, {"message": f"เปลี่ยนสถานะสำเร็จเป็น {result['to']}", **result})


def _admin_send_to_finance(conn, auth, event):
    body = parse_json_body(event)
    raw_ids = body.get("claimIds")
    if not raw_ids or not isinstance(raw_ids, list):
        raise ApiError(400, "claimIds ต้องเป็น array ของรหัสคำขอ")

    claim_ids = list(dict.fromkeys(parse_claim_id(c) for c in raw_ids))
    for cid in claim_ids:
        apply_transition(
            conn, claim_id=cid, action="send_to_finance",
            actor_user_id=auth["userId"], actor_is_admin=True,
        )
    conn.commit()
    return ok(200, {
        "message": f"ส่งการเงินสำเร็จจำนวน {len(claim_ids)} รายการ",
        "updatedClaims": [f"c{cid:03d}" for cid in claim_ids],
    })


# FIX-03: POST /admin/claims/mark-paid
def _admin_mark_paid(conn, auth, event):
    body = parse_json_body(event)
    raw_ids = body.get("claimIds")
    if not raw_ids or not isinstance(raw_ids, list):
        raise ApiError(400, "claimIds ต้องเป็น array ของรหัสคำขอ")

    claim_ids = list(dict.fromkeys(parse_claim_id(c) for c in raw_ids))
    for cid in claim_ids:
        apply_transition(
            conn, claim_id=cid, action="mark_paid",
            actor_user_id=auth["userId"], actor_is_admin=True,
        )
    conn.commit()
    return ok(200, {
        "message": f"บันทึกเงินเข้าสำเร็จจำนวน {len(claim_ids)} รายการ",
        "updatedClaims": [f"c{cid:03d}" for cid in claim_ids],
    })


# FIX-04: POST /admin/claims/{id}/cancel
def _admin_cancel_claim(conn, auth, event):
    claim_id = path_claim_id(event)
    body = parse_json_body(event)
    note = body.get("note")

    if not note or not isinstance(note, str) or not note.strip():
        raise ApiError(400, "ต้องระบุหมายเหตุการยกเลิก")

    result = apply_transition(
        conn, claim_id=claim_id, action="admin_cancel",
        actor_user_id=auth["userId"], actor_is_admin=True,
        note=note.strip(),
    )
    conn.commit()
    return ok(200, {"message": f"เปลี่ยนสถานะสำเร็จเป็น {result['to']}", **result})