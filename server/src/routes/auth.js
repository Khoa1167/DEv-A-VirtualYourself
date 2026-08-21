const router      = require('express').Router();
const bcrypt      = require('bcryptjs');
const mongoose    = require('mongoose');
const User          = require('../models/User');
const Room          = require('../models/Room');
const PendingUser   = require('../models/PendingUser');
const PasswordReset = require('../models/PasswordReset');
const EmailChange   = require('../models/EmailChange');
const { protect }   = require('../middleware/auth');
const {
  sendOTPEmail,
  sendResetPasswordOTPEmail,
  sendEmailChangeOTPEmail,
  sendEmailChangeNoticeEmail
} = require('../config/mailer');
const { uploadAvatar, uploadCover, deleteCloudinaryImage } = require('../config/cloudinary');
const sendServerError = require('../utils/sendServerError');
const { checkLock, recordFailure, clearFailures, checkRateWindow } = require('../utils/rateLimiter');
const { verifyTurnstile } = require('../utils/turnstile');
const { signJwt, verifyJwt } = require('../utils/jwtKeys');

const crypto = require('crypto');

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRegex = /^\+?[0-9]{7,15}$/;
// username: định danh đăng nhập, chỉ ASCII an toàn — không cần hỗ trợ Unicode (đã có nickname
// riêng cho tên hiển thị), tránh giả mạo bằng ký tự nhìn giống (homoglyph) hay ký tự vô hình.
const usernameRegex = /^[a-zA-Z0-9_.]{3,16}$/;
// nickname: chỉ chặn nhóm ký tự Control/Format/Private-Use/Surrogate (\p{C}) — zero-width,
// bidi-override... đây mới là nhóm thực sự dùng để giả mạo/vô hình. Ký hiệu, emoji, dấu câu
// bình thường đều cho qua (không whitelist hẹp theo L/M/N để khỏi chặn nhầm ký hiệu trang trí).
const nicknameRegex = /^(?!.*\p{C})[\s\S]{2,20}$/u;

const normalizeEmail = (value) => typeof value === 'string' ? value.toLowerCase().trim() : '';
const normalizePhone = (value) => typeof value === 'string' ? value.trim().replace(/[()\s\-]/g, '') : '';
const isValidEmail = (value) => emailRegex.test(value);
const isValidPhone = (value) => phoneRegex.test(value);
const isValidUsername = (value) => typeof value === 'string' && usernameRegex.test(value);
// NFC: gộp các cách biểu diễn Unicode khác nhau của cùng 1 ký tự có dấu về đúng 1 dạng, để chuỗi
// nhìn giống hệt nhau thì so trùng lặp cũng khớp nhau (khác byte nhưng cùng hiển thị sẽ không lách được).
const normalizeNickname = (value) => typeof value === 'string' ? value.trim().normalize('NFC') : '';
const isValidNickname = (value) => nicknameRegex.test(value);

// Bootstrap token (hạn 15m, chưa đăng ký device)
const genBootstrapToken = (id) =>
  signJwt({ id }, { expiresIn: '15m' });

// Device token (hạn 7d, gắn deviceId & tokenVersion per-device)
const genDeviceToken = (id, deviceId, tokenVersion) =>
  signJwt({ id, deviceId, tokenVersion }, { expiresIn: '7d' });

const genToken = genBootstrapToken;

// Tạo OTP 6 số ngẫu nhiên an toàn bảo mật (Crypto Secure PRNG)
const generateOTP = () =>
  crypto.randomInt(100000, 1000000).toString();

// Hash mã OTP bằng SHA-256 trước khi lưu vào DB
const hashOTP = (otp) =>
  crypto.createHash('sha256').update(otp).digest('hex');

// Chống spam OTP đốt hạn ngạch email (Brevo free tier 300/ngày) — dùng chung cho mọi route gửi
// OTP qua email (send-otp đăng ký, forgot-password) — 3 lớp: theo IP + theo email đích (chặn kịp
// thời 1 nguồn/1 nạn nhân, map riêng từng route) và ngân sách toàn hệ thống/ngày dùng CHUNG 1 bộ
// đếm (chặn botnet rải nhiều IP/email khác nhau ở bất kỳ route nào, vốn 2 lớp trên không chặn nổi
// — nếu để mỗi route tự có ngân sách riêng thì cộng dồn lại vẫn có thể vượt hạn 300/ngày của Brevo).
const NS_SEND_OTP_IP = 'send-otp-ip';
const NS_SEND_OTP_EMAIL = 'send-otp-email';
const NS_FORGOT_PASSWORD_IP = 'forgot-password-ip';
const NS_FORGOT_PASSWORD_EMAIL = 'forgot-password-email';
let dailyOtpBudget = { date: '', count: 0 };
const DAILY_OTP_BUDGET_MAX = 200; // chừa dư cho đổi email cũng dùng chung quota Brevo

const checkDailyOtpBudget = () => {
  const today = new Date().toISOString().split('T')[0];
  if (dailyOtpBudget.date !== today) {
    dailyOtpBudget = { date: today, count: 0 };
  }
  return dailyOtpBudget.count < DAILY_OTP_BUDGET_MAX;
};

// ─── POST /api/auth/send-otp ───────────────────────────────────────────────
router.post('/send-otp', async (req, res) => {
  try {
    const { username, password, email, phone, turnstileToken } = req.body;
    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = normalizePhone(phone || '');

    // Chặn bot trước cả rate-limit theo IP/email bên dưới (rate-limit chỉ giới hạn tốc độ,
    // không phân biệt được người thật hay script tự động)
    if (!(await verifyTurnstile(turnstileToken, req.ip))) {
      return res.status(400).json({ message: 'Xác minh CAPTCHA thất bại, vui lòng thử lại' });
    }

    // Validate cơ bản
    if (typeof username !== 'string' || typeof password !== 'string' || !normalizedEmail)
      return res.status(400).json({ message: 'Vui lòng điền đầy đủ thông tin' });
    if (!isValidUsername(username))
      return res.status(400).json({ message: 'Tên tài khoản chỉ được chứa chữ cái, số, dấu chấm hoặc gạch dưới (3-16 ký tự)' });
    if (password.length < 6)
      return res.status(400).json({ message: 'Mật khẩu phải có ít nhất 6 ký tự' });
    if (!isValidEmail(normalizedEmail))
      return res.status(400).json({ message: 'Email không hợp lệ' });
    if (phone && !isValidPhone(normalizedPhone))
      return res.status(400).json({ message: 'Số điện thoại không hợp lệ' });

    // Chống spam: tối đa 5 lần gửi OTP/15 phút theo IP, 3 lần theo email đích
    const ipLock = await checkLock(NS_SEND_OTP_IP, req.ip);
    if (ipLock.locked) {
      return res.status(429).json({ message: `Bạn đã yêu cầu OTP quá nhiều lần. Thử lại sau ${ipLock.waitMinutes} phút.` });
    }
    const emailLock = await checkLock(NS_SEND_OTP_EMAIL, normalizedEmail);
    if (emailLock.locked) {
      return res.status(429).json({ message: `Email này đã yêu cầu OTP quá nhiều lần. Thử lại sau ${emailLock.waitMinutes} phút.` });
    }
    if (!checkDailyOtpBudget()) {
      return res.status(503).json({ message: 'Hệ thống tạm ngừng gửi email OTP hôm nay, vui lòng thử lại vào ngày mai.' });
    }

    // Kiểm tra username/email đã tồn tại chưa
    const usernameExists = await User.findOne({ username });
    if (usernameExists)
      return res.status(400).json({ field: 'username', message: 'Tên tài khoản đã tồn tại' });

    const emailExists = await User.findOne({ email: normalizedEmail });
    if (emailExists)
      return res.status(400).json({ field: 'email', message: 'Email đã được sử dụng' });

    // Tạo OTP và hash password
    const otp            = generateOTP();
    const hashedOtp      = hashOTP(otp);
    const hashedPassword = await bcrypt.hash(password, 12);
    const expiresAt      = new Date(Date.now() + 5 * 60 * 1000); // 5 phút

    // Xóa pending user cũ nếu có, tạo mới hoàn toàn
    await PendingUser.deleteOne({ email: normalizedEmail });
    try {
      await PendingUser.create({
        username, hashedPassword, email: normalizedEmail,
        phone: normalizedPhone, otp: hashedOtp, expiresAt, attempts: 0,
      });
    } catch (err) {
      // Race condition: 2 người bấm đăng ký cùng username/email gần như đồng thời — unique index
      // chặn ở đây (atomic), dừng ngay trước khi tốn quota gửi mail cho người thua cuộc.
      if (err.code === 11000 && err.keyPattern?.username) {
        return res.status(400).json({ field: 'username', message: 'Tên tài khoản đang được người khác đăng ký, vui lòng thử tên khác' });
      }
      if (err.code === 11000 && err.keyPattern?.email) {
        return res.status(400).json({ field: 'email', message: 'Email này đang được người khác đăng ký, vui lòng thử lại sau' });
      }
      throw err;
    }

    // Gửi email OTP
    await sendOTPEmail(normalizedEmail, otp);
    if (process.env.NODE_ENV !== 'production') console.log(`[DEBUG] OTP for ${normalizedEmail}: ${otp}`);

    await recordFailure(NS_SEND_OTP_IP, req.ip);
    await recordFailure(NS_SEND_OTP_EMAIL, normalizedEmail, { maxAttempts: 3, lockMinutes: 15 });
    dailyOtpBudget.count += 1;

    res.json({ message: 'OTP đã được gửi tới email của bạn' });
  } catch (err) {
    console.error('send-otp error:', err);
    res.status(500).json({ message: 'Lỗi gửi OTP, vui lòng thử lại' });
  }
});

// ─── POST /api/auth/verify-otp ────────────────────────────────────────────
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !otp)
      return res.status(400).json({ message: 'Thiếu email hoặc OTP' });
    if (!isValidEmail(normalizedEmail))
      return res.status(400).json({ message: 'Email không hợp lệ' });

    const pending = await PendingUser.findOne({ email: normalizedEmail });
    if (!pending)
      return res.status(400).json({ message: 'Không tìm thấy yêu cầu đăng ký' });

    // Kiểm tra hết hạn
    if (new Date() > pending.expiresAt) {
      await PendingUser.deleteOne({ email: normalizedEmail });
      return res.status(400).json({ message: 'OTP đã hết hạn, vui lòng đăng ký lại' });
    }

    // Kiểm tra số lần nhập sai
    if (pending.attempts >= 5) {
      await PendingUser.deleteOne({ email: normalizedEmail });
      return res.status(400).json({ message: 'Quá nhiều lần nhập sai, vui lòng đăng ký lại' });
    }

    // Kiểm tra OTP đúng không bằng hash SHA-256
    const hashedInputOtp = hashOTP(otp.trim());
    if (pending.otp !== hashedInputOtp) {
      pending.attempts += 1;
      await pending.save();
      const remaining = 5 - pending.attempts;
      return res.status(400).json({
        message: `OTP không đúng, còn ${remaining} lần thử`
      });
    }

    // OTP đúng → tạo tài khoản thật
    const user = new User({
      username: pending.username,
      email:    pending.email,
      phone:    pending.phone,
      nickname: `user_${Date.now()}`,
      password: pending.hashedPassword,
    });
    // Đánh dấu password chưa bị thay đổi để bypass pre-save hook
    user.$__.activePaths.states.modify = {};
    try {
      await user.save({ validateBeforeSave: false });
    } catch (err) {
      if (err.code === 11000) {
        // Lưới an toàn cuối cùng cho race condition (PendingUser hết hạn/giải phóng username giữa
        // lúc người khác đang verify) — unique index của User chặn ở đây. Xóa pending, bắt đăng ký
        // lại từ đầu thay vì trả 500 chung chung + để pending kẹt lại vô ích. Đọc keyPattern để
        // báo đúng field bị trùng thay vì mặc định luôn đổ lỗi cho username.
        await PendingUser.deleteOne({ email: normalizedEmail });
        const field = err.keyPattern?.username ? 'username' : err.keyPattern?.email ? 'email' : 'nickname';
        const fieldMessage = {
          username: 'Tên tài khoản vừa bị người khác đăng ký trước, vui lòng đăng ký lại với tên khác',
          email:    'Email này vừa được đăng ký bởi tài khoản khác, vui lòng đăng ký lại với email khác',
          nickname: 'Đã có lỗi trùng lặp khi tạo tài khoản, vui lòng đăng ký lại',
        }[field];
        return res.status(409).json({ field, message: fieldMessage });
      }
      throw err;
    }

    // Xóa pending user
    await PendingUser.deleteOne({ email: normalizedEmail });

    res.status(201).json({
      message: 'Đăng ký thành công!',
      token: genToken(user._id),
      user,
    });
  } catch (err) {
    console.error('verify-otp error:', err);
    sendServerError(res, err);
  }
});

// ─── POST /api/auth/check-username ────────────────────────────────────────
router.post('/check-username', async (req, res) => {
  try {
    const { username } = req.body;
    if (!isValidUsername(username))
      return res.json({ available: false });
    const exists = await User.findOne({ username });
    res.json({ available: !exists });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ─── POST /api/auth/check-nickname ────────────────────────────────────────
router.post('/check-nickname', async (req, res) => {
  try {
    const normalizedNickname = normalizeNickname(req.body.nickname);
    if (!isValidNickname(normalizedNickname))
      return res.json({ available: false });
    const exists = await User.findOne({ nickname: normalizedNickname });
    res.json({ available: !exists });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ─── POST /api/auth/set-nickname ──────────────────────────────────────────
router.post('/set-nickname', protect, async (req, res) => {
  try {
    const normalizedNickname = normalizeNickname(req.body.nickname);
    if (!isValidNickname(normalizedNickname))
      return res.status(400).json({ message: 'Tên hiển thị không hợp lệ (2-20 ký tự, không chứa ký tự ẩn/điều khiển)' });

    // Chỉ cho phép thiết lập nickname lần đầu khi mới đăng ký tài khoản
    if (req.user.nicknameChangedAt) {
      return res.status(400).json({
        message: 'Bạn đã thiết lập tên hiển thị trước đó. Vui lòng đổi tên trong trang cá nhân.'
      });
    }

    const exists = await User.findOne({
      nickname: normalizedNickname, _id: { $ne: req.user._id }
    });
    if (exists)
      return res.status(400).json({ field: 'nickname', message: 'Tên hiển thị đã tồn tại' });

    let user;
    try {
      user = await User.findByIdAndUpdate(
        req.user._id, { nickname: normalizedNickname, nicknameChangedAt: new Date() }, { new: true, runValidators: true }
      );
    } catch (err) {
      // Race condition: 2 người cùng đặt trùng nickname gần như đồng thời — check phía trên chỉ
      // là TOCTOU, unique index của User mới là lưới an toàn chặn thật ở đây.
      if (err.code === 11000 && err.keyPattern?.nickname) {
        return res.status(409).json({ field: 'nickname', message: 'Tên hiển thị vừa bị người khác đăng ký trước, vui lòng chọn tên khác' });
      }
      throw err;
    }
    res.json(user);
  } catch (err) {
    sendServerError(res, err);
  }
});

// Chống brute-force đăng nhập: tối đa 5 lần sai / 15 phút, tính theo username
const NS_LOGIN = 'login';

// ─── POST /api/auth/login ─────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { username, password, turnstileToken } = req.body;
    if (typeof username !== 'string' || typeof password !== 'string')
      return res.status(400).json({ message: 'Tên tài khoản hoặc mật khẩu không hợp lệ' });

    // Chặn bot/credential-stuffing trước cả rate-limit theo username bên dưới
    if (!(await verifyTurnstile(turnstileToken, req.ip))) {
      return res.status(400).json({ message: 'Xác minh CAPTCHA thất bại, vui lòng thử lại' });
    }

    const lock = await checkLock(NS_LOGIN, username);
    if (lock.locked) {
      return res.status(429).json({ message: `Tài khoản tạm thời bị khóa đăng nhập do nhập sai mật khẩu quá nhiều lần. Thử lại sau ${lock.waitMinutes} phút.` });
    }

    const user = await User.findOne({ username });
    if (!user || !(await user.comparePassword(password))) {
      await recordFailure(NS_LOGIN, username);
      return res.status(401).json({ message: 'Sai tên tài khoản hoặc mật khẩu' });
    }
    await clearFailures(NS_LOGIN, username);

    res.json({ token: genToken(user._id), user });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────
router.get('/me', protect, (req, res) => res.json(req.user));

// ─── PUT /api/auth/profile — cập nhật thông tin cá nhân ──────────────────
router.put('/profile', protect, async (req, res) => {
  try {
    const { nickname, email, phone, dateOfBirth, gender, bio } = req.body;
    const updates = {};

    if (nickname && nickname !== req.user.nickname) {
      const normalizedNickname = normalizeNickname(nickname);
      if (!isValidNickname(normalizedNickname))
        return res.status(400).json({ message: 'Tên hiển thị không hợp lệ (2-20 ký tự, không chứa ký tự ẩn/điều khiển)' });

      // Kiểm tra 7 ngày
      if (req.user.nicknameChangedAt) {
        const daysSinceChange = (Date.now() - new Date(req.user.nicknameChangedAt)) / (1000 * 60 * 60 * 24);
        if (daysSinceChange < 7) {
          const daysLeft = Math.ceil(7 - daysSinceChange);
          return res.status(400).json({
            message: `Bạn chỉ có thể đổi tên hiển thị sau ${daysLeft} ngày nữa`
          });
        }
      }

      const exists = await User.findOne({ nickname: normalizedNickname, _id: { $ne: req.user._id } });
      if (exists)
        return res.status(400).json({ message: 'Tên hiển thị đã tồn tại' });

      updates.nickname = normalizedNickname;
      updates.nicknameChangedAt = new Date();
    }

    if (email && email !== req.user.email) {
      return res.status(400).json({
        message: 'Để đổi email, vui lòng sử dụng tính năng Đổi Email riêng có xác thực bảo mật.'
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng' });
    }

    if (updates.nickname) {
      user.nickname = updates.nickname;
      user.nicknameChangedAt = updates.nicknameChangedAt;
    }

    if (phone !== undefined) {
      const normalizedPhone = normalizePhone(phone);
      if (normalizedPhone && !isValidPhone(normalizedPhone))
        return res.status(400).json({ message: 'Số điện thoại không hợp lệ' });
      user.phone = normalizedPhone;
    }

    if (dateOfBirth !== undefined) {
      user.dateOfBirth = dateOfBirth ? String(dateOfBirth) : '';
    }

    if (gender !== undefined) {
      user.gender = ['male', 'female', 'other'].includes(gender) ? gender : '';
    }

    if (bio !== undefined) {
      user.bio = bio.slice(0, 150);
    }

    await user.save();

    res.json(user);
  } catch (err) {
    sendServerError(res, err);
  }
});

// ─── POST /api/auth/request-email-change — Yêu cầu đổi email ────────────────
router.post('/request-email-change', protect, async (req, res) => {
  try {
    const { currentPassword, newEmail } = req.body;
    if (!currentPassword || !newEmail)
      return res.status(400).json({ message: 'Vui lòng nhập đầy đủ mật khẩu hiện tại và email mới' });

    const lowerNewEmail = normalizeEmail(newEmail);
    if (!isValidEmail(lowerNewEmail))
      return res.status(400).json({ message: 'Email mới không hợp lệ' });
    if (lowerNewEmail === req.user.email.toLowerCase()) {
      return res.status(400).json({ message: 'Email mới trùng với email hiện tại' });
    }

    // Kiểm tra mật khẩu hiện tại
    const user = await User.findById(req.user._id);
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch)
      return res.status(401).json({ message: 'Mật khẩu hiện tại không đúng' });

    // Kiểm tra email mới đã tồn tại chưa
    const emailExists = await User.findOne({ email: lowerNewEmail });
    if (emailExists)
      return res.status(400).json({ message: 'Email này đã được sử dụng bởi tài khoản khác' });

    // Rate Limiting: 60 giây giữa các lần yêu cầu OTP đổi email
    const existingRecord = await EmailChange.findOne({ userId: req.user._id });
    if (existingRecord && existingRecord.updatedAt) {
      const secondsSinceLastRequest = (Date.now() - new Date(existingRecord.updatedAt).getTime()) / 1000;
      if (secondsSinceLastRequest < 60) {
        return res.status(429).json({
          message: `Vui lòng chờ ${Math.ceil(60 - secondsSinceLastRequest)} giây trước khi gửi lại mã`
        });
      }
    }

    const otp = generateOTP();
    const hashedOtp = hashOTP(otp);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 phút

    await EmailChange.findOneAndUpdate(
      { userId: req.user._id },
      {
        newEmail: lowerNewEmail,
        otp: hashedOtp,
        expiresAt,
        attempts: 0,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Gửi OTP về Email Mới để xác nhận quyền sở hữu hộp thư mới
    try {
      await sendEmailChangeOTPEmail(lowerNewEmail, otp);
      if (process.env.NODE_ENV !== 'production') console.log(`[SECURITY DEBUG] Email Change OTP for new email ${lowerNewEmail}: ${otp}`);
    } catch (mailErr) {
      console.error('Lỗi gửi mail OTP đổi email:', mailErr.message);
    }

    // Gửi email cảnh báo bảo mật tới Email CŨ
    try {
      await sendEmailChangeNoticeEmail(req.user.email, lowerNewEmail);
    } catch (noticeErr) {
      console.error('Lỗi gửi mail cảnh báo bảo mật tới email cũ:', noticeErr.message);
    }

    res.json({ message: 'Mã OTP xác thực đã được gửi tới email mới của bạn. Chúng tôi cũng đã gửi một email cảnh báo bảo mật tới địa chỉ email hiện tại.' });
  } catch (err) {
    console.error('request-email-change error:', err);
    res.status(500).json({ message: 'Lỗi hệ thống, vui lòng thử lại sau' });
  }
});

// ─── POST /api/auth/verify-email-change — Xác nhận mã OTP đổi email ─────────
router.post('/verify-email-change', protect, async (req, res) => {
  try {
    const { newEmail, otp } = req.body;
    if (!newEmail || !otp)
      return res.status(400).json({ message: 'Thiếu email mới hoặc mã OTP' });

    const lowerNewEmail = normalizeEmail(newEmail);
    if (!isValidEmail(lowerNewEmail))
      return res.status(400).json({ message: 'Email mới không hợp lệ' });

    const record = await EmailChange.findOne({ userId: req.user._id, newEmail: lowerNewEmail });
    if (!record)
      return res.status(400).json({ message: 'Không tìm thấy yêu cầu thay đổi email' });

    if (new Date() > record.expiresAt) {
      await EmailChange.deleteOne({ _id: record._id });
      return res.status(400).json({ message: 'Mã OTP đã hết hạn, vui lòng thực hiện lại' });
    }

    if (record.attempts >= 5) {
      await EmailChange.deleteOne({ _id: record._id });
      return res.status(400).json({ message: 'Quá nhiều lần nhập sai mã OTP, vui lòng thực hiện lại' });
    }

    const hashedInputOtp = hashOTP(otp.trim());
    if (record.otp !== hashedInputOtp) {
      record.attempts += 1;
      await record.save();
      const remaining = 5 - record.attempts;
      return res.status(400).json({ message: `Mã OTP không chính xác, còn ${remaining} lần thử` });
    }

    // Kiểm tra lại lần nữa phòng trường hợp email vừa bị chiếm trong khi chờ nhập OTP
    const emailExists = await User.findOne({ email: lowerNewEmail, _id: { $ne: req.user._id } });
    if (emailExists) {
      await EmailChange.deleteOne({ _id: record._id });
      return res.status(400).json({ message: 'Email này đã được tài khoản khác sử dụng' });
    }

    // Cập nhật email mới vào User
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { email: lowerNewEmail },
      { returnDocument: 'after' }
    );

    // Xóa record EmailChange
    await EmailChange.deleteOne({ _id: record._id });

    res.json({ message: 'Đổi email thành công!', user: updatedUser });
  } catch (err) {
    console.error('verify-email-change error:', err);
    res.status(500).json({ message: 'Lỗi xác thực đổi email, vui lòng thử lại' });
  }
});

// ─── PUT /api/auth/change-password — đổi mật khẩu ─────────────────────────
router.put('/change-password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword)
      return res.status(400).json({ message: 'Vui lòng nhập đầy đủ thông tin' });
    if (newPassword.length < 6)
      return res.status(400).json({ message: 'Mật khẩu mới phải có ít nhất 6 ký tự' });

    const user = await User.findById(req.user._id);
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch)
      return res.status(401).json({ message: 'Mật khẩu hiện tại không đúng' });

    user.password = newPassword; // sẽ tự hash qua pre('save')
    await user.save();

    res.json({ message: 'Đổi mật khẩu thành công' });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ─── POST /api/auth/avatar — upload avatar ────────────────────────────────
router.post('/avatar', protect, uploadAvatar.single('avatar'), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ message: 'Không có file ảnh' });

    const oldAvatar = req.user.avatar;
    const avatarUrl = req.file.path; // Cloudinary trả về URL trong path

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { avatar: avatarUrl },
      { returnDocument: 'after' }
    );

    // Dọn dẹp ảnh avatar cũ trên Cloudinary
    if (oldAvatar && oldAvatar !== avatarUrl) {
      deleteCloudinaryImage(oldAvatar);
    }

    res.json(user);
  } catch (err) {
    sendServerError(res, err);
  }
});

// ─── POST /api/auth/cover — upload ảnh bìa ──────────────────────────────────
router.post('/cover', protect, uploadCover.single('cover'), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ message: 'Không có file ảnh' });

    const oldCover = req.user.cover;
    const coverUrl = req.file.path; // Cloudinary trả về URL trong path

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { cover: coverUrl },
      { returnDocument: 'after' }
    );

    // Dọn dẹp ảnh bìa cũ trên Cloudinary
    if (oldCover && oldCover !== coverUrl) {
      deleteCloudinaryImage(oldCover);
    }

    res.json(user);
  } catch (err) {
    sendServerError(res, err);
  }
});

// ─── DELETE /api/auth/cover — xóa ảnh bìa ──────────────────────────────────
router.delete('/cover', protect, async (req, res) => {
  try {
    const oldCover = req.user.cover;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { cover: '' },
      { returnDocument: 'after' }
    );

    // Dọn dẹp tệp ảnh bìa trên Cloudinary khi gỡ cover
    if (oldCover) {
      deleteCloudinaryImage(oldCover);
    }

    res.json(user);
  } catch (err) {
    sendServerError(res, err);
  }
});

// ─── POST /api/auth/forgot-password ─────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email, turnstileToken } = req.body;
    if (!email)
      return res.status(400).json({ message: 'Vui lòng nhập email' });

    // Chặn bot trước cả rate-limit theo IP/email bên dưới
    if (!(await verifyTurnstile(turnstileToken, req.ip))) {
      return res.status(400).json({ message: 'Xác minh CAPTCHA thất bại, vui lòng thử lại' });
    }

    const lowerEmail = normalizeEmail(email);
    if (!isValidEmail(lowerEmail))
      return res.status(400).json({ message: 'Email không hợp lệ' });

    // Chống spam: tối đa 5 lần yêu cầu/15 phút theo IP — chặn trước khi chạm DB
    const ipLock = await checkLock(NS_FORGOT_PASSWORD_IP, req.ip);
    if (ipLock.locked) {
      return res.status(429).json({ message: `Bạn đã yêu cầu quá nhiều lần. Thử lại sau ${ipLock.waitMinutes} phút.` });
    }
    await recordFailure(NS_FORGOT_PASSWORD_IP, req.ip);

    const user = await User.findOne({ email: lowerEmail });

    // Trả về thông báo chung để chống lộ thông tin người dùng (User Enumeration Protection)
    const genericResponse = {
      message: 'Nếu email tồn tại trên hệ thống, mã OTP đã được gửi tới email của bạn'
    };

    if (!user) {
      return res.json(genericResponse);
    }

    // Rate Limiting / Anti-Spam: Giới hạn tối thiểu 60 giây giữa các lần yêu cầu OTP
    const existingRecord = await PasswordReset.findOne({ email: lowerEmail });
    if (existingRecord && existingRecord.updatedAt) {
      const secondsSinceLastRequest = (Date.now() - new Date(existingRecord.updatedAt).getTime()) / 1000;
      if (secondsSinceLastRequest < 60) {
        return res.status(429).json({
          message: `Vui lòng chờ ${Math.ceil(60 - secondsSinceLastRequest)} giây trước khi gửi lại mã`
        });
      }
    }

    // Thêm trần 3 lần/15 phút theo email đích (cooldown 60s ở trên chỉ chặn dồn dập sát nhau,
    // vẫn lọt nếu request đúng cách nhau >60s liên tục) + ngân sách chung toàn hệ thống/ngày
    const emailLock = await checkLock(NS_FORGOT_PASSWORD_EMAIL, lowerEmail);
    if (emailLock.locked) {
      return res.status(429).json({ message: `Email này đã yêu cầu quá nhiều lần. Thử lại sau ${emailLock.waitMinutes} phút.` });
    }
    if (!checkDailyOtpBudget()) {
      return res.status(503).json({ message: 'Hệ thống tạm ngừng gửi email OTP hôm nay, vui lòng thử lại vào ngày mai.' });
    }

    const otp       = generateOTP();
    const hashedOtp = hashOTP(otp);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 phút

    // Sử dụng findOneAndUpdate với upsert để phòng tránh Race Conditions
    await PasswordReset.findOneAndUpdate(
      { email: lowerEmail },
      {
        otp: hashedOtp,
        expiresAt,
        attempts: 0,
        isVerified: false,
        resetToken: null,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Gửi Email OTP và bắt lỗi gián đoạn dịch vụ SMTP
    try {
      await sendResetPasswordOTPEmail(lowerEmail, otp);
      if (process.env.NODE_ENV !== 'production') console.log(`[SECURITY DEBUG] Reset Password OTP for ${lowerEmail}: ${otp}`);
    } catch (mailErr) {
      console.error('Lỗi dịch vụ gửi mail SMTP:', mailErr.message);
    }
    await recordFailure(NS_FORGOT_PASSWORD_EMAIL, lowerEmail, { maxAttempts: 3, lockMinutes: 15 });
    dailyOtpBudget.count += 1;

    res.json(genericResponse);
  } catch (err) {
    console.error('forgot-password error:', err);
    res.status(500).json({ message: 'Đã xảy ra lỗi hệ thống, vui lòng thử lại sau' });
  }
});

// ─── POST /api/auth/verify-reset-otp ───────────────────────────────────────
router.post('/verify-reset-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const lowerEmail = normalizeEmail(email);
    if (!lowerEmail || !otp)
      return res.status(400).json({ message: 'Thiếu email hoặc mã OTP' });
    if (!isValidEmail(lowerEmail))
      return res.status(400).json({ message: 'Email không hợp lệ' });

    const record = await PasswordReset.findOne({ email: lowerEmail });
    if (!record)
      return res.status(400).json({ message: 'Không tìm thấy yêu cầu đặt lại mật khẩu' });

    if (new Date() > record.expiresAt) {
      await PasswordReset.deleteOne({ email: lowerEmail });
      return res.status(400).json({ message: 'Mã OTP đã hết hạn, vui lòng yêu cầu gửi lại mã mới' });
    }

    if (record.attempts >= 5) {
      await PasswordReset.deleteOne({ email: lowerEmail });
      return res.status(400).json({ message: 'Quá nhiều lần nhập sai mã OTP, vui lòng thực hiện lại từ đầu' });
    }

    const hashedInputOtp = hashOTP(otp.trim());
    if (record.otp !== hashedInputOtp) {
      record.attempts += 1;
      await record.save();
      const remaining = 5 - record.attempts;
      return res.status(400).json({ message: `Mã OTP không chính xác, còn ${remaining} lần thử` });
    }

    const resetToken = signJwt(
      { email: lowerEmail, purpose: 'password_reset' },
      { expiresIn: '10m' }
    );

    record.isVerified = true;
    record.resetToken = resetToken;
    await record.save();

    res.json({ message: 'Xác thực OTP thành công', resetToken });
  } catch (err) {
    console.error('verify-reset-otp error:', err);
    res.status(500).json({ message: 'Lỗi xác thực OTP, vui lòng thử lại' });
  }
});

// ─── POST /api/auth/reset-password ──────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { email, resetToken, newPassword } = req.body;
    const lowerEmail = normalizeEmail(email);
    if (!lowerEmail || !resetToken || !newPassword)
      return res.status(400).json({ message: 'Vui lòng điền đầy đủ thông tin' });
    if (!isValidEmail(lowerEmail))
      return res.status(400).json({ message: 'Email không hợp lệ' });

    // Kiểm tra chính sách mật khẩu an toàn (Min length 6, kết hợp cả chữ cái & chữ số)
    if (newPassword.length < 6)
      return res.status(400).json({ message: 'Mật khẩu mới phải có ít nhất 6 ký tự' });

    const hasLetter = /[a-zA-Z]/.test(newPassword);
    const hasNumber = /[0-9]/.test(newPassword);
    if (!hasLetter || !hasNumber) {
      return res.status(400).json({ message: 'Mật khẩu mới phải bao gồm cả chữ cái và chữ số' });
    }

    let decoded;
    try {
      decoded = verifyJwt(resetToken);
    } catch {
      return res.status(400).json({ message: 'Phiên làm việc đã hết hạn, vui lòng thực hiện lại từ đầu' });
    }

    if (decoded.purpose !== 'password_reset' || decoded.email !== lowerEmail) {
      return res.status(400).json({ message: 'Mã token khôi phục không hợp lệ' });
    }

    const record = await PasswordReset.findOne({
      email: lowerEmail,
      resetToken,
      isVerified: true,
    });
    if (!record) {
      return res.status(400).json({ message: 'Yêu cầu không hợp lệ hoặc đã hết hạn' });
    }

    const user = await User.findOne({ email: lowerEmail });
    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng' });
    }

    user.password = newPassword; // sẽ tự hash trong userSchema.pre('save')
    await user.save();

    await PasswordReset.deleteOne({ email: lowerEmail });

    res.json({ message: 'Đặt lại mật khẩu thành công! Vui lòng đăng nhập bằng mật khẩu mới.' });
  } catch (err) {
    console.error('reset-password error:', err);
    res.status(500).json({ message: 'Lỗi đặt lại mật khẩu, vui lòng thử lại' });
  }
});

// Rate limit namespaces cho device management
const NS_DEVICE_PASSWORD = 'device-password';
const NS_DEVICE_MUTATION = 'device-mutation';
const NS_DEVICE_RENEWAL = 'device-renewal';

// Helper emit debounced key:changed event
const debouncedKeyChangedTimers = new Map();
const triggerDebouncedKeyChanged = (req, userId) => {
  const io = req.app.get('socketio');
  if (!io) return;
  const uIdStr = userId.toString();
  if (debouncedKeyChangedTimers.has(uIdStr)) {
    clearTimeout(debouncedKeyChangedTimers.get(uIdStr));
  }
  const timer = setTimeout(async () => {
    debouncedKeyChangedTimers.delete(uIdStr);
    // Bảo mật: chỉ báo cho người CÙNG PHÒNG với user này biết — io.emit() cũ phát cho TOÀN
    // SERVER, lộ metadata "user X vừa đổi/thêm/gỡ thiết bị" cho cả người lạ không liên quan.
    const rooms = await Room.find({ members: userId }).select('_id');
    rooms.forEach(r => io.to(r._id.toString()).emit('key:changed', { userId: uIdStr, timestamp: Date.now() }));
  }, 30000);
  debouncedKeyChangedTimers.set(uIdStr, timer);
};

// ─── PUT /api/auth/devices — Đăng ký / gia hạn / xoay khóa thiết bị ──────────
router.put('/devices', protect, async (req, res) => {
  try {
    const { deviceId, publicKey, deviceName, currentPassword } = req.body;
    if (!deviceId || !publicKey || !currentPassword) {
      return res.status(400).json({ message: 'Vui lòng cung cấp đầy đủ deviceId, publicKey và mật khẩu xác nhận' });
    }

    const userId = req.user._id.toString();
    const now = Date.now();

    // 1. Password Brute-Force Rate Limiter (Max 5 sai / 15m)
    const lock = await checkLock(NS_DEVICE_PASSWORD, userId);
    if (lock.locked) {
      return res.status(429).json({ message: `Tài khoản tạm thời bị khóa đăng ký thiết bị do nhập sai mật khẩu quá 5 lần. Thử lại sau ${lock.waitMinutes} phút.` });
    }

    // req.user không có field password (bị protect middleware loại bỏ), phải fetch riêng để so khớp
    const userWithPassword = await User.findById(req.user._id);
    const isMatch = await userWithPassword.comparePassword(currentPassword);
    if (!isMatch) {
      await recordFailure(NS_DEVICE_PASSWORD, userId);
      return res.status(401).json({ message: 'Mật khẩu xác nhận không chính xác' });
    }
    await clearFailures(NS_DEVICE_PASSWORD, userId);

    // Xử lý 3 nhánh bằng Transaction (kèm fallback nếu không có replica set)
    let finalShouldEmit = false;
    let finalTokenVersion = 0;
    let retries = 3;

    while (retries > 0) {
      let shouldEmitThisTry = false;
      let session = null;
      let isReplicaSet = true;

      try {
        session = await mongoose.startSession();
        session.startTransaction();
      } catch {
        isReplicaSet = false;
        if (session) session.endSession();
      }

      try {
        const user = isReplicaSet 
          ? await User.findById(req.user._id).session(session)
          : await User.findById(req.user._id);

        const existingDevice = user.devices.find(d => d.deviceId === deviceId);

        if (!existingDevice) {
          // Nhánh 1: Device chưa tồn tại (Device Mới)
          const activeDevicesCount = user.devices.filter(d => !d.isRevoked).length;
          if (activeDevicesCount >= 5) {
            if (isReplicaSet && session) { await session.abortTransaction(); session.endSession(); }
            return res.status(400).json({ message: 'Tài khoản đã đạt giới hạn 5 thiết bị đang hoạt động. Vui lòng gỡ bớt thiết bị cũ.' });
          }

          const mutLimit = await checkRateWindow(NS_DEVICE_MUTATION, userId, { maxCount: 3, windowMs: 3600000 });
          if (mutLimit.limited) {
            if (isReplicaSet && session) { await session.abortTransaction(); session.endSession(); }
            return res.status(429).json({ message: 'Bạn đã thay đổi thiết bị quá 3 lần/giờ. Vui lòng thử lại sau.' });
          }

          user.devices.push({
            deviceId,
            publicKey,
            deviceName: deviceName || 'Unknown Device',
            tokenVersion: 0,
            isRevoked: false,
            registeredAt: new Date(),
            lastActiveAt: new Date(),
          });
          finalTokenVersion = 0;
          shouldEmitThisTry = true;
        } else if (existingDevice.isRevoked) {
          // Nhánh 2: Device tồn tại và isRevoked === true (Reactivation)
          const mutLimit = await checkRateWindow(NS_DEVICE_MUTATION, userId, { maxCount: 3, windowMs: 3600000 });
          if (mutLimit.limited) {
            if (isReplicaSet && session) { await session.abortTransaction(); session.endSession(); }
            return res.status(429).json({ message: 'Bạn đã thay đổi thiết bị quá 3 lần/giờ. Vui lòng thử lại sau.' });
          }

          existingDevice.isRevoked = false;
          existingDevice.revokedAt = null;
          existingDevice.publicKey = publicKey;
          existingDevice.deviceName = deviceName || existingDevice.deviceName;
          existingDevice.tokenVersion += 1;
          existingDevice.lastActiveAt = new Date();
          finalTokenVersion = existingDevice.tokenVersion;
          shouldEmitThisTry = true;
        } else {
          // Nhánh 3: Device tồn tại và isRevoked === false (Active Device)
          if (existingDevice.publicKey === publicKey) {
            // Case 3a: Gia hạn token 7d bình thường (publicKey không đổi)
            const renewLimit = await checkRateWindow(NS_DEVICE_RENEWAL, userId, { maxCount: 30, windowMs: 3600000 });
            if (renewLimit.limited) {
              if (isReplicaSet && session) { await session.abortTransaction(); session.endSession(); }
              return res.status(429).json({ message: 'Quá nhiều yêu cầu gia hạn thiết bị. Thử lại sau.' });
            }

            existingDevice.lastActiveAt = new Date();
            if (deviceName) existingDevice.deviceName = deviceName;
            finalTokenVersion = existingDevice.tokenVersion;
            shouldEmitThisTry = false;
          } else {
            // Case 3b: Key Rotation / Mất Storage (publicKey khác cũ)
            const mutLimit = await checkRateWindow(NS_DEVICE_MUTATION, userId, { maxCount: 3, windowMs: 3600000 });
            if (mutLimit.limited) {
              if (isReplicaSet && session) { await session.abortTransaction(); session.endSession(); }
              return res.status(429).json({ message: 'Bạn đã thay đổi thiết bị quá 3 lần/giờ. Vui lòng thử lại sau.' });
            }

            existingDevice.publicKey = publicKey;
            if (deviceName) existingDevice.deviceName = deviceName;
            existingDevice.tokenVersion += 1;
            existingDevice.lastActiveAt = new Date();
            finalTokenVersion = existingDevice.tokenVersion;
            shouldEmitThisTry = true;
          }
        }

        if (isReplicaSet && session) {
          await user.save({ session });
          await session.commitTransaction();
          session.endSession();
        } else {
          await user.save();
        }

        finalShouldEmit = shouldEmitThisTry;
        break;
      } catch (err) {
        if (isReplicaSet && session) {
          await session.abortTransaction();
          session.endSession();
        }
        if (err.hasErrorLabel && err.hasErrorLabel('TransientTransactionError') && retries > 1) {
          retries--;
          continue;
        }
        throw err;
      }
    }

    if (finalShouldEmit) {
      triggerDebouncedKeyChanged(req, req.user._id);
    }

    const deviceToken = genDeviceToken(req.user._id, deviceId, finalTokenVersion);
    res.json({
      message: 'Đăng ký thiết bị thành công',
      token: deviceToken,
      deviceId,
      tokenVersion: finalTokenVersion
    });
  } catch (err) {
    console.error('PUT /api/auth/devices error:', err);
    res.status(500).json({ message: 'Lỗi đăng ký thiết bị' });
  }
});

// ─── DELETE /api/auth/devices/:deviceId — Soft delete gỡ bỏ thiết bị ─────────
router.delete('/devices/:deviceId', protect, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const user = req.user;

    const device = user.devices.find(d => d.deviceId === deviceId);
    if (!device) {
      return res.status(404).json({ message: 'Không tìm thấy thiết bị cần gỡ' });
    }

    if (device.isRevoked) {
      return res.json({ message: 'Thiết bị này đã bị gỡ trước đó' });
    }

    device.isRevoked = true;
    device.revokedAt = new Date();
    device.tokenVersion += 1;

    await user.save();

    triggerDebouncedKeyChanged(req, user._id);

    res.json({ message: 'Đã gỡ bỏ thiết bị thành công', deviceId });
  } catch (err) {
    console.error('DELETE /api/auth/devices error:', err);
    res.status(500).json({ message: 'Lỗi gỡ bỏ thiết bị' });
  }
});

// ─── GET /api/auth/devices — Lấy danh sách thiết bị của chính user hiện tại ───
router.get('/devices', protect, async (req, res) => {
  try {
    const includeRevoked = req.query.includeRevoked === 'true';
    const devices = req.user.devices.filter(d => includeRevoked || !d.isRevoked);
    res.json(devices);
  } catch (err) {
    sendServerError(res, err);
  }
});

// ─── POST /api/auth/logout — Thu hồi token hiện tại (không xóa hẳn thiết bị, khác /devices/:id) ─
// Bảo mật: logout trước đây chỉ xóa token khỏi sessionStorage phía client — token vẫn còn hiệu
// lực trên server tới hạn tự nhiên (7 ngày). Tăng tokenVersion của đúng thiết bị đang dùng khiến
// token cũ (kể cả bản sao bị đánh cắp) hết tác dụng ngay lập tức; đăng nhập lại trên máy này vẫn
// đăng ký lại thiết bị bình thường (không cần xóa/khôi phục E2EE key), khác hẳn revoke device.
router.post('/logout', protect, async (req, res) => {
  try {
    if (req.deviceId) {
      const device = req.user.devices.find(d => d.deviceId === req.deviceId);
      if (device) {
        device.tokenVersion += 1;
        await req.user.save();
      }
    }
    // Bootstrap token (chưa đăng ký thiết bị, hạn sẵn 15 phút) — không có gì để thu hồi thêm
    res.json({ message: 'Đã đăng xuất' });
  } catch (err) {
    sendServerError(res, err);
  }
});

module.exports = router;