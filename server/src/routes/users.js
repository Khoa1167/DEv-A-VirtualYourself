const router     = require('express').Router();
const User       = require('../models/User');
const { protect } = require('../middleware/auth');
const sendServerError = require('../utils/sendServerError');

const getDevicesRateLimitMap = new Map();

// ─── GET /api/users/:userId/devices — Lấy publicKeys các thiết bị của user khác
router.get('/:userId/devices', protect, async (req, res) => {
  try {
    const callerId = req.user._id.toString();
    const now = Date.now();

    // Rate limit 60 req/phút/user
    const limitEntry = getDevicesRateLimitMap.get(callerId) || { count: 0, resetTime: now + 60000 };
    if (now > limitEntry.resetTime) { limitEntry.count = 0; limitEntry.resetTime = now + 60000; }
    limitEntry.count += 1;
    getDevicesRateLimitMap.set(callerId, limitEntry);

    if (limitEntry.count > 60) {
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

module.exports = router;
