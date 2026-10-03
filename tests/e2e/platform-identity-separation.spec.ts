import { test, expect } from '@playwright/test';

const account = { id: '00000000-0000-4000-8000-000000000001', email: 'operator@example.test', displayName: '合成平台管理员' };
test('platform has its own login and broadcast without customer navigation or draft clearing', async ({ context, page }) => {
  let platformSignedIn = false;
  const paths: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await context.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    paths.push(path);
    if (path.endsWith('/csrf')) return route.fulfill({ json: { token: 'synthetic-csrf', headerName: 'X-CSRF-TOKEN' } });
    if (path === '/api/platform-admin/v1/auth/login') {
      expect(route.request().postDataJSON()).toEqual({ username: 'operator@example.test', password: 'synthetic-password' });
      platformSignedIn = true;
    }
    if (path === '/api/platform-admin/v1/auth/logout') {
      platformSignedIn = false;
      return route.fulfill({ status: 204 });
    }
    if (path === '/api/platform-admin/v1/auth/me' || path === '/api/platform-admin/v1/auth/login')
      return route.fulfill(platformSignedIn ? { json: { account, platformAdmin: true, memberships: [] } } : { status: 401, json: { code: 'AUTHENTICATION_REQUIRED' } });
    if (path === '/api/platform-admin/v1/overview') return route.fulfill({ json: {
      totalTenants: 0, activeTenants: 0, suspendedTenants: 0, platform: 'AVAILABLE', database: 'AVAILABLE', invitationDelivery: 'DISABLED', checkedAt: new Date().toISOString(),
    } });
    if (path === '/api/platform-admin/v1/tenants') return route.fulfill({ json: [] });
    if (path === '/api/v1/me') return route.fulfill({ json: { account: { ...account, phone: '+8619900000001' }, platformAdmin: true, memberships: [] } });
    if (path === '/api/v1/auth/phone/configuration') return route.fulfill({ json: { delivery: 'DISABLED', localPreview: false } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('/platform-admin/');
  await expect(page.getByRole('heading', { name: '梦擎总台' })).toBeVisible();
  await page.getByLabel('管理账号').fill('operator@example.test');
  await page.getByLabel('密码', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: '登录总台' }).click();
  await expect(page.getByRole('button', { name: '退出总台' })).toBeVisible();
  await expect(page.locator('a[href*="/workspace/"],a[href*="/tenant-admin/"]')).toHaveCount(0);
  expect(paths.some(p => p.startsWith('/api/v1/'))).toBe(false);
  const customer = await context.newPage();
  await customer.goto('/workspace/');
  await expect(customer.getByText('尚未加入企业', { exact: true })).toBeVisible();
  await expect(customer.locator('a[href*="/platform-admin/"]')).toHaveCount(0);
  await customer.evaluate(() => localStorage.setItem('dreamcore-session-change', 'customer-marker'));
  await page.getByRole('button', { name: '退出总台' }).click();
  await expect(page.getByRole('button', { name: '登录总台' })).toBeVisible();
  await expect(customer.getByText('尚未加入企业', { exact: true })).toBeVisible();
  expect(await customer.evaluate(() => localStorage.getItem('dreamcore-session-change'))).toBe('customer-marker');
  for (const width of [1440, 834, 360]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: 'test-results/platform-login-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/platform-login-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});
