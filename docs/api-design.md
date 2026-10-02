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

### 2.3 การทำงานร่วมกันผ่าน IAM Role แบบ Dynamic ARN

- **Requirement:** ทีมพัฒนา V2 ใน AWS Account บัญชีรวมผ่านโครงสร้างผู้ใช้งานและ IAM Role
- **Decision:** ไม่ใช้การ Hard-code ค่า AWS Account ID ในไฟล์ `openapi.yaml` แต่ใช้ตัวแปร `${aws:accountId}` และ `${aws:region}` แทน
- **Trade-off:** ช่วยเพิ่มความปลอดภัยและทำตามหลัก Security (Principle of Least Privilege) ป้องกันการหลุดรั่วของข้อมูลประจำตัวลงใน Git Repository และช่วยให้การทำ Infrastructure Integration ยืดหยุ่นมากขึ้น
