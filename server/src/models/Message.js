const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  content:   { type: String, required: true, maxlength: 2000 },
  sender:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  room:      { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
  type:      { type: String, enum: ['text', 'image', 'system', 'audio', 'file'], default: 'text' },
  fileName:  { type: String, default: null },
  replyTo:   { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  forwardedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  reactions: [{ emoji: String, users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }] }],
  isDeleted: { type: Boolean, default: false },
  isEdited:  { type: Boolean, default: false },
  iv:           { type: String, default: null },
  tag:          { type: String, default: null },
  encryptedKey: { type: String, default: null },
  encryptedKeys:{ type: Map, of: String, default: {} }, // Map: deviceId -> encryptedSessionKey (Hex)
}, { timestamps: true });

module.exports = mongoose.model('Message', messageSchema);