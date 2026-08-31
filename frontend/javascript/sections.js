 
ม.
// sections.js — ตัวเรนเดอร์ของแต่ละหัวข้อ
//
// เพิ่มหัวข้อใหม่ทำ 3 อย่าง:
//   1. สร้าง data/sections/<id>.json
//   2. เพิ่มรายการใน "sections" ของ data/site.json
//   3. เพิ่มฟังก์ชันใน SECTIONS ด้านล่าง โดยใช้ <id> เป็น key
//
// แต่ละฟังก์ชันรับข้อมูลของหัวข้อตัวเอง แล้วคืน HTML ส่วนเนื้อหา (ไม่รวมหัวข้อ)

const SECTIONS = {

  /* ---------- ภาพรวมระบบ ---------- */
  overview(data) {
    const cards = (data.metrics || []).map((m) => ` 
      <div class="metric">
        <div class="v">${esc(m.value)}</div>
        <div class="k">${esc(m.label)}</div>
      </div>`).join('');
    return `<div class="metrics">${cards}</div>`;
  },

  /* ---------- ผู้มีสิทธิ์เบิก ---------- */
  users(data) {
    const cards = data.roles.map((r) => `
      <article class="role-card">
        <div class="ic">${ICONS[r.icon] || ICONS.person}</div>
        <h3>${esc(r.title)}</h3>
        <div class="label">${esc(r.titleEn)}</div>
        <div class="rule"></div>
        ${r.lines.map((l) => `<p>${esc(l)}</p>`).join('')}
      </article>`).join('');
    return `<div class="roles">${cards}</div>`;
  },

  /* ---------- อัตราค่าตอบแทนและเพดานชั่วโมง ---------- */
  // เพดานชั่วโมงของแต่ละบทบาทไม่เท่ากันและมีที่มาต่างกัน จึงอยู่เป็นคอลัมน์คู่กับอัตรา
  rates(data) {
    const c = data.columns;
    const rows = data.rows.map((r) => `
      <tr>
        <td class="role">${esc(r.role)}</td>
        <td class="rate">
          <span class="amount">${esc(r.amount)}</span>
          <span class="unit">${esc(r.unit)}</span>
        </td>
        <td class="limit">
          <span class="v">${esc(r.limit)}</span>
          ${r.limitNote ? `<span class="n">${esc(r.limitNote)}</span>` : ''}
        </td>
      </tr>`).join('');

    return `<div class="table-card">
      <table class="rate-table">
        <colgroup><col class="c-role"><col class="c-rate"><col></colgroup>
        <thead>
          <tr><th>${esc(c.role)}</th><th>${esc(c.rate)}</th><th>${esc(c.limit)}</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${(data.notes || []).map(noteBox).join('')}
    </div>`;
  },

  /* ---------- รอบการเบิก ---------- */
  cycles(data) {
    const cards = data.cycles.map((c) => `
      <article class="cycle">
        <span class="badge">${esc(c.badge)}</span>
        <div class="t">${esc(c.title)}</div>
        <div class="d">${esc(c.desc)}</div>
      </article>`).join('');
    return `<div class="cycles">${cards}</div>${noteBox(data.note)}`;
  },

  /* ---------- คู่มือและแบบฟอร์ม ---------- */
  manuals(data) {
    // มี path ไฟล์ = ปุ่มดาวน์โหลดจริง / ยังไม่มี = ปุ่มกดไม่ได้พร้อม tooltip บอกสถานะ
    const items = data.items.map((i) => i.file
      ? `<a class="manual" href="${esc(i.file)}" download>
           <span class="ic">${ICONS.file}</span>${esc(i.text)}
         </a>`
      : `<button class="manual" type="button" aria-disabled="true" title="${esc(data.pendingHint)}">
           <span class="ic">${ICONS.file}</span>${esc(i.text)}
         </button>`).join('');
    return `<div class="manuals">${items}</div>`;
  },

  /* ---------- เอกสารประกอบการเบิก ---------- */
  documents(data) {
    const cards = data.groups.map((g) => `
      <article class="doc-card">
        <h3>${esc(g.title)}</h3>
        <ul>
          ${g.items.map((i) => `<li><span class="tick">${ICONS.tick}</span><span>${esc(i)}</span></li>`).join('')}
        </ul>
      </article>`).join('');
    return `<div class="docs">${cards}</div>`;
  },

  /* ---------- ขั้นตอนและช่วงเวลา ---------- */
  timeline(data) {
    const steps = data.steps.map((s) => `
      <div class="tl-step">
        <span class="tl-when">${esc(s.when)}</span>
        <span class="tl-dot"></span>
        <div class="tl-title">${esc(s.title)}</div>
        <div class="tl-desc">${esc(s.desc)}</div>
      </div>`).join('');
    return `<div class="timeline">${steps}</div>`;
  }
};

// ประกอบหัวข้อ + เนื้อหาเป็น <section> เดียว
function renderSection(meta, data) {
  const render = SECTIONS[meta.id];
  if (!render) {
    console.warn(`ไม่มีตัวเรนเดอร์สำหรับหัวข้อ "${meta.id}" — ข้ามไป`);
    return '';
  }

  const subtitle = meta.subtitle ? `<div class="subtitle">${esc(meta.subtitle)}</div>` : '';

  return `<section class="section" id="${esc(meta.id)}">
    <header class="section-head">
      <div class="eyebrow">${esc(meta.eyebrow)}</div>
      <h2>${esc(meta.title)}</h2>
      ${subtitle}
    </header>
    ${render(data)}
  </section>`;
}
