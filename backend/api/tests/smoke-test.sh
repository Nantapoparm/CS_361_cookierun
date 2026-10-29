#!/usr/bin/env bash
# ทดสอบ CORS preflight ของ API Gateway, JWT Authorizer และ route ของ V3 (ไม่สร้างข้อมูลจริง)
#
# ใช้ (CloudShell หรือเครื่องที่มี curl):
#   API_URL=https://39eee8bl4b.execute-api.us-east-1.amazonaws.com ./smoke-test.sh
#
# ค่าเริ่มต้น: ทดสอบเฉพาะ CORS (ไม่ต้องมี Lambda) exit 0 เมื่อผ่านทั้งหมด
# เปิดการทดสอบ route ด้วย RUN_ROUTES=1
#   RUN_ROUTES=1 API_URL=... ./smoke-test.sh
#
# ทดสอบ JWT Authorizer (V3): ตั้ง TOKEN เป็น ID Token หรือ Access Token จาก Cognito
#   TOKEN=$(bash backend/api/scripts/get-token.sh) API_URL=... ./smoke-test.sh
# ไม่ตั้ง TOKEN = ทดสอบเฉพาะกรณีไม่มี token / token ปลอม (ต้องได้ 401)
#
# ตัวแปรที่ปรับได้:
#   ORIGIN         origin ที่ควรได้รับอนุญาต (ค่าเริ่มต้น: CloudFront ของทีม)
#   LOCAL_ORIGIN   origin localhost ที่ควรได้รับอนุญาต
#   BAD_ORIGIN     origin ที่ต้องถูกปฏิเสธ
set -u

: "${API_URL:?ต้องตั้งค่า API_URL เช่น API_URL=https://39eee8bl4b.execute-api.us-east-1.amazonaws.com}"
API_URL="${API_URL%/}"
ORIGIN="${ORIGIN:-https://d2ye2fegyyx6ls.cloudfront.net}"
LOCAL_ORIGIN="${LOCAL_ORIGIN:-http://localhost:3000}"
BAD_ORIGIN="${BAD_ORIGIN:-http://evil.example.com}"
RUN_ROUTES="${RUN_ROUTES:-0}"
TOKEN="${TOKEN:-}"

PASS=0; FAIL=0
pass() { echo "PASS  $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL  $1"; FAIL=$((FAIL+1)); }

# preflight <path> <origin> <method> <request-headers>  -> เก็บผลใน $HDRS
preflight() {
  HDRS=$(curl -si --max-time 20 -X OPTIONS "$API_URL$1" \
    -H "Origin: $2" \
    -H "Access-Control-Request-Method: $3" \
    -H "Access-Control-Request-Headers: $4" | tr -d '\r')
}
status_of() { printf '%s\n' "$HDRS" | head -1 | awk '{print $2}'; }
header_of() { printf '%s\n' "$HDRS" | grep -i "^$1:" | head -1 | cut -d: -f2- | sed 's/^ *//'; }

echo "=== CORS preflight: $API_URL ==="

# 1) origin ที่อนุญาต (CloudFront)
preflight /rates "$ORIGIN" POST "content-type,authorization"
[ "$(status_of)" = "204" ] \
  && pass "preflight จาก CloudFront ได้ 204" \
  || fail "preflight จาก CloudFront ควรได้ 204 (ได้ '$(status_of)')"

[ "$(header_of access-control-allow-origin)" = "$ORIGIN" ] \
  && pass "allow-origin ตรงกับ origin ($ORIGIN)" \
  || fail "allow-origin ควรเป็น $ORIGIN (ได้ '$(header_of access-control-allow-origin)')"

AH=$(header_of access-control-allow-headers | tr 'A-Z' 'a-z')
case "$AH" in *authorization*) pass "allow-headers มี Authorization" ;; *) fail "allow-headers ไม่มี Authorization (ได้ '$AH')" ;; esac
case "$AH" in *content-type*)  pass "allow-headers มี Content-Type" ;;  *) fail "allow-headers ไม่มี Content-Type (ได้ '$AH')" ;; esac

AM=$(header_of access-control-allow-methods | tr 'a-z' 'A-Z')
for m in GET POST PUT; do
  case "$AM" in *"$m"*) pass "allow-methods มี $m" ;; *) fail "allow-methods ไม่มี $m (ได้ '$AM')" ;; esac
done

MAXAGE=$(header_of access-control-max-age)
[ "$MAXAGE" = "3600" ] \
  && pass "max-age เป็น 3600" \
  || fail "max-age ควรเป็น 3600 (ได้ '$MAXAGE')"

# 2) preflight ของ route ที่ใช้ method ต่างกัน
for spec in "/claims:POST" "/claims/c001:PUT" "/claims/c001:DELETE" "/claims/c001/submit:POST" \
            "/claims/c001/cancel:POST" "/terms:GET" "/schedule/1:DELETE" "/schedule:GET" \
            "/admin/claims:GET" "/admin/claims/mark-paid:POST"; do
  p="${spec%%:*}"; m="${spec##*:}"
  preflight "$p" "$ORIGIN" "$m" "content-type,authorization"
  if [ "$(status_of)" = "204" ] && [ "$(header_of access-control-allow-origin)" = "$ORIGIN" ]; then
    pass "preflight $m $p"
  else
    fail "preflight $m $p (status '$(status_of)', allow-origin '$(header_of access-control-allow-origin)')"
  fi
done

# 3) localhost ที่อนุญาตสำหรับ dev
preflight /rates "$LOCAL_ORIGIN" GET "content-type"
[ "$(header_of access-control-allow-origin)" = "$LOCAL_ORIGIN" ] \
  && pass "localhost ($LOCAL_ORIGIN) ได้รับอนุญาต" \
  || fail "localhost ($LOCAL_ORIGIN) ควรได้รับอนุญาต (ได้ '$(header_of access-control-allow-origin)')"

# 4) origin ที่ไม่อนุญาต ต้องไม่มี allow-origin
preflight /rates "$BAD_ORIGIN" GET "content-type"
if [ -z "$(header_of access-control-allow-origin)" ]; then
  pass "origin ที่ไม่อนุญาต ($BAD_ORIGIN) ไม่มี allow-origin"
else
  fail "origin ที่ไม่อนุญาตไม่ควรมี allow-origin (ได้ '$(header_of access-control-allow-origin)')"
fi

# ---------- JWT Authorizer (V3) ----------
echo "=== JWT Authorizer ==="
# ตรวจ body ว่าเป็น {"message":"Unauthorized"} ของ API Gateway ไม่ใช่ 401 ของ Lambda
# code_of <curl args...> -> HTTP status
code_of() { curl -s --max-time 20 -o /dev/null -w "%{http_code}" "$@"; }
# authz_401 <ชื่อ> <curl args...> -> ผ่านเมื่อได้ 401 จาก Authorizer
authz_401() {
  local name="$1" out code body; shift
  out=$(curl -s --max-time 20 -w $'\n%{http_code}' "$@")
  code="${out##*$'\n'}"; body="${out%$'\n'*}"
  if [ "$code" = "401" ] && printf '%s' "$body" | grep -q '"message" *: *"Unauthorized"'; then
    pass "$name ได้ 401 จาก Authorizer"
  else
    fail "$name ควรได้ 401 จาก Authorizer (ได้ $code: $body)"
  fi
}

for path in /rates /claims /schedule /admin/claims; do
  authz_401 "ไม่มี token: GET $path" "$API_URL$path"
done
authz_401 "token ปลอม: GET /rates" -H "Authorization: Bearer not.a.real.token" "$API_URL/rates"

# หน้าเว็บต้องอ่าน 401 ได้ (ไม่ใช่ CORS error) จึงต้องมี allow-origin แม้ถูกปฏิเสธ
AO=$(curl -si --max-time 20 -H "Origin: $ORIGIN" "$API_URL/rates" | tr -d '\r' | grep -i '^access-control-allow-origin:' | cut -d: -f2- | sed 's/^ *//')
[ "$AO" = "$ORIGIN" ] && pass "response 401 มี allow-origin ($ORIGIN)" || fail "response 401 ควรมี allow-origin $ORIGIN (ได้ '$AO')"

if [ -n "$TOKEN" ]; then
  AUTH_H="Authorization: Bearer $TOKEN"
  for path in /rates /terms; do
    c=$(code_of -H "$AUTH_H" "$API_URL$path")
    [ "$c" = "200" ] && pass "มี token: GET $path ได้ 200 (Lambda ตอบ)" || fail "มี token: GET $path ควรได้ 200 (ได้ $c)"
  done
  AO=$(curl -si --max-time 20 -H "Origin: $ORIGIN" -H "$AUTH_H" "$API_URL/rates" | tr -d '\r' | grep -i '^access-control-allow-origin:' | cut -d: -f2- | sed 's/^ *//')
  [ "$AO" = "$ORIGIN" ] && pass "มี token: response มี allow-origin" || fail "มี token: response ควรมี allow-origin $ORIGIN (ได้ '$AO')"
else
  echo "(ข้ามกรณีมี token: ตั้ง TOKEN เพื่อทดสอบ)"
fi

# ---------- ทดสอบ route (ต้องผูก Lambda แล้ว) ----------
if [ "$RUN_ROUTES" = "1" ]; then
  echo "=== Route tests (RUN_ROUTES=1) ==="
  # ทดสอบเฉพาะกรณีที่ไม่เขียนข้อมูล (อ่านอย่างเดียว / 400 / 404) จึงรันซ้ำได้และไม่สร้างคำขอจริง
  # ผู้ใช้ของ TOKEN ต้องผูก cognitoSub ใน user_information แล้ว ไม่อย่างนั้นทุก route ได้ 403
  [ -n "$TOKEN" ] || { echo "RUN_ROUTES=1 ต้องตั้ง TOKEN ด้วย (ทุก route ต้องเข้าสู่ระบบ)"; exit 1; }
  JSON='Content-Type: application/json'
  MONTH=$(date +%Y-%m)

  # กลุ่ม admin หรือไม่ (จาก cognito:groups ใน token) ใช้กำหนดผลที่คาดของ route ที่จำกัดสิทธิ์
  IS_ADMIN=$(printf '%s' "$TOKEN" | python3 -c '
import base64, json, sys
p = sys.stdin.read().split(".")[1]
g = json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4))).get("cognito:groups") or []
g = g if isinstance(g, list) else str(g).strip("[]").split()
print(1 if "admin" in g else 0)' 2>/dev/null || echo 0)
  if [ "$IS_ADMIN" = "1" ]; then
    echo "(token เป็นกลุ่ม admin)"; OTHER_USER=200; ADMIN_LIST=200; ADMIN_ONE=404; ADMIN_BAD=400
  else
    echo "(token ไม่ใช่กลุ่ม admin)"; OTHER_USER=403; ADMIN_LIST=403; ADMIN_ONE=403; ADMIN_BAD=403
  fi

  # check <ชื่อ> <status ที่คาดหวัง> <curl args...>
  check() {
    local name="$1" expected="$2" code; shift 2
    code=$(curl -s --max-time 30 -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$@")
    if [ "$code" = "$expected" ]; then pass "$name (got $code)"; else fail "$name (expected $expected, got $code)"; fi
  }

  # ข้อมูลอ้างอิง
  check "GET /rates"                           200 "$API_URL/rates"
  check "GET /terms"                           200 "$API_URL/terms"
  check "GET /uploads/presigned-url"           200 "$API_URL/uploads/presigned-url?filename=smoke-test.txt&contentType=text/plain"
  check "presigned-url ไม่มี filename"            400 "$API_URL/uploads/presigned-url"

  # คำขอ
  check "GET /claims"                          200 "$API_URL/claims"
  check "GET /claims status ผิด"                 400 "$API_URL/claims?status=invalid"
  check "GET /claims ของผู้ใช้อื่น"                 "$OTHER_USER" "$API_URL/claims?userId=smoke-other-user"
  check "POST /claims body ว่าง"                 400 -X POST "$API_URL/claims" -H "$JSON" -d '{}'
  check "POST /claims month ผิด"                 400 -X POST "$API_URL/claims" -H "$JSON"     -d '{"offeringId":1,"month":"2026-13","items":[{"workDate":"2026-10-06","startTime":"09:30","endTime":"12:30"}]}'
  check "GET /claims/{id} ไม่พบ"                 404 "$API_URL/claims/not-exist"
  check "PUT /claims/{id} ไม่พบ"                 404 -X PUT "$API_URL/claims/not-exist" -H "$JSON" -d '{}'
  check "submit ไม่พบ"                          404 -X POST "$API_URL/claims/not-exist/submit" -H "$JSON" -d '{"printMethod":"sign_with_staff"}'
  check "print-method ไม่พบ"                    404 -X PUT "$API_URL/claims/not-exist/print-method" -H "$JSON" -d '{"printMethod":"self_print"}'
  check "GET /claims/{id}/actions ไม่พบ"         404 "$API_URL/claims/not-exist/actions"
  check "cancel ไม่พบ"                          404 -X POST "$API_URL/claims/not-exist/cancel" -H "$JSON" -d '{}'
  check "DELETE /claims/{id} ไม่พบ"              404 -X DELETE "$API_URL/claims/not-exist"
  check "GET /claims/{id}/pdf ไม่พบ"             404 "$API_URL/claims/not-exist/pdf"
  check "POST /claims/autofill body ว่าง"        400 -X POST "$API_URL/claims/autofill" -H "$JSON" -d '{}'

  # ปฏิทินคาบสอน
  check "GET /schedule?month=$MONTH"           200 "$API_URL/schedule?month=$MONTH"
  check "GET /schedule ไม่มี month"              400 "$API_URL/schedule"
  check "POST /schedule body ว่าง"               400 -X POST "$API_URL/schedule" -H "$JSON" -d '{}'
  check "DELETE /schedule/{id} ไม่พบ"            404 -X DELETE "$API_URL/schedule/0"

  # เจ้าหน้าที่
  check "GET /admin/claims"                    "$ADMIN_LIST" "$API_URL/admin/claims"
  check "GET /admin/claims/{id}"               "$ADMIN_ONE" "$API_URL/admin/claims/not-exist"
  check "admin cancel ไม่พบ"                     "$ADMIN_ONE" -X POST "$API_URL/admin/claims/not-exist/cancel" -H "$JSON" -d '{"note":"smoke"}'
  # Lambda ตรวจ note ก่อนโหลดคำขอ จึงได้ 400 โดยไม่แตะข้อมูล
  check "admin cancel ไม่มี note"                 "$ADMIN_BAD" -X POST "$API_URL/admin/claims/c999999/cancel" -H "$JSON" -d '{}'
  check "mark-paid body ว่าง"                    "$ADMIN_BAD" -X POST "$API_URL/admin/claims/mark-paid" -H "$JSON" -d '{}'
else
  echo "(ข้ามการทดสอบ route: ตั้ง RUN_ROUTES=1 เมื่อผูก Lambda แล้ว)"
fi

echo "=== PASS: $PASS  FAIL: $FAIL ==="
[ "$FAIL" -eq 0 ]