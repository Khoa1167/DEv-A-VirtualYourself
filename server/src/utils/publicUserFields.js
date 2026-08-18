// Tập field "an toàn public" của User dùng trong .populate()/.select() — tránh gõ lặp chuỗi
// field ở nhiều route (dễ lệch khi 1 chỗ sửa quên chỗ khác); thêm/bớt field hiển thị công khai
// chỉ cần sửa đúng 1 nơi.
const MINIMAL = 'username nickname';
const BASIC = 'username nickname avatar';
const WITH_STATUS = `${BASIC} isOnline`;
const WITH_STATUS_LASTSEEN = `${WITH_STATUS} lastSeen`;

module.exports = { MINIMAL, BASIC, WITH_STATUS, WITH_STATUS_LASTSEEN };
