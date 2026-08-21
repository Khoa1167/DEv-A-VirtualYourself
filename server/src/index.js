require('dotenv').config();
const express     = require('express');
const http        = require('http');
const mongoose    = require('mongoose');
const { Server }  = require('socket.io');
const cors        = require('cors');
const connectDB   = require('./config/db');
const setupSocket = require('./socket');
const sanitizeMongo = require('./middleware/sanitize');
const redisClient  = require('./config/redis');
const logger       = require('./config/logger');
const pinoHttp      = require('pino-http');

const app    = express();
const server = http.createServer(app);
app.disable('x-powered-by');

// req.ip đọc đúng IP thật của client khi chạy sau reverse proxy (Cloudflare, Nginx...) — CHỈ bật
// khi thật sự có đúng số hop proxy đó (đặt qua TRUST_PROXY_HOPS trong .env). Mặc định 0 = tắt,
// an toàn cho dev local — bật sai (khi không thực sự có proxy đó) sẽ cho phép giả mạo IP qua
// header X-Forwarded-For, phá vỡ mọi rate-limit theo IP (send-otp, forgot-password...).
const trustProxyHops = parseInt(process.env.TRUST_PROXY_HOPS || '0', 10);
if (trustProxyHops > 0) {
  app.set('trust proxy', trustProxyHops);
}

const clientOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map(url => url.trim())
  : [];

// Khởi tạo Socket.io
const io = new Server(server, {
  cors: { origin: clientOrigins, methods: ['GET', 'POST'], credentials: true },
});

app.set('socketio', io);

// Kết nối MongoDB
connectDB();

// Middleware
app.use(cors({ origin: clientOrigins, credentials: true }));
// Log có cấu trúc mỗi request (req.id để trace xuyên suốt 1 request qua nhiều dòng log) — bỏ qua
// '/health' để không rác log mỗi lần Docker healthcheck gọi (mỗi vài giây).
app.use(pinoHttp({
  logger,
  autoLogging: { ignore: (req) => req.url === '/health' },
}));
app.use(express.json());
app.use(sanitizeMongo);

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none';");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// API routes không được cache (dữ liệu động, có thể chứa thông tin nhạy cảm)
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Routes — chỉ đăng ký 1 lần, trước server.listen()
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/users',    require('./routes/users'));
app.use('/api/rooms',    require('./routes/rooms'));
app.use('/api/friends',  require('./routes/friends'));
app.use('/api/reports',  require('./routes/report'));
app.use('/api/security', require('./routes/security'));

app.get('/', (req, res) => {
  res.json({ message: '🚀 Chat server đang chạy!' });
});

// Health/readiness check cho Docker healthcheck, load balancer... — kiểm tra thật sự kết nối
// được Mongo (nguồn dữ liệu bắt buộc) chứ không chỉ "process còn sống" như route '/' ở trên.
app.get('/health', (req, res) => {
  const mongoConnected = mongoose.connection.readyState === 1; // 1 = connected
  res.status(mongoConnected ? 200 : 503).json({
    status: mongoConnected ? 'ok' : 'unavailable',
    mongo: mongoConnected ? 'connected' : 'disconnected',
    redis: redisClient ? redisClient.status : 'disabled',
  });
});

// Setup WebSocket
setupSocket(io);

// Khởi động server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  logger.info(`🚀 Server chạy tại http://localhost:${PORT}`);
});

// Graceful shutdown — đóng HTTP server + kết nối Mongo/Redis sạch trước khi process thoát, tránh
// request đang xử lý dở bị cắt ngang hoặc connection pool bị bỏ mồ côi khi container bị dừng
// (docker stop gửi SIGTERM, chờ 10s trước khi SIGKILL cưỡng bức).
const shutdown = async (signal) => {
  logger.info(`${signal} nhận được, đang tắt server...`);
  server.close(() => logger.info('✅ HTTP server đã đóng'));
  await mongoose.connection.close();
  logger.info('✅ Đã đóng kết nối MongoDB');
  if (redisClient) {
    await redisClient.quit();
    logger.info('✅ Đã đóng kết nối Redis');
  }
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));