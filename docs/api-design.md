# API Design (V2–V4) — API Gateway

ไฟล์หลัก: [`backend/api/openapi.yaml`](../backend/api/openapi.yaml) (นำเข้า API Gateway แบบ HTTP API ได้)

## 1. API Contract

> **V3:** ทุก Route ต้องส่ง `Authorization: Bearer <Cognito ID Token หรือ Access Token>` ถ้าไม่มีหรือไม่ถูกต้อง API Gateway ตอบ `401` เองโดยไม่เรียก Lambda

### 1.1 Route ของ V2

ตารางนี้เป็นสัญญาปัจจุบัน (V3) ของ Route ที่มีตั้งแต่ V2 Lambda ระบุผู้ใช้จาก Token แล้ว ไม่รับ `userId` หรือ `role` ใน body

| Method | Route | หน้าที่ | ชื่อ Lambda (Prefix: `cookierun-`) | Status ที่คืน |
|---|---|---|---|---|
| GET | `/claims?term=&status=&statusId=&userId=` | รายการคำขอของตนเอง (`userId` ใช้ได้เฉพาะ admin) | `cookierun-getClaims` | 200, 400, 403 |
| POST | `/claims` | สร้างคำขอ `draft` จาก `offeringId`, `month`, `items[]` (1 วิชา / 1 เดือน) | `cookierun-createClaim` | 201, 400, 403, 404, 409 |
| GET | `/claims/{id}` | รายละเอียดคำขอ (เจ้าของหรือ admin) | `cookierun-getClaimById` | 200, 403, 404 |
| PUT | `/claims/{id}` | แทนที่ `items[]` ของคำขอ `draft` / `returned` | `cookierun-updateClaim` | 200, 400, 403, 404, 409 |
| POST | `/claims/{id}/submit` | ยื่นคำขอพร้อม `printMethod` (draft / returned → submitted) | `cookierun-submitClaim` | 200, 400, 403, 404, 409 |
| GET | `/terms` | ภาคการศึกษาและรอบการเบิก | `cookierun-getTerms` | 200 |
| GET | `/rates` | อัตราค่าตอบแทนและเพดานชั่วโมง | `cookierun-getRates` | 200 |
| GET | `/uploads/presigned-url?filename=&contentType=` | Presigned URL (PUT) อายุ 300 วินาที | `cookierun-getPresignedUrl` | 200, 400 |

### 1.2 Route ของ V3

ทุก Route อาจคืน `401` (ไม่มี token), `403` (ไม่พบผู้ใช้ที่ผูกกับ `cognitoSub` หรือไม่มีสิทธิ์) และ `500` เพิ่มจากที่ระบุ

| Method | Route | หน้าที่ | Lambda | Status ที่คืน |
|---|---|---|---|---|
| GET | `/schedule?month=YYYY-MM` | คาบของเดือน + รายวิชาของภาคนั้น | `cookierun-getSchedule` | 200, 400 |
| POST | `/schedule` | เพิ่มคาบ คาบเดียวหรือซ้ำทุกสัปดาห์ถึง `repeatUntil` ประเภทคาบดูจาก `description` | `cookierun-postSchedule` | 200, 400 |
| PUT | `/schedule/{id}` | แก้คาบของตนเอง ทำเครื่องหมายงดสอนด้วย `description: cancelled` | `cookierun-putSchedule` | 200, 400, 404 |
| DELETE | `/schedule/{id}` | ลบคาบของตนเอง | `cookierun-deleteSchedule` | 200, 400, 404 |
| POST | `/claims/autofill` | ร่างรายการงานจากปฏิทิน (ยังไม่สร้างคำขอ หน้าเว็บสร้างต่อด้วย `POST /claims`) | `cookierun-autofillClaim` | 200, 400, 404 |
| PUT | `/claims/{id}/print-method` | เปลี่ยนช่องทางยื่น | `cookierun-claimWorkflow` | 200, 400, 404 |
| GET | `/claims/{id}/actions` | ประวัติการดำเนินการของคำขอ (`claims_histories`) | `cookierun-claimWorkflow` | 200, 404 |
| POST | `/claims/{id}/cancel` | ผู้ขอยกเลิกคำขอ `submitted` → `draft` (`reason` ไม่บังคับ) | `cookierun-claimWorkflow` | 200, 400, 404, 409 |
| DELETE | `/claims/{id}` | ลบร่างของตนเอง พร้อม `work_information` และ `claims_histories` ของคำขอ | `cookierun-deleteClaim` | 200, 404, 409 |
| GET | `/claims/{id}/pdf?type=claim\|blank` | สร้าง PDF คืน Presigned URL (ก่อนอนุมัติได้ฉบับตัวอย่าง) | `cookierun-generatePdf` | 200, 400, 404, 409 |
| GET | `/admin/claims?role=&status=&month=&offeringId=&printMethod=&q=` | รายการคำขอทั้งหมด + จำนวนตามสถานะ (ไม่รวมร่าง) | `cookierun-admin` | 200, 400 |
| GET | `/admin/claims/{id}` | รายละเอียดสำหรับตรวจ พร้อมประวัติ | `cookierun-admin` | 200, 404 |
| POST | `/admin/claims/{id}/review` | approve / reject / return | `cookierun-admin` | 200, 400, 404, 409 |
| POST | `/admin/claims/{id}/printed` | บันทึกว่าเจ้าหน้าที่พิมพ์แล้ว | `cookierun-admin` | 200, 404, 409 |
| POST | `/admin/claims/{id}/documents-received` | รับเอกสารที่เซ็นแล้ว | `cookierun-admin` | 200, 404, 409 |
| POST | `/admin/claims/send-to-finance` | ส่งการเงินเป็นชุด | `cookierun-admin` | 200, 400, 404, 409 |
| POST | `/admin/claims/mark-paid` | บันทึกเงินเข้าเป็นชุด `sent_to_finance` → `paid` | `cookierun-admin` | 200, 400, 404, 409 |
| POST | `/admin/claims/{id}/cancel` | ยกเลิก `submitted` / `approved` / `documents_received` → `draft` (`note` บังคับ) | `cookierun-admin` | 200, 400, 404, 409 |

- Lambda ของ V3 ส่วนใหญ่รวมหลาย Route ไว้ในฟังก์ชันเดียวตามฟีเจอร์ แล้วแยกการทำงานด้วย path และ method ยกเว้นปฏิทินคาบสอน (`/schedule`) ที่แยก Lambda ต่อ method และการลบร่าง (`cookierun-deleteClaim`)
- `ClaimStatus` ของ V3: `draft`, `submitted`, `returned`, `approved`, `rejected`, `documents_received`, `sent_to_finance`, `paid`
- `POST /claims/{id}/submit` ได้ `409` เมื่อมีคาบในสัปดาห์เดียวกัน (จันทร์–อาทิตย์) และวิชาเดียวกันอยู่ในคำขออื่นที่ไม่ใช่ `draft` / `rejected` แล้ว
- ไม่มี Route `/work-days` และ `/current-period`: วันทำงานของนักศึกษาช่วยงานใช้ `/schedule` ร่วมกับอาจารย์ / TA และหน้าเว็บคำนวณรอบการเบิกปัจจุบันจากวันที่เอง

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
| 401 | ไม่มี token / token ไม่ถูกต้องหรือหมดอายุ (API Gateway ตอบเอง body เป็น `{"message":"Unauthorized"}`) | - |
| 403 | เข้าสู่ระบบแล้วแต่ไม่มีสิทธิ์ | `FORBIDDEN` |
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
- **V3:** เพิ่ม method `DELETE` (Route ปฏิทิน) และลบ `X-User-Id` ออกจาก Headers เพราะ Lambda อ่านผู้ใช้จาก Token แล้ว
- **CORS กับ 401:** API Gateway ใส่ header CORS ให้ทุก response รวมถึง `401` จาก Authorizer หน้าเว็บจึงอ่าน status `401` ได้ (ไม่กลายเป็น CORS error) และพากลับหน้า Login ได้ ส่วน preflight `OPTIONS` ไม่ผ่าน Authorizer เพราะ API Gateway ตอบเอง (ห้ามสร้าง route `OPTIONS` หรือ `$default` เอง ไม่เช่นนั้น preflight จะโดน 401)

### 2.5 JWT Authorizer (Cognito) บน HTTP API เดิม (V3)

- **Requirement:** ทุก Route ต้องเข้าสู่ระบบ และ Lambda ต้องรู้ว่าใครเรียกโดยเชื่อถือได้ (แทน `X-User-Id` ที่ปลอมได้)
- **Decision:** เพิ่ม JWT Authorizer ชื่อ `cognitoJwt` บน HTTP API `39eee8bl4b` เดิม ผ่าน `securitySchemes` ใน `openapi.yaml` และผูกทุก operation ด้วย `security: [ { cognitoJwt: [] } ]`

| ค่า | |
|---|---|
| Identity source | `$request.header.Authorization` (รูปแบบ `Bearer <token>`) |
| Issuer | `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_tGEzAfQt2` |
| Audience | `5ikoqjohoavik8c91f3ph9qeck` (App Client ของหน้าเว็บ) |

- API Gateway ตรวจลายเซ็น (JWKS ของ User Pool), `exp`, `iss` และ `aud` (ID Token) หรือ `client_id` (Access Token) จึงรับได้ทั้งสองแบบ
- Lambda อ่านผู้เรียกจาก `event.requestContext.authorizer.jwt.claims` (`sub`, `cognito:groups`) แทน `X-User-Id`
- **ไม่ได้ใช้ Authorizer ตรวจบทบาท:** JWT Authorizer ของ HTTP API ตรวจได้แค่ scope ไม่ใช่ `cognito:groups` Route `/admin/*` จึงต้องให้ Lambda ตรวจว่าเป็น `admin` แล้วตอบ `403`
- **Trade-off:** ไม่ต้องเขียน Lambda Authorizer เอง ไม่มีค่าใช้จ่ายและ Latency เพิ่ม และ request ที่ไม่มี token ไม่ถึง Lambda/RDS เลย สิ่งที่แลกคือสิทธิ์ตามบทบาทยังต้องตรวจซ้ำในทุก Lambda
- **ผลกระทบตอน deploy:** หลัง reimport หน้าเว็บ V2 ที่ยังไม่ส่ง token จะได้ `401` ทุก Route ทันที ต้อง deploy พร้อมกับหน้า Login หรือแจ้งทีมก่อน

### 2.6 Lambda ของ V3 รวม Route ตามฟีเจอร์

- **Requirement:** V3 เพิ่ม 18 Route Lambda deploy ด้วยมือ และทุกตัวต้องอัปเดต Layer เป็นเวอร์ชันเดียวกัน
- **Decision:** Route ใหม่ใช้ Lambda 9 ฟังก์ชัน ส่วนใหญ่รวมตามฟีเจอร์ (`autofillClaim`, `claimWorkflow`, `generatePdf`, `admin`) และแยกการทำงานด้วย path และ method ส่วนปฏิทินคาบสอนแยกต่อ method (`getSchedule`, `postSchedule`, `putSchedule`, `deleteSchedule`) และการลบร่างแยกเป็น `deleteClaim` ตามที่เจ้าของ Lambda เลือก Route ของ V2 คง Lambda เดิม
- **Trade-off:** ได้จำนวน Lambda ที่ต้อง deploy และอัปเดต Layer น้อยลง (9 แทน 18) สิ่งที่แลกคือต้องเขียน routing ในโค้ด ส่วนสิทธิ์ IAM ปัจจุบันทุก Lambda ใช้ Role `cookierun-lambda-role` ร่วมกัน

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
| `sub` | Cognito user id ของผู้เรียก จาก `$context.authorizer.claims.sub` ใช้ไล่ย้อนหลังว่าใครเรียก ว่างเมื่อถูกปฏิเสธด้วย 401 |
| `authError` | สาเหตุที่ Authorizer ปฏิเสธ จาก `$context.authorizer.error` ว่างเมื่อผ่าน |

`sub` เป็น UUID ที่ไม่ใช่ข้อมูลส่วนบุคคลโดยตรง จับคู่กับผู้ใช้ได้ผ่าน `user_information.cognitoSub` เท่านั้น จึงเพิ่มได้โดยไม่ขัดข้อกำหนดด้านล่าง ส่วน `email` และ token ยังห้ามลง Log

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
- เพิ่ม `RUN_ROUTES=1` เพื่อทดสอบทุก route (ต้องผูก Lambda แล้ว และ V3 ต้องตั้ง `TOKEN` ด้วย)
- ทดสอบ Authorizer ทุกครั้ง: ไม่มี token / token ปลอมต้องได้ `401` และ `401` ต้องมี `access-control-allow-origin` ตั้ง `TOKEN` เพิ่มเพื่อทดสอบว่ามี token แล้วได้ `200` จาก Lambda
- ปรับ origin ที่ทดสอบได้ด้วย `ORIGIN`, `LOCAL_ORIGIN`, `BAD_ORIGIN`
- Origin ที่อนุญาต: `https://d2ye2fegyyx6ls.cloudfront.net` และ localhost 3000/5500/8000

## 5. ผูก Lambda กับ API Gateway

สคริปต์ `backend/api/scripts/bind-lambdas.sh` ผูก Lambda `cookierun-*` เข้ากับ route ของ API

```bash
API_ID=39eee8bl4b bash backend/api/scripts/bind-lambdas.sh
```

สคริปต์ทำสิ่งต่อไปนี้
1. Reimport `backend/api/openapi.yaml` โดยแทน `ACCOUNT_ID` ด้วย Account ID จริง
2. อ่านรายการ route → Lambda จาก API จริง แล้วให้สิทธิ์ `lambda:InvokeFunction` แยกตาม route (ข้ามถ้ามีอยู่แล้ว)
3. ตรวจ Stage `$default`, Access Log และ CORS
4. ตรวจว่ามี JWT Authorizer ที่ issuer ถูกต้อง และทุก route ผูก Authorizer นั้นแล้ว

ข้อควรรู้
- ต้องรันจากโฟลเดอร์ repo บน `main` ล่าสุด เพราะ reimport เขียนทับ CORS ทั้งก้อนด้วยค่าในไฟล์ (สคริปต์หยุดถ้าไม่พบ origin CloudFront)
- ตั้ง `SKIP_IMPORT=1` เพื่อข้าม reimport และตรวจ/ให้สิทธิ์อย่างเดียว
- รันซ้ำได้โดยไม่เกิดข้อผิดพลาด
- Lambda ที่ยังไม่ deploy จะถูกข้ามและแจ้งเป็นหมายเหตุ (ไม่นับเป็นข้อผิดพลาด) เมื่อเพื่อน deploy Lambda ของ V3 แล้วให้รันซ้ำด้วย `SKIP_IMPORT=1` เพื่อให้สิทธิ์ API Gateway เรียก Lambda

## 6. เปิดใช้ JWT Authorizer (V3)

> หลังขั้นที่ 2 หน้าเว็บ V2 บน CloudFront จะได้ `401` ทุก Route จนกว่าหน้า Login (#75) จะ deploy ควรนัดเวลากับทีมก่อน

รันใน AWS CloudShell (ต้องเปิด `ALLOW_USER_PASSWORD_AUTH` ใน App Client ก่อน จึงจะใช้ `get-token.sh` ได้)

```bash
# 1) Access Log รูปแบบใหม่ (เพิ่ม sub, authError) และดู Throttling เดิม
API_ID=39eee8bl4b bash backend/api/scripts/setup-stage.sh

# 2) Reimport openapi.yaml (สร้าง Authorizer + route V3) และตรวจว่าทุก route ผูก Authorizer
API_ID=39eee8bl4b bash backend/api/scripts/bind-lambdas.sh

# 3) ทดสอบ
export API_URL=https://39eee8bl4b.execute-api.us-east-1.amazonaws.com
TOKEN=$(bash backend/api/scripts/get-token.sh)
TOKEN="$TOKEN" bash backend/api/tests/smoke-test.sh

# 4) หลักฐาน curl -i
curl -i "$API_URL/rates"                                     # ไม่มี token → 401
curl -i -H "Authorization: Bearer $TOKEN" "$API_URL/rates"   # มี token → 200 จาก Lambda

# 5) Access Log ที่มี sub (รอสักครู่ให้ Log มาถึง)
aws logs tail /aws/apigateway/cookierun-claim-api --since 10m --region us-east-1 | grep '"sub"'
```

ตรวจใน Console: API Gateway → `Teaching Compensation Claim API` → Authorization → แท็บ Manage authorizers (ค่า `cognitoJwt`) และแท็บ Attach authorizers to routes (ทุก route ต้องมี `JWT Auth`)
## 7. รองรับการใช้งานพร้อมกัน (V4)

### 7.1 ข้อจำกัดจริงของระบบ (ตรวจเมื่อ 2026-11-01)

| รายการ | ค่า | ผลต่อ API |
|---|---|---|
| โควตา Lambda ของบัญชี (`ConcurrentExecutions`, `us-east-1`) | **10** (ค่าปกติของ AWS คือ 1000) | ทั้ง 17 ฟังก์ชันใช้ 10 ช่องนี้ร่วมกัน ถ้ามีงานพร้อมกันเกิน 10 Lambda จะปฏิเสธทันทีและผู้ใช้ได้ error ตั้ง Reserved Concurrency ไม่ได้ เพราะ AWS ต้องเหลือช่องที่ไม่ได้จองไว้อย่างน้อย 100 |
| เวลาที่ Lambda ใช้ต่อ request ในวันปกติ (p50) | `getTerms` 12–70 ms, `admin` 20–45 ms, `generatePdf` 0.2–0.8 วิ (cold start ราว 0.4 วิ ทุกฟังก์ชัน, PDF สูงสุด 1.4 วิ) | ช่องของ Lambda ถูกใช้สั้นมาก route ทั่วไปรับได้หลายร้อย req/s ก่อนชนโควตา |
| เวลาที่ผู้ใช้รอ (จากเครื่องในไทย) | ราว 0.85 วิ ต่อ request | ส่วนใหญ่เป็นเวลาเดินทางของเครือข่ายไทย ↔ `us-east-1` ไม่ใช่เวลาของ Lambda |
| วันที่ระบบช้าผิดปกติ (2026-10-19) | `admin` สูงสุด 30 วิ และ `generatePdf` 60 วิ (ชน timeout), p95 ของ PDF 32 วิ | Concurrency แตะ **10** เต็มโควตา ทั้งที่มีแค่ทีมทดสอบ (1,829 invocations ทั้งวัน) เพราะ request ที่ค้างถือช่องไว้นาน |
| Throttling ของ Stage `$default` | ก่อน V4 ยังไม่ได้ตั้ง (ใช้ค่าบัญชี 10,000 req/s) | API Gateway ส่ง request ทุกตัวต่อไปให้ Lambda แม้ Lambda รับไม่ไหว (ตั้งแล้วใน 7.2) |
| Access Log ของ API | Log group `/aws/apigateway/cookierun-claim-api` ถูกลบเมื่อ 2026-10-19 | ไม่มี Access Log ระหว่าง 2026-10-19 ถึง 2026-11-01 และ `update-stage` ทุกครั้งล้มเหลว (`LogDestinationNotFoundException`) สร้างใหม่ด้วย `setup-stage.sh` แล้วเมื่อ 2026-11-01 |

จำนวน request ต่อวินาทีที่รับได้ประมาณ `โควตา ÷ เวลาที่ Lambda ใช้ต่อ request` (ไม่ใช่เวลาที่ผู้ใช้รอ) ในวันปกติ `admin` 10 ÷ 0.045 วิ ≈ 220 req/s แต่ถ้า Lambda ค้างแบบวันที่ 19 ต.ค. (30 วิ) จะเหลือ 10 ÷ 30 ≈ 0.3 req/s ข้อจำกัดของโควตา 10 จึงเห็นผลเมื่อระบบช้าลง ไม่ใช่ตอนทำงานปกติ

### 7.2 Throttling ที่ API Gateway

- **Requirement:** เมื่อมี request เข้ามาเกินที่ระบบรับได้ (ผู้ใช้พร้อมกันมาก หน้าเว็บเรียกซ้ำผิดพลาด หรือสคริปต์ยิงถี่) ต้องปฏิเสธอย่างมีรูปแบบที่ API Gateway ก่อนถึง Lambda และ RDS และ route ที่หนักต้องไม่กินโควตาของ route อื่น
- **Decision:** ตั้ง Throttling ของ Stage ด้วย [`set-throttling.sh`](../backend/api/scripts/set-throttling.sh)

| Route | Rate (req/s) | Burst | เหตุผล |
|---|---|---|---|
| ทุก route (ค่าเริ่มต้น) | 20 | 10 | หน้าเว็บหนึ่งหน้าเรียก 2–3 request 20 req/s จึงเท่ากับเปิดหน้าได้ราว 7 หน้าต่อวินาที เกินการใช้งานจริงของคณะ burst 10 เท่ากับโควตา Lambda แม้ทุก request เป็น cold start (0.4 วิ) ก็ใช้ไม่เกิน 8 ช่อง |
| `GET /claims/{id}/pdf` | 1 | 2 | สร้าง PDF ใช้ CPU มากที่สุดและเขียนไฟล์ลง S3 ผู้ใช้สร้างทีละใบ 1 req/s จึงพอ และจำกัดความเสียหายเมื่อ PDF ช้าผิดปกติแบบวันที่ 19 ต.ค. |

- request ที่เกินจะได้ `429 {"message":"Too Many Requests"}` จาก API Gateway โดยไม่ถึง Lambda และ RDS ฝั่งหน้าเว็บควรรอแล้วลองใหม่ (1, 2, 4 วินาที)
- **Trade-off:** Throttling กันปริมาณ request ที่เข้ามา แต่ไม่ได้แก้กรณีที่ Lambda ช้าลงเอง (แบบวันที่ 19 ต.ค.) กรณีนั้นใช้ Alarm (`cookierun-lambda-concurrency-high`, `cookierun-api-latency-p95`) ให้รู้ตัวแทน HTTP API ตั้ง Throttling ได้ระดับ Stage และ route เท่านั้น ไม่มี Usage Plan แยกต่อผู้ใช้แบบ REST API ผู้ใช้คนเดียวที่ยิงถี่จึงทำให้คนอื่นได้ 429 ได้ ระบบนี้มีผู้ใช้ไม่มากและทุก route ต้อง login จึงยอมรับได้ ค่า rate/burst ต้องปรับใหม่เมื่อได้โควตา Lambda เพิ่ม (คอขวดถัดไปคือจำนวน connection ของ RDS `db.t3.micro`)

### 7.3 Load Test และ Alarm

```bash
export API_URL=https://39eee8bl4b.execute-api.us-east-1.amazonaws.com API_ID=39eee8bl4b
export TOKEN=$(bash backend/api/scripts/get-token.sh)   # ใช้บัญชี admin ถ้าจะยิง /admin/claims

# 1) วัดก่อนตั้ง Throttling (อ่านอย่างเดียว)
bash backend/api/tests/load-test.sh                                          # GET /terms ที่ 1, 5, 10, 20, 30
ROUTE=/admin/claims LEVELS="10 20 30 40" bash backend/api/tests/load-test.sh

# 2) สร้าง Log group ของ Access Log (ถ้าไม่มี) แล้วตั้ง Throttling (DRY_RUN=1 เพื่อดูค่าก่อน)
bash backend/api/scripts/setup-stage.sh
bash backend/api/scripts/set-throttling.sh

# 3) วัดซ้ำด้วยคำสั่งเดียวกับข้อ 1

# 4) Alarm: 5xx, latency p95, Lambda throttles, concurrency ใกล้โควตา (รันซ้ำหลังได้โควตาเพิ่ม)
bash backend/api/scripts/setup-alarms.sh
```

- load test ใช้โควตา Lambda ร่วมกับทั้งบัญชี ระหว่างรันเพื่อนในทีมอาจเรียก API ไม่ได้ ควรนัดเวลาก่อน
- เครื่องเดียวในไทยยิงได้ราว `จำนวนพร้อมกัน ÷ 0.85` req/s (40 พร้อมกัน ≈ 47 req/s) ซึ่งยังไม่พอทำให้ Lambda ที่ใช้เวลา 10–50 ms เต็มโควตา จึงใช้ผลนี้พิสูจน์ Throttling ของ API Gateway ได้ แต่พิสูจน์เพดาน Lambda ไม่ได้
- หลังรัน `bind-lambdas.sh` (reimport) ให้ตรวจว่า Throttling ยังอยู่ด้วย `DRY_RUN=1 bash backend/api/scripts/set-throttling.sh` ถ้าหายหรือเปลี่ยนชื่อ route PDF ให้รันใหม่

**ผลการทดสอบ** (2026-11-01 จากเครื่องในไทย, request ละ 5 ครั้งต่อ worker)

ก่อนตั้ง Throttling

| Route | พร้อมกัน | ≈ req/s | 2xx | 429 | 5xx | p95 (วิ) |
|---|---|---|---|---|---|---|
| `GET /terms` | 1 | 1 | 5 | 0 | 0 | 0.89 |
| `GET /terms` | 5 | 6 | 25 | 0 | 0 | 1.02 |
| `GET /terms` | 10 | 12 | 50 | 0 | 0 | 0.91 |
| `GET /terms` | 20 | 24 | 100 | 0 | 0 | 0.90 |
| `GET /terms` | 30 | 35 | 150 | 0 | 0 | 0.89 |
| `GET /admin/claims` | 10 | 12 | 50 | 0 | 0 | 1.49 |
| `GET /admin/claims` | 20 | 24 | 100 | 0 | 0 | 0.92 |
| `GET /admin/claims` | 30 | 35 | 150 | 0 | 0 | 0.88 |
| `GET /admin/claims` | 40 | 47 | 200 | 0 | 0 | 0.88 |

CloudWatch ช่วงที่ทดสอบ: Lambda `ConcurrentExecutions` สูงสุด 6 (`/terms`) และ 7 (`/admin/claims`), `Throttles` = 0, `admin` ใช้เวลาเฉลี่ย 49 ms (p95 71 ms)

หลังตั้ง Throttling (ทุก route 20 req/s burst 10)

| Route | พร้อมกัน | ≈ req/s | 2xx | 429 | 5xx | p95 (วิ) |
|---|---|---|---|---|---|---|
| `GET /admin/claims` | 10 | 12 | 50 | 0 | 0 | 1.53 |
| `GET /admin/claims` | 20 | 24 | 100 | 0 | 0 | 0.93 |
| `GET /admin/claims` | 30 | 35 | 137 | 13 | 0 | 0.91 |
| `GET /admin/claims` | 40 | 47 | 173 | 27 | 0 | 0.90 |

CloudWatch ช่วงที่ทดสอบ: Lambda `ConcurrentExecutions` สูงสุด 8, `Throttles` = 0, API Gateway 5xx = 0, RDS `CPUUtilization` ไม่เกิน 5% และ Alarm `cookierun-lambda-concurrency-high` (เกณฑ์ ≥ 8) เปลี่ยนเป็น `ALARM` ตอนทดสอบ

สรุปผล:
- เกิน 20 req/s แล้ว API Gateway ตอบ `429` แทนการส่งต่อให้ Lambda (30 พร้อมกันถูกปฏิเสธ 9%, 40 พร้อมกัน 14%) ส่วน request ที่ผ่านยังเร็วเท่าเดิม (p95 ไม่ถึง 1 วิ) และไม่มี 5xx
- ที่ 20 พร้อมกัน (≈24 req/s) ยังไม่มี 429 เพราะ burst 10 รับส่วนที่เกินในช่วงสั้น ๆ ของการทดสอบไว้ได้ และ request จากเครื่องเดียวไม่ได้มาถึงพร้อมกันทุกตัว
- Alarm concurrency ทำงานจริง: เครื่องเดียวยิง 40 พร้อมกันก็ทำให้ Lambda ใช้ 8 จาก 10 ช่อง ถ้ามีผู้ใช้จริงเพิ่มเข้ามาพร้อมกันจะเริ่มชนโควตา ซึ่งยืนยันว่าโควตา 10 คือข้อจำกัดหลักของระบบ
- smoke test (`RUN_ROUTES=1`, token admin) หลังตั้ง Throttling ไม่มี route ใดได้ 429 (55/56 ผ่าน ข้อที่ไม่ผ่านคือ `DELETE /schedule/{id}` ได้ 500 เพราะ Lambda ต่อ RDS ไม่ได้ (timeout) ตอน cold start ไม่เกี่ยวกับ Throttling)

### 7.4 สิ่งที่ต้องทำเมื่อใช้งานจริง (นอกขอบเขตของ API)

- ขอเพิ่มโควตา Lambda concurrency เป็น 1000 ผ่าน Service Quotas แล้วปรับ rate/burst ตามผล load test
- ใช้ RDS Proxy หรือขยาย instance เมื่อ concurrency สูงขึ้น เพื่อไม่ให้ connection ของ RDS เต็ม
- ใส่ Lambda ไว้หลาย subnet หลาย AZ (ปัจจุบัน 15 จาก 17 ฟังก์ชันอยู่ `us-east-1a` subnet เดียว) และพิจารณา RDS Multi-AZ
- หน้าเว็บลองใหม่อัตโนมัติเมื่อได้ `429`
