// admin-claims.js — คำขอทั้งหมดของเจ้าหน้าที่ (Figma AD2)
// Input : GET /admin/claims (คำขอที่ยื่นแล้วของทุกคน) ; เปิดพร้อมตัวกรองได้ เช่น admin-claims.html?status=submitted&role=ta
// Output: ตารางคำขอ กรองบทบาท / สถานะ / รอบการเบิก / วิชา / ค้นหาชื่อหรือเลขที่ ฝั่งหน้าเว็บ, แท็บนับตามสถานะ, ส่งออก CSV
// ไม่ทำใน V3 (ซ่อนตาม issue): ปุ่ม "สร้างคำขอแทนผู้ใช้"

let all = [];
let page = 1;
let group = '';
const PAGE_SIZE = 10;
const groupOf = (k) => ADMIN_GROUPS.find((g) => g.key === k);

function baseFiltered() {
  const role = $('fRole').value, round = $('fRound').value, course = $('fCourse').value;
  const q = $('fSearch').value.trim().replace(/^#/, '').toLowerCase();
  return all.filter((c) => (!role || c.role === role) && (!round || roundKey(c) === round) && (!course || itemLabel(c) === course) &&
    (!q || c.claimId.toLowerCase().includes(q) || String(c.requesterName || '').toLowerCase().includes(q)));
}
// รอตรวจขึ้นก่อน (เก่าสุดก่อน) แล้วตามด้วยคำขอที่อัปเดตล่าสุด
function filtered() {
  const g = groupOf($('fStatus').value || group);
  return baseFiltered().filter((c) => !g || g.test(c)).sort((a, b) =>
    (b.status === 'submitted') - (a.status === 'submitted') ||
    (a.status === 'submitted' ? String(a.submittedAt).localeCompare(String(b.submittedAt)) : String(b.updatedAt).localeCompare(String(a.updatedAt))));
}

const row = (c) => `<tr>
  <td class="id">#${esc(c.claimId)}</td>
  <td data-label="บทบาท">${roleTag(c.role)}</td>
  <td data-label="ผู้ขอ" class="who">${esc(c.requesterName)}</td>
  <td data-label="รายการ">${esc(itemLabel(c))}</td>
  <td data-label="ชม." class="num">${num(c.totalHours)}</td>
  <td data-label="บาท" class="num">${num(c.totalAmount)}</td>
  <td data-label="สถานะ" class="st">${statusCell(c)}</td>
  <td class="act">${c.status === 'submitted'
    ? `<a class="btn sm" href="admin-review.html?id=${encodeURIComponent(c.claimId)}">ตรวจ</a>`
    : `<a class="btn ghost sm" href="admin-review.html?id=${encodeURIComponent(c.claimId)}">เปิด</a>`}</td>
</tr>`;

function renderCounts() {
  const base = baseFiltered();
  const btn = (key, th, n) => `<button type="button" data-g="${key}" aria-pressed="${group === key && !$('fStatus').value}">${esc(th)} ${n}</button>`;
  $('counts').innerHTML = btn('', 'ทั้งหมด', base.length) +
    ADMIN_GROUPS.map((g) => { const n = base.filter(g.test).length; return g.opt && !n ? '' : btn(g.key, g.th, n); }).join('');
}

let tableHtml = '';
function render() {
  const list = filtered();
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  page = Math.min(Math.max(1, page), pages);
  const start = (page - 1) * PAGE_SIZE, slice = list.slice(start, start + PAGE_SIZE);
  const round = $('fRound').value;
  $('lead').textContent = `${round ? roundLabel(round) : 'ทุกรอบการเบิก'} · ${list.length} รายการ`;
  const any = ['fRole', 'fStatus', 'fRound', 'fCourse', 'fSearch'].some((id) => $(id).value) || group;
  $('fClear').hidden = !any;
  ['fRole', 'fStatus', 'fRound', 'fCourse'].forEach((id) => $(id).classList.toggle('on', !!$(id).value));
  renderCounts();
  if (!list.length) {
    $('tableCard').innerHTML = `<div class="state"><span class="ic" aria-hidden="true">🔍</span><h3>ไม่พบคำขอตามตัวกรอง</h3>
      <p>ลองเปลี่ยนบทบาท สถานะ หรือรอบการเบิก</p>${any ? '<div class="state-btns"><button type="button" class="btn ghost" id="clear2">ล้างตัวกรอง</button></div>' : ''}</div>`;
    $('clear2')?.addEventListener('click', clearFilters);
    $('pageInfo').textContent = ''; $('pager').innerHTML = '';
    return;
  }
  if (!$('rows')) $('tableCard').innerHTML = tableHtml;
  $('rows').innerHTML = slice.map(row).join('');
  $('pageInfo').textContent = `แสดง ${start + 1}–${start + slice.length} จาก ${list.length} รายการ`;
  $('pager').innerHTML = pages <= 1 ? '<span class="pg on" aria-current="page">1</span>' :
    `<button type="button" class="pg" data-p="${page - 1}"${page === 1 ? ' disabled' : ''} aria-label="หน้าก่อน">‹</button>` +
    Array.from({ length: pages }, (_, i) => i + 1).map((n) => (n === page ? `<span class="pg on" aria-current="page">${n}</span>` : `<button type="button" class="pg" data-p="${n}">${n}</button>`)).join('') +
    `<button type="button" class="pg" data-p="${page + 1}"${page === pages ? ' disabled' : ''} aria-label="หน้าถัดไป">›</button>`;
}

function clearFilters() {
  ['fRole', 'fStatus', 'fRound', 'fCourse', 'fSearch'].forEach((id) => { $(id).value = ''; });
  group = '';
  page = 1;
  history.replaceState(null, '', 'admin-claims.html');
  render();
}

// ส่งออกตามตัวกรองปัจจุบัน (ทุกหน้า)
function exportCsv() {
  const list = filtered();
  if (!list.length) { toast('ไม่มีรายการให้ส่งออก', true); return; }
  const rows = [['เลขที่', 'บทบาท', 'ผู้ขอ', 'รายการ', 'วิชา', 'งานเดือน', 'รอบการเบิก', 'ชั่วโมง', 'ยอดเบิก (บาท)', 'สถานะ', 'ช่องทาง', 'ยื่นเมื่อ'],
    ...list.map((c) => [c.claimId, ROLE_TH[c.role], c.requesterName, itemLabel(c), courseFull(c), thMonth(c.month), roundLabel(roundKey(c)),
      c.totalHours, c.totalAmount, statusOf(c.status, c.printMethod).th, PRINT_METHOD[c.printMethod]?.short || '', c.submittedAt ? thDateTime(c.submittedAt) : ''])];
  downloadCsv(`คำขอ_${todayIso()}.csv`, rows);
}

async function load() {
  $('msg').innerHTML = '';
  if (!$('rows')) $('tableCard').innerHTML = tableHtml;
  $('rows').innerHTML = `<tr class="empty-row"><td colspan="8">${skeleton(['', '', '', ''])}<p class="loading-text">กำลังโหลดข้อมูล…</p></td></tr>`;
  try {
    all = (await api.adminClaims()).items;
    const rounds = [...new Set(all.map(roundKey))].sort().reverse();
    $('fRound').innerHTML = '<option value="">ทุกรอบการเบิก</option>' + rounds.map((k) => `<option value="${esc(k)}">${esc(roundLabel(k))}</option>`).join('');
    $('fCourse').innerHTML = '<option value="">ทุกวิชา</option>' + [...new Set(all.map(itemLabel))].sort().map((c) => `<option>${esc(c)}</option>`).join('');
    const q = new URLSearchParams(location.search);
    if (q.get('role')) $('fRole').value = q.get('role');
    if (groupOf(q.get('status'))) group = q.get('status');
    render();
  } catch (err) {
    $('filters').hidden = true;
    $('counts').innerHTML = '';
    showErrorState($('tableCard'), 'โหลดรายการคำขอไม่สำเร็จ', err, () => { $('filters').hidden = false; load(); });
  }
}

async function init() {
  const user = await initPage(STAFF);
  if (!user) return;
  tableHtml = $('tableCard').innerHTML;
  $('fStatus').insertAdjacentHTML('beforeend', ADMIN_GROUPS.map((g) => `<option value="${g.key}">${esc(g.th)}</option>`).join(''));
  ['fRole', 'fStatus', 'fRound', 'fCourse'].forEach((id) => $(id).addEventListener('change', () => { page = 1; if (id === 'fStatus') group = ''; render(); }));
  $('fSearch').addEventListener('input', () => { page = 1; render(); });
  $('fClear').addEventListener('click', clearFilters);
  $('btnCsv').addEventListener('click', exportCsv);
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
  showFlash();
  load();
}

document.addEventListener('DOMContentLoaded', init);
