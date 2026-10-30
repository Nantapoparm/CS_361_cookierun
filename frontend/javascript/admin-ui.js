// admin-ui.js — ตัวช่วยร่วมของหน้าเจ้าหน้าที่ (V3-15: AD1–AD7) ต้องโหลดหลัง api.js และ pdf.js

const ROLE_TAG = { instructor: 'อาจารย์', ta: 'TA', student_helper: 'นศ.ช่วยงาน' };
const roleTag = (r) => `<span class="tag role">${esc(ROLE_TAG[r] || r)}</span>`;

// รายการของคำขอ: อาจารย์ 'CS262 · 650001' · TA 'CS262 Lab' · นศ.ช่วยงาน ชื่องาน
const itemLabel = (c) => (c.role === 'instructor' ? courseSec(c) : c.role === 'ta' ? courseShort(c) : String(c.courseName || '-').split(' ')[0]);

// วันที่สั้นไม่มีปี: '3 ต.ค.'
const shortDay = (s) => (s ? thDate(isoDate(new Date(s)), false).replace(/ \d{4}$/, '') : '');

// บรรทัดเล็กใต้ชิปสถานะ (AD1 / AD2)
function statusSub(c) {
  switch (c.status) {
    case 'submitted': return (c.revision || 1) > 1 ? `ยื่นใหม่ ครั้งที่ ${c.revision}` : `ส่งเมื่อ ${shortDay(c.submittedAt)}`;
    case 'returned': return `ส่งกลับ ${shortDay(c.returnedAt || c.updatedAt)}`;
    case 'approved': return c.printMethod === 'self_print' ? `อนุมัติ ${shortDay(c.updatedAt)}` : c.printedAt ? `พิมพ์แล้ว ${shortDay(c.printedAt)}` : `อนุมัติ ${shortDay(c.updatedAt)} · ยังไม่พิมพ์`;
    case 'documents_received': return `รับเอกสาร ${shortDay(c.updatedAt)}`;
    case 'sent_to_finance': return `ส่งการเงิน ${shortDay(c.updatedAt)}`;
    case 'paid': return `เงินเข้า ${shortDay(c.updatedAt)}`;
    case 'rejected': return `ไม่อนุมัติ ${shortDay(c.updatedAt)}`;
    default: return '';
  }
}
const statusCell = (c) => `${chip(c.status, c.printMethod)}<small>${esc(statusSub(c))}</small>`;

// รอบการเบิกของคำขอ = เดือนของวันสิ้นสุดรับคำขอ + รอบที่ (1 | 2) → key '2026-11|1'
const roundKey = (c) => `${String(c.deadline || '').slice(0, 7)}|${cycleOf(c)}`;
const roundLabel = (key) => { const [m, cy] = key.split('|'); return `รอบที่ ${cy} · ${thMonth(m)}`; };

// กลุ่มสถานะของแท็บนับ (approved แยกตามช่องทาง) — opt = แสดงเฉพาะเมื่อมีคำขอ
const ADMIN_GROUPS = [
  { key: 'submitted', th: 'รอตรวจ', test: (c) => c.status === 'submitted' },
  { key: 'returned', th: 'ส่งกลับแก้ไข', test: (c) => c.status === 'returned' },
  { key: 'sign', th: 'รอเซ็น', test: (c) => c.status === 'approved' && c.printMethod !== 'self_print' },
  { key: 'self', th: 'รอรับเอกสาร (ปริ้นเอง)', test: (c) => c.status === 'approved' && c.printMethod === 'self_print' },
  { key: 'documents_received', th: 'รับเอกสารแล้ว', test: (c) => c.status === 'documents_received' },
  { key: 'sent_to_finance', th: 'ส่งการเงินแล้ว', test: (c) => c.status === 'sent_to_finance' },
  { key: 'paid', th: 'เงินเข้าแล้ว', test: (c) => c.status === 'paid', opt: true },
  { key: 'rejected', th: 'ไม่อนุมัติ', test: (c) => c.status === 'rejected', opt: true }
];

// ข้อความ toast ข้ามหน้า (เช่น อนุมัติแล้วพาไปหน้าเคาน์เตอร์)
function flash(msg) { try { sessionStorage.setItem('flash', msg); } catch { /* ข้าม */ } }
function showFlash() {
  try { const m = sessionStorage.getItem('flash'); if (m) { sessionStorage.removeItem('flash'); toast(m); } } catch { /* ข้าม */ }
}

// ส่งออก CSV จากหน้าเว็บ (ใส่ BOM ให้ Excel อ่านภาษาไทยได้)
function downloadCsv(name, rows) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// เอกสารของคำขอ ใช้ชื่อผู้ขอ (ไม่ใช่เจ้าหน้าที่ที่ login)
const requesterOf = (c) => { const n = String(c.requesterName || '').trim(); const i = n.lastIndexOf(' '); return i > 0 ? { name: n.slice(0, i), lastName: n.slice(i + 1) } : { name: n, lastName: '' }; };
const adminDocHtml = (c) => (c.role === 'student_helper' ? blankDocHtml(c) : claimDocHtml(c, requesterOf(c)));
const adminDocName = (c) => docFileName(c, { name: requesterOf(c).name.replace(/^.*\./, '') });

// พิมพ์เอกสารที่ตรวจผ่าน 1 ใบหรือหลายใบ: ขอ PDF (Lambda บันทึกการดาวน์โหลด) → เปิด/พิมพ์ → บันทึกว่าพิมพ์แล้ว (กันพิมพ์ซ้ำ)
async function printClaims(list) {
  // นักศึกษาช่วยงาน = แบบฟอร์มเปล่าในเว็บ (ตามโครงการ) ; อื่นๆ ขอ PDF จาก Lambda
  const urls = await Promise.all(list.map((c) => (c.role === 'student_helper' ? Promise.resolve(blankFormOf(c).file)
    : api.getPdf(c.claimId, 'claim').then((r) => r?.downloadUrl).catch(() => null))));
  if (list.length === 1 || urls.every(Boolean)) {
    if (urls.every(Boolean)) urls.forEach((u) => window.open(u, '_blank', 'noopener'));
    else openDoc(null, adminDocHtml(list[0]), adminDocName(list[0]));
  } else {
    openDoc(null, list.map((c) => `<div class="doc-page">${adminDocHtml(c)}</div>`).join(''), `เอกสารเซ็น_${list.length}_รายการ.pdf`);
  }
  const done = [];
  for (const c of list) {
    if (c.status !== 'approved') continue;
    try { done.push(await api.markPrinted(c.claimId)); } catch (err) { console.warn(err); }
  }
  return done;
}
