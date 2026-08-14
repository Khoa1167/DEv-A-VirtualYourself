const { test, expect } = require('@playwright/test');

test('API /api/auth/me phải từ chối khi chưa đăng nhập', async ({ request }) => {
    const response = await request.get(
        'http://localhost:5000/api/auth/me'
    );

    expect(response.status()).toBe(401);
});