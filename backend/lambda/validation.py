import json
import logging
import os
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from db import ApiError, to_utc_z, now_bangkok, role_key_from_name

logger = logging.getLogger()

STATUS_DRAFT = 1
STATUS_PENDING = 2
STATUS_APPROVED = 3
STATUS_REJECTED = 4
STATUS_RETURNED = 5

# คำขอที่ "ยื่นแล้วและยังไม่ถูกปฏิเสธ" = ทุกสถานะยกเว้นสองตัวนี้ (เทียบด้วยชื่อ เพื่อให้รวมสถานะใหม่ของ V3 ด้วย)
INACTIVE_STATUS_NAMES = ("Draft", "Rejected")

MAX_MINUTES_PER_ITEM = 24 * 60 - 1  # CHECK เดิม: endTime ต้องน้อยกว่า 24:00:00
MAX_NOTE_LENGTH = 50  # work_information.Remark เป็น VARCHAR(50)

# status.statusName (ตัวพิมพ์เล็ก) <-> key ที่ API / หน้าเว็บใช้
STATUS_KEY_BY_NAME = {
    "draft": "draft",
    "pending review": "submitted",
    "approved": "approved",
    "rejected": "rejected",
    "returned for revision": "returned",
    "documents received": "documents_received",
    "sent to finance": "sent_to_finance",
}
STATUS_NAME_BY_KEY = {
    "draft": "Draft",
    "submitted": "Pending Review",
    "approved": "Approved",
    "rejected": "Rejected",
    "returned": "Returned for Revision",
    "documents_received": "Documents Received",
    "sent_to_finance": "Sent to Finance",
}

# กฎรอบเบิกไม่มีตารางรองรับแล้ว: ค่าเริ่มต้นตามตัวอย่างใน Swagger
# ปรับได้ด้วย env BILLING_CYCLES_JSON (JSON array รูปแบบเดียวกัน)
DEFAULT_BILLING_CYCLES = [
    {"cycle": 1, "description": "ส่งเอกสารภายในวันที่ 5 ของเดือนถัดไป", "lastDay": 5},
    {"cycle": 2, "description": "ส่งเอกสารระหว่างวันที่ 6 ถึง 10", "startDay": 6, "lastDay": 10},
]


# ---------------------------------------------------------------- config / mapping
def default_term():
    return os.environ.get("TERM_ID", "1-2569")


def session_name():
    return os.environ.get("SESSION_NAME", "normal")


def billing_cycles():
    raw = os.environ.get("BILLING_CYCLES_JSON")
    if raw:
        try:
            return json.loads(raw)
        except ValueError:
            pass
    return DEFAULT_BILLING_CYCLES


def role_key(role_name):
    """user_role.roleName -> instructor / ta / student_helper / admin (ใช้ตัวเดียวกับ db.py)"""
    return role_key_from_name(role_name)


def status_key(status_name):
    """status.statusName -> key ของ API (draft/submitted/returned/approved/rejected/
    documents_received/sent_to_finance)"""
    name = str(status_name or "").strip().lower()
    return STATUS_KEY_BY_NAME.get(name) or re.sub(r"\W+", "_", name)


def status_filter(key):
    """key ของ API -> (SQL, args) สำหรับกรอง claims (alias c) ตามชื่อสถานะ ไม่ต้อง JOIN status
    หมายเหตุ V3: submitted = Pending Review เท่านั้น (ไม่ใช่ทุกสถานะที่ไม่ใช่ draft เหมือน V2)"""
    name = STATUS_NAME_BY_KEY.get(str(key or "").strip().lower())
    if name is None:
        raise ApiError(400, f"status ต้องเป็นหนึ่งใน: {', '.join(STATUS_NAME_BY_KEY)}")
    return "c.statusId = (SELECT statusId FROM `status` WHERE statusName = %s)", [name]


def year_offset():
    """ส่วนต่างระหว่างปีใน term กับ academicYear ใน DB (ค่าเริ่มต้น 0 = เก็บตรงกับ term เช่น 2569)
    ถ้า DB เก็บเป็น ค.ศ. (2026) ให้ตั้ง env ACADEMIC_YEAR_OFFSET=543"""
    try:
        return int(os.environ.get("ACADEMIC_YEAR_OFFSET", "0"))
    except ValueError:
        return 0


def parse_term(value):
    """'2-2569' -> (semester=2, academicYear ใน DB) ตัวหน้า = ภาค ตัวหลัง = ปีการศึกษา"""
    m = re.fullmatch(r"([1-3])-(\d{4})", str(value).strip())
    if not m:
        raise ApiError(400, "term ต้องเป็นรูปแบบ ภาค-ปี เช่น 1-2569")
    return int(m.group(1)), int(m.group(2)) - year_offset()


def term_label(semester, academic_year):
    return f"{semester}-{academic_year + year_offset()}"


def user_key_prefix(user_id):
    return "uploads/" + re.sub(r"[^A-Za-z0-9_-]", "_", user_id) + "/"


# ---------------------------------------------------------------- print method (claims.printStatus)
PRINT_METHODS = ("sign_with_staff", "self_print")
_PRINT_ENV = {
    "sign_with_staff": "PRINT_STATUS_SIGN_WITH_STAFF_ID",
    "self_print": "PRINT_STATUS_SELF_PRINT_ID",
}


def parse_print_method(value):
    """ตรวจ printMethod จาก request (ไม่ส่ง/ผิด -> 400)"""
    if not isinstance(value, str) or value.strip() not in PRINT_METHODS:
        raise ApiError(400, f"printMethod ต้องเป็น {' หรือ '.join(PRINT_METHODS)}")
    return value.strip()


def print_status_id(method):
    """printMethod -> print_status.statusId (ตั้งค่าผ่าน env ให้ตรงกับตาราง print_status)"""
    raw = os.environ.get(_PRINT_ENV[method])
    if not raw or not raw.strip().isdigit():
        raise ApiError(500, f"ยังไม่ได้ตั้งค่า {_PRINT_ENV[method]}", code="INTERNAL_ERROR")
    return int(raw.strip())


def print_method_key(print_status):
    """claims.printStatus (id) -> printMethod หรือ None ถ้ายังไม่ได้เลือก/ไม่ได้ตั้ง env"""
    if print_status is None:
        return None
    for method, env_name in _PRINT_ENV.items():
        raw = os.environ.get(env_name)
        if raw and raw.strip().isdigit() and int(raw.strip()) == int(print_status):
            return method
    return None


# ---------------------------------------------------------------- parsing
def parse_int(value, field):
    if isinstance(value, bool) or value is None:
        raise ApiError(400, f"{field} ต้องเป็นจำนวนเต็ม")
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and re.fullmatch(r"\d+", value.strip()):
        return int(value.strip())
    raise ApiError(400, f"{field} ต้องเป็นจำนวนเต็ม")


def parse_number(value, field):
    if isinstance(value, bool) or value is None:
        raise ApiError(400, f"{field} ต้องเป็นตัวเลข")
    try:
        number = Decimal(str(value).strip())
    except InvalidOperation:
        raise ApiError(400, f"{field} ต้องเป็นตัวเลข")
    if not number.is_finite():
        raise ApiError(400, f"{field} ต้องเป็นตัวเลข")
    return number


def parse_claim_id(value):
    """รับ "c003" หรือ "3" (หรือจำนวนเต็ม) -> int ถ้า parse ไม่ได้ -> 404 (ใช้กับ claimIds ใน body)"""
    m = re.fullmatch(r"c?(\d+)", str(value).strip().lower())
    if not m:
        raise ApiError(404, "ไม่พบคำขอ")
    return int(m.group(1))


def path_claim_id(event):
    """รับได้ทั้ง "c003" และ "3" (ถ้า parse ไม่ได้ -> 404)"""
    return parse_claim_id((event.get("pathParameters") or {}).get("id") or "")


def parse_date(value, field):
    if not isinstance(value, str):
        raise ApiError(400, f"{field} ต้องเป็นวันที่รูปแบบ YYYY-MM-DD")
    try:
        return datetime.strptime(value.strip(), "%Y-%m-%d").date()
    except ValueError:
        raise ApiError(400, f"{field} ต้องเป็นวันที่รูปแบบ YYYY-MM-DD")


def to_work_time(hours, minutes=None):
    """hours เป็นตัวเลขทศนิยมได้ (2.5 = 2 ชม. 30 นาที) minutes เพิ่มได้ (ไม่บังคับ)
    คืน (hours ทศนิยม 2 ตำแหน่ง, startTime, endTime) โดย startTime = 00:00:00 เป็น placeholder"""
    h = parse_number(hours, "hours")
    m = 0 if minutes is None else parse_int(minutes, "minutes")
    if h < 0 or not 0 <= m <= 59:
        raise ApiError(400, "hours ต้องมากกว่า 0 และ minutes ต้องอยู่ระหว่าง 0-59")
    total = int((h * 60).quantize(Decimal(1), ROUND_HALF_UP)) + m
    if total <= 0:
        raise ApiError(400, "hours ต้องมากกว่า 0")
    if total > MAX_MINUTES_PER_ITEM:
        raise ApiError(400, "เวลาทำงานต่อรายการต้องไม่เกิน 23 ชม. 59 นาที")
    hours_dec = (Decimal(total) / Decimal(60)).quantize(Decimal("0.01"), ROUND_HALF_UP)
    return hours_dec, "00:00:00", f"{total // 60:02d}:{total % 60:02d}:00"


# ---------------------------------------------------------------- loaders
def get_user(conn, user_id, for_update=False):
    sql = "SELECT userId, roleId FROM user_information WHERE userId=%s"
    if for_update:
        sql += " FOR UPDATE"
    with conn.cursor() as cur:
        cur.execute(sql, (user_id,))
        row = cur.fetchone()
    if row is None:
        raise ApiError(404, "ไม่พบผู้ใช้นี้ในระบบ")
    return row


def load_claim_any(conn, claim_id, for_update=False):
    """โหลดคำขอโดยไม่ตรวจเจ้าของ (สำหรับ route ของ admin เท่านั้น) ไม่พบ = 404"""
    sql = "SELECT claimId, userId, statusId, dayClaim, printStatus FROM claims WHERE claimId=%s"
    if for_update:
        sql += " FOR UPDATE"
    with conn.cursor() as cur:
        cur.execute(sql, (claim_id,))
        claim = cur.fetchone()
    if claim is None:
        raise ApiError(404, "ไม่พบคำขอ")
    return claim


def load_owned_claim(conn, claim_id, user_id, for_update=False):
    """ไม่พบ=404, ไม่ใช่เจ้าของ=403"""
    claim = load_claim_any(conn, claim_id, for_update=for_update)
    if claim["userId"] != user_id:
        raise ApiError(403, "ไม่มีสิทธิ์เข้าถึงคำขอนี้")
    return claim


def require_draft(claim, message):
    """แก้ไข/ยื่นได้เฉพาะ Draft และ Returned for Revision (ถูกตีกลับต้องแก้แล้วยื่นใหม่ได้)"""
    if claim["statusId"] not in (STATUS_DRAFT, STATUS_RETURNED):
        raise ApiError(409, message)


def get_offering(conn, offering_id):
    with conn.cursor() as cur:
        cur.execute(
            """SELECT offeringId, courseId, academicYear, semester, sessionId
               FROM course_offerings WHERE offeringId=%s""",
            (offering_id,),
        )
        return cur.fetchone()


def get_offering_by_course(conn, course_code, semester, academic_year):
    """หา offering จากรหัสวิชา + ภาค + ปี (ค.ศ.) ใน session ที่ตั้งไว้ (ค่าเริ่มต้น normal)"""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT co.offeringId, co.courseId, co.academicYear, co.semester, co.sessionId
               FROM course_offerings co
               JOIN `session` s ON s.sessionId = co.sessionId
               WHERE co.courseId=%s AND co.semester=%s AND co.academicYear=%s
                 AND s.sessionName=%s""",
            (course_code, semester, academic_year, session_name()),
        )
        return cur.fetchone()


def get_rate(conn, session_id, role_id):
    with conn.cursor() as cur:
        cur.execute(
            """SELECT compensationPerHour FROM compensation_rates
               WHERE sessionId=%s AND roleId=%s""",
            (session_id, role_id),
        )
        return cur.fetchone()


def get_rule(conn, session_id, role_id):
    with conn.cursor() as cur:
        cur.execute(
            """SELECT maxHoursPerTerm, maxAmountPerDay FROM compensation_rules
               WHERE sessionId=%s AND roleId=%s""",
            (session_id, role_id),
        )
        return cur.fetchone()


# ---------------------------------------------------------------- submit checks
def find_already_claimed_date(conn, claim_id, user_id):
    """วันทำงาน+วิชาเดียวกันที่ถูกเบิกไปแล้วในคำขออื่น (ทุกสถานะยกเว้น Draft/Rejected)
    -> คืนวันที่ หรือ None"""
    marks = ",".join(["%s"] * len(INACTIVE_STATUS_NAMES))
    with conn.cursor() as cur:
        cur.execute(
            f"""SELECT w.workDate
                FROM work_information w
                JOIN work_information o
                  ON o.userId = w.userId AND o.offeringId = w.offeringId
                 AND o.workDate = w.workDate AND o.claimId <> w.claimId
                JOIN claims oc ON oc.claimId = o.claimId
                JOIN `status` os ON os.statusId = oc.statusId
                WHERE w.claimId = %s AND w.userId = %s
                  AND os.statusName NOT IN ({marks})
                ORDER BY w.workDate LIMIT 1""",
            (claim_id, user_id, *INACTIVE_STATUS_NAMES),
        )
        row = cur.fetchone()
    return row["workDate"] if row else None


def term_hours_used(conn, user_id, session_id, semester, academic_year, exclude_claim_id):
    """ชั่วโมงที่ผู้ใช้เบิกไปแล้ว (คำขอที่ยื่นแล้วและไม่ถูกปฏิเสธ) ในภาค/ปี/session เดียวกัน"""
    marks = ",".join(["%s"] * len(INACTIVE_STATUS_NAMES))
    with conn.cursor() as cur:
        cur.execute(
            f"""SELECT COALESCE(SUM(w.hours), 0) AS used
                FROM work_information w
                JOIN claims c ON c.claimId = w.claimId
                JOIN `status` st ON st.statusId = c.statusId
                JOIN course_offerings co ON co.offeringId = w.offeringId
                WHERE w.userId = %s AND co.sessionId = %s AND co.semester = %s
                  AND co.academicYear = %s AND st.statusName NOT IN ({marks})
                  AND c.claimId <> %s""",
            (user_id, session_id, semester, academic_year,
             *INACTIVE_STATUS_NAMES, exclude_claim_id),
        )
        return cur.fetchone()["used"]


# ---------------------------------------------------------------- request body validation
def validate_work_items(conn, items, term_value):
    """ตรวจ items จาก Swagger: {date, courseCode, hours, note}
    คืน (rows สำหรับ insert, offering) ทุกแถวต้อง courseCode เดียวกัน
    offering/sessionId หาจาก courseCode + term ฝั่ง server"""
    if not isinstance(items, list):
        raise ApiError(400, "items ต้องเป็น array")
    if not items:
        return [], None

    semester, year = parse_term(term_value)
    prepared, codes = [], {}
    for i, item in enumerate(items, start=1):
        label = f"items[{i}]"
        if not isinstance(item, dict):
            raise ApiError(400, f"{label} ต้องเป็น object")
        try:
            work_date = parse_date(item.get("date", item.get("workDate")), "date")
            code = item.get("courseCode")
            if not isinstance(code, str) or not code.strip():
                raise ApiError(400, "courseCode ต้องระบุ")
            code = code.strip()
            hours_dec, start, end = to_work_time(item.get("hours"), item.get("minutes"))
            note = item.get("note", item.get("remark"))
            if note is not None:
                if not isinstance(note, str):
                    raise ApiError(400, "note ต้องเป็นข้อความ")
                note = note.strip() or None
                if note is not None and len(note) > MAX_NOTE_LENGTH:
                    raise ApiError(400, f"note ยาวเกิน {MAX_NOTE_LENGTH} ตัวอักษร")
        except ApiError as e:
            raise ApiError(400, f"{label}: {e.message}")
        codes.setdefault(code.casefold(), code)
        prepared.append({"workDate": work_date, "hours": hours_dec, "startTime": start,
                         "endTime": end, "remark": note})

    if len(codes) > 1:
        raise ApiError(400, "ทุกรายการในคำขอเดียวกันต้องเป็นวิชา (courseCode) เดียวกัน")
    code = next(iter(codes.values()))
    offering = get_offering_by_course(conn, code, semester, year)
    if offering is None:
        raise ApiError(
            400, f"ไม่พบวิชา {code} ที่เปิดสอนในภาค {term_value} (session {session_name()})"
        )
    for row in prepared:
        row["offeringId"] = offering["offeringId"]
        row["sessionId"] = offering["sessionId"]
    return prepared, offering


def validate_billing_cycle(body):
    """billingCycle ไม่มีที่เก็บใน DB: ตรวจรูปแบบเท่านั้น (ถ้าส่งมา)"""
    if body.get("billingCycle") is not None:
        if parse_int(body["billingCycle"], "billingCycle") < 1:
            raise ApiError(400, "billingCycle ต้องเป็นจำนวนเต็มตั้งแต่ 1")


def write_work_items(conn, claim_id, user_id, rows):
    """แทนที่รายการงานทั้งหมดของ claim"""
    with conn.cursor() as cur:
        cur.execute("DELETE FROM work_information WHERE claimId=%s", (claim_id,))
        for r in rows:
            cur.execute(
                """INSERT INTO work_information
                   (userId, sessionId, offeringId, claimId, workDate,
                    startTime, endTime, hours, Remark)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (user_id, r["sessionId"], r["offeringId"], claim_id, r["workDate"],
                 r["startTime"], r["endTime"], r["hours"], r["remark"]),
            )


# ---------------------------------------------------------------- live amount calculation
AMOUNT_FROM = """
    FROM work_information w
    JOIN claims c ON c.claimId = w.claimId
    JOIN user_information u ON u.userId = c.userId
    LEFT JOIN compensation_rates cr
           ON cr.sessionId = w.sessionId AND cr.roleId = u.roleId
"""


def claim_totals(conn, claim_id):
    """workCount, totalHours, totalAmount (None ถ้ามีแถวที่ไม่มี rate)"""
    sql = (
        """SELECT COUNT(*) AS workCount,
                  COALESCE(SUM(w.hours), 0) AS totalHours,
                  COALESCE(SUM(ROUND(w.hours * cr.compensationPerHour, 2)), 0) AS totalAmount,
                  COALESCE(SUM(cr.sessionId IS NULL), 0) AS missingRates"""
        + AMOUNT_FROM
        + " WHERE w.claimId = %s"
    )
    with conn.cursor() as cur:
        cur.execute(sql, (claim_id,))
        row = cur.fetchone()
    return {
        "workCount": row["workCount"],
        "totalHours": row["totalHours"],
        "totalAmount": None if int(row["missingRates"]) > 0 else row["totalAmount"],
    }


# ---------------------------------------------------------------- audit log (claim_actions)
# TODO(#69): ชื่อตาราง/คอลัมน์ด้านล่างเป็นค่าที่เดาจากรายละเอียดใน #69
#            (คำขอ, ผู้ดำเนินการ, การดำเนินการ, สถานะก่อน/หลัง, หมายเหตุ, เวลา)
#            ยืนยันกับ DB จริงแล้วแก้ที่นี่ที่เดียว แล้วตั้ง env CLAIM_ACTIONS_ENABLED=1
ACTIONS_TABLE = "claim_actions"
ACTIONS_COLUMNS = {
    "claim": "claimId",
    "actor": "userId",
    "action": "action",
    "from": "fromStatusId",
    "to": "toStatusId",
    "note": "note",
    "at": "createdAt",
}

# ค่า action ที่บันทึก (revision = จำนวนแถว ACTION_SUBMITTED ของคำขอ)
ACTION_SUBMITTED = "submitted"
ACTION_PRINTED = "printed"
ACTION_PDF_DOWNLOADED = "pdf_downloaded"
ACTION_PRINT_METHOD_CHANGED = "print_method_changed"


def actions_enabled():
    return os.environ.get("CLAIM_ACTIONS_ENABLED", "0") == "1"


def log_action(conn, claim_id, actor_user_id, action,
               from_status_id=None, to_status_id=None, note=None):
    """เพิ่มแถวใน claim_actions (Append Only) ถ้ายังไม่เปิดใช้จะข้ามไปโดยไม่ error"""
    if not actions_enabled():
        logger.info("claim_actions ปิดอยู่ ข้ามการบันทึก action=%s claim=%s", action, claim_id)
        return
    c = ACTIONS_COLUMNS
    with conn.cursor() as cur:
        cur.execute(
            f"""INSERT INTO {ACTIONS_TABLE}
                ({c['claim']}, {c['actor']}, {c['action']}, {c['from']}, {c['to']},
                 {c['note']}, {c['at']})
                VALUES (%s,%s,%s,%s,%s,%s,%s)""",
            (claim_id, actor_user_id, action, from_status_id, to_status_id,
             note, now_bangkok()),
        )


def action_stats(conn, claim_ids):
    """{claimId: {"revision": จำนวนครั้งที่ยื่น, "printedAt": เวลาที่เจ้าหน้าที่พิมพ์ล่าสุด หรือ None}}
    ถ้ายังไม่เปิดใช้ claim_actions คืน {} (ไม่ query ตารางที่อาจยังไม่มี)"""
    if not claim_ids or not actions_enabled():
        return {}
    c = ACTIONS_COLUMNS
    marks = ",".join(["%s"] * len(claim_ids))
    with conn.cursor() as cur:
        cur.execute(
            f"""SELECT {c['claim']} AS claimId,
                       SUM({c['action']} = %s) AS revision,
                       MAX(CASE WHEN {c['action']} = %s THEN {c['at']} END) AS printedAt
                FROM {ACTIONS_TABLE}
                WHERE {c['claim']} IN ({marks})
                GROUP BY {c['claim']}""",
            (ACTION_SUBMITTED, ACTION_PRINTED, *claim_ids),
        )
        return {
            r["claimId"]: {"revision": int(r["revision"] or 0), "printedAt": r["printedAt"]}
            for r in cur.fetchall()
        }


# ---------------------------------------------------------------- state machine
# action -> สถานะต้นทางที่อนุญาต, สถานะปลายทาง, ต้องเป็น admin ไหม, ต้องมีหมายเหตุไหม
#   draft ──submit──▶ submitted ──approve──▶ approved ──receive_documents──▶ documents_received
#                       │  ▲                                                    │
#                return │  │ submit                              send_to_finance ▼
#                       ▼  │                                              sent_to_finance
#                     returned          submitted ──reject──▶ rejected (สิ้นสุด)
TRANSITIONS = {
    "submit": {"from": ("draft", "returned"), "to": "submitted",
               "admin": False, "needs_note": False, "log": ACTION_SUBMITTED},
    "approve": {"from": ("submitted",), "to": "approved",
                "admin": True, "needs_note": False, "log": "approved"},
    "reject": {"from": ("submitted",), "to": "rejected",
               "admin": True, "needs_note": True, "log": "rejected"},
    "return": {"from": ("submitted",), "to": "returned",
               "admin": True, "needs_note": True, "log": "returned"},
    "receive_documents": {"from": ("approved",), "to": "documents_received",
                          "admin": True, "needs_note": False, "log": "documents_received"},
    "send_to_finance": {"from": ("documents_received",), "to": "sent_to_finance",
                        "admin": True, "needs_note": False, "log": "sent_to_finance"},
}

_status_id_cache = {}


def status_id_by_name(conn, name):
    """status.statusName -> statusId (cache ข้าม invocation เพราะ id ไม่เปลี่ยน)"""
    if name not in _status_id_cache:
        with conn.cursor() as cur:
            cur.execute("SELECT statusId FROM `status` WHERE statusName = %s", (name,))
            row = cur.fetchone()
        if row is None:
            raise ApiError(500, f"ไม่พบสถานะ '{name}' ในตาราง status", code="INTERNAL_ERROR")
        _status_id_cache[name] = row["statusId"]
    return _status_id_cache[name]


def apply_transition(conn, claim_id, action, actor_user_id, actor_is_admin=False,
                     note=None, stamp_day=False):
    """เปลี่ยนสถานะคำขอตามลำดับที่อนุญาต + บันทึก claim_actions (ไม่ commit ให้ผู้เรียก commit เอง)
    - ไม่พบ=404 / ต้องเป็น admin แต่ไม่ใช่=403 / ผิดลำดับ=409 / ขาดหมายเหตุ=400
    - stamp_day=True: ตั้ง dayClaim เป็นวันนี้ (เวลาไทย) ใช้ตอนยื่น
    คืน {"from": key เดิม, "to": key ใหม่}"""
    rule = TRANSITIONS.get(action)
    if rule is None:
        raise ValueError(f"ไม่รู้จัก action: {action}")
    if rule["admin"] and not actor_is_admin:
        raise ApiError(403, "ต้องเป็นเจ้าหน้าที่ (admin) เท่านั้น")

    with conn.cursor() as cur:
        cur.execute(
            """SELECT c.statusId, s.statusName
               FROM claims c JOIN `status` s ON s.statusId = c.statusId
               WHERE c.claimId = %s FOR UPDATE""",
            (claim_id,),
        )
        row = cur.fetchone()
    if row is None:
        raise ApiError(404, "ไม่พบคำขอ")

    current = status_key(row["statusName"])
    if current not in rule["from"]:
        raise ApiError(
            409, f"สถานะปัจจุบัน ({current}) ไม่อนุญาตให้ทำรายการนี้ ({action})"
        )

    note = (note or "").strip() or None
    if rule["needs_note"] and note is None:
        raise ApiError(400, "ต้องระบุหมายเหตุ")

    to_status_id = status_id_by_name(conn, STATUS_NAME_BY_KEY[rule["to"]])
    with conn.cursor() as cur:
        if stamp_day:
            cur.execute(
                "UPDATE claims SET statusId = %s, dayClaim = %s WHERE claimId = %s",
                (to_status_id, now_bangkok().date(), claim_id),
            )
        else:
            cur.execute(
                "UPDATE claims SET statusId = %s WHERE claimId = %s",
                (to_status_id, claim_id),
            )

    log_action(conn, claim_id, actor_user_id, rule["log"],
               from_status_id=row["statusId"], to_status_id=to_status_id, note=note)
    return {"from": current, "to": rule["to"]}


# ---------------------------------------------------------------- response shape (Swagger)
def build_claims(conn, claim_ids):
    """สร้างข้อมูลคำขอตามรูปแบบเดียวกันทุก endpoint (ตาม Swagger) เรียงตาม claim_ids"""
    if not claim_ids:
        return []
    marks = ",".join(["%s"] * len(claim_ids))
    with conn.cursor() as cur:
        cur.execute(
            f"""SELECT c.claimId, c.userId, c.statusId, s.statusName, c.dayClaim,
                       c.printStatus, r.roleName
                FROM claims c
                JOIN `status` s ON s.statusId = c.statusId
                JOIN user_information u ON u.userId = c.userId
                JOIN user_role r ON r.roleId = u.roleId
                WHERE c.claimId IN ({marks})""",
            claim_ids,
        )
        claims = {row["claimId"]: row for row in cur.fetchall()}

        cur.execute(
            f"""SELECT w.claimId, w.workId, w.workDate, w.hours, w.Remark AS remark,
                       co.courseId, co.academicYear, co.semester,
                       ROUND(w.hours * cr.compensationPerHour, 2) AS amount,
                       (cr.sessionId IS NULL) AS missingRate
                FROM work_information w
                JOIN claims c ON c.claimId = w.claimId
                JOIN user_information u ON u.userId = c.userId
                LEFT JOIN course_offerings co ON co.offeringId = w.offeringId
                LEFT JOIN compensation_rates cr
                       ON cr.sessionId = w.sessionId AND cr.roleId = u.roleId
                WHERE w.claimId IN ({marks})
                ORDER BY w.claimId, w.workDate, w.workId""",
            claim_ids,
        )
        work_by_claim = {}
        for row in cur.fetchall():
            work_by_claim.setdefault(row["claimId"], []).append(row)

    stats = action_stats(conn, claim_ids)

    result = []
    for claim_id in claim_ids:
        c = claims.get(claim_id)
        if c is None:
            continue
        rows = work_by_claim.get(claim_id, [])
        total_hours = sum((r["hours"] for r in rows), Decimal(0))
        missing = any(int(r["missingRate"]) for r in rows)
        total_amount = None if missing else sum((r["amount"] for r in rows), Decimal(0))
        term = default_term()
        for r in rows:
            if r["semester"] is not None:
                term = term_label(r["semester"], r["academicYear"])
                break

        # ฉบับร่างยังไม่เคยยื่น จึงไม่มี submittedAt / updatedAt
        is_draft = c["statusId"] == STATUS_DRAFT
        submitted_at = None if is_draft else to_utc_z(c["dayClaim"])

        st = stats.get(claim_id) or {}
        result.append(
            {
                "id": f"c{c['claimId']:03d}",
                "userId": c["userId"],
                "role": role_key(c["roleName"]),
                "term": term,
                "billingCycle": None,  # ไม่มีคอลัมน์เก็บรอบเบิกใน DB
                "items": [
                    {"workId": r["workId"], "date": r["workDate"], "courseCode": r["courseId"],
                     "hours": r["hours"], "note": r["remark"]}
                    for r in rows
                ],
                "status": status_key(c["statusName"]),
                "statusId": c["statusId"],
                "statusName": c["statusName"],  # ให้ front ใช้ทำ badge
                "printMethod": print_method_key(c["printStatus"]),
                "revision": st.get("revision"),  # None ถ้ายังไม่เปิดใช้ claim_actions
                "printedAt": to_utc_z(st["printedAt"]) if st.get("printedAt") else None,
                "totalHours": total_hours,
                "totalAmount": total_amount,  # None ถ้าไม่มี rate
                "createdAt": None,  # ไม่มีคอลัมน์ใน DB
                "updatedAt": submitted_at,  # มีค่าหลังยื่น (= submittedAt)
                "submittedAt": submitted_at,
            }
        )
    return result
