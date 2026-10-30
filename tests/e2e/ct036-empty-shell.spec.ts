import { test, expect, type Page } from '@playwright/test';

// Synthetic identities and explicitly mocked read responses only; no real execution or results.
const tenant = '00000000-0000-4000-8000-000000000036';
const other = '00000000-0000-4000-8000-000000000037';
const account = '00000000-0000-4000-8000-000000000038';
const href = (id = tenant) => `/workspace/#tenant=${id}&view=quality-check`;
type OpenedReply = {
  status?: number;
  items?: { enterpriseFunction: string; displayName: string }[];
  networkError?: boolean;
};
const openedItem = { enterpriseFunction: 'quality-check', displayName: '质量检查' };
async function fixture(
  page: Page,
  mode: 'member' | 'anonymous' | 'no-member' = 'member',
  reply: OpenedReply = { items: [openedItem] },
) {
  const requests: { path: string; method: string }[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push({ path, method: route.request().method() });
    const t = path.includes(other) ? other : tenant;
    if (path === '/api/tenant-admin/v1/opened-capabilities') {
      expect(new URL(route.request().url()).search).toBe('');
      if (reply.networkError) return route.abort('failed');
      return route.fulfill({ status: reply.status ?? 200, json: { items: reply.items ?? [] } });
    }
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
    await expect(page.getByText('暂时不能提交检查材料（执行服务尚未接通）', { exact: true })).toHaveCount(0);
    await expect(page.getByText('暂时不能查看处理结果（执行服务尚未接通）', { exact: true })).toHaveCount(0);
    await expect(page.getByText('检查通过', { exact: true })).toHaveCount(0);
    if (width === 390) await page.getByRole('button', { name: '打开导航' }).click();
    const link = page.getByRole('link', { name: '质量检查', exact: true });
    await expect(link).toHaveAttribute('href', `#tenant=${tenant}&view=quality-check`);
    await link.click();
    await page.reload();
    await expect(page.getByRole('button', { name: '提交检查材料', exact: true })).toBeDisabled();
    const allowed = new Set([
      '/api/v1/me',
      '/api/tenant-admin/v1/opened-capabilities',
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

test('智能服务在原生服务不可用时仍显示已开通读失败空态', async ({ page }) => {
  const { requests, errors } = await fixture(page, 'member', { status: 503 });
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

for (const [name, reply, title] of [
  ['200 空列表', { items: [] }, '还没有已开通的 AI 功能'],
  ['404', { status: 404 }, '暂时不能查看已开通功能'],
  ['500', { status: 500 }, '暂时不能查看已开通功能（后台开通中）'],
  ['网络错误', { networkError: true }, '暂时不能查看已开通功能（后台开通中）'],
] as const) {
  test(`已开通区分 ${name}，工作台隐藏入口并拒绝直链`, async ({ page }) => {
    const { requests } = await fixture(page, 'member', reply);
    await page.goto(`/tenant-admin/#tenant=${tenant}&admin=abilities`);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await page.goto(href());
    await expect(
      page.getByRole('heading', {
        name: name === '200 空列表' ? '本企业还没有开通质量检查' : title,
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: '质量检查', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '提交检查材料', exact: true })).toHaveCount(0);
    expect(requests.every((r) => r.method === 'GET' && !r.path.includes('/agent-admin/'))).toBe(true);
  });
}

test('200 有项只展示服务端名称，已开通链接到工作台', async ({ page }) => {
  await fixture(page, 'member', {
    items: [
      { enterpriseFunction: 'quality-check', displayName: '服务端检查名称' },
      { enterpriseFunction: 'document-parse', displayName: '服务端解析名称' },
    ],
  });
  await page.goto(`/tenant-admin/#tenant=${tenant}&admin=abilities`);
  await expect(page.getByText('服务端解析名称', { exact: true })).toBeVisible();
  const link = page.getByRole('link', { name: '服务端检查名称', exact: true });
  await expect(link).toHaveAttribute('href', `/workspace/#tenant=${tenant}&view=quality-check`);
  await link.click();
  await expect(page.getByRole('heading', { name: '服务端检查名称', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '服务端检查名称', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '提交检查材料', exact: true })).toBeDisabled();
});

test('其他已开通项不能放行质量检查', async ({ page }) => {
  await fixture(page, 'member', {
    items: [{ enterpriseFunction: 'document-parse', displayName: '文档解析' }],
  });
  await page.goto(href());
  await expect(page.getByRole('heading', { name: '本企业还没有开通质量检查', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '质量检查', exact: true })).toHaveCount(0);
});

for (const surface of ['tenant-admin', 'workspace']) {
  test(`读口 401 回到既有登录墙：${surface}`, async ({ page }) => {
    await fixture(page, 'member', { status: 401 });
    await page.goto(surface === 'workspace' ? href() : `/tenant-admin/#tenant=${tenant}&admin=abilities`);
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '提交检查材料', exact: true })).toHaveCount(0);
  });
}

test('读取中不提前显示入口，切企业不复用旧开通状态', async ({ page }) => {
  await fixture(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route('**/api/tenant-admin/v1/opened-capabilities', async (route) => {
    calls++;
    if (calls === 1) await pending;
    return route.fulfill({ json: { items: calls === 1 ? [openedItem] : [] } });
  });
  await page.goto(href());
  await expect(page.getByRole('status').filter({ hasText: '正在读取' })).toBeVisible();
  await expect(page.getByRole('link', { name: '质量检查', exact: true })).toHaveCount(0);
  release();
  await expect(page.getByRole('button', { name: '提交检查材料', exact: true })).toBeDisabled();
  await page.evaluate((id) => {
    location.hash = `tenant=${id}&view=quality-check`;
  }, other);
  await expect(page.getByRole('heading', { name: '本企业还没有开通质量检查', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '质量检查', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '提交检查材料', exact: true })).toHaveCount(0);
});
