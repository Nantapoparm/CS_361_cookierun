#!/bin/bash
# รันซ้ำได้: ถ้ามี Log group/Stage อยู่แล้วจะอัปเดตแทน
# ใช้: API_ID=39eee8bl4b ./setup-stage.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash บน Windows: ไม่ให้แปลง /aws/apigateway/... เป็น path ของ Windows

# กำหนดตัวแปร
API_ID="${API_ID:?ต้องตั้งค่า API_ID เช่น API_ID=39eee8bl4b}"
REGION="us-east-1"
STAGE_NAME='$default'
LOG_GROUP_NAME="/aws/apigateway/cookierun-claim-api"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
LOG_GROUP_ARN="arn:aws:logs:${REGION}:${ACCOUNT_ID}:log-group:${LOG_GROUP_NAME}"

echo "1. Creating CloudWatch Log Group: $LOG_GROUP_NAME with 7-day retention..."
# ข้ามเฉพาะกรณีมีอยู่แล้ว (ถ้าเป็น error อื่นจะหยุดและแสดงข้อความ)
if ! OUT=$(aws logs create-log-group --log-group-name "$LOG_GROUP_NAME" --region "$REGION" 2>&1); then
  echo "$OUT" | grep -q ResourceAlreadyExistsException && echo "   (มีอยู่แล้ว ข้ามไป)" || { echo "$OUT"; exit 1; }
fi
aws logs put-retention-policy --log-group-name "$LOG_GROUP_NAME" \
  --retention-in-days 7 --region "$REGION"

echo "2. Preparing access log settings (JSON)..."
# sub = Cognito user id ของผู้เรียก (ว่างเมื่อไม่มี token), authError = สาเหตุที่ JWT Authorizer ตอบ 401
# ห้ามเพิ่ม header Authorization หรือ claim ที่เป็นข้อมูลส่วนบุคคล (เช่น email) ลงใน Log
LOG_JSON=$(mktemp)
trap 'rm -f "$LOG_JSON"' EXIT
LOG_URI="file://$LOG_JSON"
command -v cygpath >/dev/null 2>&1 && LOG_URI="file://$(cygpath -m "$LOG_JSON")"   # Git Bash บน Windows: aws.exe ต้องใช้ path แบบ Windows
cat > "$LOG_JSON" << EOF
{"DestinationArn":"$LOG_GROUP_ARN","Format":"{\"requestId\":\"\$context.requestId\",\"ip\":\"\$context.identity.sourceIp\",\"requestTime\":\"\$context.requestTime\",\"httpMethod\":\"\$context.httpMethod\",\"routeKey\":\"\$context.routeKey\",\"status\":\"\$context.status\",\"protocol\":\"\$context.protocol\",\"responseLength\":\"\$context.responseLength\",\"extendedRequestId\":\"\$context.extendedRequestId\",\"sub\":\"\$context.authorizer.claims.sub\",\"authError\":\"\$context.authorizer.error\"}"}
EOF

echo "3. Setting up API Gateway Stage: $STAGE_NAME with Auto-deploy..."
if aws apigatewayv2 get-stage --api-id "$API_ID" --stage-name "$STAGE_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws apigatewayv2 update-stage --api-id "$API_ID" --stage-name "$STAGE_NAME" \
    --auto-deploy --access-log-settings "$LOG_URI" --region "$REGION" >/dev/null
  echo "   อัปเดต Stage แล้ว"
else
  aws apigatewayv2 create-stage --api-id "$API_ID" --stage-name "$STAGE_NAME" \
    --auto-deploy --access-log-settings "$LOG_URI" --region "$REGION" >/dev/null
  echo "   สร้าง Stage แล้ว"
fi

# update-stage ข้างบนไม่ส่ง --default-route-settings จึงไม่แตะ Throttling เดิม (ตั้งด้วย set-throttling.sh)
echo "4. Throttling (ค่าเดิม ว่าง = ยังไม่ได้ตั้ง):"
aws apigatewayv2 get-stage --api-id "$API_ID" --stage-name "$STAGE_NAME" --region "$REGION" \
  --query 'DefaultRouteSettings.{RateLimit:ThrottlingRateLimit,BurstLimit:ThrottlingBurstLimit}' --output table

echo "5. Invoke URL:"
aws apigatewayv2 get-api --api-id "$API_ID" --region "$REGION" --query ApiEndpoint --output text
echo "Setup Complete!"