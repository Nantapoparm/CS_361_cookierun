// admin.js — หน้าแรกของเจ้าหน้าที่ (Figma AD1) เปิดได้เฉพาะบทบาท admin
// ตอนนี้มีแค่โครงหน้า + แถบด้านบนของเจ้าหน้าที่ เนื้อหา Dashboard ทำใน V3-15

async function initAdmin() {
  const user = await initPage(STAFF);
  if (!user) return;
  $('hello').textContent = `สวัสดี ${displayName(user) || 'เจ้าหน้าที่'}`;
  $('body').innerHTML = emptyState('หน้าเจ้าหน้าที่กำลังพัฒนา', 'ภาพรวมรอบการเบิก รายการคำขอ และเคาน์เตอร์เซ็นเอกสาร จะเปิดใช้งานในรอบถัดไป');
}

document.addEventListener('DOMContentLoaded', initAdmin);
