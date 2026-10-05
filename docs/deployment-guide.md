# Frontend Deployment Guide

เอกสารนี้อธิบายการ Deploy ส่วน Frontend ขึ้น Amazon S3 และล้าง Cache ของ Amazon CloudFront โดยอัตโนมัติผ่าน GitHub Actions (Issue #28)

## Overview

เมื่อเปิด Pull Request เข้า `main` ระบบจะรันเฉพาะ Job `validate` เพื่อตรวจไฟล์ก่อน Merge และเมื่อมีการ Push เข้า branch `main` ที่เปลี่ยนแปลงไฟล์ในโฟลเดอร์ `frontend/` หรือ `data/` ระบบจะดำเนินการตามลำดับดังนี้

```
push → main
   │
   ▼
[validate]  ตรวจไฟล์ JSON ทั้งหมด / ตรวจว่ามี frontend/index.html / ตรวจว่า section ใน site.json มีไฟล์ข้อมูลครบ
   │  (หากไม่ผ่าน Workflow จะหยุดทันทีและไม่มีการ Deploy)
   ▼
[deploy]    ขอ OIDC token จาก GitHub → แลกเป็น credentials ชั่วคราวของ IAM Role
            → ประกอบไฟล์ลงโฟลเดอร์ _site/ → aws s3 sync --delete → CloudFront invalidation (/*)
```

GitHub Actions ไม่ใช้ AWS Access Key ระยะยาว แต่ใช้ OpenID Connect (OIDC) เพื่อขอ credentials ชั่วคราวซึ่งมีอายุเพียงช่วงที่ Workflow ทำงาน และ IAM Role อนุญาตให้ Assume ได้เฉพาะ Workflow ที่รันจาก branch `main` ของ repository นี้เท่านั้น

## Site Layout

ใน repository โฟลเดอร์ `data/` อยู่ระดับเดียวกับ `frontend/` แต่บน S3 โฟลเดอร์ `data/` ต้องอยู่ข้าง `index.html` ขั้นตอน "Assemble site" จึงรวมไฟล์ลงโฟลเดอร์ชั่วคราว `_site/` ก่อนอัปโหลด

| ใน repository | บน S3 bucket |
|---|---|
| `frontend/index.html` | `index.html` |
| `frontend/css/`, `frontend/javascript/`, `frontend/assets/` | `css/`, `javascript/`, `assets/` |
| `data/site.json`, `data/sections/*.json` | `data/site.json`, `data/sections/*.json` |

ไฟล์ใน `core.js` รองรับทั้งสองโครงสร้างอยู่แล้ว จึงไม่ต้องแก้ไขโค้ด Frontend

> **ข้อควรระวัง:** คำสั่ง `aws s3 sync --delete` จะลบไฟล์ใน bucket ที่ไม่มีอยู่ใน `_site/` ดังนั้นห้ามอัปโหลดไฟล์ขึ้น Frontend bucket ด้วยมือ และไฟล์หลักฐานที่ผู้ใช้อัปโหลดต้องเก็บใน Uploads bucket แยกต่างหากเท่านั้น

## Files

| ไฟล์ | หน้าที่ |
|---|---|
| `.github/workflows/deploy-frontend.yml` | Workflow หลัก (CI + CD) |
| `.github/scripts/validate_frontend.py` | สคริปต์ตรวจไฟล์ก่อน Deploy สามารถรันในเครื่องได้ |
| `infra/iam/github-actions-trust-policy.json` | Trust Policy ของ IAM Role |
| `infra/iam/github-actions-frontend-deploy-policy.json` | Permission Policy ของ IAM Role (Least Privilege) |

## One-time Setup

ต้องดำเนินการในบัญชี AWS จริงของทีม (Region `us-east-1`) โดยผู้ที่มีสิทธิ์ IAM Admin เนื่องจาก AWS Academy Learner Lab ไม่อนุญาตให้สร้าง IAM Identity Provider หรือ IAM Role ใหม่

### 0. Prerequisites

- มี S3 bucket และ CloudFront distribution ของ Frontend แล้ว โดย CloudFront เข้าถึง bucket ผ่าน Origin Access Control (OAC)
- ตั้งค่า **Default root object** ของ distribution เป็น `index.html` (CloudFront → Distribution → General → Settings → Edit) เนื่องจาก OAC ใช้ S3 REST endpoint ซึ่งไม่ส่ง `index.html` ให้อัตโนมัติเมื่อเปิดที่ `/`

### 1. Create the OIDC identity provider

ผ่าน Console: IAM → Identity providers → Add provider

- Provider type: **OpenID Connect**
- Provider URL: `https://token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`

หรือผ่าน CLI:

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com
```

หนึ่งบัญชี AWS มี provider นี้ได้เพียงหนึ่งรายการ หากมีอยู่แล้วให้ข้ามขั้นตอนนี้

### 2. Create the IAM role

1. แทนค่า `<ACCOUNT_ID>` ใน `infra/iam/github-actions-trust-policy.json` ด้วยหมายเลขบัญชี AWS 12 หลัก
2. แทนค่า `<FRONTEND_BUCKET>`, `<ACCOUNT_ID>` และ `<DISTRIBUTION_ID>` ใน `infra/iam/github-actions-frontend-deploy-policy.json`
3. สร้าง Role และแนบ Policy:

```bash
aws iam create-role \
  --role-name github-actions-frontend-deploy \
  --assume-role-policy-document file://infra/iam/github-actions-trust-policy.json

aws iam put-role-policy \
  --role-name github-actions-frontend-deploy \
  --policy-name frontend-deploy \
  --policy-document file://infra/iam/github-actions-frontend-deploy-policy.json
```

หากสร้างผ่าน Console (Roles → Create role → Web identity) ให้แก้ไข Trust Policy ภายหลังให้ตรงกับไฟล์ใน repository เนื่องจาก Console จะสร้างเงื่อนไขแบบ `StringLike` ซึ่งหลวมกว่าที่กำหนดไว้

**รูปแบบของ `sub`:** GitHub ส่งค่า `sub` ของ repository นี้ในรูปแบบที่มี ID ถาวรของเจ้าของและของ repository ต่อท้ายชื่อ

```
repo:Nantapoparm@181006824/CS_361_cookierun@1339206130:ref:refs/heads/main
```

ไม่ใช่รูปแบบ `repo:Nantapoparm/CS_361_cookierun:ref:refs/heads/main` ที่ปรากฏในเอกสารทั่วไป รูปแบบนี้ปลอดภัยกว่า เนื่องจากหาก repository ถูกลบและมีผู้สร้าง repository ชื่อเดิมขึ้นใหม่ ID จะเปลี่ยน จึงไม่สามารถ Assume Role นี้ได้ ID ทั้งสองเป็นข้อมูลสาธารณะ จึงระบุค่าจริงไว้ในไฟล์ได้ หากย้าย repository ต้องตรวจค่า `sub` ใหม่จาก CloudTrail (ดูหัวข้อ Troubleshooting)

ไม่ควร commit ไฟล์ที่แทนค่าจริงแล้วกลับเข้า repository ให้คงค่า placeholder ไว้

### 3. Set repository variables

GitHub → Settings → Secrets and variables → Actions → แท็บ **Variables** (มิใช่ Secrets)

| Variable | ตัวอย่างค่า |
|---|---|
| `AWS_ROLE_ARN` | `arn:aws:iam::123456789012:role/github-actions-frontend-deploy` |
| `FRONTEND_BUCKET` | ชื่อ Frontend bucket (ไม่ต้องมี `s3://`) |
| `CLOUDFRONT_DISTRIBUTION_ID` | เช่น `E1ABCDEF2GHIJK` |
| `AWS_REGION` | `us-east-1` (ไม่บังคับ หากไม่กำหนดจะใช้ค่านี้โดยอัตโนมัติ) |

ค่าทั้งหมดนี้ไม่ใช่ความลับ เนื่องจากหากไม่มี OIDC token จาก branch `main` ของ repository นี้ จะไม่สามารถใช้ Role ได้

### 4. Protect the main branch

เจ้าของ repository ควรเปิด Branch protection ของ `main` (Settings → Branches) โดยกำหนดให้ต้องผ่าน Pull Request และให้ status check `Validate JSON & structure` ผ่านก่อน merge (Check นี้รันกับทุก Pull Request ที่เข้า `main`)

### 5. Before the first merge

การ Merge Pull Request ที่เพิ่ม Workflow นี้จะ Deploy ทันที โดยไม่มีโอกาสใช้ Dry run ก่อน ให้เปิดดู Frontend bucket ใน Console และตรวจว่าไม่มีไฟล์ที่อัปโหลดด้วยมือและยังต้องใช้งาน เนื่องจาก `--delete` จะลบไฟล์ที่ไม่มีใน repository

## Daily Usage

- เปิด Pull Request เข้า `main` ระบบจะรัน `Validate JSON & structure` ให้อัตโนมัติ หากไม่ผ่านให้แก้ไขก่อน Merge
- เมื่อ merge เข้า `main` และมีการแก้ไขไฟล์ใน `frontend/` หรือ `data/` ระบบจะ Deploy ให้โดยอัตโนมัติ
- ตรวจสอบไฟล์ในเครื่องก่อน Push ได้ด้วยคำสั่ง `python3 .github/scripts/validate_frontend.py`
- หากต้องการ Deploy ซ้ำโดยไม่มีการแก้ไขไฟล์ ให้ไปที่ Actions → Deploy Frontend → **Run workflow**
- หากต้องการดูว่าจะมีไฟล์ใดเปลี่ยนแปลงโดยยังไม่อัปโหลดจริง ให้เลือก **Dry run** ตอนสั่ง Run workflow (ผล Dry run จะแสดงทุกไฟล์เป็น `upload` เสมอ เนื่องจากไฟล์ที่ checkout ใหม่มีเวลาแก้ไขใหม่ทุกครั้ง ให้ตรวจเฉพาะบรรทัด `delete`)
- เมื่อ Deploy สำเร็จ หน้า Summary ของ Workflow run จะแสดง Commit, ชื่อ bucket และ Invalidation ID

## Verification

ขั้นตอนทดสอบตาม Acceptance Criteria ของ Issue #28

| เกณฑ์ | วิธีทดสอบ | ผลที่คาดหวัง |
|---|---|---|
| Deploy สำเร็จ | แก้ข้อความใน `data/site.json` แล้ว Push เข้า `main` | Workflow ผ่านทั้งสอง job และหน้าเว็บบนโดเมน CloudFront เปลี่ยนภายในไม่กี่นาที |
| JSON ผิดต้องไม่ Deploy | เปิด Pull Request ที่ลบเครื่องหมาย `}` ตัวสุดท้ายออกจากไฟล์ JSON ใดไฟล์หนึ่ง | check `Validate JSON & structure` ล้มเหลวบน Pull Request พร้อมแจ้งชื่อไฟล์และบรรทัด และไม่มีการ Deploy |
| ลบไฟล์แล้วหายจาก S3 | ลบไฟล์ทดสอบที่เพิ่มไว้ออกจาก `frontend/` แล้ว Push | Log ของขั้น Sync แสดง `delete: s3://...` และไม่พบไฟล์นั้นใน bucket |
| ไม่มี Access Key | ตรวจ Settings → Secrets และค้นหาคำว่า `AKIA` ใน repository | ไม่พบ |
| branch อื่น Assume Role ไม่ได้ | สร้าง branch `test-oidc` แล้วสั่ง Run workflow จาก branch นั้น | ขั้น Configure AWS credentials ล้มเหลวด้วยข้อความ `Not authorized to perform sts:AssumeRoleWithWebIdentity` |
| มี Invalidation ID | เปิด Log ของขั้น Invalidate CloudFront cache | แสดงบรรทัด `Invalidation ID: ...` ซึ่งตรงกับรายการในหน้า CloudFront → Invalidations |

## Troubleshooting

| อาการ | สาเหตุที่เป็นไปได้ | วิธีแก้ไข |
|---|---|---|
| Workflow ไม่ทำงานหลัง Push | แก้ไขเฉพาะไฟล์นอก `frontend/` และ `data/` (เช่น README) | เป็นพฤติกรรมปกติ หากต้องการ Deploy ให้สั่ง Run workflow ด้วยตนเอง |
| `Repository variable ... is not set` | ยังไม่ได้ตั้งค่า Variables หรือตั้งไว้ในแท็บ Secrets | ตั้งค่าในแท็บ Variables ตามขั้นตอนที่ 3 |
| `Could not load credentials from any providers` | Workflow ไม่มีสิทธิ์ `id-token: write` | ตรวจสอบบล็อก `permissions` ของ job `deploy` |
| `Not authorized to perform sts:AssumeRoleWithWebIdentity` (รันจาก `main`) | ค่า `sub` ใน Trust Policy ไม่ตรงกับค่าที่ GitHub ส่งมา เช่น ไม่มี ID ถาวรต่อท้ายชื่อ (`@181006824`, `@1339206130`) พิมพ์ชื่อ repository ผิด หรือมีการเพิ่ม `environment:` ใน job ซึ่งทำให้รูปแบบ `sub` เปลี่ยน | ดูค่า `sub` ที่ GitHub ส่งมาจริงจาก CloudTrail → Event history → Event name `AssumeRoleWithWebIdentity` → เปิด Event ที่มี Error code `AccessDenied` → ค่า `userIdentity.userName` แล้วแก้ Trust Policy ให้ตรงทุกตัวอักษร และตรวจว่ามี OIDC provider ในบัญชีแล้ว |
| `AccessDenied` ที่ `ListObjectsV2` | ชื่อ bucket ใน Variable หรือใน Policy ไม่ตรงกัน | ตรวจ `FRONTEND_BUCKET` และ Resource ของ `ListFrontendBucket` |
| `AccessDenied` ที่ `PutObject` | bucket ใช้การเข้ารหัสแบบ SSE-KMS ด้วย customer managed key | ใช้ SSE-S3 (ค่าเริ่มต้น) หรือเพิ่มสิทธิ์ `kms:GenerateDataKey` เฉพาะ key นั้น |
| `AccessDenied` ที่ `CreateInvalidation` | Distribution ID หรือหมายเลขบัญชีใน Policy ไม่ถูกต้อง | ตรวจ Resource ของ `InvalidateFrontendDistribution` |
| Deploy สำเร็จแต่หน้าเว็บยังเป็นเวอร์ชันเดิม | Invalidation ยังไม่เสร็จ (โดยทั่วไปใช้เวลา 1–5 นาที) หรือเบราว์เซอร์เก็บ cache เนื่องจากยังไม่ได้กำหนด `Cache-Control` | รอสักครู่แล้วกด Hard refresh (Ctrl+Shift+R) หากเกิดบ่อยให้เพิ่ม `--cache-control` ในขั้น Sync |
| เปิดที่ `/` แล้วได้ 403 (AccessDenied) | ยังไม่ได้ตั้ง Default root object | ตั้งเป็น `index.html` ตามข้อ 0 |
| หน้าเว็บโหลดได้แต่ข้อมูลไม่ขึ้น (403/404 ที่ไฟล์ JSON) | โฟลเดอร์ `data/` ไม่ถูกอัปโหลด หรือ Bucket policy สำหรับ OAC ไม่ถูกต้อง | ตรวจรายชื่อไฟล์ใน Log ขั้น Assemble site และตรวจ Bucket policy ของ CloudFront OAC |
