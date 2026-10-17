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


