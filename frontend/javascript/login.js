// login.js — หน้าเข้าสู่ระบบ (Figma A1 ปกติ · A2 รหัสผ่านผิด · A3 ไม่มีสิทธิ์ใช้งาน · A4 กำลังเข้าสู่ระบบ)
// Input : ชื่อผู้ใช้ Cognito (เช่น instructor) + รหัสผ่าน → Auth.login(username, password) ของ auth.js (คนที่ 1)
// Output: เข้าสู่ระบบแล้วไปหน้า ?next= (ถ้ามี) หรือหน้าแรกของบทบาท (ROLE_HOME ใน api.js)
// ไม่มีหน้าเปลี่ยนรหัสผ่านครั้งแรก / ลืมรหัสผ่าน ใน V3 (V3-01 ตั้งรหัสผ่านถาวรให้บัญชีทดสอบ)

// รับ next เฉพาะชื่อหน้าในเว็บนี้ (เช่น detail.html?id=c002) กันการพาไปเว็บอื่น
function nextPage(role) {
  const next = new URLSearchParams(location.search).get('next') || '';
  return /^[\w-]+\.html(\?[^#]*)?$/.test(next) && !next.startsWith('login.html') ? next : (ROLE_HOME[role] || 'dashboard.html');
}

/* ---------- การ์ดรอบการเบิกปัจจุบัน ----------
   คำนวณจากวันที่วันนี้ตามหลักเกณฑ์ (data/sections/cycles.json): รอบ 1 ส่งภายในวันที่ 5, รอบ 2 วันที่ 6–10 ของเดือนถัดไป
   หน้านี้ยังไม่ได้เข้าสู่ระบบ จึงเรียก GET /current-period (ต้องมี token) ไม่ได้ */
const TH_MONTH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function periodNow(today = new Date()) {
  const d = today.getDate();
  // หลังวันที่ 10 → รอบที่ 1 ของเดือนหน้า (งานของเดือนนี้)
  const due = d > 10 ? new Date(today.getFullYear(), today.getMonth() + 1, 1) : today;
  const work = new Date(due.getFullYear(), due.getMonth() - 1, 1);
  const be = (dt) => dt.getFullYear() + 543;
  const cycle = d > 5 && d <= 10 ? 2 : 1;
  return {
    title: cycle === 1 ? `รอบที่ 1 · ภายใน 5 ${TH_MON[due.getMonth()]} ${be(due)}` : `รอบที่ 2 · 6–10 ${TH_MON[due.getMonth()]} ${be(due)}`,
    sub: `สำหรับงานสอนเดือน${TH_MONTH[work.getMonth()]} ${be(work)}`
  };
}

function renderPeriod() {
  const p = periodNow();
  $('period').innerHTML = `<div class="eyebrow">รอบการเบิกปัจจุบัน</div><div class="t">${esc(p.title)}</div><div class="d">${esc(p.sub)}</div>`;
}

/* ---------- ข้อความผิดพลาด ---------- */

const MSG = {
  wrong: ['เข้าสู่ระบบไม่สำเร็จ', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'],
  noGroup: ['บัญชีนี้ยังไม่มีสิทธิ์ใช้งานระบบเบิก', 'บัญชีของคุณถูกต้อง แต่ยังไม่ได้ลงทะเบียนเป็นอาจารย์ / TA / นักศึกษาช่วยงาน หรือเจ้าหน้าที่ กรุณาติดต่อเจ้าหน้าที่โครงการ'],
  notReady: ['บัญชียังไม่พร้อมใช้งาน', 'กรุณาติดต่อเจ้าหน้าที่โครงการเพื่อเปิดใช้งานบัญชี'],
  tooMany: ['ลองเข้าสู่ระบบหลายครั้งเกินไป', 'กรุณารอสักครู่แล้วลองใหม่'],
  network: ['เชื่อมต่อไม่ได้', 'ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง'],
  noAuth: ['ระบบเข้าสู่ระบบยังไม่พร้อม', 'ไม่พบโมดูล auth.js กรุณาแจ้งผู้ดูแลระบบ'],
  empty: ['กรอกข้อมูลไม่ครบ', 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน']
};

// error.code จาก Cognito (ผ่าน auth.js) → ชุดข้อความ
function msgOf(err) {
  const code = String(err?.code || err?.name || '');
  if (['NotAuthorizedException', 'UserNotFoundException', 'INVALID_CREDENTIALS'].includes(code)) return MSG.wrong;
  if (['NO_GROUP', 'NoGroup', 'FORBIDDEN'].includes(code)) return MSG.noGroup;
  if (['UserNotConfirmedException', 'PasswordResetRequiredException', 'NEW_PASSWORD_REQUIRED'].includes(code)) return MSG.notReady;
  if (['TooManyRequestsException', 'LimitExceededException', 'TooManyFailedAttemptsException'].includes(code)) return MSG.tooMany;
  if (['NetworkError', 'AUTH_NETWORK_ERROR'].includes(code) || err instanceof TypeError) return MSG.network;
  return ['เข้าสู่ระบบไม่สำเร็จ', 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง'];
}

function showMsg([title, text]) {
  $('msg').innerHTML = `<div class="alert danger" role="alert">
    <span class="dot" aria-hidden="true">!</span>
    <span class="body"><b>${esc(title)}</b>${esc(text)}</span>
  </div>`;
}

/* ---------- เข้าสู่ระบบ ---------- */

function setBusy(on) {
  const b = $('btnLogin');
  b.disabled = on;
  b.textContent = on ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ';
  $('loginForm').setAttribute('aria-busy', String(on));
}

async function onSubmit(e) {
  e.preventDefault();
  const username = $('username').value.trim();
  const password = $('password').value;
  if (!username || !password) { showMsg(MSG.empty); (username ? $('password') : $('username')).focus(); return; }
  if (!hasAuth()) { showMsg(MSG.noAuth); return; }

  $('msg').innerHTML = '';
  setBusy(true);
  try {
    await Auth.login(username, password);
    const user = await currentUser();
    // เข้าสู่ระบบได้แต่ไม่อยู่ใน Group ใด → ไม่ให้ใช้งาน (A3)
    if (!user?.role || !ROLE_HOME[user.role]) {
      await authCall('logout');
      throw Object.assign(new Error('no group'), { code: 'NO_GROUP' });
    }
    location.replace(nextPage(user.role));
  } catch (err) {
    console.error(err);
    showMsg(msgOf(err));
    setBusy(false);
    $('password').value = '';
    $('password').focus();
  }
}

async function initLogin() {
  renderPeriod();
  // เข้าสู่ระบบค้างไว้แล้ว → ไปต่อเลย
  try {
    if (await authCall('isLoggedIn')) {
      const user = await currentUser();
      if (user?.role && ROLE_HOME[user.role]) { location.replace(nextPage(user.role)); return; }
    }
  } catch { /* token เสีย → ให้เข้าสู่ระบบใหม่ */ }

  $('loginForm').addEventListener('submit', onSubmit);
  $('pwToggle').addEventListener('click', () => {
    const show = $('password').type === 'password';
    $('password').type = show ? 'text' : 'password';
    $('pwToggle').textContent = show ? 'ซ่อน' : 'แสดง';
    $('pwToggle').setAttribute('aria-pressed', String(show));
  });
  $('username').focus();
}

document.addEventListener('DOMContentLoaded', initLogin);
