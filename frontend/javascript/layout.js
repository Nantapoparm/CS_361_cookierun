// layout.js — ส่วนโครงของหน้า: แถบบน, hero, สารบัญ, footer และการไฮไลต์หัวข้อตามการเลื่อน

function renderTopbar(site) {
  const m = site.meta;
  mount('topbar', `
    <div class="brand">
      <img class="brand-logo" src="${esc(m.logo)}" alt="${esc(m.logoAlt)}">
      <span>
        <span class="brand-name">${esc(m.brand)}</span>
        <span class="brand-sub" style="display:block">${esc(m.brandSub)}</span>
      </span>
    </div>
    <div class="org">${esc(m.org)} | ${esc(m.academicYear)}</div>`);
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
