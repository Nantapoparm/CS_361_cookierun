import base64
import datetime as dt
import json
import logging
import os
import re
from decimal import Decimal

import pymysql

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# ประเทศไทยไม่มี DST จึงใช้ offset คงที่ +7 ได้ (ไม่ต้องพึ่ง tzdata)
BANGKOK = dt.timezone(dt.timedelta(hours=7))

_connection = None


_DEFAULT_CODES = {
    400: "VALIDATION_ERROR",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "INVALID_STATE",
    500: "INTERNAL_ERROR",
}

# user_role.roleName (ตัวพิมพ์เล็ก) -> role key ที่ตรงกับชื่อ Group ใน Cognito
# ถ้าชื่อ role ของเจ้าหน้าที่ใน DB ไม่ใช่ admin/administrator ให้เพิ่มที่นี่
ROLE_KEYS = {
    "instructor": "instructor",
    "teaching assistant": "ta",
    "ta": "ta",
    "student helper": "student_helper",
    "admin": "admin",
    "administrator": "admin",
}
ADMIN_GROUP = "admin"


class ApiError(Exception):
    """โยนเมื่อต้องการตอบ error กลับ client ด้วย status code ที่กำหนด
    code เป็นรหัสข้อผิดพลาดใน error envelope (ถ้าไม่ระบุจะใช้ค่าตาม status)"""

    def __init__(self, status_code, message, code=None):
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.code = code or _DEFAULT_CODES.get(status_code, "ERROR")


def now_bangkok():
    """เวลาปัจจุบันตามเขตเวลา Asia/Bangkok (naive datetime สำหรับเก็บลง DATETIME)"""
    return dt.datetime.now(BANGKOK).replace(tzinfo=None)


def _connect():
    return pymysql.connect(
        host=os.environ["DB_HOST"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        database=os.environ.get("DB_NAME", "cs361_compensation"),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
        connect_timeout=5,
    )


def get_connection():
    """reuse connection ข้าม invocation; ถ้าหลุดจะเชื่อมต่อใหม่
    commit ทุกครั้งที่เริ่ม invocation เพื่อจบ transaction เก่า
    (กัน REPEATABLE READ snapshot ค้างแล้วอ่านข้อมูลเก่า)"""
    global _connection
    if _connection is None:
        _connection = _connect()
        return _connection
    try:
        _connection.ping(reconnect=True)
        _connection.commit()
    except pymysql.MySQLError:
        _connection = _connect()
    return _connection


def _json_default(o):
    if isinstance(o, Decimal):
        return float(o)
    if isinstance(o, dt.datetime):
        return o.isoformat()
    if isinstance(o, dt.date):
        return o.isoformat()
    if isinstance(o, dt.timedelta):
        total = int(o.total_seconds())
        return f"{total // 3600:02d}:{total % 3600 // 60:02d}:{total % 60:02d}"
    return str(o)


def response(status_code, body):
    """response ตามรูปแบบ API Gateway (Lambda proxy integration)
    หมายเหตุ: API Gateway (HTTP API) จัดการ CORS ให้แล้วตาม openapi.yaml และจะเมิน header CORS
    จาก Lambda จึงเก็บไว้เป็นตัวสำรอง ลบได้เมื่อยืนยันแล้วว่า CORS ที่ API Gateway ทำงานครบ"""
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        },
        "body": json.dumps(body, default=_json_default, ensure_ascii=False),
    }


def ok(status_code, data):
    """envelope สำเร็จ: {"success": true, "data": ...}"""
    return response(status_code, {"success": True, "data": data})


def fail(status_code, code, message):
    """envelope ผิดพลาด: {"success": false, "error": {"code", "message"}}"""
    return response(
        status_code, {"success": False, "error": {"code": code, "message": message}}
    )


def to_utc_z(value):
    """DATE/DATETIME เวลาไทย (naive จาก DB) -> สตริง UTC รูปแบบ 2026-09-17T09:30:00Z
    claims.dayClaim เป็น DATE: ถือเป็นเที่ยงคืนเวลาไทยของวันนั้น"""
    if value is None:
        return None
    if not isinstance(value, dt.datetime):
        value = dt.datetime(value.year, value.month, value.day)
    return (value - dt.timedelta(hours=7)).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------- authentication (Cognito JWT)
def jwt_claims(event):
    """claims ที่ API Gateway (HTTP API, payload 2.0) แนบมาหลังตรวจ token แล้ว"""
    authorizer = (event.get("requestContext") or {}).get("authorizer") or {}
    return (authorizer.get("jwt") or {}).get("claims") or {}


def parse_groups(raw):
    """cognito:groups ใน HTTP API มักมาเป็นสตริง เช่น "[admin]" หรือ "[ta admin]"
    (ไม่ใช่ list) รองรับทั้ง list, "[a b]", "a,b", '["a","b"]' คืน list ของชื่อกลุ่ม"""
    if raw is None:
        return []
    if isinstance(raw, (list, tuple, set)):
        items = list(raw)
    else:
        text = str(raw).strip()
        if text.startswith("[") and text.endswith("]"):
            text = text[1:-1]
        items = re.split(r"[,\s]+", text)
    groups = []
    for item in items:
        name = str(item).strip().strip("\"'")
        if name:
            groups.append(name)
    return groups


def role_key_from_name(role_name):
    """user_role.roleName -> role key (instructor / ta / student_helper / admin)"""
    name = str(role_name or "").strip().lower()
    return ROLE_KEYS.get(name) or re.sub(r"\W+", "_", name)


def authenticate(conn, event):
    """ระบุผู้ใช้จาก JWT claims -> dict auth (ดู docstring ด้านบน)
    401: ไม่มี sub | 403: ไม่อยู่ในกลุ่มใดเลย / ไม่พบผู้ใช้ที่ผูก cognitoSub / บทบาทไม่ตรงกลุ่ม"""
    claims = jwt_claims(event)
    sub = str(claims.get("sub") or "").strip()
    if not sub:
        raise ApiError(401, "ต้องเข้าสู่ระบบ")

    groups = parse_groups(claims.get("cognito:groups"))
    if not groups:
        raise ApiError(403, "บัญชีนี้ไม่มีสิทธิ์ใช้งาน")

    with conn.cursor() as cur:
        cur.execute(
            """SELECT u.userId, u.name, u.lastName, r.roleName
               FROM user_information u
               JOIN user_role r ON r.roleId = u.roleId
               WHERE u.cognitoSub = %s""",
            (sub,),
        )
        row = cur.fetchone()
    if row is None:
        logger.warning("cognitoSub %s ไม่ผูกกับผู้ใช้ใน user_information", sub)
        raise ApiError(403, "ไม่พบผู้ใช้ที่ผูกกับบัญชีนี้")

    role = role_key_from_name(row["roleName"])
    if role not in groups:
        logger.warning("sub %s: role %s ไม่ตรงกับกลุ่ม %s", sub, role, groups)
        raise ApiError(403, "บทบาทของผู้ใช้ไม่ตรงกับกลุ่มสิทธิ์")

    return {
        "userId": row["userId"],
        "sub": sub,
        "name": row["name"],
        "lastName": row["lastName"],
        "roleName": row["roleName"],
        "role": role,
        "groups": groups,
        "isAdmin": ADMIN_GROUP in groups,
    }


def require_admin(auth):
    """ใช้ใน handler ที่ต้องตรวจสิทธิ์ admin เองเป็นบางเงื่อนไข"""
    if not auth["isAdmin"]:
        raise ApiError(403, "ต้องเป็นเจ้าหน้าที่ (admin) เท่านั้น")


# ---------------------------------------------------------------- request helpers
def parse_json_body(event):
    raw = event.get("body")
    if not raw:
        return {}
    try:
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw).decode("utf-8")
        data = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise ApiError(400, "body ต้องเป็น JSON ที่ถูกต้อง")
    if not isinstance(data, dict):
        raise ApiError(400, "body ต้องเป็น JSON object")
    return data


def _safe_rollback(conn):
    if conn is not None:
        try:
            conn.rollback()
        except Exception:
            pass


# ---------------------------------------------------------------- handler wrappers
def _method(event):
    return (
        event.get("httpMethod")
        or (event.get("requestContext") or {}).get("http", {}).get("method")
        or ""
    ).upper()


def run_auth(event, fn, admin_only=False):
    """รัน fn(conn, auth) พร้อมระบุตัวผู้ใช้จาก JWT และจัดการ error ให้เป็นรูปแบบเดียวกัน
    admin_only=True: ผู้ใช้ที่ไม่ใช่ admin ได้ 403"""
    if _method(event) == "OPTIONS":
        return ok(200, None)

    conn = None
    try:
        if not jwt_claims(event).get("sub"):
            raise ApiError(401, "ต้องเข้าสู่ระบบ")  # เช็คก่อนเชื่อมต่อ DB
        conn = get_connection()
        auth = authenticate(conn, event)
        if admin_only:
            require_admin(auth)
        return fn(conn, auth)
    except ApiError as e:
        _safe_rollback(conn)
        return fail(e.status_code, e.code, e.message)
    except Exception:
        logger.exception("Unhandled error")
        _safe_rollback(conn)
        return fail(500, "INTERNAL_ERROR", "เกิดข้อผิดพลาดภายในระบบ")


def run(event, fn):
    """รัน fn(conn, user_id) (เหมือน v.2) แต่ user_id มาจาก JWT แล้ว ไม่ใช่ header"""
    return run_auth(event, lambda conn, auth: fn(conn, auth["userId"]))