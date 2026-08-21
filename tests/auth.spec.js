const { test, expect } = require('@playwright/test');

test('API /api/auth/me phải từ chối khi chưa đăng nhập', async ({ request }) => {
    const response = await request.get('/api/auth/me');

    expect(response.status()).toBe(401);
});