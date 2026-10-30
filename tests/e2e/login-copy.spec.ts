import { test, expect } from '@playwright/test';
import { fixture, tenant, other, account } from './fixtures/ct036';

test('两端登录默认副标题一致，悬浮入口在登录和邀请/绑定流程隐藏', async ({ page }) => {
  await fixture(page, 'anonymous');
  for (const surface of ['workspace', 'tenant-admin']) {
    await page.goto(`/${surface}/`);
    await expect(page.getByText('欢迎回来，登录后继续你的工作。', { exact: true })).toBeVisible();
    if (surface === 'tenant-admin') await expect(page.locator('[data-governance-link]')).toBeHidden();
  }
  await fixture(page);
  await page.goto(`/tenant-admin/#tenant=${tenant}`);
  await page.reload();
  await expect(page.getByRole('link', { name: '同步数据口径', exact: true })).toBeVisible();
  await page.evaluate(() => {
    location.hash = 'invite';
  });
  await expect(page.locator('.access-auth-card')).toBeVisible();
  await expect(page.locator('[data-governance-link]')).toBeHidden();
});

test('选端问候使用姓名、当前企业与治理身份，多企业切换不串身份', async ({ page }) => {
  await fixture(page);
  await page.addInitScript(() => sessionStorage.setItem('dreamcore-choose-surface', 'yes'));
  await page.route(`**/tenants/${other}/governance`, (route) =>
    route.fulfill({
      json: {
        tenantId: other,
        ownerId: null,
        revision: 1,
        owner: false,
        canConfigure: false,
        canEnterManagement: true,
        canAcceptInitialResponsibility: false,
        pendingHandover: null,
        capabilities: [],
      },
    }),
  );
  await page.goto(`/tenant-admin/#tenant=${tenant}`);
  await expect(page.getByRole('heading', { name: '你好，合成成员', exact: true })).toBeVisible();
  await expect(page.getByText('合成企业甲 · 企业负责人', { exact: true })).toBeVisible();
  await expect(page.locator('[data-governance-link]')).toBeHidden();
  await page.getByLabel('当前企业', { exact: true }).selectOption(other);
  await expect(page.getByText('合成企业乙 · 企业管理员（权限受限）', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '工作台', exact: true })).toHaveAccessibleDescription(
    '和 AI 对话、查资料、看每日要点',
  );
  await expect(page.locator('body')).not.toContainText('TENANT_ADMIN');
});

test('经典台侧栏显示姓名和中文身份并使用梦核引擎品牌', async ({ page }) => {
  await fixture(page);
  await page.goto(`/tenant-admin/#tenant=${tenant}&admin=abilities`);
  const sidebar = page.locator('.admin-sidebar');
  await expect(sidebar).toContainText('合成成员 · 企业负责人');
  await expect(sidebar.locator('.admin-brand strong')).toHaveText('梦核引擎');
  await expect(sidebar.locator('.admin-nav-group-title').filter({ hasText: '梦核引擎' })).toBeVisible();
});

test('总台悬浮入口仅在正常已登录管理界面显示', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 503, json: {} }));
  await page.route('**/api/platform-admin/v1/auth/me', (route) => route.fulfill({ status: 401, json: {} }));
  await page.goto('/platform-admin/');
  await expect(page.getByRole('button', { name: '登录总台', exact: true })).toBeVisible();
  await expect(page.locator('[data-governance-link]')).toBeHidden();
  await page.route('**/api/platform-admin/v1/auth/me', (route) =>
    route.fulfill({
      json: {
        account: { id: account, username: 'synthetic_admin', email: null, displayName: '合成总部管理员' },
        platformAdmin: true,
        memberships: [],
      },
    }),
  );
  await page.reload();
  await expect(page.getByRole('link', { name: '同步数据口径', exact: true })).toBeVisible();
  await expect(page.locator('.admin-sidebar')).toContainText('合成总部管理员 · 总部管理员');
  await page.goto('/platform-admin/#invite=synthetic');
  await page.reload();
  await expect(page.locator('[data-governance-link]')).toBeHidden();
});

test('空白姓名只问候你好，成员维护身份从现有治理授权读取', async ({ page }) => {
  await fixture(page);
  await page.addInitScript(() => sessionStorage.setItem('dreamcore-choose-surface', 'yes'));
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      json: {
        account: { id: account, phone: '+8619900000036', email: null, displayName: '   ' },
        platformAdmin: false,
        memberships: [{ tenantId: tenant, tenantName: '合成企业甲', role: 'MEMBER' }],
      },
    }),
  );
  await page.route(`**/tenants/${tenant}/governance`, (route) =>
    route.fulfill({
      json: {
        tenantId: tenant,
        ownerId: null,
        revision: 1,
        owner: false,
        canConfigure: false,
        canEnterManagement: true,
        canAcceptInitialResponsibility: false,
        pendingHandover: null,
        capabilities: [{ workspaceId: other, capability: 'CONTENT_MAINTAIN' }],
      },
    }),
  );
  await page.goto(`/tenant-admin/#tenant=${tenant}`);
  await expect(page.getByRole('heading', { name: '你好', exact: true })).toBeVisible();
  await expect(page.getByText('合成企业甲 · 成员 · 可维护空间', { exact: true })).toBeVisible();
});

test('绑定页和会话过期后隐藏悬浮入口', async ({ page }) => {
  await fixture(page);
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      json: {
        account: { id: account, username: 'synthetic_admin', email: null, displayName: '合成成员' },
        platformAdmin: false,
        memberships: [{ tenantId: tenant, tenantName: '合成企业甲', role: 'TENANT_ADMIN' }],
      },
    }),
  );
  await page.goto(`/tenant-admin/#tenant=${tenant}&bind`);
  await expect(page.getByRole('heading', { name: '绑定手机号', exact: true })).toBeVisible();
  await expect(page.locator('[data-governance-link]')).toBeHidden();
  await page.goto(`/tenant-admin/#tenant=${tenant}&admin=abilities`);
  await page.reload();
  await expect(page.getByRole('link', { name: '同步数据口径', exact: true })).toBeVisible();
  await page.route('**/api/v1/me', (route) => route.fulfill({ status: 401, json: {} }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  await expect(page.locator('[data-governance-link]')).toBeHidden();
});
