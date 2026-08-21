// Client Redis dùng chung toàn server — chỉ khởi tạo khi có REDIS_URL trong .env.
// Không set thì export null, các module gọi (vd rateLimiter.js) tự rơi về hành vi in-memory
// hiện tại — đúng mẫu "fallback khi thiếu config" đã dùng cho OPENAI_API_KEY trong moderation.js.
// REDIS_URL cần thiết khi scale ngang nhiều instance (xem ghi chú trong CLAUDE.md).
const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL;
const redisClient = redisUrl ? new Redis(redisUrl) : null;

if (redisClient) {
  redisClient.on('error', (err) => console.error('[Redis] Lỗi kết nối:', err.message));
  redisClient.on('connect', () => console.log('🔴 Đã kết nối Redis:', redisUrl));
}

module.exports = redisClient;
