**User Pool ID**
us-east-1_tGEzAfQt2

**App Client ID**
5ikoqjohoavik8c91f3ph9qeck

**Groups**
instructor
ta
student_helper
admin

**Users**
instructor
ta
student_helper
admin

**วิธีจัดเก็บ Token**
Token เก็บอยู่ใน localStorage
- cognito_id_token        | อ่านกลุ่ม cognito:groups เพื่อหา role
- cognito_access_token    | แนบกับ request ไป backend
- cognito_refresh_token   | ต่ออายุ Access/ID Token

เหตุผล
- เปิดได้หลายแท็บ และการ login ใช้ร่วมกันทุกแท็บ
- session ยังอยู่หลังปิดเบราว์เซอร์ ตราบที่ Refresh Token ยังไม่หมดอายุ


**การทดสอบ Login ผ่าน Console**
คัดลอกคำสั่งด้านล่างลง Console หน้า index.html
- await t.login("user", "pass")
- await t.logout()
- await t.getToken()
- t.getUserRole()

```js
window.t = {
  async login(u, p) {
    try {
      const r = await Auth.login(u, p);
      console.log("user:", u);
      console.log("userRole:", r.userRole);
      console.log("groups:", r.groups);
      console.log("isLoggedIn:", await Auth.isLoggedIn());
      console.log("token:", await Auth.getToken());
    } catch (e) {
      console.log("error:", e.code, "-", e.message);
    }
  },

  async logout() {
    await Auth.logout();
    console.log("logout แล้ว");
    console.log("userRole:", Auth.getUserRole());
    console.log("isLoggedIn:", await Auth.isLoggedIn());
    console.log("token:", await Auth.getToken());
  },

  async getToken() {
    const token = await Auth.getToken();
    console.log("token:", token);
    return token;
    },

  getUserRole() {
    const role = Auth.getUserRole();
    console.log("userRole:", role);
    return role;
  },
};
```