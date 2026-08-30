// conditions.js — เฉพาะหน้า "เงื่อนไข" ใช้ร่วมทั้ง 3 บทบาท
// เนื้อหามาจาก data/<role>/conditions.json — core.js โหลดให้แล้วส่งเข้ามาทาง page

function initPage(site, page) {
  const layout = page.layout === 'split' ? 'split' : 'stack';

  const groups = page.groups.map((g) => `
    <section class="cond-card">
      <header>
        ${g.no ? `<span class="no">${esc(g.no)}</span>` : ''}
        <div>
          <div class="t">${esc(g.title)}</div>
          <div class="s">${esc(g.titleEn)}</div>
        </div>
      </header>
      <ul class="checks">
        ${g.items.map((it) => `<li><span class="tick">${ICONS.tick}</span><span>${esc(it)}</span></li>`).join('')}
      </ul>
    </section>`).join('');

  const tiles = page.rate.map((t) => `
    <div class="tile">
      <span class="ic">${ICONS[t.icon] || ICONS.coin}</span>
      <div>
        <div class="k">${esc(t.label)}</div>
        <div class="v">${esc(t.value)}</div>
      </div>
    </div>`).join('');

  mount('body', `
    <p class="intro">${esc(page.intro)}</p>
    <div class="cond-grid ${layout}">${groups}</div>
    <section class="rate">
      <header>${ICONS.clockSm}<span>${esc(site.ratePanelTitle)}</span></header>
      <div class="rate-tiles">${tiles}</div>
    </section>`);
}
