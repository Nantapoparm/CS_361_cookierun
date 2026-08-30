// core.js — ส่วนที่ทุกหน้าใช้ร่วมกัน: โหลด JSON, ไอคอน, แถบหัว/ท้าย, sidebar
// ทุกหน้าต้องโหลดไฟล์นี้ก่อนไฟล์ js ของหน้าตัวเอง
//
// แต่ละหน้าประกาศตัวเองผ่าน <body data-page="..." data-root="..." data-role="..." data-section="...">
//   data-page    home | conditions | workflow
//   data-root    เส้นทางกลับไปยังโฟลเดอร์ frontend/ (เช่น "../" หรือ "../../")
//   data-role    instructor | ta | student   (เฉพาะหน้าบทบาท)
//   data-section conditions | workflow        (เฉพาะหน้าบทบาท)

const PAGE = document.body.dataset;
const ROOT = PAGE.root || './';

/* ---------- utils ---------- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

// เขียนผลลัพธ์ลง element ที่มี data-mount="ชื่อ"
function mount(name, html) {
  const el = document.querySelector(`[data-mount="${name}"]`);
  if (el) el.innerHTML = html;
  return el;
}

// โหลดไฟล์จากโฟลเดอร์ data/
// ลองทั้งโครงของ repo (data/ อยู่นอก frontend/) และโครงตอน deploy (data/ อยู่ใน site root)
async function loadJSON(file) {
  const candidates = [`${ROOT}../data/${file}`, `${ROOT}data/${file}`];
  let lastError;
  for (const url of candidates) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/* ---------- ไอคอน ---------- */

const ICONS = {
  person: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="8" r="3.6"/><path d="M4.8 20c.9-3.6 3.7-5.6 7.2-5.6S18.3 16.4 19.2 20"/></svg>',
  people: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="9" cy="8" r="3.2"/><path d="M2.8 20c.8-3.3 3.3-5.2 6.2-5.2S14.4 16.7 15.2 20"/><circle cx="17.4" cy="8.6" r="2.4"/><path d="M15.6 14.4c2.6-.5 5 1.3 5.6 4.6"/></svg>',
  cap: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.5 21.5 9 12 13.5 2.5 9 12 4.5Z"/><path d="M6.5 11.2v4.3c0 1.7 2.5 3 5.5 3s5.5-1.3 5.5-3v-4.3"/></svg>',
  coin: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="8.4"/><path d="M12 7.6v8.8M14.4 9.6c-.6-.7-1.5-1-2.4-1-1.3 0-2.4.7-2.4 1.9s1.1 1.6 2.4 1.8 2.4.6 2.4 1.8-1.1 1.9-2.4 1.9c-.9 0-1.8-.3-2.4-1"/></svg>',
  clock: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3 1.8"/></svg>',
  clockSm: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3 1.8"/></svg>',
  alert: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.6"/><path d="M12 7.8v4.6M12 16.1h.01"/></svg>',
  chevron: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg>',
  chevronLeft: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg>',
  tick: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0f2455" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.6 4.6L19 7.5"/></svg>'
};

const markSvg = (size) =>
  `<svg class="mark" width="${size}" height="${size * 1.06}" viewBox="0 0 48 51" aria-hidden="true">
    <path d="M24 0 8 27h6l10-17 10 17h6L24 0Z"/>
    <path d="M10 31h28v4H10zM10 37h28v4H10zM10 43h28v4H10z" opacity=".92"/>
    <path d="M22 31h4v16h-4z" fill="#0f2455" opacity=".55"/>
  </svg>`;

/* ---------- ส่วนที่ใช้ร่วมทุกหน้า ---------- */

function renderTopbar(site) {
  const m = site.meta;
  mount('topbar', `<div class="wrap">
    <span>${esc(m.org)}</span><span class="sep">|</span><span>${esc(m.academicYear)}</span>
  </div>`);
}

function renderFooter(site) {
  const f = site.footer;
  mount('footer', `<div class="wrap">
    <span class="left">${markSvg(20)}${esc(f.left)}</span>
    <span class="right">${esc(f.right)}</span>
  </div>`);
}

// header ของหน้าแรก (มีเมนูหลัก)
function renderHomeHeader(site) {
  const m = site.meta;
  const links = [
    `<a href="index.html" class="active">หน้าหลัก</a>`,
    ...site.roles.map((r) => `<a href="${r.id}/conditions.html">${esc(r.title)}</a>`),
    `<a href="#contact">ติดต่อ</a>`
  ].join('');

  mount('header', `<div class="wrap">
    <div class="brand">
      ${markSvg(30)}
      <div>
        <div class="brand-name">${esc(m.brand)}</div>
        <div class="brand-sub">${esc(m.brandSub)}</div>
      </div>
    </div>
    <nav class="main-nav">${links}</nav>
  </div>`);
}

// header ของหน้าบทบาท (มีปุ่มกลับหน้าหลัก)
function renderRoleHeader(site, role) {
  const m = site.meta;
  mount('header', `<div class="wrap">
    <a class="back-link" href="${ROOT}html/index.html">${ICONS.chevronLeft}<span>หน้าหลัก</span></a>
    <span class="divider"></span>
    <div class="role-id">
      ${markSvg(26)}
      <div>
        <div class="t">${esc(m.siteTitle)}</div>
        <div class="s">${esc(role.title)} · ${esc(role.titleEn)}</div>
      </div>
    </div>
  </div>`);
}

function renderSidebar(site, section) {
  const m = site.meta;
  // ไฟล์ของแต่ละหัวข้ออยู่โฟลเดอร์เดียวกัน ลิงก์ตรงๆ ได้เลย
  const nav = Object.entries(site.sections).map(([id, s]) => `
    <a href="${id}.html" class="${id === section ? 'active' : ''}">
      <div class="t">${esc(s.title)}</div>
      <div class="s">${esc(s.titleEn)}</div>
    </a>`).join('');

  mount('sidebar', `
    <div class="sidebar-head">
      <div class="k">เนื้อหา</div>
      <div class="v">สารบัญคู่มือ</div>
    </div>
    <nav class="side-nav">${nav}</nav>
    <div class="sidebar-foot">
      <div>${esc(m.updatedLabel)}</div>
      <div>${esc(m.updatedValue)}</div>
      <div>${esc(m.More_information)}</div>
    </div>`);
}

function renderCrumbs(site, role, section) {
  const sec = site.sections[section];
  mount('crumbs', `
    <a href="${ROOT}html/index.html">${esc(site.meta.siteTitle)}</a>
    <span class="sep">${ICONS.chevron}</span>
    <a href="conditions.html">${esc(role.title)}</a>
    <span class="sep">${ICONS.chevron}</span>
    <span class="now">${esc(sec.title)}</span>`);
}

function renderSectionHead(site, section) {
  const sec = site.sections[section];
  mount('section-head', `
    <span class="section-no">${esc(sec.no)}</span>
    <div>
      <h2>${esc(sec.title)}</h2>
      <div class="en">${esc(sec.titleEn)}</div>
    </div>`);
}

/* ---------- จุดเริ่มทำงานของทุกหน้า ---------- */
// โหลด site.json (+ ข้อมูลของหน้านั้นถ้าเป็นหน้าบทบาท) แล้วเรียก initPage() ที่ไฟล์ js ของหน้าประกาศไว้

async function boot() {
  try {
    const site = await loadJSON('site.json');
    renderTopbar(site);
    renderFooter(site);

    if (PAGE.page === 'home') {
      renderHomeHeader(site);
      initPage(site);
      document.title = `${site.meta.siteTitle} | ${site.meta.siteTitleEn}`;
      return;
    }

    const role = site.roles.find((r) => r.id === PAGE.role);
    if (!role) throw new Error(`ไม่รู้จักบทบาท "${PAGE.role}"`);

    const page = await loadJSON(`${PAGE.role}/${PAGE.section}.json`);

    renderRoleHeader(site, role);
    renderSidebar(site, PAGE.section);
    renderCrumbs(site, role, PAGE.section);
    renderSectionHead(site, PAGE.section);
    initPage(site, page, role);

    document.title = `${site.sections[PAGE.section].title} · ${role.title} | ${site.meta.siteTitle}`;
  } catch (err) {
    const main = document.querySelector('[data-mount="body"]') || document.body;
    main.innerHTML =
      '<p class="boot">ไม่สามารถโหลดข้อมูลได้ กรุณาเปิดเว็บไซต์ผ่าน web server ' +
      '(ไม่ใช่การเปิดไฟล์ตรงๆ ด้วย file://)</p>';
    console.error('โหลดข้อมูลไม่สำเร็จ:', err);
  }
}

document.addEventListener('DOMContentLoaded', boot);
