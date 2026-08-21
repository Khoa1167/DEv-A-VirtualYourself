// Rate-limit kiểu "sai N lần → khóa X phút" / "tối đa N request / cửa sổ" dùng chung — thay
// logic viết tay lặp lại ở nhiều route (đăng nhập, đăng ký thiết bị, gửi tin nhắn...).
//
// Có REDIS_URL (server/src/config/redis.js) → lưu ở Redis, đúng khi chạy nhiều instance đứng
// sau load balancer (mọi instance thấy chung 1 bộ đếm). Không set → rơi về Map trong RAM
// (chỉ đúng khi chạy 1 instance), không cần cài/chạy Redis cho dev local đơn giản.
//
// Namespace (chuỗi, vd 'login', 'send-otp') thay cho việc mỗi route tự khai báo & truyền vào 1
// Map riêng — Redis không có khái niệm "Map instance" nên cần namespace để tách bộ đếm giữa các
// route dùng chung 1 store.

const redis = require('../config/redis');

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LOCK_MINUTES = 15;

const lockRedisKey = (ns, key) => `rl:lock:${ns}:${key}`;
const countRedisKey = (ns, key) => `rl:count:${ns}:${key}`;
const windowRedisKey = (ns, key) => `rw:${ns}:${key}`;

// Fallback in-memory — 1 Map dùng chung, phân biệt bằng key ghép `namespace:key`.
const memoryStore = new Map();

// Kiểm tra key có đang bị khóa không — gọi trước khi xác thực.
async function checkLock(namespace, key) {
  if (redis) {
    const ttl = await redis.pttl(lockRedisKey(namespace, key));
    if (ttl > 0) return { locked: true, waitMinutes: Math.ceil(ttl / 60000) };
    return { locked: false };
  }

  const entry = memoryStore.get(`${namespace}:${key}`);
  if (!entry) return { locked: false };
  const now = Date.now();
  if (now < entry.lockUntil) {
    return { locked: true, waitMinutes: Math.ceil((entry.lockUntil - now) / 60000) };
  }
  return { locked: false };
}

// Ghi nhận 1 lần xác thực sai, tự khóa nếu chạm ngưỡng — gọi khi xác thực thất bại.
async function recordFailure(namespace, key, { maxAttempts = DEFAULT_MAX_ATTEMPTS, lockMinutes = DEFAULT_LOCK_MINUTES } = {}) {
  if (redis) {
    const count = await redis.incr(countRedisKey(namespace, key));
    if (count >= maxAttempts) {
      await redis.set(lockRedisKey(namespace, key), '1', 'PX', lockMinutes * 60 * 1000);
      await redis.del(countRedisKey(namespace, key));
    }
    return;
  }

  const mapKey = `${namespace}:${key}`;
  const entry = memoryStore.get(mapKey) || { count: 0, lockUntil: 0 };
  entry.count += 1;
  if (entry.count >= maxAttempts) {
    entry.lockUntil = Date.now() + lockMinutes * 60 * 1000;
    entry.count = 0;
  }
  memoryStore.set(mapKey, entry);
}

// Xóa bộ đếm khi xác thực thành công.
async function clearFailures(namespace, key) {
  if (redis) {
    await redis.del(countRedisKey(namespace, key), lockRedisKey(namespace, key));
    return;
  }
  memoryStore.delete(`${namespace}:${key}`);
}

// Rate-limit kiểu "tối đa N request / cửa sổ thời gian trượt, tự reset khi hết cửa sổ" —
// khác checkLock/recordFailure ở trên (đó là "sai N lần liên tiếp → khóa X phút cho tới khi
// hết hạn"). Dùng cho giới hạn tần suất gọi API/socket event thông thường, không phải khóa
// sau xác thực sai. Check + tăng đếm gộp làm 1 lần gọi vì mọi nơi dùng đều gọi theo cặp.
async function checkRateWindow(namespace, key, { maxCount, windowMs }) {
  if (redis) {
    const rKey = windowRedisKey(namespace, key);
    // INCR + PEXPIRE (chỉ đặt lần đầu) — atomic đủ dùng cho rate-limit, không cần Lua script.
    const count = await redis.incr(rKey);
    if (count === 1) await redis.pexpire(rKey, windowMs);
    if (count > maxCount) {
      const ttl = await redis.pttl(rKey);
      return { limited: true, retryAfterMs: ttl > 0 ? ttl : windowMs };
    }
    return { limited: false };
  }

  const mapKey = `${namespace}:${key}`;
  const now = Date.now();
  const entry = memoryStore.get(mapKey) || { count: 0, resetTime: now + windowMs };
  if (now > entry.resetTime) {
    entry.count = 0;
    entry.resetTime = now + windowMs;
  }
  if (entry.count >= maxCount) {
    memoryStore.set(mapKey, entry);
    return { limited: true, retryAfterMs: entry.resetTime - now };
  }
  entry.count += 1;
  memoryStore.set(mapKey, entry);
  return { limited: false };
}

module.exports = { checkLock, recordFailure, clearFailures, checkRateWindow };
