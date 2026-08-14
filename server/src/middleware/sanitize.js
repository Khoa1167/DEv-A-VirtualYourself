// Loại bỏ đệ quy các key bắt đầu bằng "$" hoặc chứa "." khỏi req.body/query/params,
// ngăn NoSQL injection qua toán tử truy vấn MongoDB ($ne, $gt, $where...) khi field
// lẽ ra phải là string (username, nickname...) lại được gán trực tiếp vào query filter.
function stripMongoOperators(value) {
  if (Array.isArray(value)) {
    value.forEach(stripMongoOperators);
    return value;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (key.startsWith('$') || key.includes('.')) {
        delete value[key];
      } else {
        stripMongoOperators(value[key]);
      }
    }
  }
  return value;
}

module.exports = function sanitizeMongo(req, res, next) {
  if (req.body) stripMongoOperators(req.body);
  if (req.query) stripMongoOperators(req.query);
  if (req.params) stripMongoOperators(req.params);
  next();
};
