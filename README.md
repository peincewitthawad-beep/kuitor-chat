# คุยต่อ — GitHub Pages + Supabase

เว็บแชตไทยแบบ **static site** ไม่มีเซิร์ฟเวอร์ Python ต้องเปิดค้างไว้ ข้อมูลแชตและบัญชีอยู่ใน Supabase ส่วนหน้าเว็บอยู่บน GitHub Pages

## ทำอะไรได้บ้าง

- สมัครบัญชีด้วยอีเมลและรหัสผ่าน / ล็อกอิน / ล็อกเอาต์ / รีเซ็ตรหัสผ่านทางอีเมล
- กลับมาล็อกอินด้วยบัญชีเดิมแล้วเปิดประวัติแชตจากคลาวด์ได้ แม้ปิดแอปหรือเปลี่ยนอุปกรณ์
- สร้างห้องแชต แชร์ลิงก์หรือรหัสเชิญ และเข้าร่วมห้องจากลิงก์
- ข้อความแบบ Realtime (Supabase Postgres Changes) พร้อมตรวจข้อความเพิ่มทุก ~12 วินาทีเมื่อเปิดเว็บ เผื่อ Realtime หลุด
- โหลดข้อความเก่าครั้งละ 50 รายการ; เก็บข้อความในฐานข้อมูลไม่ใช่ localStorage
- จดจำรายการอุปกรณ์ที่ล็อกอินแล้วและเวลาที่ใช้งานล่าสุด (การล้าง storage จะสร้าง device ID ใหม่)
- เจ้าของห้องสามารถรีเซ็ตลิงก์เชิญได้
- เข้าถึงห้องและข้อความผ่าน Row Level Security (RLS): เฉพาะสมาชิกห้องอ่านและส่งข้อความได้

> **ไม่ใช่โปรแกรมรีโมตคอมพิวเตอร์:** การปิดเว็บยุติการเชื่อมต่อสด; เซิร์ฟเวอร์เก็บข้อความไว้ให้ดึงเมื่อกลับมาใหม่ ไม่มี Push Notification ตอนปิดเบราว์เซอร์ ไม่มีการเข้าถึงกล้อง/หน้าจอ/ไฟล์ขณะปิดแอป และระบบ **ไม่ได้เข้ารหัสแบบ end-to-end** (ผู้ดูแลโปรเจกต์ Supabase ที่มีสิทธิ์เข้าถึงฐานข้อมูลอาจอ่านข้อความได้)

## การเปิดใช้งานครั้งแรก

### 1. สร้างโปรเจกต์ Supabase

1. เข้า https://supabase.com/dashboard แล้วสร้าง Project
2. เข้า **SQL Editor → New Query** วางเนื้อหาไฟล์ `supabase.sql` ทั้งหมด แล้วกด Run (ควรใช้ในโปรเจกต์ใหม่ เพราะ SQL สร้าง/แก้ตารางและ policy ที่ใช้ชื่อเดียวกัน)
3. ไป **Authentication → Providers → Email** ตรวจสอบว่า Email sign-in เปิดอยู่ แนะนำให้เปิด email confirmation เมื่อใช้งานจริง
4. จาก **Connect** หรือ **Project Settings → API / API Keys** จด `Project URL` และ **Publishable key** ที่ขึ้นต้น `sb_publishable_...` (ถ้าใช้ legacy anon JWT ก็รองรับ)
5. แก้ `config.js` ดังนี้:

```js
window.KUITOR_CONFIG = {
  supabaseUrl: "https://your-project-id.supabase.co",
  supabasePublishableKey: "sb_publishable_your_actual_key"
};
```

**สำคัญ:** `sb_publishable_...` เป็นคีย์สำหรับหน้าเว็บและเผยแพร่ได้ภายใต้ RLS แต่ **ห้าม** ใส่ `sb_secret_...`, `service_role`, database password, access token ส่วนตัว หรือ API secrets ลงในไฟล์หรือ GitHub เด็ดขาด ให้ใช้ RLS ที่อยู่ใน `supabase.sql` เสมอ

### 2. นำไฟล์ขึ้น GitHub

1. เข้า https://github.com/new สร้าง repository ชื่อเช่น `kuitor-chat`
2. อัปโหลดไฟล์ **ทั้งหมดจากโฟลเดอร์นี้** ไปที่ root ของ repository โดยต้องมี `index.html`, `styles.css`, `app.js`, `config.js`, `supabase.sql`, `favicon.svg` และ `.nojekyll` (README ไม่จำเป็นต่อเว็บแต่ควรเก็บไว้)
3. กด **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: main → Folder: /(root) → Save**
4. รอ GitHub Pages เผยแพร่ แล้วเปิด URL `https://YOUR_USERNAME.github.io/kuitor-chat/`
5. จาก Supabase เข้า **Authentication → URL Configuration** ตั้ง **Site URL** และเพิ่ม **Redirect URL** เป็น URL GitHub Pages ข้างต้น **รวม `/` ท้ายสุด** (ถ้าใช้ repo ชื่ออื่นให้เปลี่ยนให้ตรง)
6. กลับมาเปิดเว็บด้วยลิงก์นั้น สมัครบัญชี และตรวจอีเมลยืนยัน (หากเปิดยืนยันอีเมล)

GitHub Pages คือ static hosting และ **จะไม่รัน** Python/FastAPI/SQLite เดิม ต้องใช้ชุดไฟล์นี้แทน โปรเจกต์และหน้าเว็บที่เผยแพร่มีคนเข้าถึงได้ จึงห้ามใส่ความลับไว้ใน repo หรือ HTML/JS

### 3. ทดลองคุยข้ามอุปกรณ์

1. เปิดเว็บบนคอม สมัครบัญชี A แล้วล็อกอิน
2. สร้างห้องและกด **แชร์ห้อง** เพื่อคัดลอกลิงก์
3. เปิดลิงก์นั้นบนมือถือหรือเบราว์เซอร์อื่น สมัคร/ล็อกอินเป็นบัญชี B แล้วเข้าห้อง
4. ส่งข้อความกันสองทาง
5. กด **Logout** ทั้งสองอุปกรณ์ แล้วลองล็อกอินอีกครั้ง ข้อความก่อนหน้าจะยังอยู่
6. ลองปิดคอม A แล้วส่งข้อความจาก B: เมื่อ A เปิดเว็บและล็อกอินใหม่ จะอ่านย้อนหลังได้

หากรับข้อความสดไม่ได้ ให้ตรวจว่า `supabase.sql` รันจนจบและ table `public.messages` อยู่ใน publication `supabase_realtime` ผ่าน Database → Publications

## คำแนะนำด้านความปลอดภัย / การปฏิบัติงาน

- ต้องรัน `supabase.sql` **ก่อน** เปิดให้ใช้งาน; อย่าถอด/ปิด RLS เพียงเพื่อแก้ปัญหาการเชื่อมต่อ
- อีเมลและรหัสผ่านจัดการโดย Supabase Auth ไม่ได้เก็บใน repo; รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร
- Link เชิญเข้าห้องคือสิทธิ์การเข้าห้อง ใครมีลิงก์ก็เข้าห้องและอ่านย้อนหลังได้หลังล็อกอิน — ส่งเฉพาะคนที่ไว้วางใจ และกด **รีเซ็ตลิงก์** เมื่อจำเป็น (รีเซ็ตลิงก์ **ไม่ถอดสมาชิกเก่าออก**)
- ไม่มีฟังก์ชันลบข้อความ/สมาชิกหรือ E2EE; ก่อนใช้กับข้อมูลอ่อนไหวควรเพิ่มสมาชิกจัดการ, นโยบายลบข้อมูล, อัตราจำกัดการส่ง และระบบ backup
- จำกัดผู้ใช้/จำนวนห้อง/การเขียนข้อความและ Supabase quotas ตามแพ็กเกจ; ฟรีมีข้อจำกัดและโปรเจกต์ฟรีอาจหยุดชั่วคราวเมื่อไม่ได้ใช้งานนาน จึงไม่รับประกัน uptime 24/7
- บัญชี GitHub และ Supabase ต้องเป็นของเจ้าของระบบ และเปิดใช้งาน MFA ทั้งสองบริการ
- ถ้าจะเปิดบริการสาธารณะ ควรตรวจ Privacy Notice, Anti-abuse/rate limits, email deliverability และแผน backup ก่อน

## วิธีทดสอบหน้าเว็บบนเครื่อง (ยังต้องมี Supabase จริง)

```sh
python -m http.server 8000
```

เปิด `http://localhost:8000` และเพิ่ม URL นี้ใน Supabase Auth Redirect URLs ชั่วคราวหากจะทดสอบการยืนยันอีเมลหรือรีเซ็ตพาสเวิร์ดในเครื่อง

## โครงสร้างไฟล์

```
index.html     หน้าเว็บภาษาไทย Responsive
styles.css     สไตล์ UI
app.js         การล็อกอิน ห้องแชต Realtime และอุปกรณ์
config.js      Publishable key และ URL (ต้องกรอกเองก่อนเผยแพร่)
supabase.sql   ตาราง, ฟังก์ชัน, RLS policies, Realtime publication
favicon.svg   ไอคอน
.nojekyll      ป้องกัน GitHub Pages Jekyll จัดการไฟล์ที่ไม่ต้องการ
```

## การย้ายจากเว็บ Python เดิม

แอป Python เดิมเก็บข้อมูลไว้ใน SQLite (`data/chat.db`) แต่รุ่น GitHub Pages นี้ใช้โครงสร้างข้อมูลและวิธีล็อกอินต่างกัน จึง **ไม่ได้นำบัญชี/ข้อความจาก SQLite เดิมมาให้อัตโนมัติ** ต้องมีขั้นตอน migration เพิ่ม หากเคยเริ่มใช้งานกับข้อมูลจริง

## เอกสารทางการ

- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- https://supabase.com/docs/reference/javascript/installing
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/realtime/subscribing-to-database-changes
