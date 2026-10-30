import { test, expect, type Page } from '@playwright/test';
const identity = {
  accountId: '00000000-0000-4000-8000-000000000040',
  displayName: '合成总部管理员',
  roles: ['AGENT_ADMIN'],
};
async function fixture(page: Page, signedIn = false, loginStatus = 200) {
  const requests: { path: string; method: string }[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requests.push({ path, method: request.method() });
    if (path === '/api/agent-admin/v1/auth/me')
      return route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? identity : {} });
    if (path === '/api/agent-admin/v1/auth/csrf')
      return route.fulfill({ json: { token: 'synthetic-agent-token', headerName: 'X-CSRF-TOKEN' } });
    if (path === '/api/agent-admin/v1/auth/login') {
      expect(request.headers()['x-csrf-token']).toBe('synthetic-agent-token');
      expect(request.postDataJSON()).toEqual({ username: 'synthetic_admin', password: 'synthetic-password' });
      if (loginStatus === 200) signedIn = true;
      return route.fulfill({ status: loginStatus, json: signedIn ? identity : {} });
    }
    if (path === '/api/agent-admin/v1/capabilities') return route.fulfill({ json: [] });
    return route.fulfill({ status: 503, json: {} });
  });
  return requests;
}

async function assertNoConsole(page: Page) {
  await expect(page.getByRole('heading', { name: 'AI 功能管理台', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  await expect(page.locator('.agent-admin')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '已上架', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '说明样例', exact: true })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('quality-check');
  await expect(page.locator('body')).not.toContainText('document-parse');
}

test('未登录只显示登录页，不加载管理目录；登录后刷新第四端会话', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/agent-admin/');
  await assertNoConsole(page);
  expect(requests).toEqual([{ path: '/api/agent-admin/v1/auth/me', method: 'GET' }]);
  await page.getByLabel('管理账号').fill('synthetic_admin');
  await page.getByLabel('密码', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('.agent-admin')).toBeVisible();
  expect(requests.filter((r) => r.path.endsWith('/auth/me')).length).toBeGreaterThan(1);
  expect(requests.every((r) => r.path.startsWith('/api/agent-admin/'))).toBe(true);
});

test('已登录身份直接进入管理台，代号只在卡片辅助编号显示', async ({ page }) => {
  await fixture(page, true);
  await page.goto('/agent-admin/#view=capability-registry&tab=catalog');
  await expect(page.getByRole('heading', { name: '说明样例', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '已上架', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toHaveCount(0);
  await expect(page.locator('.agent-function code').filter({ hasText: '编号：quality-check' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '质量检查', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '登记实现方案', exact: true }).click();
  await expect(
    page
      .getByRole('dialog', { name: '登记实现方案' })
      .getByRole('textbox', { name: '企业功能', exact: true }),
  ).toHaveValue('质量检查');
});

for (const [status, message] of [
  [400, '账号或密码不正确'],
  [401, '账号或密码不正确'],
  [403, '请刷新页面后再试'],
  [500, '暂时无法登录，请稍后再试'],
] as const) {
  test(`登录失败 ${status} 使用中文提示并保留登录闸`, async ({ page }) => {
    await fixture(page, false, status);
    await page.goto('/agent-admin/');
    await page.getByLabel('管理账号').fill('synthetic_admin');
    await page.getByLabel('密码', { exact: true }).fill('synthetic-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(message);
    await assertNoConsole(page);
  });
}

test('会话读取中不闪出管理台', async ({ page }) => {
  await fixture(page, true);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/agent-admin/v1/auth/me', async (route) => {
    await pending;
    await route.fulfill({ json: identity });
  });
  await page.goto('/agent-admin/');
  await expect(page.getByRole('status')).toBeVisible();
  await expect(page.locator('.agent-admin')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('quality-check');
  release();
  await expect(page.locator('.agent-admin')).toBeVisible();
});

test('已上架目录的代号映射为中文名称，编号保留辅助行', async ({ page }) => {
  await fixture(page, true);
  await page.route('**/api/agent-admin/v1/capabilities', (route) =>
    route.fulfill({
      json: [
        { capabilityId: 'quality-check', name: 'quality-check', enterpriseFunction: 'quality-check' },
        { capabilityId: 'document-parse', name: 'document-parse', enterpriseFunction: 'document-parse' },
      ],
    }),
  );
  await page.goto('/agent-admin/#view=capability-registry&tab=catalog');
  const live = page.locator('section[aria-labelledby="agent-live-title"]');
  await expect(live.getByRole('heading', { name: '质量检查', exact: true })).toBeVisible();
  await expect(live.getByRole('heading', { name: '文档解析', exact: true })).toBeVisible();
  await expect(live.locator('code')).toHaveText(['编号：quality-check', '编号：document-parse']);
  await expect(live.getByRole('heading', { name: 'quality-check', exact: true })).toHaveCount(0);
});

test('已登录但目录读口 401 保留原有兜底文案', async ({ page }) => {
  await fixture(page, true);
  await page.route('**/api/agent-admin/v1/capabilities', (route) => route.fulfill({ status: 401, json: {} }));
  await page.goto('/agent-admin/#view=capability-registry&tab=catalog');
  await expect(page.getByText('还没有登录，请先登录后再试', { exact: true })).toBeVisible();
});
