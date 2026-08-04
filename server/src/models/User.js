const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { encryptPII, decryptPII, hashBlindIndex } = require('../utils/crypto');

const userSchema = new mongoose.Schema({
  username:          { type: String, required: true, unique: true, trim: true },
  nickname:          { type: String, required: true, unique: true, trim: true },
  email:             { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone:             { type: String, default: '' },             // Chuỗi mã hóa AES-256-GCM
  phoneHash:         { type: String, default: '', index: true }, // HMAC-SHA256 để truy vấn tìm kiếm
  dateOfBirth:       { type: String, default: '' },             // Chuỗi mã hóa AES-256-GCM
  gender:            { type: String, enum: ['male', 'female', 'other', ''], default: '' },
  bio:               { type: String, default: '', maxlength: 150 },
  password:          { type: String, required: true, minlength: 6 },
  avatar:            { type: String, default: '' },
  cover:             { type: String, default: '' },
  isOnline:          { type: Boolean, default: false },
  lastSeen:          { type: Date, default: Date.now },
  nicknameChangedAt: { type: Date, default: null },
}, { timestamps: true });

userSchema.pre('save', async function() {
  // 1. Mã hóa mật khẩu nếu thay đổi
  if (this.isModified('password')) {
    if (!this.password.startsWith('$2a$') && !this.password.startsWith('$2b$')) {
      this.password = await bcrypt.hash(this.password, 12);
    }
  }

  // 2. Mã hóa PII số điện thoại & tạo Blind Index
  if (this.isModified('phone') && this.phone) {
    const rawPhone = decryptPII(this.phone);
    if (rawPhone) {
      this.phoneHash = hashBlindIndex(rawPhone);
      this.phone = encryptPII(rawPhone);
    } else {
      this.phoneHash = '';
    }
  }

  // 3. Mã hóa PII ngày sinh
  if (this.isModified('dateOfBirth') && this.dateOfBirth) {
    const rawDob = decryptPII(this.dateOfBirth);
    if (rawDob) {
      this.dateOfBirth = encryptPII(rawDob);
    }
  }
});

userSchema.methods.comparePassword = async function(pw) {
  return bcrypt.compare(pw, this.password);
};

userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.phoneHash;
  if (obj.phone) {
    obj.phone = decryptPII(obj.phone);
  }
  if (obj.dateOfBirth) {
    obj.dateOfBirth = decryptPII(obj.dateOfBirth);
  }
  return obj;
};

module.exports = mongoose.model('User', userSchema);