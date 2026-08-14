const router  = require('express').Router();
const Room    = require('../models/Room');
const Message = require('../models/Message');
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
    const { name, description, isPrivate, members } = req.body;
    const room = await Room.create({
      name,
      description,
      isPrivate: isPrivate || false,
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

// POST /api/rooms/:id/join — tham gia phòng
router.post('/:id/join', protect, async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ message: 'Phòng không tồn tại' });

    // Bảo mật: Ngăn chặn IDOR (Chỉ cho phép tự động tham gia các phòng công khai)
    if (room.isPrivate || room.isDM) {
      return res.status(403).json({ message: 'Không thể tham gia trực tiếp phòng chat riêng tư hoặc cuộc trò chuyện cá nhân' });
    }

    const updatedRoom = await Room.findByIdAndUpdate(
      req.params.id,
      { $addToSet: { members: req.user._id } },
      { returnDocument: 'after' }
    ).populate('members', 'username nickname avatar isOnline');

    res.json(updatedRoom);
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