// workflow.js — เฉพาะหน้า "ขั้นตอนการทำงาน" ใช้ร่วมทั้ง 3 บทบาท
// เนื้อหามาจาก data/<role>/workflow.json — core.js โหลดให้แล้วส่งเข้ามาทาง page

function initPage(site, page) {
  // เลข STEP สร้างจากลำดับใน array ไม่ต้องเขียนใน JSON
  const badges = page.steps.map((_, i) => `
    <div class="step-badge">
      <span class="k">STEP</span>
      <span class="n">${String(i + 1).padStart(2, '0')}</span>
    </div>`).join('');

  const cards = page.steps.map((s) => `
    <article class="step-card">
      <div class="t">${esc(s.title)}</div>
      <div class="s">${esc(s.titleEn)}</div>
      <p>${esc(s.desc)}</p>
    </article>`).join('');

  const stats = page.stats.map((s) => `
    <div class="stat">
      <div class="k">${esc(s.label)}</div>
      <div class="v">${esc(s.value)}</div>
      <div class="n">${esc(s.note)}</div>
    </div>`).join('');

  // ถ้าหน้าไหนอยากได้คำแนะนำต่างจากค่ากลาง ใส่ key "tip" ในไฟล์ json ของหน้านั้นได้
  const tip = page.tip || site.tip;

  mount('body', `
    <p class="intro">${esc(page.intro)}</p>
    <div class="steps">
      <div class="steps-rail">${badges}</div>
      <div class="step-cards">${cards}</div>
    </div>
    <div class="stats">${stats}</div>
    <div class="tip">
      <span class="ic">${ICONS.alert}</span>
      <span><b>${esc(tip.label)}</b> ${esc(tip.text)}</span>
    </div>`);
}
