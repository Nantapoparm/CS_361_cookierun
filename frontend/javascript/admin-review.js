// admin-review.js — ตรวจคำขอ (Figma AD3) + ส่งกลับแก้ไข (AD4) + ไม่อนุมัติ (โจทย์ V3 บังคับ ใช้ Modal แบบ AD4)
// Input : admin-review.html?id=<claimId> → GET /admin/claims/{id}
//         (คำขอ + schedule = คาบในตารางสอนของเดือนนั้น, termHours = ชั่วโมงที่เบิกแล้วในภาค, maxHours, duplicates, actions)
// Output: POST /admin/claims/{id}/review { decision: approve | reject | return, note, workIds }
//         ตรวจผ่านแล้ว: POST /printed (พิมพ์) · POST /documents-received (เซ็นแล้ว / รับเอกสารแล้ว)
// ผลตรวจเบื้องต้นคำนวณที่หน้าเว็บ เป็นข้อมูลประกอบ เจ้าหน้าที่เป็นผู้ตัดสิน (V3-10)

let claim, pdfUrl = null;
const keyOf = (date, t) => `${String(date).slice(0, 10)}|${hhmm(t)}`;

// เทียบแต่ละแถวกับตารางสอน: ok = ตรงตาราง · makeup = สอนชดเชย (ดูหลักฐาน) · off = วันงดสอน · none = ไม่มีในตาราง
function matchRows() {
  const sch = new Map(claim.schedule.map((s) => [keyOf(s.date, s.startTime), s]));
  return claim.items.map((x, i) => {
    const s = sch.get(keyOf(x.workDate, x.startTime));
    const res = !s ? (x.kind === 'makeup' ? 'makeup' : 'none') : s.kind === 'cancelled' ? 'off' : s.kind === 'makeup' || x.kind === 'makeup' ? 'makeup' : 'ok';
    return { x, i, res };
  });
}
const MATCH = {
  ok: ['ok', 'ตรงตาราง'],
  makeup: ['warn', 'สอนชดเชย — ดูหลักฐาน'],
  off: ['bad', 'ตรงกับวันงดสอน'],
  none: ['warn', 'ไม่มีในตาราง']
};

// ผลตรวจเบื้องต้น (AD3 "ตรวจอัตโนมัติ")
function checks(rows) {
  const out = [];
  const max = claim.maxHours || 0, total = Math.round((Number(claim.termHours || 0) + Number(claim.totalHours || 0)) * 100) / 100;
  if (max) out.push(total <= max ? ['ok', `ชั่วโมงไม่เกินเพดาน (${num(total)}/${num(max)}${claim.role === 'instructor' ? ' ต่อวิชา' : ' รวมทุกวิชา'})`] : ['bad', `เกินเพดานชั่วโมง (${num(total)}/${num(max)})`]);
  const ok = rows.filter((r) => r.res === 'ok').length;
  if (claim.schedule.length) {
    out.push(['ok', `${ok} ${claim.role === 'student_helper' ? 'วันตรงปฏิทินงาน' : 'คาบตรงตารางสอนทะเบียน'}`]);
    const none = rows.filter((r) => r.res === 'none'), off = rows.filter((r) => r.res === 'off');
    if (off.length) out.push(['bad', `${off.length} คาบตรงกับวันงดสอน (${off.map((r) => thDate(r.x.workDate)).join(', ')})`]);
    if (none.length) out.push(['warn', `${none.length} รายการไม่มีในตาราง (${none.map((r) => thDate(r.x.workDate)).join(', ')}) — เพิ่มเอง`]);
  } else {
    out.push(['warn', 'ไม่มีข้อมูลตารางสอนของเดือนนี้ให้เทียบ']);
  }
  const mk = rows.filter((r) => r.res === 'makeup');
  if (mk.length) {
    const form = claim.actions.some((a) => a.action === 'makeup_form');
    out.push(['warn', `${mk.length} คาบสอนชดเชย (${mk.map((r) => thDate(r.x.workDate)).join(', ')}) — ${form ? 'มีแบบฟอร์มขอสอนชดเชยแนบแล้ว' : 'ตรวจหลักฐาน'}`]);
  }
  if (claim.maxAmountPerDay) {
    const over = claim.items.filter((x) => x.hours * claim.ratePerHour > claim.maxAmountPerDay);
    out.push(over.length ? ['warn', `${over.length} วันเกิน ${num(claim.maxAmountPerDay)} บาท/วัน (คิดเหมาวันละ ${num(claim.maxAmountPerDay)})`] : ['ok', `เงินต่อวันไม่เกิน ${num(claim.maxAmountPerDay)} บาท`]);
  }
  if (claim.submittedAt && claim.deadline) {
    out.push(isoDate(new Date(claim.submittedAt)) <= claim.deadline ? ['ok', 'อยู่ในรอบเบิกที่เปิดรับ'] : ['warn', `ยื่นหลังวันสิ้นสุดรอบ (${thDate(claim.deadline, false)})`]);
  }
  out.push(claim.duplicates?.length ? ['bad', `ซ้ำกับคำขอ ${claim.duplicates.map((d) => '#' + d).join(', ')} (วิชาและเดือนเดียวกัน)`] : ['ok', 'ไม่ซ้ำกับคำขออื่น']);
  if ((claim.revision || 1) > 1) out.push(['warn', `ยื่นใหม่ครั้งที่ ${claim.revision} — แถวที่เคยส่งกลับไฮไลต์ไว้ในตาราง`]);
  return out;
}
const MARK = { ok: '✓', warn: '!', bad: '✕' };

const ACTION_TH = {
  autofill: 'สร้างร่างจากปฏิทิน', created: 'สร้างร่าง (กรอกเอง)', preview: 'ผู้ขอดูตัวอย่าง PDF', submitted: 'ยื่นคำขอ', resubmitted: 'ยื่นใหม่',
  returned: 'ส่งกลับแก้ไข', approved: 'ตรวจผ่าน', rejected: 'ไม่อนุมัติ', printed: 'พิมพ์เอกสาร', documents_received: 'รับเอกสารแล้ว',
  sent_to_finance: 'ส่งการเงิน', paid: 'บันทึกเงินเข้า', cancelled: 'ยกเลิกคำขอ', downloaded: 'ดาวน์โหลด PDF', print_method: 'เปลี่ยนช่องทางเป็นเซ็นกับเจ้าหน้าที่', makeup_form: 'แนบแบบฟอร์มขอสอนชดเชย'
};

// กล่องการกระทำด้านขวา ตามสถานะ
// ปุ่มเสริมใต้กล่องการกระทำ: ยกเลิกคำขอ (FIX-04) · บันทึกเงินเข้า (FIX-03)
function extraCard() {
  const c = claim;
  if (c.status === 'sent_to_finance' && feature('markPaid')) {
    return `<section class="card"><h3>ส่งการเงินแล้ว</h3><p class="muted section-gap">เมื่อการเงินโอนเข้าบัญชีผู้ขอแล้ว ให้บันทึกว่าเงินเข้า</p>
      <button type="button" class="btn block section-gap" id="btnPaid">บันทึกว่าเงินเข้าแล้ว</button></section>`;
  }
  if (ADMIN_CANCELLABLE.includes(c.status) && feature('adminCancel')) {
    return '<button type="button" class="link-btn danger-link" id="btnCancel">ยกเลิกคำขอนี้</button>';
  }
  return '';
}

function actionCard() {
  const c = claim;
  if (c.status === 'submitted') {
    return `<section class="card"><h3>หมายเหตุถึงผู้ขอ</h3>
      <textarea id="note" rows="3" class="note-box section-gap" maxlength="500" placeholder="เช่น ระบุเหตุผลหรือรายการที่ต้องแก้ไข…"></textarea>
      <p class="muted">จำเป็นเมื่อส่งกลับแก้ไขหรือไม่อนุมัติ · ผู้ขอเห็นในหน้ารายละเอียดคำขอ</p>
      <div class="review-btns"><button type="button" class="btn danger" id="btnReturn">ส่งกลับแก้ไข</button><button type="button" class="btn" id="btnApprove">อนุมัติ</button></div>
      <button type="button" class="link-btn danger-link" id="btnReject">ไม่อนุมัติคำขอนี้</button></section>`;
  }
  if (c.status === 'approved') {
    const self = c.printMethod === 'self_print';
    return `<section class="card"><h3>${self ? 'รอผู้ขอนำส่งเอกสาร' : 'รอผู้ขอมาเซ็นที่เคาน์เตอร์'}</h3>
      <p class="muted section-gap">${self ? 'ผู้ขอปริ้นและเซ็นเอง — เทียบเอกสารที่นำมาส่งกับฉบับด้านซ้าย (ชั่วโมง / ยอดเงิน / วันที่) และลายเซ็นปากกาน้ำเงินครบทุกแถว' : c.printedAt ? `พิมพ์แล้วเมื่อ ${thDateTime(c.printedAt)}` : 'ยังไม่ได้พิมพ์เอกสาร'}</p>
      <div class="side-btns section-gap">
        ${self ? '' : `<button type="button" class="btn ghost" id="btnPrint">${c.printedAt ? 'พิมพ์ซ้ำ' : 'พิมพ์เอกสาร'}</button>`}
        <button type="button" class="btn" id="btnRecv">${self ? 'รับเอกสารแล้ว' : 'เซ็นแล้ว (รับเอกสาร)'}</button>
      </div></section>`;
  }
  if (c.status === 'documents_received') {
    return `<section class="card"><h3>รับเอกสารแล้ว</h3><p class="muted section-gap">รอรวมส่งการเงินท้ายรอบ</p>
      <a class="btn block section-gap" href="admin-counter.html${c.printMethod === 'self_print' ? '?tab=self' : ''}">ไปหน้าเคาน์เตอร์เพื่อส่งการเงิน</a></section>`;
  }
  if (c.status === 'returned') return `<section class="card"><h3>ส่งกลับแก้ไขแล้ว</h3><p class="muted section-gap">“${esc(c.returnNote || '-')}” · รอผู้ขอแก้ไขแล้วยื่นใหม่</p></section>`;
  return '';
}

function render() {
  const c = claim, rows = matchRows();
  const flagged = new Set(c.flaggedWorkIds || []);
  $('eyebrow').innerHTML = `<a href="admin-claims.html">คำขอทั้งหมด</a> › #${esc(c.claimId)}`;
  $('title').textContent = `${c.status === 'submitted' ? 'ตรวจคำขอ' : 'คำขอ'} #${c.claimId}`;
  $('lead').textContent = [c.requesterName, ROLE_TH[c.role], itemLabel(c), `งานเดือน ${thMonth(c.month)}`].filter(Boolean).join(' · ');
  const info = [
    ['ผู้ขอเบิก', c.requesterName],
    ['บทบาท', `${ROLE_TH[c.role]} · ${num(c.ratePerHour)} บ./ชม.`],
    ...(c.role === 'ta' ? [['อาจารย์ผู้สอน', c.instructorName || '-']] : []),
    ['รายการ', `${c.items.length} ${c.role === 'student_helper' ? 'วัน' : 'คาบ'} · ${num(c.totalHours)} ชม.`],
    ['ยอดเบิก', baht(c.totalAmount)],
    ['ยื่นเมื่อ', c.submittedAt ? thDateTime(c.submittedAt) : '-'],
    ['ช่องทาง', PRINT_METHOD[c.printMethod]?.short || '-']
  ];
  const table = rows.map(({ x, i, res }) => `<tr class="${flagged.has(x.workId) ? 'flag' : res === 'off' ? 'flag' : res !== 'ok' ? 'warnrow' : ''}">
      <td data-label="แถว">${i + 1}</td>
      <td data-label="วัน/เดือน/ปี">${esc(thDate(x.workDate))}</td>
      <td data-label="เวลา">${esc(timeRange(x.startTime, x.endTime))}</td>
      <td data-label="ชม." class="num">${num(x.hours)}</td>
      <td data-label="หมายเหตุ">${esc(x.Remark || '—')}</td>
      <td data-label="เทียบตาราง"><span class="match ${MATCH[res][0]}">${esc(MATCH[res][1])}</span>${flagged.has(x.workId) ? ' <span class="match bad">เคยส่งกลับ</span>' : ''}</td>
    </tr>`).join('');
  // หมายเหตุของ autofill คือจำนวนคาบ (แสดงต่อท้าย) ; ของการส่งกลับ / ไม่อนุมัติ คือข้อความถึงผู้ขอ (แสดงเป็นคำพูด)
  const hist = c.actions.map((a) => `<li><time>${esc(thShortTime(a.createdAt))}</time><span>${esc(a.actor ? `${a.actor} · ` : '')}${esc(ACTION_TH[a.action] || 'อัปเดตคำขอ')}${a.note ? (a.action === 'autofill' ? ` (${esc(a.note)})` : `<small>“${esc(a.note)}”</small>`) : ''}</span></li>`).join('') || '<li class="muted">ยังไม่มีประวัติ</li>';

  $('body').innerHTML = `<div class="review-layout">
      <div class="review-main">
        ${pdfFrameHtml(adminDocName(c), adminDocHtml(c), pdfUrl)}
        <section class="table-card section-gap">
          <div class="card-head"><h3>รายการ${c.role === 'student_helper' ? 'วันทำงาน' : 'คาบ'}เทียบตารางสอน</h3></div>
          <table class="dtable items ro match-table">
            <thead><tr><th>แถว</th><th>วัน/เดือน/ปี</th><th>เวลา</th><th class="num">ชม.</th><th>หมายเหตุ</th><th>เทียบตาราง</th></tr></thead>
            <tbody>${table}</tbody>
          </table>
        </section>
      </div>
      <aside class="form-side">
        <section class="card"><div class="card-head"><h3>ข้อมูลคำขอ</h3>${chip(c.status, c.printMethod)}</div><div class="rule"></div>
          <dl class="kv">${info.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></section>
        <section class="card"><h3>ตรวจอัตโนมัติ</h3>
          <ul class="checks section-gap">${checks(rows).map(([t, s]) => `<li class="${t}"><span class="mk" aria-hidden="true">${MARK[t]}</span>${esc(s)}</li>`).join('')}</ul>
          <p class="muted">ข้อมูลประกอบการตรวจ เจ้าหน้าที่เป็นผู้ตัดสิน</p></section>
        ${actionCard()}
        ${extraCard()}
        <section class="card"><h3>ประวัติการดำเนินการ</h3><ul class="timeline section-gap">${hist}</ul></section>
      </aside>
    </div>`;
  bind(rows);
}

function bind(rows) {
  $('btnApprove')?.addEventListener('click', approve);
  $('btnReturn')?.addEventListener('click', () => sendBack('return', rows));
  $('btnReject')?.addEventListener('click', () => sendBack('reject', rows));
  $('btnPrint')?.addEventListener('click', async () => {
    const done = await printClaims([claim]);
    if (done[0]) { await reload(); toast(`บันทึกว่าพิมพ์ #${claim.claimId} แล้ว`); }
  });
  $('btnRecv')?.addEventListener('click', receive);
  $('btnCancel')?.addEventListener('click', cancelClaim);
  $('btnPaid')?.addEventListener('click', markPaid);
}

// FIX-04 — เจ้าหน้าที่ยกเลิกคำขอ (หมายเหตุบังคับ) → กลับเป็นร่างของผู้ขอ
async function cancelClaim() {
  const ok = await openModal({
    eyebrow: 'ยกเลิกคำขอ',
    title: `#${claim.claimId} · ${claim.requesterName}`,
    body: `${alertBox('danger', '', 'คำขอจะกลับเป็นร่างของผู้ขอและหายจากรายการของเจ้าหน้าที่ ผู้ขอแก้แล้วยื่นใหม่ได้')}
      <div class="field"><label for="mNote">เหตุผล <span class="req">*</span></label><textarea id="mNote" rows="3" maxlength="500"></textarea></div>`,
    okText: 'ยืนยันยกเลิก',
    okClass: 'danger-solid',
    validate: (el) => {
      if (el.querySelector('#mNote').value.trim()) return true;
      el.querySelector('.m-err').textContent = 'กรุณาใส่เหตุผล ผู้ขอจะเห็นข้อความนี้';
      return false;
    },
    onOk: async (el) => { try { await api.adminCancel(claim.claimId, el.querySelector('#mNote').value.trim()); } catch (err) { throw new Error(errorText(err)); } }
  });
  if (!ok) return;
  flash(`ยกเลิก #${claim.claimId} แล้ว`);
  location.href = 'admin-claims.html';
}

// FIX-03 — sent_to_finance → paid
async function markPaid() {
  const ok = await openModal({
    eyebrow: 'บันทึกเงินเข้า',
    title: `เงินเข้าบัญชีของ #${claim.claimId} แล้ว?`,
    body: `<dl class="kv"><dt>ผู้ขอ</dt><dd>${esc(claim.requesterName)}</dd><dt>ยอดเบิก</dt><dd>${esc(baht(claim.totalAmount))}</dd></dl>`,
    okText: 'ยืนยันเงินเข้าแล้ว',
    onOk: async () => { try { await api.markPaid([claim.claimId]); } catch (err) { throw new Error(errorText(err)); } }
  });
  if (ok) { await reload(); toast(`บันทึกเงินเข้า #${claim.claimId} แล้ว`); }
}

async function reload() { claim = await api.adminClaim(claim.claimId); render(); }

async function approve() {
  const self = claim.printMethod === 'self_print';
  const ok = await openModal({
    eyebrow: 'อนุมัติคำขอ',
    title: `อนุมัติ #${claim.claimId} · ${claim.requesterName}?`,
    body: `<dl class="kv"><dt>รายการ</dt><dd>${esc(itemLabel(claim))} · ${num(claim.totalHours)} ชม.</dd><dt>ยอดเบิก</dt><dd>${esc(baht(claim.totalAmount))}</dd><dt>ช่องทาง</dt><dd>${esc(PRINT_METHOD[claim.printMethod]?.th || '-')}</dd></dl>
      ${alertBox('warn', '', self ? 'ผู้ขอจะดาวน์โหลด PDF ฉบับนี้ไปปริ้นเซ็นเองได้ทันที' : 'คำขอจะไปอยู่ในแท็บ "รอเซ็นที่เคาน์เตอร์" ให้พิมพ์เอกสารไว้รอผู้ขอมาเซ็น')}`,
    okText: 'อนุมัติ',
    onOk: async () => { try { await api.reviewClaim(claim.claimId, 'approve', $('note')?.value.trim() || ''); } catch (err) { throw new Error(errorText(err)); } }
  });
  if (!ok) return;
  flash(`อนุมัติ #${claim.claimId} แล้ว · ${self ? 'ผู้ขอดาวน์โหลดไปปริ้นเซ็นเองได้แล้ว' : 'แจ้งผู้ขอให้มาเซ็นเอกสาร'}`);
  location.href = `admin-counter.html${self ? '?tab=self' : ''}`;
}

// AD4 — ส่งกลับแก้ไข (เลือกแถว + หมายเหตุบังคับ) / ไม่อนุมัติ (หมายเหตุบังคับ)
async function sendBack(decision, rows) {
  const ret = decision === 'return';
  const pre = $('note')?.value.trim() || '';
  const list = rows.map(({ x, i, res }) => `<label class="pick${res !== 'ok' ? ' sus' : ''}"><input type="checkbox" value="${esc(x.workId)}"${res === 'off' || res === 'none' ? ' checked' : ''}>
      แถว ${i + 1} · ${esc(thDate(x.workDate))} · ${esc(res === 'makeup' ? 'สอนชดเชย' : timeRange(x.startTime, x.endTime))}</label>`).join('');
  const ok = await openModal({
    wide: true,
    eyebrow: ret ? 'ส่งกลับแก้ไข' : 'ไม่อนุมัติ',
    title: `#${claim.claimId} · ${claim.requesterName}`,
    body: `${ret ? `<div class="field"><span class="lbl">รายการที่ต้องแก้ (ไฮไลต์ให้ผู้ขอ)</span><div class="picks">${list}</div></div>`
      : alertBox('danger', '', 'ไม่อนุมัติแล้วคำขอนี้สิ้นสุด ผู้ขอต้องสร้างคำขอใหม่ของวิชาและเดือนนี้ — ถ้าแก้ได้ ให้ใช้ "ส่งกลับแก้ไข" แทน')}
      <div class="field"><label for="mNote">หมายเหตุ <span class="req">*</span></label><textarea id="mNote" rows="3" maxlength="500">${esc(pre)}</textarea></div>`,
    okText: ret ? 'ยืนยันส่งกลับ' : 'ยืนยันไม่อนุมัติ',
    okClass: 'danger-solid',
    validate: (el) => {
      if (el.querySelector('#mNote').value.trim()) return true;
      el.querySelector('.m-err').textContent = 'กรุณาใส่หมายเหตุ ผู้ขอจะเห็นข้อความนี้';
      el.querySelector('#mNote').focus();
      return false;
    },
    onOk: async (el) => {
      const ids = [...el.querySelectorAll('.picks input:checked')].map((i) => Number(i.value));
      try { claim = await api.reviewClaim(claim.claimId, decision, el.querySelector('#mNote').value.trim(), ids); } catch (err) { throw new Error(errorText(err)); }
    }
  });
  if (!ok) return;
  flash(ret ? `ส่งกลับ #${claim.claimId} ให้ผู้ขอแก้ไขแล้ว` : `ไม่อนุมัติ #${claim.claimId} แล้ว`);
  location.href = 'admin-claims.html?status=submitted';
}

async function receive() {
  const self = claim.printMethod === 'self_print';
  const ok = await openModal({
    title: self ? `รับเอกสาร #${claim.claimId}?` : `บันทึกว่า ${claim.requesterName} เซ็นแล้ว?`,
    lead: self ? 'ยืนยันว่าเทียบกับฉบับที่ตรวจผ่านแล้ว และลายเซ็นปากกาน้ำเงินครบทุกแถว' : 'ยืนยันว่าผู้ขอเซ็นเอกสารที่พิมพ์ไว้ครบทุกแถวแล้ว',
    okText: self ? 'รับเอกสารแล้ว' : 'เซ็นแล้ว',
    onOk: async () => { try { await api.receiveDocs(claim.claimId); } catch (err) { throw new Error(errorText(err)); } }
  });
  if (ok) { await reload(); toast(`${self ? 'รับเอกสาร' : 'บันทึกเซ็นแล้ว'} #${claim.claimId} · ระบบแจ้งผู้ขอให้อัตโนมัติ`); }
}

async function init() {
  const user = await initPage(STAFF);
  if (!user) return;
  const id = new URLSearchParams(location.search).get('id') || '';
  $('body').innerHTML = `<div class="review-layout"><div class="pdf-frame"><div class="paper loading">${skeleton(['w60', '', 'w80', 'lg', 'lg'])}</div></div><div class="card">${skeleton(['w40', '', '', 'lg'])}</div></div>`;
  try {
    claim = await api.adminClaim(id);
    // PDF จริงจาก Lambda (ถ้ามี) ; ไม่สำเร็จก็ยังตรวจจากตัวอย่างที่วาดเองได้
    if (claim.role === 'student_helper') pdfUrl = blankFormOf(claim).file; // แบบฟอร์มเปล่าเป็นไฟล์ในเว็บ
    else { try { pdfUrl = (await api.getPdf(claim.claimId, 'claim'))?.downloadUrl || null; } catch { pdfUrl = null; } }
    render();
  } catch (err) {
    $('body').innerHTML = '';
    showErrorState($('body'), err.code === 'NOT_FOUND' ? 'ไม่พบคำขอนี้' : 'โหลดคำขอไม่สำเร็จ', err, err.code === 'NOT_FOUND' ? null : () => location.reload());
    $('body').firstElementChild?.classList.add('card');
  }
}

document.addEventListener('DOMContentLoaded', init);
