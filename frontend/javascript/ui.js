// ui.js — ตัวช่วยสร้าง Component ส่วนกลางของ V3 (คู่กับ css/ui.css) ตาม Figma "01 · Components"
// ต้องโหลดหลัง core.js (ใช้ esc) และก่อน api.js / ไฟล์ของแต่ละหน้า

/* ---------- สถานะคำขอ (ชุดเดียวทั้งระบบ) ----------
   key ตาม API (V3-10): draft, submitted, returned, approved, rejected, documents_received, sent_to_finance, paid (FIX-03)
   approved แสดงต่างกันตามช่องทางยื่น printMethod: sign_with_staff / self_print */
const CLAIM_STATUS = {
  draft:              { th: 'ร่าง', cls: 'draft' },
  submitted:          { th: 'รอเจ้าหน้าที่ตรวจ', cls: 'review' },
  returned:           { th: 'ส่งกลับแก้ไข', cls: 'ret' },
  approved:           { th: 'ตรวจผ่าน · รอเซ็นเอกสาร', cls: 'sign' },
  rejected:           { th: 'ไม่อนุมัติ', cls: 'rej' },
  documents_received: { th: 'รับเอกสารแล้ว · รอส่งการเงิน', cls: 'recv' },
  sent_to_finance:    { th: 'ส่งการเงินแล้ว · รอเงินเข้า', cls: 'done' },
  paid:               { th: 'เงินเข้าเรียบร้อยแล้ว', cls: 'paid' }
};
const APPROVED_SELF = { th: 'ตรวจผ่าน · ปริ้นเซ็นเอง', cls: 'self' };

const statusOf = (status, printMethod) =>
  (status === 'approved' && printMethod === 'self_print' ? APPROVED_SELF : CLAIM_STATUS[status]) || { th: status || '-', cls: 'draft' };

const chip = (status, printMethod) => {
  const s = statusOf(status, printMethod);
  return `<span class="chip ${s.cls}">${esc(s.th)}</span>`;
};

// ช่องทางยื่น (claims.printStatus → printMethod)
const PRINT_METHOD = {
  sign_with_staff: { th: 'ยื่นในระบบ → เซ็นกับเจ้าหน้าที่', short: 'เซ็นกับเจ้าหน้าที่' },
  self_print: { th: 'ส่งตรวจ → ปริ้นเซ็นเอง แล้วนำส่ง', short: 'ปริ้นเซ็นเอง' }
};

// เคาน์เตอร์เจ้าหน้าที่และผู้ลงนามในแบบฟอร์ม (แสดงในขั้นตอนถัดไปและท้ายเอกสาร)
const OFFICE = {
  room: 'บร.2-101',
  hours: 'จ.–ศ. 09:00–16:00 น.',
  director: 'ผู้ช่วยศาสตราจารย์ ดร.ปา อยู่ร่มเย็น',
  directorTitle: 'ผู้อำนวยการโครงการปริญญาตรีภาคพิเศษ'
};

// แบบฟอร์มเปล่าของนักศึกษาช่วยงาน (ไฟล์จริงของสาขา พิมพ์ไปกรอกด้วยลายมือ) แยกตามโครงการ (session)
// sessionId ตามตาราง session: 1 = ภาคปกติ, 2 = ภาคพิเศษ — ไม่รู้ session ใช้ภาคปกติ
const BLANK_FORMS = [
  { sessionId: 1, label: 'ภาคปกติ', file: 'assets/forms/timesheet-regular.pdf', name: 'แบบลงชื่อปฏิบัติงาน_ภาคปกติ.pdf' },
  { sessionId: 2, label: 'ภาคพิเศษ', file: 'assets/forms/timesheet-special.pdf', name: 'แบบลงชื่อปฏิบัติงาน_ภาคพิเศษ.pdf' }
];
const blankFormOf = (c) => BLANK_FORMS.find((f) => String(f.sessionId) === String(c?.sessionId)) || BLANK_FORMS[0];

// การ์ดดาวน์โหลดแบบฟอร์มเปล่า (หน้าภาพรวมของนักศึกษาช่วยงาน)
function blankFormsHtml() {
  const tile = (f) => `<div class="choice form-tile">
      <span class="ic" aria-hidden="true">📄</span>
      <div><b>แบบฟอร์ม${esc(f.label)}</b><small>แบบลงชื่อปฏิบัติงานและใบรับเงิน · PDF A4</small>
        <div class="form-btns"><a class="btn sm" href="${esc(f.file)}" download="${esc(f.name)}">ดาวน์โหลด</a></div></div>
    </div>`;
  return `<div class="card-head"><h3 id="formsTitle">แบบฟอร์มลงชื่อปฏิบัติงาน (เปล่า)</h3></div>
    <p class="muted">พิมพ์แบบฟอร์มตามโครงการที่ทำงาน กรอกด้วยลายมือ ให้ผู้ควบคุมเซ็นรับรอง แล้วนำส่งเจ้าหน้าที่พร้อมคำขอ</p>
    <div class="forms-grid">${BLANK_FORMS.map(tile).join('')}</div>`;
}

/* ---------- Stepper ----------
   sign_with_staff (6 ขั้น): ร่าง → ยื่น → ตรวจ → เซ็นเอกสาร → ส่งการเงิน → เงินเข้า
   self_print (7 ขั้น): ร่าง → ส่งตรวจ → ตรวจ → ปริ้น + เซ็น → นำส่งเอกสาร → ส่งการเงิน → เงินเข้า
   returned / rejected หยุดที่ขั้นเจ้าหน้าที่ตรวจ (สีแดง) */
function stepperHtml(status, printMethod) {
  const self = printMethod === 'self_print';
  const labels = self
    ? ['ร่างคำขอ', 'ส่งตรวจ', 'เจ้าหน้าที่ตรวจ', 'ปริ้น + เซ็น', 'นำส่งเอกสาร', 'ส่งการเงิน', 'เงินเข้า']
    : ['ร่างคำขอ', 'ยื่นคำขอ', 'เจ้าหน้าที่ตรวจ', 'เซ็นเอกสาร', 'ส่งการเงิน', 'เงินเข้า'];
  // ขั้นที่กำลังทำอยู่ (index) ของแต่ละสถานะ
  const now = (self
    ? { draft: 0, submitted: 2, returned: 2, rejected: 2, approved: 3, documents_received: 5, sent_to_finance: 6, paid: 7 }
    : { draft: 0, submitted: 2, returned: 2, rejected: 2, approved: 3, documents_received: 4, sent_to_finance: 5, paid: 6 })[status] ?? 0;
  const stop = status === 'returned' || status === 'rejected';
  return `<ol class="stepper" aria-label="ขั้นตอนของคำขอ">${labels.map((t, i) => {
    const cls = i < now ? 'done' : i === now ? (stop ? 'stop' : 'now') : '';
    return `<li class="${cls}"${i === now ? ' aria-current="step"' : ''}>${esc(t)}</li>`;
  }).join('')}</ol>`;
}

/* ---------- วันที่และเวลาแบบไทย ----------
   วันที่จาก API เป็น ISO: '2026-09-07' หรือ '2026-09-07T09:30:00' ; เดือน = 'YYYY-MM' ; เวลา = 'HH:MM' */
const TH_MONTH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const TH_DAY = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const TH_DAY_LONG = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

const pad2 = (n) => String(n).padStart(2, '0');
// Date → '2026-09-07' (เวลาท้องถิ่น ไม่ใช่ UTC)
const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const isoMonth = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
// '2026-09-07' หรือ '2026-09-07T09:30:00' → Date เที่ยงคืนท้องถิ่นของวันนั้น
const parseDay = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const parseMonth = (s) => { const [y, m] = String(s).split('-').map(Number); return new Date(y, m - 1, 1); };
const addMonths = (ym, n) => { const d = parseMonth(ym); d.setMonth(d.getMonth() + n); return isoMonth(d); };
const todayIso = () => isoDate(new Date());
const be = (y) => (Number(y) < 2400 ? Number(y) + 543 : Number(y));

// 'จ. 7 ก.ย. 2569'
const thDate = (s, withDay = true) => {
  if (!s) return '-';
  const d = parseDay(s);
  return `${withDay ? TH_DAY[d.getDay()] + ' ' : ''}${d.getDate()} ${TH_MON[d.getMonth()]} ${be(d.getFullYear())}`;
};
// 'จันทร์ 21 ก.ย. 2569'
const thDateLong = (s) => { const d = parseDay(s); return `${TH_DAY_LONG[d.getDay()]} ${d.getDate()} ${TH_MON[d.getMonth()]} ${be(d.getFullYear())}`; };
// '2026-09' → 'ก.ย. 2569' / 'กันยายน 2569'
const thMonth = (ym) => { const d = parseMonth(ym); return `${TH_MON[d.getMonth()]} ${be(d.getFullYear())}`; };
const thMonthLong = (ym) => { const d = parseMonth(ym); return `${TH_MONTH[d.getMonth()]} ${be(d.getFullYear())}`; };
// เวลา ISO (2026-10-03T10:48:00Z) → '3 ต.ค. 2569 10:48 น.'
const thDateTime = (s) => {
  if (!s) return '-';
  const d = new Date(s);
  return `${d.getDate()} ${TH_MON[d.getMonth()]} ${be(d.getFullYear())} ${pad2(d.getHours())}:${pad2(d.getMinutes())} น.`;
};
const thShortTime = (s) => { const d = new Date(s); return `${d.getDate()} ${TH_MON[d.getMonth()]} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

// 'HH:MM' จากเวลา ISO หรือ 'HH:MM' ; ช่วงเวลา '09:30–12:30'
const hhmm = (t) => { const m = /(\d{2}):(\d{2})/.exec(String(t || '')); return m ? `${m[1]}:${m[2]}` : ''; };
const timeRange = (a, b) => `${hhmm(a)}–${hhmm(b)}`;
const toMin = (t) => { const [h, m] = hhmm(t).split(':').map(Number); return h * 60 + m; };
// ชั่วโมงระหว่าง 2 เวลา (ปัดทศนิยม 2 ตำแหน่ง) ; ช่วงกลับด้าน = 0
const hoursBetween = (a, b) => Math.max(0, Math.round((toMin(b) - toMin(a)) / 60 * 100) / 100);
// ตัวเลขแบบไทย 18000 → '18,000'
const num = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

/* ---------- รอบการเบิก ----------
   หลักเกณฑ์ (data/sections/cycles.json): รอบ 1 ส่งภายในวันที่ 5, รอบ 2 วันที่ 6–10 ของเดือนถัดจากงาน
   period = { academicYear, semester, claimMonth:'2026-09', deadline:'2026-10-05', daysLeft, cycle } จาก GET /current-period
   (หน้า login คำนวณเองเพราะยังไม่มี token) */
function periodFromDate(today = new Date()) {
  const d = today.getDate();
  // หลังวันที่ 10 → รอบที่ 1 ของเดือนหน้า (งานของเดือนนี้)
  const due = d > 10 ? new Date(today.getFullYear(), today.getMonth() + 1, 1) : new Date(today.getFullYear(), today.getMonth(), 1);
  const cycle = d > 5 && d <= 10 ? 2 : 1;
  const deadline = new Date(due.getFullYear(), due.getMonth(), cycle === 1 ? 5 : 10);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return {
    claimMonth: isoMonth(new Date(due.getFullYear(), due.getMonth() - 1, 1)),
    deadline: isoDate(deadline),
    daysLeft: Math.max(0, Math.round((deadline - start) / 86400000)),
    cycle
  };
}
// รอบจากวันสิ้นสุด: วันที่ ≤ 5 = รอบ 1, 6–10 = รอบ 2
const cycleOf = (p) => p.cycle || (parseDay(p.deadline).getDate() <= 5 ? 1 : 2);
// 'รอบที่ 1 · ภายใน 5 ต.ค. 2569' / 'รอบที่ 2 · 6–10 ต.ค. 2569'
function periodTitle(p) {
  const d = parseDay(p.deadline), mon = `${TH_MON[d.getMonth()]} ${be(d.getFullYear())}`;
  return cycleOf(p) === 1 ? `รอบที่ 1 · ภายใน 5 ${mon}` : `รอบที่ 2 · 6–10 ${mon}`;
}
// คำขอแสดงรอบแบบสั้น: 'รอบที่ 1 ต.ค.'
const cycleShort = (c) => (c.deadline ? `รอบที่ ${cycleOf(c)} ${TH_MON[parseDay(c.deadline).getMonth()]}` : '-');

// การ์ดรอบการเบิกปัจจุบัน (พื้นกรมท่า)
function periodCardHtml(p) {
  const due = parseDay(p.deadline), mon = `${TH_MON[due.getMonth()]}`;
  const foot = cycleOf(p) === 1 ? `<div class="foot">รอบที่ 2: 6–10 ${mon} · หลังวันที่ 10 เลื่อนไปรอบถัดไป</div>` : '';
  return `<div class="eyebrow">รอบการเบิกปัจจุบัน</div>
    <div class="t">${esc(periodTitle(p))}</div>
    <div class="d">สำหรับงานเดือน ${esc(thMonthLong(p.claimMonth))}</div>
    <div class="left">เหลืออีก <b>${esc(p.daysLeft)}</b> วัน</div>${foot}`;
}

// ขั้นตอน 3 ขั้นของ Flow สร้างคำขอ: step = 1 | 2 | 3
function steps3Html(step) {
  const labels = ['ข้อมูลคำขอ (autofill)', 'ตรวจตัวอย่าง PDF', 'เลือกช่องทางยื่น'];
  return `<ol class="steps3">${labels.map((t, i) => {
    const n = i + 1;
    const cls = n < step ? 'done' : n === step ? 'now' : '';
    return `<li class="${cls}"${n === step ? ' aria-current="step"' : ''}><span class="n">${n < step ? '✓' : n}</span>${esc(t)}</li>`;
  }).join('')}</ol>`;
}

/* ---------- กล่องข้อความ ----------
   tone: warn (หมายเหตุ เหลือง) | danger (ส่งกลับแก้ไข) | success (สำเร็จ) | info (ขั้นตอนถัดไป) */
const ALERT_MARK = { warn: 'i', danger: '!', success: '✓', info: 'i' };
// bodyHtml ต้อง escape มาแล้ว
function alertHtml(tone, bodyHtml, actionHtml = '') {
  return `<div class="alert ${tone === 'warn' ? '' : tone}" role="${tone === 'danger' ? 'alert' : 'status'}">
    <span class="dot" aria-hidden="true">${ALERT_MARK[tone] || 'i'}</span>
    <span class="body">${bodyHtml}</span>
    ${actionHtml ? `<span class="act">${actionHtml}</span>` : ''}
  </div>`;
}
const alertBox = (tone, label, text, actionHtml = '') =>
  alertHtml(tone, `${label ? `<b>${esc(label)}:</b> ` : ''}${esc(text)}`, actionHtml);

/* ---------- Empty / Error / Skeleton ---------- */

// ไม่มีข้อมูล: action = { text, href } หรือ { text, id } (ปุ่มที่หน้าไปผูก event เอง)
function emptyState(title, text, action) {
  const btn = !action ? '' : action.href
    ? `<a class="btn ghost" href="${esc(action.href)}">${esc(action.text)}</a>`
    : `<button type="button" class="btn ghost" id="${esc(action.id)}">${esc(action.text)}</button>`;
  return `<div class="state"><span class="ic" aria-hidden="true">📅</span><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${btn}</div>`;
}

// โหลดไม่สำเร็จ: ปุ่ม "ลองอีกครั้ง" มี id ตาม retryId ให้หน้าผูก event เอง
function errorState(title, text, retryId) {
  return `<div class="state error" role="alert"><span class="ic" aria-hidden="true">!</span><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${retryId ? `<button type="button" class="btn" id="${esc(retryId)}">ลองอีกครั้ง</button>` : ''}</div>`;
}

// แถบโหลดสีเทา: widths เช่น ['w40', 'lg', '', 'w60']
const skeleton = (widths = ['w40', '', 'w80', 'lg']) =>
  `<div aria-hidden="true">${widths.map((w) => `<span class="sk ${w}"></span>`).join('')}</div>`;

/* ---------- Toast ---------- */

let toastTimer;
function toast(text, isError = false) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  document.body.insertAdjacentHTML('beforeend',
    `<div class="toast ${isError ? 'err' : ''}" role="status"><span class="dot" aria-hidden="true">${isError ? '!' : '✓'}</span>${esc(text)}</div>`);
  toastTimer = setTimeout(() => document.querySelector('.toast')?.remove(), 3200);
}

/* ---------- Modal ----------
   openModal({ eyebrow, title, lead, body (HTML), okText, okClass: ''|'dark'|'danger', cancelText,
               extra: { text, cls } (ปุ่มซ้ายล่าง เช่น "ลบคาบนี้"), wide, onOpen(el),
               validate(el) → false = ยังไม่ปิด,
               onOk(el) async → false = ยังไม่ปิด ; throw = แสดงข้อความ error ในกล่อง })
   → Promise: true เมื่อกดยืนยัน, 'extra' เมื่อกดปุ่มซ้าย, false เมื่อยกเลิก / Esc / คลิกพื้นหลัง / ปุ่ม × */
function openModal(opt) {
  return new Promise((resolve) => {
    const last = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'modal-back';
    wrap.innerHTML = `<div class="modal ${opt.wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="mTitle">
      <div class="m-head">
        <div>
          ${opt.eyebrow ? `<div class="eyebrow">${esc(opt.eyebrow)}</div>` : ''}
          <h3 id="mTitle">${esc(opt.title)}</h3>
          ${opt.lead ? `<p class="lead">${esc(opt.lead)}</p>` : ''}
        </div>
        <button type="button" class="m-x" data-m="no" aria-label="ปิด">×</button>
      </div>
      ${opt.body ? `<div class="m-body">${opt.body}</div>` : ''}
      <div class="m-err" role="alert"></div>
      <div class="foot">
        ${opt.extra ? `<button type="button" class="btn ${opt.extra.cls || 'danger'} m-extra" data-m="extra">${esc(opt.extra.text)}</button>` : ''}
        <button type="button" class="btn ghost" data-m="no">${esc(opt.cancelText || 'ยกเลิก')}</button>
        <button type="button" class="btn ${opt.okClass || ''}" data-m="ok">${esc(opt.okText || 'ยืนยัน')}</button>
      </div>
    </div>`;
    const close = (val) => {
      document.removeEventListener('keydown', onKey);
      wrap.remove();
      document.body.style.overflow = '';
      last?.focus?.();
      resolve(val);
    };
    const onKey = (e) => { if (e.key === 'Escape' && !wrap.dataset.busy) close(false); };
    const okBtn = wrap.querySelector('[data-m="ok"]');
    async function confirm() {
      if (opt.validate && opt.validate(wrap) === false) return;
      if (!opt.onOk) return close(true);
      wrap.dataset.busy = '1';
      okBtn.disabled = true;
      wrap.querySelector('.m-err').textContent = '';
      try {
        if (await opt.onOk(wrap) !== false) return close(true);
      } catch (err) {
        wrap.querySelector('.m-err').textContent = err.message || 'ไม่สำเร็จ กรุณาลองใหม่';
      }
      delete wrap.dataset.busy;
      okBtn.disabled = false;
    }
    wrap.addEventListener('click', (e) => {
      if (wrap.dataset.busy) return;
      const m = e.target.closest('[data-m]')?.dataset.m;
      if (e.target === wrap || m === 'no') close(false);
      else if (m === 'extra') close('extra');
      else if (m === 'ok') confirm();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';
    opt.onOpen?.(wrap);
    (wrap.querySelector('.m-body :is(input:not([type="hidden"]), textarea, select)') || okBtn).focus();
  });
}
