#!/usr/bin/env bash
# ขอ ID Token จาก Cognito ด้วยบัญชีทดสอบ เพื่อใช้ทดสอบ JWT Authorizer
#
# ใช้ (CloudShell):
#   TOKEN=$(bash backend/api/scripts/get-token.sh)
#   TOKEN=$(COGNITO_USER=instructor@example.com bash backend/api/scripts/get-token.sh)
#
# พิมพ์ token ออก stdout อย่างเดียว ข้อความอื่นออก stderr จึงใช้กับ $(...) ได้
# รหัสผ่านถามแบบซ่อน ไม่เก็บใน history และไม่ต้องใส่ในคำสั่ง
# ต้องเปิด ALLOW_USER_PASSWORD_AUTH ใน App Client (Cognito → App clients → Authentication flows)
#
# กันรหัสผ่านหลุด:
#   - ส่ง username / password ให้ AWS CLI เป็น JSON ทาง stdin ไม่ใส่ใน argument ของคำสั่ง
#     (argument เห็นได้ใน process list และ AWS CLI พิมพ์ argument ทั้งก้อนออกมาเมื่อ parse ไม่ผ่าน)
#   - ไม่แสดง error ดิบของ AWS CLI แสดงเฉพาะชื่อ error
#   - username ต้องเป็น email ไม่อย่างนั้นหยุดก่อนถามรหัสผ่าน (กันข้อความที่วางเข้ามาผิดช่อง)
set -euo pipefail

REGION="${REGION:-us-east-1}"
CLIENT_ID="${CLIENT_ID:-5ikoqjohoavik8c91f3ph9qeck}"
TOKEN_TYPE="${TOKEN_TYPE:-IdToken}"   # IdToken หรือ AccessToken (Authorizer รับได้ทั้งคู่)

case "$TOKEN_TYPE" in
  IdToken|AccessToken) ;;
  *) echo "TOKEN_TYPE ต้องเป็น IdToken หรือ AccessToken" >&2; exit 1 ;;
esac

# ค่าใน JSON string: escape \ " และอักขระควบคุม
json_str() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\t'/\\t}
  s=${s//$'\r'/\\r}
  s=${s//$'\n'/\\n}
  printf '"%s"' "$s"
}

if [ -z "${COGNITO_USER:-}" ]; then
  read -rp "Cognito username (email): " COGNITO_USER </dev/tty >&2
fi
if ! [[ "$COGNITO_USER" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo "username ต้องเป็น email เช่น instructor@example.com (ยังไม่ได้ถามรหัสผ่าน ให้รันใหม่)" >&2; exit 1
fi

read -rsp "Password: " COGNITO_PASS </dev/tty; echo >&2
if [ -z "$COGNITO_PASS" ]; then
  echo "ไม่ได้ใส่รหัสผ่าน" >&2; exit 1
fi

ERR_FILE=$(mktemp)
trap 'rm -f "$ERR_FILE"' EXIT

# printf เป็น builtin ของ bash รหัสผ่านจึงไม่ไปอยู่ใน argument ของ process ใด
if ! TOKEN=$(printf '{"AuthFlow":"USER_PASSWORD_AUTH","ClientId":%s,"AuthParameters":{"USERNAME":%s,"PASSWORD":%s}}' \
      "$(json_str "$CLIENT_ID")" "$(json_str "$COGNITO_USER")" "$(json_str "$COGNITO_PASS")" \
    | aws cognito-idp initiate-auth --region "$REGION" --cli-input-json file:///dev/stdin \
        --query "AuthenticationResult.$TOKEN_TYPE" --output text 2>"$ERR_FILE"); then
  unset COGNITO_PASS
  CODE=$(grep -oE '\([A-Za-z]+(Exception|Error|Validation)\)' "$ERR_FILE" | head -1 | tr -d '()' || true)
  case "$CODE" in
    NotAuthorizedException) HINT="username หรือรหัสผ่านไม่ถูกต้อง หรือ App Client ยังไม่เปิด ALLOW_USER_PASSWORD_AUTH" ;;
    UserNotFoundException)  HINT="ไม่พบผู้ใช้นี้ใน User Pool" ;;
    PasswordResetRequiredException) HINT="บัญชีต้องรีเซ็ตรหัสผ่านก่อน" ;;
    UserNotConfirmedException) HINT="บัญชียังไม่ได้ยืนยัน" ;;
    *) HINT="ดูว่า AWS CLI ตั้งค่าแล้ว และ REGION / CLIENT_ID ถูกต้อง" ;;
  esac
  echo "ขอ token ไม่สำเร็จ (${CODE:-error}): $HINT" >&2
  exit 1
fi
unset COGNITO_PASS

if [ -z "$TOKEN" ] || [ "$TOKEN" = "None" ]; then
  echo "ไม่ได้ token (บัญชีอาจติด challenge เช่น NEW_PASSWORD_REQUIRED)" >&2; exit 1
fi

# แสดง sub และ groups ไว้เทียบกับ Access Log (ไม่แสดง email)
python3 - "$TOKEN" >&2 <<'EOF' || true
import base64, json, sys
p = sys.argv[1].split('.')[1]
c = json.loads(base64.urlsafe_b64decode(p + '=' * (-len(p) % 4)))
print(f"sub={c.get('sub')} groups={c.get('cognito:groups')} token_use={c.get('token_use')}")
EOF

printf '%s\n' "$TOKEN"
