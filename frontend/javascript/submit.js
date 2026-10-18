// submit.js — สร้างคำขอ ขั้นที่ 2 ตรวจตัวอย่าง PDF + เลือกช่องทางยื่น (Figma I5 · T4 · I7 ยืนยัน · ST6 PDF error)
//             และขั้นที่ 3 ยื่นสำเร็จ (I6 ปริ้นเซ็นเอง · I8 เซ็นกับเจ้าหน้าที่ · T5)
// เปิดได้ 2 แบบ:
//   submit.html?preview=1   = จากปุ่ม "ดูตัวอย่าง PDF" ในขั้นที่ 1 — ข้อมูลยังไม่ถูกบันทึก (อ่านจาก sessionStorage: loadDraftPreview)
//                             ตัวอย่างวาดจากข้อมูลในฟอร์ม ดูซ้ำได้เรื่อยๆ ; บันทึกลง DB ตอนกดยืนยันยื่นเท่านั้น
//   submit.html?id=<claimId> = ร่างที่บันทึกแล้ว (เช่น จากหน้ารายละเอียด) ; หลังยื่นแล้ว = &done=1
// Input : GET /claims/{id}, GET /claims/{id}/pdf?type=claim|blank (ถ้าไม่ได้ เช่น 409 ร่างยังดาวน์โหลดไม่ได้ → ใช้ตัวอย่างที่วาดเอง),
//         GET /claims (เพดานรวมของ TA), GET /rates
// Output: ยืนยันยื่น → (ยังไม่มีคำขอ) POST /claims/autofill หรือ POST /claims → PUT /claims/{id} { items } → POST /claims/{id}/submit { printMethod }
//         เปลี่ยนใจจากปริ้นเองเป็นเซ็นที่เคาน์เตอร์: PUT /claims/{id}/print-method

let user, claim, claims = [], rates = [], pdf = null;
let draft = null;   // ข้อมูลจากขั้นที่ 1 ที่ยังไม่บันทึก (โหมด preview)
let method = 'sign_with_staff';
const student = () => user.role === 'student_helper';
const docType = () => (student() ? 'blank' : 'claim');
const formName = () => (student() ? 'แบบฟอร์มเปล่า — นักศึกษาช่วยงาน' : `ใบลงลายมือชื่อ — ${user.role === 'ta' ? 'TA' : 'อาจารย์'}`);
const docHtml = () => (student() ? blankDocHtml() : claimDocHtml(claim, user));
const fileName = () => docFileName(claim, user);
const countTxt = () => `${num(claim.totalHours)} ชม. (${claim.items.length} ${student() ? 'วัน' : 'คาบ'})`;

// สรุปคำขอ (ขวา) — ใช้ทั้งขั้นที่ 2 และ 3
function summaryHtml(withMethod) {
  const rows = [
    ['แบบฟอร์ม', formName()],
    [student() ? 'งาน' : 'วิชา', `${courseSec(claim)}${tabInfo()}`],
    ...(user.role === 'ta' ? [['ผู้เซ็นรับรอง', claim.instructorName || '-']] : []),
    ['งานเดือน', `${thMonth(claim.month)} · รอบที่ ${cycleOf(claim)}`],
    ['ชั่วโมง', countTxt()],
    ['ยอดเบิก', baht(claim.totalAmount)],
    ...(user.role === 'ta' || student() ? [['เพดานรวม', capTxt()]] : []),
    ...(withMethod && claim.printMethod ? [['ช่องทาง', PRINT_METHOD[claim.printMethod].th]] : [])
  ];
  return `<h3>สรุป${withMethod ? 'คำขอ' : ''}</h3><div class="rule section-gap"></div>
    <dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
}
// TA หลายวิชา: (ใบที่ 1 จาก 2)
function tabInfo() {
  const same = claims.filter((c) => c.month === claim.month && c.status !== 'rejected').sort((a, b) => String(a.offeringId).localeCompare(String(b.offeringId)));
  const i = same.findIndex((c) => c.claimId === claim.claimId);
  return user.role === 'ta' && same.length > 1 ? ` (ใบที่ ${i + 1} จาก ${same.length})` : '';
}
function capTxt() {
  const max = capOf(rates, user.role, user.load);
  const done = claimedHours(claims, { term: claim.term, role: user.role, except: claim.claimId });
  return `${num(done + claim.totalHours)} / ${num(max)} ชม. (ทุกวิชา)`;
}

/* ---------- ขั้นที่ 2 ---------- */

function choiceHtml(pm, icon, title, desc, rec) {
  return `<button type="button" class="choice${method === pm ? ' on' : ''}" data-pm="${pm}" aria-pressed="${method === pm}">
    <span class="ic" aria-hidden="true">${icon}</span>
    <span><b>${esc(title)}</b><small>${esc(desc)}</small>${rec ? '<span class="tag rec">แนะนำ</span>' : ''}</span></button>`;
}

function renderPreview() {
  $('title').textContent = 'ตัวอย่างเอกสาร PDF';
  $('lead').textContent = student() ? 'แบบฟอร์มของนักศึกษาช่วยงานเป็นแบบฟอร์มเปล่า กรอกด้วยลายมือ' : 'ตรวจข้อมูลบนแบบฟอร์มจริงก่อนเลือกช่องทางยื่น';
  $('tools').innerHTML = `<a class="btn ghost" href="${esc(backToForm())}">← กลับไปแก้ไข</a>`;
  $('steps').innerHTML = steps3Html(2);
  $('body').innerHTML = `<div class="preview-layout">
      <div id="doc"><div class="pdf-frame"><div class="paper loading">${skeleton(['w60', '', 'w80', 'lg', 'lg', 'lg'])}</div></div></div>
      <aside class="form-side">
        <section class="card" id="sum">${summaryHtml(false)}</section>
        <section class="card" id="channel">
          <h3>เลือกช่องทางยื่น</h3>
          <p class="muted section-gap">ทั้งสองแบบเจ้าหน้าที่ตรวจในระบบก่อน · เซ็นด้วยปากกาน้ำเงินบนเอกสารจริง</p>
          <div class="choices">
            ${choiceHtml('sign_with_staff', '✍️', 'ยื่นในระบบ แล้วไปเซ็นกับเจ้าหน้าที่', 'ตรวจผ่าน → เจ้าหน้าที่พิมพ์ไว้ให้ → ไปเซ็นที่เคาน์เตอร์ · ติดตามสถานะได้', true)}
            ${choiceHtml('self_print', '⬇️', 'ส่งตรวจ แล้วปริ้นเซ็นเอง', 'ตรวจผ่าน → ดาวน์โหลดไปปริ้น เซ็น แล้วนำส่งเจ้าหน้าที่เอง · ติดตามสถานะได้')}
          </div>
          <div class="side-btns">
            <button type="button" class="btn${method === 'sign_with_staff' ? '' : ' ghost'}" data-go="sign_with_staff" disabled>ยื่นคำขอในระบบ</button>
            <button type="button" class="btn${method === 'self_print' ? '' : ' ghost'}" data-go="self_print" disabled>ส่งตรวจ แล้วปริ้นเซ็นเอง</button>
          </div>
          <p class="muted" id="pdfHint">ปุ่มจะใช้งานได้เมื่อสร้าง PDF สำเร็จ</p>
        </section>
      </aside>
    </div>`;
  document.querySelectorAll('[data-pm]').forEach((b) => b.addEventListener('click', () => pick(b.dataset.pm)));
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { pick(b.dataset.go); confirmSubmit(); }));
  loadPdf();
}

function pick(pm) {
  method = pm;
  document.querySelectorAll('[data-pm]').forEach((b) => { const on = b.dataset.pm === pm; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  document.querySelectorAll('[data-go]').forEach((b) => b.classList.toggle('ghost', b.dataset.go !== pm));
}

// ตัวอย่างวาดจากข้อมูลคำขอที่หน้าเว็บ ; ถ้าเป็นร่างที่บันทึกแล้วลองขอ PDF จริงก่อน (Lambda อาจตอบ 409 เพราะยังไม่ตรวจผ่าน → ใช้ตัวอย่างที่วาดเอง)
async function loadPdf() {
  $('doc').innerHTML = `<div class="pdf-frame"><div class="paper loading">${skeleton(['w60', '', 'w80', 'lg', 'lg', 'lg'])}<p class="loading-text">กำลังสร้างตัวอย่าง PDF…</p></div></div>`;
  pdf = null;
  if (claim.claimId && !draft) {
    try { pdf = await api.getPdf(claim.claimId, docType()); } catch (err) { console.warn('ใช้ตัวอย่างที่วาดเองแทน PDF จาก Lambda', err); }
  }
  $('doc').innerHTML = pdfFrameHtml(fileName(), docHtml(), pdf?.downloadUrl);
  document.querySelectorAll('[data-go]').forEach((b) => { b.disabled = false; });
  $('pdfHint').hidden = true;
}

const backToForm = () => (claim.claimId ? `form.html?id=${encodeURIComponent(claim.claimId)}`
  : `form.html?month=${encodeURIComponent(claim.month)}${claim.offeringId != null ? `&offeringId=${encodeURIComponent(claim.offeringId)}` : ''}`);

// โหมด preview: สร้างข้อมูลคำขอจากฟอร์ม (ยังไม่มีใน DB) — ยอดรวมคำนวณแบบเดียวกับขั้นที่ 1
function claimFromDraft(d) {
  const items = d.rows.filter((r) => r.checked).map(({ key, checked, ...x }) => x);
  const r = rateOf(rates, user.role);
  const totalHours = sumHours(items);
  const totalAmount = student()
    ? items.reduce((s, x) => s + Math.min(x.hours * (r.ratePerHour || 0), r.maxAmountPerDay || Infinity), 0)
    : Math.round(totalHours * (r.ratePerHour || 0) * 100) / 100;
  const t = termOfDate(parseMonth(d.month)), per = periodFromDate();
  return {
    ...d.course, claimId: d.claimId || null, status: 'draft', printMethod: null, role: user.role,
    offeringId: d.offeringId, month: d.month, ...t, term: `${t.semester}-${be(t.academicYear)}`,
    cycle: per.cycle, deadline: per.deadline, items, totalHours, totalAmount, ratePerHour: r.ratePerHour
  };
}

// บันทึกคำขอลง DB ครั้งเดียวตอนยืนยันยื่น แล้วคืน claimId
async function persistDraft() {
  const body = { items: claim.items.map((x) => ({ ...(x.workId ? { workId: x.workId } : {}), workDate: x.workDate, startTime: x.startTime, endTime: x.endTime, hours: x.hours, Remark: (x.Remark || '').trim(), kind: x.kind })) };
  if (claim.claimId) { await api.updateClaim(claim.claimId, body); return claim.claimId; }
  const direct = draft.manual || !draft.hasSource;
  const created = direct
    ? await api.createClaim({ offeringId: draft.offeringId, month: draft.month, ...body })
    : await api.autofillClaim(draft.offeringId, draft.month);
  if (!created?.claimId) throw new ApiError('VALIDATION_ERROR', `เดือน ${thMonth(draft.month)} ไม่มีคาบในปฏิทิน`, 400);
  // จำ claimId ไว้ ถ้าขั้นต่อไปล้มแล้วกดยื่นใหม่ จะได้แก้ใบเดิม ไม่สร้างซ้ำ (autofill ตอบ 409 ถ้าซ้ำ)
  claim.claimId = created.claimId;
  saveDraftPreview({ ...draft, claimId: created.claimId });
  if (!direct) await api.updateClaim(created.claimId, body);
  return created.claimId;
}

// I7 — ยืนยันการยื่น (ต้องติ๊กรับรองข้อมูล)
async function confirmSubmit() {
  const self = method === 'self_print';
  const deadline = periodTitle(claim);
  const ok = await openModal({
    eyebrow: 'ยืนยันการยื่นคำขอ',
    title: `${self ? 'ส่งตรวจ' : 'ยื่นคำขอ'} ${courseShort(claim)} เดือน ${thMonth(claim.month)}?`,
    body: `<dl class="kv"><dt>ชั่วโมง</dt><dd>${esc(countTxt())}</dd><dt>ยอดเบิก</dt><dd>${esc(baht(claim.totalAmount))}</dd><dt>รอบการเบิก</dt><dd>${esc(deadline)}</dd></dl>
      ${alertHtml('warn', self
        ? 'หลังส่งจะแก้ไขไม่ได้ จนกว่าเจ้าหน้าที่จะส่งกลับ · เมื่อตรวจผ่าน ระบบจะเปิดให้ <b>ดาวน์โหลด PDF ไปปริ้นเซ็นเอง</b> แล้วนำส่งเจ้าหน้าที่'
        : 'หลังยื่นจะแก้ไขไม่ได้ จนกว่าเจ้าหน้าที่จะส่งกลับ · เมื่อเจ้าหน้าที่ตรวจผ่าน ระบบจะแจ้งให้ไป <b>เซ็นเอกสารที่เคาน์เตอร์</b>')}
      <label class="check"><input type="checkbox" id="agree"> ข้าพเจ้ายืนยันว่าข้อมูลถูกต้องตามความเป็นจริง</label>`,
    okText: self ? 'ยืนยันส่งตรวจ' : 'ยืนยันยื่นคำขอ',
    validate: (el) => {
      if (el.querySelector('#agree').checked) return true;
      el.querySelector('.m-err').textContent = 'กรุณาติ๊กยืนยันว่าข้อมูลถูกต้อง';
      return false;
    },
    onOk: async () => {
      try {
        const id = draft ? await persistDraft() : claim.claimId;
        claim = await api.submitClaim(id, method);
        clearDraftPreview();
      } catch (err) { throw new Error(errorText(err)); }
    }
  });
  if (ok) {
    draft = null;
    history.replaceState(null, '', `submit.html?id=${encodeURIComponent(claim.claimId)}&done=1`);
    renderDone();
    window.scrollTo(0, 0);
  }
}

/* ---------- ขั้นที่ 3 ---------- */

const stepItem = (n, title, desc) => `<li><span class="n">${n}</span><div><b>${title}</b>${desc ? `<small>${desc}</small>` : ''}</div></li>`;

function nextSteps() {
  const due = claim.deadline ? thDate(claim.deadline, false) : '';
  const counter = `ห้อง ${esc(OFFICE.room)} · ${esc(OFFICE.hours)}`;
  if (claim.printMethod === 'self_print') {
    return ['รอตรวจ แล้วปริ้นเซ็นเอง', [
      stepItem(1, 'รอเจ้าหน้าที่ตรวจ <span class="muted">(ปกติภายใน 1–2 วันทำการ)</span>', 'ระบบแจ้งในหน้าภาพรวม · ถ้าต้องแก้ เจ้าหน้าที่จะส่งกลับพร้อมหมายเหตุ'),
      stepItem(2, 'เมื่อสถานะเป็น “ตรวจผ่าน · ปริ้นเซ็นเอง” <span class="muted">ดาวน์โหลด PDF ฉบับที่ตรวจแล้ว พิมพ์ A4 หน้าเดียว</span>', 'ปุ่มดาวน์โหลดจะเปิดหลังตรวจผ่าน — กันการปริ้นฉบับที่ยังไม่ถูกต้อง'),
      stepItem(3, `เซ็นด้วยปากกาน้ำเงิน <span class="muted">ทุกแถว แล้ว</span> นำส่งเจ้าหน้าที่ <span class="muted">ภายใน ${esc(due)}</span>`, `${counter} · เจ้าหน้าที่กด “รับเอกสารแล้ว” → สถานะอัปเดตให้เห็น`)
    ]];
  }
  return ['ไปเซ็นกับเจ้าหน้าที่', [
    stepItem(1, 'รอเจ้าหน้าที่ตรวจ <span class="muted">(ปกติภายใน 1–2 วันทำการ)</span>', 'ระบบแจ้งในหน้าภาพรวม'),
    stepItem(2, 'เมื่อสถานะเป็น “ตรวจผ่าน · รอเซ็นเอกสาร” <span class="muted">ไปที่เคาน์เตอร์เจ้าหน้าที่</span>', `${counter} · เจ้าหน้าที่พิมพ์เอกสารไว้ให้แล้ว`),
    stepItem(3, 'เซ็นด้วยปากกาน้ำเงิน → เจ้าหน้าที่ส่งการเงิน', '')
  ]];
}

function renderDone() {
  const self = claim.printMethod === 'self_print';
  const [headline, steps] = nextSteps();
  $('title').textContent = self ? 'ส่งตรวจเรียบร้อย' : 'ยื่นคำขอเรียบร้อย';
  $('lead').textContent = '';
  $('tools').innerHTML = '';
  $('steps').innerHTML = steps3Html(4);
  const canSwitch = self && claim.status === 'submitted';
  $('body').innerHTML = `<div class="preview-layout done">
      <section class="card">
        ${alertHtml('success', `<b>${self ? 'ส่งคำขอ' : 'ยื่นคำขอ'} #${esc(claim.claimId)} ${self ? 'ให้เจ้าหน้าที่ตรวจแล้ว' : 'แล้ว'}</b> — ${esc(thDateTime(claim.submittedAt))}${self ? ' · ช่องทาง ปริ้นเซ็นเอง' : ''} · สถานะ ${chip(claim.status, claim.printMethod)}`)}
        <div class="stepper-wrap">${stepperHtml(claim.status, claim.printMethod)}</div>
        <h2 class="next-h">ขั้นตอนถัดไป: ${esc(headline)}</h2><div class="rule"></div>
        <ol class="next-steps">${steps.join('')}</ol>
        <div class="done-btns">
          <a class="btn" href="detail.html?id=${encodeURIComponent(claim.claimId)}">ติดตามสถานะคำขอ</a>
          ${self ? '<button type="button" class="btn ghost" disabled>ดาวน์โหลด PDF (หลังตรวจผ่าน)</button>' : ''}
          <a class="btn ghost" href="home.html">กลับหน้าภาพรวม</a>
        </div>
        ${canSwitch ? `<div class="section-gap">${alertHtml('info', 'เปลี่ยนใจ? ให้เจ้าหน้าที่พิมพ์ไว้ให้ แล้ว <button type="button" class="link-btn" id="switch">เปลี่ยนเป็นไปเซ็นที่เคาน์เตอร์</button> ได้ จนกว่าจะตรวจเสร็จ (ไม่ต้องยื่นใหม่)')}</div>` : ''}
      </section>
      <aside class="form-side"><section class="card">${summaryHtml(true)}
        ${self ? '' : '<button type="button" class="btn ghost block section-gap" id="copy">ดาวน์โหลดสำเนา PDF</button>'}</section></aside>
    </div>`;
  $('switch')?.addEventListener('click', switchMethod);
  $('copy')?.addEventListener('click', download);
}

async function switchMethod() {
  const ok = await openModal({
    title: 'เปลี่ยนเป็นไปเซ็นที่เคาน์เตอร์?',
    lead: 'เจ้าหน้าที่จะพิมพ์เอกสารไว้ให้หลังตรวจผ่าน คุณไม่ต้องปริ้นเอง และไม่ต้องยื่นคำขอใหม่',
    okText: 'เปลี่ยนช่องทาง',
    onOk: async () => { try { claim = await api.setPrintMethod(claim.claimId, 'sign_with_staff'); } catch (err) { throw new Error(errorText(err)); } }
  });
  if (ok) { toast('เปลี่ยนเป็นเซ็นกับเจ้าหน้าที่แล้ว'); renderDone(); }
}

async function download() {
  try {
    const r = await api.getPdf(claim.claimId, docType());
    openDoc(r?.downloadUrl, docHtml(), fileName());
  } catch (err) { toast(errorText(err), true); }
}

async function init() {
  user = await initPage();
  if (!user) return;
  const q = new URLSearchParams(location.search);
  $('body').innerHTML = `<div class="card">${skeleton(['w40', '', 'lg', 'lg'])}</div>`;
  try {
    if (q.get('preview')) {
      draft = loadDraftPreview();
      if (!draft?.rows?.length) { location.replace('form.html'); return; }
      [claims, rates] = await Promise.all([api.getClaims().catch(() => []), api.getRates()]);
      claim = claimFromDraft(draft);
      method = 'sign_with_staff';
      renderPreview();
      return;
    }
    [claim, claims, rates] = await Promise.all([api.getClaim(q.get('id') || ''), api.getClaims(), api.getRates()]);
    if (q.get('done') && !EDITABLE.includes(claim.status)) { renderDone(); return; }
    if (!EDITABLE.includes(claim.status)) { location.replace(`detail.html?id=${encodeURIComponent(claim.claimId)}`); return; }
    if (!claim.items.length) { location.replace(`form.html?id=${encodeURIComponent(claim.claimId)}`); return; }
    method = claim.printMethod || 'sign_with_staff';
    renderPreview();
  } catch (err) {
    $('body').innerHTML = '';
    showErrorState($('body'), 'โหลดคำขอไม่สำเร็จ', err, () => location.reload());
    $('body').firstElementChild?.classList.add('card');
  }
}

document.addEventListener('DOMContentLoaded', init);
