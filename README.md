# 💬 Secure E2EE Chat & WebRTC Call Application

Ứng dụng trò chuyện thời gian thực (Real-time Chat App) bảo mật cao được xây dựng trên kiến trúc **Zero-Knowledge Server**, hỗ trợ **Mã hóa đầu-cuối (End-to-End Encryption - E2EE)**, **Cuộc gọi Audio/Video 1-1 (WebRTC)**, cùng hệ thống **Kiểm duyệt nội dung & Bảo mật nhiều lớp**.

---

## 🌟 Tính Năng Nổi Bật

### 🔒 1. Bảo Mật & Mã Hóa Đầu-Cuối (E2EE)
* **Zero-Knowledge Architecture:** Máy chủ chỉ đóng vai trò trung chuyển bản mã (Relay), không thể đọc hay giải mã nội dung tin nhắn.
* **Mã hóa RSA-OAEP 2048-bit & AES-256-GCM:** Cặp khóa RSA được sinh trực tiếp trên trình duyệt (Web Crypto API). Mỗi tin nhắn sử dụng một AES Session Key riêng biệt.
* **Safety Number (Key Fingerprint):** Tạo mã vân tay khóa 60 chữ số (`computeFingerprint`) giúp người dùng đối chiếu xác minh danh tính.
* **Sao lưu & Khôi phục Khóa riêng (Key Backup & Recovery):** Mã hóa Private Key bằng mật khẩu bảo vệ (Passphrase) với thuật toán PBKDF2 (600,000 lần lặp).
* **Quản lý Thiết Bị (Device Management):** Đăng ký, gia hạn token 7 ngày, xoay khóa (Key Rotation) và gỡ bỏ thiết bị an toàn.

### 💬 2. Nhắn Tin Thời Gian Thực (Real-time Messaging)
* **Đa dạng loại tin nhắn:** Tin nhắn văn bản, hình ảnh, tin nhắn thoại (Voice Memo/Audio Recording), tệp tài liệu (tối đa 50MB).
* **Tương tác tin nhắn:** 
  * 😃 **Reactions:** Thả cảm xúc emoji trên tin nhắn.
  * ↩️ **Reply:** Trả lời trực tiếp tin nhắn cụ thể.
  * ↪️ **Forward:** Chuyển tiếp tin nhắn sang các phòng chat khác.
  * ✏️ **Edit:** Chỉnh sửa tin nhắn văn bản (chỉ chủ tin nhắn).
  * 🗑️ **Recall/Delete:** Thu hồi tin nhắn ở cả 2 phía.
* **Trạng thái gõ (Typing Indicators):** Hiển thị real-time khi đối phương đang nhập tin nhắn.

### 📞 3. Cuộc Gọi Audio & Video 1-1 (WebRTC)
* Kết nối Peer-to-Peer trực tiếp giữa hai trình duyệt qua **WebRTC**.
* Signal chuyển tiếp qua Socket.IO (Offer, Answer, ICE Candidates).
* Hỗ trợ bật/tắt camera, microphone và kết thúc cuộc gọi linh hoạt.

### 👥 4. Quản Lý Bạn Bè & Nhóm Chat
* **Kết bạn:** Tìm kiếm người dùng theo nickname, gửi/chấp nhận/từ chối/hủy lời mời kết bạn.
* **Biệt danh cá nhân (Custom Alias):** Đặt tên gợi nhớ riêng cho từng người bạn.
* **Xem Hồ sơ (Profile):** Xem thông tin cá nhân, bạn chung, nhóm chung, ẩn/mặt hóa (mask) email/SĐT đối với người lạ.
* **Quản lý Phòng chat:** Tự động tạo phòng DM khi kết bạn, tạo nhóm chat công khai (Public) hoặc riêng tư (Private).

### 🛡️ 5. Kiểm Duyệt & Chống Phá Hoại (Moderation & Anti-Abuse)
* **Google Safe Browsing Proxy:** Tự động quét và cảnh báo các liên kết chứa mã độc/phishing.
* **Kiểm duyệt ngôn từ (Content Moderation):** Tự động phát hiện từ ngữ độc hại/xúc phạm qua thuật toán Local NLP hoặc OpenAI Moderation API.
* **Hệ thống Báo cáo (Report System):** 
  * Cooldown & Shadow Throttling chống spam báo cáo.
  * Điểm tin cậy báo cáo (Report Trust Score) & Thuật toán chống báo cáo hội đồng (Anti-Brigading).
  * Đối chiếu tính toàn vẹn bản mã SHA-256 trước khi gửi Admin xử lý.
* **Bảo vệ Hệ thống (Security Rate Limiting):** Giới hạn tần suất đăng nhập (chống Brute-force), giới hạn gửi tin nhắn (8 msgs/5s), bảo vệ truy vấn MongoDB (Chống NoSQL Injection).

---

## 🛠️ Công Nghệ Sử Dụng (Tech Stack)

| Phân loại | Công nghệ |
|---|---|
| **Frontend** | React 18, Vite, Tailwind CSS, DaisyUI, Web Crypto API, WebRTC Native API |
| **Backend** | Node.js, Express.js, Socket.IO |
| **Database** | MongoDB + Mongoose ODM |
| **Lưu trữ Media** | Cloudinary API (Images, Audios, Files) |
| **Bảo mật & Email** | JWT, Bcrypt, AES-256-GCM, SHA-256, Nodemailer (Email OTP) |

---

## 📁 Cấu Trúc Dự Án

```text
chat_server/
├── client/                     # Mã nguồn Frontend (React + Vite)
│   ├── src/
│   │   ├── components/         # Auth, Chat, Profile, Settings components
│   │   ├── context/            # AuthContext, SocketContext, ThemeContext
│   │   ├── hooks/              # Custom React Hooks
│   │   ├── utils/              # e2ee.js (Web Crypto), securityScan.js
│   │   ├── pages/              # ChatPage chính
│   │   ├── App.jsx
│   │   └── main.jsx
│   └── vite.config.js
│
├── server/                     # Mã nguồn Backend (Node.js + Express)
│   ├── src/
│   │   ├── config/             # Kết nối DB, Cloudinary, Mailer
│   │   ├── middleware/         # Auth JWT, Sanitize NoSQL
│   │   ├── models/             # User, Message, Room, Friendship, Report...
│   │   ├── routes/             # auth, users, rooms, friends, report, security
│   │   ├── services/           # Moderation service (NLP / OpenAI)
│   │   ├── socket/             # Real-time socket event handlers
│   │   ├── utils/              # Crypto (AES-256-GCM, Blind Index)
│   │   └── index.js            # Server Entry Point
│   └── package.json
│
└── README.md
