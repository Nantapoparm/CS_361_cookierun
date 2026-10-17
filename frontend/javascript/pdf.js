// pdf.js — ตัวอย่างเอกสารตามแบบฟอร์มจริง (Figma I5 อาจารย์ · T4 TA · I17 ขอสอนชดเชย · แบบฟอร์มเปล่านักศึกษาช่วยงาน)
// API จริง: GET /claims/{id}/pdf?type= คืน downloadUrl (Presigned URL ของ PDF จาก Lambda V3-09) → แสดงใน iframe
// mock / ยังไม่มี Lambda: downloadUrl = null → วาดแบบฟอร์มเป็น HTML ด้วยฟังก์ชันในไฟล์นี้ (ข้อมูลชุดเดียวกับที่ส่งให้ Lambda)
// ต้องโหลดหลัง ui.js และ api.js

const DOC_ORG = ['โครงการปริญญาตรีภาคพิเศษ สาขาวิชาวิทยาการคอมพิวเตอร์', 'คณะวิทยาศาสตร์และเทคโนโลยี', 'มหาวิทยาลัยธรรมศาสตร์'];
const docDate = (s) => { const d = parseDay(s); return `${d.getDate()} ${TH_MON[d.getMonth()]} ${be(d.getFullYear())}`; };
const docTime = (a, b) => `${hhmm(a).replace(':', '.')}–${hhmm(b).replace(':', '.')} น.`;
const fullName = (u) => `${u?.name || ''} ${u?.lastName || ''}`.trim() || u?.username || '';
const blank = (v, w = '') => `<span class="fill${w ? ' ' + w : ''}">${v ? esc(v) : '&nbsp;'}</span>`;

// ชื่อไฟล์: CS262_ก.ย.2569_สมชาย.pdf
function docFileName(c, u, prefix = '') {
  const m = parseMonth(c.month);
  return `${prefix}${courseShort(c).replace(/\s+/g, '')}_${TH_MON[m.getMonth()]}${be(m.getFullYear())}_${u?.name || 'ผู้ขอ'}.pdf`;
}

const docHead = () => `<div class="doc-head"><img src="assets/logo.png" alt="" class="doc-logo">${DOC_ORG.map((t) => `<div>${esc(t)}</div>`).join('')}</div>`;

// ใบลงลายมือชื่อ อาจารย์ / TA (เติมข้อมูลจากคำขอ)
function claimDocHtml(c, u) {
  const ta = c.role === 'ta';
  const items = [...(c.items || [])].sort((a, b) => a.workDate.localeCompare(b.workDate));
  const rows = items.map((x) => `<tr><td class="fillc">${esc(docDate(x.workDate))}</td><td class="fillc">${esc(docTime(x.startTime, x.endTime))}</td><td></td><td class="fillc note">${esc(x.Remark || '')}</td></tr>`);
  for (let i = rows.length; i < 8; i++) rows.push('<tr><td></td><td></td><td></td><td></td></tr>');
  const m = parseMonth(c.month);
  return `<div class="doc">
    ${docHead()}
    <table class="doc-info">
      <tr><th>การศึกษาขั้นปริญญาตรี</th><td>${blank(`ภาคการศึกษาที่ ${c.semester} ปีการศึกษา ${be(c.academicYear)}`)}</td></tr>
      <tr><th>ผู้บรรยายลักษณะวิชา</th><td>${blank(courseFull(c))}</td></tr>
      ${ta ? '' : `<tr><th></th><td><span class="box">${c.type !== 'lab' ? '☑' : '☐'}</span> ภาคทฤษฎี <span class="box">${c.type === 'lab' ? '☑' : '☐'}</span> ภาคปฏิบัติ</td></tr>`}
      <tr><th>${ta ? 'ชื่อผู้ช่วยสอน' : 'ชื่อผู้บรรยาย'}</th><td>${blank(fullName(u))}</td></tr>
      <tr><th>ประจำเดือน</th><td>${blank(`${TH_MONTH[m.getMonth()]} พ.ศ. ${be(m.getFullYear())}${!ta && c.room ? ` ${c.room}` : ''}`)}</td></tr>
    </table>
    <table class="doc-table">
      <thead><tr><th>วัน/เดือน/ปี</th><th>เวลาปฏิบัติงาน</th><th>${ta ? 'ลายเซ็นผู้ช่วยสอน' : 'ลายเซ็นผู้สอน'}</th><th>หมายเหตุ</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
    <p class="doc-note">** ใช้ลายมือในการเขียนด้วยปากกาน้ำเงินเท่านั้น${ta ? '' : 'ในช่องลายเซ็น'}</p>
    <p class="doc-total">รวมเวลาปฏิบัติงาน ${blank(num(sumHours(items)), 'short')} ชั่วโมง</p>
    <div class="doc-sign">
      ${ta ? `<div>( ${blank(c.instructorName || '')} )</div><div>อาจารย์ผู้สอนรายวิชา / ${esc(OFFICE.directorTitle)}</div>`
           : `<div>(${esc(OFFICE.director)})</div><div>${esc(OFFICE.directorTitle)}</div>`}
    </div>
  </div>`;
}

// แบบฟอร์มเปล่าของนักศึกษาช่วยงาน (เจ้าหน้าที่กำหนดให้กรอกด้วยลายมือ)
function blankDocHtml() {
  const rows = Array.from({ length: 12 }, () => '<tr><td></td><td></td><td></td><td></td><td></td></tr>').join('');
  return `<div class="doc">
    ${docHead()}
    <h4 class="doc-title">แบบบันทึกเวลาปฏิบัติงานนักศึกษาช่วยงาน</h4>
    <table class="doc-info">
      <tr><th>ชื่อ–นามสกุล</th><td>${blank('')}</td></tr>
      <tr><th>เลขทะเบียนนักศึกษา</th><td>${blank('')}</td></tr>
      <tr><th>ประจำเดือน</th><td>${blank('')}</td></tr>
    </table>
    <table class="doc-table five">
      <thead><tr><th>วัน/เดือน/ปี</th><th>เวลาเข้า</th><th>เวลาออก</th><th>ลายเซ็น</th><th>ผู้ควบคุม</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="doc-note">** กรอกด้วยลายมือ ปากกาน้ำเงินเท่านั้น</p>
    <p class="doc-total">รวมเวลาปฏิบัติงาน ${blank('', 'short')} ชั่วโมง</p>
    <div class="doc-sign"><div>( ${blank('')} )</div><div>ผู้ควบคุมการปฏิบัติงาน</div></div>
  </div>`;
}

// แบบฟอร์มขอสอนชดเชย: f = { docDate, user, course:{courseId, courseName, section}, semester, academicYear,
//   kind:'makeup'|'other', from:{date, startTime, endTime}, to:{date, startTime, endTime, room}, reason }
function makeupDocHtml(f) {
  const dmy = (s) => { if (!s) return ['', '', '']; const d = parseDay(s); return [d.getDate(), TH_MON[d.getMonth()], be(d.getFullYear())]; };
  const [fd, fm, fy] = dmy(f.from?.date), [td, tm, ty] = dmy(f.to?.date);
  const doc = f.docDate ? parseDay(f.docDate) : new Date();
  return `<div class="doc makeup">
    <h4 class="doc-title">แบบฟอร์มขอสอนชดเชย</h4>
    <p class="doc-right">วันที่ ${blank(`${doc.getDate()} ${TH_MONTH[doc.getMonth()]} ${be(doc.getFullYear())}`)}</p>
    <p><b>เรียน</b> ${esc(OFFICE.directorTitle)}</p>
    <p class="ind">ด้วยข้าพเจ้า ${blank(fullName(f.user))} อาจารย์ผู้สอนวิชา ${blank(f.course?.courseId, 'short')}</p>
    <p class="center">${blank(`${f.course?.courseName || ''}${f.course?.section ? ` · Section ${f.course.section}` : ''}`, 'wide')}</p>
    <p>ประจำภาคเรียน ${blank(f.semester, 'short')} ปีการศึกษา ${blank(be(f.academicYear || 0) || '', 'short')} มีความประสงค์</p>
    <p class="ind"><span class="box">${f.kind !== 'other' ? '☑' : '☐'}</span> <b>ขอสอนชดเชย / เปลี่ยนแปลงวันสอนจากวันที่</b> ${blank(fd, 'tiny')} เดือน ${blank(fm, 'tiny')} พ.ศ. ${blank(fy, 'tiny')} เวลา ${blank(f.from ? docTime(f.from.startTime, f.from.endTime) : '', 'short')}</p>
    <p class="ind2">เป็นวันที่ ${blank(td, 'tiny')} เดือน ${blank(tm, 'tiny')} พ.ศ. ${blank(ty, 'tiny')} เวลา ${blank(f.to ? docTime(f.to.startTime, f.to.endTime) : '', 'short')}</p>
    <p class="ind"><span class="box">${f.kind === 'other' ? '☑' : '☐'}</span> อื่น ๆ ${blank('', 'wide')}</p>
    <p class="ind2">เนื่องจาก ${blank(f.reason || '', 'wide')}</p>
    ${f.to?.room ? `<p class="center">${blank(`สอนชดเชยที่ห้อง ${f.to.room} ตามเวลาเรียนเดิม ${num(hoursBetween(f.to.startTime, f.to.endTime))} ชั่วโมง`, 'wide')}</p>` : ''}
    <p class="line"></p><p class="line"></p>
    <p class="ind doc-gap">จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติ จักขอบคุณยิ่ง</p>
    <div class="doc-sign right"><div>ลงชื่อ ${blank('')}</div><div>( ${blank(fullName(f.user))} )</div></div>
  </div>`;
}

// กรอบสีเทาเข้มรอบเอกสาร + แถบชื่อไฟล์ ; url = Presigned URL (มี = แสดง PDF จริง)
function pdfFrameHtml(fileName, innerHtml, url) {
  return `<div class="pdf-frame">
    <div class="pdf-bar"><span>${esc(fileName)}</span><span>หน้า 1 / 1 · 100%</span></div>
    ${url ? `<iframe class="pdf-real" src="${esc(url)}" title="${esc(fileName)}"></iframe>` : `<div class="paper">${innerHtml}</div>`}
  </div>`;
}

// ST6 — สร้าง PDF ไม่สำเร็จ
function pdfErrorHtml(retryId) {
  return `<div class="pdf-frame err"><div class="state error card"><span class="ic" aria-hidden="true">!</span>
    <h3>สร้างไฟล์ PDF ไม่สำเร็จ</h3><p>ข้อมูลคำขอบันทึกเป็นร่างแล้ว · ลองสร้างตัวอย่างอีกครั้ง</p>
    <button type="button" class="btn" id="${esc(retryId)}">ลองอีกครั้ง</button></div></div>`;
}

// ดาวน์โหลด / พิมพ์: มี downloadUrl → เปิดไฟล์จริง ; ไม่มี (mock) → พิมพ์แบบฟอร์ม HTML (เลือก "บันทึกเป็น PDF" ได้)
function openDoc(url, html, title) {
  if (url) { window.open(url, '_blank', 'noopener'); return; }
  let area = document.getElementById('printArea');
  if (!area) { area = document.createElement('div'); area.id = 'printArea'; document.body.appendChild(area); }
  area.innerHTML = `<div class="paper">${html}</div>`;
  const old = document.title;
  document.title = title.replace(/\.pdf$/, '');
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); document.title = old; area.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 1000);
}
