// form.js — สร้างคำขอ ขั้นที่ 1 ข้อมูลคำขอ (Figma I4 อาจารย์ · T3 TA 1 ใบต่อวิชา · I13 แก้ไขคำขอที่ถูกส่งกลับ · ST3 ไม่มีข้อมูลในปฏิทิน)
// เปิดได้ 2 แบบ: form.html?month=YYYY-MM[&offeringId=] = คำขอใหม่จากปฏิทิน ; form.html?id=<claimId> = แก้ร่าง / คำขอที่ถูกส่งกลับ
// Input : GET /current-period, /rates, /claims, คาบของเดือน (GET /schedule หรือ /work-days) และ GET /claims/{id}
// Output: บันทึกร่าง → POST /claims/autofill (ครั้งแรก) แล้ว PUT /claims/{id} { items } ด้วยคาบที่ติ๊ก
//         ไม่มีคาบในปฏิทิน + "กรอกเอง" → POST /claims { offeringId, month, items }
//         ดูตัวอย่าง PDF → submit.html?id= (ขั้นที่ 2) ; คำขอที่ถูกส่งกลับ → ยื่นอีกครั้ง POST /claims/{id}/submit
// ภาคการศึกษา รอบการเบิก และวันที่ยื่น server กำหนดเอง (V3-06) หน้าเว็บแสดงอย่างเดียว

let user, period, rates = [], claims = [];
let month, monthData;
let tabs = [];          // [{ course, listed (คำขอเดิมของวิชา+เดือนนี้), source (คาบจากปฏิทิน) }]
let cur = 0;
let claim = null;       // คำขอที่กำลังแก้ (null = ยังไม่บันทึก)
let rows = [];          // [{ key, workId?, workDate, startTime, endTime, hours, Remark, kind, checked }]
let manual = false;     // กรอกเอง (ไม่มีคาบในปฏิทิน)
let saveTimer = null;
const student = () => user.role === 'student_helper';
const sameCourse = sameOffering;
const keyOf = (x) => `${x.workDate}|${hhmm(x.startTime)}`;
const editable = () => !claim || EDITABLE.includes(claim.status);
const returned = () => claim?.status === 'returned';
const checkedRows = () => rows.filter((r) => r.checked);

/* ---------- โหลดข้อมูล ---------- */

// คาบของวิชาในเดือนจากปฏิทิน (ไม่รวมงดสอน)
function sourceOf(c) {
  if (student()) {
    return monthData.items.filter((w) => sameCourse(w, c)).map((w) => ({ workDate: w.workDate, startTime: w.startTime, endTime: w.endTime, hours: w.hours, Remark: w.Remark || '', kind: 'regular' }));
  }
  return monthData.periods.filter((p) => sameCourse(p, c) && p.kind !== 'cancelled').map((p) => ({
    workDate: p.date, startTime: p.startTime, endTime: p.endTime, hours: hoursBetween(p.startTime, p.endTime),
    Remark: p.kind === 'makeup' ? `สอนชดเชย (${p.room || thDate(p.date)})`.slice(0, 50) : '', kind: p.kind
  }));
}

async function loadMonth() {
  monthData = student() ? await api.getWorkDays(month) : await api.getSchedule(month);
  tabs = monthData.courses.map((c) => ({
    course: c,
    listed: claims.find((x) => x.month === month && sameCourse(x, c) && x.status !== 'rejected') || null,
    source: sourceOf(c)
  }));
}

async function init() {
  user = await initPage();
  if (!user) return;
  const q = new URLSearchParams(location.search);
  $('body').innerHTML = `<div class="card">${skeleton(['w40', '', 'lg', '', 'lg', 'lg'])}<p class="loading-text">กำลังดึงข้อมูลจากปฏิทิน…</p></div>`;
  $('steps').innerHTML = steps3Html(1);
  try {
    [period, rates, claims] = await Promise.all([api.getCurrentPeriod(), api.getRates(), api.getClaims()]);
    if (q.get('id')) {
      claim = await api.getClaim(q.get('id'));
      if (!EDITABLE.includes(claim.status)) { location.replace(`detail.html?id=${encodeURIComponent(claim.claimId)}`); return; }
      month = claim.month;
    } else {
      month = /^\d{4}-\d{2}$/.test(q.get('month') || '') ? q.get('month') : period.claimMonth;
    }
    await loadMonth();
    if (claim) {
      cur = Math.max(0, tabs.findIndex((t) => sameCourse(t.course, claim)));
      if (!tabs.length) tabs = [{ course: claim, listed: claim, source: [] }];
      tabs[cur].listed = claim;
      openClaim(claim);
    } else {
      // เลือกวิชาจาก ?offeringId= หรือวิชาแรกที่ยังไม่ได้ยื่น
      const want = q.get('offeringId');
      cur = tabs.findIndex((t) => (want ? String(t.course.offeringId) === want : !t.listed || EDITABLE.includes(t.listed.status)));
      await selectTab(Math.max(0, cur));
    }
  } catch (err) {
    $('body').innerHTML = '';
    showErrorState($('body'), 'โหลดข้อมูลคำขอไม่สำเร็จ', err, () => location.reload());
    $('body').firstElementChild?.classList.add('card');
  }
}

// เปิดคำขอเดิม: คาบที่อยู่ในคำขอ = ติ๊ก, คาบอื่นในปฏิทินของเดือนนี้ = ไม่ติ๊ก (เพิ่มกลับได้)
function openClaim(c) {
  claim = c;
  manual = false;
  const have = new Set(c.items.map(keyOf));
  rows = [
    ...c.items.map((x) => ({ ...x, key: keyOf(x), checked: true })),
    ...(tabs[cur]?.source || []).filter((x) => !have.has(keyOf(x))).map((x) => ({ ...x, key: keyOf(x), checked: false }))
  ].sort((a, b) => a.key.localeCompare(b.key));
  render();
}

async function selectTab(i) {
  cur = i;
  const t = tabs[i];
  claim = null;
  manual = false;
  if (!t) { renderEmpty(); return; }
  if (t.listed) {
    if (!EDITABLE.includes(t.listed.status)) { renderLocked(t.listed); return; }
    $('body').innerHTML = `<div class="card">${skeleton(['w40', '', 'lg', 'lg'])}</div>`;
    try { openClaim(await api.getClaim(t.listed.claimId)); } catch (err) { showError(err, $('msg'), () => selectTab(i)); }
    return;
  }
  rows = t.source.map((x) => ({ ...x, key: keyOf(x), checked: true }));
  if (!rows.length) { renderEmpty(); return; }
  render();
}

/* ---------- วาดหน้า ---------- */

const field = (label, value, cls = 'auto', hint = '', tag = true) => `<div class="field ${cls}">
    <label>${esc(label)}${cls === 'auto' && tag ? ' <span class="tag auto">AUTO</span>' : ''}</label>
    <div class="static">${esc(value || '-')}</div>${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</div>`;

function monthOptions() {
  const set = new Set([period.claimMonth, addMonths(period.claimMonth, -1), addMonths(period.claimMonth, -2), month]);
  return [...set].sort().reverse().map((m) => `<option value="${m}"${m === month ? ' selected' : ''}>${esc(thMonthLong(m))}</option>`).join('');
}

function headHtml() {
  const c = tabs[cur]?.course || claim || {};
  const deadline = claim?.deadline ? claim : period;
  const termTxt = `ภาค ${claim?.semester || period.semester} / ${be(claim?.academicYear || period.academicYear)}`;
  const tabsHtml = tabs.length > 1 ? `<div class="field full"><label>1 ใบต่อวิชา <span class="muted">(${student() ? 'แยกตามงาน' : 'อาจารย์แต่ละวิชาเซ็นของตัวเอง'})</span></label>
      <div class="claim-tabs" role="tablist">${tabs.map((t, i) => {
        const h = sumHours(i === cur ? checkedRows() : (t.listed?.items || t.source));
        const who = user.role === 'ta' && t.course.instructorName ? ` · ${t.course.instructorName.replace(/\s.*$/, '')}` : '';
        return `<button type="button" role="tab" data-tab="${i}" aria-selected="${i === cur}"${claim && i !== cur ? ' disabled' : ''}>ใบที่ ${i + 1} · ${esc(courseShort(t.course))}${esc(who)} · ${num(h)} ชม.${t.listed && !EDITABLE.includes(t.listed.status) ? ' · ยื่นแล้ว' : ''}</button>`;
      }).join('')}</div></div>` : '';
  const fields = student()
    ? [field('งาน', c.courseName), field('ผู้ดูแล', c.instructorName, 'auto'), field('Load', LOAD_TH[user.load] || LOAD_TH.full, 'sys')]
    : user.role === 'ta'
      ? [field('วิชา (Lab)', `${c.courseId || ''}${c.section ? ` · sec ${c.section}` : ''}`), field('อาจารย์ผู้สอน', c.instructorName, 'auto', 'พิมพ์ในช่องลงนามท้ายเอกสาร'), field('Load', `${LOAD_TH[user.load] || LOAD_TH.full} (${num(capOf(rates, 'ta', user.load))} ชม.)`, 'sys')]
      : [field('วิชา', courseFull(c)), field('Section', c.section), field('ประเภท / ห้อง', [TYPE_TH[c.type] || '', c.room].filter(Boolean).join(' · '))];
  return `<div class="form-3">
      ${field('ภาคการศึกษา', termTxt, 'sys', 'ระบบกำหนดจากวันที่สอน')}
      ${field('รอบการเบิก', periodTitle(deadline).replace(/ \d{4}$/, ''), 'sys', `งานเดือน ${thMonth(month)}`)}
      <div class="field auto"><label for="fMonth">งานเดือน <span class="tag auto">AUTO</span></label>
        <select id="fMonth"${claim ? ' disabled' : ''}>${monthOptions()}</select></div>
      ${tabsHtml}
      ${fields.join('')}
    </div>`;
}

function rowHtml(r, i) {
  const flagged = claim?.flaggedWorkIds?.includes(r.workId);
  return `<tr class="${flagged ? 'flag' : ''}${r.checked ? '' : ' off'}">
    <td class="ck"><input type="checkbox" data-ck="${i}" aria-label="เลือกคาบ ${esc(thDate(r.workDate))}"${r.checked ? ' checked' : ''}${editable() ? '' : ' disabled'}></td>
    <td data-label="วัน/เดือน/ปี">${esc(thDate(r.workDate))}</td>
    <td data-label="เวลา">${esc(timeRange(r.startTime, r.endTime))}</td>
    <td data-label="ที่มา"><span class="tag ${r.kind === 'makeup' ? 'mk' : r.kind === 'manual' ? 'man' : ''}">${esc(KIND_TH[r.kind] || 'ตาราง')}</span></td>
    <td data-label="ชม." class="num">${num(r.hours)}</td>
    <td data-label="หมายเหตุ (พิมพ์ลง PDF)" class="rm"><input data-rm="${i}" maxlength="50" value="${esc(r.Remark || '')}" placeholder="—" aria-label="หมายเหตุ ${esc(thDate(r.workDate))}"${editable() ? '' : ' disabled'}></td>
    <td class="more"><button type="button" class="dots" data-more="${i}" aria-label="แก้ไขแถว ${esc(thDate(r.workDate))}">⋯</button></td>
  </tr>`;
}

function sideHtml() {
  const list = checkedRows();
  const r = rateOf(rates, user.role);
  const h = sumHours(list);
  const amount = student()
    ? list.reduce((s, x) => s + Math.min(x.hours * (r.ratePerHour || 0), r.maxAmountPerDay || Infinity), 0)
    : h * (r.ratePerHour || 0);
  const c = tabs[cur]?.course || claim || {};
  const term = claim?.term || `${period.semester}-${be(period.academicYear)}`;
  const max = capOf(rates, user.role, user.load);
  const done = claimedHours(claims, { term, role: user.role, offeringId: c.offeringId, except: claim?.claimId });
  const left = max - done - h;
  const ctx = perCourseCap(user.role) ? `${courseShort(c)} · ภาค ${termLabel(term)}` : `${LOAD_TH[user.load] || LOAD_TH.full} · รวมทุกวิชา · ภาค ${termLabel(term)}`;
  const block = !perCourseCap(user.role) && left < 0;
  const buttons = returned()
    ? `<a class="btn ghost block" href="detail.html?id=${encodeURIComponent(claim.claimId)}">ยกเลิก</a>
       <button type="button" class="btn ghost block" id="btnPreview"${block ? ' disabled' : ''}>ดูตัวอย่าง PDF</button>
       <button type="button" class="btn block" id="btnResubmit"${block ? ' disabled' : ''}>ยื่นคำขออีกครั้ง</button>`
    : `<button type="button" class="btn ghost block" id="btnSave">บันทึกร่าง</button>
       <button type="button" class="btn block" id="btnPreview"${block ? ' disabled' : ''}>ดูตัวอย่าง PDF →</button>`;
  return `<section class="card">
      <h3>สรุปคำขอ</h3><div class="rule section-gap"></div>
      <dl class="kv sum">
        <dt>จำนวน${student() ? 'วัน' : 'คาบ'}</dt><dd>${list.length}</dd>
        <dt>ชั่วโมงรวม</dt><dd>${num(h)} ชม.</dd>
        <dt>อัตรา</dt><dd>${num(r.ratePerHour)} บาท/ชม.${r.maxAmountPerDay ? ` (ไม่เกิน ${num(r.maxAmountPerDay)}/วัน)` : ''}</dd>
      </dl>
      <div class="total"><span>ยอดเบิก</span><b>${num(amount)} ฿</b></div>
    </section>
    <section class="card hours">
      <h3>เทียบเพดานชั่วโมง</h3>
      <p class="ctx section-gap">${esc(ctx)}</p>
      <div class="big"><b>${num(done + h)}</b><span>/ ${num(max)} ชม.</span>
        <span class="tag remain ${left < 0 ? 'warn' : 'ok'}">${left < 0 ? `เกิน ${num(-left)} ชม.` : `เหลือ ${num(left)} ชม.`}</span></div>
      <div class="split"><div>เบิกแล้ว<b>${num(done)} ชม.</b></div><div>รอบนี้<b>${num(h)} ชม.</b></div></div>
      <p class="muted section-gap">${block ? 'เกินเพดานรวม — ยกเลิกการติ๊กบางคาบก่อนยื่น' : perCourseCap(user.role) ? 'ระบบจะเตือนเมื่อเกินเพดาน' : `${num(r.ratePerHour)} บาท/ชม. · ระบบไม่ให้ยื่นเกินเพดานรวม`}</p>
    </section>
    <div class="side-btns">${buttons}</div>`;
}

function render() {
  const c = tabs[cur]?.course || claim || {};
  const n = rows.filter((r) => r.kind !== 'manual').length;
  $('eyebrow').textContent = returned() ? `ประวัติคำขอ › #${claim.claimId}` : `สร้างคำขอเบิก${user.role === 'ta' ? ' · TA' : ''}`;
  $('title').textContent = returned() ? `แก้ไขคำขอ #${claim.claimId} · ${courseShort(c)}` : claim ? `ร่างคำขอ #${claim.claimId} · ${courseShort(c)}` : 'สร้างคำขอใหม่';
  if (!claim) $('saved').textContent = 'ยังไม่ได้บันทึกร่าง';

  const banner = returned()
    ? alertHtml('danger', `<b>หมายเหตุจากเจ้าหน้าที่:</b> “${esc(claim.returnNote || '-')}”${claim.flaggedWorkIds?.length ? `<br><small>แถวที่ต้องแก้: ${esc(rows.filter((r) => claim.flaggedWorkIds.includes(r.workId)).map((r) => thDate(r.workDate)).join(', '))}</small>` : ''}`)
    : manual
      ? alertBox('warn', 'กรอกเอง', `เดือน ${thMonth(month)} ไม่มีคาบในปฏิทิน — เพิ่มคาบที่สอนจริงด้วยปุ่ม “+ เพิ่มคาบ”`)
      : alertHtml('warn', `<b>Autofill จากปฏิทิน:</b> ดึง ${n} ${student() ? 'วันทำงาน' : 'คาบ'} ของเดือน ${esc(thMonth(month))} มาให้แล้ว ภาคการศึกษาและรอบเบิกระบบกำหนดให้อัตโนมัติ — ตรวจสอบและแก้ไขได้ก่อนดูตัวอย่าง PDF`,
        '<button type="button" class="link-btn" id="btnRefill">ดึงใหม่</button>');

  $('body').innerHTML = `${banner}
    <div class="form-layout section-gap">
      <section class="card">
        ${headHtml()}
        <div class="items-head">
          <h3>รายการ${student() ? 'วันทำงาน' : 'คาบ'} (${checkedRows().length})</h3>
          <div class="tools">
            <button type="button" class="btn ghost sm" id="btnAddRow"${editable() ? '' : ' disabled'}>+ เพิ่ม${student() ? 'วัน' : 'คาบ'}</button>
            <a class="btn ghost sm" href="calendar.html?month=${esc(month)}">แก้ไขในปฏิทิน</a>
          </div>
        </div>
        <div class="table-card inner">
          <table class="dtable items">
            <thead><tr><th class="ck"><span class="sr">เลือก</span></th><th>วัน/เดือน/ปี</th><th>เวลา</th><th>ที่มา</th><th class="num">ชม.</th><th>หมายเหตุ (พิมพ์ลง PDF)</th><th></th></tr></thead>
            <tbody>${rows.map(rowHtml).join('') || `<tr class="empty-row"><td colspan="7">ยังไม่มีรายการ — กด “+ เพิ่ม${student() ? 'วัน' : 'คาบ'}”</td></tr>`}</tbody>
          </table>
        </div>
      </section>
      <aside class="form-side" id="side">${sideHtml()}</aside>
    </div>`;
  bind();
}

// ST3 — เดือนนี้ไม่มีคาบในปฏิทิน
function renderEmpty() {
  const what = student() ? 'วันทำงาน' : 'คาบสอน';
  const hasCourse = !!tabs[cur]?.course;
  $('title').textContent = 'สร้างคำขอ';
  $('saved').textContent = '';
  $('body').innerHTML = `<div class="card"><div class="state">
      <span class="ic" aria-hidden="true">🗂️</span>
      <h3>ไม่มี${what}เดือน ${esc(thMonth(month))} ให้ดึงข้อมูล</h3>
      <p>Autofill ต้องใช้ข้อมูลจากปฏิทิน · เพิ่ม${what}ในปฏิทินก่อน หรือกรอกคำขอเองโดยไม่ใช้ autofill</p>
      <div class="state-btns">
        <a class="btn" href="calendar.html?month=${esc(month)}">ไปที่ปฏิทิน</a>
        ${hasCourse ? '<button type="button" class="btn ghost" id="btnManual">กรอกเอง</button>' : ''}
        <a class="btn ghost" href="form.html?month=${esc(addMonths(month, -1))}">เดือนก่อนหน้า</a>
      </div>
      ${tabs.length > 1 ? `<div class="claim-tabs center-tabs">${tabs.map((t, i) => `<button type="button" data-tab="${i}" aria-selected="${i === cur}">${esc(courseShort(t.course))}</button>`).join('')}</div>` : ''}
    </div></div>`;
  $('btnManual')?.addEventListener('click', () => { manual = true; rows = []; render(); editRow(null); });
  $('body').querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => selectTab(Number(b.dataset.tab))));
}

// วิชานี้ยื่นคำขอของเดือนนี้ไปแล้ว
function renderLocked(c) {
  $('title').textContent = 'สร้างคำขอใหม่';
  $('saved').textContent = '';
  $('body').innerHTML = `${tabs.length > 1 ? `<div class="card section-gap"><div class="claim-tabs">${tabs.map((t, i) => `<button type="button" data-tab="${i}" aria-selected="${i === cur}">ใบที่ ${i + 1} · ${esc(courseShort(t.course))}</button>`).join('')}</div></div>` : ''}
    <div class="section-gap">${alertHtml('info', `<b>คำขอ #${esc(c.claimId)} (${esc(courseShort(c))} เดือน ${esc(thMonth(c.month))}) ยื่นแล้ว</b> — สถานะ ${chip(c.status, c.printMethod)}`,
      `<a class="btn ghost sm" href="detail.html?id=${encodeURIComponent(c.claimId)}">ดูรายละเอียด</a>`)}</div>`;
  $('body').querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => selectTab(Number(b.dataset.tab))));
}

// อัปเดตเฉพาะตัวเลข (ไม่วาดตารางใหม่ ช่องหมายเหตุจะได้ไม่เสีย focus)
function refreshSide() {
  $('side').innerHTML = sideHtml();
  document.querySelector('.items-head h3').textContent = `รายการ${student() ? 'วันทำงาน' : 'คาบ'} (${checkedRows().length})`;
  document.querySelectorAll('[data-tab]').forEach((b) => {
    const i = Number(b.dataset.tab);
    if (i === cur) b.textContent = b.textContent.replace(/ · [\d.,]+ ชม\./, ` · ${num(sumHours(checkedRows()))} ชม.`);
  });
  bindSide();
}

/* ---------- การกระทำ ---------- */

function bind() {
  $('fMonth')?.addEventListener('change', (e) => { location.href = `form.html?month=${e.target.value}`; });
  document.querySelectorAll('#body [data-tab]').forEach((b) => b.addEventListener('click', () => { if (Number(b.dataset.tab) !== cur) selectTab(Number(b.dataset.tab)); }));
  document.querySelectorAll('[data-ck]').forEach((el) => el.addEventListener('change', () => {
    rows[el.dataset.ck].checked = el.checked;
    el.closest('tr').classList.toggle('off', !el.checked);
    refreshSide(); changed();
  }));
  document.querySelectorAll('[data-rm]').forEach((el) => el.addEventListener('input', () => { rows[el.dataset.rm].Remark = el.value; changed(); }));
  document.querySelectorAll('[data-more]').forEach((el) => el.addEventListener('click', () => editRow(Number(el.dataset.more))));
  $('btnAddRow')?.addEventListener('click', () => editRow(null));
  $('btnRefill')?.addEventListener('click', refill);
  bindSide();
}

function bindSide() {
  $('btnSave')?.addEventListener('click', async () => { if (await save()) toast(`บันทึกร่าง #${claim.claimId} แล้ว`); });
  $('btnPreview')?.addEventListener('click', async () => {
    if (!checkedRows().length) { toast('กรุณาเลือกอย่างน้อย 1 รายการ', true); return; }
    if (await save()) location.href = `submit.html?id=${encodeURIComponent(claim.claimId)}`;
  });
  $('btnResubmit')?.addEventListener('click', resubmit);
}

// บันทึกร่างอัตโนมัติ 1.5 วินาทีหลังแก้ (เฉพาะคำขอที่มีร่างแล้ว)
function changed() {
  if (!claim) return;
  $('saved').textContent = 'มีการแก้ไขที่ยังไม่บันทึก…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(true), 1500);
}

const itemsBody = () => ({ items: checkedRows().map((r) => ({ ...(r.workId ? { workId: r.workId } : {}), workDate: r.workDate, startTime: r.startTime, endTime: r.endTime, hours: r.hours, Remark: (r.Remark || '').trim(), kind: r.kind })) });

let saving = null;
async function save(silent = false) {
  clearTimeout(saveTimer);
  if (saving) await saving;
  const c = tabs[cur]?.course || claim;
  saving = (async () => {
    try {
      if (!claim) {
        // ครั้งแรก: สร้างร่างจากปฏิทิน (หรือกรอกเอง) แล้วบันทึกคาบที่ติ๊ก
        let created = manual || !tabs[cur].source.length
          ? await api.createClaim({ offeringId: c.offeringId, month, ...itemsBody() })
          : await api.autofillClaim(c.offeringId, month);
        if (!created?.claimId) throw new ApiError('VALIDATION_ERROR', `เดือน ${thMonth(month)} ไม่มีคาบในปฏิทิน`, 400);
        if (!manual) created = await api.updateClaim(created.claimId, itemsBody());
        claim = created;
        tabs[cur].listed = created;
        history.replaceState(null, '', `form.html?id=${encodeURIComponent(created.claimId)}`);
        // คาบจาก server ได้ workId แล้ว — ผูก workId กลับเข้าแถว
        const ids = new Map(created.items.map((x) => [keyOf(x), x.workId]));
        rows.forEach((r) => { if (ids.has(r.key)) r.workId = ids.get(r.key); });
        render();
      } else {
        claim = await api.updateClaim(claim.claimId, itemsBody());
        const ids = new Map(claim.items.map((x) => [keyOf(x), x.workId]));
        rows.forEach((r) => { if (ids.has(r.key)) r.workId = ids.get(r.key); });
      }
      $('saved').textContent = `บันทึกร่างอัตโนมัติ ${pad2(new Date().getHours())}:${pad2(new Date().getMinutes())} น.`;
      $('msg').innerHTML = '';
      return true;
    } catch (err) {
      $('saved').textContent = 'บันทึกไม่สำเร็จ';
      showError(err, $('msg'), silent ? null : () => save());
      if (!silent) $('msg').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    } finally { saving = null; }
  })();
  return saving;
}

// ดึงใหม่จากปฏิทิน: คาบในปฏิทินกลับมาติ๊กทั้งหมด หมายเหตุเดิมของวันเดียวกันยังอยู่ (คาบที่เพิ่มเองยังอยู่)
async function refill() {
  const ok = await openModal({ title: 'ดึงข้อมูลจากปฏิทินใหม่?', lead: `รายการจะกลับไปตรงกับปฏิทินเดือน ${thMonth(month)} — หมายเหตุที่พิมพ์ไว้ของวันเดียวกันยังอยู่`, okText: 'ดึงใหม่' });
  if (!ok) return;
  try {
    await loadMonth();
    const remark = new Map(rows.map((r) => [r.key, r.Remark]));
    const mine = rows.filter((r) => r.kind === 'manual');
    rows = [...tabs[cur].source.map((x) => ({ ...x, key: keyOf(x), checked: true, Remark: remark.get(keyOf(x)) ?? x.Remark, workId: rows.find((r) => r.key === keyOf(x))?.workId })), ...mine]
      .sort((a, b) => a.key.localeCompare(b.key));
    render();
    changed();
    toast('ดึงข้อมูลจากปฏิทินแล้ว');
  } catch (err) { showError(err, $('msg')); }
}

// แก้ / เพิ่มแถว (⋯ และ + เพิ่มคาบ) — แถวที่เพิ่มเองลบได้ ; แถวจากปฏิทินแก้เวลาได้ แต่ถ้าไม่เบิกให้เอาติ๊กออก
async function editRow(i) {
  if (!editable()) return;
  const r = i == null ? null : rows[i];
  const first = parseMonth(month), last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const c = tabs[cur]?.course || claim || {};
  const res = await openModal({
    eyebrow: r ? 'แก้ไขแถว' : `เพิ่ม${student() ? 'วันทำงาน' : 'คาบ'}ในคำขอ`,
    title: r ? thDateLong(r.workDate) : `${courseShort(c)} · ${thMonth(month)}`,
    body: `<div class="form-2">
      <div class="field"><label for="rDate">วันที่</label><input type="date" id="rDate" min="${isoDate(first)}" max="${isoDate(last)}" value="${esc(r?.workDate || isoDate(first))}"></div>
      <div class="field"><span class="lbl">เวลา</span><div class="time2"><input type="time" id="rStart" aria-label="เวลาเริ่ม" value="${esc(r?.startTime || c.startTime || '09:00')}"><span>–</span><input type="time" id="rEnd" aria-label="เวลาสิ้นสุด" value="${esc(r?.endTime || c.endTime || '12:00')}"></div></div>
      <div class="field full"><label for="rNote">หมายเหตุ (พิมพ์ลง PDF ไม่เกิน 50 ตัวอักษร)</label><input id="rNote" maxlength="50" value="${esc(r?.Remark || '')}" placeholder="เช่น ตรวจงาน, คุมสอบ"></div>
      ${r && r.kind !== 'manual' ? '<p class="muted full">แถวนี้มาจากปฏิทิน ถ้าเวลาในปฏิทินผิดควรแก้ที่ปฏิทินด้วย เพื่อให้ข้อมูลตรงกัน</p>' : ''}
    </div>`,
    okText: r ? 'บันทึกแถว' : 'เพิ่ม',
    extra: r?.kind === 'manual' ? { text: 'ลบแถวนี้' } : null,
    validate: (el) => {
      const d = el.querySelector('#rDate').value, a = el.querySelector('#rStart').value, b = el.querySelector('#rEnd').value;
      const err = !d || !d.startsWith(month) ? `วันที่ต้องอยู่ในเดือน ${thMonth(month)}` : hoursBetween(a, b) <= 0 ? 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม' : '';
      el.querySelector('.m-err').textContent = err;
      if (err) return false;
      const x = { workDate: d, startTime: a, endTime: b, hours: hoursBetween(a, b), Remark: el.querySelector('#rNote').value.trim() };
      if (r) Object.assign(r, x, { key: keyOf(x) }); else rows.push({ ...x, key: keyOf(x), kind: 'manual', checked: true });
      return true;
    }
  });
  if (res === 'extra') rows.splice(i, 1);
  if (res) { rows.sort((a, b) => a.key.localeCompare(b.key)); render(); if (claim) changed(); }
}

// I13 → ยื่นอีกครั้ง (ใช้ช่องทางเดิม) แล้วไปหน้ารายละเอียด (I14)
async function resubmit() {
  if (!checkedRows().length) { toast('กรุณาเลือกอย่างน้อย 1 รายการ', true); return; }
  const ok = await openModal({
    eyebrow: 'ยื่นคำขออีกครั้ง',
    title: `ยื่นคำขอ #${claim.claimId} อีกครั้ง?`,
    body: `<dl class="kv"><dt>ชั่วโมง</dt><dd>${num(sumHours(checkedRows()))} ชม. (${checkedRows().length} ${student() ? 'วัน' : 'คาบ'})</dd><dt>ช่องทาง</dt><dd>${esc(PRINT_METHOD[claim.printMethod]?.th || '-')}</dd></dl>
      ${alertBox('warn', '', 'เจ้าหน้าที่จะเห็นแถวที่แก้ไขไฮไลต์ไว้ให้ตรวจ หลังยื่นจะแก้ไขไม่ได้จนกว่าจะถูกส่งกลับอีกครั้ง')}`,
    okText: 'ยืนยันยื่นอีกครั้ง',
    onOk: async () => {
      if (!(await save())) throw new Error('บันทึกการแก้ไขไม่สำเร็จ');
      try { await api.submitClaim(claim.claimId, claim.printMethod || 'sign_with_staff'); } catch (err) { throw new Error(errorText(err)); }
    }
  });
  if (ok) location.href = `detail.html?id=${encodeURIComponent(claim.claimId)}&resubmitted=1`;
}

// ออกจากหน้าโดยยังไม่บันทึก → บันทึกให้ก่อน (เฉพาะคำขอที่มีร่างแล้ว)
window.addEventListener('beforeunload', () => { if (saveTimer && claim) save(true); });

document.addEventListener('DOMContentLoaded', init);
