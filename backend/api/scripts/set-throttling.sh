#!/usr/bin/env bash
# ตั้ง Throttling ของ Stage $default (V4) ให้ API Gateway ตอบ 429 ก่อนที่ Lambda จะเต็ม
#   - ค่าเริ่มต้นของทุก route (DefaultRouteSettings)
#   - route สร้าง PDF ซึ่งหนักที่สุด (RouteSettings) ตั้งต่ำกว่า เพื่อไม่ให้กินโควตา Lambda ของ route อื่น
# รันซ้ำได้: เขียนทับค่าเดิมทุกครั้ง
#
# ใช้: API_ID=39eee8bl4b bash backend/api/scripts/set-throttling.sh
#      DRY_RUN=1 ... แสดงค่าเดิมและค่าที่จะตั้ง โดยไม่แก้อะไร
#
# ที่มาของค่าเริ่มต้น (ดู docs/api-design.md หัวข้อ 7):
#   โควตา Lambda ทั้งบัญชีรันพร้อมกันได้ 10 และใช้ร่วมกันทุกฟังก์ชัน
#   ทุก route: 20 req/s ≈ เปิดหน้าเว็บได้ราว 7 หน้าต่อวินาที, burst 10 = โควตา Lambda
#   GET /claims/{id}/pdf ใช้ CPU มากที่สุดและเขียน S3 ผู้ใช้สร้างทีละใบ จึงจำกัด 1 req/s
set -euo pipefail

: "${API_ID:?ต้องตั้งค่า API_ID เช่น API_ID=39eee8bl4b}"
REGION="${REGION:-us-east-1}"
STAGE_NAME='$default'
RATE_LIMIT="${RATE_LIMIT:-20}"     # request ต่อวินาที (เฉลี่ย) ของทั้ง API
BURST_LIMIT="${BURST_LIMIT:-10}"   # request ที่รับได้ในทันทีเมื่อมาพร้อมกัน
PDF_ROUTE='GET /claims/{id}/pdf'
PDF_RATE="${PDF_RATE:-1}"
PDF_BURST="${PDF_BURST:-2}"
DRY_RUN="${DRY_RUN:-0}"

show() {
  aws apigatewayv2 get-stage --api-id "$API_ID" --stage-name "$STAGE_NAME" --region "$REGION" \
    --query '{Default:DefaultRouteSettings.{Rate:ThrottlingRateLimit,Burst:ThrottlingBurstLimit},Routes:RouteSettings}' \
    --output json
}

echo "1. Throttling ปัจจุบัน:"
show

echo "2. ค่าที่จะตั้ง:"
echo "   ทุก route        rate=$RATE_LIMIT/s burst=$BURST_LIMIT"
echo "   $PDF_ROUTE  rate=$PDF_RATE/s burst=$PDF_BURST"

# ตรวจว่า route PDF มีอยู่จริง (ชื่อ route ผิด = ค่าไม่ถูกใช้โดยไม่มี error)
aws apigatewayv2 get-routes --api-id "$API_ID" --region "$REGION" \
  --query 'Items[].RouteKey' --output text | tr '\t' '\n' | grep -qxF "$PDF_ROUTE" \
  || { echo "   ไม่พบ route '$PDF_ROUTE' ใน API (รัน bind-lambdas.sh ก่อน)"; exit 1; }

if [ "$DRY_RUN" = "1" ]; then
  echo "DRY_RUN=1 ไม่ได้แก้ค่า"
  exit 0
fi

aws apigatewayv2 update-stage --api-id "$API_ID" --stage-name "$STAGE_NAME" --region "$REGION" \
  --default-route-settings "ThrottlingRateLimit=$RATE_LIMIT,ThrottlingBurstLimit=$BURST_LIMIT" \
  --route-settings "{\"$PDF_ROUTE\":{\"ThrottlingRateLimit\":$PDF_RATE,\"ThrottlingBurstLimit\":$PDF_BURST}}" \
  >/dev/null

echo "3. Throttling หลังตั้งค่า:"
show
echo "เสร็จ: request ที่เกินจะได้ 429 {\"message\":\"Too Many Requests\"} จาก API Gateway (ไม่ถึง Lambda)"
