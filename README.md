# CS_361_cookierun

**ระบบเบิกค่าตอบแทนการสอน (Teaching Compensation Claim System)**
โครงการกลุ่ม รายวิชา CS361 สถาปัตยกรรมซอฟต์แวร์บนคลาวด์ ภาคการศึกษาที่ 1/2569 (โจทย์ที่ 6)

`#cookierunlover007` `#cookierunlover008` `#เฉาก๋วยชากังราว`

---

## Project Vision

ระบบกลางสำหรับบริหารจัดการและตรวจสอบการเบิกค่าตอบแทนการสอน ทั้งค่าสอนของอาจารย์ ค่าตอบแทนผู้ช่วยสอน (TA) และค่าตอบแทนนักศึกษาช่วยงาน โดยสามารถปรับเปลี่ยนข้อมูลได้อย่างยืดหยุ่นเมื่อหลักเกณฑ์เปลี่ยนแปลง ลดการกรอกข้อมูลซ้ำซ้อน ลดภาระของเจ้าหน้าที่ในการติดตามการลงนามในเอกสาร และช่วยให้อาจารย์และผู้ช่วยสอนสามารถติดตามจำนวนชั่วโมงคงเหลือของตนเองได้

## Problem

ปัจจุบันยังไม่มีระบบดิจิทัลรองรับกระบวนการเบิกค่าตอบแทน กระบวนการทั้งหมดดำเนินการด้วยเอกสารกระดาษและโปรแกรม Excel โดยเจ้าหน้าที่เป็นผู้กรอกข้อมูลและจัดเตรียมเอกสารให้ล่วงหน้า อาจารย์และผู้ช่วยสอนมีหน้าที่เพียงลงลายมือชื่อ (ยกเว้นนักศึกษาช่วยงานซึ่งต้องกรอกรายละเอียดด้วยลายมือของตนเองทุกครั้ง) จากนั้นจึงส่งเอกสารให้ฝ่ายการเงินบันทึกข้อมูลเข้าสู่ระบบ Excel ปัญหาหลักที่พบคือ อาจารย์ลงนามในเอกสารล่าช้าหรือไม่มาลงนามตามกำหนดเวลา ส่งผลให้รายการนั้นถูกเลื่อนไปดำเนินการในรอบถัดไป

## Users & Roles

| บทบาท | กลุ่มใน Cognito (V3) | หมายเหตุ |
|---|---|---|
| อาจารย์ / ผู้สอน | `instructor` | ผู้มีสิทธิ์เบิก — เจ้าหน้าที่จัดเตรียมข้อมูลให้ล่วงหน้า มีหน้าที่เพียงลงลายมือชื่อ |
| ผู้ช่วยสอน (TA) | `ta` | ผู้มีสิทธิ์เบิก — เจ้าหน้าที่จัดเตรียมข้อมูลให้เช่นเดียวกัน ผ่านการอนุมัติจากสาขาวิชา |
| นักศึกษาช่วยงาน | `student_helper` | ผู้มีสิทธิ์เบิก — กรอกรายละเอียดด้วยลายมือของตนเองทุกครั้ง ผ่านการอนุมัติจากคณบดี |
| เจ้าหน้าที่ / ผู้ตรวจสอบ | `admin` | จัดเตรียมและกรอกเอกสาร ติดตามการลงนาม ตรวจสอบความครบถ้วนของข้อมูล ตรวจ/อนุมัติคำขอผ่าน Route `/admin/*` |
| ฝ่ายการเงิน | — (ไม่เข้าสู่ระบบ) | บันทึกข้อมูลเข้าสู่ระบบ Excel หรือระบบ ERP แยกต่างหาก ไม่มีการเชื่อมต่อกับระบบนี้ |
| ผู้บริหาร / ผู้ดูแลระบบ | `admin` | ดูข้อมูลภาพรวม จัดการข้อมูลพื้นฐานของระบบ |

ตั้งแต่ V3 ผู้ใช้เข้าสู่ระบบด้วย Amazon Cognito และระบบกำหนดสิทธิ์ตามกลุ่มใน `cognito:groups` ของ Token

---

## Roadmap (V1–V7)

| เวอร์ชัน | จุดเน้น |
|---|---|
| **V1 – ข้อมูลพื้นฐาน** | นำเสนอข้อมูลพื้นฐาน (อัตรา สิทธิ์ เงื่อนไข เอกสารที่ต้องใช้) ในรูปแบบเว็บไซต์คงที่ (Static) ไม่มีระบบเข้าสู่ระบบหรือแบบฟอร์ม |
| **V2 – ข้อมูลแบบพลวัต** | เพิ่มการจัดเก็บ ค้นหา และจัดการข้อมูลแบบพลวัต (Amazon RDS ร่วมกับ API Gateway และ Lambda) |
| **V3 – ธุรกรรมที่ปลอดภัย** | เพิ่มระบบเข้าสู่ระบบ การกำหนดสิทธิ์ผู้ใช้งาน มาตรการความปลอดภัย และกระบวนการอนุมัติ |
| V4 – การขยายขนาดและความพร้อมใช้งาน | รองรับจำนวนผู้ใช้งานที่เพิ่มขึ้นและการใช้งานพร้อมกัน |
| V5 – การทำงานอัตโนมัติ | จัดทำโครงสร้างพื้นฐานในรูปแบบ Infrastructure as Code |
| V6 – ประสิทธิภาพและต้นทุน | วัดผลและปรับปรุงประสิทธิภาพ พร้อมหลักฐานเปรียบเทียบก่อนและหลังการปรับปรุง |
| V7 – ระบบแบบบูรณาการ | บูรณาการทุกส่วนของระบบและทบทวนสถาปัตยกรรมโดยรวม |

## V1 — Information (Due: 31 Aug 2026)

### Goal
เพื่อให้อาจารย์ ผู้ช่วยสอน และนักศึกษาช่วยงานสามารถเข้าถึงข้อมูลพื้นฐานเกี่ยวกับค่าตอบแทนการสอนได้ โดยยังไม่จำเป็นต้องเข้าสู่ระบบหรือยื่นคำขอผ่านระบบ

### In scope
- แสดงประเภทค่าตอบแทนทั้งสามประเภท พร้อมอัตราและเพดานชั่วโมง
- แสดงเงื่อนไขและขั้นตอนโดยสังเขป (เช่น การสอนชดเชย การสอนออนไลน์ที่ต้องขออนุมัติจากคณบดี)
- แสดงรายการเอกสารที่จำเป็นต้องใช้ (ในรูปแบบสรุป มิใช่แบบฟอร์มจริง)

### Out of scope ของ V1
- ระบบเข้าสู่ระบบและการกำหนดสิทธิ์ผู้ใช้งาน (เริ่มดำเนินการใน V3)
- การสร้าง ยื่น และติดตามสถานะคำขอเบิกจริง
- แบบฟอร์มหรือใบลงลายมือชื่อจริง
- ข้อมูลแบบพลวัต (การค้นหา การกรอง หรือการแก้ไขผ่านระบบ)
- การติดตามวันที่เงินเข้าบัญชี (ฝ่ายการเงินใช้ระบบ ERP แยกต่างหาก)
- การรับ-จ่ายเงินและการส่งเอกสารจริง

### Architecture (V1)

**แนวทางที่เลือกใช้: Amazon S3 Static Website Hosting**

```
ผู้ใช้งาน (เบราว์เซอร์)
      │
      ▼
Amazon S3 (Static Website Hosting)
  ├─ index.html / style.css / app.js
  └─ compensation.json   (ข้อมูลอัตรา เงื่อนไข และเอกสารที่ต้องใช้)
```

ระบบให้บริการเว็บไซต์ทั้งหมดผ่าน S3 bucket เพียงบัคเก็ตเดียว โดยเปิดใช้งาน Static Website Hosting ข้อมูลอัตราและเงื่อนไขจัดเก็บในรูปแบบไฟล์ JSON ภายในบัคเก็ตเดียวกัน และให้ไฟล์ app.js เรียกข้อมูลมาแสดงผลด้วยคำสั่ง fetch() เหตุผลที่เลือกแนวทางนี้เนื่องจาก V1 ยังไม่จำเป็นต้องมีระบบเข้าสู่ระบบ แบบฟอร์ม หรือข้อมูลแบบพลวัต จึงไม่จำเป็นต้องมีส่วนประมวลผลฝั่งเซิร์ฟเวอร์ (Backend) ไม่มีค่าใช้จ่ายเพิ่มเติม และสามารถนำไปใช้งานได้อย่างรวดเร็ว ส่วนการเชื่อมต่อกับฐานข้อมูล หรือการแยกเป็นสองบัคเก็ต (ซึ่งต้องกำหนดค่า CORS เพิ่มเติม) จะดำเนินการในเวอร์ชัน V2 เนื่องจากเกินความจำเป็นของ V1 และมีประเด็นด้านความปลอดภัยที่ควรผ่านชั้น API ที่เหมาะสมกว่า

**ข้อควรระวังในการนำเสนอข้อมูล:** ควรเรียบเรียงข้อมูลอัตราและเงื่อนไขด้วยถ้อยคำของทีมงานเอง มิใช่การคัดลอกเอกสารระเบียบฉบับเต็ม เนื่องจากเอกสารต้นฉบับมิได้เผยแพร่สู่สาธารณะ

## V2 — Dynamic Data (Due: 6 Oct 2026)

### Goal
ให้ผู้มีสิทธิ์เบิกทั้ง 3 บทบาท คือ อาจารย์ ผู้ช่วยสอน (TA) และนักศึกษาช่วยงาน สร้าง บันทึกร่าง ยื่น และติดตามคำขอเบิกค่าตอบแทนผ่านระบบได้ โดยข้อมูลอัตราและภาคการศึกษาดึงจากแหล่งข้อมูลกลางผ่าน API แทนไฟล์ JSON คงที่ และรองรับหลายรอบการเบิกและหลายภาคการศึกษา

### In scope
- เลือกบทบาทผู้เบิกได้ 3 บทบาท (อาจารย์ ผู้ช่วยสอน นักศึกษาช่วยงาน)
- สร้างคำขอเบิก บันทึกเป็นร่าง แก้ไข และยื่นคำขอ (สถานะ `draft` และ `submitted`)
- ดูรายการคำขอของตนเอง และกรองตามภาคการศึกษาและสถานะ
- ดึงข้อมูลอัตราค่าตอบแทนและภาคการศึกษาจาก API
- Route สำหรับขอ presigned URL (`GET /uploads/presigned-url`) มีใน API แล้ว แต่ฟีเจอร์อัปโหลดยังใช้งานจริงไม่ได้
- Deploy หน้าเว็บอัตโนมัติผ่าน GitHub Actions และให้บริการผ่าน CloudFront

### Out of scope (V3+)
- ระบบเข้าสู่ระบบ การกำหนดสิทธิ์ตามบทบาท และกระบวนการตรวจสอบ/อนุมัติ (V3)
- การอัปโหลดและแนบเอกสารหลักฐานจากหน้าเว็บ
- รายงานและข้อมูลสรุปสำหรับผู้บริหาร
- Infrastructure as Code เต็มรูปแบบ (V5)
- การรับ-จ่ายเงินและการเชื่อมต่อกับระบบ ERP ของฝ่ายการเงิน

### Architecture (V2)

```
ผู้ใช้งาน (เบราว์เซอร์)
   │
   ├─► Amazon CloudFront ──► Amazon S3 (Private)      หน้าเว็บ HTML/CSS/JS
   │
   └─► Amazon API Gateway (HTTP API, Stage $default)   CORS + Access Log
          │
          ▼
       AWS Lambda (8 ฟังก์ชัน) ──► Amazon CloudWatch Logs
          │
          ├─► Amazon RDS                               คำขอเบิก อัตรา ภาคการศึกษา
          └─► Amazon S3                                เอกสารหลักฐาน (มี route แล้ว ยังไม่เปิดใช้งาน)
```

ทุกบริการอยู่ใน Region `us-east-1`

| ส่วน | บริการ | เหตุผลที่เลือก |
|---|---|---|
| หน้าเว็บ | S3 (Private) + CloudFront | ไม่เปิด bucket สู่สาธารณะ ได้ HTTPS และ cache |
| API | API Gateway แบบ HTTP API | ราคาถูกกว่า REST API และเพียงพอสำหรับ route ของ V2 |
| Logic | Lambda (หนึ่งฟังก์ชันต่อหนึ่ง route) | จ่ายตามการใช้งานจริง ปริมาณการใช้ระดับสาขาวิชามีน้อยและมาเป็นช่วง |
| ข้อมูล | Amazon RDS | ข้อมูลคำขอ รายการชั่วโมง อัตรา และภาคการศึกษามีความสัมพันธ์กัน จึงเหมาะกับฐานข้อมูลเชิงสัมพันธ์ และใช้ SQL กรองหรือสรุปข้อมูลได้ |
| Log | CloudWatch Logs | เก็บ log ของ Lambda และ Access Log ของ API Gateway |

### API

Base URL: `https://39eee8bl4b.execute-api.us-east-1.amazonaws.com`
สัญญา API ฉบับเต็มอยู่ที่ [`backend/api/openapi.yaml`](backend/api/openapi.yaml) ซึ่งเป็นแหล่งความจริงของ route และ CORS

| Method | Path | Lambda | หน้าที่ |
|---|---|---|---|
| GET | `/rates` | `cookierun-getRates` | อัตราค่าตอบแทน |
| GET | `/terms` | `cookierun-getTerms` | ภาคการศึกษา |
| GET | `/claims` | `cookierun-getClaims` | รายการคำขอ (กรองได้) |
| POST | `/claims` | `cookierun-createClaim` | สร้างคำขอ |
| GET | `/claims/{id}` | `cookierun-getClaimById` | รายละเอียดคำขอ |
| PUT | `/claims/{id}` | `cookierun-updateClaim` | แก้ไขคำขอ |
| POST | `/claims/{id}/submit` | `cookierun-submitClaim` | ยื่นคำขอ |
| GET | `/uploads/presigned-url` | `cookierun-getPresignedUrl` | ขอ URL สำหรับอัปโหลดเอกสาร (ยังไม่เปิดใช้งานจริง) |

- request ไปยัง `/claims` ทุก route ต้องส่ง header `X-User-Id`
- CORS อนุญาต origin ของ CloudFront (`https://d2ye2fegyyx6ls.cloudfront.net`) และ `localhost` สำหรับพัฒนา
- รายละเอียดการออกแบบ Stage, Access Log, CORS และการผูก Lambda อยู่ที่ [`docs/api-design.md`](docs/api-design.md)

### การทดสอบ

```bash
# ทดสอบ CORS (15 รายการ)
API_URL=https://39eee8bl4b.execute-api.us-east-1.amazonaws.com bash backend/api/tests/smoke-test.sh

# ทดสอบ CORS และทุก route (24 รายการ)
RUN_ROUTES=1 API_URL=https://39eee8bl4b.execute-api.us-east-1.amazonaws.com bash backend/api/tests/smoke-test.sh
```

สคริปต์คืน exit code 0 เมื่อผ่านทุกรายการ การทดสอบ `POST /claims` จะสร้างข้อมูลจริงในระบบ

### ข้อจำกัดที่ทราบใน V2
- ยังไม่มีการยืนยันตัวตน `X-User-Id` เป็นค่าที่ฝั่งเบราว์เซอร์ส่งมาเองและปลอมแปลงได้ จึงยังไม่ควรใช้กับข้อมูลจริง จะแทนที่ด้วยระบบเข้าสู่ระบบใน V3
- ฟีเจอร์อัปโหลดเอกสารหลักฐานยังใช้งานจริงไม่ได้ มีเฉพาะ route `GET /uploads/presigned-url`
- Smoke test ยังไม่ครอบคลุม `GET /uploads/presigned-url` และกรณีสำเร็จของ `GET/PUT /claims/{id}` กับ `submit`
- การตั้งค่า API Gateway ยังทำผ่านสคริปต์ CLI (`backend/api/scripts/`) ไม่ใช่ Infrastructure as Code
- การ import `openapi.yaml` ซ้ำจะเขียนทับค่า CORS ทั้งหมด ต้องรันสคริปต์จาก `main` ล่าสุดเท่านั้น

## V3 — Secure Transactions (Due: 19 Oct 2026)

### Goal
ให้ผู้ใช้ทุกบทบาทเข้าสู่ระบบด้วยบัญชีของตนเอง และทำธุรกรรมการเบิกได้อย่างปลอดภัยตั้งแต่สร้างคำขอจนส่งการเงิน ระบบรู้ว่าใครเป็นผู้เรียกจาก Token ที่ตรวจสอบได้ (แทน `X-User-Id` ที่ปลอมแปลงได้ใน V2) จำกัดสิทธิ์ตามบทบาท บันทึกประวัติการดำเนินการทุกขั้น และเข้ารหัสข้อมูลส่วนบุคคลขณะจัดเก็บ

### In scope
- เข้าสู่ระบบด้วย Amazon Cognito User Pool และแนบ Token กับทุก Request
- JWT Authorizer บน API Gateway ทุก Route ไม่มี Token หรือ Token ไม่ถูกต้องได้ `401` ก่อนถึง Lambda
- Lambda อ่านผู้ใช้จาก `sub` / `cognito:groups` ของ Token ผ่าน Lambda Layer และตอบ `403` เมื่อไม่มีสิทธิ์ (เช่น ผู้ใช้ทั่วไปเรียก `/admin/*` หรือดูคำขอของผู้อื่น)
- ปฏิทินคาบสอน (ตารางสอนประจำ งดสอน สอนชดเชย) (#72)
- สร้างร่างคำขออัตโนมัติจากปฏิทิน พร้อมตรวจเพดานชั่วโมงและยอดเงิน (#82)
- สร้างเอกสาร PDF ภาษาไทยของคำขอ เก็บใน S3 และดาวน์โหลดด้วย Presigned URL อายุสั้น (#83)
- กระบวนการตรวจและอนุมัติของเจ้าหน้าที่ (approve / reject / return, พิมพ์เอกสาร, รับเอกสาร, ส่งการเงินเป็นชุด) และบันทึกประวัติการดำเนินการ (Audit Log) ในตาราง `claim_actions` (#84)
- เข้ารหัสข้อมูลขณะจัดเก็บด้วย KMS และบันทึกการใช้งานด้วย CloudTrail (#80)

### Out of scope (V4+)
- การรองรับผู้ใช้จำนวนมาก การใช้งานพร้อมกัน และความพร้อมใช้งานสูง (V4)
- Infrastructure as Code เต็มรูปแบบ ปัจจุบัน Lambda ยัง deploy ผ่าน Console และ API Gateway ตั้งค่าด้วยสคริปต์ CLI (V5)
- การวัดผลและปรับปรุงประสิทธิภาพและต้นทุน (V6)
- การลงลายมือชื่ออิเล็กทรอนิกส์ เอกสารยังพิมพ์และลงนามบนกระดาษ
- การรับ-จ่ายเงินและการเชื่อมต่อกับระบบ ERP ของฝ่ายการเงิน

### Architecture (V3)

```
ผู้ใช้งาน (เบราว์เซอร์)  อาจารย์ / TA / นักศึกษาช่วยงาน / เจ้าหน้าที่
   │
   ├─► Amazon CloudFront ──(OAC)──► Amazon S3 (Private)        หน้าเว็บ HTML/CSS/JS
   │
   ├─► Amazon Cognito (User Pool)                              เข้าสู่ระบบ รับ JWT
   │      กลุ่ม instructor / ta / student_helper / admin
   │
   ├─► Amazon API Gateway (HTTP API, Stage $default)           Authorization: Bearer <JWT>
   │      JWT Authorizer (cognitoJwt) ตรวจลายเซ็น issuer + audience  ไม่ผ่าน = 401
   │      │                      └──► Amazon CloudWatch Logs   Access Log (sub, authError)
   │      ▼
   │   AWS Lambda  V2: 8 ฟังก์ชัน / 8 Route   V3: 8 ฟังก์ชัน / 14 Route
   │      ├─ Lambda Layer (db.py)  อ่าน sub / cognito:groups จาก JWT ตรวจสิทธิ์ ตอบ 403
   │      ├─ IAM Role cookierun-lambda-role (ใช้ร่วมกันทุกฟังก์ชัน)
   │      │
   │      ├─► Amazon RDS (MySQL, เข้ารหัสด้วย aws/rds)          คำขอ อัตรา ภาคการศึกษา ปฏิทิน
   │      │      └─ claim_actions                              Audit Log การตรวจ อนุมัติ รับเอกสาร ส่งการเงิน
   │      └─► Amazon S3 (cookierun-uploads, SSE-KMS)            เอกสารหลักฐาน + PDF คำขอ
   │             ▲  เข้ารหัส Object
   │          AWS KMS (Customer Managed Key)
   │
   └─► Amazon S3 (cookierun-uploads)                           อัปโหลดหลักฐาน / ดาวน์โหลด PDF ตรงด้วย Presigned URL

AWS CloudTrail (cookierun-management-trail)                    Management Events + การใช้ KMS Key
```

ทุกบริการอยู่ใน Region `us-east-1` บริการที่เพิ่มจาก V2:

| ส่วน | บริการ | เหตุผลที่เลือก |
|---|---|---|
| ยืนยันตัวตน | Amazon Cognito User Pool | บริการจัดการบัญชีและออก JWT สำเร็จรูป ไม่ต้องเก็บรหัสผ่านเอง ใช้กลุ่มแทนบทบาทได้ทันที |
| ตรวจ Token | JWT Authorizer ของ HTTP API | ตรวจลายเซ็น อายุ issuer และ audience ให้เอง ไม่มีค่าใช้จ่ายเพิ่ม และ Request ที่ไม่มี Token ไม่ถึง Lambda / RDS เลย แต่ตรวจ `cognito:groups` ไม่ได้ จึงให้ Lambda ตรวจบทบาทต่อ |
| ตรวจสิทธิ์ | Lambda Layer (`db.py`, `validation.py`) + `pymysql` | ใช้โค้ดอ่านผู้ใช้และตรวจสิทธิ์ชุดเดียวกันทุก Lambda จับคู่ `sub` กับ `user_information.cognitoSub` |
| Logic | Lambda ของ V3 รวม Route ตามฟีเจอร์ (8 ฟังก์ชันสำหรับ 14 Route) | จำนวน Lambda ที่ต้อง deploy และอัปเดต Layer น้อยลง แลกกับต้องแยกการทำงานด้วย `event.routeKey` ในโค้ด ดู [`docs/api-design.md`](docs/api-design.md#26-lambda-ของ-v3-รวม-route-ตามฟีเจอร์) |
| เอกสาร PDF | S3 `cookierun-uploads` + Presigned URL | ไฟล์ไม่ผ่าน Lambda ขาออก ลิงก์หมดอายุใน 300 วินาที และ Bucket ไม่เปิดสาธารณะ |
| Audit Log | ตาราง `claim_actions` ใน RDS | บันทึกใน Transaction เดียวกับการเปลี่ยนสถานะคำขอ ตรวจย้อนหลังได้ว่าใครทำอะไรเมื่อไร ปัจจุบันบันทึกผลตรวจ (approve / reject / return), การพิมพ์เอกสาร, การรับเอกสาร, การส่งการเงิน (`cookierun-admin`) และการเปลี่ยนช่องทางยื่น (`cookierun-claimWorkflow`) |
| เข้ารหัส | AWS KMS: Customer Managed Key กับ `cookierun-uploads`, `aws/rds` กับ RDS | S3 ที่เก็บหลักฐานและ PDF ต้องมีทั้งสิทธิ์ S3 และสิทธิ์ใช้กุญแจจึงเปิดไฟล์ได้ ส่วน Bucket หน้าเว็บคง SSE-S3 เพราะไม่มีข้อมูลส่วนบุคคล ดู [`docs/security-v3.md`](docs/security-v3.md) |
| ตรวจสอบย้อนหลัง | AWS CloudTrail (Trail `cookierun-management-trail`, Multi-region) | บันทึก Management Events รวมถึงทุกครั้งที่มีการใช้ KMS Key (`Decrypt`, `GenerateDataKey`) ตรวจย้อนหลังได้ว่าใครเปิดไฟล์เมื่อไร |

### API

Base URL: `https://39eee8bl4b.execute-api.us-east-1.amazonaws.com`
สัญญา API ฉบับเต็มอยู่ที่ [`backend/api/openapi.yaml`](backend/api/openapi.yaml)

**ทุก Route ต้องส่ง header `Authorization: Bearer <token>`** (ID Token หรือ Access Token จาก Cognito)

| สถานะ | ผู้ตอบ | ความหมาย |
|---|---|---|
| `401` `{"message":"Unauthorized"}` | API Gateway | ไม่มี Token หรือ Token ไม่ถูกต้อง / หมดอายุ (ไม่ผ่าน Lambda) |
| `403` `{"success":false,"error":{"code":"FORBIDDEN",...}}` | Lambda | เข้าสู่ระบบแล้วแต่ไม่มีสิทธิ์ เช่น ไม่ใช่ `admin` เข้า `/admin/*` หรือไม่พบผู้ใช้ที่ผูกกับ `cognitoSub` |

**Route ของ V2 (8 Route)**

| Method | Path | Lambda | หน้าที่ |
|---|---|---|---|
| GET | `/rates` | `cookierun-getRates` | อัตราค่าตอบแทน |
| GET | `/terms` | `cookierun-getTerms` | ภาคการศึกษา |
| GET | `/claims` | `cookierun-getClaims` | รายการคำขอของตนเอง (กรองได้) |
| POST | `/claims` | `cookierun-createClaim` | สร้างคำขอ |
| GET | `/claims/{id}` | `cookierun-getClaimById` | รายละเอียดคำขอ |
| PUT | `/claims/{id}` | `cookierun-updateClaim` | แก้ไขคำขอ (`draft` / `returned`) |
| POST | `/claims/{id}/submit` | `cookierun-submitClaim` | ยื่นคำขอ |
| GET | `/uploads/presigned-url` | `cookierun-getPresignedUrl` | ขอ URL สำหรับอัปโหลดเอกสาร |

**Route ของ V3 (14 Route, 8 Lambda)**

| Method | Path | Lambda | Issue | หน้าที่ |
|---|---|---|---|---|
| GET | `/schedule` | `cookierun-getSchedule` | #72 | คาบของเดือน พร้อมสรุปคาบและชั่วโมงต่อวิชา |
| POST | `/schedule` | `cookierun-postSchedule` | #72 | เพิ่มคาบสอนปกติ / งดสอน / สอนชดเชย |
| PUT | `/schedule/{id}` | `cookierun-putSchedule` | #72 | แก้ไขคาบ |
| DELETE | `/schedule/{id}` | `cookierun-deleteSchedule` | #72 | ลบคาบ |
| POST | `/claims/autofill` | `cookierun-autofillClaim` | #82 | สร้างร่างคำขอจากปฏิทิน (1 รายวิชา ต่อ 1 เดือน) |
| PUT | `/claims/{id}/print-method` | `cookierun-claimWorkflow` | #84 | เปลี่ยนช่องทางยื่นเอกสาร |
| GET | `/claims/{id}/actions` | `cookierun-claimWorkflow` | #84 | ประวัติการดำเนินการของคำขอ (`claim_actions`) |
| GET | `/claims/{id}/pdf` | `cookierun-generatePdf` | #83 | สร้าง PDF และคืน Presigned URL อายุสั้น |
| GET | `/admin/claims` | `cookierun-admin` | #84 | รายการคำขอทั้งหมด กรอง/ค้นหาได้ พร้อมจำนวนตามสถานะ |
| GET | `/admin/claims/{id}` | `cookierun-admin` | #84 | รายละเอียดคำขอสำหรับตรวจ |
| POST | `/admin/claims/{id}/review` | `cookierun-admin` | #84 | ผลตรวจ approve / reject / return |
| POST | `/admin/claims/{id}/printed` | `cookierun-admin` | #84 | บันทึกว่าพิมพ์เอกสารแล้ว |
| POST | `/admin/claims/{id}/documents-received` | `cookierun-admin` | #84 | รับเอกสารที่ลงนามแล้ว |
| POST | `/admin/claims/send-to-finance` | `cookierun-admin` | #84 | ส่งการเงินเป็นชุด |

Route `/admin/*` ใช้ได้เฉพาะกลุ่ม `admin` สถานะของคำขอเปลี่ยนตามลำดับ `draft` → `submitted` → `approved` → `documents_received` → `sent_to_finance` (หรือ `submitted` → `returned` / `rejected`) ดูรายละเอียดที่ [`backend/lambda/aws_lambda_configuration_guide.md`](backend/lambda/aws_lambda_configuration_guide.md)

- CORS อนุญาต origin ของ CloudFront (`https://d2ye2fegyyx6ls.cloudfront.net`) และ `localhost` สำหรับพัฒนา response `401` ก็มี `access-control-allow-origin` เพื่อให้หน้าเว็บอ่านสถานะได้
- รายละเอียด JWT Authorizer และ Access Log อยู่ที่ [`docs/api-design.md`](docs/api-design.md#25-jwt-authorizer-cognito-บน-http-api-เดิม-v3)

### การทดสอบ

รันใน AWS CloudShell จากโฟลเดอร์ repo บน `main` ล่าสุด `get-token.sh` จะถามชื่อผู้ใช้และรหัสผ่านแบบซ่อน (ขอบัญชีทดสอบจากเจ้าของงาน Cognito)

```bash
export API_URL=https://39eee8bl4b.execute-api.us-east-1.amazonaws.com

# ไม่มี Token: ทดสอบ CORS และ Authorizer ต้องได้ 401 (24 รายการ)
bash backend/api/tests/smoke-test.sh

# ขอ Token จาก Cognito (เลือกบัญชีด้วย COGNITO_USER=... ได้)
TOKEN=$(bash backend/api/scripts/get-token.sh)

# มี Token: เพิ่มกรณีที่ต้องได้ 200 (27 รายการ)
TOKEN="$TOKEN" bash backend/api/tests/smoke-test.sh

# มี Token และทดสอบ Route (36 รายการ ดูข้อจำกัดด้านล่าง)
RUN_ROUTES=1 TOKEN="$TOKEN" bash backend/api/tests/smoke-test.sh
```

สคริปต์คืน exit code 0 เมื่อผ่านทุกรายการ การทดสอบ `POST /claims` จะสร้างข้อมูลจริงในระบบ

ตรวจด้วยมือ:

```bash
curl -i "$API_URL/rates"                                     # ไม่มี Token → 401
curl -i -H "Authorization: Bearer $TOKEN" "$API_URL/rates"   # มี Token → 200
```

### ข้อจำกัดที่ทราบใน V3
- JWT Authorizer ของ HTTP API ตรวจ `cognito:groups` ไม่ได้ สิทธิ์ตามบทบาทจึงต้องตรวจซ้ำในทุก Lambda หาก Lambda ตัวใดลืมตรวจ จะเปิดสิทธิ์เกินได้
- หน้าเว็บเก็บ Token ใน `localStorage` (ใช้ร่วมกันหลายแท็บ) จึงเสี่ยงหากหน้าเว็บมีช่องโหว่ XSS
- `get-token.sh` ต้องเปิด `ALLOW_USER_PASSWORD_AUTH` ใน App Client
- การทดสอบ Route (`RUN_ROUTES=1`) ยังเป็นของ V2 ผลล่าสุด 34/36 รายการ `GET /claims` ได้ `403` เพราะสคริปต์ส่ง `userId=u001` ตายตัว (Lambda ไม่ให้ดูคำขอของผู้อื่น) และ `POST /claims` ได้ `400` เพราะ body ยังเป็นรูปแบบ V2 (V3 ใช้ `offeringId`, `month`, `items[].workDate/startTime/endTime`) ทั้งสองเป็นปัญหาของสคริปต์ ไม่ใช่ API
- Smoke test ยังไม่ครอบคลุมกรณีสำเร็จของ Route V3
- ยังไม่ได้ยืนยันว่าการอัปโหลดและดาวน์โหลดผ่าน Presigned URL ใช้งานได้หลังเปลี่ยน `cookierun-uploads` เป็น SSE-KMS (Acceptance Criteria ที่ยังเปิดอยู่ใน #80)
- `openapi.yaml` และ API Gateway ยังมี Route `/work-days` (5 Route) และ `GET /current-period` ที่ผูกกับ `cookierun-workDays` / `cookierun-getCurrentPeriod` ซึ่งยังไม่มีใน AWS จึงใช้งานไม่ได้ จะปรับ API ให้ตรงกับ Lambda ภายหลัง
- การยื่นคำขอ (`submit`) ยังไม่ถูกบันทึกใน `claim_actions` เพราะ `cookierun-submitClaim` ตั้ง `CLAIM_ACTIONS_ENABLED=0`
- Lambda ทุกตัวใช้ IAM Role เดียวกัน (`cookierun-lambda-role`) สิทธิ์ของแต่ละฟังก์ชันจึงกว้างกว่าที่จำเป็น ยังไม่เป็นไปตามหลัก Least Privilege
- Lambda ยัง deploy และอัปเดต Layer ผ่าน Console ทีละตัว ส่วน API Gateway ตั้งค่าด้วยสคริปต์ CLI ยังไม่ใช่ Infrastructure as Code
- การ import `openapi.yaml` ซ้ำจะเขียนทับค่า CORS และ Authorizer ทั้งหมด ต้องรันสคริปต์จาก `main` ล่าสุดเท่านั้น
- เอกสารยังต้องพิมพ์และลงนามบนกระดาษ ระบบบันทึกเฉพาะสถานะการพิมพ์และการรับเอกสาร

## External actors / systems
อาจารย์ / ผู้ช่วยสอน (TA) / นักศึกษาช่วยงาน / เจ้าหน้าที่

---

## Deployment

**Frontend:** ตั้งแต่ V2 เป็นต้นไป Frontend ถูก Deploy อัตโนมัติผ่าน GitHub Actions เมื่อมีการ Merge เข้า `main` โดยอัปโหลดขึ้น S3 (Private) และให้บริการผ่าน CloudFront ดูขั้นตอนตั้งค่าและการใช้งานได้ที่ [`docs/deployment-guide.md`](docs/deployment-guide.md)

ไม่ต้องอัปโหลดไฟล์ขึ้น S3 ด้วยมือ เนื่องจากการ Deploy อัตโนมัติจะลบไฟล์ที่ไม่มีใน Repository

**API Gateway:** ตั้งค่าด้วยสคริปต์ใน `backend/api/scripts/` โดยรันจาก AWS CloudShell บน `main` ล่าสุด

```bash
API_ID=39eee8bl4b bash backend/api/scripts/setup-stage.sh     # Stage และ Access Log
API_ID=39eee8bl4b bash backend/api/scripts/bind-lambdas.sh    # import openapi.yaml และให้สิทธิ์เรียก Lambda
```

สคริปต์ทั้งสองรันซ้ำได้ `bind-lambdas.sh` จะตรวจด้วยว่าทุก Route ผูก JWT Authorizer แล้ว ดูรายละเอียดที่ [`docs/api-design.md`](docs/api-design.md)

**Lambda (V3):** deploy ผ่าน AWS Console
1. Runtime Python 3.14 และใช้ IAM Role `cookierun-lambda-role` สร้าง Lambda Layer จากโฟลเดอร์ใน `backend/lambda/` โดยใน zip ต้องมีโฟลเดอร์ `python/` เป็นชั้นนอกสุด Layer ที่ใช้อยู่ใน AWS:

   | Layer ใน AWS | โฟลเดอร์ | ใช้กับ |
   |---|---|---|
   | `pymysql` | `pysqllayer/` | ทุก Lambda |
   | `DBVAL34` | `DBVAL34layer/` | Lambda ของ V2 ทั้ง 8 ตัว, `admin`, `autofillClaim`, `claimWorkflow`, `deleteSchedule` |
   | `dbvalidateV3` | — (ยังไม่มีโฟลเดอร์ใน repo) | `getSchedule`, `postSchedule`, `putSchedule`, `generatePdf` |
   | `pdf-libs-py314` | `pdflayer/` | `generatePdf` |
   | `Assets` | `Asettslayer/` (ฟอนต์ Sarabun และแม่แบบ PDF) | `generatePdf` |

2. ตั้ง Environment variables ตาม [`backend/lambda/aws_lambda_configuration_guide.md`](backend/lambda/aws_lambda_configuration_guide.md) (ค่า `DB_PASSWORD` ใส่ใน Console เท่านั้น ห้าม commit)
3. หลัง deploy หรือเพิ่ม Lambda ใหม่ ให้สิทธิ์ API Gateway เรียก Lambda โดยไม่ต้อง import `openapi.yaml` ซ้ำ

```bash
SKIP_IMPORT=1 API_ID=39eee8bl4b bash backend/api/scripts/bind-lambdas.sh
```

**Cognito:** User Pool `us-east-1_tGEzAfQt2`, App Client `5ikoqjohoavik8c91f3ph9qeck` ([`docs/auth-design.md`](docs/auth-design.md))
- สร้างกลุ่ม `instructor`, `ta`, `student_helper`, `admin` และเพิ่มผู้ใช้เข้ากลุ่มตามบทบาท
- นำ `sub` ของผู้ใช้ไปใส่ใน `user_information.cognitoSub` ใน RDS มิฉะนั้น Lambda จะตอบ `403`
- เปิด `ALLOW_USER_PASSWORD_AUTH` ใน App Client (Authentication flows) เพื่อใช้ `get-token.sh`
- ค่า User Pool, App Client และ Base URL ของหน้าเว็บอยู่ใน `frontend/javascript/config.js` หาก Issuer หรือ Audience เปลี่ยน ต้องแก้ทั้ง `config.js` และ `securitySchemes` ใน `openapi.yaml` แล้ว reimport

**Security:** ตั้งค่าผ่าน Console ดูรายละเอียดและ Trade-off ที่ [`docs/security-v3.md`](docs/security-v3.md)
- KMS Key alias `cookierun-uploads` (Customer Managed) ใช้เป็น Default Encryption แบบ SSE-KMS ของ Bucket `cookierun-uploads` และเปิด S3 Bucket Key
- IAM Role `cookierun-lambda-role` มี `kms:GenerateDataKey` และ `kms:Decrypt` บนกุญแจนี้, `s3:PutObject` / `s3:GetObject` ที่ `cookierun-uploads/pdf/*` และ `s3:PutObject` ที่ `cookierun-uploads/uploads/*` (ผู้ที่อัปโหลดหรือดาวน์โหลดผ่าน Presigned URL ใช้สิทธิ์ของ Role ที่เซ็น URL)
- RDS `database01` เปิด Encryption at rest ด้วย `aws/rds`
- CloudTrail Trail `cookierun-management-trail` (Multi-region) บันทึก Management Events ตรวจการใช้กุญแจได้ที่ CloudTrail → Event history กรอง Event source `kms.amazonaws.com`

## Repo Structure

```
/
├── .github/
│   ├── scripts/
│   │   └── validate_frontend.py          # ตรวจ JSON และไฟล์ frontend ก่อน deploy
│   └── workflows/
│       └── deploy-frontend.yml           # GitHub Actions: deploy frontend ขึ้น S3 + CloudFront
├── backend/
│   ├── README.md
│   ├── handler.js                        # Lambda prototype (ไม่ได้ใช้ใน production)
│   ├── api/
│   │   ├── openapi.yaml                  # สัญญา API และค่า CORS (แหล่งความจริง)
│   │   ├── scripts/
│   │   │   ├── setup-stage.sh            # ตั้งค่า Stage และ Access Log
│   │   │   ├── bind-lambdas.sh           # import openapi.yaml ให้สิทธิ์เรียก Lambda และตรวจ JWT Authorizer
│   │   │   └── get-token.sh              # ขอ Token จาก Cognito สำหรับทดสอบ (V3)
│   │   └── tests/
│   │       └── smoke-test.sh             # ทดสอบ CORS, JWT Authorizer และ route
│   ├── data/
│   │   └── database_script/
│   │       └── sql_script.sql            # สร้างฐานข้อมูล MySQL บน RDS และข้อมูลตั้งต้น
│   └── lambda/
│       ├── aws_lambda_configuration_guide.md  # Environment variables, Layer และหน้าที่ของแต่ละ Lambda
│       ├── cookierun-*.py                # โค้ด Lambda หนึ่งไฟล์ต่อหนึ่งฟังก์ชัน
│       ├── cookierun-pdf.py              # โมดูลวาง PDF ทับแบบฟอร์ม ใช้โดย cookierun-generatePdf
│       ├── DBVAL34layer/                 # Layer DBVAL34: db.py (เชื่อม DB, อ่านผู้ใช้จาก JWT) และ validation.py (สถานะ, Audit Log)
│       ├── pysqllayer/                   # Layer pymysql
│       ├── pdflayer/                     # Layer pdf-libs-py314: fpdf2 และไลบรารีสร้าง PDF
│       └── Asettslayer/                  # Layer Assets: ฟอนต์ Sarabun และแม่แบบ PDF
├── data/
│   ├── site.json                         # รายการหัวข้อของหน้าข้อมูล
│   └── sections/
│       ├── cycles.json
│       ├── documents.json
│       ├── manuals.json
│       ├── overview.json
│       ├── rates.json
│       ├── timeline.json
│       └── users.json
├── docs/
│   ├── .gitkeep
│   ├── api-design.md
│   ├── auth-design.md                    # ค่า Cognito และการเก็บ Token (V3)
│   ├── deployment-guide.md
│   └── security-v3.md                    # KMS และการเข้ารหัส S3 (V3)
├── frontend/
│   ├── index.html                        # หน้าข้อมูลการเบิก
│   ├── login.html                        # เข้าสู่ระบบ (V3)
│   ├── home.html                         # ภาพรวมของผู้เบิก (V3)
│   ├── calendar.html                     # ปฏิทินคาบสอน (V3)
│   ├── makeup.html                       # แบบฟอร์มขอสอนชดเชย (V3)
│   ├── dashboard.html                    # ประวัติคำขอ
│   ├── form.html                         # สร้าง / แก้ไขคำขอ
│   ├── submit.html                       # ตัวอย่างเอกสารก่อนยื่น (V3)
│   ├── detail.html                       # รายละเอียดคำขอ
│   ├── admin.html                        # ภาพรวมเจ้าหน้าที่ (V3)
│   ├── admin-claims.html                 # คำขอทั้งหมด (V3)
│   ├── admin-review.html                 # ตรวจคำขอ (V3)
│   ├── admin-counter.html                # เคาน์เตอร์เซ็นเอกสาร (V3)
│   ├── assets/
│   │   ├── logo.png
│   │   ├── docs/
│   │   │   ├── manual-instructor.pdf
│   │   │   ├── manual-student.pdf
│   │   │   └── manual-ta.pdf
│   │   └── forms/
│   │       ├── timesheet-regular.pdf
│   │       └── timesheet-special.pdf
│   ├── css/
│   │   ├── base.css
│   │   ├── claims.css
│   │   ├── components.css
│   │   ├── layout.css
│   │   ├── ui.css
│   │   ├── login.css
│   │   ├── user.css
│   │   ├── admin.css
│   │   └── v2.css                        # ต้นแบบเก่า ไม่มีหน้าไหนโหลดแล้ว
│   └── javascript/
│       ├── config.js                     # ค่า Cognito และ Base URL ของ API (V3)
│       ├── auth.js                       # เข้าสู่ระบบ เก็บ/ต่ออายุ Token (V3)
│       ├── api.js                        # เรียก API พร้อมแนบ Authorization
│       ├── app.js
│       ├── core.js
│       ├── ui.js
│       ├── layout.js
│       ├── sections.js
│       ├── login.js
│       ├── home.js
│       ├── calendar.js
│       ├── makeup.js
│       ├── dashboard.js
│       ├── form.js
│       ├── submit.js
│       ├── detail.js
│       ├── pdf.js
│       ├── admin.js
│       ├── admin-ui.js
│       ├── admin-claims.js
│       ├── admin-review.js
│       ├── admin-counter.js
│       └── v2.js                         # ต้นแบบเก่า ไม่มีหน้าไหนโหลดแล้ว
├── infra/
│   └── iam/
│       ├── github-actions-frontend-deploy-policy.json
│       └── github-actions-trust-policy.json
└── README.md
```

## Team / Contributors

- 6709420019 กันต์ธร ยืนยงชัยวัฒน์
- 6709616459 ชินะสุ สุขเจริญ
- 6709616491 ณัฐศิกาญจน์ จงภิญโญตระกูล
- 6709616582 นันทภพ ชนชอบธรรม
- 6709616798 ภัทรินทร์ แซ่ว่อง