const router     = require('express').Router();
const User       = require('../models/User');
const { protect } = require('../middleware/auth');
const sendServerError = require('../utils/sendServerError');
const { checkRateWindow } = require('../utils/rateLimiter');

const getDevicesRateLimitMap = new Map();

// ─── GET /api/users/:userId/devices — Lấy publicKeys các thiết bị của user khác
router.get('/:userId/devices', protect, async (req, res) => {
  try {
    const callerId = req.user._id.toString();

    // Rate limit 60 req/phút/user
    const limit = checkRateWindow(getDevicesRateLimitMap, callerId, { maxCount: 60, windowMs: 60000 });
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

module.exports = router;
