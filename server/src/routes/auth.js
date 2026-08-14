const router      = require('express').Router();
const jwt         = require('jsonwebtoken');
const bcrypt      = require('bcryptjs');
const mongoose    = require('mongoose');
const User          = require('../models/User');
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

const crypto = require('crypto');

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRegex = /^\+?[0-9]{7,15}$/;

const normalizeEmail = (value) => typeof value === 'string' ? value.toLowerCase().trim() : '';
const normalizePhone = (value) => typeof value === 'string' ? value.trim().replace(/[()\s\-]/g, '') : '';
const isValidEmail = (value) => emailRegex.test(value);
const isValidPhone = (value) => phoneRegex.test(value);

// Bootstrap token (hạn 15m, chưa đăng ký device)
const genBootstrapToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '15m' });

// Device token (hạn 7d, gắn deviceId & tokenVersion per-device)
const genDeviceToken = (id, deviceId, tokenVersion) =>
  jwt.sign({ id, deviceId, tokenVersion }, process.env.JWT_SECRET, { expiresIn: '7d' });

const genToken = genBootstrapToken;

// Tạo OTP 6 số ngẫu nhiên an toàn bảo mật (Crypto Secure PRNG)
const generateOTP = () =>
  crypto.randomInt(100000, 1000000).toString();

// Hash mã OTP bằng SHA-256 trước khi lưu vào DB
const hashOTP = (otp) =>
  crypto.createHash('sha256').update(otp).digest('hex');

// ─── POST /api/auth/send-otp ───────────────────────────────────────────────
router.post('/send-otp', async (req, res) => {
  try {
    const { username, password, email, phone } = req.body;
    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = normalizePhone(phone || '');

    // Validate cơ bản
    if (typeof username !== 'string' || typeof password !== 'string' || !normalizedEmail)
      return res.status(400).json({ message: 'Vui lòng điền đầy đủ thông tin' });
    if (username.length < 3)
      return res.status(400).json({ message: 'Tên tài khoản phải có ít nhất 3 ký tự' });
    if (password.length < 6)
      return res.status(400).json({ message: 'Mật khẩu phải có ít nhất 6 ký tự' });
    if (!isValidEmail(normalizedEmail))
      return res.status(400).json({ message: 'Email không hợp lệ' });
    if (phone && !isValidPhone(normalizedPhone))
      return res.status(400).json({ message: 'Số điện thoại không hợp lệ' });

    // Kiểm tra username/email đã tồn tại chưa
    const usernameExists = await User.findOne({ username });
    if (usernameExists)
      return res.status(400).json({ message: 'Tên tài khoản đã tồn tại' });

    const emailExists = await User.findOne({ email: normalizedEmail });
    if (emailExists)
      return res.status(400).json({ message: 'Email đã được sử dụng' });

    // Tạo OTP và hash password
    const otp            = generateOTP();
    const hashedOtp      = hashOTP(otp);
    const hashedPassword = await bcrypt.hash(password, 12);
    const expiresAt      = new Date(Date.now() + 5 * 60 * 1000); // 5 phút

    // Xóa pending user cũ nếu có, tạo mới hoàn toàn
    await PendingUser.deleteOne({ email: normalizedEmail });
    await PendingUser.create({
      username, hashedPassword, email: normalizedEmail,
      phone: normalizedPhone, otp: hashedOtp, expiresAt, attempts: 0,
    });

    // Gửi email OTP
    await sendOTPEmail(normalizedEmail, otp);
    if (process.env.NODE_ENV !== 'production') console.log(`[DEBUG] OTP for ${normalizedEmail}: ${otp}`);

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
      await PendingUser.deleteOne({ email });
      return res.status(400).json({ message: 'OTP đã hết hạn, vui lòng đăng ký lại' });
    }

    // Kiểm tra số lần nhập sai
    if (pending.attempts >= 5) {
      await PendingUser.deleteOne({ email });
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
    await user.save({ validateBeforeSave: false });

    // Xóa pending user
    await PendingUser.deleteOne({ email });

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
    if (typeof username !== 'string')
      return res.status(400).json({ message: 'Tên tài khoản không hợp lệ' });
    const exists = await User.findOne({ username });
    res.json({ available: !exists });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ─── POST /api/auth/check-nickname ────────────────────────────────────────
router.post('/check-nickname', async (req, res) => {
  try {
    const { nickname } = req.body;
    if (typeof nickname !== 'string')
      return res.status(400).json({ message: 'Tên hiển thị không hợp lệ' });
    const exists = await User.findOne({ nickname });
    res.json({ available: !exists });
  } catch (err) {
    sendServerError(res, err);
  }
});

// ─── POST /api/auth/set-nickname ──────────────────────────────────────────
router.post('/set-nickname', protect, async (req, res) => {
  try {
    const { nickname } = req.body;
    const normalizedNickname = typeof nickname === 'string' ? nickname.trim() : '';
    if (!normalizedNickname || normalizedNickname.length < 2)
      return res.status(400).json({ message: 'Nickname phải có ít nhất 2 ký tự' });

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
      return res.status(400).json({ message: 'Tên hiển thị đã tồn tại' });

    const user = await User.findByIdAndUpdate(
      req.user._id, { nickname: normalizedNickname, nicknameChangedAt: new Date() }, { new: true, runValidators: true }
    );
    res.json(user);
  } catch (err) {
    sendServerError(res, err);
  }
});

// Chống brute-force đăng nhập: tối đa 5 lần sai / 15 phút, tính theo username
const loginFailedAttemptsMap = new Map();

// ─── POST /api/auth/login ─────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (typeof username !== 'string' || typeof password !== 'string')
      return res.status(400).json({ message: 'Tên tài khoản hoặc mật khẩu không hợp lệ' });

    const now = Date.now();
    const failEntry = loginFailedAttemptsMap.get(username) || { count: 0, lockUntil: 0 };
    if (now < failEntry.lockUntil) {
      const waitMins = Math.ceil((failEntry.lockUntil - now) / 60000);
      return res.status(429).json({ message: `Tài khoản tạm thời bị khóa đăng nhập do nhập sai mật khẩu quá nhiều lần. Thử lại sau ${waitMins} phút.` });
    }

    const user = await User.findOne({ username });
    if (!user || !(await user.comparePassword(password))) {
      failEntry.count += 1;
      if (failEntry.count >= 5) {
        failEntry.lockUntil = now + 15 * 60 * 1000;
        failEntry.count = 0;
      }
      loginFailedAttemptsMap.set(username, failEntry);
      return res.status(401).json({ message: 'Sai tên tài khoản hoặc mật khẩu' });
    }
    loginFailedAttemptsMap.delete(username);

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
      const normalizedNickname = typeof nickname === 'string' ? nickname.trim() : '';
      if (!normalizedNickname || normalizedNickname.length < 2)
        return res.status(400).json({ message: 'Nickname phải có ít nhất 2 ký tự' });

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
    const { email } = req.body;
    if (!email)
      return res.status(400).json({ message: 'Vui lòng nhập email' });

    const lowerEmail = normalizeEmail(email);
    if (!isValidEmail(lowerEmail))
      return res.status(400).json({ message: 'Email không hợp lệ' });
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

    const resetToken = jwt.sign(
      { email: lowerEmail, purpose: 'password_reset' },
      process.env.JWT_SECRET,
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
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
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

// Rate limit maps cho device management
const failedPasswordMap = new Map();
const mutationRateLimitMap = new Map();
const renewalRateLimitMap = new Map();

// Helper emit debounced key:changed event
const debouncedKeyChangedTimers = new Map();
const triggerDebouncedKeyChanged = (req, userId) => {
  const io = req.app.get('socketio');
  if (!io) return;
  const uIdStr = userId.toString();
  if (debouncedKeyChangedTimers.has(uIdStr)) {
    clearTimeout(debouncedKeyChangedTimers.get(uIdStr));
  }
  const timer = setTimeout(() => {
    debouncedKeyChangedTimers.delete(uIdStr);
    io.emit('key:changed', { userId: uIdStr, timestamp: Date.now() });
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
    const failEntry = failedPasswordMap.get(userId) || { count: 0, lockUntil: 0 };
    if (now < failEntry.lockUntil) {
      const waitMins = Math.ceil((failEntry.lockUntil - now) / 60000);
      return res.status(429).json({ message: `Tài khoản tạm thời bị khóa đăng ký thiết bị do nhập sai mật khẩu quá 5 lần. Thử lại sau ${waitMins} phút.` });
    }

    // req.user không có field password (bị protect middleware loại bỏ), phải fetch riêng để so khớp
    const userWithPassword = await User.findById(req.user._id);
    const isMatch = await userWithPassword.comparePassword(currentPassword);
    if (!isMatch) {
      failEntry.count += 1;
      if (failEntry.count >= 5) {
        failEntry.lockUntil = now + 15 * 60 * 1000;
        failEntry.count = 0;
      }
      failedPasswordMap.set(userId, failEntry);
      return res.status(401).json({ message: 'Mật khẩu xác nhận không chính xác' });
    }
    failedPasswordMap.delete(userId);

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

          const mutEntry = mutationRateLimitMap.get(userId) || { count: 0, resetTime: now + 3600000 };
          if (now > mutEntry.resetTime) { mutEntry.count = 0; mutEntry.resetTime = now + 3600000; }
          if (mutEntry.count >= 3) {
            if (isReplicaSet && session) { await session.abortTransaction(); session.endSession(); }
            return res.status(429).json({ message: 'Bạn đã thay đổi thiết bị quá 3 lần/giờ. Vui lòng thử lại sau.' });
          }
          mutEntry.count += 1;
          mutationRateLimitMap.set(userId, mutEntry);

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
          const mutEntry = mutationRateLimitMap.get(userId) || { count: 0, resetTime: now + 3600000 };
          if (now > mutEntry.resetTime) { mutEntry.count = 0; mutEntry.resetTime = now + 3600000; }
          if (mutEntry.count >= 3) {
            if (isReplicaSet && session) { await session.abortTransaction(); session.endSession(); }
            return res.status(429).json({ message: 'Bạn đã thay đổi thiết bị quá 3 lần/giờ. Vui lòng thử lại sau.' });
          }
          mutEntry.count += 1;
          mutationRateLimitMap.set(userId, mutEntry);

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
            const renewEntry = renewalRateLimitMap.get(userId) || { count: 0, resetTime: now + 3600000 };
            if (now > renewEntry.resetTime) { renewEntry.count = 0; renewEntry.resetTime = now + 3600000; }
            if (renewEntry.count >= 30) {
              if (isReplicaSet && session) { await session.abortTransaction(); session.endSession(); }
              return res.status(429).json({ message: 'Quá nhiều yêu cầu gia hạn thiết bị. Thử lại sau.' });
            }
            renewEntry.count += 1;
            renewalRateLimitMap.set(userId, renewEntry);

            existingDevice.lastActiveAt = new Date();
            if (deviceName) existingDevice.deviceName = deviceName;
            finalTokenVersion = existingDevice.tokenVersion;
            shouldEmitThisTry = false;
          } else {
            // Case 3b: Key Rotation / Mất Storage (publicKey khác cũ)
            const mutEntry = mutationRateLimitMap.get(userId) || { count: 0, resetTime: now + 3600000 };
            if (now > mutEntry.resetTime) { mutEntry.count = 0; mutEntry.resetTime = now + 3600000; }
            if (mutEntry.count >= 3) {
              if (isReplicaSet && session) { await session.abortTransaction(); session.endSession(); }
              return res.status(429).json({ message: 'Bạn đã thay đổi thiết bị quá 3 lần/giờ. Vui lòng thử lại sau.' });
            }
            mutEntry.count += 1;
            mutationRateLimitMap.set(userId, mutEntry);

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

module.exports = router;