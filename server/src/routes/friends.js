const router     = require('express').Router();
const mongoose   = require('mongoose');
const Friendship = require('../models/Friendship');
const User       = require('../models/User');
const Room       = require('../models/Room');
const { protect } = require('../middleware/auth');
const sendServerError = require('../utils/sendServerError');
const userFields = require('../utils/publicUserFields');

// GET /api/friends — lấy danh sách bạn bè
router.get('/', protect, async (req, res) => {
  try {
    const friends = await Friendship.find({
      $or: [{ sender: req.user._id }, { receiver: req.user._id }],
      status: 'accepted',
    })
      .populate('sender', userFields.WITH_STATUS_LASTSEEN)
      .populate('receiver', userFields.WITH_STATUS_LASTSEEN);
    res.json(friends);
  } catch (err) {
    sendServerError(res, err);
  }
});

// GET /api/friends/requests — lấy lời mời kết bạn đang chờ
router.get('/requests', protect, async (req, res) => {
  try {
    const requests = await Friendship.find({
      receiver: req.user._id,
      status: 'pending',
    }).populate('sender', userFields.BASIC);
    res.json(requests);
  } catch (err) {
    sendServerError(res, err);
  }
});

// GET /api/friends/search?q=keyword — tìm kiếm user
router.get('/search', protect, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2)
      return res.status(400).json({ message: 'Nhập ít nhất 2 ký tự' });

    // Bảo mật: Tránh lỗi regex injection / ReDoS bằng cách escape các ký tự đặc biệt
    const escapedQuery = q.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');

    const users = await User.find({
      _id: { $ne: req.user._id },
      nickname: { $regex: escapedQuery, $options: 'i' }
    }).select('nickname avatar isOnline').limit(20);

    res.json(users);
  } catch (err) {
    sendServerError(res, err);
  }
});

// POST /api/friends/request/:userId — gửi lời mời kết bạn
router.post('/request/:userId', protect, async (req, res) => {
  try {
    const receiverId = req.params.userId;

    if (!mongoose.Types.ObjectId.isValid(receiverId)) {
      return res.status(400).json({ message: 'ID người dùng không hợp lệ' });
    }

    if (receiverId === req.user._id.toString())
      return res.status(400).json({ message: 'Không thể kết bạn với chính mình' });

    // Kiểm tra đã có quan hệ chưa
    const exists = await Friendship.findOne({
      $or: [
        { sender: req.user._id, receiver: receiverId },
        { sender: receiverId, receiver: req.user._id },
      ],
    });

    if (exists) {
      if (exists.status === 'accepted')
        return res.status(400).json({ message: 'Đã là bạn bè' });
      if (exists.status === 'pending')
        return res.status(400).json({ message: 'Đã gửi lời mời rồi' });
      if (exists.status === 'rejected') {
        // Cập nhật lại lời mời nếu trước đó bị từ chối
        exists.sender = req.user._id;
        exists.receiver = receiverId;
        exists.status = 'pending';
        await exists.save();
        await exists.populate('sender', userFields.BASIC);
        await exists.populate('receiver', userFields.BASIC);
        return res.status(200).json(exists);
      }
    }

    const friendship = await Friendship.create({
      sender: req.user._id,
      receiver: receiverId,
    });

    await friendship.populate('sender', userFields.BASIC);
    await friendship.populate('receiver', userFields.BASIC);

    res.status(201).json(friendship);
  } catch (err) {
    sendServerError(res, err);
  }
});

// PUT /api/friends/accept/:friendshipId — chấp nhận lời mời
router.put('/accept/:friendshipId', protect, async (req, res) => {
  try {
    const friendship = await Friendship.findOne({
      _id: req.params.friendshipId,
      receiver: req.user._id,
      status: 'pending',
    });

    if (!friendship)
      return res.status(404).json({ message: 'Không tìm thấy lời mời' });

    friendship.status = 'accepted';
    await friendship.save();

    // Tự động tạo phòng DM giữa 2 người (tái sử dụng nếu đã từng kết bạn trước đó)
    let dmRoom = await Room.findOne({
      isDM: true,
      members: { $all: [friendship.sender, friendship.receiver] },
    });
    if (!dmRoom) {
      dmRoom = await Room.create({
        name: `dm_${friendship.sender}_${friendship.receiver}`,
        isDM: true,
        isPrivate: true,
        members: [friendship.sender, friendship.receiver],
        createdBy: req.user._id,
      });
    }

    await friendship.populate('sender', userFields.WITH_STATUS);
    await friendship.populate('receiver', userFields.WITH_STATUS);

    // Phát sự kiện room:added cho cả hai người dùng đang online (Sửa lỗi Real-time DM room)
    const io = req.app.get('socketio');
    if (io) {
      const allSockets = await io.fetchSockets();
      const memberIds = [friendship.sender._id.toString(), friendship.receiver._id.toString()];
      const populatedDmRoom = await Room.findById(dmRoom._id).populate('members', userFields.WITH_STATUS);
      
      allSockets.forEach(s => {
        if (s.data.user && memberIds.includes(s.data.user._id.toString())) {
          s.join(dmRoom._id.toString());
          s.emit('room:added', populatedDmRoom);
          // Báo riêng cho người GỬI lời mời biết đã được chấp nhận (người nhận vừa bấm nút, tự biết rồi)
          if (s.data.user._id.toString() === friendship.sender._id.toString()) {
            s.emit('friend:request_accepted', {
              receiverId: friendship.receiver._id,
              receiverNickname: friendship.receiver.nickname || friendship.receiver.username,
              dmRoomId: dmRoom._id,
            });
          }
        }
      });
    }

    res.json({ friendship, dmRoom });
  } catch (err) {
    sendServerError(res, err);
  }
});

// PUT /api/friends/reject/:friendshipId — từ chối lời mời
router.put('/reject/:friendshipId', protect, async (req, res) => {
  try {
    const friendship = await Friendship.findOneAndDelete({
      _id: req.params.friendshipId,
      receiver: req.user._id,
      status: 'pending',
    });

    if (!friendship)
      return res.status(404).json({ message: 'Không tìm thấy lời mời' });

    res.json({ message: 'Đã từ chối lời mời kết bạn' });
  } catch (err) {
    sendServerError(res, err);
  }
});

// DELETE /api/friends/unfriend/:userId — hủy kết bạn với user
router.delete('/unfriend/:userId', protect, async (req, res) => {
  try {
    const friendship = await Friendship.findOneAndDelete({
      $or: [
        { sender: req.user._id, receiver: req.params.userId },
        { sender: req.params.userId, receiver: req.user._id },
      ],
      status: 'accepted',
    });

    if (!friendship)
      return res.status(404).json({ message: 'Không tìm thấy quan hệ bạn bè' });

    res.json({ message: 'Đã hủy kết bạn thành công' });
  } catch (err) {
    sendServerError(res, err);
  }
});

// DELETE /api/friends/cancel/:userId — hủy lời mời kết bạn đã gửi
router.delete('/cancel/:userId', protect, async (req, res) => {
  try {
    const friendship = await Friendship.findOneAndDelete({
      sender: req.user._id,
      receiver: req.params.userId,
      status: 'pending',
    });

    if (!friendship)
      return res.status(404).json({ message: 'Không tìm thấy lời mời kết bạn' });

    res.json({ message: 'Đã hủy lời mời kết bạn' });
  } catch (err) {
    sendServerError(res, err);
  }
});

// GET /api/friends/dm/:userId — lấy phòng DM với user
router.get('/dm/:userId', protect, async (req, res) => {
  try {
    const dmRoom = await Room.findOne({
      isDM: true,
      members: { $all: [req.user._id, req.params.userId] },
    }).populate('members', userFields.WITH_STATUS);

    if (!dmRoom)
      return res.status(404).json({ message: 'Chưa có phòng DM' });

    res.json(dmRoom);
  } catch (err) {
    sendServerError(res, err);
  }
});

// GET /api/friends/profile/:userId — lấy thông tin profile của user khác
router.get('/profile/:userId', protect, async (req, res) => {
  try {
    const targetId = req.params.userId;
    const currentId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({ message: 'ID người dùng không hợp lệ' });
    }

    const targetUser = await User.findById(targetId).select('-password');
    if (!targetUser) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng' });
    }

    let friendshipStatus = 'none';
    let friendshipId = null;
    let customAlias = '';

    if (currentId.toString() === targetId.toString()) {
      friendshipStatus = 'self';
    } else {
      const friendship = await Friendship.findOne({
        $or: [
          { sender: currentId, receiver: targetId },
          { sender: targetId, receiver: currentId },
        ],
      });

      if (friendship) {
        friendshipId = friendship._id;
        const isSender = friendship.sender.toString() === currentId.toString();
        customAlias = isSender ? (friendship.senderAlias || '') : (friendship.receiverAlias || '');

        if (friendship.status === 'accepted') {
          friendshipStatus = 'accepted';
        } else if (friendship.status === 'pending') {
          if (isSender) {
            friendshipStatus = 'pending_sent';
          } else {
            friendshipStatus = 'pending_received';
          }
        }
      }
    }

    // Lấy danh sách các nhóm chat chung (Mutual Rooms)
    const currentObjId = new mongoose.Types.ObjectId(currentId);
    const targetObjId = new mongoose.Types.ObjectId(targetId);

    const mutualRooms = await Room.find({
      isDM: { $ne: true },
      $and: [
        { members: { $in: [currentObjId, currentId.toString()] } },
        { members: { $in: [targetObjId, targetId.toString()] } },
      ],
    })
      .select('name avatar members createdAt')
      .populate('members', userFields.WITH_STATUS_LASTSEEN);

    const isFriendOrSelf = friendshipStatus === 'accepted' || friendshipStatus === 'self';

    const maskEmail = (email) => {
      if (!email) return '';
      const [name, domain] = email.split('@');
      if (!domain) return email;
      if (name.length <= 2) return `${name}***@${domain}`;
      return `${name.slice(0, 2)}***@${domain}`;
    };

    const maskPhone = (phone) => {
      if (!phone) return '';
      if (phone.length <= 4) return '***';
      return `${phone.slice(0, 3)}***${phone.slice(-2)}`;
    };

    res.json({
      user: {
        _id: targetUser._id,
        username: targetUser.username,
        nickname: targetUser.nickname,
        avatar: targetUser.avatar,
        cover: targetUser.cover || '',
        isOnline: targetUser.isOnline,
        lastSeen: targetUser.lastSeen,
        createdAt: targetUser.createdAt,
        bio: targetUser.bio || '',
        gender: isFriendOrSelf ? (targetUser.gender || '') : '',
        dateOfBirth: isFriendOrSelf ? targetUser.dateOfBirth : null,
        email: isFriendOrSelf ? targetUser.email : maskEmail(targetUser.email),
        phone: isFriendOrSelf ? targetUser.phone : maskPhone(targetUser.phone),
      },
      friendshipStatus,
      friendshipId,
      customAlias,
      mutualRooms,
    });
  } catch (err) {
    sendServerError(res, err);
  }
});

// PUT /api/friends/alias/:userId — đặt biệt danh riêng cho bạn bè
router.put('/alias/:userId', protect, async (req, res) => {
  try {
    const targetId = req.params.userId;
    const currentId = req.user._id;
    const { alias } = req.body;

    const friendship = await Friendship.findOne({
      $or: [
        { sender: currentId, receiver: targetId },
        { sender: targetId, receiver: currentId },
      ],
      status: 'accepted',
    });

    if (!friendship) {
      return res.status(400).json({ message: 'Chỉ có thể đặt biệt danh cho bạn bè' });
    }

    const isSender = friendship.sender.toString() === currentId.toString();
    if (isSender) {
      friendship.senderAlias = (alias || '').trim();
    } else {
      friendship.receiverAlias = (alias || '').trim();
    }

    await friendship.save();

    res.json({
      message: 'Cập nhật biệt danh thành công',
      customAlias: isSender ? friendship.senderAlias : friendship.receiverAlias,
    });
  } catch (err) {
    sendServerError(res, err);
  }
});

module.exports = router;