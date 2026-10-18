// layout.js — ส่วนโครงของหน้า: แถบบน, hero, สารบัญ, footer และการไฮไลต์หัวข้อตามการเลื่อน

// เมนูหลักบน topbar แยกตามบทบาท (Figma: ผู้ขอเบิก 4 เมนู, เจ้าหน้าที่ 3 เมนู)
// match = ชื่อไฟล์หน้าที่ถือว่าอยู่ในเมนูนี้ ; text เป็นฟังก์ชันได้ (ปฏิทินของนักศึกษาช่วยงานคือปฏิทินงาน)
const NAV_PUBLIC = [
  { href: 'index.html', text: 'ข้อมูลการเบิก', match: ['', 'index.html'] }
];
const NAV_REQUESTER = [
  { href: 'home.html', text: 'ภาพรวม', match: ['home.html'] },
  { href: 'calendar.html', text: (r) => (r === 'student_helper' ? 'ปฏิทินงาน' : 'ปฏิทินคาบสอน'), match: ['calendar.html', 'makeup.html'] },
  { href: 'form.html', text: 'สร้างคำขอ', match: ['form.html'] },
  { href: 'dashboard.html', text: 'ประวัติคำขอ', match: ['dashboard.html', 'detail.html'] }
];
const NAV_ADMIN = [
  { href: 'admin.html', text: 'ภาพรวม', match: ['admin.html'] },
  { href: 'admin-claims.html', text: 'คำขอทั้งหมด', match: ['admin-claims.html', 'admin-review.html'] },
  { href: 'admin-counter.html', text: 'เคาน์เตอร์เซ็นเอกสาร', match: ['admin-counter.html'] }
];
// หน้าที่ยังไม่ได้สร้าง (V3-14, V3-15) แสดงในเมนูแต่กดไม่ได้ — สร้างหน้าแล้วให้ลบออกจากรายการนี้
const NAV_SOON = new Set(['home.html', 'calendar.html', 'admin-claims.html', 'admin-counter.html']);

// ป้ายบทบาท + ตำแหน่งใต้ชื่อ
const ROLE_CHIP = { instructor: 'อาจารย์', ta: 'TA', student_helper: 'นศ.ช่วยงาน', admin: 'เจ้าหน้าที่' };
const ROLE_POSITION = { instructor: 'อาจารย์ผู้สอน', ta: 'ผู้ช่วยสอน', student_helper: 'นักศึกษาช่วยงาน', admin: 'เจ้าหน้าที่โครงการ' };

// อักษรย่อในวงกลม: พยัญชนะแรกของชื่อและนามสกุล (ข้ามสระหน้า เ แ โ ใ ไ)
const initialOf = (s) => (String(s || '').replace(/^[เแโใไ]/, '').match(/[ก-ฮA-Za-z]/) || [''])[0];
const initials = (u) => (initialOf(u.name) + initialOf(u.lastName)) || initialOf(u.username).toUpperCase() || '?';
// ชื่อที่แสดง: ชื่อ-นามสกุลจาก ID Token ; บัญชีที่ยังไม่มี given_name / family_name → ใช้ username
const displayName = (u) => `${u.name || ''} ${u.lastName || ''}`.trim() || u.username || '';

function navLinks(items, role) {
  const page = location.pathname.split('/').pop();
  return items.map((n) => {
    const text = esc(typeof n.text === 'function' ? n.text(role) : n.text);
    if (NAV_SOON.has(n.href)) return `<a class="soon" aria-disabled="true" title="กำลังพัฒนา">${text}</a>`;
    const on = n.match.includes(page);
    return `<a href="${n.href}" class="${on ? 'active' : ''}"${on ? ' aria-current="page"' : ''}>${text}</a>`;
  }).join('');
}

// user = { name, lastName, role } ของผู้ที่เข้าสู่ระบบ ; ไม่ส่ง user = หน้าสาธารณะ (index.html)
function renderTopbar(site, user) {
  const m = site.meta;
  const items = !user ? NAV_PUBLIC : user.role === 'admin' ? NAV_ADMIN : NAV_REQUESTER;
  const side = user
    ? `<span class="role-chip ${user.role === 'admin' ? 'staff' : ''}">${esc(ROLE_CHIP[user.role] || user.role)}</span>
       <span class="who-box">
         <span class="who-name">${esc(displayName(user))}</span>
         <span class="who-pos">${esc(ROLE_POSITION[user.role] || '')}</span>
       </span>
       <span class="avatar" aria-hidden="true">${esc(initials(user))}</span>
       <button type="button" class="btn-out" data-logout>ออกจากระบบ</button>`
    : `<a class="btn-in" href="${esc(site.sidebar?.login?.url || 'login.html')}">เข้าสู่ระบบ</a>`;

  const bar = mount('topbar', `
    <a class="brand" href="${user ? (user.role === 'admin' ? 'admin.html' : 'dashboard.html') : 'index.html'}">
      <img class="brand-logo" src="${esc(m.logo)}" alt="${esc(m.logoAlt)}">
      <span>
        <span class="brand-name">${esc(m.brand)}</span>
        <span class="brand-sub">${esc(m.brandSub)}</span>
      </span>
    </a>
    <button type="button" class="menu-btn" aria-expanded="false" aria-controls="topMenu" aria-label="เปิดเมนู">
      <span></span><span></span><span></span>
    </button>
    <div class="top-menu" id="topMenu">
      <nav class="topnav" aria-label="เมนูหลัก">${navLinks(items, user?.role)}</nav>
      <div class="top-side">${side}</div>
    </div>`);
  if (!bar) return;

  const btn = bar.querySelector('.menu-btn');
  btn.addEventListener('click', () => {
    const open = bar.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'ปิดเมนู' : 'เปิดเมนู');
  });
  bar.querySelector('[data-logout]')?.addEventListener('click', logoutNow);
}

// ออกจากระบบ: ลบ token ผ่าน Auth (auth.js ของคนที่ 1) แล้วกลับหน้า login
async function logoutNow() {
  try { if (typeof Auth !== 'undefined' && Auth.logout) await Auth.logout(); } catch { /* ลบไม่ได้ก็ยังพาไปหน้า login */ }
  location.href = 'login.html';
}

function renderHero(site) {
  const h = site.hero;
  const m = site.meta;
  mount('hero', `
    <img class="hero-logo" src="${esc(m.logo)}" alt="${esc(m.logoAlt)}">
    <h1>${esc(h.title)}</h1>
    <div class="hero-en">${esc(h.titleEn)}</div>
    <div class="hero-rule"></div>
    <p class="hero-lead">${esc(h.lead)}</p>`);
}

function renderSidebar(site) {
  const nav = (site.sections || []).map((s, i) => `
    <a href="#${s.id}" data-spy="${s.id}" class="${i === 0 ? 'active' : ''}">${esc(s.nav)}</a>`).join('');

  const lg = site.sidebar.login;
  // ยังไม่มีระบบ login ใน V1 — ปุ่มจึงกดไม่ได้และบอกเหตุผลผ่าน tooltip
  const loginBtn = lg.enabled && lg.url
    ? `<a class="btn-login" href="${esc(lg.url)}">${esc(lg.text)}</a>`
    : `<button class="btn-login" type="button" aria-disabled="true" title="${esc(lg.disabledHint)}">${esc(lg.text)}</button>`;

  mount('sidebar', `
    <div class="sidebar-label">${esc(site.sidebar.label)}</div>
    <nav class="side-nav">${nav}</nav>
    <div class="sidebar-foot">${loginBtn}</div>`);
}

function renderFooter(site) {
  mount('footer', esc(site.footer.text));
}

// ไฮไลต์หัวข้อในสารบัญตามตำแหน่งที่เลื่อนอ่านอยู่
function initScrollSpy() {
  const links = [...document.querySelectorAll('.side-nav a[data-spy]')];
  const blocks = links.map((a) => document.getElementById(a.dataset.spy)).filter(Boolean);
  if (!blocks.length || !('IntersectionObserver' in window)) return;

  const setActive = (id) => links.forEach((a) => a.classList.toggle('active', a.dataset.spy === id));

  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((e) => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visible.length) setActive(visible[0].target.id);
  }, { rootMargin: '-90px 0px -65% 0px' });

  blocks.forEach((b) => observer.observe(b));
}