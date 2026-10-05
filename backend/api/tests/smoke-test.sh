#!/usr/bin/env bash
# ทดสอบ CORS preflight ของ API Gateway และ ทดสอบทุก route
#
# ใช้ (CloudShell หรือเครื่องที่มี curl):
#   API_URL=https://39eee8bl4b.execute-api.us-east-1.amazonaws.com ./smoke-test.sh
#
# ค่าเริ่มต้น: ทดสอบเฉพาะ CORS (ไม่ต้องมี Lambda) exit 0 เมื่อผ่านทั้งหมด
# เปิดการทดสอบ route ด้วย RUN_ROUTES=1
#   RUN_ROUTES=1 API_URL=... ./smoke-test.sh
#
# ตัวแปรที่ปรับได้:
#   ORIGIN         origin ที่ควรได้รับอนุญาต (ค่าเริ่มต้น: CloudFront ของทีม)
#   LOCAL_ORIGIN   origin localhost ที่ควรได้รับอนุญาต
#   BAD_ORIGIN     origin ที่ต้องถูกปฏิเสธ
#   X_USER_ID      ค่า header X-User-Id ที่ส่งตอนทดสอบ route /claims (ค่าเริ่มต้น: test-ta-01)
set -u

: "${API_URL:?ต้องตั้งค่า API_URL เช่น API_URL=https://39eee8bl4b.execute-api.us-east-1.amazonaws.com}"
API_URL="${API_URL%/}"
ORIGIN="${ORIGIN:-https://d2ye2fegyyx6ls.cloudfront.net}"
LOCAL_ORIGIN="${LOCAL_ORIGIN:-http://localhost:3000}"
BAD_ORIGIN="${BAD_ORIGIN:-http://evil.example.com}"
X_USER_ID="${X_USER_ID:-test-ta-01}"
RUN_ROUTES="${RUN_ROUTES:-0}"

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
preflight /rates "$ORIGIN" POST "content-type,authorization,x-user-id"
[ "$(status_of)" = "204" ] \
  && pass "preflight จาก CloudFront ได้ 204" \
  || fail "preflight จาก CloudFront ควรได้ 204 (ได้ '$(status_of)')"

[ "$(header_of access-control-allow-origin)" = "$ORIGIN" ] \
  && pass "allow-origin ตรงกับ origin ($ORIGIN)" \
  || fail "allow-origin ควรเป็น $ORIGIN (ได้ '$(header_of access-control-allow-origin)')"

AH=$(header_of access-control-allow-headers | tr 'A-Z' 'a-z')
case "$AH" in *authorization*) pass "allow-headers มี Authorization" ;; *) fail "allow-headers ไม่มี Authorization (ได้ '$AH')" ;; esac
case "$AH" in *content-type*)  pass "allow-headers มี Content-Type" ;;  *) fail "allow-headers ไม่มี Content-Type (ได้ '$AH')" ;; esac
case "$AH" in *x-user-id*)      pass "allow-headers มี X-User-Id" ;;     *) fail "allow-headers ไม่มี X-User-Id (ได้ '$AH')" ;; esac

AM=$(header_of access-control-allow-methods | tr 'a-z' 'A-Z')
for m in GET POST PUT; do
  case "$AM" in *"$m"*) pass "allow-methods มี $m" ;; *) fail "allow-methods ไม่มี $m (ได้ '$AM')" ;; esac
done

MAXAGE=$(header_of access-control-max-age)
[ "$MAXAGE" = "3600" ] \
  && pass "max-age เป็น 3600" \
  || fail "max-age ควรเป็น 3600 (ได้ '$MAXAGE')"

# 2) preflight ของ route ที่ใช้ method ต่างกัน
for spec in "/claims:POST" "/claims/c001:PUT" "/claims/c001/submit:POST" "/terms:GET"; do
  p="${spec%%:*}"; m="${spec##*:}"
  preflight "$p" "$ORIGIN" "$m" "content-type,x-user-id"
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

# ---------- ทดสอบ route (ต้องผูก Lambda แล้ว) ----------
if [ "$RUN_ROUTES" = "1" ]; then
  echo "=== Route tests (RUN_ROUTES=1) ==="
  JSON='Content-Type: application/json'
  BODY='{"userId":"u001","role":"instructor","term":"1-2569","billingCycle":1,"items":[{"date":"2026-09-15","courseCode":"CS361","hours":3}]}'

  # check <ชื่อ> <status ที่คาดหวัง> <curl args...>
  check() {
    local name="$1" expected="$2" code; shift 2
    code=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" "$@")
    if [ "$code" = "$expected" ]; then pass "$name (got $code)"; else fail "$name (expected $expected, got $code)"; fi
  }

  check "GET /rates"                 200 "$API_URL/rates"
  check "GET /terms"                 200 "$API_URL/terms"
  UID_H="X-User-Id: $X_USER_ID"   # ส่งเฉพาะ route /claims
  check "GET /claims"                200 -H "$UID_H" "$API_URL/claims?userId=u001&term=1-2569"
  check "GET /claims bad status"     400 -H "$UID_H" "$API_URL/claims?status=invalid"
  check "POST /claims"               201 -H "$UID_H" -X POST "$API_URL/claims" -H "$JSON" -d "$BODY"
  check "POST /claims empty body"    400 -H "$UID_H" -X POST "$API_URL/claims" -H "$JSON" -d '{}'
  check "GET /claims/{id} not found" 404 -H "$UID_H" "$API_URL/claims/not-exist"
  check "PUT /claims/{id} not found" 404 -H "$UID_H" -X PUT "$API_URL/claims/not-exist" -H "$JSON" -d "$BODY"
  check "submit not found"           404 -H "$UID_H" -X POST "$API_URL/claims/not-exist/submit"
else
  echo "(ข้ามการทดสอบ route: ตั้ง RUN_ROUTES=1 เมื่อผูก Lambda แล้ว)"
fi

echo "=== PASS: $PASS  FAIL: $FAIL ==="
[ "$FAIL" -eq 0 ]