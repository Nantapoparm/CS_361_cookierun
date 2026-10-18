// home.js — ภาพรวมของผู้ขอเบิก (Figma I1 อาจารย์ · T1 TA · S1 นักศึกษาช่วยงาน · ST1 กำลังโหลด)
// Input : GET /current-period, GET /claims, GET /rates และคาบของเดือนที่กำลังเบิก
//         (อาจารย์ / TA: GET /schedule?month= ; นักศึกษาช่วยงาน: GET /work-days?month=)
// Output: การ์ดรอบการเบิก, ชั่วโมงสะสมเทียบเพดาน, สรุปเดือน, แจ้งเตือนคำขอที่ถูกส่งกลับ / ใกล้เพดาน, คำขอล่าสุด

let user;

const statHtml = (n, label) => `<div><b>${esc(n)}</b><span>${esc(label)}</span></div>`;

function renderSkeleton() {
  $('period').innerHTML = skeleton(['w40', 'w80', 'w60']);
  $('cap').innerHTML = skeleton(['w40', '', 'w60', 'lg']);
  $('month').innerHTML = skeleton(['w40', '', 'w60', 'lg']);
  $('rows').innerHTML = `<tr class="empty-row"><td colspan="7">${skeleton(['', '', '', '', ''])}<p class="loading-text">กำลังโหลดข้อมูล…</p></td></tr>`;
}

// ชั่วโมงสะสมเทียบเพดาน: อาจารย์ = รายวิชา (เบิกแล้ว · รอบนี้ · เหลือ) ; TA = ชั่วโมงรอบนี้รายวิชา ; นศ. = รวมทั้งภาคเทียบ Load
function renderCap({ period, claims, rates, courses, round }) {
  const role = user.role, term = `${period.semester}-${be(period.academicYear)}`;
  const max = capOf(rates, role, user.load);
  const rate = rateOf(rates, role).ratePerHour || 0;
  const loadTxt = `${LOAD_TH[user.load] || LOAD_TH.full} · ภาค ${termLabel(term)}`;
  const tag = role === 'instructor' ? `${num(max)} ชม./วิชา/ภาค` : role === 'ta' ? `${num(rate)} บาท/ชม.` : loadTxt;
  let rows;
  if (role === 'instructor') {
    rows = courses.map((c) => {
      const done = claimedHours(claims, { term, role, offeringId: c.offeringId });
      const now = round[c.offeringId] || 0;
      return `<li><div><b>${esc(courseShort(c))}${c.section ? ` · sec ${esc(c.section)}` : ''}</b>
        <small>เบิกแล้ว ${num(done)} · รอบนี้ ${num(now)} · เหลือ ${num(Math.max(0, max - done - now))}</small></div>
        <span class="v"><b>${num(done + now)}</b> / ${num(max)} ชม.</span></li>`;
    });
  } else if (role === 'ta') {
    rows = courses.map((c) => `<li><div><b>${esc(courseShort(c))}</b></div><span class="v"><b>${num(round[c.offeringId] || 0)}</b> ชม.</span></li>`);
  } else {
    const done = claimedHours(claims, { term, role }) + Object.values(round).reduce((s, h) => s + h, 0);
    rows = [`<li><div><b>${esc(loadTxt)}</b></div><span class="v"><b>${num(done)}</b> / ${num(max)} ชม.</span></li>`];
  }
  $('cap').innerHTML = `<div class="card-head"><h3 id="capTitle">ชั่วโมงสะสมเทียบเพดาน</h3><span class="tag">${esc(tag)}</span></div>
    <ul class="cap-list">${rows.join('') || '<li><small>ยังไม่มีรายวิชาในภาคนี้</small></li>'}</ul>`;
}

// สรุปเดือนที่กำลังเบิก (claimMonth)
function renderMonth({ period, claims, rates, items, courses, round }) {
  const r = rateOf(rates, user.role);
  const hours = sumHours(items);
  // นศ.ช่วยงานคิดเงินต่อวันไม่เกิน maxAmountPerDay
  const amount = items.reduce((s, x) => s + Math.min(Number(x.hours) * (r.ratePerHour || 0), r.maxAmountPerDay || Infinity), 0);
  const returned = claims.filter((c) => c.status === 'returned').length;
  const nCourses = courses.filter((c) => round[c.offeringId]).length;
  const stats = user.role === 'student_helper'
    ? [statHtml(items.length, 'วันทำงาน'), statHtml(num(hours), 'ชั่วโมงรวม'), statHtml(num(amount), 'ยอดเบิกโดยประมาณ (บาท)'), statHtml(returned, 'คำขอต้องแก้ไข')]
    : user.role === 'ta'
      ? [statHtml(items.length, `คาบในปฏิทิน (${nCourses} วิชา)`), statHtml(num(hours), 'ชั่วโมงรวม'), statHtml(num(amount), 'ยอดเบิกโดยประมาณ (บาท)'), statHtml(nCourses, 'คำขอ · 1 ใบ / 1 วิชา')]
      : [statHtml(items.length, 'คาบในปฏิทิน'), statHtml(num(hours), 'ชั่วโมงรวม'), statHtml(num(amount), 'ยอดเบิกโดยประมาณ (บาท)'), statHtml(returned, 'คำขอต้องแก้ไข')];
  $('month').innerHTML = `<div class="card-head"><h3 id="monthTitle">สรุปเดือน ${esc(thMonth(period.claimMonth))}</h3></div>
    <div class="rule"></div><div class="stats">${stats.join('')}</div>`;
}

// คำขอที่ถูกส่งกลับ (แดง) และใกล้เพดาน (เหลือง — นับรวมรอบนี้แล้วเหลือไม่ถึง 25%)
function renderAlerts({ period, claims, rates, round }) {
  const out = claims.filter((c) => c.status === 'returned').map((c) => alertHtml('danger',
    `<b>คำขอ #${esc(c.claimId)} (${esc(courseShort(c))} ${esc(thMonth(c.month))}) ถูกส่งกลับแก้ไข</b>${c.returnNote ? ` — “${esc(c.returnNote)}”` : ''}`,
    `<a class="btn danger sm" href="detail.html?id=${encodeURIComponent(c.claimId)}">ดูและแก้ไข</a>`));
  if (!perCourseCap(user.role)) {
    const term = `${period.semester}-${be(period.academicYear)}`;
    const max = capOf(rates, user.role, user.load);
    const left = max - claimedHours(claims, { term, role: user.role }) - Object.values(round).reduce((s, h) => s + h, 0);
    if (max && left < max * 0.25) {
      out.push(alertBox('warn', 'ใกล้เพดาน', `หลังเบิกรอบนี้จะเหลือ ${num(Math.max(0, left))} ชม. ในภาคนี้ (${LOAD_TH[user.load] || LOAD_TH.full} ${num(max)} ชม.) — ระบบจะไม่ให้ยื่นเกินเพดาน`));
    }
  }
  $('alerts').innerHTML = out.join('');
}

function renderRecent(claims) {
  const list = [...claims].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 5);
  $('recent').hidden = !list.length;
  $('rows').innerHTML = list.map((c) => `<tr>
    <td class="id">#${esc(c.claimId)}</td>
    <td data-label="${user.role === 'instructor' ? 'วิชา' : 'รายการ'}">${esc(user.role === 'instructor' ? c.courseId : courseShort(c))}</td>
    <td data-label="งานเดือน">${esc(thMonth(c.month))}</td>
    <td data-label="ชั่วโมง" class="num">${num(c.totalHours)}</td>
    <td data-label="ยอดเบิก (บาท)" class="num">${num(c.totalAmount)}</td>
    <td data-label="สถานะ">${chip(c.status, c.printMethod)}</td>
    <td class="act"><a class="btn ghost sm" href="detail.html?id=${encodeURIComponent(c.claimId)}">เปิด</a></td>
  </tr>`).join('');
}

async function load() {
  $('msg').innerHTML = '';
  renderSkeleton();
  try {
    const period = await api.getCurrentPeriod();
    const student = user.role === 'student_helper';
    const [claims, rates, month] = await Promise.all([
      api.getClaims(), api.getRates(),
      student ? api.getWorkDays(period.claimMonth) : api.getSchedule(period.claimMonth)
    ]);
    // รายการที่จะเบิกในเดือนนี้ (ไม่นับงดสอน) และชั่วโมงต่อวิชา
    const items = student ? month.items : month.periods.filter((x) => x.kind !== 'cancelled').map((x) => ({ ...x, hours: hoursBetween(x.startTime, x.endTime) }));
    const courses = month.courses;
    const round = {};
    items.forEach((x) => { round[x.offeringId] = (round[x.offeringId] || 0) + Number(x.hours); });
    const ctx = { period, claims, rates, items, courses, round };

    $('eyebrow').textContent = `ภาพรวม · ภาคการศึกษาที่ ${period.semester}/${be(period.academicYear)}`;
    $('lead').textContent = `วันนี้ ${thDate(todayIso(), false)}${user.role === 'instructor' && courses.length ? ` · คุณสอน ${courses.length} วิชาในภาคนี้` : ''}`;
    $('btnNew').href = `form.html?month=${period.claimMonth}`;
    $('period').innerHTML = periodCardHtml(period);
    renderCap(ctx);
    renderMonth(ctx);
    renderAlerts(ctx);
    renderRecent(claims);
  } catch (err) {
    ['period', 'cap', 'month', 'alerts', 'rows'].forEach((id) => { $(id).innerHTML = ''; });
    $('recent').hidden = true;
    document.querySelector('.home-cards').hidden = true;
    showErrorState($('msg'), 'โหลดภาพรวมไม่สำเร็จ', err, () => { document.querySelector('.home-cards').hidden = false; $('recent').hidden = false; load(); });
    $('msg').classList.add('card');
  }
}

async function initHome() {
  user = await initPage();
  if (!user) return;
  $('hello').textContent = `สวัสดี ${displayName(user)}`;
  $('btnCal').textContent = user.role === 'instructor' ? 'ดูปฏิทินคาบสอน' : 'ดูปฏิทิน';
  $('thCourse').textContent = user.role === 'instructor' ? 'วิชา' : 'รายการ';
  load();
}

document.addEventListener('DOMContentLoaded', initHome);
