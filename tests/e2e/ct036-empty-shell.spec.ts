import { test, expect, type Page } from '@playwright/test';

// Synthetic identity only: these tests do not supply any opened functions or check results.
const tenant = '00000000-0000-4000-8000-000000000036';
const other = '00000000-0000-4000-8000-000000000037';
const account = '00000000-0000-4000-8000-000000000038';
const href = (id = tenant) => `/workspace/#tenant=${id}&view=quality-check`;
async function fixture(page: Page, mode: 'member' | 'anonymous' | 'no-member' = 'member') {
  const requests: { path: string; method: string }[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push({ path, method: route.request().method() });
    const t = path.includes(other) ? other : tenant;
    if (path === '/api/v1/me') {
      if (mode === 'anonymous') return route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } });
      return route.fulfill({
        json: {
          account: { id: account, phone: '+8619900000036', email: null, displayName: '合成成员' },
          platformAdmin: false,
          memberships:
            mode === 'no-member'
              ? []
              : [
                  { tenantId: tenant, tenantName: '合成企业甲', role: 'TENANT_ADMIN' },
                  { tenantId: other, tenantName: '合成企业乙', role: 'TENANT_ADMIN' },
                ],
        },
      });
    }
    if (path.endsWith('/phone/configuration'))
      return route.fulfill({ json: { delivery: 'DISABLED', localPreview: false } });
    if (path.endsWith('/governance'))
      return route.fulfill({
        json: {
          tenantId: t,
          ownerId: account,
          revision: 1,
          owner: true,
          canConfigure: true,
          canEnterManagement: true,
          canAcceptInitialResponsibility: false,
          pendingHandover: null,
          capabilities: [],
        },
      });
    if (path.endsWith('/business-status'))
      return route.fulfill({
        json: { tenantId: t, businessEnabled: true, canExport: false, exitState: null, exportDeadline: null },
      });
    if (path.endsWith('/workspace/notifications'))
      return route.fulfill({ json: { tenantId: t, conversations: false, briefing: false } });
    // Existing native plugin requests may fail; the new opened section must still be visible.
    return route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE' } });
  });
  return { requests, errors };
}

for (const width of [1440, 390]) {
  test(`质量检查三步空态、刷新和导航（${width}px）`, async ({ page }) => {
    const { requests, errors } = await fixture(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(href());
    await expect(page.getByRole('heading', { name: '质量检查', exact: true })).toBeVisible();
    for (const name of ['① 进入说明', '② 提交检查材料', '③ 处理结果'])
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '提交检查材料', exact: true })).toBeDisabled();
    await expect(page.getByText('暂时不能提交检查材料（后台开通中）', { exact: true })).toBeVisible();
    await expect(page.getByText('暂时不能查看处理结果（后台开通中）', { exact: true })).toBeVisible();
    await expect(page.getByText('检查通过', { exact: true })).toHaveCount(0);
    if (width === 390) await page.getByRole('button', { name: '打开导航' }).click();
    const link = page.getByRole('link', { name: '质量检查', exact: true });
    await expect(link).toHaveAttribute('href', `#tenant=${tenant}&view=quality-check`);
    await link.click();
    await page.reload();
    await expect(page.getByRole('button', { name: '提交检查材料', exact: true })).toBeDisabled();
    const allowed = new Set([
      '/api/v1/me',
      '/api/v1/auth/phone/configuration',
      ...[tenant, other].map((id) => `/api/v1/tenants/${id}/governance`),
      `/api/v1/tenants/${tenant}/departures/business-status`,
      `/api/v1/tenants/${tenant}/workspace/notifications`,
      `/api/v1/tenants/${tenant}/context`,
      `/api/v1/tenants/${tenant}/conversations`,
    ]);
    expect(requests.filter((r) => r.method !== 'GET' || !allowed.has(r.path))).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `/tmp/ct036-quality-${width}.png`, fullPage: true });
  });
}

test('切换企业与管理端往返保留质量检查路由', async ({ page }) => {
  await fixture(page);
  await page.goto(href());
  await page.getByRole('button', { name: '个人设置与账号' }).click();
  await page.getByRole('button', { name: /当前企业/ }).click();
  await page.getByRole('button', { name: '合成企业乙', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`tenant=${other}&view=quality-check$`));
  await page.getByRole('button', { name: '个人设置与账号' }).click();
  const management = await page.getByRole('link', { name: '企业管理端', exact: true }).getAttribute('href');
  await page.goto(`${management}&admin=abilities`);
  await page.getByRole('link', { name: '返回工作台', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`tenant=${other}&view=quality-check$`));
  await expect(page.getByRole('button', { name: '提交检查材料', exact: true })).toBeDisabled();
});

test('智能服务在原生服务不可用时仍显示已开通诚实空态', async ({ page }) => {
  const { requests, errors } = await fixture(page);
  await page.goto(`/tenant-admin/#tenant=${tenant}&admin=abilities`);
  await expect(page.getByRole('heading', { name: '已开通', exact: true })).toBeVisible();
  await expect(page.getByText('总部开通给本企业的 AI 功能会出现在这里。', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '暂时不能查看已开通功能（后台开通中）', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: '智能服务', exact: true, level: 2 })).toBeVisible();
  expect(requests.every((r) => r.method === 'GET' && !r.path.includes('/agent-admin/'))).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: '/tmp/ct036-tenant-opened.png', fullPage: true });
});

for (const mode of ['anonymous', 'no-member', 'wrong-tenant'] as const) {
  test(`质量检查深链沿用访问边界：${mode}`, async ({ page }) => {
    await fixture(page, mode === 'wrong-tenant' ? 'member' : mode);
    await page.goto(href(mode === 'wrong-tenant' ? account : tenant));
    if (mode === 'anonymous')
      await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    else
      await expect(
        page.getByRole('heading', {
          name: mode === 'no-member' ? '尚未加入企业' : '没有访问权限',
          exact: true,
        }),
      ).toBeVisible();
    await expect(page.getByRole('heading', { name: '② 提交检查材料', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '质量检查', exact: true })).toHaveCount(0);
  });
}
