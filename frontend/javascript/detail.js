// detail.js — รายละเอียดคำขอ + ติดตามสถานะ
// Input : ?id=...  → GET /claims/{id}
// Output: ข้อมูลคำขอ, รายการงาน, ยอดรวม, ไฟล์แนบ, สถานะ; ปุ่มแก้ไข/ยื่นเฉพาะ draft → POST /claims/{id}/submit
// หมายเหตุ: API มีสถานะ draft / submitted เท่านั้น และไม่มี route ดาวน์โหลดใบเบิก PDF

const claimId = new URLSearchParams(location.search).get('id');

function stepsHtml(status) {
  const steps = [
    ['ฉบับร่าง', status === 'draft' ? 'now' : 'done'],
    ['ยื่นแล้ว · รอตรวจสอบ', status === 'submitted' ? 'now' : '']
  ];
  return `<div class="steps" aria-label="สถานะคำขอ">${steps.map(([t, c]) => `<span class="${c}">${esc(t)}</span>`).join('')}</div>`;
}

function renderDetail(c) {
  const rows = [...c.items]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((x) => `<tr>
      <td>${fmtDate(x.date)}</td>
      <td>${esc(x.note || '-')}</td>
      <td>${esc(x.hours)}</td>
    </tr>`).join('') || '<tr><td colspan="3" class="empty">ยังไม่มีรายการงาน</td></tr>';

  $('detail').innerHTML = `
    ${stepsHtml(c.status)}
    <div class="form-card">
      <dl class="detail-list">
        <dt>เลขที่คำขอ</dt><dd>#${esc(c.id)}</dd>
        <dt>สถานะ</dt><dd>${statusBadge(c.status)}</dd>
        <dt>วิชา</dt><dd>${esc(courseOf(c) || '-')}</dd>
        <dt>ภาคการศึกษา</dt><dd>${esc(termLabel(c.term))}</dd>
        <dt>รอบการเบิก</dt><dd>${esc(cycleLabel(c.billingCycle))}</dd>
        <dt>บทบาท</dt><dd>${esc(ROLE_TH[c.role] || c.role)}</dd>
        <dt>วันที่ยื่น</dt><dd>${fmtDate(c.submittedAt)}</dd>
        <dt>ชั่วโมงรวม</dt><dd>${esc(c.totalHours)}</dd>
        <dt>ยอดเบิกรวม</dt><dd>${baht(c.totalAmount)}</dd>
        <dt>ไฟล์หลักฐาน</dt><dd>${(c.attachments || []).map((k) => esc(fileNameOf(k))).join('<br>') || '-'}</dd>
      </dl>
    </div>
    <h3 class="sub">รายการงาน</h3>
    <div class="table-card">
      <table class="rate-table claims-table">
        <thead><tr><th>วันที่</th><th>หมายเหตุ</th><th>ชั่วโมง</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${EDITABLE.includes(c.status) ? `<div class="actions">
      <a class="btn ghost" href="form.html?id=${encodeURIComponent(c.id)}">แก้ไขร่าง</a>
      <button class="btn" id="btnSubmit" type="button">ยื่นคำขอ</button>
    </div>` : ''}`;

  if ($('btnSubmit')) $('btnSubmit').addEventListener('click', onSubmit);
}

async function loadDetail() {
  $('msg').innerHTML = '';
  $('detail').innerHTML = '<p class="boot">กำลังโหลด…</p>';
  try {
    if (!claimId) throw new ApiError('NOT_FOUND', 'ไม่พบคำขอ', 404);
    renderDetail(await api.getClaim(claimId));
  } catch (err) {
    $('detail').innerHTML = '';
    showError(err, $('msg'), loadDetail);
  }
}

async function onSubmit() {
  const btn = $('btnSubmit');
  btn.disabled = true; // กันกดซ้ำ
  try {
    await api.submitClaim(claimId);
    await loadDetail();
  } catch (err) {
    showError(err, $('msg'));
    if (err.code === 'INVALID_STATE') { // ถูกเปลี่ยนสถานะไปแล้ว → โหลดสถานะล่าสุด คงข้อความ error
      try { renderDetail(await api.getClaim(claimId)); } catch { /* ข้าม */ }
    } else btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => { initPage(); loadDetail(); });