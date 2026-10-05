#!/usr/bin/env bash
# ผูก Lambda cookierun-* เข้ากับ API Gateway
#   1) reimport openapi.yaml โดยแทน ACCOUNT_ID ด้วย Account ID จริง
#   2) อ่านรายการ route -> Lambda จาก API จริง แล้วให้สิทธิ์ apigateway เรียก Lambda ทีละ route
#   3) ตรวจ Stage / Access Log / CORS หลัง reimport
# รันซ้ำได้: สิทธิ์ที่มีอยู่แล้วจะถูกข้าม

set -euo pipefail

: "${API_ID:?ต้องตั้งค่า API_ID เช่น API_ID=39eee8bl4b}"
REGION="${REGION:-us-east-1}"
OPENAPI="${OPENAPI:-backend/api/openapi.yaml}"
EXPECT_ORIGIN="${EXPECT_ORIGIN:-https://d2ye2fegyyx6ls.cloudfront.net}"
SKIP_IMPORT="${SKIP_IMPORT:-0}"

ACCT=$(aws sts get-caller-identity --query Account --output text)

# ---------- 1) Reimport ----------
if [ "$SKIP_IMPORT" != "1" ]; then
  echo "1) Reimport $OPENAPI"
  [ -s "$OPENAPI" ] || { echo "   ไม่พบไฟล์หรือไฟล์ว่าง: $OPENAPI (ต้องรันจากโฟลเดอร์ repo)"; exit 1; }
  # กันใช้ไฟล์เก่า: reimport จะเขียนทับ CORS ทั้งก้อนด้วยค่าในไฟล์
  grep -qF "$EXPECT_ORIGIN" "$OPENAPI" || {
    echo "   ไฟล์นี้ไม่มี origin $EXPECT_ORIGIN (น่าจะเป็นเวอร์ชันเก่า) ให้ git pull main ก่อน"; exit 1; }
  TMP=$(mktemp)
  trap 'rm -f "$TMP"' EXIT
  sed "s/ACCOUNT_ID/$ACCT/g" "$OPENAPI" > "$TMP"
  [ -s "$TMP" ] || { echo "   สร้างไฟล์ชั่วคราวไม่สำเร็จ (ว่าง)"; exit 1; }
  if grep -q "ACCOUNT_ID" "$TMP"; then echo "   ยังเหลือ ACCOUNT_ID ในไฟล์"; exit 1; fi
  aws apigatewayv2 reimport-api --api-id "$API_ID" --region "$REGION" --body "file://$TMP" >/dev/null
  echo "   reimport สำเร็จ"
else
  echo "1) ข้าม reimport (SKIP_IMPORT=1)"
fi

# ---------- 2) ให้สิทธิ์ Lambda ตาม route จริง ----------
echo "2) ให้สิทธิ์ API Gateway เรียก Lambda"
declare -A URI
while IFS=$'\t' read -r id uri; do
  [ -n "$id" ] && URI[$id]="$uri"
done < <(aws apigatewayv2 get-integrations --api-id "$API_ID" --region "$REGION" \
          --query 'Items[].[IntegrationId,IntegrationUri]' --output text)

BAD=0; N=0
printf '   %-28s %-26s %s\n' "ROUTE" "LAMBDA" "ผล"
while IFS=$'\t' read -r key target; do
  [ -z "$key" ] && continue
  [ "$key" = '$default' ] && continue
  N=$((N+1))
  uri="${URI[${target#integrations/}]:-}"
  fn=$(printf '%s' "$uri" | sed -n 's#.*:function:\([^/:]*\).*#\1#p')
  if [ -z "$fn" ]; then
    printf '   %-28s %-26s %s\n' "$key" "-" "ไม่มี integration ที่ชี้ Lambda"; BAD=$((BAD+1)); continue
  fi
  if ! aws lambda get-function --function-name "$fn" --region "$REGION" >/dev/null 2>&1; then
    printf '   %-28s %-26s %s\n' "$key" "$fn" "ไม่พบ Lambda (ยังไม่ได้ deploy?)"; BAD=$((BAD+1)); continue
  fi

  method="${key%% *}"; path="${key#* }"
  arnpath=$(printf '%s' "$path" | sed 's/{[^}]*}/*/g')
  src="arn:aws:execute-api:${REGION}:${ACCT}:${API_ID}/*/${method}${arnpath}"

  policy=$(aws lambda get-policy --function-name "$fn" --region "$REGION" --query Policy --output text 2>/dev/null || true)
  if printf '%s' "$policy" | grep -qF "\"$src\""; then
    printf '   %-28s %-26s %s\n' "$key" "$fn" "มีสิทธิ์อยู่แล้ว"; continue
  fi

  tail=$(printf '%s' "${method}${path}" | tr -c 'A-Za-z0-9' '-')
  sid="apigw-${API_ID}-${fn#cookierun-}-${tail}"
  if out=$(aws lambda add-permission --function-name "$fn" --region "$REGION" \
        --statement-id "$sid" --action lambda:InvokeFunction \
        --principal apigateway.amazonaws.com --source-arn "$src" 2>&1); then
    printf '   %-28s %-26s %s\n' "$key" "$fn" "เพิ่มสิทธิ์แล้ว"
  elif printf '%s' "$out" | grep -q ResourceConflictException; then
    printf '   %-28s %-26s %s\n' "$key" "$fn" "มีสิทธิ์อยู่แล้ว (statement id ซ้ำ)"
  else
    printf '   %-28s %-26s %s\n' "$key" "$fn" "ผิดพลาด: $out"; BAD=$((BAD+1))
  fi
done < <(aws apigatewayv2 get-routes --api-id "$API_ID" --region "$REGION" \
          --query 'Items[].[RouteKey,Target]' --output text)

[ "$N" -gt 0 ] || { echo "   ไม่พบ route ใน API"; exit 1; }

# ---------- 3) ตรวจ Stage / Access Log / CORS ----------
echo "3) ตรวจ Stage และ CORS"
AUTO=$(aws apigatewayv2 get-stage --api-id "$API_ID" --stage-name '$default' --region "$REGION" \
        --query AutoDeploy --output text 2>&1 || true)
LOGDEST=$(aws apigatewayv2 get-stage --api-id "$API_ID" --stage-name '$default' --region "$REGION" \
        --query AccessLogSettings.DestinationArn --output text 2>&1 || true)
case "$LOGDEST" in ""|None|*rror*) LOGMSG="ไม่ได้ตั้ง"; BAD=$((BAD+1)) ;; *) LOGMSG="ตั้งไว้" ;; esac
[ "$AUTO" = "True" ] || [ "$AUTO" = "true" ] || BAD=$((BAD+1))
echo "   Stage \$default: AutoDeploy=$AUTO, Access Log=$LOGMSG"

ORIGINS=$(aws apigatewayv2 get-api --api-id "$API_ID" --region "$REGION" \
           --query 'CorsConfiguration.AllowOrigins' --output text 2>&1 || true)
case "$ORIGINS" in
  *"$EXPECT_ORIGIN"*) echo "   CORS: มี origin $EXPECT_ORIGIN" ;;
  *) echo "   CORS: ไม่พบ origin $EXPECT_ORIGIN (AllowOrigins: $ORIGINS)"; BAD=$((BAD+1)) ;;
esac

echo "Invoke URL: $(aws apigatewayv2 get-api --api-id "$API_ID" --region "$REGION" --query ApiEndpoint --output text)"
if [ "$BAD" -gt 0 ]; then echo "สรุป: มี $BAD รายการที่ต้องแก้ (จาก $N route)"; exit 1; fi
echo "สรุป: ผูกครบ $N route"
