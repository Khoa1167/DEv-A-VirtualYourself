require('dotenv').config();
const express     = require('express');
const http        = require('http');
const { Server }  = require('socket.io');
const cors        = require('cors');
const connectDB   = require('./config/db');
const setupSocket = require('./socket');
const sanitizeMongo = require('./middleware/sanitize');

const app    = express();
const server = http.createServer(app);
app.disable('x-powered-by');

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

// Setup WebSocket
setupSocket(io);

// Khởi động server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server chạy tại http://localhost:${PORT}`);
});