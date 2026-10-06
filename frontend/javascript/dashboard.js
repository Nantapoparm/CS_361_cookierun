// dashboard.js — หน้ารายการคำขอ
// Input : ตัวกรองภาคการศึกษา (เช่น 1-2569) และสถานะ (draft | submitted) → GET /claims?userId=&term=&status=
//         ตัวกรองรอบการเบิก (billingCycle) และวิชา (courseCode) กรองฝั่ง FE เพราะ API ไม่มี query นี้
// Output: ตารางคำขอ (ใหม่ → เก่า) แบ่งหน้า + แถวรวมชั่วโมง/ยอดเบิกของทุกหน้าตามตัวกรอง
//         ยอดรวมนับทั้งฉบับร่างและที่ยื่นแล้ว
// หมายเหตุ: แบ่งหน้าฝั่ง FE จากรายการที่โหลดมาทั้งหมด ถ้าคำขอมากจริงควรให้ API รองรับ pagination

let all = [];   // คำขอที่โหลดมาตามภาค/สถานะ (ยังไม่กรองรอบ/วิชา)
let page = 1;

const round2 = (n) => Math.round(n * 100) / 100;
const pageSize = () => Number($('pageSize').value) || 5;

// 16.5 → '16 ชม. 30 นาที'
function fmtHours(h) {
  const t = Math.round(Number(h || 0) * 60);
  const hh = Math.floor(t / 60), mm = t % 60;
  return mm ? `${hh} ชม. ${mm} นาที` : `${hh} ชม.`;
}

const row = (c) => {
  const id = encodeURIComponent(c.id);
  const edit = EDITABLE.includes(c.status) ? ` · <a class="link" href="form.html?id=${id}">แก้ไข</a>` : '';
  return `<tr>
    <td>#${esc(c.id)}</td>
    <td>${esc(cycleLabel(c.billingCycle))}</td>
    <td>${esc(courseOf(c) || '-')}</td>
    <td>${esc(termLabel(c.term))}</td>
    <td>${esc(c.totalHours)}</td>
    <td>${baht(c.totalAmount)}</td>
    <td>${statusBadge(c.status)}</td>
    <td><a class="link" href="detail.html?id=${id}">ดูรายละเอียด</a>${edit}</td>
  </tr>`;
};

// '1-2569' → 25691 (ปีก่อน แล้วตามด้วยภาค) ใช้เรียงภาคจากใหม่ไปเก่า
const termKey = (id) => { const [s, y] = String(id).split('-').map(Number); return (y || 0) * 10 + (s || 0); };

// รายการวิชาให้เลือก: API ไม่มี route รายการวิชา จึงสะสมจาก courseCode ของคำขอที่โหลดมา
// (โหลดครั้งแรกไม่มีตัวกรอง จึงได้ครบทุกวิชาของผู้ใช้)
const seenCourses = new Set();
function addCourseOptions(list) {
  const fresh = list.map(courseOf).filter((c) => c && !seenCourses.has(c));
  fresh.forEach((c) => seenCourses.add(c));
  $('fCourse').insertAdjacentHTML('beforeend', [...new Set(fresh)].sort().map((c) => `<option>${esc(c)}</option>`).join(''));
}

// กรองรอบ/วิชา (1 คำขอ = 1 วิชา 1 รอบ จึงเทียบค่าของคำขอได้ตรง ๆ) แล้วเรียงใหม่ → เก่า
function filtered() {
  const cycle = $('fCycle').value, course = $('fCourse').value;
  let list = all;
  if (cycle) list = list.filter((c) => String(c.billingCycle) === cycle);
  if (course) list = list.filter((c) => courseOf(c) === course);
  return [...list].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

const sumOf = (list) => ({
  h: round2(list.reduce((s, c) => s + Number(c.totalHours || 0), 0)),
  a: round2(list.reduce((s, c) => s + Number(c.totalAmount || 0), 0))
});


// แถวรวมแถวเดียว: รวมทุกหน้าตามตัวกรอง (แสดงชั่วโมงเป็นตัวเลขทศนิยม ไม่แปลงเป็นนาที)
const sumRow = (list) => {
  const s = sumOf(list);
  return `<tr class="sum">
    <td colspan="4">รวมทั้งหมดตามตัวกรอง (${list.length} รายการ)</td>
    <td>${s.h}</td>
    <td>${baht(s.a)}</td>
    <td colspan="2"></td>
  </tr>`;
};

// เลขหน้า: ถ้าไม่เกิน 7 หน้าแสดงทั้งหมด ไม่งั้นแสดงหน้าแรก/สุดท้าย/รอบหน้าปัจจุบัน แล้วคั่นด้วย …
function pageList(cur, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const keep = [...new Set([1, total, cur - 1, cur, cur + 1])].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out = [];
  keep.forEach((n, i) => { if (i && n - keep[i - 1] > 1) out.push('…'); out.push(n); });
  return out;
}

function pagerHtml(cur, total) {
  if (total <= 1) return '';
  const btn = (p, text, extra = '') => `<button type="button" class="pg ${extra}" data-p="${p}"${extra.includes('on') ? ' aria-current="page"' : ''}>${text}</button>`;
  return `<button type="button" class="pg" data-p="${cur - 1}"${cur === 1 ? ' disabled' : ''}>ก่อนหน้า</button>` +
    pageList(cur, total).map((n) => n === '…' ? '<span class="pg gap">…</span>' : btn(n, n, n === cur ? 'on' : '')).join('') +
    `<button type="button" class="pg" data-p="${cur + 1}"${cur === total ? ' disabled' : ''}>ถัดไป</button>`;
}

function render() {
  const list = filtered();
  const size = pageSize();
  const pages = Math.max(1, Math.ceil(list.length / size));
  page = Math.min(Math.max(1, page), pages);
  const start = (page - 1) * size;
  const slice = list.slice(start, start + size);

  if (!list.length) {
    $('rows').innerHTML = '<tr><td colspan="8" class="empty">ไม่พบคำขอ ลองเปลี่ยนตัวกรอง หรือกด "สร้างคำขอใหม่"</td></tr>';
    $('foot').innerHTML = '';
    $('pageInfo').textContent = '';
    $('pager').innerHTML = '';
    return;
  }

  $('rows').innerHTML = slice.map(row).join('');
  $('foot').innerHTML = ''; // sumRow(list) รวมทุกหน้าตามตัวกรอง ไม่ใช่เฉพาะหน้านี้
  $('pageInfo').textContent = `แสดง ${start + 1}–${start + slice.length} จาก ${list.length} รายการ`;
  $('pager').innerHTML = pagerHtml(page, pages);
}

// โหลดจาก API (เมื่อเปลี่ยนภาคหรือสถานะ)
async function loadClaims() {
  $('msg').innerHTML = '';
  $('rows').innerHTML = '<tr><td colspan="8" class="empty">กำลังโหลด…</td></tr>';
  $('foot').innerHTML = ''; $('pager').innerHTML = ''; $('pageInfo').textContent = '';
  try {
    all = await api.getClaims({ term: $('fTerm').value, status: $('fStatus').value });
    addCourseOptions(all);
    render();
  } catch (err) {
    all = [];
    $('rows').innerHTML = '';
    showError(err, $('msg'), loadClaims);
  }
}

async function initDashboard() {
  initPage();
  $('fStatus').insertAdjacentHTML('beforeend',
    Object.entries(STATUS).map(([id, s]) => `<option value="${id}">${esc(s.th)}</option>`).join(''));
  try {
    const terms = [...await api.getTerms()].sort((a, b) => termKey(b.id) - termKey(a.id));
    $('fTerm').insertAdjacentHTML('beforeend', terms.map((t) => `<option value="${esc(t.id)}">${esc(t.name || termLabel(t.id))}</option>`).join(''));
  } catch (err) { showError(err, $('msg')); }

  // เปลี่ยนภาค/สถานะ → โหลดใหม่ ; เปลี่ยนรอบ/วิชา/จำนวนต่อหน้า → กรองซ้ำจากข้อมูลเดิม ; ทุกกรณีกลับหน้า 1
  ['fTerm', 'fStatus'].forEach((id) => $(id).addEventListener('change', () => { page = 1; loadClaims(); }));
  ['fCycle', 'fCourse', 'pageSize'].forEach((id) => $(id).addEventListener('change', () => { page = 1; render(); }));
  $('pager').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-p]');
    if (!b || b.disabled) return;
    page = Number(b.dataset.p);
    render();
    $('rows').closest('.table-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  loadClaims();
}

document.addEventListener('DOMContentLoaded', initDashboard);