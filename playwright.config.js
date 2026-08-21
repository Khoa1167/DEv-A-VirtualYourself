// @ts-check
const { defineConfig } = require('@playwright/test');

// Test API thuần (dùng fixture `request`, không mở browser) — server phải chạy sẵn ở
// http://localhost:5000 trước khi chạy `npm test` (giống server/tests/security.test.js).
module.exports = defineConfig({
  testDir: './tests',
  use: {
    // Khớp biến TEST_URL của server/tests/security.test.js — 1 cách override chung cho cả 2 bộ test.
    baseURL: process.env.TEST_URL || 'http://localhost:5000',
  },
  reporter: 'list',
});
