# Chat App - Hướng Dẫn Cài Đặt & Chạy
## Yêu cầu
- [Node.js](https://nodejs.org/) v18+
- [MongoDB](https://www.mongodb.com/) (local hoặc Atlas)
- Tài khoản [Cloudinary](https://cloudinary.com/) (upload ảnh/file)
- Tài khoản SMTP để gửi email OTP (Gmail, Brevo...)
## 1. Clone dự án
```bash
git clone https://github.com/Khoa1167/Chat-app.git
cd Chat-app
```
## 2. Cài đặt Server
```bash
cd server
npm install
```
Tạo file `server/.env` (copy từ `.env.example`):
```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/chatapp
JWT_SECRET=your_jwt_secret_key_here
CLIENT_URL=http://localhost:5173
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=your_smtp_user
SMTP_PASS=your_smtp_password
SMTP_FROM=your_sender_email@domain.com
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
ENCRYPTION_KEY=your_32_byte_hex_key
```
Chạy Server:
```bash
npm run dev
```
Server chạy tại `http://localhost:5000`
## 3. Cài đặt Client
Mở terminal mới:
```bash
cd client
