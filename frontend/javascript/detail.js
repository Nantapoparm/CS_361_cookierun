// detail.js — รายละเอียดคำขอ (Figma I11 รอเซ็น · I12 ส่งกลับแก้ไข · I14 ยื่นใหม่ · I15 ปริ้นเซ็นเอง · I16 รับเอกสารแล้ว)
// Input : detail.html?id=<claimId> → GET /claims/{id} + GET /claims/{id}/actions (ประวัติการดำเนินการ)
// Output: Stepper ตามช่องทางยื่น, กล่องขั้นตอนถัดไปตามสถานะ, ข้อมูลคำขอ, รายการคาบ, ตัวอย่างเอกสาร, ประวัติ
//         ดาวน์โหลด / พิมพ์ PDF → GET /claims/{id}/pdf ; เปลี่ยนเป็นเซ็นกับเจ้าหน้าที่ → PUT /claims/{id}/print-method

let user, claim, actions = [];
const student = () => user.role === 'student_helper';
const docHtml = () => (student() ? blankDocHtml(claim) : claimDocHtml(claim, user));
const AFTER_OK = ['approved', 'documents_received', 'sent_to_finance', 'paid'];

// ข้อความประวัติจาก claim_actions
function actionText(a) {
  const self = claim.printMethod === 'self_print';
  return {
    autofill: `สร้างร่างจากปฏิทิน${a.note ? ` (autofill ${a.note})` : ''}`,
    created: 'สร้างร่าง (กรอกเอง)',
    preview: 'ดูตัวอย่าง PDF',
    submitted: self ? 'ส่งตรวจ (ช่องทางปริ้นเซ็นเอง)' : 'ยื่นคำขอในระบบ',
    resubmitted: `ยื่นใหม่${a.note ? ` (${a.note})` : ''}`,
    returned: `${a.actor} ส่งกลับแก้ไข`,
    approved: `${a.actor} ตรวจผ่าน · ${self ? 'ให้ปริ้นเซ็นเอง' : 'รอเซ็นเอกสาร'}`,
    rejected: `${a.actor} ไม่อนุมัติ`,
    printed: `${a.actor} พิมพ์เอกสารแล้ว`,
    documents_received: `${a.actor} รับเอกสารฉบับเซ็นแล้ว`,
    sent_to_finance: `${a.actor} ส่งการเงินแล้ว`,
    paid: `${a.actor} บันทึกว่าเงินเข้าแล้ว`,
    cancelled: `${a.actor} ยกเลิกคำขอ · กลับเป็นร่าง${a.note ? ` (${a.note})` : ''}`,
    downloaded: `${a.actor ? `${a.actor} ` : ''}ดาวน์โหลด PDF`,
    print_method: 'เปลี่ยนช่องทางเป็นเซ็นกับเจ้าหน้าที่',
    makeup_form: 'แนบแบบฟอร์มขอสอนชดเชย'
  }[a.action] || 'อัปเดตคำขอ';
}
const lastAction = (name) => actions.find((a) => a.action === name);

// กล่องขั้นตอนถัดไปตามสถานะ
function nextBox(resubmitted) {
  const c = claim, id = esc(c.claimId), due = c.deadline ? thDate(c.deadline, false) : '';
  const counter = `ห้อง ${esc(OFFICE.room)} · ${esc(OFFICE.hours)}`;
  switch (c.status) {
    case 'draft':
      return alertHtml('warn', '<b>ยังไม่ได้ยื่น</b> — ร่างนี้ยังไม่ถึงเจ้าหน้าที่ ตรวจตัวอย่าง PDF แล้วเลือกช่องทางยื่น',
        `<a class="btn sm" href="submit.html?id=${encodeURIComponent(c.claimId)}">ไปยื่นคำขอ</a>`);
    case 'submitted': {
      const again = resubmitted || (c.revision || 0) > 1;
      const sw = c.printMethod === 'self_print'
        ? ' · เปลี่ยนใจ? <button type="button" class="link-btn" id="switch">เปลี่ยนเป็นไปเซ็นที่เคาน์เตอร์</button> ได้จนกว่าจะตรวจเสร็จ' : '';
      return again
        ? alertHtml('info', `<b>ยื่นใหม่แล้ว (ครั้งที่ ${c.revision || 2})</b> — เจ้าหน้าที่จะเห็นรายการที่แก้ไขไฮไลต์ไว้ให้ตรวจ${sw}`)
        : alertHtml('info', `<b>รอเจ้าหน้าที่ตรวจ</b> — ปกติภายใน 1–2 วันทำการ · ถ้าต้องแก้ เจ้าหน้าที่จะส่งกลับพร้อมหมายเหตุ${sw}`);
    }
    case 'returned': {
      const a = lastAction('returned');
      const who = [c.returnedBy || a?.actor, thDateTime(c.returnedAt || a?.createdAt)].filter(Boolean).join(' · ');
      const flagged = c.items.map((x, i) => ({ x, i })).filter(({ x }) => c.flaggedWorkIds?.includes(x.workId));
      return alertHtml('danger', `<b>เจ้าหน้าที่ส่งกลับให้แก้ไข</b> <span class="muted">· ${esc(who)}</span><br>“${esc(c.returnNote || a?.note || '-')}”
        ${flagged.length ? `<br><small>รายการที่ต้องแก้: <b>${flagged.map(({ x, i }) => `แถวที่ ${i + 1} — ${esc(thDate(x.workDate))}`).join(', ')}</b></small>` : ''}`,
        `<a class="btn danger sm" href="form.html?id=${encodeURIComponent(c.claimId)}">แก้ไขคำขอ</a>`);
    }
    case 'rejected': {
      const a = lastAction('rejected');
      return alertHtml('danger', `<b>ไม่อนุมัติ</b>${a ? ` <span class="muted">· ${esc(a.actor)} · ${esc(thDateTime(a.createdAt))}</span>` : ''}<br>“${esc(a?.note || c.returnNote || '-')}” · สร้างคำขอใหม่ของวิชาและเดือนนี้ได้`);
    }
    case 'approved':
      return c.printMethod === 'self_print'
        ? alertHtml('success', `<b>เจ้าหน้าที่ตรวจผ่านแล้ว — ดาวน์โหลดไปปริ้นและเซ็นได้เลย</b><br>1) พิมพ์ A4 หน้าเดียว · 2) เซ็นปากกาน้ำเงินทุกแถว · 3) นำส่ง${counter} ภายใน <b>${esc(due)}</b> แจ้งเลขที่คำขอ <b>#${id}</b>
            <br><small>ถ้าต้องแก้ข้อมูลหลังตรวจผ่าน ต้องส่งตรวจใหม่ · ปริ้นจากปุ่มนี้เท่านั้น (ฉบับที่ตรวจแล้ว)</small>`,
          '<div class="act-col"><button type="button" class="btn sm" data-dl>ดาวน์โหลด PDF</button><button type="button" class="btn ghost sm" data-dl>ปริ้น</button></div>')
        : alertHtml('warn', `<b>เจ้าหน้าที่ตรวจผ่านแล้ว — กรุณาไปเซ็นเอกสาร</b><br>ที่เคาน์เตอร์${counter} ภายใน ${esc(due)} · เอกสารพิมพ์ไว้ให้แล้ว แจ้งเลขที่คำขอ <b>#${id}</b>`);
    case 'documents_received': {
      const a = lastAction('documents_received');
      return alertHtml('info', `<b>เจ้าหน้าที่รับเอกสารที่เซ็นแล้ว</b>${a ? ` — ${esc(a.actor)} · ${esc(thDateTime(a.createdAt))}` : ''}<br>รอรวมส่งการเงินท้ายรอบ · ไม่ต้องทำอะไรเพิ่ม ระบบจะแจ้งเมื่อส่งการเงินแล้ว`);
    }
    case 'sent_to_finance': {
      const a = lastAction('sent_to_finance');
      return alertHtml('success', `<b>ส่งการเงินแล้ว</b>${a ? ` — ${esc(thDateTime(a.createdAt))}` : ''} · รอการเงินโอนเข้าบัญชี ไม่ต้องทำอะไรเพิ่ม`);
    }
    case 'paid': {
      const a = lastAction('paid');
      return alertHtml('success', `<b>เงินเข้าเรียบร้อยแล้ว</b>${a ? ` — ${esc(thDateTime(a.createdAt))}` : ''} · คำขอนี้เสร็จสมบูรณ์`);
    }
    default: return '';
  }
}

function render(resubmitted) {
  const c = claim;
  const editable = EDITABLE.includes(c.status);
  $('eyebrow').innerHTML = `<a href="dashboard.html">ประวัติคำขอ</a> › #${esc(c.claimId)}`;
  $('title').textContent = `คำขอ #${c.claimId} · ${courseShort(c)}`;
  $('lead').textContent = `งานเดือน ${thMonth(c.month)}${c.deadline ? ` · รอบที่ ${cycleOf(c)} (ภายใน ${thDate(c.deadline, false)})` : ''}`;
  // ยกเลิก: เฉพาะคำขอที่เจ้าหน้าที่ยังไม่ได้ตรวจ (FIX-04) ; ลบ: เฉพาะร่าง (FIX-05)
  const canCancel = c.status === 'submitted' && feature('cancelClaim');
  const canDelete = c.status === 'draft' && feature('deleteDraft');
  $('tools').innerHTML = `<a class="btn ghost" href="dashboard.html">← กลับรายการ</a>${canCancel ? '<button type="button" class="btn danger" id="btnCancel">ยกเลิกคำขอ</button>' : ''}${canDelete ? '<button type="button" class="btn danger" id="btnDelete">ลบร่าง</button>' : ''}${editable ? `<a class="btn" href="form.html?id=${encodeURIComponent(c.claimId)}">แก้ไขคำขอ</a>` : ''}`;
  $('btnCancel')?.addEventListener('click', cancelClaim);
  $('btnDelete')?.addEventListener('click', deleteDraft);

  const self = c.printMethod === 'self_print';
  const lockedPdf = self && !AFTER_OK.includes(c.status) && !editable;
  const dlText = AFTER_OK.includes(c.status) ? 'ดาวน์โหลด PDF' : lockedPdf ? 'ดาวน์โหลด PDF (หลังตรวจผ่าน)' : 'ดาวน์โหลดสำเนา PDF';
  const info = [
    ['ผู้ขอเบิก', `${fullName(user)} (${ROLE_TH[user.role] || ''})`],
    [student() ? 'งาน' : 'วิชา', `${courseFull(c)}${c.section ? ` · ${c.section}` : ''}`],
    ...(user.role === 'ta' ? [['อาจารย์ผู้สอน', c.instructorName || '-']] : []),
    ['ภาคการศึกษา', `${c.semester} / ${be(c.academicYear)}`],
    ['ชั่วโมง / ยอดเบิก', `${num(c.totalHours)} ชม. · ${baht(c.totalAmount)}`],
    ['ช่องทาง', c.printMethod ? PRINT_METHOD[c.printMethod].th : 'ยังไม่เลือก (ร่าง)']
  ];
  const rows = c.items.map((x) => `<tr class="${c.status === 'returned' && c.flaggedWorkIds?.includes(x.workId) ? 'flag' : ''}">
      <td class="ck"><span class="tick" aria-label="เบิก">✓</span></td>
      <td data-label="วัน/เดือน/ปี">${esc(thDate(x.workDate))}</td>
      <td data-label="เวลา">${esc(timeRange(x.startTime, x.endTime))}</td>
      <td data-label="ที่มา"><span class="tag ${x.kind === 'makeup' ? 'mk' : x.kind === 'manual' ? 'man' : ''}">${esc(KIND_TH[x.kind] || 'ตาราง')}</span></td>
      <td data-label="ชม." class="num">${num(x.hours)}</td>
      <td data-label="หมายเหตุ (พิมพ์ลง PDF)">${esc(x.Remark || '—')}</td>
    </tr>`).join('');
  const history = actions.length
    ? actions.map((a) => `<li><time>${esc(thShortTime(a.createdAt))}</time><span>${esc(actionText(a))}</span></li>`).join('')
    : '<li class="muted">ยังไม่มีประวัติ</li>';

  $('body').innerHTML = `
    <section class="card status-card">
      <div class="status-row"><span>สถานะ ${chip(c.status, c.printMethod)}</span><span class="muted">อัปเดตล่าสุด ${esc(thDateTime(c.updatedAt))}</span></div>
      ${stepperHtml(c.status, c.printMethod)}
    </section>
    <div class="section-gap">${nextBox(resubmitted)}</div>
    <div class="detail-layout section-gap">
      <div class="detail-main">
        <section class="card"><h3>ข้อมูลคำขอ</h3><div class="rule section-gap"></div>
          <dl class="kv info">${info.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></section>
        <section class="table-card section-gap">
          <div class="card-head"><h3>รายการ${student() ? 'วันทำงาน' : 'คาบ'}</h3></div>
          <table class="dtable items ro">
            <thead><tr><th class="ck"><span class="sr">เบิก</span></th><th>วัน/เดือน/ปี</th><th>เวลา</th><th>ที่มา</th><th class="num">ชม.</th><th>หมายเหตุ (พิมพ์ลง PDF)</th></tr></thead>
            <tbody>${rows || '<tr class="empty-row"><td colspan="6">ยังไม่มีรายการ</td></tr>'}</tbody>
          </table>
        </section>
      </div>
      <aside class="form-side">
        <section class="card"><h3>เอกสาร</h3>
          <button type="button" class="thumb section-gap" data-dl aria-label="เปิดเอกสาร"><div class="paper">${docHtml()}</div></button>
          <button type="button" class="btn ${self && c.status === 'approved' ? '' : 'ghost'} block section-gap" data-dl${lockedPdf ? ' disabled' : ''}>${esc(dlText)}</button>
        </section>
        <section class="card"><h3>ประวัติการดำเนินการ</h3><ul class="timeline section-gap">${history}</ul></section>
      </aside>
    </div>`;
  $('body').querySelectorAll('[data-dl]').forEach((b) => b.addEventListener('click', download));
  $('switch')?.addEventListener('click', switchMethod);
}

async function download() {
  if (claim.printMethod === 'self_print' && claim.status === 'submitted') { toast('ดาวน์โหลดได้หลังเจ้าหน้าที่ตรวจผ่าน', true); return; }
  if (student()) { window.open(blankFormOf(claim).file, '_blank', 'noopener'); return; }
  try {
    const r = await api.getPdf(claim.claimId, 'claim');
    openDoc(r?.downloadUrl, docHtml(), docFileName(claim, user));
    actions = await api.getActions(claim.claimId).catch(() => actions);
  } catch (err) { toast(errorText(err), true); }
}

async function switchMethod() {
  const ok = await openModal({
    title: 'เปลี่ยนเป็นไปเซ็นที่เคาน์เตอร์?',
    lead: 'เจ้าหน้าที่จะพิมพ์เอกสารไว้ให้หลังตรวจผ่าน คุณไม่ต้องปริ้นเอง และไม่ต้องยื่นคำขอใหม่',
    okText: 'เปลี่ยนช่องทาง',
    onOk: async () => { try { claim = await api.setPrintMethod(claim.claimId, 'sign_with_staff'); } catch (err) { throw new Error(errorText(err)); } }
  });
  if (ok) { actions = await api.getActions(claim.claimId).catch(() => actions); toast('เปลี่ยนเป็นเซ็นกับเจ้าหน้าที่แล้ว'); render(); }
}

// FIX-04 — ยกเลิกคำขอที่ยังรอตรวจ → กลับเป็นร่าง (แก้แล้วยื่นใหม่ หรือลบได้)
async function cancelClaim() {
  const ok = await openModal({
    eyebrow: 'ยกเลิกคำขอ',
    title: `ยกเลิกคำขอ #${claim.claimId}?`,
    body: `${alertBox('warn', '', 'คำขอจะกลับเป็นร่างและหายจากรายการของเจ้าหน้าที่ — แก้ไขแล้วยื่นใหม่ หรือลบร่างทิ้งได้')}
      <div class="field"><label for="mReason">เหตุผล (ไม่บังคับ)</label><textarea id="mReason" rows="2" maxlength="500" placeholder="เช่น กรอกเวลาผิด"></textarea></div>`,
    okText: 'ยืนยันยกเลิก',
    okClass: 'danger',
    onOk: async (el) => {
      try { await api.cancelClaim(claim.claimId, el.querySelector('#mReason').value.trim()); } catch (err) { throw new Error(errorText(err)); }
    }
  });
  if (!ok) return;
  claim = await api.getClaim(claim.claimId);
  actions = await api.getActions(claim.claimId).catch(() => actions);
  toast(`ยกเลิกคำขอ #${claim.claimId} แล้ว · กลับเป็นร่าง`);
  render();
}

// FIX-05 — ลบร่าง (คาบในร่างนี้กลับไปเลือกสร้างคำขอใหม่ได้)
async function deleteDraft() {
  const ok = await openModal({
    eyebrow: 'ลบร่าง',
    title: `ลบร่าง #${claim.claimId}?`,
    lead: 'ลบแล้วกู้คืนไม่ได้ คาบในร่างนี้จะกลับไปเลือกสร้างคำขอใหม่ได้',
    okText: 'ลบร่าง',
    okClass: 'danger',
    onOk: async () => { try { await api.deleteClaim(claim.claimId); } catch (err) { throw new Error(errorText(err)); } }
  });
  if (ok) location.href = 'dashboard.html';
}

async function init() {
  user = await initPage();
  if (!user) return;
  const q = new URLSearchParams(location.search);
  $('body').innerHTML = `<div class="card">${skeleton(['w40', '', 'lg'])}</div><div class="card section-gap">${skeleton(['w60', '', '', 'lg'])}</div>`;
  try {
    claim = await api.getClaim(q.get('id') || '');
    actions = await api.getActions(claim.claimId).catch(() => []);
    const again = q.get('resubmitted') === '1';
    render(again);
    if (again) { toast(`ยื่นคำขอ #${claim.claimId} อีกครั้งเรียบร้อย`); history.replaceState(null, '', `detail.html?id=${encodeURIComponent(claim.claimId)}`); }
  } catch (err) {
    $('body').innerHTML = '';
    showErrorState($('body'), err.code === 'NOT_FOUND' ? 'ไม่พบคำขอนี้' : 'โหลดคำขอไม่สำเร็จ', err, err.code === 'NOT_FOUND' ? null : () => location.reload());
    $('body').firstElementChild?.classList.add('card');
  }
}

document.addEventListener('DOMContentLoaded', init);
