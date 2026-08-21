const crypto = require('crypto');
const logger = require('../config/logger');

// Đọc khóa gốc từ .env — KHÔNG được có fallback hard-code: thiếu key phải crash ngay lúc khởi
// động thay vì âm thầm mã hóa PII/report bằng 1 chuỗi cố định ai đọc source cũng biết được.
const getMasterKey = () => {
  const hexKey = process.env.ENCRYPTION_KEY;
  if (!hexKey) {
    throw new Error(
      'ENCRYPTION_KEY chưa được cấu hình trong .env — bắt buộc để mã hóa PII/report. ' +
      'Tạo key ngẫu nhiên bằng: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
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
    logger.error({ err }, '[Crypto] Encrypt PII error');
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
    logger.error({ err }, '[Crypto] Decrypt PII error');
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
    logger.error({ err }, '[Crypto] Encrypt Report error');
    return strVal;
  }
};

const encrypt = (text) => {
  if (!text) return { content: '', iv: null, tag: null, encryptedKey: null };
  const strVal = String(text);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, MASTER_KEY, iv);
  let encrypted = cipher.update(strVal, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return {
    content: encrypted,
    iv: iv.toString('hex'),
    tag,
    encryptedKey: null,
  };
};

const decrypt = (content, ivHex, tagHex, encryptedKey) => {
  if (!content || !ivHex || !tagHex) return content || '';
  try {
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, MASTER_KEY, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(content, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    logger.error({ err }, '[Crypto] Decrypt error');
    return content;
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
    logger.error({ err }, '[Crypto] Decrypt Report error');
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
  encrypt,
  decrypt,
  encryptPII,
  decryptPII,
  encryptReportContent,
  decryptReportContent,
  hashBlindIndex,
};
