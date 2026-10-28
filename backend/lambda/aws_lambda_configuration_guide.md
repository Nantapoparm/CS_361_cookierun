# เอกสารคู่มือการตั้งค่าและการทำงานของ AWS Lambda Functions
## ระบบเบิกค่าตอบแทนการสอน (CS361 Version 3)

---
## 1. ภาพรวมสถาปัตยกรรม (Architecture Overview)

ระบบ V3 ปรับเปลี่ยนการยืนยันตัวตนและการเข้าถึงข้อมูลจากระบบ V2 เดิม (ที่ใช้อิงตาม Header `X-User-Id`) มาเป็นการยืนยันตัวตนด้วย **Cognito JWT Token** ผ่าน **API Gateway HTTP API (Payload Format 2.0)** 

```
[ Frontend Client ] 
        │
        ▼ (Header Authorization: Bearer <JWT_Token>)
[ AWS API Gateway (JWT Authorizer) ] 
        │ (Validate Signature & Audience)
        ▼
[ AWS Lambda Functions ] ◄── (Shared Layer: db.py, validation.py, pymysql)
        │ 
        ├─► [ RDS MySQL (cs361_compensation) ]
        └─► [ S3 Bucket (cookierun-uploads) ]
```

### การยืนยันตัวตนและการตรวจสอบสิทธิ์ (Authentication & Authorization)
1. **API Gateway Level:** ตรวจสอบความถูกต้อง ลายเซ็นดิจิทัล (Signature) และอายุของ Token ผ่าน Cognito User Pool Authorizer
2. **Lambda Level (`db.py` / `run_auth`):** 
   - ดึงค่า `sub` (UUID) จาก `event["requestContext"]["authorizer"]["jwt"]["claims"]`
   - นำ `sub` ไป Query ค้นหา `userId` และบทบาทผู้ใช้ในตาราง `user_information` ด้วยคอลัมน์ `cognitoSub`
   - ตรวจสอบ `cognito:groups` เพื่อระบุสิทธิ์ของผู้ใช้งาน (`isAdmin`) และป้องกันการปลอมแปลงสิทธิ์

---

## 2. การตั้งค่าสภาพแวดล้อม (Environment Variables)

Lambda Functions ทุกตัวในระบบ V3 จำเป็นต้องตั้งค่าตัวแปรแวดล้อม (Environment Variables) บน AWS Console (แท็บ **Configuration** -> **Environment variables**) ดังนี้:

### 2.1 ตัวแปรสำหรับเชื่อมต่อฐานข้อมูล (Database Configuration)
| Environment Variable | ตัวอย่างค่า | คำอธิบาย |
| :--- | :--- | :--- |
| `DB_HOST` | `cs361-db.c...us-east-1.rds.amazonaws.com` | Hostname / Endpoint ของ RDS MySQL Instance |
| `DB_USER` | `admin` | Username สำหรับเข้าใช้งานฐานข้อมูล |
| `DB_PASSWORD` | `**********` | Password สำหรับเข้าใช้งานฐานข้อมูล |
| `DB_NAME` | `cs361_compensation` | ชื่อ Schema/Database ที่ใช้งาน |

### 2.2 ตัวแปรสำหรับกฎเกณฑ์และสถานะระบบ (Business Logic & Mapping)
| Environment Variable | ตัวอย่างค่า | คำอธิบาย |
| :--- | :--- | :--- |
| `ACADEMIC_YEAR_OFFSET` | `543` (หรือ `0`) | ส่วนต่างการแปลงปี พ.ศ. $\leftrightarrow$ ค.ศ. (ตั้ง `543` หาก DB บันทึกเป็น ค.ศ.) |
| `PRINT_STATUS_SIGN_WITH_STAFF_ID` | `1` | `statusId` ในตาราง `print_status` สำหรับช่องทาง "ยื่นแล้วไปเซ็นที่คณะ" |
| `PRINT_STATUS_SELF_PRINT_ID` | `2` | `statusId` ในตาราง `print_status` สำหรับช่องทาง "ปริ้นเซ็นเอง" |
| `CLAIM_ACTIONS_ENABLED` | `1` | สวิตช์เปิด (`1`) / ปิด (`0`) การบันทึก Audit Log ลงตาราง `claims_histories` |
| `UPLOAD_BUCKET` / `S3_UPLOADS_BUCKET` | `cookierun-uploads` | ชื่อ AWS S3 Bucket สำหรับเก็บเอกสารและไฟล์ PDF |

### 2.3 ตัวแปรเสริม/ค่าเริ่มต้น (Optional Configuration)
| Environment Variable | ค่า Default | คำอธิบาย |
| :--- | :--- | :--- |
| `TERM_ID` | `1-2569` | ภาคการศึกษาเริ่มต้นกรณีไม่พบข้อมูลใน DB |
| `SESSION_NAME` | `normal` | ชื่อโหมดการศึกษาเริ่มต้น (`normal` = ภาคปกติ) |
| `BILLING_CYCLES_JSON` | `[...]` | โครงสร้าง JSON กำหนดรายละเอียดรอบการเบิก |

---

## 3. การจัดการ Lambda Layer (`dbvalidation`)

เพื่อลดความซ้ำซ้อนของโค้ดและไลบรารี ระบบได้แยกส่วนประกอบกลางออกเป็น **AWS Lambda Layer** โดยต้องจัดโครงสร้างไฟล์ก่อนทำการ Zip ดังนี้:

```text
python/
├── db.py            # ตัวช่วยเชื่อมต่อ DB, Cognito Auth, JSON Formatter, Response Envelope
├── validation.py    # State Machine (7 สถานะ), Validation Logic, Query Helpers, Audit Logger
└── pymysql/         # MySQL Driver Package สำหรับ Python
```

> **ข้อควรระวัง:** โฟลเดอร์ `python/` ต้องเป็นโฟลเดอร์ Root ชั้นนอกสุดเพียงชั้นเดียวในไฟล์ Zip ก่อนอัปโหลดขึ้น AWS Lambda Layer

---

## 4. สรุปหน้าที่และการทำงานของ AWS Lambda Functions (V3)

### 4.1 กลุ่มฝั่งผู้ใช้งานทั่วไป (User Operations)

#### 1. `cookierun-getTerms`
- **Route:** `GET /terms`
- **หน้าที่:** ดึงรายการภาคการศึกษา (เรียงจากใหม่ไปเก่า) และรอบการเบิกเงิน สำหรับใช้แสดงผลใน Dropdown เลือกเทอม
- **การทำงาน:** ดึงข้อมูลจาก `course_offerings` นำมาแปลงปี พ.ศ./ค.ศ. ร่วมกับค่า `ACADEMIC_YEAR_OFFSET`

#### 2. `cookierun-getRates`
- **Route:** `GET /rates`
- **หน้าที่:** ดึงอัตราค่าตอบแทนต่อชั่วโมงและเพดานชั่วโมงสูงสุดแยกตามบทบาท (`instructor`, `ta`, `student_helper`) ตาม Session ที่กำหนด

#### 3. `cookierun-getClaims`
- **Route:** `GET /claims`
- **หน้าที่:** ดึงรายการคำขอเบิกเงินทั้งหมดของผู้ใช้งาน (รองรับตัวกรอง `term`, `status`, `statusId`)
- **Security:** อนุญาตให้ผู้ใช้ดึงได้เฉพาะคำขอของตนเองเท่านั้น (หากผู้ใช้ทั่วไปส่ง `userId` อื่นจะถูกตอบกลับด้วย `403 Forbidden`)

#### 4. `cookierun-getClaimById`
- **Route:** `GET /claims/{id}`
- **หน้าที่:** ดึงรายละเอียดฉบับเต็มของคำขอใบที่ระบุ (รวมรายการคาบงาน, ยอดรวมชั่วโมง, และยอดรวมเงิน)
- **Security:** ตรวจสอบสิทธิ์ความเป็นเจ้าของคำขอ (หรือสิทธิ์ Admin)

#### 5. `cookierun-createClaim`
- **Route:** `POST /claims`
- **หน้าที่:** สร้างคำขอเบิกเงินฉบับใหม่แบบกรอกเอง (สถานะเริ่มต้น = `draft`)
- **การทำงาน:** ตรวจสอบรูปแบบข้อมูล สร้างรายวิชาใน `courses_name` และ `course_offerings` อัตโนมัติหากยังไม่มีในระบบ

#### 6. `cookierun-autofillClaim`
- **Route:** `POST /claims/autofill`
- **หน้าที่:** สร้างร่างคำขอ (`draft`) อัตโนมัติจากข้อมูลตารางสอนประจำเดือนในปฏิทิน (`teaching_histories`)
- **Business Logic:** 
  - คำนวณชั่วโมงและยอดเงินอัตโนมัติ
  - ป้องกันการสร้างคำขอซ้ำในวิชาและเดือนเดียวกัน (ตอบ `409 Conflict`)
  - ตรวจสอบเพดานชั่วโมงเบิกรวมต่อภาคการศึกษา (`maxHoursPerTerm`) และเพดานเงินสูงสุดต่อวัน (`maxAmountPerDay`)

#### 7. `cookierun-updateClaim`
- **Route:** `PUT /claims/{id}`
- **หน้าที่:** แก้ไขรายละเอียดคำขอร่าง
- **Condition:** อนุญาตให้แก้ไขได้เฉพาะคำขอที่อยู่ในสถานะ `draft` หรือ `returned` (ถูกส่งกลับมาแก้ไข) เท่านั้น

#### 8. `cookierun-submitClaim`
- **Route:** `POST /claims/{id}/submit`
- **หน้าที่:** ยื่นคำขอเบิกเงิน (`draft` / `returned` $\rightarrow$ `submitted`)
- **การทำงาน:**
  - บันทึกช่องทางยื่นเอกสาร (`printMethod`: `sign_with_staff` / `self_print`)
  - ตรวจสอบการเบิกวันทำงานซ้ำกับคำขออื่น
  - ตรวจสอบเพดานชั่วโมงและยอดเงินสูงสุด
  - เปลี่ยนสถานะผ่าน State Machine และบันทึก Audit Log ลง `claims_histories`

#### 9. `cookierun-claimWorkflow`
- **Routes:** 
  - `PUT /claims/{id}/print-method` (เปลี่ยนช่องทางยื่นเอกสาร)
  - `GET /claims/{id}/actions` (ดูประวัติการดำเนินการของคำขอ)
- **หน้าที่:** จัดการ Workflow ฝั่งผู้ใช้และแสดง Audit Log ประวัติการอนุมัติ/ส่งกลับ/พิมพ์เอกสาร

#### 10. `cookierun-getPresignedUrl`
- **Route:** `GET /uploads/presigned-url`
- **หน้าที่:** สร้าง S3 Presigned URL (HTTP PUT) อายุ 300 วินาที เพื่อให้ Frontend อัปโหลดไฟล์หลักฐานตรงเข้า S3 Bucket (`cookierun-uploads`)

#### 11. `cookierun-generatePdf`
- **Route:** `GET /claims/{id}/pdf`
- **หน้าที่:** Render เอกสาร PDF ภาษาไทย (แบบฟอร์มเบิกเงิน, แบบฟอร์มขอสอนชดเชย หรือแบบฟอร์มเปล่า) อัปโหลดขึ้น S3 และส่งคืน S3 Presigned URL อายุ 300 วินาที
- **Condition:** แบบฟอร์มเบิกฉบับจริง (`type=claim`) จะยอมให้ดาวน์โหลดได้เฉพาะคำขอที่สถานะเป็น `approved` ขึ้นไปเท่านั้น (นักศึกษาช่วยงานจะได้รับแบบฟอร์มเปล่าเสมอ)

---

### 4.2 กลุ่มฝั่งเจ้าหน้าที่ (Admin Operations)

Lambda ในกลุ่มนี้ใช้การยืนยันตัวตนผ่าน `run_auth(..., admin_only=True)` หากผู้เรียกไม่มีกลุ่มสิทธิ์ `admin` ใน Cognito JWT Token ระบบจะปฏิเสธการทำงานและส่งคืน **`403 Forbidden`** ทันที

#### `cookierun-admin` (Unified Handler)
รวมบริการสำหรับเจ้าหน้าที่ไว้ในฟังก์ชันเดียว แยกการทำงานด้วย HTTP Method และ Path Parameters:

| Path / Route | Method | หน้าที่และการทำงาน |
| :--- | :--- | :--- |
| `/admin/claims` | `GET` | ดึงรายการคำขอทั้งหมด ค้นหา/กรองได้ตามบทบาท, สถานะ, เดือน, หรือข้อความค้นหา พร้อมสรุปจำนวนแยกตามสถานะ (`counts`) |
| `/admin/claims/{id}` | `GET` | ดึงรายละเอียดคำขอฉบับเต็มเพื่อนำไปตรวจสอบ (ตารางสอนเทียบชั่วโมงสะสม) |
| `/admin/claims/{id}/review` | `POST` | บันทึกผลการตรวจคำขอ: <br>• `approve`: อนุมัติคำขอ (`submitted` $\rightarrow$ `approved`) <br>• `reject`: ปฏิเสธคำขอ (`submitted` $\rightarrow$ `rejected`) <br>• `return`: ส่งกลับแก้ไข (`submitted` $\rightarrow$ `returned` พร้อมระบุ `workIds` และหมายเหตุ) |
| `/admin/claims/{id}/printed` | `POST` | บันทึกว่าเจ้าหน้าที่ได้พิมพ์เอกสารออกมาแล้วลงใน `claims_histories` เพื่อป้องกันการพิมพ์ซ้ำ |
| `/admin/claims/{id}/documents-received` | `POST` | บันทึกการได้รับเอกสารฉบับเซ็นชื่อจริง (`approved` $\rightarrow$ `documents_received`) |
| `/admin/claims/send-to-finance` | `POST` | เปลี่ยนสถานะคำขอแบบเป็นชุด (Batch Operation) เพื่อส่งเรื่องไปยังฝั่งการเงิน (`documents_received` $\rightarrow$ `sent_to_finance`) |

---

## 5. แผนผังการเปลี่ยนสถานะคำขอ (State Machine Flow)

```text
  [ draft ] ──(submit)──► [ submitted ] ──(approve)──► [ approved ] ──(receive_documents)──► [ documents_received ]
      ▲                        │                                                                      │
      │                        ├──(return)──► [ returned ]                                            │
      └───(edit & resubmit)────┘                                                                      ▼
                               └──(reject)──► [ rejected ]                                  [ sent_to_finance ]
```

---

## 6. ข้อควรตรวจสอบในการ Deploy และแก้ไขปัญหา (Deployment & Debugging Checklist)

1. **IAM Policy ของ Lambda Role:**
   - ต้องมีสิทธิ์ `s3:PutObject` และ `s3:GetObject` บน Resource `arn:aws:s3:::cookierun-uploads/*`
   - ต้องมีสิทธิ์ AWSLambdaVPCAccessExecutionRole หาก Lambda ทำงานภายใน VPC เดียวกับ RDS
2. **CORS Setting:** API Gateway HTTP API จัดการ CORS Preflight (`OPTIONS`) ให้ตาม `openapi.yaml` ดังนั้น Lambda ไม่จำเป็นต้องแนบ Header CORS เพิ่มเติม (หรือแนบไว้เป็น Fallback)
3. **Database Timezone:** ฟังก์ชันใน `db.py` ใช้วันเวลาประเทศไทย (`Asia/Bangkok`, UTC+7) ในการบันทึกคอลัมน์ DATETIME
```

```

