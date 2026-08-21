const mongoose = require('mongoose');

const pendingUserSchema = new mongoose.Schema({
  username:       { type: String, required: true },
  hashedPassword: { type: String, required: true },
  email:          { type: String, required: true },
  phone:          { type: String, default: '' },
  otp:            { type: String, required: true },
  expiresAt:      { type: Date, required: true },
  attempts:       { type: Number, default: 0 },
}, { timestamps: true });

// Tự động xóa document khi hết hạn
pendingUserSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Đảm bảo không trùng email
pendingUserSchema.index({ email: 1 }, { unique: true });

// Đảm bảo không có 2 người cùng giữ chỗ 1 username trong lúc chờ xác thực OTP (race condition
// khi 2 người bấm đăng ký cùng username gần như đồng thời) — chặn ngay ở bước insert bằng unique
// index (atomic), thay vì chỉ dựa vào findOne trước đó (có khe hở giữa đọc và ghi).
pendingUserSchema.index({ username: 1 }, { unique: true });

module.exports = mongoose.model('PendingUser', pendingUserSchema);