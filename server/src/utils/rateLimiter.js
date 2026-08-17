// Rate-limit kiểu "sai N lần liên tiếp → khóa X phút" dùng chung — thay logic đang
// viết tay lặp lại ở nhiều route (đăng nhập, đăng ký thiết bị...). Map trạng thái vẫn
// khai báo & sở hữu bởi từng route (in-memory, per-instance); các hàm dưới chỉ thao
// tác trên Map được truyền vào.

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LOCK_MINUTES = 15;

// Kiểm tra key có đang bị khóa không — gọi trước khi xác thực.
function checkLock(map, key) {
  const entry = map.get(key);
  if (!entry) return { locked: false };
  const now = Date.now();
  if (now < entry.lockUntil) {
    return { locked: true, waitMinutes: Math.ceil((entry.lockUntil - now) / 60000) };
  }
  return { locked: false };
}

// Ghi nhận 1 lần xác thực sai, tự khóa nếu chạm ngưỡng — gọi khi xác thực thất bại.
function recordFailure(map, key, { maxAttempts = DEFAULT_MAX_ATTEMPTS, lockMinutes = DEFAULT_LOCK_MINUTES } = {}) {
  const entry = map.get(key) || { count: 0, lockUntil: 0 };
  entry.count += 1;
  if (entry.count >= maxAttempts) {
    entry.lockUntil = Date.now() + lockMinutes * 60 * 1000;
    entry.count = 0;
  }
  map.set(key, entry);
}

// Xóa bộ đếm khi xác thực thành công.
function clearFailures(map, key) {
  map.delete(key);
}

module.exports = { checkLock, recordFailure, clearFailures };
