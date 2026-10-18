// dashboard.js — ประวัติคำขอ (Figma I10 · ST4 ไม่มีข้อมูล · ST5 โหลดไม่สำเร็จ)
// Input : GET /claims (ผู้ใช้มาจาก token) + GET /terms + GET /current-period (ภาคเริ่มต้น)
// Output: ตารางคำขอ (งานเดือนใหม่ → เก่า) กรองภาค / รอบ / วิชา / สถานะ / เลขที่ ฝั่งหน้าเว็บ
//         แท็บนับตามสถานะ แถวรวมชั่วโมงและยอดเบิกของทุกหน้าตามตัวกรอง

let all = [];
let page = 1;
let group = '';           // แท็บสถานะที่เลือก ('' = ทั้งหมด)
const PAGE_SIZE = 10;

// กลุ่มสถานะของแท็บ (approved แยกตามช่องทาง) — opt = แสดงเฉพาะเมื่อมีคำขอ
const GROUPS = [
  { key: 'draft', th: 'ร่าง', test: (c) => c.status === 'draft' },
  { key: 'submitted', th: 'รอตรวจ', test: (c) => c.status === 'submitted' },
  { key: 'returned', th: 'ส่งกลับแก้ไข', test: (c) => c.status === 'returned' },
  { key: 'sign', th: 'รอเซ็น', test: (c) => c.status === 'approved' && c.printMethod !== 'self_print' },
  { key: 'self', th: 'ปริ้นเซ็นเอง', test: (c) => c.status === 'approved' && c.printMethod === 'self_print' },
  { key: 'documents_received', th: 'รับเอกสารแล้ว', test: (c) => c.status === 'documents_received', opt: true },
  { key: 'sent_to_finance', th: 'ส่งการเงินแล้ว', test: (c) => c.status === 'sent_to_finance' },
  { key: 'rejected', th: 'ไม่อนุมัติ', test: (c) => c.status === 'rejected', opt: true }
];
const groupOf = (k) => GROUPS.find((g) => g.key === k);

// กรองทุกอย่างยกเว้นแท็บสถานะ (แท็บนับจากผลนี้)
function baseFiltered() {
  const term = $('fTerm').value, cycle = $('fCycle').value, course = $('fCourse').value;
  const q = $('fSearch').value.trim().replace(/^#/, '');
  return all.filter((c) => (!term || c.term === term) && (!cycle || String(cycleOf(c)) === cycle) &&
    (!course || courseShort(c) === course) && (!q || c.claimId.includes(q)));
}
function filtered() {
  const st = $('fStatus').value || group;
  const g = groupOf(st);
  return baseFiltered().filter((c) => !g || g.test(c))
    .sort((a, b) => b.month.localeCompare(a.month) || b.claimId.localeCompare(a.claimId));
}

const row = (c) => `<tr>
  <td class="id">#${esc(c.claimId)}</td>
  <td data-label="วิชา">${esc(courseSec(c))}</td>
  <td data-label="งานเดือน">${esc(thMonth(c.month))}</td>
  <td data-label="รอบการเบิก">${esc(cycleShort(c))}</td>
  <td data-label="ชม." class="num">${num(c.totalHours)}</td>
  <td data-label="ยอดเบิก (บาท)" class="num">${num(c.totalAmount)}</td>
  <td data-label="สถานะ">${chip(c.status, c.printMethod)}</td>
  <td class="act">${c.status === 'returned' || c.status === 'draft'
    ? `<a class="btn ghost sm" href="form.html?id=${encodeURIComponent(c.claimId)}">แก้ไข</a> ` : ''}<a class="btn ghost sm" href="detail.html?id=${encodeURIComponent(c.claimId)}">ดูรายละเอียด</a></td>
</tr>`;

function renderCounts() {
  const base = baseFiltered();
  const btn = (key, th, n) => `<button type="button" data-g="${key}" aria-pressed="${group === key}">${esc(th)} ${n}</button>`;
  $('counts').innerHTML = btn('', 'ทั้งหมด', base.length) +
    GROUPS.map((g) => { const n = base.filter(g.test).length; return g.opt && !n ? '' : btn(g.key, g.th, n); }).join('');
}

function render() {
  const list = filtered();
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  page = Math.min(Math.max(1, page), pages);
  const start = (page - 1) * PAGE_SIZE, slice = list.slice(start, start + PAGE_SIZE);
  const term = $('fTerm').selectedOptions[0];
  $('lead').textContent = `${$('fTerm').value ? term.textContent : 'ทุกภาคการศึกษา'} · ${list.length} รายการ`;
  const anyFilter = ['fTerm', 'fCycle', 'fCourse', 'fStatus', 'fSearch'].some((id) => $(id).value && !(id === 'fTerm' && $(id).value === defaultTerm)) || group;
  $('fClear').hidden = !anyFilter;
  ['fCycle', 'fCourse', 'fStatus'].forEach((id) => $(id).classList.toggle('on', !!$(id).value));
  renderCounts();

  if (!list.length) {
    // ST4 — ไม่พบคำขอ
    $('tableCard').innerHTML = `<div class="state"><span class="ic" aria-hidden="true">🔍</span>
      <h3>${all.length ? 'ไม่พบคำขอตามตัวกรอง' : 'ยังไม่มีคำขอ'}</h3>
      <p>${all.length ? 'ลองเปลี่ยนรอบการเบิกหรือสถานะ · ถ้ายังไม่เคยสร้างคำขอ เริ่มจากปฏิทินได้เลย' : 'เริ่มจากบันทึกคาบในปฏิทิน แล้วสร้างคำขอได้ในคลิกเดียว'}</p>
      <div class="state-btns">${anyFilter ? '<button type="button" class="btn ghost" id="clear2">ล้างตัวกรอง</button>' : ''}<a class="btn" href="form.html">สร้างคำขอใหม่</a></div></div>`;
    $('clear2')?.addEventListener('click', clearFilters);
    $('pageInfo').textContent = '';
    $('pager').innerHTML = '';
    return;
  }
  if (!$('rows')) restoreTable();
  $('rows').innerHTML = slice.map(row).join('');
  const h = list.reduce((s, c) => s + Number(c.totalHours || 0), 0), a = list.reduce((s, c) => s + Number(c.totalAmount || 0), 0);
  $('foot').innerHTML = `<tr class="sum"><td colspan="4">รวม ${list.length} รายการ</td><td data-label="ชม." class="num">${num(h)}</td><td data-label="ยอดเบิก (บาท)" class="num">${num(a)}</td><td colspan="2"></td></tr>`;
  $('pageInfo').textContent = `แสดง ${start + 1}–${start + slice.length} จาก ${list.length} รายการ`;
  $('pager').innerHTML = pages <= 1 ? `<span class="pg on" aria-current="page">1</span>` :
    `<button type="button" class="pg" data-p="${page - 1}"${page === 1 ? ' disabled' : ''} aria-label="หน้าก่อน">‹</button>` +
    Array.from({ length: pages }, (_, i) => i + 1).map((n) => (n === page ? `<span class="pg on" aria-current="page">${n}</span>` : `<button type="button" class="pg" data-p="${n}">${n}</button>`)).join('') +
    `<button type="button" class="pg" data-p="${page + 1}"${page === pages ? ' disabled' : ''} aria-label="หน้าถัดไป">›</button>`;
}

let tableHtml = '';
const restoreTable = () => { $('tableCard').innerHTML = tableHtml; };

let defaultTerm = '';
function clearFilters() {
  $('fTerm').value = defaultTerm;
  ['fCycle', 'fCourse', 'fStatus', 'fSearch'].forEach((id) => { $(id).value = ''; });
  group = '';
  page = 1;
  render();
}

async function load() {
  $('msg').innerHTML = '';
  if (!$('rows')) restoreTable();
  $('rows').innerHTML = `<tr class="empty-row"><td colspan="8">${skeleton(['', '', '', ''])}<p class="loading-text">กำลังโหลดข้อมูล…</p></td></tr>`;
  $('foot').innerHTML = '';
  try {
    const [claims, terms, period] = await Promise.all([api.getClaims(), api.getTerms().catch(() => []), api.getCurrentPeriod().catch(() => null)]);
    all = claims;
    // ภาคจาก /terms + ภาคที่มีคำขอ
    const ids = new Set([...terms.map((t) => t.id), ...all.map((c) => c.term)]);
    const key = (id) => { const [s, y] = id.split('-').map(Number); return y * 10 + s; };
    $('fTerm').innerHTML = '<option value="">ทุกภาคการศึกษา</option>' + [...ids].sort((a, b) => key(b) - key(a)).map((id) => `<option value="${esc(id)}">ภาค ${esc(termLabel(id))}</option>`).join('');
    defaultTerm = period ? `${period.semester}-${be(period.academicYear)}` : '';
    if (ids.has(defaultTerm)) $('fTerm').value = defaultTerm;
    $('fCourse').innerHTML = '<option value="">ทุกวิชา</option>' + [...new Set(all.map(courseShort))].sort().map((c) => `<option>${esc(c)}</option>`).join('');
    render();
  } catch (err) {
    // ST5 — โหลดไม่สำเร็จ (ซ่อนตัวกรอง)
    $('filters').hidden = true;
    $('counts').innerHTML = '';
    showErrorState($('tableCard'), 'โหลดรายการคำขอไม่สำเร็จ', err, () => { $('filters').hidden = false; load(); });
  }
}

async function initHistory() {
  const user = await initPage();
  if (!user) return;
  tableHtml = $('tableCard').innerHTML;
  $('fStatus').insertAdjacentHTML('beforeend', GROUPS.map((g) => `<option value="${g.key}">${esc(g.th)}</option>`).join(''));
  ['fTerm', 'fCycle', 'fCourse', 'fStatus'].forEach((id) => $(id).addEventListener('change', () => { page = 1; if (id === 'fStatus') group = ''; render(); }));
  $('fSearch').addEventListener('input', () => { page = 1; render(); });
  $('fClear').addEventListener('click', clearFilters);
  $('counts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-g]');
    if (!b) return;
    group = b.dataset.g;
    $('fStatus').value = '';
    page = 1;
    render();
  });
  $('pager').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-p]');
    if (!b || b.disabled) return;
    page = Number(b.dataset.p);
    render();
  });
  load();
}

document.addEventListener('DOMContentLoaded', initHistory);
