const jwt = require('jsonwebtoken');

// Xoay vòng JWT secret có kiểm soát (mô hình kid/JWKS) — đổi secret không còn làm hỏng ngay
// mọi token đang tồn tại. Xem hướng dẫn cấu hình trong server/.env.example.
const parseKeyRing = (raw) => {
  const map = new Map();
  raw.split(',').map(s => s.trim()).filter(Boolean).forEach(pair => {
    const idx = pair.indexOf(':');
    if (idx === -1) return;
    map.set(pair.slice(0, idx), pair.slice(idx + 1));
  });
  return map;
};

const buildKeyRing = () => {
  if (process.env.JWT_SECRETS) {
    const keyRing = parseKeyRing(process.env.JWT_SECRETS);
    const currentKid = process.env.JWT_SECRET_CURRENT_KID;
    if (!currentKid || !keyRing.has(currentKid)) {
      throw new Error('JWT_SECRET_CURRENT_KID không khớp bất kỳ kid nào trong JWT_SECRETS.');
    }
    return { keyRing, currentKid };
  }

  // Tương thích ngược: chưa cấu hình keyring mới thì dùng JWT_SECRET cũ làm keyring 1 phần tử
  if (process.env.JWT_SECRET) {
    return { keyRing: new Map([['k1', process.env.JWT_SECRET]]), currentKid: 'k1' };
  }

  throw new Error('Thiếu JWT_SECRETS (mới) hoặc JWT_SECRET (cũ) trong .env — bắt buộc để ký/xác thực JWT.');
};

const { keyRing, currentKid } = buildKeyRing();

const signJwt = (payload, options = {}) =>
  jwt.sign(payload, keyRing.get(currentKid), { ...options, keyid: currentKid });

const verifyJwt = (token) => {
  const kid = jwt.decode(token, { complete: true })?.header?.kid;

  if (kid && keyRing.has(kid)) {
    return jwt.verify(token, keyRing.get(kid));
  }

  // Token ký từ trước khi có kid (hoặc kid lạ) — thử lần lượt các secret đang có hiệu lực.
  // Keyring luôn nhỏ (current + vài secret cũ gần đây) nên chi phí không đáng kể.
  let lastErr;
  for (const secret of keyRing.values()) {
    try {
      return jwt.verify(token, secret);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new jwt.JsonWebTokenError('invalid signature');
};

module.exports = { signJwt, verifyJwt };
