const crypto = require('crypto');

// Đọc khóa gốc từ .env
const getMasterKey = () => {
  const hexKey = process.env.ENCRYPTION_KEY;
  if (!hexKey) {
    return crypto.scryptSync('fallback_secret_chat_app_2026', 'master_salt', 32);
  }
  try {
    const key = Buffer.from(hexKey, 'hex');
    if (key.length !== 32) throw new Error();
    return key;
  } catch {
    return crypto.scryptSync(hexKey, 'master_salt', 32);
  }
};

const MASTER_KEY = getMasterKey();
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 12 bytes cho AES-GCM

// Key Derivation Isolation: Tách biệt 3 key riêng biệt cho 3 mục đích bảo mật khác nhau
const PII_ENCRYPTION_KEY    = crypto.scryptSync(MASTER_KEY, 'pii_account_salt_2026', 32);
const REPORT_ENCRYPTION_KEY = crypto.scryptSync(MASTER_KEY, 'report_content_salt_2026', 32);
const BLIND_INDEX_KEY       = crypto.scryptSync(MASTER_KEY, 'blind_index_salt_2026', 32);

/**
 * Mã hóa dữ liệu PII (Số điện thoại, Ngày sinh...) bằng PII_ENCRYPTION_KEY
 */
const encryptPII = (text) => {
  if (!text) return '';
  const strVal = String(text).trim();
  if (!strVal) return '';
  if (strVal.includes(':')) {
    const parts = strVal.split(':');
    if (parts.length === 3 && parts[0].length === 24 && parts[1].length === 32) return strVal;
  }
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, PII_ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(strVal, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${tag}:${encrypted}`;
  } catch (err) {
    console.error('[Crypto] Encrypt PII error:', err);
    return strVal;
  }
};

/**
 * Giải mã dữ liệu PII dạng iv:tag:ciphertext
 */
const decryptPII = (encryptedText) => {
  if (!encryptedText || typeof encryptedText !== 'string') return encryptedText || '';
  if (!encryptedText.includes(':')) return encryptedText;

  const parts = encryptedText.split(':');
  if (parts.length !== 3) return encryptedText;

  const [ivHex, tagHex, ciphertextHex] = parts;
  if (ivHex.length !== 24 || tagHex.length !== 32) return encryptedText;

  try {
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, PII_ENCRYPTION_KEY, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('[Crypto] Decrypt PII error:', err.message);
    return encryptedText;
  }
};

/**
 * Mã hóa nội dung giải mã của Report bằng REPORT_ENCRYPTION_KEY riêng biệt
 */
const encryptReportContent = (text) => {
  if (!text) return '';
  const strVal = String(text).trim();
  if (!strVal) return '';
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, REPORT_ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(strVal, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${tag}:${encrypted}`;
  } catch (err) {
    console.error('[Crypto] Encrypt Report error:', err);
    return strVal;
  }
};

/**
 * Giải mã nội dung Report
 */
const decryptReportContent = (encryptedText) => {
  if (!encryptedText || typeof encryptedText !== 'string') return encryptedText || '';
  if (!encryptedText.includes(':')) return encryptedText;

  const parts = encryptedText.split(':');
  if (parts.length !== 3) return encryptedText;

  const [ivHex, tagHex, ciphertextHex] = parts;
  if (ivHex.length !== 24 || tagHex.length !== 32) return encryptedText;

  try {
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, REPORT_ENCRYPTION_KEY, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('[Crypto] Decrypt Report error:', err.message);
    return encryptedText;
  }
};

/**
 * Tạo Blind Index (HMAC-SHA256) với BLIND_INDEX_KEY riêng biệt
 */
const hashBlindIndex = (text) => {
  if (!text) return '';
  const normalized = String(text).trim().toLowerCase();
  return crypto.createHmac('sha256', BLIND_INDEX_KEY).update(normalized).digest('hex');
};

module.exports = {
  encryptPII,
  decryptPII,
  encryptReportContent,
  decryptReportContent,
  hashBlindIndex,
};
