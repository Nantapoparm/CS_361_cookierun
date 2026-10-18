// api.js — สลับ mock / API จริงได้ที่ API_CONFIG.USE_MOCK + ตัวช่วยที่ทุกหน้าใช้ร่วมกัน
// Route และรูปแบบ response ตาม backend/api/openapi.yaml (V3, PR #87) ชื่อฟิลด์ตาม DB ของ issue #69
// ต้องโหลดหลัง core.js, layout.js, ui.js, config.js และ auth.js
// ข้อมูล mock เก็บใน localStorage (key: mockV3) เพื่อให้ข้ามหน้าได้ — ล้างข้อมูลทดสอบ: localStorage.removeItem('mockV3')
//
// ผู้ใช้มาจาก Auth (auth.js ของคนที่ 1 — V3-02) ทุก request แนบ Authorization: Bearer <token>
// Lambda อ่านผู้ใช้จาก token เอง (V3-07) หน้าเว็บจึงไม่ส่ง userId

const API_CONFIG = {
  // สวิตช์เปิด/ปิด mock: true = ใช้ข้อมูลจำลองใน localStorage ; false = เรียก API จริงที่ BASE_URL
  USE_MOCK: false,
  // URL ของ API Gateway (ไม่มี / ท้าย) อ่านจาก config.js ของคนที่ 1 ก่อน
  BASE_URL: window.APP_CONFIG?.apiBaseUrl || 'https://39eee8bl4b.execute-api.us-east-1.amazonaws.com'
};

// หน้าแรกของแต่ละบทบาทหลังเข้าสู่ระบบ
const ROLE_HOME = { instructor: 'home.html', ta: 'home.html', student_helper: 'home.html', admin: 'admin.html' };
// บทบาทที่เปิดหน้าแต่ละกลุ่มได้ (ส่งให้ initPage)
const REQUESTERS = ['instructor', 'ta', 'student_helper'];
const STAFF = ['admin'];

class ApiError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

/* ---------- ผู้ใช้ที่เข้าสู่ระบบ ---------- */

const hasAuth = () => typeof Auth !== 'undefined';
// รองรับทั้งฟังก์ชันแบบ sync และ async ของ auth.js
const authCall = async (fn, ...args) => (hasAuth() && typeof Auth[fn] === 'function' ? Auth[fn](...args) : null);

// { name, lastName, role, username?, sub? } ; ไม่มี getUser() ใน auth.js → ใช้บทบาทจาก getUserRole() อย่างเดียว
async function currentUser() {
  const u = await authCall('getUser');
  if (u) return u;
  const role = await authCall('getUserRole');
  return role ? { name: '', lastName: '', role } : null;
}

// ส่งไปหน้า login พร้อมจำหน้าที่จะกลับมา (?next=)
function goLogin() {
  const here = location.pathname.split('/').pop() + location.search;
  location.replace(`login.html?next=${encodeURIComponent(here)}`);
}

async function logoutAndLogin() {
  try { await authCall('logout'); } catch { /* ลบ token ไม่ได้ก็ยังพาไปหน้า login */ }
  goLogin();
}

// จุดเดียวที่หน้าเว็บคุยกับข้อมูล — เลือก mock หรือ API จริงตาม API_CONFIG.USE_MOCK
async function request(method, path, body) {
  if (!API_CONFIG.USE_MOCK) return realRequest(method, path, body);
  try { return await mockRequest(method, path, body); } catch (e) {
    if (e.status === 401) await logoutAndLogin();
    throw e;
  }
}

// API จริง: response สำเร็จ = { success:true, data } ; ผิดพลาด = { success:false, error:{ code, message } }
// ไม่มี token หรือได้ 401 (token หมดอายุ / ไม่ถูกต้อง) → ออกจากระบบแล้วไปหน้า login
async function realRequest(method, path, body) {
  let token = null;
  try { token = await authCall('getToken'); } catch { /* ต่ออายุไม่ได้ = ถือว่าไม่มี token */ }
  if (!token) { await logoutAndLogin(); throw new ApiError('UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ', 401); }

  const headers = { Authorization: `Bearer ${token}` };
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
  if (res.status === 401) { await logoutAndLogin(); throw new ApiError('UNAUTHORIZED', 'กรุณาเข้าสู่ระบบใหม่', 401); }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    const e = json?.error || {};
    throw new ApiError(e.code || 'INTERNAL_ERROR', e.message || 'ระบบขัดข้อง', res.status);
  }
  return json.data;
}

const qs = (o) => {
  const p = new URLSearchParams();
  Object.entries(o || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); });
  return p.toString() ? '?' + p : '';
};

// DB เก็บปีเป็น ค.ศ. หรือ พ.ศ. ก็ได้ → FE ใช้ พ.ศ. เสมอ: '1-2026' → '1-2569'
const toBuddhistTerm = (t) => {
  const m = /^([1-3])-(\d{4})$/.exec(String(t || '').trim());
  return m ? `${m[1]}-${be(m[2])}` : t;
};
// แปลงเป็น พ.ศ. แล้วตัดภาคที่ซ้ำ (เช่น 1-2569 กับ 1-2026 คือภาคเดียวกัน)
const normTerms = (list) => {
  const seen = new Map();
  (list || []).forEach((t) => {
    const id = toBuddhistTerm(t.id);
    if (!seen.has(id)) seen.set(id, { ...t, id, name: `ภาคการศึกษาที่ ${termLabel(id)}` });
  });
  return [...seen.values()];
};

/* ---------- รูปแบบข้อมูลที่หน้าเว็บใช้ ----------
   period (คาบในปฏิทิน, teaching_histories) = { historyId, date:'2026-09-07', startTime:'09:30', endTime:'12:30',
     kind:'regular'|'cancelled'|'makeup', courseId, courseName, section?, type:'lecture'|'lab', room, description,
     offeringId?, instructorName? (TA) }
   course (วิชาของผู้ใช้ในภาคนี้) = { offeringId, courseId, courseName, section?, type, room?, instructorName? }
   workDay (วันทำงาน นศ.ช่วยงาน, work_information) = { workId, offeringId, workDate, startTime, endTime, hours, Remark }
   claim = { claimId, status, printMethod, role, offeringId, courseId, courseName, section?, type, room?, instructorName?,
     academicYear, semester, month:'2026-09' (งานเดือน), cycle, deadline, dayClaim, revision,
     items:[{ workId, workDate, startTime, endTime, hours, Remark, kind }], totalHours, totalAmount, ratePerHour,
     returnNote?, returnedAt?, returnedBy?, flaggedWorkIds?:[], createdAt, updatedAt, submittedAt } */

// ประเภทคาบเก็บในคอลัมน์ teaching_histories.description (ไม่มีคอลัมน์ kind) — Lambda อาจส่งมาเป็น kind หรือ description
const PERIOD_KINDS = ['regular', 'cancelled', 'makeup'];
const kindOfPeriod = (p) => (PERIOD_KINDS.includes(p.kind) ? p.kind : PERIOD_KINDS.includes(String(p.description || '').trim().toLowerCase()) ? String(p.description).trim().toLowerCase() : 'regular');

// เวลา ISO ('2026-09-07T09:30:00') หรือ 'HH:MM' → 'HH:MM' ; วันที่อ่านจาก date หรือจาก startTime ที่เป็น ISO
function normPeriod(p) {
  const date = p.date || (String(p.startTime).includes('T') ? String(p.startTime).slice(0, 10) : '');
  return {
    ...p,
    historyId: p.historyId ?? p.id ?? p.exceptionId,
    date,
    startTime: hhmm(p.startTime),
    endTime: hhmm(p.endTime),
    kind: kindOfPeriod(p),
    type: p.type || 'lecture',
    room: p.room || '',
    // description ที่เป็นชื่อประเภทคาบไม่ใช่ข้อความเหตุผล → ไม่แสดง
    description: PERIOD_KINDS.includes(String(p.description || '').trim().toLowerCase()) ? '' : (p.description ?? p.reason ?? '')
  };
}
// คาบ / คำขอเป็นของวิชาเดียวกันไหม: มี offeringId ทั้งคู่ → เทียบ offeringId ; ไม่งั้นเทียบ courseId
// (คาบจาก teaching_histories ไม่มี offeringId แต่ courses จาก course_offerings มี)
const sameOffering = (a, b) => (a?.offeringId != null && b?.offeringId != null
  ? String(a.offeringId) === String(b.offeringId)
  : !!a?.courseId && a.courseId === b?.courseId);

// ไม่มี courses ใน response → รวบรวมจากคาบที่ได้มา
function coursesOf(periods) {
  const map = new Map();
  periods.forEach((p) => {
    const key = p.offeringId ?? p.courseId;
    if (!map.has(key)) map.set(key, { offeringId: p.offeringId, courseId: p.courseId, courseName: p.courseName || '', section: p.section || '', type: p.type, room: p.room, instructorName: p.instructorName || '', sessionId: p.sessionId });
  });
  return [...map.values()];
}
const normClaim = (c) => (c ? {
  ...c,
  claimId: String(c.claimId ?? c.id),
  term: `${c.semester}-${be(c.academicYear)}`,
  items: (c.items || []).map((x) => ({ ...x, startTime: hhmm(x.startTime), endTime: hhmm(x.endTime), workDate: String(x.workDate).slice(0, 10) }))
} : c);

/* ---------- Route ตาม openapi.yaml (V3) ---------- */
const api = {
  // { academicYear, semester, claimMonth:'YYYY-MM', deadline:'YYYY-MM-DD', daysLeft, cycle }
  // คำนวณจากวันที่วันนี้ที่หน้าเว็บ (ทีมตัดสินใจไม่ทำ Lambda GET /current-period)
  // รอบ 1 ส่งภายในวันที่ 5 / รอบ 2 วันที่ 6–10 ของเดือนถัดจากงาน ; ภาคการศึกษาคิดจากเดือนของงาน
  getCurrentPeriod: async () => {
    const p = periodFromDate();
    return { ...termOfDate(parseMonth(p.claimMonth)), ...p };
  },

  // ปฏิทินคาบสอน (อาจารย์ / TA) → { month, periods:[period], summary:[{courseId, periods, hours}], courses:[course] }
  getSchedule: async (month) => {
    const d = await request('GET', '/schedule' + qs({ month }));
    const periods = (d?.periods || []).map(normPeriod).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
    return { month, periods, summary: d?.summary || [], courses: d?.courses?.length ? d.courses : coursesOf(periods) };
  },
  // body = { courseId, sessionId, startTime, endTime (ISO 8601), room, description = regular | cancelled | makeup, repeatUntil? (POST เท่านั้น) }
  //        sessionId มาจาก courses[].sessionId ของ GET /schedule
  createSchedule:  (body)     => request('POST',   '/schedule', body),
  updateSchedule:  (id, body) => request('PUT',    `/schedule/${encodeURIComponent(id)}`, body),
  deleteSchedule:  (id)       => request('DELETE', `/schedule/${encodeURIComponent(id)}`),

  // ปฏิทินงาน (นักศึกษาช่วยงาน) → { items:[workDay], courses:[course] } ; body = { offeringId, workDate, startTime, endTime, Remark? }
  // response เป็น array ล้วนก็ได้ (courses รวบรวมจากวันทำงานที่ได้มา)
  getWorkDays: async (month) => {
    const d = await request('GET', '/work-days' + qs({ month }));
    const items = (Array.isArray(d) ? d : (d?.items || []))
      .map((w) => ({ ...w, workDate: String(w.workDate).slice(0, 10), startTime: hhmm(w.startTime), endTime: hhmm(w.endTime), hours: Number(w.hours ?? hoursBetween(w.startTime, w.endTime)) }))
      .sort((a, b) => (a.workDate + a.startTime).localeCompare(b.workDate + b.startTime));
    return { month, items, courses: d?.courses?.length ? d.courses : coursesOf(items) };
  },
  createWorkDay:   (body)     => request('POST',   '/work-days', body),
  updateWorkDay:   (id, body) => request('PUT',    `/work-days/${encodeURIComponent(id)}`, body),
  deleteWorkDay:   (id)       => request('DELETE', `/work-days/${encodeURIComponent(id)}`),

  // คำขอ — f = { term:'1-2569', status } กรองภาคที่ FE หลังแปลงเป็น พ.ศ.
  getClaims: async (f = {}) => {
    const { term, ...rest } = f;
    const list = (await request('GET', '/claims' + qs(rest))).map(normClaim);
    return term ? list.filter((c) => c.term === term) : list;
  },
  getClaim:        async (id)       => normClaim(await request('GET',  `/claims/${encodeURIComponent(id)}`)),
  // สร้างร่างจากปฏิทิน 1 วิชา / 1 เดือน — เดือนนั้นไม่มีคาบ = { items: [] } (ไม่สร้างคำขอ)
  autofillClaim:   async (offeringId, month) => normClaim(await request('POST', '/claims/autofill', { offeringId, month })),
  // กรอกเอง (ไม่มีคาบในปฏิทิน): body = { offeringId, month, items }
  createClaim:     async (body)     => normClaim(await request('POST', '/claims', body)),
  // แก้ร่าง / คำขอที่ถูกส่งกลับ: body = { items:[{ workId?, workDate, startTime, endTime, hours, Remark, kind }] }
  updateClaim:     async (id, body) => normClaim(await request('PUT',  `/claims/${encodeURIComponent(id)}`, body)),
  submitClaim:     async (id, printMethod) => normClaim(await request('POST', `/claims/${encodeURIComponent(id)}/submit`, { printMethod })),
  setPrintMethod:  async (id, printMethod) => normClaim(await request('PUT', `/claims/${encodeURIComponent(id)}/print-method`, { printMethod })),
  getActions:      (id)       => request('GET', `/claims/${encodeURIComponent(id)}/actions`),
  // type = claim | makeup | blank → { downloadUrl, expiresIn } (mock: downloadUrl = null → หน้าเว็บวาดตัวอย่างเอง)
  getPdf:          (id, type = 'claim', extra = {}) => request('GET', `/claims/${encodeURIComponent(id)}/pdf` + qs({ type, ...extra })),

  // เจ้าหน้าที่ — f = { role, status, month (รอบ YYYY-MM), offeringId, printMethod, q } → { counts:{status:n}, items:[claim + requesterName, printedAt] }
  adminClaims: async (f = {}) => {
    const d = await request('GET', '/admin/claims' + qs(f));
    return { counts: d?.counts || {}, items: (d?.items || []).map(normClaim) };
  },
  // รายละเอียดสำหรับตรวจ: claim + schedule (คาบในตารางสอนของเดือนนั้น), termHours, maxHours, duplicates, actions
  adminClaim: async (id) => {
    const d = await request('GET', `/admin/claims/${encodeURIComponent(id)}`);
    return { ...normClaim(d), schedule: (d.schedule || []).map(normPeriod), actions: d.actions || [] };
  },
  // decision = approve | reject | return ; reject / return ต้องมี note ; workIds = แถวที่ต้องแก้ (return)
  reviewClaim:     async (id, decision, note = '', workIds = []) => normClaim(await request('POST', `/admin/claims/${encodeURIComponent(id)}/review`, { decision, note, workIds })),
  markPrinted:     async (id) => normClaim(await request('POST', `/admin/claims/${encodeURIComponent(id)}/printed`)),
  receiveDocs:     async (id) => normClaim(await request('POST', `/admin/claims/${encodeURIComponent(id)}/documents-received`)),
  sendToFinance:   (claimIds) => request('POST', '/admin/claims/send-to-finance', { claimIds }),

  getTerms:        async ()   => normTerms(await request('GET', '/terms')),  // → [{ id:'1-2569', name, billingCycles }]
  getRates:        ()         => request('GET', '/rates')                    // → [{ role, ratePerHour, maxHours, maxHoursHalfLoad|null, maxAmountPerDay? }]
};

/* ---------- ค่าคงที่ + ตัวช่วยร่วม ---------- */

const STATUS = CLAIM_STATUS;
const EDITABLE = ['draft', 'returned']; // API ตอบ 409 INVALID_STATE ถ้าแก้สถานะอื่น
const ROLE_TH = { instructor: 'อาจารย์', ta: 'ผู้ช่วยสอน', student_helper: 'นักศึกษาช่วยงาน' };
const KIND_TH = { regular: 'ตาราง', makeup: 'ชดเชย', manual: 'เพิ่มเอง', cancelled: 'งดสอน' };
const TYPE_TH = { lecture: 'ภาคทฤษฎี', lab: 'ภาคปฏิบัติ' };

const $ = (id) => document.getElementById(id);
const baht = (n) => num(n) + ' บาท';
const termLabel = (t) => { const [s, y] = String(t || '').split('-'); return y ? `${s}/${y}` : (t || '-'); }; // '1-2569' → '1/2569'
// 'CS262' / 'CS262 Lab' (คาบปฏิบัติของ TA) ; งานของนักศึกษาช่วยงานไม่มีรหัสวิชา → ใช้ชื่องาน
const courseShort = (c) => (c.courseId ? `${c.courseId}${c.type === 'lab' ? ' Lab' : ''}` : (c.courseName || '-'));
// 'CS262 · 650001'
const courseSec = (c) => [courseShort(c), c.section].filter(Boolean).join(' · ');
// 'CS262 INTRODUCTION TO SOFTWARE TESTING'
const courseFull = (c) => [c.courseId, c.courseName].filter(Boolean).join(' ');
const rateOf = (rates, role) => (rates || []).find((r) => r.role === role) || {};
const sumHours = (items) => Math.round((items || []).reduce((s, x) => s + Number(x.hours || 0), 0) * 100) / 100;

/* ---------- เพดานชั่วโมง (compensation_rules.maxHoursPerTerm) ----------
   อาจารย์: เพดานต่อวิชาต่อภาค ; TA และนักศึกษาช่วยงาน: เพดานรวมทุกวิชาในภาค (ครึ่ง Load ใช้ maxHoursHalfLoad)
   load มาจาก user_information.load (ไม่มีใน token ตอนนี้ → ถือว่าเต็ม Load) */
const perCourseCap = (role) => role === 'instructor';
const capOf = (rates, role, load) => {
  const r = rateOf(rates, role);
  return load === 'half' && r.maxHoursHalfLoad ? r.maxHoursHalfLoad : (r.maxHours || 0);
};
const LOAD_TH = { full: 'เต็ม Load', half: 'ครึ่ง Load' };
const COUNTED = ['submitted', 'approved', 'documents_received', 'sent_to_finance']; // นับเป็น "เบิกแล้ว"
// ชั่วโมงที่ยื่นแล้วในภาคนี้ (ไม่นับร่าง ส่งกลับ ไม่อนุมัติ และคำขอที่กำลังแก้) — อาจารย์นับเฉพาะวิชานั้น
function claimedHours(claims, { term, role, offeringId, except }) {
  return Math.round(claims.filter((c) => c.term === term && COUNTED.includes(c.status) && c.claimId !== except &&
    (!perCourseCap(role) || c.offeringId === offeringId)).reduce((s, c) => s + Number(c.totalHours || 0), 0) * 100) / 100;
}

/* ---------- ข้อมูลคำขอที่ยังไม่บันทึก (ขั้นที่ 1 → ขั้นที่ 2) ----------
   "ดูตัวอย่าง PDF" ไม่บันทึกลง DB (autofill สร้างคำขอซ้ำวิชา+เดือนเดิมไม่ได้ จึงต้องสร้างครั้งเดียวตอนยื่น)
   ส่งข้อมูลในฟอร์มไปหน้า submit.html ผ่าน sessionStorage ; กลับไปแก้ไขแล้วข้อมูลยังอยู่
   draft = { claimId|null, offeringId, month, manual, hasSource, course:{...}, rows:[แถวทั้งหมด + checked] } */
const DRAFT_KEY = 'claimPreview';
function saveDraftPreview(d) { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d)); return true; } catch { return false; } }
function loadDraftPreview() { try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; } }
function clearDraftPreview() { try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ข้าม */ } }

// แสดง error ตาม error.code — 400 / 409 ใช้ข้อความจาก server เพราะบอกสาเหตุได้ตรงกว่า
function errorText(err) {
  return {
    VALIDATION_ERROR: err.message,
    INVALID_STATE: err.message || 'คำขอนี้ไม่อยู่ในสถานะที่ทำรายการนี้ได้',
    CONFLICT: err.message,
    NOT_FOUND: 'ไม่พบข้อมูล ลองกลับไปที่หน้ารายการ',
    FORBIDDEN: 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้',
    NETWORK_ERROR: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่',
    UPLOAD_FAILED: err.message
  }[err.code] || `ระบบขัดข้อง${err.status ? ` (HTTP ${err.status})` : ''} กรุณาลองใหม่อีกครั้ง`;
}
const NO_RETRY = ['VALIDATION_ERROR', 'NOT_FOUND', 'INVALID_STATE', 'CONFLICT', 'FORBIDDEN'];

function showError(err, el, retry) {
  const canRetry = retry && !NO_RETRY.includes(err.code);
  el.innerHTML = alertBox('danger', 'ไม่สำเร็จ', errorText(err),
    canRetry ? '<button type="button" class="btn danger sm" data-retry>ลองอีกครั้ง</button>' : '');
  if (canRetry) el.querySelector('[data-retry]').addEventListener('click', retry);
  console.error(err);
}

// การ์ด error เต็มกล่อง (ST5) — ปุ่มลองอีกครั้งเรียก retry
function showErrorState(el, title, err, retry) {
  el.innerHTML = errorState(title, retry ? `${errorText(err).replace(/ กรุณาลองใหม่อีกครั้ง$/, '')} · ข้อมูลของคุณไม่หาย ลองใหม่อีกครั้ง หากยังไม่ได้ติดต่อเจ้าหน้าที่` : errorText(err), retry ? 'retryState' : '');
  if (retry) el.querySelector('#retryState').addEventListener('click', retry);
  console.error(err);
}

// ทุกหน้าที่ต้องเข้าสู่ระบบเรียกตอนเริ่ม: ไม่ได้เข้าสู่ระบบ → ไปหน้า login (คืน null ให้หน้าหยุดทำงาน)
// roles = บทบาทที่เปิดหน้านี้ได้ — บทบาทอื่นถูกพาไปหน้าแรกของตัวเอง (เช่น admin เปิดหน้าสร้างคำขอไม่ได้)
// เข้าสู่ระบบแล้ว → วาดแถบด้านบนตามบทบาท แล้วคืนผู้ใช้ { name, lastName, role }
async function initPage(roles = REQUESTERS) {
  let user = null;
  try { if (await authCall('isLoggedIn')) user = await currentUser(); } catch { user = null; }
  if (!user?.role) { goLogin(); return null; }
  if (!roles.includes(user.role)) { location.replace(ROLE_HOME[user.role] || 'login.html'); return null; }
  try {
    const site = await loadJSON('site.json');
    renderTopbar(site, user);
    renderFooter(site);
  } catch (e) { console.warn('โหลด site.json ไม่ได้', e); }
  return user;
}

/* ====================================================================
   Mock — จำลอง Lambda ตาม openapi.yaml (เก็บใน localStorage เพื่อให้ข้ามหน้าได้)
   ข้อมูลตั้งต้นสร้างตามวันที่วันนี้ ให้มีคาบเดือนนี้ เดือนก่อน และคำขอหลายสถานะเสมอ
   ==================================================================== */

const MOCK_RATES = [ // ตามตัวอย่างใน openapi.yaml + compensation_rules.maxAmountPerDay ของนักศึกษาช่วยงาน
  { role: 'instructor', ratePerHour: 1200, maxHours: 45, maxHoursHalfLoad: null },
  { role: 'ta', ratePerHour: 420, maxHours: 45, maxHoursHalfLoad: 22.5 },
  { role: 'student_helper', ratePerHour: 40, maxHours: 253, maxHoursHalfLoad: 127, maxAmountPerDay: 240 }
];

// วิชาของผู้ใช้ทดสอบแต่ละคน (course_offerings + ตารางสอนประจำ) — weekdays: 0 = อาทิตย์
const MOCK_COURSES = {
  instructor: [
    { offeringId: 7, courseId: 'CS262', courseName: 'INTRODUCTION TO SOFTWARE TESTING', section: '650001', type: 'lecture', room: 'บร.2-213', weekdays: [1], start: '09:30', end: '12:30' },
    { offeringId: 8, courseId: 'CS361', courseName: 'SOFTWARE ENGINEERING', section: '650002', type: 'lecture', room: 'บร.4-301', weekdays: [3], start: '13:30', end: '16:30' }
  ],
  ta: [
    { offeringId: 11, courseId: 'CS262', courseName: 'INTRODUCTION TO SOFTWARE TESTING', section: '650001', type: 'lab', room: 'บร.3-Lab 1', weekdays: [4], start: '13:30', end: '16:30', instructorName: 'ศ.ดร.สมชาย อยู่เย็น' },
    { offeringId: 12, courseId: 'CS213', courseName: 'DATA STRUCTURES', section: '650001', type: 'lab', room: 'บร.3-Lab 2', weekdays: [2], start: '09:30', end: '11:30', instructorName: 'ผศ.ดร.วรรณา ใจงาม' }
  ],
  student_helper: [
    { offeringId: 20, courseId: '', courseName: 'งานธุรการ สำนักงานโครงการ', section: '', type: 'lecture', room: 'บร.2-101', weekdays: [1, 3], start: '13:00', end: '17:00', instructorName: 'อ.สมชาย' }
  ]
};

// ภาคการศึกษาของวันที่: ส.ค.–ธ.ค. = ภาค 1 ของปีนั้น, ม.ค.–พ.ค. = ภาค 2 ของปีก่อน, มิ.ย.–ก.ค. = ภาคฤดูร้อน
function termOfDate(d) {
  const m = d.getMonth() + 1, y = be(d.getFullYear());
  if (m >= 8) return { academicYear: y, semester: 1 };
  if (m <= 5) return { academicYear: y - 1, semester: 2 };
  return { academicYear: y - 1, semester: 3 };
}

const MOCK = {
  key: 'mockV3',
  load() {
    try { const raw = localStorage.getItem(this.key); if (raw) return JSON.parse(raw); } catch { /* ใช้ข้อมูลใหม่ */ }
    return { owners: {}, schedule: [], workDays: [], claims: [], actions: [], seq: { history: 100, work: 500, claim: 96 } };
  },
  save(db) { try { localStorage.setItem(this.key, JSON.stringify(db)); } catch { /* ข้าม */ } }
};

const mockNow = () => new Date().toISOString();
const daysOfMonth = (ym) => { const d = parseMonth(ym), out = []; while (isoMonth(d) === ym) { out.push(isoDate(d)); d.setDate(d.getDate() + 1); } return out; };
const nthWeekday = (ym, wd, n) => daysOfMonth(ym).filter((s) => parseDay(s).getDay() === wd)[n - 1];
const claimNo = (db) => { db.seq.claim += 1; return `${String(be(new Date().getFullYear())).slice(2)}-${String(db.seq.claim).padStart(4, '0')}`; };

// สร้างข้อมูลตั้งต้นของผู้ใช้ครั้งแรกที่เรียก (ตามบทบาท)
function mockSeed(db, owner, role, me) {
  if (db.owners[owner]) return;
  db.owners[owner] = role;
  const courses = MOCK_COURSES[role] || [];
  const p = periodFromDate();
  const m0 = p.claimMonth, m1 = addMonths(m0, -1), m2 = addMonths(m0, -2);
  const months = [m2, m1, m0, addMonths(m0, 1), addMonths(m0, 2)];
  const today = todayIso();
  const who = `${me.name || ''} ${me.lastName || ''}`.trim() || role;

  // คาบปกติทุกสัปดาห์ (อาจารย์ / TA) หรือวันทำงานที่ผ่านมาแล้ว (นักศึกษาช่วยงาน)
  courses.forEach((c) => {
    months.forEach((ym) => daysOfMonth(ym).forEach((day) => {
      if (!c.weekdays.includes(parseDay(day).getDay())) return;
      if (role === 'student_helper') {
        if (day >= today) return;
        db.workDays.push({ workId: ++db.seq.work, owner, offeringId: c.offeringId, workDate: day, startTime: c.start, endTime: c.end, hours: hoursBetween(c.start, c.end), Remark: '', claimId: null });
      } else {
        db.schedule.push({ historyId: ++db.seq.history, owner, offeringId: c.offeringId, courseId: c.courseId, courseName: c.courseName, section: c.section, type: c.type, room: c.room, instructorName: c.instructorName || '', date: day, startTime: c.start, endTime: c.end, kind: 'regular', description: '' });
      }
    }));
  });

  // งดสอน + สอนชดเชย: เดือนก่อน (คาบวันพุธที่ 3) และเดือนนี้ (คาบวันจันทร์ที่ 2)
  const exception = (course, ym, wd, n, why) => {
    const day = nthWeekday(ym, wd, n);
    const row = db.schedule.find((s) => s.owner === owner && s.offeringId === course.offeringId && s.date === day);
    if (!row) return null;
    Object.assign(row, { kind: 'cancelled', description: why });
    if (role === 'instructor') {
      const sat = isoDate(new Date(parseDay(day).getTime() + (6 - parseDay(day).getDay()) * 86400000));
      db.schedule.push({ ...row, historyId: ++db.seq.history, date: sat, kind: 'makeup', description: `สอนชดเชยคาบวันที่ ${thDate(day, false)}` });
    }
    return row;
  };
  if (role === 'instructor') { exception(courses[1], m1, 3, 3, 'กิจกรรมมหาวิทยาลัย'); exception(courses[0], m0, 1, 2, 'ติดประชุมวิชาการ'); }
  if (role === 'ta') exception(courses[0], m1, 4, 3, 'กิจกรรมมหาวิทยาลัย');

  // คำขอหลายสถานะ: [course, เดือน, สถานะ, ช่องทาง]
  const plan = {
    instructor: [[0, m2, 'sent_to_finance', 'sign_with_staff'], [1, m2, 'documents_received', 'self_print'], [0, m1, 'approved', 'sign_with_staff'], [1, m1, 'returned', 'sign_with_staff']],
    ta: [[0, m2, 'sent_to_finance', 'self_print'], [0, m1, 'draft', null], [1, m1, 'submitted', 'self_print']],
    student_helper: [[0, m2, 'sent_to_finance', 'sign_with_staff'], [0, m1, 'submitted', 'sign_with_staff']]
  }[role] || [];
  const at = (ym, day, hh) => new Date(`${addMonths(ym, 1)}-${pad2(day)}T${pad2(hh)}:${pad2(10 + day)}:00`).toISOString();
  plan.forEach(([ci, ym, status, pm]) => {
    const c = courses[ci];
    let items = mockItemsFor(db, owner, role, c, ym);
    // คำขอที่ถูกส่งกลับ: ผู้ใช้เผลอใส่คาบวันงดสอนเป็นคาบปกติ → เจ้าหน้าที่ติ๊กแถวนั้น
    let flagged = [], note = null;
    if (status === 'returned') {
      const off = db.schedule.find((s) => s.owner === owner && s.offeringId === c.offeringId && s.kind === 'cancelled' && s.date.startsWith(ym));
      items = items.filter((x) => x.kind !== 'makeup');
      if (off) {
        const w = { workId: ++db.seq.work, workDate: off.date, startTime: off.startTime, endTime: off.endTime, hours: hoursBetween(off.startTime, off.endTime), Remark: '', kind: 'regular' };
        items = [...items, w].sort((a, b) => a.workDate.localeCompare(b.workDate));
        flagged = [w.workId];
        note = `วันที่ ${thDate(off.date, false)} เป็นวันงดการเรียนการสอน กรุณาลบคาบนี้ หรือระบุวันสอนชดเชยแทน`;
      }
    }
    const t = termOfDate(parseDay(ym + '-01'));
    const claim = {
      claimId: claimNo(db), owner, role, requesterName: who, status, printMethod: pm,
      offeringId: c.offeringId, courseId: c.courseId, courseName: c.courseName, section: c.section, type: c.type, room: c.room, instructorName: c.instructorName || '',
      ...t, month: ym, cycle: 1, deadline: `${addMonths(ym, 1)}-05`,
      dayClaim: status === 'draft' ? null : `${addMonths(ym, 1)}-03`,
      revision: status === 'draft' ? 0 : 1, items, flaggedWorkIds: flagged, returnNote: note,
      returnedBy: note ? 'คุณวิภา ใจดี (จนท.)' : null, returnedAt: note ? at(ym, 4, 13) : null,
      createdAt: at(ym, 3, 10), updatedAt: at(ym, 4, 14), submittedAt: status === 'draft' ? null : at(ym, 3, 10)
    };
    db.claims.push(claim);
    const log = (action, from, to, actor, hh, day = 3, n = null) => db.actions.push({ claimId: claim.claimId, action, fromStatus: from, toStatus: to, actor, note: n, createdAt: at(ym, day, hh) });
    log('autofill', null, 'draft', who, 9, 3);
    if (status === 'draft') return;
    log('submitted', 'draft', 'submitted', who, 10);
    const staff = 'คุณวิภา (จนท.)';
    if (status === 'returned') log('returned', 'submitted', 'returned', staff, 13, 4, note);
    if (['approved', 'documents_received', 'sent_to_finance'].includes(status)) log('approved', 'submitted', 'approved', staff, 14, 4);
    if (['documents_received', 'sent_to_finance'].includes(status)) log('documents_received', 'approved', 'documents_received', staff, 10, 5);
    if (status === 'sent_to_finance') log('sent_to_finance', 'documents_received', 'sent_to_finance', staff, 15, 8);
  });
}

// รายการคาบของคำขอจากปฏิทิน: คาบปกติ + สอนชดเชย (ไม่รวมงดสอน) ; นักศึกษาช่วยงานใช้วันทำงาน
function mockItemsFor(db, owner, role, c, ym) {
  if (role === 'student_helper') {
    return db.workDays.filter((w) => w.owner === owner && w.offeringId === c.offeringId && w.workDate.startsWith(ym))
      .map((w) => ({ workId: ++db.seq.work, workDate: w.workDate, startTime: w.startTime, endTime: w.endTime, hours: w.hours, Remark: w.Remark || '', kind: 'regular' }));
  }
  return db.schedule.filter((s) => s.owner === owner && s.offeringId === c.offeringId && s.date.startsWith(ym) && s.kind !== 'cancelled')
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => ({ workId: ++db.seq.work, workDate: s.date, startTime: s.startTime, endTime: s.endTime, hours: hoursBetween(s.startTime, s.endTime), Remark: s.kind === 'makeup' ? `สอนชดเชย (${s.room})`.slice(0, 50) : '', kind: s.kind }));
}

// ข้อมูลตัวอย่างที่เจ้าหน้าที่เห็น (สร้างครั้งเดียว): บัญชีทดสอบทั้ง 3 บทบาท + ผู้ขอคนอื่นหลายสถานะ
// plan = [[0 = รอบนี้ / 1 = รอบก่อน, สถานะ, ช่องทาง, เจ้าหน้าที่พิมพ์แล้ว?]]
const MOCK_DEMO = [
  { owner: 'demo-wanna', role: 'instructor', name: 'ผศ.ดร.วรรณา ศรีสุข', c: { offeringId: 31, courseId: 'CS213', courseName: 'DATA STRUCTURES', section: '650001', type: 'lecture', room: 'บร.3-201', weekdays: [2], start: '09:00', end: '12:00' }, plan: [[0, 'approved', 'sign_with_staff', true], [1, 'sent_to_finance', 'sign_with_staff']] },
  { owner: 'demo-thanapon', role: 'instructor', name: 'อ.ธนพล มีสุข', c: { offeringId: 32, courseId: 'CS101', courseName: 'INTRODUCTION TO COMPUTER SCIENCE', section: '650003', type: 'lecture', room: 'บร.1-105', weekdays: [4], start: '13:00', end: '16:00' }, plan: [[0, 'approved', 'self_print'], [1, 'documents_received', 'self_print']] },
  { owner: 'demo-nattaya', role: 'instructor', name: 'ดร.ณัฐยา พรหมดี', c: { offeringId: 36, courseId: 'CS111', courseName: 'PROGRAMMING FUNDAMENTALS', section: '650004', type: 'lecture', room: 'บร.1-201', weekdays: [5], start: '09:00', end: '12:00' }, plan: [[0, 'submitted', 'sign_with_staff']] },
  { owner: 'demo-kittiti', role: 'ta', name: 'นายกิตติ ใจงาม', c: { offeringId: 33, courseId: 'CS213', courseName: 'DATA STRUCTURES', section: '650001', type: 'lab', room: 'บร.3-Lab 2', weekdays: [3], start: '13:30', end: '16:30', instructorName: 'ผศ.ดร.วรรณา ศรีสุข' }, plan: [[0, 'approved', 'sign_with_staff'], [1, 'sent_to_finance', 'self_print']] },
  { owner: 'demo-pimchanok', role: 'ta', name: 'นางสาวพิมพ์ชนก แก้วดี', c: { offeringId: 37, courseId: 'CS111', courseName: 'PROGRAMMING FUNDAMENTALS', section: '650004', type: 'lab', room: 'บร.3-Lab 1', weekdays: [1], start: '09:00', end: '12:00', instructorName: 'ดร.ณัฐยา พรหมดี' }, plan: [[0, 'submitted', 'self_print']] },
  { owner: 'demo-phumi', role: 'student_helper', name: 'นายภูมิ รักเรียน', c: { offeringId: 34, courseId: '', courseName: 'งานธุรการ สำนักงานโครงการ', section: '', type: 'lecture', room: 'บร.2-101', weekdays: [2, 4], start: '13:00', end: '17:00' }, plan: [[0, 'documents_received', 'sign_with_staff']] },
  { owner: 'demo-thanakorn', role: 'student_helper', name: 'นายธนกร ขยันดี', c: { offeringId: 35, courseId: '', courseName: 'งานห้องปฏิบัติการ', section: '', type: 'lecture', room: 'บร.3-Lab 1', weekdays: [5], start: '09:00', end: '12:00' }, plan: [[0, 'approved', 'self_print']] }
];

function mockSeedDemo(db) {
  if (db.owners.__demo) return;
  db.owners.__demo = 'admin';
  // บัญชีทดสอบ (auth.stub.js) — login ด้วย Cognito จริง sub จะต่างไป แต่คำขอของบัญชีจริงก็ขึ้นในหน้านี้ด้วย (localStorage เดียวกัน)
  mockSeed(db, 'stub-instructor', 'instructor', { name: 'สมชาย', lastName: 'อยู่เย็น' });
  mockSeed(db, 'stub-ta', 'ta', { name: 'สมหมาย', lastName: 'ขายกางเกง' });
  mockSeed(db, 'stub-student', 'student_helper', { name: 'สมใจ', lastName: 'ใฝ่รู้' });

  const per = periodFromDate();
  const today = todayIso();
  const staff = 'คุณวิภา (จนท.)';
  MOCK_DEMO.forEach((u) => {
    db.owners[u.owner] = u.role;
    u.plan.forEach(([back, status, pm, printed]) => {
      const ym = addMonths(per.claimMonth, -back);
      const deadline = back === 0 ? per.deadline : `${addMonths(ym, 1)}-05`;
      const days = daysOfMonth(ym).filter((d) => u.c.weekdays.includes(parseDay(d).getDay()) && d < today);
      // ตารางสอน / ปฏิทินงานของเดือนนั้น (ใช้เทียบในหน้าตรวจ)
      days.forEach((date) => {
        if (u.role === 'student_helper') db.workDays.push({ workId: ++db.seq.work, owner: u.owner, offeringId: u.c.offeringId, workDate: date, startTime: u.c.start, endTime: u.c.end, hours: hoursBetween(u.c.start, u.c.end), Remark: '', claimId: null });
        else db.schedule.push({ historyId: ++db.seq.history, owner: u.owner, offeringId: u.c.offeringId, courseId: u.c.courseId, courseName: u.c.courseName, section: u.c.section, type: u.c.type, room: u.c.room, instructorName: u.c.instructorName || '', date, startTime: u.c.start, endTime: u.c.end, kind: 'regular', description: '' });
      });
      const items = days.map((date) => ({ workId: ++db.seq.work, workDate: date, startTime: u.c.start, endTime: u.c.end, hours: hoursBetween(u.c.start, u.c.end), Remark: '', kind: 'regular' }));
      if (!items.length) return;
      const sub = new Date(Date.now() - (back * 30 + 3) * 86400000).toISOString();
      const upd = new Date(Date.now() - (back * 30 + 1) * 86400000).toISOString();
      const { weekdays, start, end, ...course } = u.c;
      const claim = {
        claimId: claimNo(db), owner: u.owner, role: u.role, requesterName: u.name, status, printMethod: pm, ...course,
        ...termOfDate(parseMonth(ym)), month: ym, cycle: back === 0 ? per.cycle : 1, deadline, dayClaim: sub.slice(0, 10),
        revision: 1, items, flaggedWorkIds: [], returnNote: null, createdAt: sub, updatedAt: upd, submittedAt: sub, printedAt: printed ? upd : null
      };
      db.claims.push(claim);
      const log = (action, from, to, actor, at) => db.actions.push({ claimId: claim.claimId, action, fromStatus: from, toStatus: to, actor, note: null, createdAt: at });
      log('autofill', null, 'draft', u.name, sub);
      log('submitted', 'draft', 'submitted', u.name, sub);
      if (status !== 'submitted') log('approved', 'submitted', 'approved', staff, upd);
      if (printed) log('printed', null, null, staff, upd);
      if (['documents_received', 'sent_to_finance'].includes(status)) log('documents_received', 'approved', 'documents_received', staff, upd);
      if (status === 'sent_to_finance') log('sent_to_finance', 'documents_received', 'sent_to_finance', staff, upd);
    });
  });
}

// เติมยอดรวมแบบเดียวกับที่ server ส่งกลับ
function mockView(c) {
  const rate = rateOf(MOCK_RATES, c.role).ratePerHour || 0;
  const { owner, ...rest } = c;
  const totalHours = sumHours(c.items);
  return JSON.parse(JSON.stringify({ ...rest, ratePerHour: rate, totalHours, totalAmount: Math.round(totalHours * rate * 100) / 100 }));
}

async function mockRequest(method, path, body) {
  await new Promise((r) => setTimeout(r, 250));
  const url = new URL(path, 'http://mock'), p = url.pathname, q = url.searchParams;
  // ทดสอบหน้า error (ST5 / ST6): localStorage.setItem('mockFail', '/pdf') → ทุก route ที่มีข้อความนี้ตอบ 503
  let fail = null;
  try { fail = localStorage.getItem('mockFail'); } catch { /* ข้าม */ }
  if (fail && p.includes(fail)) throw new ApiError('INTERNAL_ERROR', 'Service Unavailable', 503);
  // เหมือน server V3: ผู้ใช้มาจาก token ไม่ใช่จาก body (โหมด mock ใช้ sub ของ auth.stub.js)
  const me = await currentUser();
  if (!me?.role) throw new ApiError('UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ', 401);
  const owner = me.sub || me.role, role = me.role;
  const db = MOCK.load();
  if (role === 'admin') mockSeedDemo(db); else mockSeed(db, owner, role, me);
  const done = (data) => { MOCK.save(db); return JSON.parse(JSON.stringify(data ?? null)); };
  const bad = (m) => new ApiError('VALIDATION_ERROR', m, 400);
  const conflict = (m) => new ApiError('INVALID_STATE', m, 409);
  const notFound = (m = 'ไม่พบข้อมูล') => new ApiError('NOT_FOUND', m, 404);
  const myCourses = MOCK_COURSES[role] || [];
  const findCourse = (b) => myCourses.find((c) => (b.offeringId && c.offeringId === Number(b.offeringId)) || (!b.offeringId && c.courseId === b.courseId && (!b.type || c.type === b.type)));
  const monthLocked = (offeringId, ym) => db.claims.some((c) => c.owner === owner && c.offeringId === offeringId && c.month === ym && !['draft', 'returned', 'rejected'].includes(c.status));

  if (p === '/rates') return done(MOCK_RATES);
  if (p === '/terms') {
    // ภาคปัจจุบันย้อนหลัง 4 ภาค (ไม่นับภาคฤดูร้อน)
    let { semester: s, academicYear: y } = termOfDate(new Date());
    if (s === 3) s = 2;
    const out = [];
    for (let i = 0; i < 4; i++) { out.push({ id: `${s}-${y}` }); if (s === 1) { s = 2; y -= 1; } else s = 1; }
    return done(out);
  }
  if (p === '/current-period') {
    const per = periodFromDate();
    return done({ ...termOfDate(parseMonth(per.claimMonth)), ...per });
  }

  /* ----- ปฏิทินคาบสอน ----- */
  if (p === '/schedule' && method === 'GET') {
    const ym = q.get('month');
    if (!/^\d{4}-\d{2}$/.test(ym || '')) throw bad('month ต้องเป็นรูปแบบ YYYY-MM');
    const periods = db.schedule.filter((s) => s.owner === owner && s.date.startsWith(ym)).map(({ owner: _, ...s }) => s);
    const summary = [];
    periods.filter((s) => s.kind !== 'cancelled').forEach((s) => {
      let row = summary.find((x) => x.offeringId === s.offeringId);
      if (!row) summary.push(row = { offeringId: s.offeringId, courseId: s.courseId, periods: 0, hours: 0 });
      row.periods += 1; row.hours += hoursBetween(s.startTime, s.endTime);
    });
    const courses = myCourses.map(({ weekdays, start, end, ...c }) => ({ ...c, sessionId: 1, weekdays, startTime: start, endTime: end }));
    return done({ month: ym, periods, summary, courses });
  }
  const sch = p.match(/^\/schedule(?:\/(\d+))?$/);
  if (sch) {
    const checkBody = (b, isNew) => {
      const kind = b?.kind || b?.description;
      if (!PERIOD_KINDS.includes(kind)) throw bad('description ต้องเป็น regular, cancelled หรือ makeup');
      const c = findCourse(b);
      if (!c) throw bad('ไม่พบรายวิชานี้ในภาคการศึกษาปัจจุบัน');
      const [d1, t1] = String(b.startTime || '').split('T'), [d2, t2] = String(b.endTime || '').split('T');
      if (!d1 || !t1 || d1 !== d2) throw bad('startTime / endTime ต้องเป็น ISO 8601 ของวันเดียวกัน');
      if (hoursBetween(t1, t2) <= 0) throw bad('เวลาสิ้นสุดต้องหลังเวลาเริ่ม');
      if (isNew && b.repeatUntil && b.repeatUntil < d1) throw bad('repeatUntil ต้องไม่ก่อนวันของคาบแรก');
      return { c, kind, date: d1, startTime: hhmm(t1), endTime: hhmm(t2) };
    };
    // เวลาทับคาบอื่นของผู้ใช้ (ข้ามวิชา) — คาบงดสอนไม่นับ
    const overlap = (date, a, b, skipId) => db.schedule.find((s) => s.owner === owner && s.historyId !== skipId && s.date === date && s.kind !== 'cancelled' && toMin(a) < toMin(s.endTime) && toMin(s.startTime) < toMin(b));
    if (method === 'POST' && !sch[1]) {
      const v = checkBody(body, true);
      const dates = [v.date];
      if (body.repeatUntil) { const d = parseDay(v.date); for (;;) { d.setDate(d.getDate() + 7); if (isoDate(d) > body.repeatUntil) break; dates.push(isoDate(d)); } }
      const rows = dates.map((date) => {
        const o = v.kind !== 'cancelled' && overlap(date, v.startTime, v.endTime);
        if (o) throw conflict(`เวลาทับกับคาบ ${o.courseId} วันที่ ${thDate(date)} ${timeRange(o.startTime, o.endTime)}`);
        if (monthLocked(v.c.offeringId, date.slice(0, 7))) throw conflict(`ยื่นคำขอของ ${courseShort(v.c)} เดือน ${thMonth(date.slice(0, 7))} แล้ว เพิ่มคาบไม่ได้`);
        return { historyId: ++db.seq.history, owner, offeringId: v.c.offeringId, courseId: v.c.courseId, courseName: v.c.courseName, section: v.c.section, type: body.type || v.c.type, room: body.room || '', instructorName: v.c.instructorName || '', date, startTime: v.startTime, endTime: v.endTime, kind: v.kind, description: '' };
      });
      db.schedule.push(...rows);
      return done(rows.map(({ owner: _, ...r }) => r));
    }
    const row = db.schedule.find((s) => s.owner === owner && s.historyId === Number(sch[1]));
    if (!row) throw notFound('ไม่พบคาบนี้');
    if (monthLocked(row.offeringId, row.date.slice(0, 7))) throw conflict('ยื่นคำขอของเดือนนี้แล้ว แก้ไขหรือลบคาบไม่ได้');
    if (method === 'DELETE') { db.schedule.splice(db.schedule.indexOf(row), 1); return done({ historyId: row.historyId }); }
    if (method === 'PUT') {
      const v = checkBody(body, false);
      const o = v.kind !== 'cancelled' && overlap(v.date, v.startTime, v.endTime, row.historyId);
      if (o) throw conflict(`เวลาทับกับคาบ ${o.courseId} ${timeRange(o.startTime, o.endTime)}`);
      Object.assign(row, { offeringId: v.c.offeringId, courseId: v.c.courseId, courseName: v.c.courseName, section: v.c.section, type: body.type || row.type, room: body.room ?? row.room, date: v.date, startTime: v.startTime, endTime: v.endTime, kind: v.kind, description: '' });
      const { owner: _, ...r } = row;
      return done(r);
    }
  }

  /* ----- ปฏิทินงาน (นักศึกษาช่วยงาน) ----- */
  if (p === '/work-days' && method === 'GET') {
    const ym = q.get('month');
    const items = db.workDays.filter((w) => w.owner === owner && w.workDate.startsWith(ym || '')).map(({ owner: _, ...w }) => {
      const c = myCourses.find((x) => x.offeringId === w.offeringId) || {};
      return { ...w, courseName: c.courseName || '' };
    });
    const courses = myCourses.map(({ weekdays, start, end, ...c }) => ({ ...c, weekdays, startTime: start, endTime: end }));
    return done({ items, courses });
  }
  const wd = p.match(/^\/work-days(?:\/(\d+))?$/);
  if (wd) {
    const checkWork = (b) => {
      const c = findCourse(b);
      if (!c) throw bad('ไม่พบงานนี้ในภาคการศึกษาปัจจุบัน');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.workDate || '')) throw bad('workDate ต้องเป็นวันที่ YYYY-MM-DD');
      const h = hoursBetween(b.startTime, b.endTime);
      if (h <= 0) throw bad('เวลาออกต้องหลังเวลาเข้า');
      if (String(b.Remark || '').length > 50) throw bad('หมายเหตุต้องไม่เกิน 50 ตัวอักษร');
      return { c, h };
    };
    const overlapW = (b, skip) => db.workDays.find((w) => w.owner === owner && w.workId !== skip && w.workDate === b.workDate && toMin(b.startTime) < toMin(w.endTime) && toMin(w.startTime) < toMin(b.endTime));
    if (method === 'POST' && !wd[1]) {
      const v = checkWork(body);
      if (overlapW(body)) throw conflict('มีเวลาทำงานทับกันในวันนี้แล้ว');
      if (monthLocked(v.c.offeringId, body.workDate.slice(0, 7))) throw conflict('ยื่นคำขอของเดือนนี้แล้ว เพิ่มวันทำงานไม่ได้');
      const w = { workId: ++db.seq.work, owner, offeringId: v.c.offeringId, workDate: body.workDate, startTime: hhmm(body.startTime), endTime: hhmm(body.endTime), hours: v.h, Remark: body.Remark || '', claimId: null };
      db.workDays.push(w);
      const { owner: _, ...r } = w;
      return done(r);
    }
    const w = db.workDays.find((x) => x.owner === owner && x.workId === Number(wd[1]));
    if (!w) throw notFound('ไม่พบวันทำงานนี้');
    if (monthLocked(w.offeringId, w.workDate.slice(0, 7))) throw conflict('ยื่นคำขอของเดือนนี้แล้ว แก้ไขหรือลบไม่ได้');
    if (method === 'DELETE') { db.workDays.splice(db.workDays.indexOf(w), 1); return done({ workId: w.workId }); }
    if (method === 'PUT') {
      const v = checkWork(body);
      if (overlapW(body, w.workId)) throw conflict('มีเวลาทำงานทับกันในวันนี้แล้ว');
      Object.assign(w, { offeringId: v.c.offeringId, workDate: body.workDate, startTime: hhmm(body.startTime), endTime: hhmm(body.endTime), hours: v.h, Remark: body.Remark || '' });
      const { owner: _, ...r } = w;
      return done(r);
    }
  }

  /* ----- คำขอ ----- */
  const mine = (id) => {
    const c = db.claims.find((x) => x.claimId === decodeURIComponent(id) && (x.owner === owner || role === 'admin')); // คำขอของคนอื่น = ไม่พบ (ยกเว้น admin)
    if (!c) throw notFound('ไม่พบคำขอ');
    return c;
  };
  const checkItems = (items, ym) => {
    if (!Array.isArray(items)) throw bad('items ต้องเป็น array');
    items.forEach((x, i) => {
      if (!String(x.workDate || '').startsWith(ym)) throw bad(`แถวที่ ${i + 1}: วันที่ต้องอยู่ในเดือน ${thMonth(ym)}`);
      if (!(hoursBetween(x.startTime, x.endTime) > 0)) throw bad(`แถวที่ ${i + 1}: เวลาสิ้นสุดต้องหลังเวลาเริ่ม`);
      if (String(x.Remark || '').length > 50) throw bad(`แถวที่ ${i + 1}: หมายเหตุต้องไม่เกิน 50 ตัวอักษร`);
    });
    return items.map((x) => ({ workId: x.workId || ++db.seq.work, workDate: x.workDate, startTime: hhmm(x.startTime), endTime: hhmm(x.endTime), hours: hoursBetween(x.startTime, x.endTime), Remark: x.Remark || '', kind: x.kind || 'manual' }));
  };
  const log = (c, action, from, to, n = null) => db.actions.push({ claimId: c.claimId, action, fromStatus: from, toStatus: to, actor: `${me.name || ''} ${me.lastName || ''}`.trim() || role, note: n, createdAt: mockNow() });
  const newClaim = (c, ym, items) => {
    const per = periodFromDate();
    const now = mockNow();
    return {
      claimId: claimNo(db), owner, role, requesterName: `${me.name || ''} ${me.lastName || ''}`.trim() || role, status: 'draft', printMethod: null,
      offeringId: c.offeringId, courseId: c.courseId, courseName: c.courseName, section: c.section, type: c.type, room: c.room, instructorName: c.instructorName || '',
      ...termOfDate(parseMonth(ym)), month: ym, cycle: per.cycle, deadline: per.deadline, dayClaim: null, revision: 0,
      items, flaggedWorkIds: [], returnNote: null, createdAt: now, updatedAt: now, submittedAt: null
    };
  };
  const dup = (offeringId, ym) => db.claims.find((c) => c.owner === owner && c.offeringId === offeringId && c.month === ym && c.status !== 'rejected');

  if (p === '/claims' && method === 'GET') {
    return done(db.claims.filter((c) => c.owner === owner && (!q.get('status') || c.status === q.get('status'))).map(mockView));
  }
  if (p === '/claims/autofill' && method === 'POST') {
    const c = findCourse(body || {}), ym = body?.month;
    if (!c || !/^\d{4}-\d{2}$/.test(ym || '')) throw bad('ต้องระบุ offeringId และ month (YYYY-MM)');
    const d = dup(c.offeringId, ym);
    if (d) throw conflict(`มีคำขอ #${d.claimId} ของวิชานี้ในเดือนนี้แล้ว`);
    const items = mockItemsFor(db, owner, role, c, ym);
    if (!items.length) return done({ claimId: null, items: [] });
    const claim = newClaim(c, ym, items);
    db.claims.push(claim);
    log(claim, 'autofill', null, 'draft', `${items.length} คาบ`);
    return done(mockView(claim));
  }
  if (p === '/claims' && method === 'POST') {
    const c = findCourse(body || {}), ym = body?.month;
    if (!c || !/^\d{4}-\d{2}$/.test(ym || '')) throw bad('ต้องระบุ offeringId และ month (YYYY-MM)');
    const d = dup(c.offeringId, ym);
    if (d) throw conflict(`มีคำขอ #${d.claimId} ของวิชานี้ในเดือนนี้แล้ว`);
    const claim = newClaim(c, ym, checkItems(body.items || [], ym));
    db.claims.push(claim);
    log(claim, 'created', null, 'draft');
    return done(mockView(claim));
  }

  const cm = p.match(/^\/claims\/([^/]+)(?:\/(submit|print-method|actions|pdf))?$/);
  if (cm) {
    const c = mine(cm[1]), sub = cm[2], now = mockNow();
    if (!sub && method === 'GET') return done(mockView(c));
    if (sub === 'actions') return done(db.actions.filter((a) => a.claimId === c.claimId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    if (sub === 'pdf') {
      const type = role === 'student_helper' && q.get('type') === 'claim' ? 'blank' : (q.get('type') || 'claim');
      if (role === 'admin') { /* เจ้าหน้าที่เปิดดู/พิมพ์ — บันทึกผ่าน POST /printed แทน */ }
      else if (type === 'makeup') log(c, 'makeup_form', null, null, q.get('note') || null);
      else if (['approved', 'documents_received', 'sent_to_finance'].includes(c.status)) log(c, 'downloaded', null, null);
      else if (c.status === 'draft' || c.status === 'returned') log(c, 'preview', null, null);
      return done({ downloadUrl: null, expiresIn: 300, type });
    }
    if (!sub && method === 'PUT') {
      if (!EDITABLE.includes(c.status)) throw conflict('คำขอนี้ถูกยื่นแล้ว ไม่สามารถแก้ไขได้');
      c.items = checkItems(body?.items, c.month);
      c.updatedAt = now;
      return done(mockView(c));
    }
    if (sub === 'submit') {
      if (!['sign_with_staff', 'self_print'].includes(body?.printMethod)) throw bad('กรุณาเลือกช่องทางยื่น');
      if (!EDITABLE.includes(c.status)) throw conflict('คำขอนี้ถูกยื่นแล้ว');
      if (!c.items.length) throw bad('กรุณาเลือกคาบอย่างน้อย 1 คาบ');
      const from = c.status;
      const per = periodFromDate();
      Object.assign(c, { status: 'submitted', printMethod: body.printMethod, submittedAt: now, updatedAt: now, dayClaim: todayIso(), revision: (c.revision || 0) + 1, cycle: per.cycle, deadline: per.deadline });
      log(c, from === 'returned' ? 'resubmitted' : 'submitted', from, 'submitted', from === 'returned' ? (body.note || null) : null);
      return done(mockView(c));
    }
    if (sub === 'print-method' && method === 'PUT') {
      if (body?.printMethod !== 'sign_with_staff') throw bad('เปลี่ยนได้เฉพาะเป็น sign_with_staff');
      if (c.status !== 'submitted' || c.printMethod !== 'self_print') throw conflict('เปลี่ยนช่องทางได้เฉพาะคำขอปริ้นเซ็นเองที่ยังรอตรวจ');
      c.printMethod = 'sign_with_staff';
      c.updatedAt = now;
      log(c, 'print_method', null, null, 'เปลี่ยนเป็นเซ็นกับเจ้าหน้าที่');
      return done(mockView(c));
    }
  }
  /* ----- เจ้าหน้าที่ (V3-10) — Lambda ตรวจ cognito:groups = admin เอง ----- */
  if (p.startsWith('/admin/')) {
    if (role !== 'admin') throw new ApiError('FORBIDDEN', 'ไม่มีสิทธิ์เข้าถึง', 403);
    const now = mockNow();
    const adminView = (c) => ({ ...mockView(c), requesterName: c.requesterName || c.owner, printedAt: c.printedAt || null });
    const find = (id) => { const c = db.claims.find((x) => x.claimId === decodeURIComponent(id)); if (!c) throw notFound('ไม่พบคำขอ'); return c; };
    if (p === '/admin/claims' && method === 'GET') {
      const t = (q.get('q') || '').trim().toLowerCase();
      const base = db.claims.filter((c) => c.status !== 'draft' &&
        (!q.get('role') || c.role === q.get('role')) && (!q.get('month') || String(c.deadline).startsWith(q.get('month'))) &&
        (!q.get('offeringId') || String(c.offeringId) === q.get('offeringId')) && (!q.get('printMethod') || c.printMethod === q.get('printMethod')) &&
        (!t || c.claimId.includes(t) || String(c.requesterName || '').toLowerCase().includes(t)));
      const counts = {};
      base.forEach((c) => { counts[c.status] = (counts[c.status] || 0) + 1; });
      return done({ counts, items: base.filter((c) => !q.get('status') || c.status === q.get('status')).map(adminView) });
    }
    if (p === '/admin/claims/send-to-finance' && method === 'POST') {
      const ids = Array.isArray(body?.claimIds) ? body.claimIds.map(String) : [];
      if (!ids.length) throw bad('ต้องระบุ claimIds อย่างน้อย 1 รายการ');
      const list = ids.map(find);
      const wrong = list.filter((c) => c.status !== 'documents_received');
      if (wrong.length) throw conflict(`คำขอ ${wrong.map((c) => '#' + c.claimId).join(', ')} ยังไม่ได้รับเอกสาร`);
      list.forEach((c) => { Object.assign(c, { status: 'sent_to_finance', updatedAt: now }); log(c, 'sent_to_finance', 'documents_received', 'sent_to_finance'); });
      return done(list.map(adminView));
    }
    const am = p.match(/^\/admin\/claims\/([^/]+)(?:\/(review|printed|documents-received))?$/);
    if (am) {
      const c = find(am[1]), sub = am[2];
      if (!sub && method === 'GET') {
        // คาบในตารางสอน / ปฏิทินงานของเดือนนั้น + ชั่วโมงสะสมในภาค ให้หน้าเว็บคำนวณผลตรวจเบื้องต้น
        const schedule = c.role === 'student_helper'
          ? db.workDays.filter((w) => w.owner === c.owner && w.offeringId === c.offeringId && w.workDate.startsWith(c.month)).map((w) => ({ historyId: w.workId, date: w.workDate, startTime: w.startTime, endTime: w.endTime, kind: 'regular', courseId: c.courseId, room: '' }))
          : db.schedule.filter((s) => s.owner === c.owner && s.offeringId === c.offeringId && s.date.startsWith(c.month)).map(({ owner: _, ...s }) => s);
        const term = `${c.semester}-${be(c.academicYear)}`;
        const termHours = Math.round(db.claims.filter((x) => x.owner === c.owner && x.claimId !== c.claimId && COUNTED.includes(x.status) &&
          `${x.semester}-${be(x.academicYear)}` === term && (c.role !== 'instructor' || x.offeringId === c.offeringId)).reduce((h, x) => h + sumHours(x.items), 0) * 100) / 100;
        const duplicates = db.claims.filter((x) => x.owner === c.owner && x.claimId !== c.claimId && x.offeringId === c.offeringId && x.month === c.month && x.status !== 'rejected').map((x) => x.claimId);
        const actions = db.actions.filter((a) => a.claimId === c.claimId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const r = rateOf(MOCK_RATES, c.role);
        return done({ ...adminView(c), schedule, termHours, maxHours: r.maxHours, maxHoursHalfLoad: r.maxHoursHalfLoad, maxAmountPerDay: r.maxAmountPerDay || null, duplicates, actions });
      }
      if (sub === 'review' && method === 'POST') {
        const d = body?.decision, note = String(body?.note || '').trim();
        if (!['approve', 'reject', 'return'].includes(d)) throw bad('decision ต้องเป็น approve, reject หรือ return');
        if (d !== 'approve' && !note) throw bad('การส่งกลับและการไม่อนุมัติต้องมีหมายเหตุ');
        if (c.status !== 'submitted') throw conflict('ตรวจได้เฉพาะคำขอที่รอเจ้าหน้าที่ตรวจ');
        const to = { approve: 'approved', reject: 'rejected', return: 'returned' }[d];
        Object.assign(c, { status: to, updatedAt: now });
        if (d === 'return') Object.assign(c, { returnNote: note, flaggedWorkIds: (body.workIds || []).map(Number), returnedBy: `${me.name || ''} ${me.lastName || ''}`.trim() || 'เจ้าหน้าที่', returnedAt: now });
        log(c, to, 'submitted', to, note || null);
        return done(adminView(c));
      }
      if (sub === 'printed' && method === 'POST') {
        if (c.status !== 'approved') throw conflict('พิมพ์ได้เฉพาะคำขอที่ตรวจผ่านแล้ว');
        c.printedAt = now;
        log(c, 'printed', null, null);
        return done(adminView(c));
      }
      if (sub === 'documents-received' && method === 'POST') {
        if (c.status !== 'approved') throw conflict('รับเอกสารได้เฉพาะคำขอที่ตรวจผ่านแล้ว');
        Object.assign(c, { status: 'documents_received', updatedAt: now });
        log(c, 'documents_received', 'approved', 'documents_received');
        return done(adminView(c));
      }
    }
  }
  throw new ApiError('NOT_FOUND', 'ไม่พบ route', 404);
}
