// ui.js — ตัวช่วยสร้าง Component ส่วนกลางของ V3 (คู่กับ css/ui.css) ตาม Figma "01 · Components"
// ต้องโหลดหลัง core.js (ใช้ esc) และก่อน api.js / ไฟล์ของแต่ละหน้า

/* ---------- สถานะคำขอ (ชุดเดียวทั้งระบบ) ----------
   key ตาม API (V3-10): draft, submitted, returned, approved, rejected, documents_received, sent_to_finance
   approved แสดงต่างกันตามช่องทางยื่น printMethod: sign_with_staff / self_print */
const CLAIM_STATUS = {
  draft:              { th: 'ร่าง', cls: 'draft' },
  submitted:          { th: 'รอเจ้าหน้าที่ตรวจ', cls: 'review' },
  returned:           { th: 'ส่งกลับแก้ไข', cls: 'ret' },
  approved:           { th: 'ตรวจผ่าน · รอเซ็นเอกสาร', cls: 'sign' },
  rejected:           { th: 'ไม่อนุมัติ', cls: 'rej' },
  documents_received: { th: 'รับเอกสารแล้ว · รอส่งการเงิน', cls: 'recv' },
  sent_to_finance:    { th: 'ส่งการเงินแล้ว', cls: 'done' }
};
const APPROVED_SELF = { th: 'ตรวจผ่าน · ปริ้นเซ็นเอง', cls: 'self' };

const statusOf = (status, printMethod) =>
  (status === 'approved' && printMethod === 'self_print' ? APPROVED_SELF : CLAIM_STATUS[status]) || { th: status || '-', cls: 'draft' };

const chip = (status, printMethod) => {
  const s = statusOf(status, printMethod);
  return `<span class="chip ${s.cls}">${esc(s.th)}</span>`;
};

/* ---------- Stepper 5 ขั้น ----------
   ขั้น "เซ็นเอกสาร" ของ self_print อ่านว่า "ปริ้นเซ็นเอง" ; rejected หยุดที่ขั้นเจ้าหน้าที่ตรวจ */
function stepperHtml(status, printMethod) {
  const labels = ['ร่างคำขอ', 'ยื่นคำขอ', 'เจ้าหน้าที่ตรวจ', printMethod === 'self_print' ? 'ปริ้นเซ็นเอง' : 'เซ็นเอกสาร', 'ส่งการเงิน'];
  // ขั้นที่กำลังทำอยู่ (index) ของแต่ละสถานะ
  const now = { draft: 0, submitted: 2, returned: 2, rejected: 2, approved: 3, documents_received: 4, sent_to_finance: 5 }[status] ?? 0;
  const stop = status === 'returned' || status === 'rejected';
  return `<ol class="stepper" aria-label="ขั้นตอนของคำขอ">${labels.map((t, i) => {
    const cls = i < now ? 'done' : i === now ? (stop ? 'stop' : 'now') : '';
    return `<li class="${cls}"${i === now ? ' aria-current="step"' : ''}>${esc(i === now && stop ? statusOf(status).th : t)}</li>`;
  }).join('')}</ol>`;
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
function alertBox(tone, label, text, actionHtml = '') {
  return `<div class="alert ${tone === 'warn' ? '' : tone}" role="${tone === 'danger' ? 'alert' : 'status'}">
    <span class="dot" aria-hidden="true">${ALERT_MARK[tone] || 'i'}</span>
    <span class="body">${label ? `<b>${esc(label)}:</b> ` : ''}${esc(text)}</span>
    ${actionHtml ? `<span class="act">${actionHtml}</span>` : ''}
  </div>`;
}

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
  return `<div class="state error" role="alert"><span class="ic" aria-hidden="true">!</span><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${retryId ? `<button type="button" class="btn ghost" id="${esc(retryId)}">ลองอีกครั้ง</button>` : ''}</div>`;
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
   openModal({ title, lead, body (HTML), okText, okClass: ''|'dark'|'danger', cancelText, validate(el) })
   → Promise: true เมื่อกดยืนยัน (validate คืน false = ยังไม่ปิด), false เมื่อยกเลิก / กด Esc / คลิกพื้นหลัง */
function openModal(opt) {
  return new Promise((resolve) => {
    const last = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'modal-back';
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mTitle">
      <h3 id="mTitle">${esc(opt.title)}</h3>
      ${opt.lead ? `<p class="lead">${esc(opt.lead)}</p>` : ''}
      ${opt.body ? `<div class="body">${opt.body}</div>` : ''}
      <div class="foot">
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
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.dataset.m === 'no') close(false);
      if (e.target.dataset.m === 'ok' && (!opt.validate || opt.validate(wrap) !== false)) close(true);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';
    (wrap.querySelector('.body :is(input, textarea, select)') || wrap.querySelector('[data-m="ok"]')).focus();
  });
}
