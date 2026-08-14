// Trả lỗi 500 cho client mà không lộ chi tiết lỗi nội bộ (message DB, đường dẫn file...) khi production.
// Luôn log đầy đủ lỗi ở server để debug; ở dev vẫn trả err.message cho tiện làm việc.
module.exports = function sendServerError(res, err, fallback = 'Đã xảy ra lỗi hệ thống, vui lòng thử lại sau') {
  console.error(err);
  const message = process.env.NODE_ENV === 'production' ? fallback : err.message;
  res.status(500).json({ message });
};
