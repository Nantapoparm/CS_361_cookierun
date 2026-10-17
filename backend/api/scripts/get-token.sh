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
set -euo pipefail

REGION="${REGION:-us-east-1}"
CLIENT_ID="${CLIENT_ID:-5ikoqjohoavik8c91f3ph9qeck}"
TOKEN_TYPE="${TOKEN_TYPE:-IdToken}"   # IdToken หรือ AccessToken (Authorizer รับได้ทั้งคู่)

if [ -z "${COGNITO_USER:-}" ]; then
  read -rp "Cognito username (email): " COGNITO_USER </dev/tty >&2
fi
read -rsp "Password: " COGNITO_PASS </dev/tty; echo >&2

TOKEN=$(aws cognito-idp initiate-auth --region "$REGION" --client-id "$CLIENT_ID" \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters "USERNAME=$COGNITO_USER,PASSWORD=$COGNITO_PASS" \
  --query "AuthenticationResult.$TOKEN_TYPE" --output text)
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
