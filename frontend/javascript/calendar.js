// calendar.js — ปฏิทินคาบสอน (Figma I2 อาจารย์ · I3 แก้ไขคาบ · T2 TA หลายวิชา · ST2 ปฏิทินว่าง) และปฏิทินงาน (S2 นักศึกษาช่วยงาน)
// Input : อาจารย์ / TA → GET /schedule?month=YYYY-MM ; นักศึกษาช่วยงาน → GET /work-days?month=YYYY-MM
// Output: ปฏิทินเดือน / สัปดาห์ (มือถือแสดงเป็นรายการรายวัน), กล่องสรุปเดือนนี้ที่ใช้ autofill คำขอ
// เพิ่ม/แก้คาบ → POST /schedule body = { courseId, sessionId, startTime, endTime (ISO 8601), room, description, repeatUntil? }
//              description = ประเภทคาบ regular | cancelled | makeup (teaching_histories ไม่มีคอลัมน์ kind)
//              PUT /schedule/{id} (ช่องเดียวกัน ไม่มี repeatUntil) · DELETE /schedule/{id}
// วันทำงาน   → POST /work-days · PUT /work-days/{id} · DELETE /work-days/{id} (ลงเวลาวันนี้ใช้ route เดียวกัน)

let user, period, rates = [];
let view = 'month';
let month;          // เดือนที่แสดง 'YYYY-MM'
let weekStart;      // วันจันทร์ของสัปดาห์ที่แสดง (Date)
const cache = {};   // month → ข้อมูลของเดือน
const student = () => user.role === 'student_helper';

/* ---------- ข้อมูล ---------- */

async function fetchMonth(ym, force = false) {
  if (!cache[ym] || force) cache[ym] = student() ? await api.getWorkDays(ym) : await api.getSchedule(ym);
  return cache[ym];
}
// เหตุการณ์ของช่วงวันที่ที่แสดง (สัปดาห์อาจคร่อม 2 เดือน)
function eventsOf(data) {
  return student()
    ? data.items.map((w) => ({ ...w, id: w.workId, date: w.workDate, kind: 'work' }))
    : data.periods.map((p) => ({ ...p, id: p.historyId }));
}
let events = [], courses = [];

async function load(force = false) {
  $('msg').innerHTML = '';
  $('cal').innerHTML = `<div class="cal-loading">${skeleton(['w40', '', '', 'lg', 'lg'])}<p class="loading-text">กำลังโหลดปฏิทิน…</p></div>`;
  try {
    const months = view === 'week' ? [...new Set(weekDays().map((d) => d.slice(0, 7)))] : [month];
    const list = await Promise.all(months.map((m) => fetchMonth(m, force)));
    events = list.flatMap(eventsOf);
    courses = list.find((d) => d.courses?.length)?.courses || courses;
    render();
  } catch (err) {
    $('cal').innerHTML = '';
    showErrorState($('cal'), 'โหลดปฏิทินไม่สำเร็จ', err, () => load(true));
  }
}

/* ---------- ช่วงวันที่ ---------- */

const mondayOf = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
function monthDays() {
  const first = parseMonth(month), start = mondayOf(first), out = [];
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  for (const d = new Date(start); d <= last || d.getDay() !== 1; d.setDate(d.getDate() + 1)) out.push(isoDate(d));
  return out;
}
function weekDays() {
  const out = [];
  for (let i = 0; i < 7; i++) { const d = new Date(weekStart); d.setDate(d.getDate() + i); out.push(isoDate(d)); }
  return out;
}

/* ---------- วาดปฏิทิน ---------- */

// สีประจำวิชาของ TA (หลายวิชา) ; อาจารย์ใช้สีตามประเภทคาบ
const courseIdx = (e) => Math.max(0, courses.findIndex((c) => sameOffering(c, e)));
const shortName = (s) => String(s || '').replace(/^(ศ\.|รศ\.|ผศ\.|อ\.)?(ดร\.)?/, (m) => (m ? 'อ.' : '')).replace(/\s.*$/, '');

function evHtml(e) {
  const t = timeRange(e.startTime, e.endTime);
  const attrs = `type="button" data-id="${esc(e.id)}"`;
  if (e.kind === 'work') {
    return `<button ${attrs} class="ev"><b>${esc((e.courseName || 'งาน').split(' ')[0])}</b>${esc(t)} · ${num(e.hours)} ชม.</button>`;
  }
  if (e.kind === 'cancelled') {
    return `<button ${attrs} class="ev off"><b>${esc(e.description ? 'งดการเรียนการสอน' : 'งดสอน')}</b>${esc(e.description || courseSec(e))}
      <span class="orig">${esc(courseSec(e))} ${esc(t)}</span></button>`;
  }
  if (e.kind === 'makeup') {
    return `<button ${attrs} class="ev makeup"><b>สอนชดเชย ${esc(courseShort(e))}</b>${esc(t)}${e.room ? ` · ${esc(e.room)}` : ''}
      <a class="ev-link" href="makeup.html?month=${esc(e.date.slice(0, 7))}&makeup=${esc(e.id)}">แบบฟอร์ม →</a></button>`;
  }
  const who = user.role === 'ta' && e.instructorName ? ` · ${shortName(e.instructorName)}` : (e.room ? ` · ${e.room}` : '');
  const color = user.role === 'ta' ? ` c${courseIdx(e) % 3}` : '';
  return `<button ${attrs} class="ev${color}"><b>${esc(courseSec(e))}</b>${esc(t)}${esc(who)}${e.kind === 'regular' && e.description ? `<span class="orig">${esc(e.description)}</span>` : ''}</button>`;
}

function render() {
  $('title').textContent = view === 'month' ? thMonthLong(month) : weekTitle();
  const days = view === 'month' ? monthDays() : weekDays();
  const byDay = {};
  events.forEach((e) => (byDay[e.date] ||= []).push(e));
  const today = todayIso();

  if (!events.length && !courses.length) {
    renderEmpty();
  } else {
    const head = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'].map((d) => `<div class="cal-dow">${d}</div>`).join('');
    const cells = days.map((d) => {
      const out = view === 'month' && d.slice(0, 7) !== month;
      return `<div class="cal-cell${out ? ' out' : ''}${d === today ? ' today' : ''}" data-date="${d}">
        <span class="cal-num">${parseDay(d).getDate()}</span>
        ${(byDay[d] || []).map(evHtml).join('')}
      </div>`;
    }).join('');
    // มือถือ: รายการรายวันเฉพาะวันที่มีคาบ (และวันนี้)
    const listDays = days.filter((d) => (view === 'week' || d.slice(0, 7) === month) && (byDay[d] || d === today));
    const list = listDays.map((d) => `<li class="cal-day${d === today ? ' today' : ''}" data-date="${d}">
        <div class="cal-day-h"><b>${esc(thDate(d))}</b>${d === today ? '<span class="tag">วันนี้</span>' : ''}</div>
        ${(byDay[d] || []).map(evHtml).join('') || '<p class="cal-none">ยังไม่มีรายการ</p>'}
        <button type="button" class="cal-add" data-add="${d}">+ เพิ่มในวันนี้</button>
      </li>`).join('') || `<li class="cal-none">เดือนนี้ยังไม่มีรายการ</li>`;
    $('cal').innerHTML = `<div class="cal-grid ${view}">${head}${cells}</div><ul class="cal-list">${list}</ul>`;
  }
  renderSide();
}

function weekTitle() {
  const d = weekDays();
  const a = parseDay(d[0]), b = parseDay(d[6]);
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()}–${b.getDate()} ${TH_MONTH[b.getMonth()]} ${be(b.getFullYear())}`
    : `${a.getDate()} ${TH_MON[a.getMonth()]} – ${b.getDate()} ${TH_MON[b.getMonth()]} ${be(b.getFullYear())}`;
}

// ST2 — ยังไม่มีคาบ (และไม่รู้รายวิชา): ให้เพิ่มคาบแรกแล้วติ๊กทุกสัปดาห์
function renderEmpty() {
  const what = student() ? 'วันทำงาน' : 'คาบสอน';
  $('cal').innerHTML = `<div class="state"><span class="ic" aria-hidden="true">📅</span>
    <h3>ยังไม่มี${what}ในปฏิทิน</h3>
    <p>${student() ? 'เพิ่มวันทำงานหรือลงเวลาวันนี้ ระบบจะรวมชั่วโมงให้ตอนสร้างคำขอ' : 'เพิ่มคาบแรกของแต่ละวิชาแล้วติ๊ก “ใช้กับทุกสัปดาห์ถัดไปในภาค” ระบบจะสร้างคาบรายสัปดาห์ให้ทั้งภาค'}</p>
    <button type="button" class="btn" data-add="${todayIso()}">+ เพิ่ม${what}เอง</button></div>`;
}

/* ---------- กล่องด้านข้าง ---------- */

function usualSlot(c) {
  const wd = c.weekdays?.length ? c.weekdays : [...new Set(events.filter((e) => e.kind === 'regular' && sameOffering(e, c)).map((e) => parseDay(e.date).getDay()))];
  const any = events.find((e) => sameOffering(e, c) && e.kind !== 'cancelled');
  const t = c.startTime ? timeRange(c.startTime, c.endTime) : any ? timeRange(any.startTime, any.endTime) : '';
  return [wd.map((d) => TH_DAY[d]).join('/'), t].filter(Boolean).join(' ');
}

function renderSide() {
  // สรุปเฉพาะเดือนที่แสดง (คาบที่ไม่ใช่งดสอน)
  const ym = view === 'month' ? month : weekDays()[3].slice(0, 7);
  const inMonth = (cache[ym] ? eventsOf(cache[ym]) : events).filter((e) => e.date.startsWith(ym) && e.kind !== 'cancelled');
  const sumOf = (c) => {
    const list = inMonth.filter((e) => sameOffering(e, c));
    return { n: list.length, h: sumHours(list.map((e) => ({ hours: e.hours ?? hoursBetween(e.startTime, e.endTime) }))) };
  };
  const unit = student() ? 'วัน' : 'คาบ';
  const rows = courses.map((c) => {
    const s = sumOf(c);
    const sub = student()
      ? [usualSlot(c), c.instructorName ? `ผู้ดูแล ${c.instructorName}` : ''].filter(Boolean).join(' · ')
      : [c.section ? `sec ${c.section}` : '', user.role === 'ta' ? shortName(c.instructorName) : TYPE_TH[c.type]?.replace('ภาค', ''), usualSlot(c)].filter(Boolean).join(' · ');
    return `<li><b>${esc(student() ? c.courseName : user.role === 'ta' ? courseShort(c) : courseFull(c))}</b>
      <small>${esc(sub)}</small><span class="tag">${s.n} ${unit} · ${num(s.h)} ชม.</span></li>`;
  }).join('');
  const nCourses = courses.length;
  const summary = `<section class="card side-sum">
    <h3>สรุปเดือนนี้${user.role === 'ta' && nCourses > 1 ? ` (${nCourses} วิชา)` : ''}</h3>
    ${student() ? '' : '<p class="muted">ข้อมูลที่จะใช้ autofill คำขอ</p>'}
    <ul class="side-courses">${rows || '<li><small>ยังไม่มีรายวิชา</small></li>'}</ul>
    ${student() ? '' : `<a class="btn block" href="form.html?month=${esc(ym)}">สร้างคำขอจากเดือนนี้</a>
    ${user.role === 'ta' ? '<p class="muted center">ระบบสร้างให้ 1 ใบต่อวิชา</p>' : ''}`}
  </section>`;

  let extra = '';
  if (user.role === 'instructor') {
    extra = `<ul class="cal-key">
      <li><i class="k reg"></i>คาบตามตาราง</li><li><i class="k mk"></i>สอนชดเชย / เพิ่มเอง</li><li><i class="k off"></i>วันหยุด / งดสอน (ไม่นับ)</li></ul>`;
  } else if (user.role === 'ta') {
    const cap = capOf(rates, 'ta', user.load);
    extra = alertHtml('warn', `คาบของ TA <b>ดึงจากทุกวิชาที่ได้รับมอบหมายตามตารางสอนของอาจารย์แต่ละวิชา</b> — เพิ่มชั่วโมงตรวจงาน/คุมสอบได้เอง · เพดาน ${num(cap)} ชม. นับรวมทุกวิชา`);
  } else {
    extra = clockCard();
  }
  $('side').innerHTML = summary + extra;
  if (student()) bindClock();

  // ป้ายสีวิชาของ TA บนหัวหน้า
  $('legend').hidden = user.role !== 'ta' || !courses.length;
  $('legend').innerHTML = courses.map((c, i) => `<span><i class="k c${i % 3}"></i>${esc(courseShort(c))}</span>`).join('');
}

/* ---------- ลงเวลาวันนี้ (S2) ---------- */

function clockCard() {
  const today = todayIso();
  const w = events.find((e) => e.date === today);
  const c = courses[0] || {};
  const r = rateOf(rates, 'student_helper');
  return `<section class="card clock">
    <h3>ลงเวลาวันนี้</h3>
    <p class="muted">${esc(thDate(today))}</p>
    <div class="clock-row">
      <div class="field"><label for="cIn">เข้า</label><input type="time" id="cIn" value="${esc(w?.startTime || c.startTime || '')}"></div>
      <div class="field"><label for="cOut">ออก</label><input type="time" id="cOut" value="${esc(w?.endTime || c.endTime || '')}"></div>
    </div>
    <button type="button" class="btn block" id="cSave">${w ? 'แก้เวลาวันนี้' : 'บันทึกเวลา'}</button>
    ${r.ratePerHour ? `<p class="muted">คิดชั่วโมงละ ${num(r.ratePerHour)} บาท${r.maxAmountPerDay ? ` ไม่เกิน ${num(r.maxAmountPerDay)} บาท/วัน` : ''}</p>` : ''}
  </section>`;
}

function bindClock() {
  $('cSave')?.addEventListener('click', async () => {
    const today = todayIso();
    const w = events.find((e) => e.date === today);
    const c = courses[0];
    const body = { offeringId: w?.offeringId ?? c?.offeringId, workDate: today, startTime: $('cIn').value, endTime: $('cOut').value, Remark: w?.Remark || '' };
    if (!body.startTime || !body.endTime || hoursBetween(body.startTime, body.endTime) <= 0) { toast('กรุณาใส่เวลาเข้าและออกให้ถูกต้อง', true); return; }
    $('cSave').disabled = true;
    try {
      if (w) await api.updateWorkDay(w.id, body); else await api.createWorkDay(body);
      toast(`บันทึกเวลา ${timeRange(body.startTime, body.endTime)} แล้ว`);
      await load(true);
    } catch (err) { toast(errorText(err), true); $('cSave').disabled = false; }
  });
}

/* ---------- Modal เพิ่ม / แก้ไข ---------- */

// วันสุดท้ายของภาคโดยประมาณ (DB ไม่มีวันเริ่ม/จบภาค ผู้ใช้แก้ได้): ภาค 1 = 15 ธ.ค., ภาค 2 = 15 พ.ค., ฤดูร้อน = 31 ก.ค.
function termEndGuess() {
  const y = (period?.academicYear || be(new Date().getFullYear())) - 543;
  return { 1: `${y}-12-15`, 2: `${y + 1}-05-15`, 3: `${y + 1}-07-31` }[period?.semester || 1];
}

const radio = (name, value, label, checked) => `<label class="opt"><input type="radio" name="${name}" value="${value}"${checked ? ' checked' : ''}> ${esc(label)}</label>`;

function periodForm(e, date) {
  const isNew = !e;
  const kind = e?.kind || (user.role === 'instructor' && date ? 'makeup' : 'regular');
  const ci = e ? courseIdx(e) : 0;
  const c = courses[ci] || {};
  return `<div class="form-2">
    <div class="field"><label for="fCourse">วิชา</label>
      <select id="fCourse">${courses.map((x, i) => `<option value="${i}"${i === ci ? ' selected' : ''}>${esc(user.role === 'ta' ? courseSec(x) : courseFull(x))}</option>`).join('')}</select></div>
    <div class="field sys"><label for="fSec">Section</label><input id="fSec" value="${esc(c.section || '-')}" readonly></div>
    <div class="field full"><label for="fRoom">ห้อง</label><input id="fRoom" value="${esc(e?.room ?? c.room ?? '')}" maxlength="50"></div>
    <div class="field"><label for="fDate">วันที่</label><input type="date" id="fDate" value="${esc(e?.date || date || todayIso())}" required></div>
    <div class="field"><span class="lbl">เวลา</span>
      <div class="time2"><input type="time" id="fStart" aria-label="เวลาเริ่ม" value="${esc(e?.startTime || c.startTime || '09:00')}"><span>–</span><input type="time" id="fEnd" aria-label="เวลาสิ้นสุด" value="${esc(e?.endTime || c.endTime || '12:00')}"></div>
      <span class="hint" id="fHours"></span></div>
    <div class="field full"><span class="lbl">ประเภทคาบ</span>
      <div class="opts">${radio('fKind', 'regular', 'ตามตาราง', kind === 'regular')}${radio('fKind', 'makeup', 'สอนชดเชย', kind === 'makeup')}${radio('fKind', 'cancelled', 'งดสอน (ไม่นับชั่วโมง)', kind === 'cancelled')}</div></div>
    ${isNew ? `<div class="field full repeat">
      <label class="check"><input type="checkbox" id="fRepeat"> ใช้กับคาบนี้และทุกสัปดาห์ถัดไปในภาค</label>
      <div class="repeat-until" hidden><label for="fUntil">ถึงวันที่</label><input type="date" id="fUntil" value="${esc(termEndGuess())}">
        <span class="hint">ระบบสร้างคาบวันและเวลาเดียวกันทุก 7 วันจนถึงวันนี้</span></div></div>` : ''}
  </div>`;
}

function workForm(e, date) {
  const ci = e ? courseIdx(e) : 0;
  const c = courses[ci] || {};
  return `<div class="form-2">
    <div class="field full"><label for="fCourse">งาน</label>
      <select id="fCourse">${courses.map((x, i) => `<option value="${i}"${i === ci ? ' selected' : ''}>${esc(x.courseName)}</option>`).join('')}</select></div>
    <div class="field"><label for="fDate">วันที่</label><input type="date" id="fDate" value="${esc(e?.date || date || todayIso())}"></div>
    <div class="field"><span class="lbl">เวลาเข้า – ออก</span>
      <div class="time2"><input type="time" id="fStart" aria-label="เวลาเข้า" value="${esc(e?.startTime || c.startTime || '13:00')}"><span>–</span><input type="time" id="fEnd" aria-label="เวลาออก" value="${esc(e?.endTime || c.endTime || '17:00')}"></div>
      <span class="hint" id="fHours"></span></div>
    <div class="field full"><label for="fDesc">หมายเหตุ (พิมพ์ลงแบบฟอร์ม ไม่เกิน 50 ตัวอักษร)</label>
      <input id="fDesc" maxlength="50" value="${esc(e?.Remark || '')}"></div>
  </div>`;
}

async function openEditor(e, date) {
  if (!courses.length) { toast('ยังไม่พบรายวิชาของภาคนี้ กรุณาติดต่อเจ้าหน้าที่', true); return; }
  const isNew = !e;
  const c0 = e || courses[0];
  const what = student() ? 'วันทำงาน' : 'คาบสอน';
  const res = await openModal({
    wide: true,
    eyebrow: `${isNew ? 'เพิ่ม' : 'แก้ไข'}${what}`,
    title: `${student() ? c0.courseName?.split(' ')[0] || 'งาน' : courseShort(c0)} · ${thDateLong(e?.date || date || todayIso())}`,
    body: student() ? workForm(e, date) : periodForm(e, date),
    okText: 'บันทึก',
    extra: isNew ? null : { text: student() ? 'ลบวันนี้' : 'ลบคาบนี้' },
    onOpen: (el) => {
      const q = (s) => el.querySelector(s);
      const hours = () => { const h = hoursBetween(q('#fStart').value, q('#fEnd').value); q('#fHours').textContent = h > 0 ? `ระบบคำนวณ ${num(h)} ชั่วโมง` : 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม'; };
      ['#fStart', '#fEnd'].forEach((s) => q(s).addEventListener('input', hours));
      hours();
      q('#fCourse').addEventListener('change', () => {
        const c = courses[q('#fCourse').value];
        if (q('#fSec')) q('#fSec').value = c.section || '-';
        if (q('#fRoom') && !q('#fRoom').value) q('#fRoom').value = c.room || '';
      });
      q('#fRepeat')?.addEventListener('change', () => { q('.repeat-until').hidden = !q('#fRepeat').checked; });
      // "ทุกสัปดาห์" ใช้ได้เฉพาะคาบตามตาราง (งดสอน / ชดเชย เป็นรายคาบ)
      const syncRepeat = () => { if (q('.repeat')) q('.repeat').hidden = el.querySelector('input[name="fKind"]:checked')?.value !== 'regular'; };
      el.querySelectorAll('input[name="fKind"]').forEach((r) => r.addEventListener('change', syncRepeat));
      syncRepeat();
    },
    onOk: async (el) => {
      const q = (s) => el.querySelector(s);
      const c = courses[q('#fCourse').value];
      const d = q('#fDate').value, a = q('#fStart').value, b = q('#fEnd').value;
      if (!d) throw new Error('กรุณาเลือกวันที่');
      if (hoursBetween(a, b) <= 0) throw new Error('เวลาสิ้นสุดต้องหลังเวลาเริ่ม');
      if (student()) {
        const body = { offeringId: c.offeringId, workDate: d, startTime: a, endTime: b, Remark: q('#fDesc').value.trim() };
        try { if (isNew) await api.createWorkDay(body); else await api.updateWorkDay(e.id, body); } catch (err) { throw new Error(errorText(err)); }
      } else {
        // ตรงกับคอลัมน์ของ teaching_histories: ประเภทคาบ (regular / cancelled / makeup) เก็บในคอลัมน์ description
        const body = {
          courseId: c.courseId,
          // session (โครงการ) ของวิชา จาก courses ใน GET /schedule — teaching_histories.sessionId บังคับมีค่า
          ...(c.sessionId != null ? { sessionId: c.sessionId } : e?.sessionId != null ? { sessionId: e.sessionId } : {}),
          startTime: `${d}T${a}:00`,
          endTime: `${d}T${b}:00`,
          room: q('#fRoom').value.trim(),
          description: el.querySelector('input[name="fKind"]:checked').value
        };
        if (isNew && body.description === 'regular' && q('#fRepeat')?.checked) {
          if (!q('#fUntil').value || q('#fUntil').value < d) throw new Error('วันที่สิ้นสุดต้องไม่ก่อนวันของคาบแรก');
          body.repeatUntil = q('#fUntil').value;
        }
        try { if (isNew) await api.createSchedule(body); else await api.updateSchedule(e.id, body); } catch (err) { throw new Error(errorText(err)); }
      }
    }
  });
  if (res === true) { toast(isNew ? `เพิ่ม${what}แล้ว` : `บันทึก${what}แล้ว`); clearCache(); load(true); }
  if (res === 'extra') removeEvent(e);
}

async function removeEvent(e) {
  const what = student() ? 'วันทำงาน' : 'คาบ';
  const ok = await openModal({
    title: `ลบ${what}นี้?`,
    lead: `${student() ? e.courseName : courseSec(e)} · ${thDateLong(e.date)} ${timeRange(e.startTime, e.endTime)} — ถ้าต้องการไม่นับชั่วโมงแต่ยังเก็บไว้เป็นหลักฐาน ให้เลือก “งดสอน” แทน`,
    okText: 'ลบ',
    okClass: 'danger',
    onOk: async () => {
      try { if (student()) await api.deleteWorkDay(e.id); else await api.deleteSchedule(e.id); } catch (err) { throw new Error(errorText(err)); }
    }
  });
  if (ok) { toast(`ลบ${what}แล้ว`); clearCache(); load(true); }
}

const clearCache = () => Object.keys(cache).forEach((k) => delete cache[k]);

/* ---------- เริ่มหน้า ---------- */

function setView(v) {
  view = v;
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  if (v === 'week') {
    const t = new Date();
    weekStart = mondayOf(isoMonth(t) === month ? t : parseMonth(month));
  }
  load();
}

function step(n) {
  if (view === 'month') month = addMonths(month, n);
  else { weekStart.setDate(weekStart.getDate() + 7 * n); month = isoDate(new Date(weekStart.getTime() + 3 * 86400000)).slice(0, 7); }
  history.replaceState(null, '', `?month=${month}`);
  load();
}

async function initCalendar() {
  user = await initPage();
  if (!user) return;
  const qm = new URLSearchParams(location.search).get('month');
  month = /^\d{4}-\d{2}$/.test(qm || '') ? qm : isoMonth(new Date());
  weekStart = mondayOf(new Date());

  const role = user.role;
  $('eyebrow').textContent = role === 'student_helper' ? 'ปฏิทินงาน' : `ปฏิทินคาบสอน (${role === 'ta' ? 'TA' : 'อาจารย์'})`;
  $('lead').textContent = { instructor: 'คลิกคาบเพื่อแก้ไข · คลิกช่องว่างเพื่อเพิ่มคาบสอนชดเชย', ta: 'คาบ Lab ดึงจากรายวิชาที่ได้รับมอบหมาย · คลิกช่องว่างเพื่อเพิ่มชั่วโมง', student_helper: 'บันทึกชั่วโมงทำงานรายวัน' }[role];
  $('btnAdd').textContent = { instructor: '+ เพิ่มคาบสอน', ta: '+ เพิ่มชั่วโมง', student_helper: '+ เพิ่มวันทำงาน' }[role];
  $('btnMakeup').hidden = role !== 'instructor';
  $('btnMakeup').href = `makeup.html?month=${month}`;

  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('prev').addEventListener('click', () => step(-1));
  $('next').addEventListener('click', () => step(1));
  $('today').addEventListener('click', () => { month = isoMonth(new Date()); weekStart = mondayOf(new Date()); history.replaceState(null, '', `?month=${month}`); load(); });
  $('btnAdd').addEventListener('click', () => openEditor(null, null));

  // คลิกคาบ = แก้ไข ; คลิกช่องว่างของวัน / ปุ่ม + = เพิ่ม (ลิงก์ "แบบฟอร์ม →" ไปหน้าสอนชดเชย)
  $('cal').addEventListener('click', (ev) => {
    if (ev.target.closest('a')) return;
    const b = ev.target.closest('.ev');
    if (b) { const e = events.find((x) => String(x.id) === b.dataset.id); if (e) openEditor(e); return; }
    const add = ev.target.closest('[data-add]');
    if (add) { openEditor(null, add.dataset.add); return; }
    const cell = ev.target.closest('.cal-cell:not(.out)');
    if (cell) openEditor(null, cell.dataset.date);
  });

  try { [period, rates] = await Promise.all([api.getCurrentPeriod(), api.getRates()]); } catch (err) { console.warn(err); }
  load();
}

document.addEventListener('DOMContentLoaded', initCalendar);
