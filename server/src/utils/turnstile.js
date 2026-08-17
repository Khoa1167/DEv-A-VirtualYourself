// Xác minh Cloudflare Turnstile (CAPTCHA) — chặn bot ở form đăng ký/quên mật khẩu trước khi
// chạm rate-limit theo IP/email. Theo mẫu graceful-fallback đã dùng ở services/moderation.js:
// chưa cấu hình TURNSTILE_SECRET_KEY (dev local) thì bỏ qua verify, không bắt buộc mọi người
// phải có tài khoản Cloudflare mới chạy được app.
const verifyTurnstile = async (token, remoteip) => {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) return true; // Chưa cấu hình — coi như không bật Turnstile

  if (!token) return false;

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: secretKey, response: token, remoteip: remoteip || '' }),
    });
    const data = await res.json();
    return !!data.success;
  } catch (err) {
    console.error('Turnstile verify error:', err.message);
    return false; // Lỗi mạng/Cloudflare gián đoạn → chặn (fail-closed), rate-limit làm lưới an toàn phía sau
  }
};

module.exports = { verifyTurnstile };
