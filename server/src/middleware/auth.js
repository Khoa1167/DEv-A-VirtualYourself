const User = require('../models/User');
const { verifyJwt } = require('../utils/jwtKeys');

const protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Chưa đăng nhập' });

    const decoded = verifyJwt(token);
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) return res.status(401).json({ message: 'User không tồn tại' });

    // 0. Invalidate old tokens after password change
    // So sánh ở độ chính xác giây (giống JWT `iat`) — nếu quy passwordChangedAt (mili-giây)
    // thẳng sang Date rồi so với tokenIssuedAt (luôn tròn giây), token cấp cùng giây với
    // lúc đổi mật khẩu sẽ luôn bị coi là "cũ hơn" một cách sai lệch do phần mili-giây bị cắt.
    if (decoded.iat && req.user.passwordChangedAt) {
      const passwordChangedAtSeconds = Math.floor(new Date(req.user.passwordChangedAt).getTime() / 1000);
      if (decoded.iat < passwordChangedAtSeconds) {
        return res.status(401).json({ message: 'Token đã hết hạn do thay đổi mật khẩu' });
      }
    }

    // 1. Phân biệt Bootstrap Token vs Device Token
    if (!decoded.deviceId) {
      // Bootstrap Token (Hạn 15m, chưa đăng ký device) ➔ Chỉ cho phép các API whitelist cơ bản
      const baseUrl = req.baseUrl || '';
      const path = req.path || '';
      const fullPath = (baseUrl + path).toLowerCase();

      const isWhitelisted =
        fullPath.includes('/api/auth/me') ||
        fullPath.includes('/api/auth/profile') ||
        fullPath.includes('/api/auth/devices') ||
        fullPath.includes('/api/auth/set-nickname');

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

// Dùng sau protect — chặn các route quản trị toàn hệ thống (duyệt report...) khỏi user thường.
// Khác "chủ phòng/quản trị viên nhóm" (Room.createdBy/admins) — đây là role toàn app trên User.
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Chỉ quản trị viên hệ thống mới có quyền truy cập' });
  }
  next();
};

module.exports = { protect, requireAdmin };