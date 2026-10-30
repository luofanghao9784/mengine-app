import { test, expect } from '@playwright/test';

const account = {
  id: '00000000-0000-4000-8000-000000000001',
  phone: '+8619900000001',
  email: null,
  displayName: '合成统一用户',
};
const tenant = '00000000-0000-4000-8000-000000000002';
test('platform login and logout preserve the shared business session', async ({ context, page }) => {
  let signedIn = false;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/csrf'))
      return route.fulfill({ json: { token: 'synthetic-csrf', headerName: 'X-CSRF-TOKEN' } });
    if (path === '/api/platform-admin/v1/auth/login') {
      expect(route.request().postDataJSON()).toEqual({
        username: 'operator',
        password: 'synthetic-password',
      });
      signedIn = true;
    }
    if (path.endsWith('/logout')) {
      signedIn = false;
      return route.fulfill({ status: 204 });
    }
    if (path === '/api/v1/me')
      return route.fulfill({ json: { account: { ...account, id: tenant }, platformAdmin: false, memberships: [] } });
    if (path === '/api/platform-admin/v1/auth/me' || path.endsWith('/auth/login'))
      return route.fulfill(
        signedIn
          ? { json: { account, platformAdmin: true, memberships: [] } }
          : { status: 401, json: { code: 'AUTHENTICATION_REQUIRED' } },
      );
    if (path.endsWith('/overview'))
      return route.fulfill({
        json: {
          totalTenants: 0,
          activeTenants: 0,
          suspendedTenants: 0,
          platform: 'AVAILABLE',
          database: 'AVAILABLE',
          invitationDelivery: 'DISABLED',
          checkedAt: new Date().toISOString(),
        },
      });
    if (path.endsWith('/tenants')) return route.fulfill({ json: [] });
    if (path.endsWith('/phone/configuration'))
      return route.fulfill({ json: { delivery: 'DISABLED', localPreview: false } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('/platform-admin/');
  await page.getByLabel('管理账号').fill('operator');
  await page.getByLabel('密码', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: '登录总台' }).click();
  await expect(page.getByRole('button', { name: '退出总台' })).toBeVisible();
  const customer = await context.newPage();
  await customer.goto('/workspace/');
  await expect(customer.getByText('尚未加入企业', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '退出总台' }).click();
  await expect(page.getByRole('button', { name: '登录总台' })).toBeVisible();
  await customer.reload();
  await expect(customer.getByText('尚未加入企业', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('unified login asks for authorized surface before entering an enterprise', async ({ context, page }) => {
  let signedIn = false;
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const identity = {
      account,
      platformAdmin: true,
      memberships: [{ tenantId: tenant, tenantName: '合成企业', role: 'TENANT_ADMIN' }],
    };
    if (path.endsWith('/csrf'))
      return route.fulfill({ json: { token: 'synthetic', headerName: 'X-CSRF-TOKEN' } });
    if (path === '/api/v1/auth/login') {
      signedIn = true;
      return route.fulfill({ json: identity });
    }
    if (path === '/api/v1/me')
      return route.fulfill(
        signedIn ? { json: identity } : { status: 401, json: { code: 'AUTHENTICATION_REQUIRED' } },
      );
    if (path.endsWith('/phone/configuration'))
      return route.fulfill({ json: { delivery: 'DISABLED', localPreview: false } });
    if (path.endsWith('/governance'))
      return route.fulfill({
        json: {
          tenantId: tenant,
          ownerId: account.id,
          revision: 1,
          owner: true,
          canConfigure: true,
          pendingHandover: null,
          canEnterManagement: true,
          canAcceptInitialResponsibility: false,
          capabilities: [],
          pending: [],
        },
      });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('/workspace/');
  await page.getByLabel('用户名或手机号', { exact: true }).fill('19900000001');
  await page.getByLabel('密码', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('region', { name: '选择进入哪一端', exact: true })).toBeVisible();
  for (const name of ['总台端', '企业管理端', '工作台'])
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/unified-surface-choice.png' });
  await page.getByRole('button', { name: '总台端', exact: true }).click();
  await expect(page).toHaveURL(/\/platform-admin\//);
});
