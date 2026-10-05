#!/usr/bin/env python3
"""ตรวจไฟล์ก่อน deploy — รันในเครื่องได้ด้วย: python3 .github/scripts/validate_frontend.py

1. ไฟล์ .json ทุกไฟล์ใน repo ต้อง parse ได้
2. ต้องมี frontend/index.html อยู่ชั้นนอกสุดของโฟลเดอร์ frontend/
3. ทุก section id ใน data/site.json ต้องมีไฟล์ data/sections/<id>.json คู่กัน
"""
import json
import subprocess
import sys
from pathlib import Path

errors = []

# 1) JSON syntax — ใช้ git ls-files เพื่อตรวจเฉพาะไฟล์ที่อยู่ใน repo จริง
try:
    files = subprocess.run(
        ["git", "ls-files", "*.json"], check=True, capture_output=True, text=True
    ).stdout.split()
except (subprocess.CalledProcessError, FileNotFoundError):
    files = [str(p) for p in Path(".").rglob("*.json") if ".git" not in p.parts]

for f in files:
    try:
        with open(f, encoding="utf-8") as fh:
            json.load(fh)
        print(f"  ok   {f}")
    except json.JSONDecodeError as e:
        errors.append(f"{f}:{e.lineno}:{e.colno}: invalid JSON — {e.msg}")
    except UnicodeDecodeError as e:
        errors.append(f"{f}: not valid UTF-8 — {e}")

# 2) index.html ต้องอยู่ชั้นนอกสุดของ frontend/
if not Path("frontend/index.html").is_file():
    errors.append("frontend/index.html not found — index.html must sit at the top of frontend/")

# 3) section ใน site.json ต้องมีไฟล์ข้อมูลคู่กัน (app.js โหลด sections/<id>.json)
site_path = Path("data/site.json")
if site_path.is_file():
    try:
        site = json.loads(site_path.read_text(encoding="utf-8"))
        for s in site.get("sections", []):
            sid = s.get("id")
            if not sid:
                errors.append("data/site.json: a section is missing its \"id\"")
            elif not Path(f"data/sections/{sid}.json").is_file():
                errors.append(f"data/site.json: section \"{sid}\" has no data/sections/{sid}.json")
    except json.JSONDecodeError:
        pass  # รายงานไปแล้วในข้อ 1

print()
if errors:
    for e in errors:
        # รูปแบบ ::error:: ทำให้ GitHub ขึ้นกล่องแดงในหน้า Summary
        print(f"::error::{e}")
    print(f"\nValidation failed: {len(errors)} problem(s). Nothing was deployed.")
    sys.exit(1)

print(f"Validation passed: {len(files)} JSON file(s) checked.")

