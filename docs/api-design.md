# API Design (V2) — API Gateway

ไฟล์หลัก: [`backend/api/openapi.yaml`](../backend/api/openapi.yaml) (นำเข้า API Gateway แบบ HTTP API ได้)

## 1. API Contract

| Method | Route | หน้าที่ | ชื่อ Lambda (Prefix: `cookierun-`) | Status ที่คืน |
|---|---|---|---|---|
| GET | `/claims?userId=&term=&status=` | ดึงรายการคำขอ (Dashboard) | `cookierun-getClaims` | 200, 400, 500 |
| POST | `/claims` | สร้างคำขอใหม่/บันทึกร่าง | `cookierun-createClaim` | 201, 400, 500 |
| GET | `/claims/{id}` | ดูรายละเอียดคำขอ (รวมสถานะ) | `cookierun-getClaimById` | 200, 404, 500 |
| PUT | `/claims/{id}` | แก้ไขคำขอที่เป็นร่าง | `cookierun-updateClaim` | 200, 400, 404, 409, 500 |
| POST | `/claims/{id}/submit` | ยื่นคำขอ (draft → submitted) | `cookierun-submitClaim` | 200, 400, 404, 409, 500 |
| GET | `/terms` | ภาคการศึกษาและรอบการเบิก | `cookierun-getTerms` | 200, 500 |
| GET | `/rates` | อัตราค่าตอบแทน | `cookierun-getRates` | 200, 500 |
| GET | `/uploads/presigned-url` | ขอ URL สำหรับอัปโหลดไฟล์หลักฐาน | `cookierun-getPresignedUrl` | 200, 500 |

*(ตัวอย่าง Request/Response ของทุก Route สามารถดูได้ในไฟล์ `openapi.yaml` ฟิลด์ `example`)*

### รูปแบบ Response มาตรฐาน (เหมือนกันทุก Route)

**กรณีสำเร็จ:**

```json
{
  "success": true,
  "data": { ... }
}
```

**กรณีเกิดข้อผิดพลาด:**

```json
{
  "success": false,
  "error": { "code": "NOT_FOUND", "message": "ไม่พบคำขอ" }
}
```

| Status | ความหมาย | error.code |
|---|---|---|
| 200 / 201 | สำเร็จ / สร้างสำเร็จ | - |
| 400 | ข้อมูลที่ส่งมาไม่ถูกต้อง | `VALIDATION_ERROR` |
| 404 | ไม่พบข้อมูล | `NOT_FOUND` |
| 409 | สถานะไม่อนุญาต (แก้หรือยื่นซ้ำหลังยื่นแล้ว) | `INVALID_STATE` |
| 500 | ข้อผิดพลาดภายใน เช่น เชื่อมต่อ RDS ไม่ได้ | `INTERNAL_ERROR` |

## 2. Architecture & Design Decisions

ในการออกแบบ API สำหรับ V2 ทีมได้ตัดสินใจเชิงสถาปัตยกรรม (Architecture Decision) ไว้ดังนี้:

### 2.1 เลือกใช้ HTTP API แทน REST API

- **Requirement:** ต้องการ API Gateway ที่รับส่งข้อมูลแบบไดนามิกกับ Lambda ได้รวดเร็วและคุ้มค่า
- **Decision:** เลือกใช้ HTTP API
- **Trade-off:** สิ่งที่ได้คือต้นทุนที่ถูกกว่า Latency ที่ต่ำกว่า และมีการจัดการ CORS แบบ Preflight ในตัว ทำให้ไม่ต้องเขียนโค้ดจัดการ CORS ใน Lambda สิ่งที่ต้องแลก (Trade-off) คือขาดฟีเจอร์ขั้นสูงอย่าง WAF, API Key หรือ Request Validation ซึ่งยังไม่จำเป็นสำหรับ V2 หากมีความจำเป็นใน V3/V4 จะพิจารณาปรับสถาปัตยกรรมอีกครั้ง

### 2.2 การจัดการไฟล์หลักฐานด้วย S3 Pre-signed URL

- **Requirement:** ผู้ใช้งานต้องสามารถแนบไฟล์หลักฐานเข้าสู่ระบบได้อย่างปลอดภัย โดยที่ข้อมูลต้องไม่หลุดรั่ว
- **Decision:** ใช้กลไกการให้สิทธิ์ชั่วคราวผ่าน S3 Presigned URL สำหรับการอัปโหลดไฟล์
- **Trade-off:** สิ่งที่ได้คือลดภาระและลด Latency ของ API Gateway/Lambda ลงได้อย่างมาก เพราะ Frontend จะยิงไฟล์ตรงเข้า S3 ผ่าน URL ชั่วคราว สิ่งที่ต้องแลกมาคือความซับซ้อนในการพัฒนาที่เพิ่มขึ้น (Frontend ต้องยิง Request 2 รอบ: ขอ URL และอัปโหลดไฟล์)
- **ต้องแยก bucket ของไฟล์หลักฐานออกจาก bucket ของ Frontend:** ไฟล์หลักฐานมีข้อมูลส่วนบุคคล และ bucket ของ Frontend ถูก CI/CD sync ทับอยู่เสมอ (ไฟล์ที่ผู้ใช้อัปโหลดอาจถูกลบหรือถูกเขียนทับ) จึงใช้ bucket แยก เป็น private และปิด Public Access
- **ข้อกำหนดที่ต้องตั้งค่าเพิ่ม:** bucket ของไฟล์หลักฐานต้องตั้ง CORS (อนุญาต `PUT` จาก Origin ของ Frontend คือโดเมน CloudFront) แยกจาก CORS ของ API Gateway และ Lambda `cookierun-getPresignedUrl` ต้องมีสิทธิ์ `s3:PutObject` กับ prefix `uploads/` ของ bucket นั้นเท่านั้น

### 2.3 การทำงานร่วมกันใน AWS Account เดียวผ่าน IAM User/Group

- **Requirement:** ทีมพัฒนา V2 ใน AWS Account เดียวกัน โดยสมาชิกแต่ละคนมีสิทธิ์เฉพาะงานของตนเอง ไม่ใช้สิทธิ์ผู้ดูแลระบบร่วมกัน
- **Decision:** แบ่งสิทธิ์ด้วย IAM Group ตามหน้าที่ (เช่น `ApiDev` ของงาน API Gateway) และไม่ Hard-code AWS Account ID ลงใน `openapi.yaml` แต่ใช้ placeholder `ACCOUNT_ID` แล้วแทนค่าตอนนำเข้าด้วยคำสั่ง `aws sts get-caller-identity` และ `sed` (ขั้นตอนอยู่ในคอมเมนต์ต้นไฟล์)
- **เหตุผลที่ไม่ใช้ `${aws:accountId}`:** API Gateway ไม่แทนค่าตัวแปรรูปแบบนี้ให้ตอน Import จึงทำให้ ARN ของ Lambda ไม่ถูกต้อง
- **Trade-off:** สิ่งที่ได้คือไม่มี Account ID ในไฟล์ใน Git, แยกสิทธิ์ตามหน้าที่ได้ตามหลัก Least Privilege และตรวจสอบย้อนหลังได้ว่าใครทำอะไร สิ่งที่ต้องแลกคือมีขั้นตอนแทนค่าก่อน Import และต้องดูแลสิทธิ์ของแต่ละ Group ให้เพียงพอ (เช่น สิทธิ์ให้ API Gateway เรียก Lambda ด้วย `lambda:AddPermission`)

### 2.4 Origin ของ Frontend และ CORS

- **Requirement:** เบราว์เซอร์ของผู้ใช้ต้องเรียก API Gateway ข้ามโดเมนได้ โดยไม่เปิดกว้างเกินจำเป็น
- **Decision:** อนุญาตเฉพาะ Origin `https://d2ye2fegyyx6ls.cloudfront.net` (Frontend ผ่าน CloudFront) และ `http://localhost:3000`, `:5500`, `:8000` สำหรับพัฒนา ไม่ใช้ `*` และไม่ใช้ S3 Website Endpoint เดิม เพราะ bucket ของ Frontend เป็น private และผู้ใช้เข้าผ่าน CloudFront เท่านั้น
- **Headers:** `Content-Type` และ `Authorization` (เพิ่มไว้ล่วงหน้าสำหรับ V3 ที่ Login แล้วส่ง token ผ่าน header นี้)
- **Trade-off:** การเพิ่ม `Authorization` ตั้งแต่ V2 ยังไม่มีผลใช้งานจริงและไม่เพิ่มความเสี่ยง แต่ทำให้ไม่ต้องแก้ CORS และ import ใหม่ตอน V3 ส่วน localhost ควรเอาออกก่อนส่ง V7 เพราะไม่ควรเปิดค้างบนระบบจริง

## 3. Stage และ Access Log (V2)

### 3.1 การตั้งค่าที่ใช้งานอยู่

| รายการ | ค่า |
|---|---|
| API | `Teaching Compensation Claim API` (HTTP API, ApiId `39eee8bl4b`) |
| Region | `us-east-1` (ตามที่ทีมตกลงใน Issue S3 Bucket) |
| Stage | `$default` เปิด Auto-deploy ไว้ จึงไม่มี prefix ของ Stage ใน URL (`/claims` ไม่ใช่ `/prod/claims`) ตรงกับ Contract |
| **Invoke URL** | `https://39eee8bl4b.execute-api.us-east-1.amazonaws.com` |
| Access Log | CloudWatch Logs กลุ่ม `/aws/apigateway/cookierun-claim-api` |
| อายุการเก็บ Log | 7 วัน (ลดค่าเก็บ Log ในบัญชีที่ใช้ร่วมกัน) |
| สร้างด้วย | [`backend/api/scripts/setup-stage.sh`](../backend/api/scripts/setup-stage.sh) (รันซ้ำได้) |

### 3.2 วิธีเรียกใช้ API

Frontend ใช้ Invoke URL ข้างบนเป็น base URL แล้วต่อด้วย route ตาม Contract เช่น

```bash
curl -i https://39eee8bl4b.execute-api.us-east-1.amazonaws.com/rates
```

Frontend (บน CloudFront) เรียก API Gateway โดยตรง ไม่ผ่าน CloudFront ดังนั้นต้องตั้ง CORS ตามหัวข้อ 2.4 เบราว์เซอร์จึงเรียกได้

### 3.3 Access Log

**รูปแบบ:** JSON หนึ่งบรรทัดต่อหนึ่งคำขอที่ตรงกับ route ใน Contract

| ฟิลด์ | ความหมาย |
|---|---|
| `requestId` | รหัสคำขอ ตรงกับ header `apigw-requestid` ใน response ใช้ไล่หาคำขอที่ผู้ใช้แจ้งปัญหา |
| `ip` | IP ของผู้เรียก |
| `requestTime` | เวลาที่รับคำขอ |
| `httpMethod` | เช่น `GET`, `POST` |
| `routeKey` | route ที่ตรงกับคำขอ เช่น `GET /claims/{id}` |
| `status` | HTTP status ที่ API Gateway ตอบกลับ |
| `protocol` | เวอร์ชัน HTTP |
| `responseLength` | ขนาด response (ไบต์) |
| `extendedRequestId` | รหัสคำขอแบบขยาย ใช้อ้างอิงกับฝ่ายสนับสนุนของ AWS |

ตัวอย่างบรรทัด Log (IP ถูกเบลอ):

```json
{"requestId":"ErGlsg1YoAMEMmw=","ip":"x.x.x.x","requestTime":"03/Oct/2026:15:24:19 +0000","httpMethod":"GET","routeKey":"GET /rates","status":"500","protocol":"HTTP/1.1","responseLength":"35"}
```

**วิธีดู Log**

```bash
# ดู Log ย้อนหลัง 15 นาที
aws logs tail /aws/apigateway/cookierun-claim-api --since 15m --region us-east-1

# ไล่คำขอด้วย requestId ที่ได้จาก header apigw-requestid
aws logs tail /aws/apigateway/cookierun-claim-api --since 1h --region us-east-1 | grep "<requestId>"
```

หรือใน Console: CloudWatch → Log groups → `/aws/apigateway/cookierun-claim-api` → เลือก Log stream → Log events

**ข้อสังเกตที่ตรวจพบจากการทดสอบ**
- Log มาถึงช้ากว่าคำขอเล็กน้อย (หลักวินาทีถึงไม่กี่สิบวินาที) หากยิงแล้วยังไม่เห็น ให้รอแล้วดึงซ้ำ
- **คำขอไปยัง path ที่ไม่มี route ตรงกัน (ตอบ `404`) ไม่ปรากฏใน Access Log** (สังเกตซ้ำในการทดสอบ 3 รอบ) จึงตรวจการเรียกผิด path จาก Log นี้ไม่ได้
- รูปแบบ Log ไม่เก็บ body และไม่เก็บ header ใดๆ ตั้งใจเว้น `Authorization` ไว้เพื่อไม่ให้ token หลุดลง Log เมื่อเพิ่ม Login ใน V3 ห้ามเพิ่มฟิลด์ที่มีข้อมูลส่วนบุคคลหรือ token ลงในรูปแบบ Log

### 3.4 พฤติกรรมก่อนผูก Lambda (ทดสอบเมื่อ 2026-10-03)

| คำขอ | Status | Body | อยู่ใน Access Log |
|---|---|---|---|
| `GET /rates` (มี route, ยังไม่มี Lambda) | `500` | `{"message":"Internal Server Error"}` | พบ |
| `GET /claims/c001` (มี route, ยังไม่มี Lambda) | `500` | `{"message":"Internal Server Error"}` | พบ (`routeKey` เป็น `GET /claims/{id}`) |
| `GET /not-a-route` (ไม่มี route) | `404` | `{"message":"Not Found"}` | ไม่พบ |

response ที่ API Gateway สร้างเอง (404 ไม่มี route, 500 เมื่อยังไม่มี Lambda) มีรูปแบบ `{"message": "..."}` ไม่ใช่รูปแบบ `{ success, data, error }` ของ Contract ซึ่งจะเกิดเฉพาะเมื่อ Lambda เป็นผู้ตอบ ฝั่ง Frontend ควรตรวจ status code ก่อน แล้วอ่าน `error.message` หรือ `message` ตามที่มี

### 3.5 สิทธิ์ที่ผู้เปิด Log ต้องมี

`logs:CreateLogDelivery`, `logs:PutResourcePolicy`, `logs:UpdateLogDelivery`, `logs:DeleteLogDelivery`, `logs:CreateLogGroup`, `logs:DescribeResourcePolicies`, `logs:GetLogDelivery`, `logs:ListLogDeliveries` (เพิ่ม `logs:PutRetentionPolicy` สำหรับตั้งอายุ Log)

ร่าง policy ตัวอย่างอยู่ที่ [`backend/api/iam/api-logs-permission.json`](../backend/api/iam/api-logs-permission.json) **ยังไม่ได้ทดสอบกับกลุ่ม `ApiDev`** ผู้ใช้ในกลุ่ม `Admins` รันสคริปต์ได้อยู่แล้ว

### 3.6 สร้างซ้ำ

```bash
API_ID=39eee8bl4b ./backend/api/scripts/setup-stage.sh
```

สคริปต์สร้าง Log group, ตั้งอายุ 7 วัน, สร้างหรืออัปเดต Stage `$default` พร้อมเปิด Access Log และพิมพ์ Invoke URL เมื่อรันซ้ำจะอัปเดตค่าเดิมโดยไม่สร้างของซ้ำ

## 4. ทดสอบ CORS และ API (Smoke Test)

สคริปต์ `backend/api/tests/smoke-test.sh` ทดสอบ CORS preflight ของ API Gateway

```bash
API_URL=https://39eee8bl4b.execute-api.us-east-1.amazonaws.com bash backend/api/tests/smoke-test.sh
```

- ค่าเริ่มต้นทดสอบเฉพาะ CORS (ไม่ต้องมี Lambda) และ exit 0 เมื่อผ่านทั้งหมด
- เพิ่ม `RUN_ROUTES=1` เพื่อทดสอบทุก route (ต้องผูก Lambda แล้ว)
- ปรับ origin ที่ทดสอบได้ด้วย `ORIGIN`, `LOCAL_ORIGIN`, `BAD_ORIGIN`
- Origin ที่อนุญาต: `https://d2ye2fegyyx6ls.cloudfront.net` และ localhost 3000/5500/8000