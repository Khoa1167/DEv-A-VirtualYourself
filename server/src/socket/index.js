const User       = require('../models/User');
const Message    = require('../models/Message');
const Room       = require('../models/Room');
const Friendship = require('../models/Friendship');
const { encrypt, decrypt } = require('../utils/crypto');
const { verifyJwt } = require('../utils/jwtKeys');
const { checkRateWindow } = require('../utils/rateLimiter');
const userFields = require('../utils/publicUserFields');
const sendSocketError = require('../utils/sendSocketError');
const logger = require('../config/logger');


// Tin nhắn tự hủy chỉ nhận đúng 4 mốc cho phép — giá trị lạ coi như không đặt TTL, không lỗi.
const DISAPPEARING_TTL_OPTIONS = [60, 3600, 86400, 604800]; // 1 phút / 1 giờ / 24 giờ / 7 ngày

const setupSocket = (io) => {
  // Rate Limiting per userId: tối đa 8 tin nhắn / 5 giây (cộng dồn qua tất cả socket/tab của cùng
  // user). Dùng chung Redis khi có REDIS_URL (đếm tập trung giữa các instance), fallback in-memory
  // khi không — xem server/src/utils/rateLimiter.js.
  const NS_MESSAGE_SEND = 'message-send';

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
    logger.info({ userId, username: socket.user.username }, `🟢 ${socket.user.username} connected`);

    // Đánh dấu online
    await User.findByIdAndUpdate(userId, { isOnline: true });
    socket.broadcast.emit('user:online', { userId });

    // Join tất cả room của user
    const rooms = await Room.find({ members: userId });
    rooms.forEach(r => {
      socket.join(r._id.toString());
      logger.debug(`🟢 ${socket.user.username} joined socket room: ${r._id}`);
    });

    // ===== EVENTS: TIN NHẮN =====

    socket.on('message:send', async ({ roomId, content, iv, tag, encryptedKeys, type, replyTo, fileName, forwardedFrom, scheme, senderDeviceId, epoch, ttlSeconds }) => {
      try {
        // Rate Limiting Check theo userId
        const uIdStr = userId.toString();
        const msgLimit = await checkRateWindow(NS_MESSAGE_SEND, uIdStr, { maxCount: 8, windowMs: 5000 });

        if (msgLimit.limited) {
          const retryAfter = Math.ceil(msgLimit.retryAfterMs / 1000);
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

        // Tin nhắn tự hủy: người gửi tự chọn lúc gửi, khóa cứng ngay tại đây — không route/người
        // khác nào sau này đổi lại được (xem ghi chú expires trong Message.js)
        const validTtl = DISAPPEARING_TTL_OPTIONS.includes(ttlSeconds) ? ttlSeconds : null;

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
          expiresAt: validTtl ? new Date(Date.now() + validTtl * 1000) : null,
        });

        await msg.populate('sender', userFields.BASIC);
        if (replyTo) {
          await msg.populate({
            path: 'replyTo',
            select: 'sender content type fileName isDeleted iv tag encryptedKeys',
            populate: { path: 'sender', select: userFields.BASIC }
          });
        }
        if (forwardedFrom) {
          await msg.populate({
            path: 'forwardedFrom',
            select: 'sender content iv tag encryptedKeys',
            populate: { path: 'sender', select: userFields.MINIMAL }
          });
        }
        await Room.findByIdAndUpdate(roomId, { lastMessage: msg._id });

        // Zero-Knowledge Relay: Trả nguyên bản mã cho tất cả client tự giải mã
        // flattenMaps: encryptedKeys là Mongoose Map, JSON.stringify(Map) trả về "{}" nếu không flatten
        const clientMsg = msg.toObject({ flattenMaps: true });
        io.to(roomId).emit('message:new', clientMsg);
      } catch (err) {
        sendSocketError(socket, err);
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

        // Mỗi người chỉ giữ tối đa 1 emoji/tin nhắn — gỡ khỏi nhóm emoji cũ (nếu có) trước khi
        // xử lý. Bấm lại đúng emoji đang giữ = bỏ react; bấm emoji khác = chuyển sang emoji đó.
        const prevIdx = msg.reactions.findIndex(r => r.users.some(u => u.toString() === userId.toString()));
        const hadSameEmoji = prevIdx > -1 && msg.reactions[prevIdx].emoji === emoji;
        if (prevIdx > -1) {
          msg.reactions[prevIdx].users = msg.reactions[prevIdx].users.filter(u => u.toString() !== userId.toString());
          if (msg.reactions[prevIdx].users.length === 0) msg.reactions.splice(prevIdx, 1);
        }

        if (!hadSameEmoji) {
          const idx = msg.reactions.findIndex(r => r.emoji === emoji);
          if (idx > -1) msg.reactions[idx].users.push(userId);
          else msg.reactions.push({ emoji, users: [userId] });
        }

        await msg.save();
        await msg.populate('reactions.users', userFields.MINIMAL);
        io.to(msg.room.toString()).emit('message:reacted', {
          messageId, reactions: msg.reactions,
        });
      } catch (err) {
        sendSocketError(socket, err);
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
        sendSocketError(socket, err);
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
        sendSocketError(socket, err);
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
        sendSocketError(socket, err);
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
        sendSocketError(socket, err);
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
        sendSocketError(socket, err);
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
        sendSocketError(socket, err);
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
        sendSocketError(socket, err);
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
        sendSocketError(socket, err);
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
        logger.info({ userId, username: socket.user.username }, `🔴 ${socket.user.username} disconnected`);
      } else {
        logger.debug(`🟡 ${socket.user.username} disconnected one of their connections`);
      }
    });
  });
};

module.exports = setupSocket;