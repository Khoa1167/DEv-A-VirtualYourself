const router     = require('express').Router();
const User       = require('../models/User');
const { protect } = require('../middleware/auth');
const sendServerError = require('../utils/sendServerError');
const { checkRateWindow } = require('../utils/rateLimiter');

const NS_GET_DEVICES = 'get-devices';

// ─── GET /api/users/:userId/devices — Lấy publicKeys các thiết bị của user khác
router.get('/:userId/devices', protect, async (req, res) => {
  try {
    const callerId = req.user._id.toString();

    // Rate limit 60 req/phút/user
    const limit = await checkRateWindow(NS_GET_DEVICES, callerId, { maxCount: 60, windowMs: 60000 });
    if (limit.limited) {
      return res.status(429).json({ message: 'Quá nhiều yêu cầu truy vấn thiết bị' });
    }

    const targetUser = await User.findById(req.params.userId).select('devices');
    if (!targetUser) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng' });
    }

    const activeDevices = targetUser.devices
      .filter(d => !d.isRevoked)
      .map(d => ({ deviceId: d.deviceId, publicKey: d.publicKey }));

    res.json(activeDevices);
  } catch (err) {
    sendServerError(res, err);
  }
});

// ─── POST /api/users/devices/batch — Lấy publicKeys thiết bị nhiều user cùng lúc
// Thay cho việc gọi GET /:userId/devices lặp lại theo từng thành viên phòng (N+1 request).
router.post('/devices/batch', protect, async (req, res) => {
  try {
    const callerId = req.user._id.toString();

    const limit = await checkRateWindow(NS_GET_DEVICES, callerId, { maxCount: 60, windowMs: 60000 });
    if (limit.limited) {
      return res.status(429).json({ message: 'Quá nhiều yêu cầu truy vấn thiết bị' });
    }

    const { userIds } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ message: 'userIds phải là mảng không rỗng' });
    }

    const users = await User.find({ _id: { $in: userIds } }).select('devices');

    const activeDevices = users.flatMap(u =>
      u.devices
        .filter(d => !d.isRevoked)
        .map(d => ({ deviceId: d.deviceId, publicKey: d.publicKey }))
    );

    res.json(activeDevices);
  } catch (err) {
    sendServerError(res, err);
  }
});

module.exports = router;
