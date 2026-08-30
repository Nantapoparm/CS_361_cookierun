// home.js — เฉพาะหน้าแรก: hero, การ์ดเลือกบทบาท, แถบหมายเหตุ
// core.js เรียก initPage() ให้อัตโนมัติหลังโหลด site.json เสร็จ

function initPage(site) {
  const m = site.meta;
  const h = site.home;

  mount('hero', `
    <span class="hero-badge">${esc(h.badge)}</span>
    ${markSvg(46)}
    <h1>${esc(m.siteTitle)}</h1>
    <div class="hero-en">${esc(m.siteTitleEn)}</div>
    <div class="hero-rule"></div>
    <p class="hero-lead">${esc(h.lead)}</p>`);

  const cards = site.roles.map((r) => `
    <article class="role-card">
      <div class="role-icon">${ICONS[r.icon] || ICONS.person}</div>
      <h3>${esc(r.title)}</h3>
      <div class="label">${esc(r.titleEn)}</div>
      <div class="rule"></div>
      <p>${esc(r.cardDesc)}</p>
      <a class="btn-gold" href="${r.id}/conditions.html">${esc(h.cta)}</a>
    </article>`).join('');

  mount('picker', `<div class="wrap">
    <div class="eyebrow">${esc(h.eyebrow)}</div>
    <h2>${esc(h.heading)}</h2>
    <p class="picker-sub">${esc(h.subheading)}</p>
    <div class="role-grid">${cards}</div>
  </div>`);

  mount('notice', `<div class="wrap">
    <div class="notice">
      <span class="icon">${ICONS.alert}</span>
      <span>${esc(h.notice)}</span>
    </div>
  </div>`);
}
