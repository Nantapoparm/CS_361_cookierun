// admin.js — ภาพรวมของเจ้าหน้าที่ (Figma AD1) เปิดได้เฉพาะบทบาท admin
// Input : GET /current-period + GET /admin/claims (ทุกคำขอที่ยื่นแล้ว)
// Output: การ์ดรอบการเบิก, จำนวนตามสถานะ, รอตรวจล่าสุด, จำนวนคำขอแยกตามบทบาทของรอบนี้
// ไม่ทำใน V3 (ซ่อนตาม issue): สร้างคำขอแทนผู้ใช้ และอีเมลเตือนผู้ที่ยังไม่ยื่น

const statHtml = (n, label) => `<b>${esc(n)}</b><span>${esc(label)}</span>`;

// การ์ดรอบของเจ้าหน้าที่: รับคำขอ 1–5 / 6–10 · ส่งการเงิน 3 วันหลังปิดรับ
function periodAdminHtml(p) {
  const due = parseDay(p.deadline), mon = TH_MON[due.getMonth()];
  const fin = new Date(due.getFullYear(), due.getMonth(), due.getDate() + 3);
  return `<div class="eyebrow">รอบการเบิกปัจจุบัน</div>
    <div class="t">รอบที่ ${cycleOf(p)} · ${esc(thMonth(p.deadline.slice(0, 7)))}</div>
    <div class="d">รับคำขอ ${cycleOf(p) === 1 ? '1–5' : '6–10'} ${esc(mon)} · ส่งการเงิน ${fin.getDate()} ${esc(TH_MON[fin.getMonth()])}</div>
    <div class="left">เหลืออีก <b>${esc(p.daysLeft)}</b> วัน</div>`;
}

const pendRow = (c) => `<tr>
  <td class="id">#${esc(c.claimId)}</td>
  <td data-label="บทบาท">${roleTag(c.role)}</td>
  <td data-label="ผู้ขอ" class="who">${esc(c.requesterName)}</td>
  <td data-label="รายการ">${esc(itemLabel(c))}</td>
  <td data-label="ชม." class="num">${num(c.totalHours)}</td>
  <td data-label="บาท" class="num">${num(c.totalAmount)}</td>
  <td data-label="สถานะ" class="st">${statusCell(c)}</td>
  <td class="act"><a class="btn sm" href="admin-review.html?id=${encodeURIComponent(c.claimId)}">ตรวจ</a></td>
</tr>`;

async function load() {
  $('msg').innerHTML = '';
  ['sSub', 'sRet', 'sSign', 'sDone'].forEach((id) => { $(id).innerHTML = skeleton(['w40', 'lg']); });
  $('period').innerHTML = skeleton(['w40', 'w80', 'w60']);
  $('rows').innerHTML = `<tr class="empty-row"><td colspan="8">${skeleton(['', '', ''])}</td></tr>`;
  try {
    const [p, data] = await Promise.all([api.getCurrentPeriod(), api.adminClaims()]);
    const all = data.items;
    const round = `${p.deadline.slice(0, 7)}|${cycleOf(p)}`;
    const inRound = all.filter((c) => roundKey(c) === round);
    const by = (k) => all.filter(ADMIN_GROUPS.find((g) => g.key === k).test).length;
    const pending = all.filter((c) => c.status === 'submitted').sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));

    const dm = parseMonth(p.deadline.slice(0, 7));
    $('lead').textContent = `รอบที่ ${cycleOf(p)} เดือน ${thMonth(p.deadline.slice(0, 7))} (งานเดือน ${TH_MON[parseMonth(p.claimMonth).getMonth()]}) · ปิดรับ ${parseDay(p.deadline).getDate()} ${TH_MON[dm.getMonth()]}`;
    $('btnReview').textContent = `ตรวจคำขอที่รอ (${pending.length})`;
    $('period').innerHTML = periodAdminHtml(p);
    $('sSub').innerHTML = statHtml(pending.length, 'รอตรวจ');
    $('sRet').innerHTML = statHtml(by('returned'), 'ส่งกลับแก้ไข');
    $('sSign').innerHTML = statHtml(`${by('sign')} · ${by('self')}`, 'รอเซ็น · รอรับเอกสาร (ปริ้นเอง)');
    $('sDone').innerHTML = statHtml(inRound.filter((c) => ['sent_to_finance', 'paid'].includes(c.status)).length, 'ส่งการเงินแล้ว (รอบนี้)');

    $('rows').innerHTML = pending.slice(0, 5).map(pendRow).join('') ||
      `<tr class="empty-row"><td colspan="8">${emptyState('ไม่มีคำขอรอตรวจ', 'คำขอที่ผู้ใช้ยื่นใหม่จะขึ้นที่นี่')}</td></tr>`;

    const roles = ['instructor', 'ta', 'student_helper'].map((r) => {
      const list = inRound.filter((c) => c.role === r);
      return `<li><div><b>${esc(ROLE_TH[r] === 'ผู้ช่วยสอน' ? 'TA' : ROLE_TH[r])}</b><small>${num(list.reduce((s, c) => s + Number(c.totalAmount || 0), 0))} ฿</small></div><span><b>${list.length}</b> คำขอ</span></li>`;
    });
    $('byRole').innerHTML = `<div class="card-head"><h3 id="roleTitle">คำขอทั้งหมด (รอบนี้)</h3><span class="tag">${inRound.length} คำขอ</span></div>
      <ul class="role-list">${roles.join('')}</ul>`;
  } catch (err) {
    $('top').hidden = true;
    document.querySelector('.admin-mid').hidden = true;
    showErrorState($('msg'), 'โหลดภาพรวมไม่สำเร็จ', err, () => { $('top').hidden = false; document.querySelector('.admin-mid').hidden = false; load(); });
    $('msg').classList.add('card');
  }
}

async function initAdmin() {
  const user = await initPage(STAFF);
  if (!user) return;
  $('hello').textContent = `สวัสดี ${displayName(user) || 'เจ้าหน้าที่'}`;
  showFlash();
  load();
}

document.addEventListener('DOMContentLoaded', initAdmin);
