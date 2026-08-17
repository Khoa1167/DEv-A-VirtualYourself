const User       = require('../models/User');
const Message    = require('../models/Message');
const Room       = require('../models/Room');
const Friendship = require('../models/Friendship');
const { encrypt, decrypt } = require('../utils/crypto');
const { verifyJwt } = require('../utils/jwtKeys');


const setupSocket = (io) => {
  /**
   * Rate Limiting per userId: tối đa 8 tin nhắn / 5 giây (cộng dồn qua tất cả socket/tab của cùng user).
   * 
   * [GHI CHÚ KIẾN TRÚC SCALABILITY]:
   * Hiện tại userMessageRateMap là in-memory Map cho single-instance Node.js process.
   * Khi ứng dụng scale ngang (nhiều server instance đứng sau Load Balancer), bộ đếm này
   * sẽ chuyển sang sử dụng Redis (`INCR` + `EXPIRE` lệnh nguyên tố) để đếm tập trung giữa các instances.
   */
  const userMessageRateMap = new Map();

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication error'));
      const decoded = verifyJwt(token);
      socket.user = await User.findById(decoded.id).select('-password');
      if (!socket.user) return next(new Error('User not found'));
      socket.data.user = socket.user;
      next();
    } catch {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.user._id;
    console.log(`🟢 ${socket.user.username} connected`);

    // Đánh dấu online
    await User.findByIdAndUpdate(userId, { isOnline: true });
    socket.broadcast.emit('user:online', { userId });

    // Join tất cả room của user
    const rooms = await Room.find({ members: userId });
    rooms.forEach(r => {
      socket.join(r._id.toString());
      console.log(`🟢 ${socket.user.username} joined socket room: ${r._id}`);
    });

    // ===== EVENTS: TIN NHẮN =====

    socket.on('message:send', async ({ roomId, content, iv, tag, encryptedKeys, type, replyTo, fileName, forwardedFrom, scheme, senderDeviceId, epoch }) => {
      try {
        // Rate Limiting Check theo userId
        const uIdStr = userId.toString();
        const now = Date.now();
        const userLimit = userMessageRateMap.get(uIdStr) || { count: 0, resetTime: now + 5000 };

        if (now > userLimit.resetTime) {
          userLimit.count = 0;
          userLimit.resetTime = now + 5000;
        }

        userLimit.count += 1;
        userMessageRateMap.set(uIdStr, userLimit);

        if (userLimit.count > 8) {
          const retryAfter = Math.ceil((userLimit.resetTime - now) / 1000);
          return socket.emit('error', {
            message: `Bạn đang gửi tin nhắn quá nhanh. Vui lòng thử lại sau ${retryAfter} giây.`,
            code: 'RATE_LIMITED',
            retryAfter
          });
        }

        const room = await Room.findOne({ _id: roomId, members: userId });
        if (!room) return socket.emit('error', { message: 'Không có quyền' });



        if (forwardedFrom) {
          const originalMsg = await Message.findById(forwardedFrom);
          if (!originalMsg || originalMsg.isDeleted) {
            return socket.emit('error', { message: 'Không thể chuyển tiếp tin nhắn đã bị thu hồi' });
          }
        }

        // Zero-Knowledge Relay: Lưu trực tiếp bản mã từ Client
        const msg = await Message.create({
          content: content || '',
          iv: iv || null,
          tag: tag || null,
          encryptedKeys: encryptedKeys || {},
          scheme: scheme || 'rsa-per-device',
          senderDeviceId: senderDeviceId || null,
          epoch: epoch ?? null,
          sender: userId,
          room: roomId,
          type: type || 'text',
          replyTo: replyTo || null,
          fileName: fileName || null,
          forwardedFrom: forwardedFrom || null,
        });

        await msg.populate('sender', 'username nickname avatar');
        if (replyTo) {
          await msg.populate({
            path: 'replyTo',
            select: 'sender content type fileName isDeleted iv tag encryptedKeys',
            populate: { path: 'sender', select: 'username nickname avatar' }
          });
        }
        if (forwardedFrom) {
          await msg.populate({
            path: 'forwardedFrom',
            select: 'sender content iv tag encryptedKeys',
            populate: { path: 'sender', select: 'username nickname' }
          });
        }
        await Room.findByIdAndUpdate(roomId, { lastMessage: msg._id });

        // Zero-Knowledge Relay: Trả nguyên bản mã cho tất cả client tự giải mã
        // flattenMaps: encryptedKeys là Mongoose Map, JSON.stringify(Map) trả về "{}" nếu không flatten
        const clientMsg = msg.toObject({ flattenMaps: true });
        io.to(roomId).emit('message:new', clientMsg);
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    socket.on('typing:start', async ({ roomId }) => {
      const room = await Room.findOne({ _id: roomId, members: userId }).select('_id');
      if (!room) return;
      socket.to(roomId).emit('typing:start', {
        userId, username: socket.user.nickname || socket.user.username, roomId,
      });
    });

    socket.on('typing:stop', async ({ roomId }) => {
      const room = await Room.findOne({ _id: roomId, members: userId }).select('_id');
      if (!room) return;
      socket.to(roomId).emit('typing:stop', { userId, roomId });
    });

    socket.on('message:react', async ({ messageId, emoji }) => {
      try {
        const msg = await Message.findById(messageId);
        if (!msg) return;
        const room = await Room.findOne({ _id: msg.room, members: userId }).select('_id');
        if (!room) return socket.emit('error', { message: 'Không có quyền' });

        const idx = msg.reactions.findIndex(r => r.emoji === emoji);
        if (idx > -1) {
          const uIdx = msg.reactions[idx].users.findIndex(u => u.toString() === userId.toString());
          if (uIdx > -1) msg.reactions[idx].users.splice(uIdx, 1);
          else msg.reactions[idx].users.push(userId);
          if (msg.reactions[idx].users.length === 0) msg.reactions.splice(idx, 1);
        } else {
          msg.reactions.push({ emoji, users: [userId] });
        }

        await msg.save();
        await msg.populate('reactions.users', 'username nickname');
        io.to(msg.room.toString()).emit('message:reacted', {
          messageId, reactions: msg.reactions,
        });
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    socket.on('message:edit', async ({ messageId, content, iv, tag, encryptedKeys, scheme, senderDeviceId, epoch }) => {
      try {
        const msg = await Message.findOne({ _id: messageId, sender: userId });
        if (!msg) return socket.emit('error', { message: 'Không có quyền chỉnh sửa tin nhắn này' });
        if (msg.isDeleted) return socket.emit('error', { message: 'Không thể chỉnh sửa tin nhắn đã bị thu hồi' });
        if (msg.type !== 'text') return socket.emit('error', { message: 'Chỉ có thể chỉnh sửa tin nhắn văn bản' });

        // encryptedKeys rỗng là hợp lệ khi scheme='sender-key' (khóa đã phân phối từ trước, không kèm theo từng tin nhắn)
        const missingKeys = scheme !== 'sender-key' && (!encryptedKeys || Object.keys(encryptedKeys).length === 0);
        if (!content || !iv || !tag || missingKeys) {
          return socket.emit('error', { message: 'Payload chỉnh sửa tin nhắn phải có nội dung được mã hóa E2EE.' });
        }

        msg.content = content;
        msg.iv = iv;
        msg.tag = tag;
        msg.encryptedKeys = encryptedKeys || {};
        msg.encryptedKey = null;
        msg.scheme = scheme || 'rsa-per-device';
        msg.senderDeviceId = senderDeviceId || null;
        msg.epoch = epoch ?? null;
        msg.isEdited = true;
        await msg.save();

        io.to(msg.room.toString()).emit('message:edited', {
          messageId,
          content,
          iv,
          tag,
          encryptedKeys: msg.encryptedKeys,
          scheme: msg.scheme,
          senderDeviceId: msg.senderDeviceId,
          epoch: msg.epoch,
          isEdited: true
        });
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    socket.on('message:delete', async ({ messageId }) => {
      try {
        const msg = await Message.findOne({ _id: messageId, sender: userId });
        if (!msg) return socket.emit('error', { message: 'Không có quyền' });
        msg.isDeleted = true;
        msg.content = 'Tin nhắn đã bị thu hồi';
        msg.iv = null;
        msg.tag = null;
        msg.fileName = null;
        await msg.save();
        io.to(msg.room.toString()).emit('message:deleted', { messageId });
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // ===== EVENTS: PHÒNG CHAT =====

    socket.on('room:join', async (roomId) => {
      // Bảo mật: chặn subscribe vào broadcast realtime của phòng không phải thành viên
      // (rò rỉ room:updated/member_joined/settings_updated... cho người ngoài nếu không check)
      const room = await Room.findOne({ _id: roomId, members: userId }).select('_id');
      if (!room) return;

      socket.join(roomId);
      socket.to(roomId).emit('room:user_joined', {
        userId, username: socket.user.nickname || socket.user.username,
      });
    });

    // ===== EVENTS: CUỘC GỌI 1-1 (WebRTC Signaling) =====

    // Gửi yêu cầu gọi
    socket.on('call:request', async ({ receiverId, signalData, type }) => {
      try {
        const allSockets = await io.fetchSockets();
        const receiverSockets = allSockets.filter(
          s => s.data.user?._id.toString() === receiverId
        );

        if (receiverSockets.length === 0) {
          socket.emit('call:failed', { receiverId, reason: 'offline' });
          return;
        }

        const callerInfo = {
          _id: socket.user._id,
          username: socket.user.username,
          nickname: socket.user.nickname,
          avatar: socket.user.avatar
        };

        receiverSockets.forEach(s => {
          s.emit('call:request', {
            caller: callerInfo,
            signalData,
            type
          });
        });
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // Chấp nhận cuộc gọi
    socket.on('call:accept', async ({ callerId, signalData }) => {
      try {
        const allSockets = await io.fetchSockets();
        const callerSockets = allSockets.filter(
          s => s.data.user?._id.toString() === callerId
        );

        callerSockets.forEach(s => {
          s.emit('call:accept', {
            receiverId: socket.user._id,
            signalData
          });
        });
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // Từ chối cuộc gọi
    socket.on('call:reject', async ({ callerId }) => {
      try {
        const allSockets = await io.fetchSockets();
        const callerSockets = allSockets.filter(
          s => s.data.user?._id.toString() === callerId
        );

        callerSockets.forEach(s => {
          s.emit('call:reject', {
            receiverId: socket.user._id
          });
        });
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // Truyền ICE Candidates
    socket.on('call:ice-candidate', async ({ targetId, candidate }) => {
      try {
        const allSockets = await io.fetchSockets();
        const targetSockets = allSockets.filter(
          s => s.data.user?._id.toString() === targetId
        );

        targetSockets.forEach(s => {
          s.emit('call:ice-candidate', {
            senderId: socket.user._id,
            candidate
          });
        });
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // Kết thúc cuộc gọi
    socket.on('call:end', async ({ targetId }) => {
      try {
        const allSockets = await io.fetchSockets();
        const targetSockets = allSockets.filter(
          s => s.data.user?._id.toString() === targetId
        );

        targetSockets.forEach(s => {
          s.emit('call:end', {
            senderId: socket.user._id
          });
        });
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // ===== EVENTS: KẾT BẠN =====

    // Gửi lời mời kết bạn realtime
    socket.on('friend:request', async ({ receiverId, friendship }) => {
      try {
        const receiverSockets = await io.fetchSockets();
        const receiverSocket = receiverSockets.find(
          s => s.data.user?._id.toString() === receiverId
        );

        if (receiverSocket) {
          // Forward toàn bộ friendship object để client dùng được _id
          receiverSocket.emit('friend:request_received', friendship);
        }
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // Bảo mật: đã bỏ handler 'friend:accepted' — client tự gửi senderId/dmRoomId không hề được
    // xác thực (join được bất kỳ dmRoomId nào, ép cả socket của senderId join theo). Logic join
    // + thông báo giờ chuyển hẳn vào PUT /api/friends/accept/:friendshipId (server tự suy ra
    // sender/receiver/dmRoom từ DB, không nhận gì từ client) — xem friends.js.

    // ===== DISCONNECT =====

    socket.on('disconnect', async () => {
      const activeSockets = await io.fetchSockets();
      const hasOtherConnections = activeSockets.some(
        s => s.data.user?._id.toString() === userId.toString()
      );

      if (!hasOtherConnections) {
        await User.findByIdAndUpdate(userId, {
          isOnline: false,
          lastSeen: new Date(),
        });
        socket.broadcast.emit('user:offline', { userId });
        console.log(`🔴 ${socket.user.username} disconnected`);
      } else {
        console.log(`🟡 ${socket.user.username} disconnected one of their connections`);
      }
    });
  });
};

module.exports = setupSocket;