# backend

ส่วน Backend ของ V2 — API Gateway (HTTP API) → AWS Lambda → Amazon RDS (MySQL) ทุกบริการอยู่ใน Region `us-east-1`

ภาพรวมสถาปัตยกรรมและรายการ route อยู่ที่ [`README.md`](../README.md#v2--dynamic-data-due-6-oct-2026) หลัก

## โครงสร้าง

```
backend/
├── handler.js                    # Lambda prototype จากช่วงก่อน V2 (เก็บข้อมูลในหน่วยความจำ) ไม่ได้ใช้ใน production
├── api/
│   ├── openapi.yaml              # สัญญา API และค่า CORS (แหล่งความจริง)
│   ├── scripts/
│   │   ├── setup-stage.sh        # ตั้งค่า Stage $default และ Access Log
│   │   └── bind-lambdas.sh       # import openapi.yaml และให้สิทธิ์ API Gateway เรียก Lambda
│   └── tests/
│       └── smoke-test.sh         # ทดสอบ CORS และ route
└── data/
    └── database_script/
        └── sql_script.sql        # สร้างฐานข้อมูล cs361_compensation (MySQL) และข้อมูลตั้งต้น
```

## API

Base URL: `https://39eee8bl4b.execute-api.us-east-1.amazonaws.com`

Lambda 8 ฟังก์ชัน (`cookierun-getRates`, `cookierun-getTerms`, `cookierun-getClaims`, `cookierun-createClaim`, `cookierun-getClaimById`, `cookierun-updateClaim`, `cookierun-submitClaim`, `cookierun-getPresignedUrl`) ผูกกับ route ผ่าน `openapi.yaml` ดูรายละเอียดที่ [`docs/api-design.md`](../docs/api-design.md)

ตั้งค่า API Gateway จาก AWS CloudShell บน `main` ล่าสุด (รันซ้ำได้):

```bash
API_ID=39eee8bl4b bash backend/api/scripts/setup-stage.sh
API_ID=39eee8bl4b bash backend/api/scripts/bind-lambdas.sh
```

> การ import `openapi.yaml` ซ้ำจะเขียนทับค่า CORS ทั้งหมด ต้องรันจาก `main` ล่าสุดเท่านั้น

## ฐานข้อมูล

`sql_script.sql` สร้างฐานข้อมูล `cs361_compensation` (utf8mb4) ประกอบด้วยตาราง

| กลุ่ม | ตาราง |
|---|---|
| ผู้ใช้ | `user_role`, `user_information` |
| อัตราและเงื่อนไข | `session`, `compensation_rates`, `compensation_rules` |
| รายวิชา | `courses_name`, `course_offerings` |
| คำขอเบิก | `status`, `claims`, `work_information` |
| อื่น ๆ | `table_types` |

พร้อมข้อมูลตั้งต้นของ `user_role`, `session`, `status` และ `table_types`

## การทดสอบ

```bash
# CORS (15 รายการ)
API_URL=https://39eee8bl4b.execute-api.us-east-1.amazonaws.com bash backend/api/tests/smoke-test.sh

# CORS และทุก route (24 รายการ) — POST /claims จะสร้างข้อมูลจริง
RUN_ROUTES=1 API_URL=https://39eee8bl4b.execute-api.us-east-1.amazonaws.com bash backend/api/tests/smoke-test.sh
```

## ข้อจำกัด

- ซอร์สโค้ดของ Lambda ทั้ง 8 ฟังก์ชันยังไม่ได้เก็บใน repo นี้ และยังไม่มี path สำหรับเก็บโค้ด
- ยังไม่มีการยืนยันตัวตน — `X-User-Id` ส่งมาจากเบราว์เซอร์และปลอมแปลงได้ (จะแทนที่ด้วยระบบเข้าสู่ระบบใน V3)
- `GET /uploads/presigned-url` มี route แล้ว แต่ฟีเจอร์อัปโหลดยังใช้งานจริงไม่ได้
- การตั้งค่า API Gateway ยังทำผ่านสคริปต์ CLI ไม่ใช่ Infrastructure as Code (V5)
