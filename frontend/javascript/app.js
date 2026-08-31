// app.js — จุดเริ่มทำงาน: โหลดข้อมูล → เรนเดอร์โครง → เรนเดอร์ทุกหัวข้อ → เปิด scroll spy
// ต้องโหลดเป็นไฟล์สุดท้าย (ใช้ของจาก core.js, layout.js, sections.js)

async function boot() {
  try {
    const site = await loadJSON('site.json');

    // โหลดไฟล์ของทุกหัวข้อพร้อมกัน ไม่ต้องรอทีละไฟล์
    const contents = await Promise.all(
      site.sections.map((s) => loadJSON(`sections/${s.id}.json`))
    );

    renderTopbar(site);
    renderHero(site);
    renderSidebar(site);
    renderFooter(site);

    mount('sections', site.sections
      .map((meta, i) => renderSection(meta, contents[i]))
      .join(''));

    initScrollSpy();

    document.title = `${site.meta.siteTitle} | ${site.meta.siteTitleEn}`;
  } catch (err) {
    mount('sections',
      '<p class="boot">ไม่สามารถโหลดข้อมูลได้ กรุณาเปิดเว็บไซต์ผ่าน web server ' +
      '(ไม่ใช่การเปิดไฟล์ตรงๆ ด้วย file://)</p>');
    console.error('โหลดข้อมูลไม่สำเร็จ:', err);
  }
}

document.addEventListener('DOMContentLoaded', boot);
