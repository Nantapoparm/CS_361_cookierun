#!/usr/bin/env bash
# สร้าง CloudWatch Alarm ของ API (V4) 4 ตัว ให้รู้เมื่อระบบเริ่มรับโหลดไม่ไหว
#   cookierun-api-5xx                 API Gateway ตอบ 5xx (Lambda error หรือถูก throttle)
#   cookierun-api-latency-p95         เวลาตอบ p95 ของทั้ง API สูงเกินกำหนด
#   cookierun-lambda-throttles        Lambda ถูก throttle (ทุกฟังก์ชันรวมกัน)
#   cookierun-lambda-concurrency-high Lambda รันพร้อมกันใกล้โควตาของบัญชี (คิดจากโควตาจริงตอนรัน)
# รันซ้ำได้: put-metric-alarm เขียนทับ alarm ชื่อเดิม (รันใหม่หลังได้โควตาเพิ่ม เพื่อปรับเกณฑ์ concurrency)
#
# ใช้: API_ID=39eee8bl4b bash backend/api/scripts/setup-alarms.sh
#      ALARM_TOPIC_ARN=arn:aws:sns:...  ส่งแจ้งเตือนเข้า SNS topic (ไม่ตั้ง = ดูสถานะใน Console อย่างเดียว)
set -euo pipefail

: "${API_ID:?ต้องตั้งค่า API_ID เช่น API_ID=39eee8bl4b}"
REGION="${REGION:-us-east-1}"
ALARM_TOPIC_ARN="${ALARM_TOPIC_ARN:-}"
P95_MS="${P95_MS:-3000}"            # เกณฑ์ p95 (มิลลิวินาที)
ERR_5XX="${ERR_5XX:-5}"             # จำนวน 5xx ใน 5 นาที
CONC_PCT="${CONC_PCT:-80}"          # % ของโควตา Lambda ที่ถือว่าใกล้เต็ม

ACTIONS=()
[ -n "$ALARM_TOPIC_ARN" ] && ACTIONS=(--alarm-actions "$ALARM_TOPIC_ARN" --ok-actions "$ALARM_TOPIC_ARN")

LIMIT=$(aws lambda get-account-settings --region "$REGION" --query AccountLimit.ConcurrentExecutions --output text)
CONC_AT=$(( (LIMIT * CONC_PCT + 99) / 100 ))
echo "โควตา Lambda ของบัญชี = $LIMIT -> แจ้งเตือนเมื่อรันพร้อมกัน >= $CONC_AT"

# alarm <ชื่อ> <คำอธิบาย> <อาร์กิวเมนต์ put-metric-alarm ที่เหลือ...>
alarm() {
  local name=$1 desc=$2; shift 2
  aws cloudwatch put-metric-alarm --region "$REGION" --alarm-name "$name" --alarm-description "$desc" \
    --period 300 --evaluation-periods 1 --treat-missing-data notBreaching ${ACTIONS[@]+"${ACTIONS[@]}"} "$@"
  echo "   ตั้ง $name แล้ว"
}

alarm cookierun-api-5xx "API Gateway $API_ID ตอบ 5xx >= $ERR_5XX ครั้งใน 5 นาที" \
  --namespace AWS/ApiGateway --metric-name 5xx --dimensions Name=ApiId,Value="$API_ID" \
  --statistic Sum --threshold "$ERR_5XX" --comparison-operator GreaterThanOrEqualToThreshold

alarm cookierun-api-latency-p95 "เวลาตอบ p95 ของ API $API_ID เกิน ${P95_MS} ms ใน 5 นาที" \
  --namespace AWS/ApiGateway --metric-name Latency --dimensions Name=ApiId,Value="$API_ID" \
  --extended-statistic p95 --threshold "$P95_MS" --comparison-operator GreaterThanThreshold

alarm cookierun-lambda-throttles "มี Lambda ถูก throttle (โควตาทั้งบัญชี $LIMIT)" \
  --namespace AWS/Lambda --metric-name Throttles \
  --statistic Sum --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold

alarm cookierun-lambda-concurrency-high "Lambda รันพร้อมกัน >= $CONC_AT จากโควตา $LIMIT" \
  --namespace AWS/Lambda --metric-name ConcurrentExecutions \
  --statistic Maximum --threshold "$CONC_AT" --comparison-operator GreaterThanOrEqualToThreshold

echo "สถานะ alarm:"
aws cloudwatch describe-alarms --region "$REGION" --alarm-name-prefix cookierun- \
  --query 'MetricAlarms[].[AlarmName,StateValue,Threshold]' --output table
