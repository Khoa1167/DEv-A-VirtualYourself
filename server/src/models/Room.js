const mongoose = require('mongoose');
const crypto   = require('crypto');

const roomSchema = new mongoose.Schema({
  name:        { type: String, trim: true },
  description: { type: String, default: '' },
  isPrivate:   { type: Boolean, default: false },
  isDM:        { type: Boolean, default: false },
  inviteCode:  {
    type: String,
    default: () => crypto.randomBytes(6).toString('hex'), // mã 12 ký tự ngẫu nhiên
  },
  // Link/QR mời hết hạn sau 7 ngày — reset lại khi chủ phòng bấm "Tạo lại link" (PUT /:id/rotate-invite)
  inviteCodeExpiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  },
  members:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  admins:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  // 'open': join ngay (browse-list hoặc link mời). 'approval': vào hàng chờ, chủ phòng/admin duyệt.
  joinPolicy:      { type: String, enum: ['open', 'approval'], default: 'open' },
  pendingRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  // Lời mời đích danh do admin/chủ phòng gửi qua "Thêm thành viên" — người được mời tự
  // accept/decline, khác pendingRequests (người ngoài tự xin vào, admin duyệt).
  pendingInvites:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  // Epoch hiện tại của Sender Key mã hóa nhóm — tăng lên khi rotate khóa (server/src/routes/rooms.js PUT /:id/rotate-key)
  senderKeyEpoch: { type: Number, default: 0 },
}, { timestamps: true });

// Room.find({members: userId}) chạy ở MỖI lần connect socket (join lại toàn bộ phòng) + mọi route
// kiểm tra quyền thành viên — không có index này là quét toàn bộ collection Room mỗi lần.
roomSchema.index({ members: 1 });

// GET /api/rooms/all lọc theo isPrivate:false — collection nhỏ hơn Message nhiều nên ưu tiên thấp
// hơn, nhưng vẫn nên có khi danh sách phòng công khai lớn dần.
roomSchema.index({ isPrivate: 1 });

// Partial unique index thay vì unique:true thẳng trên field — có sẵn 1 số phòng cũ (từ trước khi
// field này tồn tại) đang inviteCode:null trong DB, unique index thường sẽ NGAY LẬP TỨC lỗi
// E11000 (2 document cùng null coi là trùng). Loại các document không có string hợp lệ ra khỏi
// ràng buộc unique — không cần đụng tới data cũ mà index vẫn build và enforce đúng cho phòng mới.
roomSchema.index(
  { inviteCode: 1 },
  { unique: true, partialFilterExpression: { inviteCode: { $type: 'string' } } }
);

module.exports = mongoose.model('Room', roomSchema);