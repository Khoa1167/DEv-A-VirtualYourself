const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username:          { type: String, required: true, unique: true, trim: true },
  nickname:          { type: String, required: true, unique: true, trim: true },
  email:             { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone:             { type: String, default: '' },
  dateOfBirth:       { type: Date, default: null },
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
  if (!this.isModified('password')) return;
  if (this.password.startsWith('$2a$') || this.password.startsWith('$2b$')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = async function(pw) {
  return bcrypt.compare(pw, this.password);
};

userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('User', userSchema);