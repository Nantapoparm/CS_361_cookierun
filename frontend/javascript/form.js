// form.js — สร้างคำขอ / แก้ไขร่าง / แนบไฟล์ / ยื่นคำขอ
// Input : รหัสวิชา (กรอกครั้งเดียว) + รายการงานหลายแถว (วันที่, ระยะเวลา ชม. + นาที, หมายเหตุ) + ไฟล์; ?id= = แก้ร่างเดิม
//         ระยะเวลากรอกเป็น ชม. (0–24) + นาที (0–59) แล้วรวมเป็นชั่วโมงทศนิยม (ปัด 2 ตำแหน่ง) ส่งเป็น hours
// Output: POST /claims (ครั้งแรก) หรือ PUT /claims/{id} แล้ว POST /claims/{id}/submit เมื่อยื่น
// 1 คำขอ = 1 วิชา: รหัสวิชาที่กรอกด้านบนถูกใส่เป็น courseCode ในทุก item ตอนส่ง
// ยอดในฟอร์มเป็นยอดประมาณจาก ratePerHour ตามบทบาท (ยอดจริงคำนวณที่ server)
// ภาค + รอบ: dropdown ให้ผู้ใช้เลือกเอง ข้อมูลมาจาก api.getTerms() (GET /terms)
//            รอบที่เลือกได้ขึ้นกับภาคที่เลือก (billingCycles ของภาคนั้น)
//
// หมายเหตุ: ฟอร์มนี้ไม่ตรวจเพดานชั่วโมง (ไว้ทำในเวอร์ชันอื่น / ให้ server ตรวจ)

const MAX_FILE = 5 * 1024 * 1024;
const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

let claimId = new URLSearchParams(location.search).get('id');
let terms = [], rates = [], items = [], attachments = []; // attachments = [{ name, key }]
let role = ''; //let role = API_CONFIG.USER.role; // บทบาทที่เลือก (เริ่มต้นตามผู้ใช้ปัจจุบัน)
let term = '', cycle = null; // ภาค (เช่น '1-2569') และรอบ (1|2) ที่ผู้ใช้เลือก
const MAX_H = 24, MAX_M = 59; // นาทีต้อง 0–59 (60 นาที = 1 ชม.) ; DB: hours ต่อรายการไม่เกิน 24
const blank = () => ({ date: '', h: '', m: '', note: '' });
const isBlank = (it) => !(it.date || it.h || it.m || it.note);
const minsOf = (it) => (Number(it.h) || 0) * 60 + (Number(it.m) || 0);
// ชม. + นาที → ชั่วโมงทศนิยมสำหรับส่ง API (เช่น 1 ชม. 30 นาที = 1.5, 20 นาที = 0.33)
const hoursOf = (it) => { const t = minsOf(it); return t > 0 ? Math.round((t / 60) * 100) / 100 : 0; };
// ชั่วโมงทศนิยมจาก API → { h, m } สำหรับใส่ช่อง (ว่างถ้าเป็น 0)
const splitHours = (hours) => { const t = Math.round(Number(hours || 0) * 60); return { h: Math.floor(t / 60) || '', m: t % 60 || '' }; };
const courseCode = () => $('course').value.trim().toUpperCase();
const round2 = (n) => Math.round(n * 100) / 100;

const myRate = () => rates.find((r) => r.role === role) || null;
const rateFor = () => myRate()?.ratePerHour || 0;

/* ---------- เลือกบทบาทจาก dropdown (ตัวเลือกจาก api.getRates) ---------- */

function renderRole() {
  
  const roles = rates.map((r) => r.role);
  if (role && !roles.includes(role)) roles.push(role); // บทบาทเดิมของร่างไม่อยู่ในรายการ → ยังเลือกได้
  $('roleSel').innerHTML = '<option value="">เลือกบทบาท</option>' +
    roles.map((r) => `<option value="${esc(r)}">${esc(ROLE_TH[r] || r)}</option>`).join('');
  $('roleSel').value = role;
}

function onRoleChange() {
  role = $('roleSel').value;
  renderRole();
  refresh(); // อัตราเปลี่ยนตามบทบาท
}

/* ---------- เลือกภาค + รอบจาก dropdown (ข้อมูลจาก api.getTerms) ---------- */

// '1-2569' → 25691 ใช้เรียงภาคจากใหม่ไปเก่า
const termKey = (id) => { const [s, y] = String(id).split('-').map(Number); return (y || 0) * 10 + (s || 0); };

// รอบการเบิกของภาคที่เลือก
const cyclesOf = () => terms.find((x) => x.id === term)?.billingCycles || [];

// สร้างตัวเลือกของ dropdown ภาค/รอบ ตามค่าที่เลือกอยู่ในปัจจุบัน
function renderTermCycle() {
  $('termSel').innerHTML = '<option value="">เลือกภาคการศึกษา</option>' +
    [...terms].sort((a, b) => termKey(b.id) - termKey(a.id))
      .map((t) => `<option value="${esc(t.id)}">${esc(t.name || termLabel(t.id))}</option>`).join('');
  $('termSel').value = term;

  const cs = cyclesOf();
  $('cycleSel').innerHTML = '<option value="">เลือกรอบการเบิก</option>' +
    cs.map((c) => `<option value="${esc(c.cycle)}">${esc(cycleLabel(c.cycle))} · ${esc(c.description || '')}</option>`).join('');
  $('cycleSel').value = cycle ? String(cycle) : '';
  $('cycleSel').disabled = !term;

}

function onTermChange() {
  term = $('termSel').value;
  if (!cyclesOf().some((c) => c.cycle === cycle)) cycle = null; // รอบเดิมไม่มีในภาคใหม่ → ล้าง
  renderTermCycle();
}

function onCycleChange() {
  cycle = Number($('cycleSel').value) || null;
  renderTermCycle();
}

function rowHtml(it, i) {
  return `<div class="item" data-i="${i}">
    <div class="field"><label>วันที่</label><input type="date" data-k="date" value="${esc(it.date)}"></div>
    <div class="field"><label>วิชา</label><div class="calc" data-course>-</div></div>
    <div class="field"><label>ระยะเวลา</label><div class="dur">
      <input type="number" data-k="h" min="0" max="${MAX_H}" step="1" inputmode="numeric" placeholder="ชม." aria-label="ชั่วโมง" value="${esc(it.h)}">
      <input type="number" data-k="m" min="0" max="${MAX_M}" step="1" inputmode="numeric" placeholder="นาที" aria-label="นาที" value="${esc(it.m)}">
    </div></div>
    <div class="field"><label>หมายเหตุ</label><input type="text" data-k="note" maxlength="200" value="${esc(it.note)}"></div>
    <div class="field"><label>ยอด</label><div class="calc" data-out>-</div></div>
    <button type="button" class="rm" data-rm="${i}">ลบ</button>
    <span class="warn" data-warn></span>
  </div>`;
}

function updateRow(i) {
  const it = items[i], h = hoursOf(it);
  const row = $('items').querySelector(`[data-i="${i}"]`);
  row.querySelector('[data-course]').textContent = courseCode() || '-';
  row.querySelector('[data-out]').textContent = h ? baht(h * rateFor()) : '-';
  const t = minsOf(it);
  row.querySelector('[data-warn]').textContent =
    (it.h !== '' || it.m !== '') && t <= 0 ? 'ระยะเวลาต้องมากกว่า 0'
    : t > MAX_H * 60 ? `ระยะเวลาต่อรายการต้องไม่เกิน ${MAX_H} ชั่วโมง` : '';
}

function updateTotals() {
  const hours = round2(items.reduce((s, it) => s + hoursOf(it), 0));
  $('totalHours').textContent = hours;
  $('totalAmount').textContent = baht(hours * rateFor());
}

function refresh() {
  items.forEach((_, i) => updateRow(i));
  updateTotals();
}

function renderItems() {
  $('items').innerHTML = items.length ? items.map(rowHtml).join('') : '<p class="hint">ยังไม่มีรายการงาน กด "เพิ่มรายการงาน"</p>';
  refresh();
}

function renderFiles() {
  $('files').innerHTML = attachments.map((f, i) =>
    `<li><span>${esc(f.name)}</span><button type="button" data-i="${i}">ลบ</button></li>`).join('');
}

// ข้ามแถวที่ว่างทั้งแถว; ใส่ courseCode เดียวกันทุก item
const collect = () => ({
  userId: API_CONFIG.USER.userId,
  role,
  term,
  billingCycle: cycle,
  items: items.filter((it) => !isBlank(it)).map((it) => {
    const x = { date: it.date, courseCode: courseCode(), hours: hoursOf(it) };
    if (it.note.trim()) x.note = it.note.trim();
    return x;
  }),
  attachments: attachments.map((f) => f.key)
});

function validate(forSubmit) {
  if (!role) return 'กรุณาเลือกบทบาท';
  if (!term) return 'กรุณาเลือกภาคการศึกษา';
  if (!cycle) return 'กรุณาเลือกรอบการเบิก';
  if (!courseCode()) return 'กรุณากรอกรหัสวิชา (คำขอ 1 ฉบับเบิกได้ 1 วิชา)';
  let n = 0;
  for (const [i, it] of items.entries()) {
    if (isBlank(it)) continue;
    n++;
    if (!it.date || !hoursOf(it)) return `รายการงานที่ ${i + 1}: กรอกวันที่และระยะเวลา (มากกว่า 0) ให้ครบ หรือลบรายการนี้`;
    if (minsOf(it) > MAX_H * 60) return `รายการงานที่ ${i + 1}: ระยะเวลาต้องไม่เกิน ${MAX_H} ชั่วโมง`;
  }
  if (forSubmit && !n) return 'กรุณาเพิ่มรายการงานอย่างน้อย 1 รายการ';
  return '';
}

function setBusy(b) { $('btnDraft').disabled = $('btnSubmit').disabled = b; }

// บันทึก: ครั้งแรก POST แล้วจำ id ไว้ ครั้งต่อไป PUT
async function save(forSubmit) {
  const bad = validate(forSubmit);
  if (bad) throw new ApiError('VALIDATION_ERROR', bad, 400);
  const data = collect();
  const c = claimId ? await api.updateClaim(claimId, data) : await api.createClaim(data);
  claimId = c.id;
  history.replaceState(null, '', `form.html?id=${encodeURIComponent(claimId)}`);
  return c;
}

async function onDraft() {
  setBusy(true); $('msg').innerHTML = '';
  try {
    await save(false);
    $('msg').innerHTML = noteBox({ tone: 'info', label: 'บันทึกแล้ว', text: 'เก็บเป็นฉบับร่างเรียบร้อย แก้ไขได้จนกว่าจะยื่น' });
  } catch (err) { showError(err, $('msg')); }
  setBusy(false);
}

async function onSubmit() {
  setBusy(true); $('msg').innerHTML = '';
  try {
    await save(true);
    await api.submitClaim(claimId);
    location.href = `detail.html?id=${encodeURIComponent(claimId)}`;
  } catch (err) { showError(err, $('msg')); setBusy(false); }
}

// อัปโหลด 2 ขั้น: ขอ URL → PUT ไฟล์ตรงเข้า S3 แล้วเก็บ fileKey
async function onFile(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  $('msg').innerHTML = '';
  try {
    if (!FILE_TYPES.includes(f.type)) throw new ApiError('VALIDATION_ERROR', 'รองรับเฉพาะไฟล์ PDF, JPG, PNG', 400);
    if (f.size > MAX_FILE) throw new ApiError('VALIDATION_ERROR', 'ไฟล์ต้องมีขนาดไม่เกิน 5 MB', 400);
    const { uploadUrl, fileKey } = await api.getPresignedUrl({ fileName: f.name, contentType: f.type });
    await uploadToS3(uploadUrl, f);
    attachments.push({ name: f.name, key: fileKey });
    renderFiles();
  } catch (err) { showError(err, $('msg')); }
}

async function initForm() {
  initPage();
  const U = API_CONFIG.USER;
  $('who').innerHTML = `ผู้ขอเบิก: <b>${esc(U.name)} ${esc(U.lastName)}</b>`;
  items = [blank()];
  try {
    await Promise.all([
      api.getTerms().then((r) => { terms = r; }),
      api.getRates().then((r) => { rates = r; })
    ]);

    if (claimId) {
      $('title').textContent = 'แก้ไขฉบับร่าง';
      const c = await api.getClaim(claimId);
      if (!EDITABLE.includes(c.status)) throw new ApiError('INVALID_STATE', '', 409);
      role = c.role;               // ค่าเดิมที่บันทึกไว้
      term = c.term;
      cycle = c.billingCycle;
      if (!terms.some((t) => t.id === term)) { // ภาคเดิมไม่อยู่ในรายการ → เพิ่มให้เลือกได้
        terms.push({ id: term, name: `ภาคการศึกษาที่ ${termLabel(term)}`, billingCycles: terms[0]?.billingCycles || [] });
      }
      $('course').value = courseOf(c);
      items = c.items.length
        ? c.items.map((x) => ({ date: x.date, ...splitHours(x.hours), note: x.note || '' }))
        : [blank()];
      attachments = (c.attachments || []).map((k) => ({ name: fileNameOf(k), key: k }));
      renderFiles();
    }
  } catch (err) {
    showError(err, $('msg'), () => location.reload());
    setBusy(true);
  }
  renderRole();
  renderTermCycle();
  renderItems();

  $('roleSel').addEventListener('change', onRoleChange);
  $('termSel').addEventListener('change', onTermChange);
  $('cycleSel').addEventListener('change', onCycleChange);

  $('items').addEventListener('input', (e) => {
    const row = e.target.closest('[data-i]'), k = e.target.dataset.k;
    if (!row || !k) return;
    let v = e.target.value;
    if ((k === 'h' || k === 'm') && v !== '') { // บีบค่าให้อยู่ในช่วง: นาที 0–59, ชม. 0–24, เป็นจำนวนเต็ม
      const n = Math.min(k === 'm' ? MAX_M : MAX_H, Math.max(0, Math.floor(Number(v)) || 0));
      if (String(n) !== v) { v = String(n); e.target.value = v; }
    }
    items[Number(row.dataset.i)][k] = v;
    refresh();
  });
  $('items').addEventListener('click', (e) => {
    if (e.target.dataset.rm !== undefined) { items.splice(Number(e.target.dataset.rm), 1); renderItems(); }
  });
  $('course').addEventListener('input', refresh); // อัปเดตรหัสวิชาในแต่ละแถว
  $('addItem').addEventListener('click', () => { items.push(blank()); renderItems(); });
  $('file').addEventListener('change', onFile);
  $('files').addEventListener('click', (e) => {
    if (e.target.dataset.i) { attachments.splice(Number(e.target.dataset.i), 1); renderFiles(); }
  });
  $('btnDraft').addEventListener('click', onDraft);
  $('btnSubmit').addEventListener('click', onSubmit);
}

document.addEventListener('DOMContentLoaded', initForm);