import { test, expect, type BrowserContext } from '@playwright/test';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  person = id(2),
  customer = id(3);
const account = {
  id: customer,
  displayName: '合成客户甲',
  phone: '+8619900000001',
  email: null,
  status: 'ACTIVE',
  version: 0,
  tenantCount: 1,
};
async function fixture(context: BrowserContext) {
  const changes: unknown[] = [];
  const current = { ...account };
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const now = Date.now();
    const json = (value: unknown) => route.fulfill({ json: value });
    if (path.endsWith('/csrf')) return json({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
    if (path === '/api/platform-admin/v1/auth/me')
      return json({
        account: { id: person, email: 'platform@example.test', displayName: '平台管理员' },
        platformAdmin: true,
        memberships: [],
      });
    if (path === '/api/v1/me')
      return json({
        account: { id: person, email: null, phone: '+8619900000002', displayName: '企业管理员' },
        platformAdmin: false,
        memberships: [{ tenantId: tenant, tenantName: '合成企业', role: 'TENANT_ADMIN' }],
      });
    if (path.endsWith('/phone/configuration')) return json({ delivery: 'DISABLED', localPreview: false });
    if (path.endsWith('/governance'))
      return json({
        tenantId: tenant,
        ownerId: person,
        revision: 0,
        owner: true,
        canConfigure: true,
        canEnterManagement: true,
        canAcceptInitialResponsibility: false,
        pendingHandover: null,
        capabilities: [],
      });
    if (path === '/api/platform-admin/v1/overview')
      return json({
        totalTenants: 1,
        activeTenants: 1,
        suspendedTenants: 0,
        platform: 'AVAILABLE',
        database: 'AVAILABLE',
        invitationDelivery: 'DISABLED',
        checkedAt: new Date().toISOString(),
      });
    if (path.endsWith('/overview'))
      return json({
        tenantId: tenant,
        name: '合成企业',
        version: 0,
        activeMemberCount: 1,
        disabledMemberCount: 0,
        sharedWorkspaceCount: 0,
        invitationDelivery: 'DISABLED',
      });
    if (path.endsWith('/operations'))
      return json({
        tenantId: path.includes('/tenants/') ? tenant : null,
        days: 7,
        from: new Date(now - 7 * 86400000).toISOString(),
        checkedAt: new Date(now).toISOString(),
        tasks: Object.fromEntries(
          'total queued running succeeded failed cancelled interrupted paused waitingInput waitingCapability partial resultUnknown retryStarts'
            .split(' ')
            .map((k) => [k, 0]),
        ),
        storage: { materials: 0, versions: 0, originalBytes: 0 },
        models: [],
        errors: [],
        attemptUsage: [],
      });
    if (path === '/api/platform-admin/v1/accounts') return json([current]);
    if (path === `/api/platform-admin/v1/accounts/${customer}/status`) {
      const body = route.request().postDataJSON();
      changes.push(body);
      current.status = body.status;
      current.version++;
      return json({ account: current, memberships: [], records: [] });
    }
    if (path === `/api/platform-admin/v1/accounts/${customer}`)
      return json({
        account: current,
        memberships: [
          {
            tenantId: tenant,
            tenantName: '合成企业',
            role: 'MEMBER',
            membershipStatus: 'ACTIVE',
            serviceStatus: 'ACTIVE',
          },
        ],
        records: [],
      });
    if (path.endsWith('/members')) return json([]);
    if (path.endsWith('/tenants')) return json([]);
    if (path.endsWith('/staff'))
      return json([
        {
          id: person,
          displayName: '平台管理员',
          loginName: 'platform@example.test',
          status: 'ACTIVE',
          administrator: true,
          version: 0,
        },
      ]);
    return route.fulfill({ status: 404, json: { contractVersion: '1.0', code: 'UNAVAILABLE' } });
  });
  return changes;
}
test('enterprise sidebar, three member tabs and customer return stay separate from platform', async ({
  context,
  page,
}) => {
  await fixture(context);
  const back = '#' + new URLSearchParams({ tenant, view: 'conversations', conversation: id(9) });
  await page.goto('/tenant-admin/#' + new URLSearchParams({ tenant, back }));
  const nav = page.getByRole('complementary', { name: '企业管理导航' });
  await expect(nav.locator('nav a')).toHaveCount(7);
  await expect(page.getByRole('heading', { level: 1, name: '概览', exact: true })).toBeVisible();
  await nav.getByRole('link', { name: '成员与空间', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '成员与空间' }).getByRole('button')).toHaveCount(3);
  await expect(page.getByRole('navigation', { name: '管理工作区' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '返回客户端', exact: true })).toHaveAttribute(
    'href',
    '/workspace/' + back,
  );
  await expect(page.locator('a[href*="/platform-admin/"]')).toHaveCount(0);
  await nav.getByRole('link', { name: '概览', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '概览', exact: true })).toBeVisible();
  await expect(page.getByText('启用成员', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/tenant-admin-overview.png', fullPage: true });
  for (const width of [834, 360]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole('button', { name: '展开导航' }).click();
  await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: '成员与空间', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '成员与空间' })).toBeVisible();
});
test('platform directory preserves query across pages and performs confirmed global account action', async ({
  context,
  page,
}) => {
  const changes = await fixture(context);
  await page.goto('/platform-admin/');
  const nav = page.getByRole('complementary', { name: '总台导航' });
  await expect(nav.locator('nav a')).toHaveCount(7);
  await nav.getByRole('link', { name: '账号管理', exact: true }).click();
  await page.getByLabel('搜索账号').fill('客户甲');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByRole('button', { name: /合成客户甲/ }).click();
  await page.getByRole('button', { name: '停用账号', exact: true }).click();
  await page.getByLabel('处理原因').fill('合成安全核查');
  await page.getByRole('button', { name: '确认停用', exact: true }).click();
  await expect(page.getByRole('button', { name: '恢复账号', exact: true })).toBeVisible();
  expect(changes).toHaveLength(1);
  await page.getByRole('button', { name: '返回账号列表' }).click();
  await nav.getByRole('link', { name: '概览', exact: true }).click();
  await nav.getByRole('link', { name: '账号管理', exact: true }).click();
  await expect(page.getByLabel('搜索账号')).toHaveValue('客户甲');
  await expect(page.locator('a[href*="/workspace/"],a[href*="/tenant-admin/"]')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/platform-accounts.png', fullPage: true });
});
