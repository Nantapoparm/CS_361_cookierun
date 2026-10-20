"""
สร้าง PDF แบบฟอร์มเบิกค่าตอบแทน โดยพิมพ์ข้อความทับลงบนไฟล์แบบฟอร์มเปล่า (V3-09)

โมดูลนี้ไม่ดึงข้อมูลจาก DB เอง: handler ต้องประกอบ dict `data` แล้วส่งเข้ามา
  data = {
      "semester": 2, "academicYearBE": 2568,
      "courseLine": "CS262 INTRODUCTION TO SOFTWARE TESTING",
      "lecturer": "ศาสตราจารย์ ดร.สมชาย อยู่เย็น",   # ฟอร์มอาจารย์: ชื่อผู้บรรยาย
      "taName": "ชื่อ-สกุล",                            # ฟอร์ม TA: ชื่อผู้ช่วยสอน
      "monthLabel": "เมษายน พ.ศ. 2569 จ. บร.2-213",     # ประจำเดือน (ฟอร์มอาจารย์ต่อท้ายด้วยวันและห้องได้)
      "courseKind": "theory" | "practice" | None,       # ฟอร์มอาจารย์: ติ๊กภาคทฤษฎี/ภาคปฏิบัติ
      "rows": [{"date": "06/04/2569", "time": "09:00-12:00", "note": "", "hours": 3}],
      "totalHours": 12,
      "directorName": "ผู้ช่วยศาสตราจารย์ ดร.ปา อยู่เย็น",   # ไม่บังคับ: พิมพ์เหนือบรรทัด "ผู้อำนวยการโครงการ..."
  }
  หมายเหตุ: template ฟอร์ม TA ไม่มีช่อง "อาจารย์ผู้สอน" จึงไม่พิมพ์ instructorName

โครงสร้างไฟล์ที่ต้องมี (ใน Lambda Layer ให้อยู่ใต้ python/assets/ หรือ python/asset/):
  assets/sarabun/Sarabun-Regular.ttf   (หรือ THSarabunNew.ttf)
  assets/sarabun/Sarabun-Bold.ttf      (ไม่บังคับ)
  assets/templates/INSTRUCTOR_TEMPLATE.pdf   (ใช้ฉบับที่ลบข้อความตัวอย่างที่ซ่อนอยู่แล้ว ดู clean_template.py)
  assets/templates/TA_TEMPLATE.pdf

พิกัด: วัดจากไฟล์ template จริง หน่วย point วัดจาก "ขอบบนของหน้า" ลงมา (y) และจากขอบซ้าย (x)
  - ค่า y ของข้อความคือเส้นฐานตัวอักษร (baseline)
  - template มี MediaBox/CropBox ที่ไม่เริ่มที่ (0,0) (ฟอร์มอาจารย์เริ่ม y=7.83, ฟอร์ม TA y=7.92)
    และฟอร์ม TA เป็นกระดาษ Letter ไม่ใช่ A4 โค้ดจึงอ่านขนาด/จุดเริ่มจากไฟล์ template เอง
    ไม่ใช้ A4 ตายตัว (ไม่งั้นข้อความทั้งหน้าเลื่อนลงประมาณ 8 pt)

เหตุผลที่ใช้ fpdf2 + uharfbuzz แทน ReportLab: ReportLab ไม่จัดตำแหน่งวรรณยุกต์ซ้อนบนสระ
(ที่, นี่, ปู่, เกี่ยว วรรณยุกต์หาย) ส่วน fpdf2 เมื่อเปิด text shaping ใช้ HarfBuzz ได้ถูกต้อง
ต้องมี fpdf2, uharfbuzz, pypdf ใน Layer (build สำหรับ Linux ให้ตรงกับ runtime/สถาปัตยกรรมของ Lambda)

ความสามารถ:
  - เกิน rows_per_page แถว (อาจารย์ 8, TA 9) จะแบ่งหลายหน้า (ยอดรวมที่หน้าสุดท้าย พร้อมเลขหน้า)
  - ข้อความยาวเกินช่องจะย่อขนาดตัวอักษรแล้วตัดด้วย "..."
  - ไม่พบฟอนต์/template จะ error ชัดเจน (ไม่ fallback เป็นฟอนต์ที่ไม่มีภาษาไทยแบบเงียบๆ)
  - generate_blank_pdf() สำหรับฟอร์มเปล่า (นักศึกษาช่วยงานเขียนลายมือ)
"""
import datetime as dt
import io
import os
from decimal import Decimal

from fpdf import FPDF
from pypdf import PdfReader, PdfWriter, Transformation

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- ค้นหาไฟล์ assets
ASSET_BASES = (
    os.path.join("/opt", "python", "assets"),
    os.path.join("/opt", "python", "asset"),
    os.path.join("/opt", "assets"),
    os.path.join("/opt", "asset"),
    os.path.join(HERE, "assets"),
    os.path.join(HERE, "asset"),
    HERE,
)

# เพิ่ม "Sarabun" (ตัวพิมพ์ใหญ่) เข้าไปในรายการโฟลเดอร์ฟอนต์
FONT_DIRS = ("Sarabun", "sarabun", "sarubun", "fonts", "")
TEMPLATE_DIRS = ("templates", "template", "")

REGULAR_FONT_FILES = ("Sarabun-Regular.ttf", "THSarabunNew.ttf")
BOLD_FONT_FILES = ("Sarabun-Bold.ttf", "THSarabunNew Bold.ttf", "THSarabunNew-Bold.ttf")

# เพิ่มชื่อไฟล์แบบใช้ขีดกลาง (-) ให้ตรงกับโครงสร้างในเครื่อง
INSTRUCTOR_TEMPLATE_FILES = ("INSTRUCTOR-TEMPLATE.pdf", "INSTRUCTOR_TEMPLATE.pdf")
TA_TEMPLATE_FILES = ("TA-TEMPLATE.pdf", "TA_TEMPLATE.pdf")

FONT = "Thai"
USE_BOLD_FOR_DATA = False  # True = พิมพ์ข้อมูลด้วยตัวหนา (ค่าเริ่มต้นตัวปกติ)


def find_asset(filenames, subdirs=("",)):
    """ค้นหาไฟล์จากตำแหน่งมาตรฐานก่อน แล้วค้นหาโฟลเดอร์ย่อยเพิ่มเติม

    รองรับ assets ที่ถูกวางไว้ใน /opt/python/assets, /opt/python/asset,
    /opt/assets, /opt/asset, โฟลเดอร์เดียวกับไฟล์นี้ หรือโฟลเดอร์ย่อยอื่น ๆ
    ภายในตำแหน่งเหล่านั้น เช่น static/fonts/ หรือ layer ที่มีการซ้อนโฟลเดอร์
    """
    # 1) ลองตำแหน่งมาตรฐานก่อน เพื่อให้ผลลัพธ์คาดเดาได้
    for base in ASSET_BASES:
        for sub in subdirs:
            for name in filenames:
                path = os.path.join(base, sub, name)
                if os.path.isfile(path):
                    return path

    # 2) ค้นหาแบบ recursive เผื่อไฟล์อยู่ในโฟลเดอร์ย่อยที่ไม่คาดไว้
    targets = {name.lower() for name in filenames}
    for base in ASSET_BASES:
        if not os.path.isdir(base):
            continue
        for root, _, files in os.walk(base):
            for filename in files:
                if filename.lower() in targets:
                    return os.path.join(root, filename)
    return None


def get_asset_path(relative_path):
    """เข้ากันได้กับเวอร์ชันเดิม: คืน path ของไฟล์ใต้ assets/ (Layer ก่อน แล้วโฟลเดอร์ข้างโค้ด)"""
    for base in ASSET_BASES:
        path = os.path.join(base, relative_path)
        if os.path.exists(path):
            return path
    return os.path.join(HERE, "assets", relative_path)


def _searched(filenames, subdirs):
    return [os.path.join(b, s, n) for b in ASSET_BASES for s in subdirs for n in filenames]


def _font_paths():
    regular = find_asset(REGULAR_FONT_FILES, FONT_DIRS)
    if regular is None:
        raise FileNotFoundError(
            "ไม่พบฟอนต์ภาษาไทย ค้นหาที่: " + ", ".join(_searched(REGULAR_FONT_FILES, FONT_DIRS))
        )
    return regular, find_asset(BOLD_FONT_FILES, FONT_DIRS) or regular


def ensure_fonts():
    """ตรวจว่ามีฟอนต์ก่อนเริ่มสร้างไฟล์ (error ชัดเจนถ้าไม่พบ)"""
    _font_paths()


# ---------------------------------------------------------------- template
TA_ROLES = ("ta", "student_helper", "student")


def is_ta_role(role_name):
    return (role_name or "").strip().lower() in TA_ROLES


def get_template_path_by_role(role_name):
    """เลือกไฟล์ Template ตาม Role ของเจ้าของคำขอ (ta/student_helper/student = ฟอร์ม TA ที่เหลือ = ฟอร์มอาจารย์)"""
    files = TA_TEMPLATE_FILES if is_ta_role(role_name) else INSTRUCTOR_TEMPLATE_FILES
    path = find_asset(files, TEMPLATE_DIRS)
    if path is None:
        raise FileNotFoundError(
            "ไม่พบไฟล์ Template PDF ค้นหาที่: " + ", ".join(_searched(files, TEMPLATE_DIRS))
        )
    return path


# ---------------------------------------------------------------- ตำแหน่งบนแบบฟอร์ม (วัดจากไฟล์ template จริง)
# y ทั้งหมดวัดจากขอบบนของหน้า (point) และเป็น "เส้นฐานตัวอักษร"; x วัดจากขอบซ้าย
FONT_SIZE = 12          # Sarabun ตัวใหญ่กว่า THSarabunNew (ฟอร์มใช้ 15) ในขนาดเท่ากัน จึงใช้ 12 ให้ดูเท่าตัวอักษรของฟอร์ม
MIN_FONT_SIZE = 9
BASELINE_RATIO = 0.8    # ระยะจากขอบบนของ cell (สูง = ขนาดฟอนต์) ถึง baseline ของฟอนต์ Sarabun (วัดแล้ว)
ROW_BASELINE_RATIO = 0.30  # baseline ในแถวตาราง = กึ่งกลางแถว + 0.30 x ขนาดฟอนต์ (ให้ตัวอักษรไทยอยู่กลางแถว)

LAYOUTS = {
    "instructor": {
        "rows_per_page": 8,
        "cols": (70.9, 160.9, 286.2, 431.3, 521.3),  # วัน/เดือน/ปี | เวลา | ลายเซ็น (ว่าง) | หมายเหตุ
        "row_lines": (419.4, 444.2, 469.1, 493.6, 518.4, 543.2, 567.9, 592.6, 617.4),
        "value_x": 201.2,
        "line_semester": 244.3,   # "การศึกษาขั้นปริญญา"
        "line_course": 269.8,     # "ผู้บรรยายลักษณะวิชา"
        "line_person": 322.0,     # "ชื่อผู้บรรยาย"
        "line_month": 348.4,      # "ประจำเดือน"
        "ticks": {"theory": (206.8, 294.6), "practice": (349.2, 294.6)},  # กึ่งกลางกล่อง ภาคทฤษฎี / ภาคปฏิบัติ
        "total": (322.0, 652.5),  # กึ่งกลางจุดไข่ปลา "รวมเวลาปฏิบัติงาน ........ ชั่วโมง" (x), baseline (y)
        "director": (303.5, 744.7),  # กึ่งกลางเหนือบรรทัด "ผู้อำนวยการโครงการ..."
        "page_no_y": 826.0,
    },
    "ta": {
        "rows_per_page": 9,
        "cols": (66.1, 193.0, 313.2, 451.3, 548.3),
        "row_lines": (381.6, 407.2, 432.4, 457.7, 483.3, 508.9, 534.4, 560.7, 586.1, 611.6),
        "value_x": 200.5,
        "line_semester": 251.2,   # "การศึกษาชั้นปริญญาตรี"
        "line_course": 275.8,     # "ผู้บรรยายลักษณะวิชา"
        "line_person": 301.3,     # "ชื่อผู้ช่วยสอน"
        "line_month": 326.6,      # "ประจำเดือน"
        "ticks": None,            # ฟอร์ม TA ไม่มีช่องติ๊กภาคทฤษฎี/ปฏิบัติ
        "total": (338.9, 642.0),
        "director": (308.4, 716.7),
        "page_no_y": 780.0,
    },
}

THAI_MONTHS = (
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
)


# ---------------------------------------------------------------- ตัวช่วยจัดรูปแบบ (ให้ handler เรียกใช้ตอนประกอบ data)
def _s(value):
    return "" if value is None else str(value)


def _to_date(value):
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    return dt.datetime.strptime(str(value).strip()[:10], "%Y-%m-%d").date()


def thai_date(value):
    """date / datetime / 'YYYY-MM-DD' -> 'dd/mm/พ.ศ.' เช่น 06/04/2569"""
    d = _to_date(value)
    return f"{d.day:02d}/{d.month:02d}/{d.year + 543}"


def thai_month_label(value, room=None):
    """-> 'เมษายน พ.ศ. 2569' (ต่อท้ายด้วย room ถ้าระบุ เช่น room='จ. บร.2-213' = วันและห้องที่บรรยาย)
    ปีของเดือนคิดจากวันที่ทำงานจริง (ค.ศ.+543) ไม่ใช่ปีการศึกษา"""
    d = _to_date(value)
    label = f"{THAI_MONTHS[d.month - 1]} พ.ศ. {d.year + 543}"
    return f"{label} {room}" if room else label


def _to_hhmm(value):
    """TIME จาก pymysql เป็น timedelta; รองรับ datetime.time / datetime / 'HH:MM:SS' ด้วย"""
    if value is None:
        return ""
    if isinstance(value, dt.timedelta):
        total = int(value.total_seconds())
        return f"{total // 3600:02d}:{total % 3600 // 60:02d}"
    if isinstance(value, (dt.time, dt.datetime)):
        return f"{value.hour:02d}:{value.minute:02d}"
    return str(value).strip()[:5]


def format_time_range(start, end, hours=None):
    """-> '09:00-12:00' ถ้าเป็นเวลาจริง
    รายการที่ผู้ใช้กรอกเองเก็บ startTime เป็น 00:00 (ค่าสมมุติ) จึงพิมพ์เป็น 'X ชม.' แทน (หรือเว้นว่างถ้าไม่ส่ง hours)"""
    s, e = _to_hhmm(start), _to_hhmm(end)
    if not s or not e or s == "00:00":
        return f"{float(hours):g} ชม." if hours is not None else ""
    return f"{s}-{e}"


def _total_hours(data, rows):
    if data.get("totalHours") is not None:
        try:
            return float(data["totalHours"])
        except (ValueError, TypeError):
            pass
    total = 0.0
    for row in rows:
        try:
            total += float(row.get("hours", 0) or 0)
        except (ValueError, TypeError):
            pass
    return total


def _fmt_hours(value):
    text = f"{Decimal(str(value)).quantize(Decimal('0.01')):f}"
    return text.rstrip("0").rstrip(".") if "." in text else text


# ---------------------------------------------------------------- วาดข้อความ (fpdf2 + HarfBuzz)
def _new_overlay(page_w, page_h):
    regular, bold = _font_paths()
    pdf = FPDF(unit="pt", format=(page_w, page_h))
    pdf.add_font(FONT, "", regular)
    pdf.add_font(FONT, "B", bold)
    pdf.set_text_shaping(True)       # จัดวรรณยุกต์/สระซ้อนของภาษาไทย (ต้องมี uharfbuzz)
    pdf.set_auto_page_break(False)
    pdf.set_margins(0, 0, 0)
    pdf.c_margin = 0                 # ไม่ให้ cell เว้นขอบซ้ายขวา ตำแหน่ง x จะตรงตามที่ระบุ
    return pdf


def _put(pdf, x, baseline, text, size=FONT_SIZE, align="L", max_width=None, bold=False):
    """พิมพ์ข้อความ: align L = เริ่มที่ x, C = กึ่งกลางที่ x, R = ชิดขวาที่ x; baseline คือเส้นฐาน (จากขอบบน)
    ถ้ากว้างเกิน max_width จะย่อตัวอักษรถึง MIN_FONT_SIZE แล้วตัดท้ายด้วย '...'"""
    text = _s(text).strip()
    if not text:
        return
    style = "B" if (bold or USE_BOLD_FOR_DATA) else ""
    size = float(size)
    pdf.set_font(FONT, style, size)
    width = pdf.get_string_width(text)
    if max_width:
        while size > MIN_FONT_SIZE and width > max_width:
            size -= 0.5
            pdf.set_font(FONT, style, size)
            width = pdf.get_string_width(text)
        if width > max_width:
            while text and pdf.get_string_width(text + "...") > max_width:
                text = text[:-1]
            text += "..."
            width = pdf.get_string_width(text)
    x0 = x if align == "L" else (x - width / 2 if align == "C" else x - width)
    pdf.set_text_color(0, 0, 0)
    pdf.set_xy(x0, baseline - BASELINE_RATIO * size)
    pdf.cell(width + 1, size, text)


NOTE_MIN_SIZE = 10


def _split_two_lines(pdf, text, width):
    """แบ่งข้อความเป็นไม่เกิน 2 บรรทัดให้พอดีความกว้าง (ภาษาไทยไม่มีเว้นวรรคจึงตัดตามความกว้างจริง)"""
    first = text
    while first and pdf.get_string_width(first) > width:
        first = first[:-1]
    cut = len(first)
    if " " in first and cut < len(text):          # ถ้ามีเว้นวรรคให้ตัดที่เว้นวรรคล่าสุด
        cut = first.rstrip().rfind(" ") + 1 or cut
    line1, rest = text[:cut].rstrip(), text[cut:].strip()
    line2 = rest
    while line2 and pdf.get_string_width(line2) > width:
        line2 = line2[:-1]
        if len(line2) < len(rest):
            while line2 and pdf.get_string_width(line2 + "...") > width:
                line2 = line2[:-1]
    if rest and len(line2) < len(rest):
        line2 += "..."
    return line1, line2


def _put_note(pdf, x, row_top, row_bottom, text, width):
    """หมายเหตุในช่องแคบ: บรรทัดเดียวถ้าพอ (ย่อได้ถึง NOTE_MIN_SIZE) ไม่พอก็ 2 บรรทัด"""
    text = _s(text).strip()
    if not text:
        return
    mid = (row_top + row_bottom) / 2
    pdf.set_font(FONT, "", NOTE_MIN_SIZE)
    if pdf.get_string_width(text) <= width:
        _put(pdf, x, mid + ROW_BASELINE_RATIO * FONT_SIZE, text, size=FONT_SIZE,
             max_width=width)
        return
    size = NOTE_MIN_SIZE
    pdf.set_font(FONT, "", size)
    line1, line2 = _split_two_lines(pdf, text, width)
    _put(pdf, x, mid - 1.2, line1, size=size, max_width=width)
    _put(pdf, x, mid + 9.5, line2, size=size, max_width=width)


def _draw_tick(pdf, cx, cy):
    pdf.set_draw_color(0, 0, 0)
    pdf.set_line_width(1.5)
    pdf.line(cx - 4.5, cy + 0.5, cx - 1.5, cy + 4.0)
    pdf.line(cx - 1.5, cy + 4.0, cx + 5.0, cy - 5.0)


def _draw_watermark(pdf, page_w, page_h):
    """ลายน้ำ 'ตัวอย่าง' กลางหน้า เอียง 55 องศา โปร่งแสง (ไม่บังเส้นตาราง)"""
    cx, cy, size = page_w / 2, page_h / 2, 130
    with pdf.local_context(fill_opacity=0.14):
        with pdf.rotation(angle=55, x=cx, y=cy):
            pdf.set_font(FONT, "B", size)
            pdf.set_text_color(220, 30, 30)
            w = pdf.get_string_width("ตัวอย่าง")
            pdf.set_xy(cx - w / 2, cy - BASELINE_RATIO * size * 0.6)
            pdf.cell(w + 2, size, "ตัวอย่าง")


def _draw_page(pdf, layout, data, is_ta, page_rows, preview, page_index, page_count,
               grand_total, page_w, page_h):
    """วาดหนึ่งหน้า: ส่วนหัวซ้ำทุกหน้า, ตารางเฉพาะแถวของหน้านั้น, ยอดรวม/ชื่อผู้อำนวยการเฉพาะหน้าสุดท้าย"""
    pdf.add_page()
    if preview:
        _draw_watermark(pdf, page_w, page_h)

    vx = layout["value_x"]
    semester, year = _s(data.get("semester")), _s(data.get("academicYearBE"))
    if semester or year:
        _put(pdf, vx, layout["line_semester"], f"ภาคการศึกษาที่ {semester} ปีการศึกษา {year}",
             max_width=300)
    _put(pdf, vx, layout["line_course"], data.get("courseLine"), max_width=330)
    person = data.get("taName") if is_ta else data.get("lecturer")
    _put(pdf, vx, layout["line_person"], person, max_width=330)
    _put(pdf, vx, layout["line_month"], data.get("monthLabel"), max_width=330)

    ticks = layout.get("ticks")
    kind = data.get("courseKind")
    if ticks and kind in ticks:
        _draw_tick(pdf, *ticks[kind])

    # ตารางรายการงาน: วันที่/เวลาอยู่กึ่งกลางคอลัมน์ หมายเหตุชิดซ้ายเว้นขอบ; ช่องลายเซ็นเว้นว่างไว้เซ็นด้วยปากกาน้ำเงิน
    cols, lines = layout["cols"], layout["row_lines"]
    for i, row in enumerate(page_rows):
        base = (lines[i] + lines[i + 1]) / 2 + ROW_BASELINE_RATIO * FONT_SIZE
        _put(pdf, (cols[0] + cols[1]) / 2, base, row.get("date"), align="C",
             max_width=cols[1] - cols[0] - 8)
        _put(pdf, (cols[1] + cols[2]) / 2, base, row.get("time"), align="C",
             max_width=cols[2] - cols[1] - 8)
        _put_note(pdf, cols[3] + 4, lines[i], lines[i + 1], row.get("note"),
                  cols[4] - cols[3] - 8)

    if grand_total is not None:
        tx, ty = layout["total"]
        _put(pdf, tx, ty, _fmt_hours(grand_total), align="C")
        director = _s(data.get("directorName")).strip()
        if director:
            dx, dy = layout["director"]
            _put(pdf, dx, dy, f"({director})" if not director.startswith("(") else director,
                 align="C", max_width=260)

    if page_count > 1:
        _put(pdf, page_w / 2, layout["page_no_y"], f"หน้า {page_index + 1}/{page_count}",
             size=10, align="C")


# ---------------------------------------------------------------- ตัวสร้าง PDF
def _template_geometry(template_bytes):
    """ขนาดหน้าที่มองเห็นจริง (CropBox) และจุดเริ่ม (มุมซ้ายล่าง) ของ template"""
    page = PdfReader(io.BytesIO(template_bytes)).pages[0]
    box = page.cropbox
    left, bottom = float(box.left), float(box.bottom)
    return float(box.right) - left, float(box.top) - bottom, left, bottom


def _merge_pages(template_bytes, overlay_bytes, count, origin):
    """ซ้อน overlay ลง template ทีละหน้า โดยเลื่อนตามมุมซ้ายล่างของ CropBox
    (พิกัดใน overlay นับจากมุมของ "หน้าที่มองเห็น" ไม่ใช่จาก (0,0) ของ user space)"""
    writer = PdfWriter()
    overlay = PdfReader(io.BytesIO(overlay_bytes)) if overlay_bytes is not None else None
    for i in range(count):
        # อ่าน template ใหม่ทุกหน้า เพราะ merge แก้ไข object ของหน้านั้นโดยตรง
        base = PdfReader(io.BytesIO(template_bytes)).pages[0]
        if overlay is not None:
            base.merge_transformed_page(
                overlay.pages[i], Transformation().translate(tx=origin[0], ty=origin[1])
            )
        writer.add_page(base)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def _read_template(role_name):
    path = get_template_path_by_role(role_name)
    with open(path, "rb") as f:
        return f.read()


def generate_pdf_from_template(data, role_name="instructor", preview=True):
    """รับ data (dict) + role_name ของเจ้าของคำขอ แล้วพิมพ์ลง template คืนไฟล์ PDF เป็น bytes
    preview=True: ใส่ลายน้ำ 'ตัวอย่าง' ทุกหน้า (ฉบับพิมพ์จริงใช้ preview=False)
    เกิน rows_per_page แถวจะแบ่งเป็นหลายหน้า"""
    ensure_fonts()
    is_ta = is_ta_role(role_name)
    layout = LAYOUTS["ta" if is_ta else "instructor"]
    template_bytes = _read_template(role_name)
    page_w, page_h, left, bottom = _template_geometry(template_bytes)

    rows = list(data.get("rows") or [])
    per = layout["rows_per_page"]
    pages = [rows[i:i + per] for i in range(0, len(rows), per)] or [[]]
    grand_total = _total_hours(data, rows)

    pdf = _new_overlay(page_w, page_h)
    for idx, page_rows in enumerate(pages):
        last = idx == len(pages) - 1
        _draw_page(pdf, layout, data, is_ta, page_rows, preview, idx, len(pages),
                   grand_total if last else None, page_w, page_h)
    return _merge_pages(template_bytes, bytes(pdf.output()), len(pages), (left, bottom))


def generate_blank_pdf(role_name="instructor"):
    """ฟอร์มเปล่าไม่มีข้อมูลและไม่มีลายน้ำ (นักศึกษาช่วยงานพิมพ์ไปเขียนลายมือ)"""
    template_bytes = _read_template(role_name)
    _, _, left, bottom = _template_geometry(template_bytes)
    return _merge_pages(template_bytes, None, 1, (left, bottom))