const router  = require('express').Router();
const crypto  = require('crypto');
const Room    = require('../models/Room');
const User    = require('../models/User');
const Message = require('../models/Message');
const SenderKeyDistribution = require('../models/SenderKeyDistribution');
const { protect } = require('../middleware/auth');
const { decrypt } = require('../utils/crypto');
const multer = require('multer');
const { cloudinary } = require('../config/cloudinary');
const { Readable } = require('stream');
const sendServerError = require('../utils/sendServerError');

const hasEncryptedKeys = (encryptedKeys) => {
  if (!encryptedKeys) return false;
  if (typeof encryptedKeys.size === 'number') return encryptedKeys.size > 0;
  if (typeof encryptedKeys === 'object') return Object.keys(encryptedKeys).length > 0;
  return false;
};

const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Tệp tải lên phải là định dạng âm thanh (audio/*)'), false);
    }
  }
});

const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Tệp tải lên phải là định dạng hình ảnh (image/*)'), false);
    }
  }
});

const uploadFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// GET /api/rooms — lấy danh sách phòng của user
router.get('/', protect, async (req, res) => {
  try {
    const rooms = await Room.find({ members: req.user._id })
      .select('-inviteCode -inviteCodeExpiresAt -pendingRequests')
      .populate('members', 'username nickname avatar isOnline')
      .populate({
        path: 'lastMessage',
        populate: { path: 'sender', select: 'username nickname avatar' }
      })
      .sort({ updatedAt: -1 });

    const decryptedRooms = rooms.map(roomDoc => {
      const room = roomDoc.toObject({ flattenMaps: true });
      if (room.lastMessage && room.lastMessage.content && !room.lastMessage.isDeleted && room.lastMessage.encryptedKey && !hasEncryptedKeys(room.lastMessage.encryptedKeys)) {
        room.lastMessage.content = decrypt(
          room.lastMessage.content,
          room.lastMessage.iv,
          room.lastMessage.tag,
          room.lastMessage.encryptedKey
        );
      }
      return room;
    });

    res.json(decryptedRooms);
  } catch (err) {
    sendServerError(res, err);
  }
});

// POST /api/rooms — tạo phòng mới
router.post('/', protect, async (req, res) => {
  try {
    const { name, description, isPrivate, joinPolicy, members } = req.body;
    const room = await Room.create({
      name,
      description,
      isPrivate: isPrivate || false,
      joinPolicy: joinPolicy === 'approval' ? 'approval' : 'open',
      members: [req.user._id, ...(members || [])],
      admins: [req.user._id],
      createdBy: req.user._id,
    });
    await room.populate('members', 'username nickname avatar isOnline');

    // Phát sự kiện room:added cho tất cả thành viên trong phòng đang online
    const io = req.app.get('socketio');
    if (io) {
      const allSockets = await io.fetchSockets();
      const memberIds = room.members.map(m => m._id.toString());
      allSockets.forEach(s => {
        if (s.data.user && memberIds.includes(s.data.user._id.toString())) {
          s.join(room._id.toString());
          s.emit('room:added', room);
        }
      });
    }

    res.status(201).json(room);
  } catch (err) {
    sendServerError(res, err);
  }
});

// GET /api/rooms/all — lấy tất cả phòng public để tham gia
router.get('/all', protect, async (req, res) => {
  try {
    const rooms = await Room.find({ isPrivate: false })
      .select('-inviteCode -inviteCodeExpiresAt -pendingRequests')
      .populate('members', 'username nickname avatar isOnline')
      .populate({
        path: 'lastMessage',
        populate: { path: 'sender', select: 'username nickname avatar' }
      })
      .sort({ updatedAt: -1 });

    const decryptedRooms = rooms.map(roomDoc => {
      const room = roomDoc.toObject({ flattenMaps: true });
      if (room.lastMessage && room.lastMessage.content && !room.lastMessage.isDeleted && room.lastMessage.encryptedKey && !hasEncryptedKeys(room.lastMessage.encryptedKeys)) {
        room.lastMessage.content = decrypt(
          room.lastMessage.content,
          room.lastMessage.iv,
          room.lastMessage.tag,
          room.lastMessage.encryptedKey
        );
      }
      return room;
    });

    res.json(decryptedRooms);
  } catch (err) {
    sendServerError(res, err);
  }
});

// GET /api/rooms/:id/messages — lấy tin nhắn của phòng
router.get('/:id/messages', protect, async (req, res) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    
    // Kiểm tra xem user có phải thành viên phòng không (Sửa lỗi IDOR)
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ message: 'Phòng không tồn tại' });
    if (!room.members.some(memberId => memberId.toString() === req.user._id.toString())) {
      return res.status(403).json({ message: 'Không có quyền truy cập tin nhắn của phòng này' });
    }

    const messages = await Message.find({
      room: req.params.id,
      isDeleted: false
    })
      .populate('sender', 'username nickname avatar') // Sửa lỗi hiển thị Nickname
      .populate({ path: 'replyTo', select: 'sender content type fileName isDeleted iv tag encryptedKey', populate: { path: 'sender', select: 'username nickname avatar' } })
      .populate({ path: 'forwardedFrom', select: 'sender content iv tag encryptedKey', populate: { path: 'sender', select: 'username nickname' } })
      .populate('reactions.users', 'username nickname')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    // Giải mã tin nhắn và các tin nhắn liên quan trước khi gửi về client
    const decryptedMessages = messages.map(msgDoc => {
      // flattenMaps: encryptedKeys là Mongoose Map, phải flatten thành plain object
      // trước khi res.json() (JSON.stringify(Map) trả về "{}", client sẽ không giải mã được)
      const msg = msgDoc.toObject({ flattenMaps: true });

      if (!msg.isDeleted && msg.content && msg.encryptedKey && !hasEncryptedKeys(msg.encryptedKeys)) {
        msg.content = decrypt(msg.content, msg.iv, msg.tag, msg.encryptedKey);
        msg.isEncryptedAtRest = true;
      }

      if (msg.replyTo && msg.replyTo.content && !msg.replyTo.isDeleted && msg.replyTo.encryptedKey && !hasEncryptedKeys(msg.replyTo.encryptedKeys)) {
        msg.replyTo.content = decrypt(msg.replyTo.content, msg.replyTo.iv, msg.replyTo.tag, msg.replyTo.encryptedKey);
        msg.replyTo.isEncryptedAtRest = true;
      }

      if (msg.forwardedFrom && msg.forwardedFrom.content && !msg.forwardedFrom.isDeleted && msg.forwardedFrom.encryptedKey && !hasEncryptedKeys(msg.forwardedFrom.encryptedKeys)) {
        msg.forwardedFrom.content = decrypt(msg.forwardedFrom.content, msg.forwardedFrom.iv, msg.forwardedFrom.tag, msg.forwardedFrom.encryptedKey);
        msg.forwardedFrom.isEncryptedAtRest = true;
      }

      return msg;
    });

    res.json(decryptedMessages.reverse());
  } catch (err) {
    sendServerError(res, err);
  }
});

// Thêm userDoc vào members ngay (joinPolicy 'open') hoặc vào hàng chờ duyệt ('approval').
// userDoc cần {_id, username, nickname, avatar} — dùng chung bởi /join, /invite/:code và duyệt
// yêu cầu tham gia. Idempotent nếu đã là thành viên.
const addMemberOrRequest = async (room, userDoc, io) => {
  const uidStr = userDoc._id.toString();
  if (room.members.some(m => m.toString() === uidStr)) {
    return { status: 'joined' };
  }

  if (room.joinPolicy === 'approval') {
    if (!room.pendingRequests.some(p => p.toString() === uidStr)) {
      room.pendingRequests.push(userDoc._id);
      await room.save();

      if (io) {
        const adminIds = new Set([room.createdBy.toString(), ...room.admins.map(a => a.toString())]);
        const allSockets = await io.fetchSockets();
        allSockets
          .filter(s => s.data.user && adminIds.has(s.data.user._id.toString()))
          .forEach(s => s.emit('room:join_requested', {
            roomId: room._id.toString(),
            requester: { _id: uidStr, username: userDoc.username, nickname: userDoc.nickname, avatar: userDoc.avatar },
          }));
      }
    }
    return { status: 'pending' };
  }

  room.members.push(userDoc._id);
  room.pendingRequests = room.pendingRequests.filter(p => p.toString() !== uidStr);
  await room.save();

  // Báo cho thành viên cũ (đã join socket room từ trước) biết có người mới, để họ tự phân phối
  // lại Sender Key hiện hành cho thiết bị của người mới — không thì người mới không đọc được
  // tin nhắn nhóm cho tới khi ai đó bấm "Xoay khóa" thủ công.
  if (io) {
    io.to(room._id.toString()).emit('room:member_joined', {
      roomId: room._id.toString(),
      member: { _id: uidStr, username: userDoc.username, nickname: userDoc.nickname, avatar: userDoc.avatar, isOnline: true },
    });
  }
  return { status: 'joined' };
};

// POST /api/rooms/:id/join — tham gia phòng (chỉ phòng công khai — tìm qua /all)
router.post('/:id/join', protect, async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ message: 'Phòng không tồn tại' });

    // Bảo mật: Ngăn chặn IDOR (Chỉ cho phép tự động tham gia các phòng công khai)
    if (room.isPrivate || room.isDM) {
      return res.status(403).json({ message: 'Không thể tham gia trực tiếp phòng chat riêng tư hoặc cuộc trò chuyện cá nhân' });
    }

    const { status } = await addMemberOrRequest(room, req.user, req.app.get('socketio'));
    if (status === 'pending') return res.json({ status: 'pending' });

    await room.populate('members', 'username nickname avatar isOnline');
    res.json(room);
  } catch (err) {
    sendServerError(res, err);
  }
});

// Link mời hết hạn chỉ chặn NGƯỜI MỚI (chưa từng là thành viên) — thành viên cũ mở lại link cũ
// (dù đã hết hạn) vẫn xem/tham gia lại được bình thường, không bị khóa khỏi phòng của chính mình.
const isInviteExpiredForNewJoin = (room, userId) => {
  const alreadyMember = room.members.some(m => m.toString() === userId.toString());
  if (alreadyMember) return false;
  return room.inviteCodeExpiresAt && room.inviteCodeExpiresAt.getTime() < Date.now();
};

// GET /api/rooms/invite/:inviteCode — xem trước thông tin phòng qua link/QR mời, chưa cần là thành viên
router.get('/invite/:inviteCode', protect, async (req, res) => {
  try {
    const room = await Room.findOne({ inviteCode: req.params.inviteCode });
    if (!room || room.isDM) return res.status(404).json({ message: 'Link mời không hợp lệ' });
    if (isInviteExpiredForNewJoin(room, req.user._id)) {
      return res.status(410).json({ message: 'Link mời đã hết hạn (sau 7 ngày) — hãy xin chủ phòng link mới' });
    }

    res.json({
      _id: room._id,
      name: room.name,
      memberCount: room.members.length,
      isMember: room.members.some(m => m.toString() === req.user._id.toString()),
    });
  } catch (err) {
    sendServerError(res, err);
  }
});

// POST /api/rooms/invite/:inviteCode — tham gia qua link/QR mời (áp dụng cả phòng riêng tư)
router.post('/invite/:inviteCode', protect, async (req, res) => {
  try {
    const room = await Room.findOne({ inviteCode: req.params.inviteCode });
    if (!room || room.isDM) return res.status(404).json({ message: 'Link mời không hợp lệ' });
    if (isInviteExpiredForNewJoin(room, req.user._id)) {
      return res.status(410).json({ message: 'Link mời đã hết hạn (sau 7 ngày) — hãy xin chủ phòng link mới' });
    }

    const { status } = await addMemberOrRequest(room, req.user, req.app.get('socketio'));
    if (status === 'pending') return res.json({ status: 'pending' });

    await room.populate('members', 'username nickname avatar isOnline');
    res.json(room);
  } catch (err) {
    sendServerError(res, err);
  }
});

// GET /api/rooms/:id/invite-code — lấy link/QR mời hiện hành (mọi thành viên, không lộ qua GET /rooms hay /all)
router.get('/:id/invite-code', protect, async (req, res) => {
  try {
    const room = await requireMembership(req, res, req.params.id);
    if (!room) return;
    if (room.isDM) return res.status(400).json({ message: 'Không áp dụng cho cuộc trò chuyện riêng tư' });

    res.json({ inviteCode: room.inviteCode, inviteCodeExpiresAt: room.inviteCodeExpiresAt });
  } catch (err) {
    sendServerError(res, err);
  }
});

// PUT /api/rooms/:id/rotate-invite — vô hiệu hóa link/QR mời cũ, sinh link mới + gia hạn 7 ngày (chỉ chủ phòng)
router.put('/:id/rotate-invite', protect, async (req, res) => {
  try {
    const room = await requireMembership(req, res, req.params.id);
    if (!room) return;
    if (room.isDM) return res.status(400).json({ message: 'Không áp dụng cho cuộc trò chuyện riêng tư' });
    if (room.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Chỉ chủ phòng mới có thể tạo lại link mời' });
    }

    room.inviteCode = crypto.randomBytes(6).toString('hex');
    room.inviteCodeExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await room.save();
    res.json({ inviteCode: room.inviteCode, inviteCodeExpiresAt: room.inviteCodeExpiresAt });
  } catch (err) {
    sendServerError(res, err);
  }
});

// PUT /api/rooms/:id/settings — đổi tên phòng / công khai-riêng tư (chỉ chủ phòng)
router.put('/:id/settings', protect, async (req, res) => {
  try {
    const room = await requireMembership(req, res, req.params.id);
    if (!room) return;
    if (room.isDM) return res.status(400).json({ message: 'Không áp dụng cho cuộc trò chuyện riêng tư' });
    if (room.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Chỉ chủ phòng mới có thể đổi cài đặt phòng' });
    }

    const { name, isPrivate } = req.body;
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ message: 'Tên phòng không được để trống' });
      room.name = name.trim();
    }
    if (isPrivate !== undefined) {
      room.isPrivate = !!isPrivate;
    }
    await room.save();

    const io = req.app.get('socketio');
    if (io) {
      io.to(room._id.toString()).emit('room:settings_updated', {
        roomId: room._id.toString(),
        name: room.name,
        isPrivate: room.isPrivate,
      });
    }

    res.json({ name: room.name, isPrivate: room.isPrivate });
  } catch (err) {
    sendServerError(res, err);
  }
});

// GET /api/rooms/:id/join-requests — danh sách yêu cầu tham gia đang chờ duyệt (chỉ admin/chủ phòng)
router.get('/:id/join-requests', protect, async (req, res) => {
  try {
    const room = await requireMembership(req, res, req.params.id);
    if (!room) return;
    const isOwner = room.createdBy.toString() === req.user._id.toString();
    const isAdmin = room.admins.some(a => a.toString() === req.user._id.toString());
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'Chỉ quản trị viên nhóm mới xem được yêu cầu tham gia' });
    }

    await room.populate('pendingRequests', 'username nickname avatar');
    res.json(room.pendingRequests);
  } catch (err) {
    sendServerError(res, err);
  }
});

// PUT /api/rooms/:id/join-requests/:userId — duyệt yêu cầu tham gia (chỉ admin/chủ phòng)
router.put('/:id/join-requests/:userId', protect, async (req, res) => {
  try {
    const room = await requireMembership(req, res, req.params.id);
    if (!room) return;
    const isOwner = room.createdBy.toString() === req.user._id.toString();
    const isAdmin = room.admins.some(a => a.toString() === req.user._id.toString());
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'Chỉ quản trị viên nhóm mới có thể duyệt yêu cầu tham gia' });
    }
    if (!room.pendingRequests.some(p => p.toString() === req.params.userId)) {
      return res.status(404).json({ message: 'Không tìm thấy yêu cầu tham gia này' });
    }

    const requester = await User.findById(req.params.userId).select('username nickname avatar');
    if (!requester) return res.status(404).json({ message: 'Người dùng không tồn tại' });

    room.pendingRequests = room.pendingRequests.filter(p => p.toString() !== req.params.userId);
    room.members.push(requester._id);
    await room.save();

    const io = req.app.get('socketio');
    if (io) {
      io.to(room._id.toString()).emit('room:member_joined', {
        roomId: room._id.toString(),
        member: { _id: requester._id.toString(), username: requester.username, nickname: requester.nickname, avatar: requester.avatar, isOnline: true },
      });
    }

    res.json({ message: 'Đã duyệt yêu cầu tham gia' });
  } catch (err) {
    sendServerError(res, err);
  }
});

// DELETE /api/rooms/:id/join-requests/:userId — từ chối yêu cầu tham gia (chỉ admin/chủ phòng)
router.delete('/:id/join-requests/:userId', protect, async (req, res) => {
  try {
    const room = await requireMembership(req, res, req.params.id);
    if (!room) return;
    const isOwner = room.createdBy.toString() === req.user._id.toString();
    const isAdmin = room.admins.some(a => a.toString() === req.user._id.toString());
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'Chỉ quản trị viên nhóm mới có thể từ chối yêu cầu tham gia' });
    }

    room.pendingRequests = room.pendingRequests.filter(p => p.toString() !== req.params.userId);
    await room.save();

    const io = req.app.get('socketio');
    if (io) {
      const allSockets = await io.fetchSockets();
      allSockets
        .filter(s => s.data.user && s.data.user._id.toString() === req.params.userId)
        .forEach(s => s.emit('room:join_rejected', { roomId: room._id.toString() }));
    }

    res.json({ message: 'Đã từ chối yêu cầu tham gia' });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ─── Sender Key (mã hóa nhóm) ───────────────────────────────────────────────

// Kiểm tra user có phải thành viên phòng không (dùng chung cho 3 route sender-key bên dưới)
const requireMembership = async (req, res, roomId) => {
  const room = await Room.findById(roomId);
  if (!room) { res.status(404).json({ message: 'Phòng không tồn tại' }); return null; }
  if (!room.members.some(m => m.toString() === req.user._id.toString())) {
    res.status(403).json({ message: 'Không có quyền truy cập phòng này' });
    return null;
  }
  return room;
};

// POST /api/rooms/:id/sender-key — phân phối/cập nhật Sender Key của 1 thiết bị gửi cho cả phòng
router.post('/:id/sender-key', protect, async (req, res) => {
  try {
    const room = await requireMembership(req, res, req.params.id);
    if (!room) return;

    const { epoch, senderDeviceId, encryptedKeys } = req.body;
    if (epoch === undefined || !senderDeviceId || !encryptedKeys || typeof encryptedKeys !== 'object') {
      return res.status(400).json({ message: 'Thiếu epoch, senderDeviceId hoặc encryptedKeys' });
    }

    // Chặn giả mạo senderDeviceId của thiết bị người khác (unique index room+epoch+senderDeviceId
    // sẽ cho phép ghi đè distribution hợp lệ nếu không chặn ở đây)
    const ownsDevice = req.user.devices.some(d => d.deviceId === senderDeviceId && !d.isRevoked);
    if (!ownsDevice) {
      return res.status(403).json({ message: 'senderDeviceId không thuộc về thiết bị đang hoạt động của bạn' });
    }

    const doc = await SenderKeyDistribution.findOneAndUpdate(
      { room: room._id, epoch, senderDeviceId },
      { room: room._id, epoch, senderDeviceId, senderUser: req.user._id, encryptedKeys },
      { upsert: true, new: true }
    );

    const io = req.app.get('socketio');
    if (io) {
      io.to(room._id.toString()).emit('sender_key:new', doc.toObject({ flattenMaps: true }));
    }

    res.status(201).json(doc.toObject({ flattenMaps: true }));
  } catch (err) {
    sendServerError(res, err);
  }
});

// GET /api/rooms/:id/sender-key — khôi phục Sender Key khi client cache-miss (vd vừa mở phòng)
router.get('/:id/sender-key', protect, async (req, res) => {
  try {
    const room = await requireMembership(req, res, req.params.id);
    if (!room) return;

    const { epoch, senderDeviceId } = req.query;
    if (epoch === undefined || !senderDeviceId) {
      return res.status(400).json({ message: 'Thiếu epoch hoặc senderDeviceId' });
    }

    const doc = await SenderKeyDistribution.findOne({ room: room._id, epoch, senderDeviceId });
    if (!doc) return res.status(404).json({ message: 'Chưa có Sender Key cho epoch này' });

    res.json(doc.toObject({ flattenMaps: true }));
  } catch (err) {
    sendServerError(res, err);
  }
});

// Tăng senderKeyEpoch của phòng + báo cho cả phòng biết — dùng chung bởi rotate-key thủ công
// và rời/kick thành viên (loại người khỏi nhóm cũng phải buộc tạo Sender Key mới không có họ).
const bumpSenderKeyEpoch = async (room, io) => {
  const updated = await Room.findByIdAndUpdate(room._id, { $inc: { senderKeyEpoch: 1 } }, { new: true });
  if (io) {
    io.to(room._id.toString()).emit('sender_key:rotated', { roomId: room._id.toString(), epoch: updated.senderKeyEpoch });
  }
  return updated.senderKeyEpoch;
};

// PUT /api/rooms/:id/rotate-key — tăng epoch Sender Key của phòng (buộc mọi thiết bị gửi lại phân phối khóa mới)
router.put('/:id/rotate-key', protect, async (req, res) => {
  try {
    const room = await requireMembership(req, res, req.params.id);
    if (!room) return;

    const epoch = await bumpSenderKeyEpoch(room, req.app.get('socketio'));
    res.json({ roomId: room._id, epoch });
  } catch (err) {
    sendServerError(res, err);
  }
});

// Phát admins/createdBy mới cho cả phòng — dùng bởi mọi thao tác đổi vai trò (rời/kick kèm kế vị
// chủ phòng, phong/gỡ admin, chuyển quyền chủ phòng) để mọi client cập nhật badge realtime.
const broadcastRoomUpdated = (room, io) => {
  if (!io) return;
  io.to(room._id.toString()).emit('room:updated', {
    roomId: room._id.toString(),
    admins: room.admins.map(a => a.toString()),
    createdBy: room.createdBy.toString(),
  });
};

// Bỏ userId khỏi members/admins của room — dùng chung cho rời nhóm (leave) và bị kick.
// Nếu members rỗng sau khi bỏ thì xóa luôn Room. Bất biến cần giữ: createdBy (chủ phòng) luôn
// nằm trong admins. Nếu người rời/bị kick chính là chủ phòng, kế vị: admin phụ còn lại đầu tiên
// lên làm chủ phòng mới; không còn admin phụ nào thì thành viên đầu tiên còn lại lên làm chủ.
const removeMemberFromRoom = async (room, userId, io) => {
  const uidStr = userId.toString();
  const remainingMembers = room.members.filter(m => m.toString() !== uidStr);

  if (remainingMembers.length === 0) {
    await Room.findByIdAndDelete(room._id);
    return { deleted: true };
  }

  room.members = remainingMembers;
  room.admins = room.admins.filter(a => a.toString() !== uidStr);

  if (room.createdBy.toString() === uidStr) {
    const newOwner = room.admins[0] || remainingMembers[0];
    room.createdBy = newOwner;
    if (!room.admins.some(a => a.toString() === newOwner.toString())) {
      room.admins.push(newOwner);
    }
  } else if (room.admins.length === 0) {
    // Không nên xảy ra (chủ phòng luôn nằm trong admins) — phòng hờ dữ liệu lệch
    room.admins = [room.createdBy];
  }

  await room.save();

  if (io) {
    io.to(room._id.toString()).emit('room:member_left', { roomId: room._id.toString(), userId: uidStr });
    broadcastRoomUpdated(room, io);

    const allSockets = await io.fetchSockets();
    allSockets
      .filter(s => s.data.user && s.data.user._id.toString() === uidStr)
      .forEach(s => {
        s.emit('room:removed', { roomId: room._id.toString() });
        s.leave(room._id.toString());
      });
  }

  await bumpSenderKeyEpoch(room, io);
  return { deleted: false };
};

// POST /api/rooms/:id/leave — tự rời phòng nhóm
router.post('/:id/leave', protect, async (req, res) => {
  try {
    const room = await requireMembership(req, res, req.params.id);
    if (!room) return;
    if (room.isDM) {
      return res.status(400).json({ message: 'Không thể rời cuộc trò chuyện riêng tư — hãy dùng hủy kết bạn.' });
    }

    await removeMemberFromRoom(room, req.user._id, req.app.get('socketio'));
    res.json({ message: 'Đã rời khỏi nhóm' });
  } catch (err) {
    sendServerError(res, err);
  }
});

// DELETE /api/rooms/:id/members/:userId — kick thành viên (chỉ admin)
router.delete('/:id/members/:userId', protect, async (req, res) => {
  try {
    const room = await requireMembership(req, res, req.params.id);
    if (!room) return;
    if (room.isDM) {
      return res.status(400).json({ message: 'Không áp dụng cho cuộc trò chuyện riêng tư' });
    }
    const isOwner = room.createdBy.toString() === req.user._id.toString();
    const isAdmin = room.admins.some(a => a.toString() === req.user._id.toString());
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'Chỉ quản trị viên nhóm mới có thể xóa thành viên' });
    }
    if (req.params.userId === req.user._id.toString()) {
      return res.status(400).json({ message: 'Dùng chức năng "Rời nhóm" để tự rời khỏi nhóm' });
    }
    if (req.params.userId === room.createdBy.toString()) {
      return res.status(403).json({ message: 'Không thể xóa chủ phòng' });
    }
    if (!room.members.some(m => m.toString() === req.params.userId)) {
      return res.status(404).json({ message: 'Người này không phải thành viên phòng' });
    }
    const targetIsAdmin = room.admins.some(a => a.toString() === req.params.userId);
    if (targetIsAdmin && !isOwner) {
      return res.status(403).json({ message: 'Chỉ chủ phòng mới có thể xóa quản trị viên khác' });
    }

    await removeMemberFromRoom(room, req.params.userId, req.app.get('socketio'));
    res.json({ message: 'Đã xóa thành viên khỏi nhóm' });
  } catch (err) {
    sendServerError(res, err);
  }
});

// PUT /api/rooms/:id/admins/:userId — phong quản trị viên phụ (chỉ chủ phòng)
router.put('/:id/admins/:userId', protect, async (req, res) => {
  try {
    const room = await requireMembership(req, res, req.params.id);
    if (!room) return;
    if (room.isDM) return res.status(400).json({ message: 'Không áp dụng cho cuộc trò chuyện riêng tư' });
    if (room.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Chỉ chủ phòng mới có thể phong quản trị viên' });
    }
    if (!room.members.some(m => m.toString() === req.params.userId)) {
      return res.status(404).json({ message: 'Người này không phải thành viên phòng' });
    }
    if (!room.admins.some(a => a.toString() === req.params.userId)) {
      room.admins.push(req.params.userId);
      await room.save();
      broadcastRoomUpdated(room, req.app.get('socketio'));
    }
    res.json({ message: 'Đã phong quản trị viên' });
  } catch (err) {
    sendServerError(res, err);
  }
});

// DELETE /api/rooms/:id/admins/:userId — gỡ quyền quản trị viên phụ (chỉ chủ phòng)
router.delete('/:id/admins/:userId', protect, async (req, res) => {
  try {
    const room = await requireMembership(req, res, req.params.id);
    if (!room) return;
    if (room.isDM) return res.status(400).json({ message: 'Không áp dụng cho cuộc trò chuyện riêng tư' });
    if (room.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Chỉ chủ phòng mới có thể gỡ quyền quản trị viên' });
    }
    if (req.params.userId === room.createdBy.toString()) {
      return res.status(400).json({ message: 'Không thể gỡ quyền của chính chủ phòng — hãy chuyển quyền chủ phòng nếu muốn đổi' });
    }
    room.admins = room.admins.filter(a => a.toString() !== req.params.userId);
    await room.save();
    broadcastRoomUpdated(room, req.app.get('socketio'));
    res.json({ message: 'Đã gỡ quyền quản trị viên' });
  } catch (err) {
    sendServerError(res, err);
  }
});

// PUT /api/rooms/:id/owner/:userId — chuyển quyền chủ phòng (chỉ chủ phòng hiện tại)
router.put('/:id/owner/:userId', protect, async (req, res) => {
  try {
    const room = await requireMembership(req, res, req.params.id);
    if (!room) return;
    if (room.isDM) return res.status(400).json({ message: 'Không áp dụng cho cuộc trò chuyện riêng tư' });
    if (room.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Chỉ chủ phòng hiện tại mới có thể chuyển quyền' });
    }
    if (!room.members.some(m => m.toString() === req.params.userId)) {
      return res.status(404).json({ message: 'Người này không phải thành viên phòng' });
    }

    room.createdBy = req.params.userId;
    if (!room.admins.some(a => a.toString() === req.params.userId)) {
      room.admins.push(req.params.userId);
    }
    await room.save();
    broadcastRoomUpdated(room, req.app.get('socketio'));
    res.json({ message: 'Đã chuyển quyền chủ phòng' });
  } catch (err) {
    sendServerError(res, err);
  }
});

// POST /api/rooms/upload-audio — tải lên tệp âm thanh (tin nhắn thoại)
router.post('/upload-audio', protect, (req, res, next) => {
  uploadAudio.single('audio')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Không tìm thấy tệp âm thanh' });
    }

    // Gửi buffer tệp lên Cloudinary qua upload_stream
    const uploadToCloudinary = (fileBuffer) => {
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'chat-app/audios',
            resource_type: 'video', // Cần đặt video để lưu trữ được các định dạng audio (mp3, wav, webm...)
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
        const readable = new Readable();
        readable._read = () => {};
        readable.push(fileBuffer);
        readable.push(null);
        readable.pipe(uploadStream);
      });
    };

    const result = await uploadToCloudinary(req.file.buffer);
    res.json({ url: result.secure_url });
  } catch (err) {
    sendServerError(res, err);
  }
});

// POST /api/rooms/upload-image — tải lên hình ảnh
router.post('/upload-image', protect, (req, res, next) => {
  uploadImage.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Không tìm thấy tệp hình ảnh' });
    }

    const uploadToCloudinary = (fileBuffer) => {
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'chat-app/images',
            resource_type: 'image',
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
        const readable = new Readable();
        readable._read = () => {};
        readable.push(fileBuffer);
        readable.push(null);
        readable.pipe(uploadStream);
      });
    };

    const result = await uploadToCloudinary(req.file.buffer);
    res.json({ url: result.secure_url });
  } catch (err) {
    sendServerError(res, err);
  }
});

// POST /api/rooms/upload-file — tải lên tệp tin chung
router.post('/upload-file', protect, (req, res, next) => {
  uploadFile.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Không tìm thấy tệp tin' });
    }

    const uploadToCloudinary = (fileBuffer) => {
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'chat-app/files',
            resource_type: 'raw',
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
        const readable = new Readable();
        readable._read = () => {};
        readable.push(fileBuffer);
        readable.push(null);
        readable.pipe(uploadStream);
      });
    };

    const result = await uploadToCloudinary(req.file.buffer);
    res.json({ url: result.secure_url });
  } catch (err) {
    sendServerError(res, err);
  }
});

module.exports = router;