// api.js — สลับ mock / API จริงได้ที่ API_CONFIG.USE_MOCK + ตัวช่วยที่ทุกหน้า V2 ใช้ร่วมกัน
// รูปแบบข้อมูล/error ตาม openapi.yaml (Teaching Compensation Claim API v2.0.0) ต้องโหลดหลัง core.js และ layout.js
// ข้อมูลเก็บใน localStorage (key: mockClaimsV4) เพื่อให้ข้ามหน้าได้ — ล้างข้อมูลทดสอบ: localStorage.removeItem('mockClaimsV4')
// ทุกหน้าเรียกผ่านออบเจกต์ `api` เท่านั้น สลับโหมดที่ API_CONFIG.USE_MOCK (true = mock, false = API จริง) แล้วตั้ง API_CONFIG.BASE_URL

// ชั่วคราว: ยังไม่มี login → สลับผู้ใช้ทดสอบได้จาก dropdown บนแถบด้านบน (renderUserSwitch)
// role ต้องตรงกับ user_information.roleId ของ userId นั้นใน DB (backend คิดเงินตามค่าใน DB)
// เพิ่มผู้ใช้ทดสอบ = เพิ่มแถวใน DB แล้วเพิ่มรายการที่นี่
const TEST_USERS = [
  { userId: '1', name: 'สมชาย', lastName: 'ใจดี', role: 'instructor' },
  { userId: '2', name: 'สมหมาย', lastName: 'ใจกว้าง', role: 'ta' },
  { userId: '3', name: 'สมหญิง', lastName: 'ใจแคบ', role: 'student_helper' }
];
const USER_KEY = 'userId';
const savedUserId = () => { try { return localStorage.getItem(USER_KEY); } catch { return null; } };

const API_CONFIG = {
  // สวิตช์เปิด/ปิด mock: true = ใช้ข้อมูลจำลองใน localStorage ; false = เรียก API จริงที่ BASE_URL
  USE_MOCK: false,
  BASE_URL: 'https://39eee8bl4b.execute-api.us-east-1.amazonaws.com', // ใส่ URL ของ API Gateway จริง (ไม่ต้องมี / ท้าย)
  // ผู้ใช้ปัจจุบัน = คนที่เลือกไว้ (จำใน localStorage) ไม่งั้นคนแรกในรายการ
  USER: { ...(TEST_USERS.find((u) => u.userId === savedUserId()) || TEST_USERS[0]), halfLoad: true }
};

class ApiError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

// จุดเดียวที่หน้าเว็บคุยกับข้อมูล — เลือก mock หรือ API จริงตาม API_CONFIG.USE_MOCK
async function request(method, path, body) {
  return API_CONFIG.USE_MOCK ? mockRequest(method, path, body) : realRequest(method, path, body);
}

// API จริง: response สำเร็จ = { success:true, data } ; ผิดพลาด = { success:false, error:{ code, message } }
async function realRequest(method, path, body) {
  const headers = { 'X-User-Id': API_CONFIG.USER.userId };
  if (body) headers['Content-Type'] = 'application/json';
  
  let res;
  
  try {
    res = await fetch(API_CONFIG.BASE_URL + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', 0);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    const e = json?.error || {};
    throw new ApiError(e.code || 'INTERNAL_ERROR', e.message || 'ระบบขัดข้อง', res.status);
  }
  return json.data;
}

const qs = (o) => {
  const p = new URLSearchParams();
  Object.entries(o || {}).forEach(([k, v]) => { if (v) p.set(k, v); });
  return p.toString() ? '?' + p : '';
};

// DB เก็บปีเป็น ค.ศ. (backend อาจส่ง '1-2026') → FE ใช้ พ.ศ. เสมอ: '1-2026' → '1-2569'
const toBuddhistTerm = (t) => {
  const m = /^([1-3])-(\d{4})$/.exec(String(t || '').trim());
  if (!m) return t;
  const y = Number(m[2]);
  return `${m[1]}-${y < 2400 ? y + 543 : y}`;
};
const normClaim = (c) => (c ? { ...c, term: toBuddhistTerm(c.term) } : c);
// แปลงเป็น พ.ศ. แล้วตัดภาคที่ซ้ำ (เช่น 1-2569 กับ 1-2026 คือภาคเดียวกัน)
const normTerms = (list) => {
  const seen = new Map();
  (list || []).forEach((t) => {
    const id = toBuddhistTerm(t.id);
    if (!seen.has(id)) seen.set(id, { ...t, id, name: `ภาคการศึกษาที่ ${termLabel(id)}` });
  });
  return [...seen.values()];
};

/* ---------- 8 routes ตาม openapi.yaml ----------
   claim = { id, userId, role, term:'1-2569', billingCycle:1|2,
             items:[{date, courseCode?, hours, note?}], attachments:[fileKey],
             status:'draft'|'submitted', totalHours, totalAmount, createdAt, updatedAt, submittedAt|null }
   body ของ POST/PUT = { userId, role, term, billingCycle, items:[{date, courseCode?, hours, note?}], attachments?:[fileKey] }
   1 คำขอ = 1 วิชา: FE ใส่ courseCode เดียวกันในทุก item */
const api = {
  // f = {term:'1-2569', status:'draft'|'submitted'} — กรองภาคที่ FE หลังแปลงเป็น พ.ศ. (backend อาจเก็บเป็น ค.ศ.)
  getClaims: async (f = {}) => {
    const { term, ...rest } = f;
    const list = (await request('GET', '/claims' + qs({ userId: API_CONFIG.USER.userId, ...rest }))).map(normClaim);
    return term ? list.filter((c) => c.term === term) : list;
  },
  createClaim:     async (body)     => normClaim(await request('POST', '/claims', body)),
  getClaim:        async (id)       => normClaim(await request('GET',  `/claims/${encodeURIComponent(id)}`)),
  updateClaim:     async (id, body) => normClaim(await request('PUT',  `/claims/${encodeURIComponent(id)}`, body)),
  submitClaim:     async (id)       => normClaim(await request('POST', `/claims/${encodeURIComponent(id)}/submit`)),
  getTerms:        async ()         => normTerms(await request('GET', '/terms')),  // → [{ id:'1-2569', name, billingCycles:[{cycle, description, startDay?, lastDay}] }]
  getRates:        ()         => request('GET',  '/rates'),  // → [{ role, ratePerHour, maxHours, maxHoursHalfLoad|null }]
  getPresignedUrl: (p)        => request('GET',  '/uploads/presigned-url' + qs(p)) // → {uploadUrl, fileKey}
};

// อัปโหลดไฟล์เข้า S3 ด้วย presigned URL — โหมด mock ไม่อัปโหลดจริง (uploadUrl เป็น null)
async function uploadToS3(uploadUrl, file) {
  if (API_CONFIG.USE_MOCK || !uploadUrl) return;
  let res;
  try {
    res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  } catch {
    throw new ApiError('UPLOAD_FAILED', 'อัปโหลดไฟล์ไม่สำเร็จ', 0);
  }
  if (!res.ok) throw new ApiError('UPLOAD_FAILED', 'อัปโหลดไฟล์ไม่สำเร็จ', res.status);
}

/* ---------- ค่าคงที่ + ตัวช่วยร่วม ---------- */
// API มีสถานะแค่ 2 ค่า (ClaimStatus)
const STATUS = {
  draft:     { th: 'ฉบับร่าง', cls: 'draft' },
  submitted: { th: 'ยื่นแล้ว · รอตรวจสอบ', cls: 'pending' }
};
const EDITABLE = ['draft']; // API ตอบ 409 INVALID_STATE ถ้าไม่ใช่ draft
const ROLE_TH = { instructor: 'อาจารย์', ta: 'ผู้ช่วยสอน', student_helper: 'นักศึกษาช่วยงาน' };

const $ = (id) => document.getElementById(id);
const statusBadge = (s) => `<span class="status ${STATUS[s]?.cls}">${esc(STATUS[s]?.th || s)}</span>`;
const baht = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 }) + ' บาท';
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('th-TH', { dateStyle: 'medium' }) : '-');
const termLabel = (t) => { const [s, y] = String(t || '').split('-'); return y ? `${s}/${y}` : (t || '-'); }; // '1-2569' → '1/2569'
const cycleLabel = (n) => (n ? `รอบที่ ${n}` : '-');
// 1 คำขอ = 1 วิชา → รหัสวิชาอ่านจาก item แรก
const courseOf = (c) => (c.items || []).find((x) => x.courseCode)?.courseCode || '';
// ชื่อไฟล์จาก file key เช่น uploads/12345-file.pdf → file.pdf
const fileNameOf = (k) => String(k || '').split('/').pop().replace(/^\d+-/, '');

// แสดง error ตาม error.code
function showError(err, el, retry) {
  const text = {
    VALIDATION_ERROR: err.message,
    NOT_FOUND: 'ไม่พบคำขอนี้ ลองกลับไปที่รายการคำขอ',
    INVALID_STATE: 'คำขอนี้ไม่อยู่ในสถานะที่แก้ไขหรือยื่นได้',
    UPLOAD_FAILED: err.message
  }[err.code] || 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง';
  const canRetry = retry && !['VALIDATION_ERROR', 'NOT_FOUND', 'INVALID_STATE'].includes(err.code);
  el.innerHTML = noteBox({ tone: 'danger', label: 'ไม่สำเร็จ', text }) +
    (canRetry ? '<button type="button" class="btn ghost" id="retry">ลองใหม่</button>' : '');
  if (canRetry) $('retry').addEventListener('click', retry);
  console.error(err);
}

async function initPage() {
  try {
    const site = await loadJSON('site.json');
    renderTopbar(site);
    renderFooter(site);
  } catch (e) { console.warn('โหลด site.json ไม่ได้', e); }
  renderUserSwitch();
}

// dropdown สลับผู้ใช้ทดสอบบนแถบด้านบน — เปลี่ยนแล้วโหลดหน้าใหม่
// (ถ้าเปิดคำขอของคนเดิมอยู่ จะกลับไปหน้ารายการ เพราะคนใหม่ไม่มีสิทธิ์ดู)
function renderUserSwitch() {
  const bar = document.querySelector('[data-mount="topbar"]');
  if (!bar || $('userSwitch')) return;
  const opts = TEST_USERS.map((u) =>
    `<option value="${esc(u.userId)}">${esc(u.name)} ${esc(u.lastName)} · ${esc(ROLE_TH[u.role] || u.role)}</option>`).join('');
  bar.insertAdjacentHTML('beforeend',
    `<label class="user-switch"><span>ใช้งานเป็น</span><select id="userSwitch" aria-label="ใช้งานเป็นผู้ใช้">${opts}</select></label>`);
  $('userSwitch').value = API_CONFIG.USER.userId;
  $('userSwitch').addEventListener('change', (e) => {
    try { localStorage.setItem(USER_KEY, e.target.value); } catch { /* ไม่มี storage → ใช้ได้แค่หน้านี้ */ }
    if (new URLSearchParams(location.search).get('id')) location.href = 'dashboard.html';
    else location.reload();
  });
}

/* ---------- Mock (เก็บใน localStorage เพื่อให้ข้ามหน้าได้) ---------- */

const mockCycles = () => [
  { cycle: 1, description: 'ส่งเอกสารภายในวันที่ 5 ของเดือนถัดไป', lastDay: 5 },
  { cycle: 2, description: 'ส่งเอกสารระหว่างวันที่ 6 ถึง 10', startDay: 6, lastDay: 10 }
];

const MOCK = {
  terms: ['1-2569', '2-2569', '1-2568', '2-2568', '2-2567'].map((id) => ({
    id, name: `ภาคการศึกษาที่ ${termLabel(id)}`, billingCycles: mockCycles()
  })),
  rates: [ // ตามตัวอย่างใน openapi.yaml
    { role: 'instructor', ratePerHour: 1200, maxHours: 45, maxHoursHalfLoad: null },
    { role: 'ta', ratePerHour: 420, maxHours: 45, maxHoursHalfLoad: 22.5 },
    { role: 'student_helper', ratePerHour: 40, maxHours: 253, maxHoursHalfLoad: 127 }
  ],
  seed: [
    // ภาค 1/2569 (ปัจจุบัน)
    { id: 'c001', userId: 'ๅ', role: 'ta', term: '1-2569', billingCycle: 1,
      items: [{ date: '2026-09-15', courseCode: 'CS361', hours: 3, note: 'สอนปกติ' }],
      attachments: ['uploads/1726100000-cs361-sep.pdf'], status: 'draft',
      createdAt: '2026-09-16T08:00:00Z', updatedAt: '2026-09-16T08:00:00Z', submittedAt: null },
    { id: 'c002', userId: '1', role: 'ta', term: '1-2569', billingCycle: 2,
      items: [{ date: '2026-09-03', courseCode: 'CS101', hours: 3, note: '' }, { date: '2026-09-10', courseCode: 'CS101', hours: 2.5, note: 'ชดเชย' }],
      attachments: ['uploads/1726000000-timesheet.pdf'], status: 'submitted',
      createdAt: '2026-09-11T09:00:00Z', updatedAt: '2026-09-12T10:20:00Z', submittedAt: '2026-09-12T10:20:00Z' },
    { id: 'c004', userId: '1', role: 'ta', term: '1-2569', billingCycle: 1,
      items: [{ date: '2026-08-18', courseCode: 'CS261', hours: 3, note: 'สอนปกติ' }, { date: '2026-08-25', courseCode: 'CS261', hours: 3, note: 'สอนปกติ' }, { date: '2026-08-29', courseCode: 'CS261', hours: 1.5, note: 'ตรวจงาน' }],
      attachments: ['uploads/1725500000-cs261-aug.pdf'], status: 'submitted',
      createdAt: '2026-09-02T09:00:00Z', updatedAt: '2026-09-03T10:00:00Z', submittedAt: '2026-09-03T10:00:00Z' },

    // ภาค 2/2568
    { id: 'c003', userId: '1', role: 'ta', term: '2-2568', billingCycle: 1,
      items: [{ date: '2026-03-04', courseCode: 'CS261', hours: 2, note: '' }],
      attachments: [], status: 'submitted',
      createdAt: '2026-03-05T09:00:00Z', updatedAt: '2026-03-06T11:00:00Z', submittedAt: '2026-03-06T11:00:00Z' },
    { id: 'c005', userId: '1', role: 'ta', term: '2-2568', billingCycle: 2,
      items: [{ date: '2026-04-07', courseCode: 'CS101', hours: 3, note: 'สอนปกติ' }, { date: '2026-04-21', courseCode: 'CS101', hours: 3, note: 'สอนปกติ' }],
      attachments: ['uploads/1713000000-cs101-apr.pdf'], status: 'submitted',
      createdAt: '2026-05-07T09:00:00Z', updatedAt: '2026-05-08T10:00:00Z', submittedAt: '2026-05-08T10:00:00Z' },

    // ภาค 1/2568
    { id: 'c006', userId: '1', role: 'ta', term: '1-2568', billingCycle: 1,
      items: [{ date: '2025-09-09', courseCode: 'CS361', hours: 3, note: '' }, { date: '2025-09-23', courseCode: 'CS361', hours: 2, note: 'ชดเชย' }],
      attachments: [], status: 'submitted',
      createdAt: '2025-10-02T09:00:00Z', updatedAt: '2025-10-03T10:00:00Z', submittedAt: '2025-10-03T10:00:00Z' },
    { id: 'c007', userId: '1', role: 'ta', term: '1-2568', billingCycle: 2,
      items: [{ date: '2025-10-14', courseCode: 'CS101', hours: 4, note: 'สอนปกติ' }, { date: '2025-10-28', courseCode: 'CS101', hours: 3.5, note: '' }],
      attachments: ['uploads/1730000000-cs101-oct.pdf'], status: 'submitted',
      createdAt: '2025-11-07T09:00:00Z', updatedAt: '2025-11-08T10:00:00Z', submittedAt: '2025-11-08T10:00:00Z' },

    // ภาค 2/2567
    { id: 'c008', userId: '1', role: 'ta', term: '2-2567', billingCycle: 1,
      items: [{ date: '2025-02-11', courseCode: 'CS261', hours: 3, note: '' }],
      attachments: [], status: 'submitted',
      createdAt: '2025-03-03T09:00:00Z', updatedAt: '2025-03-04T10:00:00Z', submittedAt: '2025-03-04T10:00:00Z' },
    { id: 'c009', userId: '1', role: 'ta', term: '2-2567', billingCycle: 2,
      items: [{ date: '2025-03-12', courseCode: 'CS361', hours: 2.5, note: 'สอนปกติ' }, { date: '2025-03-26', courseCode: 'CS361', hours: 2.5, note: '' }],
      attachments: [], status: 'submitted',
      createdAt: '2025-04-07T09:00:00Z', updatedAt: '2025-04-08T10:00:00Z', submittedAt: '2025-04-08T10:00:00Z' }
  ],
  load() {
    try {
      const raw = localStorage.getItem('mockClaimsV4');
      if (raw !== null) return JSON.parse(raw) || [];
      this.save(this.seed);
    } catch { /* ใช้ seed ในหน่วยความจำแทน */ }
    return JSON.parse(JSON.stringify(this.seed));
  },
  save(l) { try { localStorage.setItem('mockClaimsV4', JSON.stringify(l)); } catch { /* ข้าม */ } }
};

// เติมยอดรวมแบบเดียวกับที่ server ส่งกลับ
function view(c) {
  const rate = MOCK.rates.find((r) => r.role === c.role)?.ratePerHour || 0;
  const totalHours = Math.round(c.items.reduce((s, x) => s + x.hours, 0) * 100) / 100;
  return { ...c, totalHours, totalAmount: totalHours * rate };
}

async function mockRequest(method, path, body) {
  await new Promise((r) => setTimeout(r, 250));
  const url = new URL(path, 'http://mock'), p = url.pathname, q = url.searchParams;
  const list = MOCK.load();
  const bad = (m) => new ApiError('VALIDATION_ERROR', m, 400);
  const check = (b) => {
    if (!b || !b.userId || !b.role || !b.term || !b.billingCycle || !Array.isArray(b.items)) throw bad('ข้อมูลไม่ครบ');
    b.items.forEach((x) => { if (!x.date || !(Number(x.hours) > 0)) throw bad('hours ต้องมากกว่า 0'); });
    if (new Set(b.items.map((x) => x.courseCode || '')).size > 1) throw bad('คำขอ 1 ฉบับเบิกได้ 1 วิชา');
  };
  const clean = (b) => ({
    userId: b.userId, role: b.role, term: b.term, billingCycle: Number(b.billingCycle),
    items: b.items.map((x) => ({ date: x.date, courseCode: x.courseCode || '', hours: Number(x.hours), note: x.note || '' })),
    attachments: b.attachments || []
  });

  if (p === '/terms') return MOCK.terms;
  if (p === '/rates') return MOCK.rates;
  if (p === '/uploads/presigned-url') return { uploadUrl: null, fileKey: `uploads/${Date.now()}-${q.get('fileName')}` };

  if (p === '/claims' && method === 'GET') {
    return list.filter((c) =>
      (!q.get('userId') || c.userId === q.get('userId')) &&
      (!q.get('status') || c.status === q.get('status')) &&
      (!q.get('term') || c.term === q.get('term'))).map(view);
  }
  if (p === '/claims' && method === 'POST') {
    check(body);
    const n = Math.max(0, ...list.map((c) => Number(String(c.id).replace(/\D/g, '')) || 0)) + 1;
    const now = new Date().toISOString();
    const c = { id: 'c' + String(n).padStart(3, '0'), ...clean(body), status: 'draft', createdAt: now, updatedAt: now, submittedAt: null };
    MOCK.save([c, ...list]);
    return view(c);
  }

  const m = p.match(/^\/claims\/([^/]+)(\/submit)?$/);
  if (m) {
    const c = list.find((x) => x.id === decodeURIComponent(m[1]));
    if (!c) throw new ApiError('NOT_FOUND', 'ไม่พบคำขอ', 404);
    if (method === 'GET') return view(c);
    if (!EDITABLE.includes(c.status)) throw new ApiError('INVALID_STATE', 'คำขอนี้ถูกยื่นแล้ว ไม่สามารถแก้ไขได้', 409);
    const now = new Date().toISOString();
    if (m[2]) {
      if (!c.items.length) throw bad('กรุณาเพิ่มรายการงานอย่างน้อย 1 รายการ');
      Object.assign(c, { status: 'submitted', submittedAt: now, updatedAt: now });
    } else { check(body); Object.assign(c, clean(body), { updatedAt: now }); }
    MOCK.save(list);
    return view(c);
  }
  throw new ApiError('NOT_FOUND', 'ไม่พบ route', 404);
}