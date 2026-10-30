// makeup.js — แบบฟอร์มขอสอนชดเชย (Figma I17) เติมข้อมูลจากคาบงดสอน + คาบสอนชดเชยในปฏิทิน
// เปิดเป็น makeup.html?month=YYYY-MM[&makeup=<historyId>] (ลิงก์ "แบบฟอร์ม →" ในปฏิทิน ส่ง makeup มาให้)
// Input : GET /schedule?month= (คาบ kind = cancelled / makeup) + GET /claims (คำขอของวิชาและเดือนนั้น)
// Output: GET /claims/{claimId}/pdf?type=makeup&historyId=<คาบชดเชย>&originalId=<คาบที่งด>
//         = สร้าง PDF และแนบเป็นหลักฐานของคำขอ (V3-09) ; ดาวน์โหลดไปเซ็นใช้ route เดียวกัน

let user, month, data, claims = [];
let off = [], mk = [];

const optLabel = (p) => `${courseShort(p)} · ${thDate(p.date)} · ${timeRange(p.startTime, p.endTime)}`;
const sel = () => ({ from: off[$('mFrom')?.value], to: mk[$('mTo')?.value] });
const claimOf = (p) => p && claims.find((c) => c.month === month && c.status !== 'rejected' && sameOffering(c, p));

function formData() {
  const { from, to } = sel();
  const c = to || from || {};
  return {
    docDate: $('mDoc').value, user, course: c, semester: data.semester, academicYear: data.academicYear,
    kind: document.querySelector('input[name="mKind"]:checked')?.value || 'makeup',
    from, to, reason: $('mReason').value.trim()
  };
}

function renderPreview() {
  const f = formData();
  const name = `สอนชดเชย_${courseShort(f.course).replace(/\s+/g, '')}_${f.to ? thDate(f.to.date, false).replace(/\s+/g, '') : ''}_${user.name || ''}.pdf`;
  $('doc').innerHTML = pdfFrameHtml(name, makeupDocHtml(f));
  const c = claimOf(f.to || f.from);
  $('attachTxt').innerHTML = c
    ? `แนบเป็นหลักฐานกับคำขอเบิก ${esc(courseShort(c))} เดือน ${esc(thMonth(c.month))} (#${esc(c.claimId)})`
    : `ยังไม่มีคำขอของ ${esc(courseShort(f.course))} เดือน ${esc(thMonth(month))} — <a class="link" href="form.html?month=${esc(month)}">สร้างคำขอก่อน</a> จึงแนบได้`;
  $('attach').disabled = !c;
  if (!c) $('attach').checked = false;
  $('send').disabled = !c || !$('attach').checked || !f.from || !f.to;
  ['who', 'course', 'term'].forEach((k) => { $(`s_${k}`).textContent = { who: fullName(user), course: `${courseFull(f.course)}${f.course.section ? ` · ${f.course.section}` : ''}`, term: `${data.semester} / ${be(data.academicYear)}` }[k]; });
}

function render() {
  if (!off.length && !mk.length) {
    $('body').innerHTML = `<div class="card"><div class="state"><span class="ic" aria-hidden="true">📅</span>
      <h3>เดือน ${esc(thMonth(month))} ไม่มีคาบงดสอนหรือสอนชดเชย</h3>
      <p>ทำเครื่องหมาย “งดสอน” และเพิ่ม “สอนชดเชย” ในปฏิทินก่อน ระบบจะเติมแบบฟอร์มนี้ให้</p>
      <div class="state-btns"><a class="btn" href="calendar.html?month=${esc(month)}">ไปที่ปฏิทิน</a>
        <a class="btn ghost" href="makeup.html?month=${esc(addMonths(month, -1))}">เดือนก่อนหน้า</a></div></div></div>`;
    return;
  }
  const q = new URLSearchParams(location.search);
  const toIdx = Math.max(0, mk.findIndex((p) => String(p.historyId) === q.get('makeup')));
  const to = mk[toIdx];
  // คาบที่งดของวิชาเดียวกัน ก่อนวันสอนชดเชย (ใกล้ที่สุด)
  const fromIdx = Math.max(0, off.reduce((best, p, i) => (to && p.courseId === to.courseId && p.date <= to.date ? i : best), -1));
  const from = off[fromIdx];
  const auto = from && to;
  $('body').innerHTML = `<div class="makeup-layout">
      <section class="card">
        <h3>ข้อมูลในแบบฟอร์ม</h3><div class="rule section-gap"></div>
        ${auto ? alertHtml('warn', `<b>เติมจากปฏิทินให้แล้ว</b> — คาบ ${esc(courseShort(from))} ${esc(thDateLong(from.date))} ถูกงด${from.description ? ` (${esc(from.description)})` : ''} และมีคาบสอนชดเชย${esc(thDateLong(to.date))}`) : ''}
        <div class="form-1 section-gap">
          <div class="field auto"><label for="mFrom">คาบเดิมที่งด / เปลี่ยนวัน <span class="tag auto">AUTO</span></label>
            <select id="mFrom">${off.map((p, i) => `<option value="${i}"${i === fromIdx ? ' selected' : ''}>${esc(optLabel(p))}</option>`).join('') || '<option value="">ไม่มีคาบงดสอนในเดือนนี้</option>'}</select></div>
          <div class="form-2">
            <div class="field auto"><label for="mTo">สอนชดเชยวันที่ <span class="tag auto">AUTO</span></label>
              <select id="mTo">${mk.map((p, i) => `<option value="${i}"${i === toIdx ? ' selected' : ''}>${esc(thDate(p.date))}</option>`).join('') || '<option value="">ไม่มีคาบชดเชย</option>'}</select></div>
            <div class="field auto"><label>เวลา / ห้อง <span class="tag auto">AUTO</span></label><div class="static" id="mTime"></div></div>
          </div>
          <div class="field"><span class="lbl">ประเภทคำขอ</span>
            <div class="opts"><label class="opt"><input type="radio" name="mKind" value="makeup" checked> ขอสอนชดเชย / เปลี่ยนวันสอน</label><label class="opt"><input type="radio" name="mKind" value="other"> อื่น ๆ</label></div></div>
          <div class="field auto"><label for="mReason">เนื่องจาก <span class="tag auto">AUTO</span></label>
            <textarea id="mReason" rows="2" maxlength="200"></textarea><span class="hint">ดึงจากเหตุผลของวันงดสอนในปฏิทิน · แก้ไขได้</span></div>
          <div class="field"><label for="mDoc">วันที่ในเอกสาร</label><input type="date" id="mDoc" value="${esc(todayIso())}"></div>
          <dl class="kv"><dt>ผู้สอน</dt><dd id="s_who"></dd><dt>วิชา</dt><dd id="s_course"></dd><dt>ภาค / ปี</dt><dd id="s_term"></dd></dl>
          <label class="check"><input type="checkbox" id="attach" checked> <span id="attachTxt"></span></label>
          <button type="button" class="btn block" id="send">ส่งให้เจ้าหน้าที่เป็นหลักฐาน</button>
          <button type="button" class="btn ghost block" id="dl">ดาวน์โหลด PDF ไปเซ็น</button>
          <p class="muted">เจ้าหน้าที่เห็นแบบฟอร์มนี้ตอนตรวจคำขอ (ยืนยันว่าชดเชยวันไหนจริง) · ฉบับเซ็นปากกาน้ำเงินแนบไปพร้อมเอกสารเบิก</p>
        </div>
      </section>
      <div id="doc"></div>
    </div>`;
  const fillAuto = () => {
    const { from: f, to: t } = sel();
    $('mTime').textContent = t ? `${timeRange(t.startTime, t.endTime)}${t.room ? ` · ${t.room}` : ''}` : '-';
    $('mReason').value = f ? `วันที่ ${thDate(f.date, false)} ${f.description ? `เป็นวันงดการเรียนการสอน (${f.description})` : 'งดการเรียนการสอน'}` : '';
  };
  fillAuto();
  $('mFrom').addEventListener('change', () => { fillAuto(); renderPreview(); });
  $('mTo').addEventListener('change', () => { fillAuto(); renderPreview(); });
  ['mReason', 'mDoc'].forEach((id) => $(id).addEventListener('input', renderPreview));
  document.querySelectorAll('input[name="mKind"], #attach').forEach((el) => el.addEventListener('change', renderPreview));
  $('send').addEventListener('click', () => sendPdf(true));
  $('dl').addEventListener('click', () => sendPdf(false));
  renderPreview();
}

// ส่งเป็นหลักฐาน (attach) หรือดาวน์โหลดไปเซ็น — ทั้งคู่ให้ Lambda สร้าง PDF จากคาบที่เลือก
async function sendPdf(attach) {
  const f = formData();
  const c = claimOf(f.to || f.from);
  if (!f.from || !f.to) { toast('กรุณาเลือกคาบที่งดและคาบสอนชดเชย', true); return; }
  if (!c) {
    // ยังไม่มีคำขอ: ดาวน์โหลดได้แต่ยังแนบไม่ได้ (route PDF ผูกกับคำขอ)
    if (!attach) { openDoc(null, makeupDocHtml(f), 'แบบฟอร์มขอสอนชดเชย.pdf'); return; }
    toast('สร้างคำขอของเดือนนี้ก่อนจึงแนบได้', true); return;
  }
  const btn = attach ? $('send') : $('dl');
  btn.disabled = true;
  try {
    const r = await api.getPdf(c.claimId, 'makeup', { historyId: f.to.historyId, originalId: f.from.historyId, note: f.reason });
    if (attach) toast(`แนบแบบฟอร์มกับคำขอ #${c.claimId} แล้ว`);
    else openDoc(r?.downloadUrl, makeupDocHtml(f), `สอนชดเชย_${courseShort(f.course)}.pdf`);
  } catch (err) { toast(errorText(err), true); }
  btn.disabled = false;
  renderPreview();
}

async function init() {
  user = await initPage(['instructor']);
  if (!user) return;
  const q = new URLSearchParams(location.search);
  $('body').innerHTML = `<div class="card">${skeleton(['w40', '', 'lg', 'lg'])}</div>`;
  try {
    const period = await api.getCurrentPeriod();
    month = /^\d{4}-\d{2}$/.test(q.get('month') || '') ? q.get('month') : period.claimMonth;
    $('crumb').href = $('back').href = `calendar.html?month=${month}`;
    const [sch, list] = await Promise.all([api.getSchedule(month), api.getClaims()]);
    data = { ...sch, semester: period.semester, academicYear: period.academicYear };
    claims = list;
    off = sch.periods.filter((p) => p.kind === 'cancelled');
    mk = sch.periods.filter((p) => p.kind === 'makeup');
    render();
  } catch (err) {
    $('body').innerHTML = '';
    showErrorState($('body'), 'โหลดข้อมูลจากปฏิทินไม่สำเร็จ', err, () => location.reload());
    $('body').firstElementChild?.classList.add('card');
  }
}

document.addEventListener('DOMContentLoaded', init);
