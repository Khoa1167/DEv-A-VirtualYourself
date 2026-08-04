const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Chưa đăng nhập' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) return res.status(401).json({ message: 'User không tồn tại' });

    // 1. Phân biệt Bootstrap Token vs Device Token
    if (!decoded.deviceId) {
      // Bootstrap Token (Hạn 15m, chưa đăng ký device) ➔ Chỉ cho phép các API whitelist cơ bản
      const baseUrl = req.baseUrl || '';
      const path = req.path || '';
      const fullPath = (baseUrl + path).toLowerCase();

      const isWhitelisted = 
        fullPath.includes('/api/auth/me') ||
        fullPath.includes('/api/auth/profile') ||
        fullPath.includes('/api/auth/devices');

      if (!isWhitelisted) {
        return res.status(403).json({ 
          message: 'Yêu cầu đăng ký thiết bị trước khi truy cập dữ liệu',
          code: 'REQUIRE_DEVICE_REGISTRATION'
        });
      }
      req.isBootstrapToken = true;
    } else {
      // Device Token ➔ Kiểm tra deviceId & tokenVersion per-device
      const device = req.user.devices.find(d => d.deviceId === decoded.deviceId);
      if (!device || device.isRevoked || device.tokenVersion !== decoded.tokenVersion) {
        return res.status(401).json({ 
          message: 'Phiên làm việc trên thiết bị này đã bị gỡ bỏ hoặc không còn hợp lệ',
          code: 'DEVICE_SESSION_INVALID' 
        });
      }
      req.deviceId = decoded.deviceId;
    }

    next();
  } catch (err) {
    res.status(401).json({ message: 'Token không hợp lệ hoặc đã hết hạn' });
  }
};

module.exports = { protect };