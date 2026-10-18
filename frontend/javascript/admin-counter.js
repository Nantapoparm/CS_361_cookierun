// admin-counter.js — เคาน์เตอร์เซ็นเอกสาร (Figma AD5) · รับเอกสารที่ปริ้นเอง (AD7) · ยืนยันส่งการเงิน (AD6)
// แท็บ sign = ตรวจผ่านแล้ว ช่องทาง sign_with_staff (เจ้าหน้าที่ต้องพิมพ์ให้) ; แท็บ self = ช่องทาง self_print (ผู้ขอปริ้นเอง)
// Input : GET /admin/claims (สถานะ approved + documents_received)
// Output: พิมพ์ → GET /claims/{id}/pdf แล้ว POST /admin/claims/{id}/printed (กันพิมพ์ซ้ำ)
//         ติ๊กเซ็นแล้ว / รับเอกสารแล้ว → POST /admin/claims/{id}/documents-received
//         ส่งการเงินเป็นชุด (ทั้ง 2 แท็บ) → POST /admin/claims/send-to-finance { claimIds }

let all = [];
let tab = 'sign';
const inTab = (c) => (tab === 'self' ? c.printMethod === 'self_print' : c.printMethod !== 'self_print');
const waiting = () => all.filter((c) => c.status === 'approved' || c.status === 'documents_received');
const received = () => all.filter((c) => c.status === 'documents_received');
const unprinted = () => all.filter((c) => c.status === 'approved' && c.printMethod !== 'self_print' && !c.printedAt);

function list() {
  const q = $('fSearch').value.trim().replace(/^#/, '').toLowerCase(), role = $('fRole').value;
  return waiting().filter((c) => inTab(c) && (!role || c.role === role) &&
    (!q || c.claimId.toLowerCase().includes(q) || String(c.requesterName || '').toLowerCase().includes(q)))
    .sort((a, b) => (a.status === 'documents_received') - (b.status === 'documents_received') || String(a.updatedAt).localeCompare(String(b.updatedAt)));
}

const doneChip = () => `<span class="chip done">${tab === 'self' ? 'รับเอกสารแล้ว' : 'เซ็นแล้ว'}</span>`;
const row = (c) => {
  const got = c.status === 'documents_received';
  const act = tab === 'self' || got
    ? `<a class="btn ghost sm" href="admin-review.html?id=${encodeURIComponent(c.claimId)}">${tab === 'self' && !got ? 'เทียบฉบับตรวจ' : 'เปิด'}</a>`
    : `<button type="button" class="btn ghost sm" data-print="${esc(c.claimId)}">${c.printedAt ? 'พิมพ์ซ้ำ' : 'พิมพ์'}</button>`;
  return `<tr class="${got ? 'got' : ''}">
    <td class="ck"><input type="checkbox" data-recv="${esc(c.claimId)}" aria-label="${tab === 'self' ? 'รับเอกสารแล้ว' : 'เซ็นแล้ว'} #${esc(c.claimId)}"${got ? ' checked disabled' : ''}></td>
    <td class="id">#${esc(c.claimId)}</td>
    <td data-label="บทบาท">${roleTag(c.role)}</td>
    <td data-label="ผู้ขอ" class="who">${esc(c.requesterName)}</td>
    <td data-label="รายการ">${esc(itemLabel(c))}</td>
    <td data-label="บาท" class="num">${num(c.totalAmount)}</td>
    <td data-label="สถานะ" class="st">${got ? doneChip() : chip(c.status, c.printMethod)}${!got && tab === 'sign' ? `<small>${c.printedAt ? `พิมพ์แล้ว ${esc(shortDay(c.printedAt))}` : 'ยังไม่พิมพ์'}</small>` : ''}</td>
    <td class="act">${act}</td>
  </tr>`;
};

function render() {
  document.querySelectorAll('[data-tab]').forEach((b) => {
    const n = waiting().filter((c) => (b.dataset.tab === 'self' ? c.printMethod === 'self_print' : c.printMethod !== 'self_print')).length;
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
    b.textContent = `${b.dataset.tab === 'self' ? 'รับเอกสารที่ปริ้นเอง' : 'รอเซ็นที่เคาน์เตอร์'} ${n}`;
  });
  const rows = list();
  const pending = rows.filter((c) => c.status === 'approved').length;
  $('lead').textContent = tab === 'self'
    ? `คำขอที่ตรวจผ่านแล้ว ผู้ขอปริ้นและเซ็นเอง · รอนำส่งเอกสาร ${pending} รายการ`
    : `คำขอที่ตรวจผ่านแล้ว รอผู้ขอมาเซ็นด้วยปากกาน้ำเงิน · ${pending} รายการ`;
  $('hint').innerHTML = alertBox('info', '', tab === 'self'
    ? 'เมื่อผู้ขอนำเอกสารมาส่ง: ค้นหาเลขที่คำขอ → เทียบกับฉบับที่ตรวจผ่าน (ชั่วโมง / ยอดเงิน / วันที่) และลายเซ็นปากกาน้ำเงินครบทุกแถว → ติ๊ก "รับเอกสารแล้ว" → ผู้ขอเห็นสถานะทันที'
    : 'เมื่อผู้ขอมาที่เคาน์เตอร์: ค้นหาชื่อ → ให้เซ็นเอกสารที่พิมพ์ไว้ → ติ๊ก "เซ็นแล้ว" → รวมส่งการเงินครั้งเดียวท้ายรอบ');
  $('ckHead').textContent = tab === 'self' ? 'รับเอกสารแล้ว' : 'เซ็นแล้ว';
  const up = unprinted();
  $('btnPrintAll').hidden = tab !== 'sign' || !up.length;
  $('btnPrintAll').textContent = `พิมพ์ทั้งหมดที่ยังไม่พิมพ์ (${up.length})`;

  $('rows').innerHTML = rows.map(row).join('') ||
    `<tr class="empty-row"><td colspan="8">${emptyState(tab === 'self' ? 'ไม่มีเอกสารรอรับ' : 'ไม่มีคำขอรอเซ็น', 'คำขอที่เจ้าหน้าที่ตรวจผ่านจะขึ้นที่นี่')}</td></tr>`;

  // แถบส่งการเงิน: รวมคำขอที่รับเอกสารแล้วทั้ง 2 แท็บ
  const got = received();
  const sign = got.filter((c) => c.printMethod !== 'self_print').length, self = got.length - sign;
  const sum = got.reduce((s, c) => s + Number(c.totalAmount || 0), 0);
  $('bar').innerHTML = `<span>${tab === 'self' ? `รับเอกสารแล้ว <b>${self}</b> รายการ · ส่งการเงินรวมกับแท็บเคาน์เตอร์ในรอบเดียว` : `เซ็นแล้ว <b>${sign}</b> + รับเอกสารปริ้นเอง <b>${self}</b> · รวม <b>${num(sum)}</b> บาท`}</span>
    <button type="button" class="btn" id="btnFinance"${got.length ? '' : ' disabled'}>${tab === 'self' ? 'ส่งการเงิน (รวมแท็บเคาน์เตอร์)' : 'ส่งการเงิน'} (${got.length})</button>`;
  $('btnFinance').addEventListener('click', sendFinance);
}

async function load() {
  $('msg').innerHTML = '';
  $('rows').innerHTML = `<tr class="empty-row"><td colspan="8">${skeleton(['', '', ''])}</td></tr>`;
  try {
    all = (await api.adminClaims()).items.filter((c) => ['approved', 'documents_received'].includes(c.status));
    render();
  } catch (err) {
    showErrorState($('tableCard'), 'โหลดรายการไม่สำเร็จ', err, () => location.reload());
    $('bar').innerHTML = '';
  }
}

// ติ๊กเซ็นแล้ว / รับเอกสารแล้ว → documents_received ทันที (ย้อนกลับไม่ได้ จึงถามยืนยันก่อน)
async function receive(id, box) {
  const c = all.find((x) => x.claimId === id);
  const self = c.printMethod === 'self_print';
  const ok = await openModal({
    title: self ? `รับเอกสาร #${id}?` : `${c.requesterName} เซ็นแล้ว?`,
    lead: self ? 'ยืนยันว่าเทียบกับฉบับที่ตรวจผ่านแล้ว และลายเซ็นปากกาน้ำเงินครบทุกแถว' : 'ยืนยันว่าผู้ขอเซ็นเอกสารที่พิมพ์ไว้ครบทุกแถวแล้ว',
    okText: self ? 'รับเอกสารแล้ว' : 'เซ็นแล้ว',
    onOk: async () => { try { Object.assign(c, await api.receiveDocs(id)); } catch (err) { throw new Error(errorText(err)); } }
  });
  if (!ok) { box.checked = false; return; }
  toast(`${self ? 'ติ๊กรับเอกสาร' : 'บันทึกเซ็นแล้ว'} #${id} แล้ว · ระบบแจ้งผู้ขอให้อัตโนมัติ`);
  render();
}

async function printRows(ids) {
  const items = all.filter((c) => ids.includes(c.claimId));
  const done = await printClaims(items);
  done.forEach((d) => Object.assign(all.find((c) => c.claimId === d.claimId), d));
  if (done.length) toast(`บันทึกว่าพิมพ์แล้ว ${done.length} รายการ`);
  render();
}

// AD6 — ยืนยันส่งการเงินเป็นชุด
async function sendFinance() {
  const got = received();
  const sum = got.reduce((s, c) => s + Number(c.totalAmount || 0), 0);
  const ok = await openModal({
    eyebrow: 'ยืนยันส่งการเงิน',
    title: `ส่ง ${got.length} รายการให้การเงิน?`,
    body: `<ul class="fin-list">${got.map((c) => `<li><span>#${esc(c.claimId)} · ${esc(c.requesterName)}${c.printMethod === 'self_print' ? ' <small>(ปริ้นเซ็นเอง)</small>' : ''}</span><b>${num(c.totalAmount)}</b></li>`).join('')}
        <li class="sum"><span>รวม ${got.length} รายการ</span><b>${num(sum)} บาท</b></li></ul>
      ${alertBox('warn', '', 'สถานะจะเปลี่ยนเป็น "ส่งการเงินแล้ว" และผู้ขอจะได้รับแจ้ง · ยืนยันว่าเอกสารฉบับจริงที่เซ็นแล้วอยู่ครบ')}`,
    okText: 'ยืนยันส่งการเงิน',
    onOk: async () => { try { await api.sendToFinance(got.map((c) => c.claimId)); } catch (err) { throw new Error(errorText(err)); } }
  });
  if (!ok) return;
  toast(`ส่งการเงิน ${got.length} รายการแล้ว · รวม ${num(sum)} บาท`);
  load();
}

async function init() {
  const user = await initPage(STAFF);
  if (!user) return;
  tab = new URLSearchParams(location.search).get('tab') === 'self' ? 'self' : 'sign';
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    history.replaceState(null, '', tab === 'self' ? '?tab=self' : 'admin-counter.html');
    render();
  }));
  $('fSearch').addEventListener('input', render);
  $('fRole').addEventListener('change', render);
  $('rows').addEventListener('change', (e) => { const b = e.target.closest('[data-recv]'); if (b?.checked) receive(b.dataset.recv, b); });
  $('rows').addEventListener('click', (e) => { const b = e.target.closest('[data-print]'); if (b) printRows([b.dataset.print]); });
  $('btnPrintAll').addEventListener('click', () => printRows(unprinted().map((c) => c.claimId)));
  showFlash();
  load();
}

document.addEventListener('DOMContentLoaded', init);
