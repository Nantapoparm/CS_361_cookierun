#!/usr/bin/env bash
# Load test แบบอ่านอย่างเดียว (V4): ยิง GET route เดียวพร้อมกันหลายระดับ เพื่อหาเพดานจริงของระบบ
# ไม่สร้างหรือแก้ข้อมูล แต่ใช้โควตา Lambda ร่วมกับทั้งบัญชี ระหว่างรันเพื่อนในทีมอาจเรียก API ไม่ได้ ควรนัดเวลาก่อน
#
# ใช้ (CloudShell หรือเครื่องที่มี curl, xargs, awk):
#   export API_URL=https://39eee8bl4b.execute-api.us-east-1.amazonaws.com
#   TOKEN=$(bash backend/api/scripts/get-token.sh) bash backend/api/tests/load-test.sh
#
# ตัวแปรที่ปรับได้:
#   ROUTE       GET route ที่จะยิง (ค่าเริ่มต้น /terms ซึ่งอ่านจาก RDS)
#   LEVELS      จำนวน request พร้อมกันแต่ละระดับ (ค่าเริ่มต้น "1 5 10 20 30")
#   PER_WORKER  จำนวน request ต่อ worker ในแต่ละระดับ (ค่าเริ่มต้น 5)
#   PAUSE       วินาทีที่พักระหว่างระดับ (ค่าเริ่มต้น 5)
#
# ผลลัพธ์: ตารางจำนวนสถานะ (2xx / 429 / 5xx / อื่น ๆ) และเวลาตอบ p50 / p95 / max ต่อระดับ
#   429 = API Gateway throttling (set-throttling.sh)  5xx = Lambda ถูก throttle หรือ error
set -euo pipefail

: "${API_URL:?ต้องตั้งค่า API_URL เช่น API_URL=https://39eee8bl4b.execute-api.us-east-1.amazonaws.com}"
: "${TOKEN:?ต้องตั้งค่า TOKEN เช่น TOKEN=\$(bash backend/api/scripts/get-token.sh)}"
API_URL="${API_URL%/}"
ROUTE="${ROUTE:-/terms}"
LEVELS="${LEVELS:-1 5 10 20 30}"
PER_WORKER="${PER_WORKER:-5}"
PAUSE="${PAUSE:-5}"

case "$ROUTE" in /*) ;; *) echo "ROUTE ต้องขึ้นต้นด้วย / เช่น /terms"; exit 1 ;; esac

# เก็บ token ในไฟล์ที่เปิดได้เฉพาะเจ้าของ แล้วส่งด้วย curl -H @file (token ไม่ไปอยู่ใน argument ของ process)
WORK_DIR=$(mktemp -d)
chmod 700 "$WORK_DIR"
trap 'rm -rf "$WORK_DIR"' EXIT
trap 'exit 130' INT TERM
printf 'Authorization: Bearer %s\n' "$TOKEN" > "$WORK_DIR/auth"
chmod 600 "$WORK_DIR/auth"

export URL="$API_URL$ROUTE" AUTH_FILE="$WORK_DIR/auth"
one() {
  curl -s -o /dev/null --max-time 35 -H @"$AUTH_FILE" -w '%{http_code} %{time_total}\n' "$URL" || true
}
export -f one

# ตรวจก่อนว่า token และ route ใช้ได้ (ไม่อย่างนั้นทุกระดับจะได้ 401/403 และตัวเลขไม่มีความหมาย)
FIRST=$(one | awk '{print $1}')
[ "$FIRST" = "200" ] || { echo "GET $ROUTE ได้ $FIRST (ต้องได้ 200) ตรวจ TOKEN / ROUTE ก่อน"; exit 1; }

START=$(date -u +%Y-%m-%dT%H:%M:00Z)   # ปัดลงต้นนาที ให้ตรงกับ datapoint ของ CloudWatch
echo "=== Load test: GET $URL  (เริ่ม $START) ==="
printf '%-11s %-8s %-6s %-6s %-6s %-6s %-8s %-8s %-8s\n' "พร้อมกัน" "request" "2xx" "429" "5xx" "อื่นๆ" "p50(s)" "p95(s)" "max(s)"

for C in $LEVELS; do
  N=$((C * PER_WORKER))
  seq "$N" | xargs -P "$C" -I{} bash -c one > "$WORK_DIR/r$C"
  sort -k2 -n "$WORK_DIR/r$C" | awk -v c="$C" '
    { code[NR] = $1; t[NR] = $2 }
    $1 ~ /^2/   { ok++ }
    $1 == "429" { thr++ }
    $1 ~ /^5/   { err++ }
    END {
      other = NR - ok - thr - err
      p50 = t[int(NR * 0.50 + 0.5)]; p95 = t[int(NR * 0.95 + 0.5)]
      printf "%-8s %-8d %-6d %-6d %-6d %-6d %-8.2f %-8.2f %-8.2f\n", c, NR, ok, thr, err, other, p50, p95, t[NR]
    }'
  # แสดงสถานะที่ไม่ใช่ 2xx เพื่อดูว่าเป็น 429 จาก API Gateway หรือ 5xx จาก Lambda
  awk '$1 !~ /^2/ {print $1}' "$WORK_DIR/r$C" | sort | uniq -c | awk '{printf "           สถานะ %s x %s\n", $2, $1}'
  sleep "$PAUSE"
done

END=$(date -u -d "+2 min" +%Y-%m-%dT%H:%M:00Z)
echo
echo "ดู Lambda throttle ช่วงที่ทดสอบ (รอ 1–2 นาทีให้ metric มาถึง):"
echo "  aws cloudwatch get-metric-statistics --region us-east-1 --namespace AWS/Lambda --metric-name Throttles \\"
echo "    --start-time $START --end-time $END --period 60 --statistics Sum --output table"
echo "  aws cloudwatch get-metric-statistics --region us-east-1 --namespace AWS/Lambda --metric-name ConcurrentExecutions \\"
echo "    --start-time $START --end-time $END --period 60 --statistics Maximum --output table"
