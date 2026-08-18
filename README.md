# Chat App

Hướng dẫn cài đặt và chạy dự án (client React/Vite + server Express/Socket.IO/MongoDB).

## Yêu cầu

- Node.js >= 18 (server dùng `fetch` gốc của Node cho Cloudflare Turnstile)
- MongoDB (Atlas hoặc local)
- Tài khoản Cloudinary (upload ảnh/avatar) — bắt buộc
- Tài khoản SMTP gửi email (Brevo hoặc bất kỳ dịch vụ SMTP nào) — bắt buộc (gửi OTP đăng ký/quên mật khẩu)

## Cài đặt

```bash
git clone <repo-url>
cd chat_server

cd server && npm install
cd ../client && npm install
```

## Cấu hình `.env`

```bash
cd server && cp .env.example .env
cd ../client && cp .env.example .env
```

Generate 2 secret bắt buộc cho `server/.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # -> ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"   # -> JWT_SECRET
```

Điền tiếp `MONGO_URI`, `CLOUDINARY_*`, `SMTP_*` vào `server/.env`. `client/.env` giữ nguyên mặc định `localhost` nếu chạy local, không cần sửa.

### Biến môi trường — `server/.env`

| Biến | Bắt buộc? | Ghi chú |
|---|---|---|
| `PORT` | Có | Mặc định `5000` |
| `MONGO_URI` | Có | Connection string MongoDB |
| `JWT_SECRET` | Có | Sinh bằng lệnh ở trên |
| `CLIENT_URL` | Có | Danh sách origin client, phân tách bằng dấu phẩy (CORS + Socket.IO) |
| `ENCRYPTION_KEY` | Có | Sinh bằng lệnh ở trên — thiếu thì server crash ngay lúc khởi động (chủ đích, không cho chạy với key yếu) |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Có | Upload ảnh/avatar/tệp |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Có | Gửi email OTP |
| `JWT_SECRETS` / `JWT_SECRET_CURRENT_KID` | Không | Xoay vòng JWT secret — bỏ trống thì tự dùng `JWT_SECRET` làm keyring 1 phần tử |
| `TRUST_PROXY_HOPS` | Không | Chỉ đặt >0 khi thật sự chạy sau reverse proxy (Cloudflare...), mặc định `0` an toàn cho local |
| `TURNSTILE_SECRET_KEY` | Không | Cloudflare Turnstile (CAPTCHA) cho đăng ký/đăng nhập/quên mật khẩu — bỏ trống thì bỏ qua verify |
| `OPENAI_API_KEY` | Không | Kiểm duyệt nội dung bằng AI — bỏ trống thì dùng bộ lọc từ khóa local |
| `SAFE_BROWSING_API_KEY` | Không | Google Safe Browsing khi có người gửi link — bỏ trống thì coi mọi link là an toàn |

### Biến môi trường — `client/.env`

| Biến | Bắt buộc? | Ghi chú |
|---|---|---|
| `VITE_API_URL` | Có | Mặc định `http://localhost:5000/api` |
| `VITE_SERVER_URL` | Có | Mặc định `http://localhost:5000` (Socket.IO) |
| `VITE_TURNSTILE_SITE_KEY` | Không | Khớp với `TURNSTILE_SECRET_KEY` phía server — bỏ trống thì widget CAPTCHA không hiện |

## Chạy

```bash
# Terminal 1
cd server && npm run dev     # http://localhost:5000

# Terminal 2
cd client && npm run dev     # http://localhost:5173
```

## Tạo tài khoản admin đầu tiên (tùy chọn)

Đăng ký 1 tài khoản qua UI trước, sau đó:

```bash
cd server
node src/scripts/set-admin.js <email_hoặc_username>
```

