const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  content:   { type: String, required: true, maxlength: 2000 },
  sender:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  room:      { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
  type:      { type: String, enum: ['text', 'image', 'system', 'audio', 'file'], default: 'text' },
  fileName:  { type: String, default: null },
  replyTo:   { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  forwardedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  reactions: [{ emoji: String, users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }] }],
  isDeleted: { type: Boolean, default: false },
  isEdited:  { type: Boolean, default: false },
  iv:           { type: String, default: null },
  tag:          { type: String, default: null },
  encryptedKey: { type: String, default: null },
  encryptedKeys:{ type: Map, of: String, default: {} }, // Map: deviceId -> encryptedSessionKey (Hex)
  // Sender Key (nhóm) — 'sender-key' dùng khóa AES tĩnh theo epoch thay vì RSA-wrap từng thiết bị mỗi tin nhắn
  scheme:         { type: String, enum: ['rsa-per-device', 'sender-key'], default: 'rsa-per-device' },
  senderDeviceId: { type: String, default: null },
  epoch:          { type: Number, default: null },
  // Tin nhắn tự hủy — do NGƯỜI GỬI chọn lúc gửi (không ai khác đổi được), khóa cứng ngay lúc tạo.
  // expires: 0 tạo TTL index trên chính giá trị Date lưu ở đây — MongoDB tự xóa document đúng lúc
  // expiresAt (background thread quét ~60s/lần, chấp nhận trễ vài chục giây so với giờ hiển thị).
  expiresAt: { type: Date, default: null, expires: 0 },
}, { timestamps: true });

// Truy vấn nặng nhất và thường xuyên nhất của cả app: GET /:id/messages lọc theo room + sắp xếp
// createdAt giảm dần (phân trang) — không có index này thì mỗi lần mở 1 đoạn chat là quét toàn bộ
// collection Message (mọi phòng cộng lại), càng nhiều tin nhắn càng chậm dần theo thời gian.
messageSchema.index({ room: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);