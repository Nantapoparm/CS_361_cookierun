// core.js — เครื่องมือพื้นฐานที่ไฟล์อื่นเรียกใช้: escape, mount, โหลด JSON, ไอคอน
// ต้องโหลดเป็นไฟล์แรกเสมอ

/* ---------- utils ---------- */

// กัน HTML หลุดเข้ามาจากไฟล์ JSON
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

// เขียน html ลง element ที่มี data-mount="ชื่อ"
function mount(name, html) {
  const el = document.querySelector(`[data-mount="${name}"]`);
  if (el) el.innerHTML = html;
  return el;
}

// โหลดไฟล์จากโฟลเดอร์ data/
// ลองทั้งโครงของ repo (data/ อยู่ระดับเดียวกับ frontend/) และโครงตอน deploy (data/ อยู่ข้าง index.html)
async function loadJSON(file) {
  const candidates = [`../data/${file}`, `data/${file}`];
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
// เพิ่มไอคอนใหม่ = เพิ่ม key ที่นี่ แล้วอ้างชื่อ key ในไฟล์ JSON

const ICONS = {
  person: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.5 3.6-5.5 7-5.5s6.2 2 7 5.5"/></svg>',
  people: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="9" cy="8" r="3.1"/><path d="M3 20c.8-3.2 3.2-5 6-5s5.2 1.8 6 5"/><circle cx="17.3" cy="8.7" r="2.3"/><path d="M15.6 14.3c2.5-.5 4.8 1.3 5.4 4.5"/></svg>',
  cap: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.6 21 9l-9 4.4L3 9l9-4.4Z"/><path d="M6.8 11.3v4.1c0 1.6 2.3 2.9 5.2 2.9s5.2-1.3 5.2-2.9v-4.1"/></svg>',
  file: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a1.6 1.6 0 0 0-1.6 1.6v14.8A1.6 1.6 0 0 0 7 21h10a1.6 1.6 0 0 0 1.6-1.6V7.6L14 3Z"/><path d="M13.8 3.2v4.4h4.6"/></svg>',
  info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.6"/><path d="M12 16.3v-4.7M12 8h.01"/></svg>',
  warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.4 21 19.6H3L12 4.4Z"/><path d="M12 10.2v3.9M12 17h.01"/></svg>',
  tick: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#101828" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.6 4.6L19 7.5"/></svg>'
};

// ไอคอนของกล่องหมายเหตุ เลือกตาม tone
const NOTE_ICON = { info: ICONS.info, warning: ICONS.warning, danger: ICONS.warning };

// กล่องหมายเหตุ ใช้ซ้ำได้หลาย section — ใส่ link ใน JSON เพื่อต่อท้ายด้วยลิงก์อ้างอิงได้
function noteBox(note) {
  if (!note || !note.text) return '';
  const tone = note.tone || 'info';
  const label = note.label ? `<b>${esc(note.label)}</b> ` : '';
  const link = note.link
    ? ` <a href="${esc(note.link.url)}" target="_blank" rel="noopener">${esc(note.link.text)}</a>`
    : '';
  return `<div class="note ${tone}">
    <span class="ic">${NOTE_ICON[tone] || ICONS.info}</span>
    <span>${label}${esc(note.text)}${link}</span>
  </div>`;
}
