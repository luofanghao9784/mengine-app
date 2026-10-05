import { test, expect, type BrowserContext } from '@playwright/test';
import { telemetryChannels } from '../../contracts/public-api/engine-telemetry';
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
async function fixture(context: BrowserContext, control: { mode?: string; paths?: string[] } = {}) {
  const changes: unknown[] = [];
  const current = { ...account };
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    control.paths?.push(path);
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
    if (path.endsWith('/engine-telemetry')) {
      if (control.mode === 'revoked') return route.fulfill({ status: 403, json: { code: 'ACCESS_DENIED' } });
      const scoped = path.includes('/tenants/');
      return json({
        tenantId: scoped ? tenant : null,
        checkedAt: new Date().toISOString(),
        recentSeconds: 300,
        evolution: 'NOT_CONNECTED',
        channels: telemetryChannels
          .filter((c) => !scoped || c !== 'GENERAL_ADJUSTMENT')
          .map((code) => ({
            code,
            running: code === 'TASK' ? 8 : code === 'RESPONSE' ? 3 : 0,
            queued: code === 'KNOWLEDGE' ? 4 : 0,
            waiting: code === 'COMPANY' ? 2 : 0,
            unknown: code === 'EXPERIENCE' ? 1 : 0,
            failed: 0,
            completedRecent: 0,
            lastCompletedAt: null,
          })),
      });
    }
    if (path.endsWith('/usage')) {
      if (control.mode === 'revoked') return route.fulfill({ status: 403, json: { code: 'ACCESS_DENIED' } });
      const value = {
        tenantId: path.includes('/tenants/') ? tenant : null,
        period: new URL(route.request().url()).searchParams.get('period'),
        timeZone: 'Asia/Shanghai',
        from: '2026-09-30T16:00:00Z',
        until: '2026-10-04T10:00:00Z',
        checkedAt: '2026-10-04T10:00:00Z',
        groups: [
          {
            purpose: 'WORK',
            executionClass: 'live',
            basis: 'REQUEST_STARTED',
            units: 53,
            reportedUnits: 52,
            unknownCallUnits: 0,
            pendingUnits: 1,
            modelCalls: 53,
            inputTokens: 100,
            outputTokens: 50,
          },
          {
            purpose: 'MAINTENANCE',
            executionClass: 'live',
            basis: 'RUN_STARTED',
            units: 2,
            reportedUnits: 0,
            unknownCallUnits: 2,
            pendingUnits: 2,
            modelCalls: null,
            inputTokens: null,
            outputTokens: null,
          },
          {
            purpose: 'WORK',
            executionClass: 'verification',
            basis: 'REQUEST_STARTED',
            units: 700,
            reportedUnits: 700,
            unknownCallUnits: 0,
            pendingUnits: 0,
            modelCalls: 700,
            inputTokens: 7000,
            outputTokens: 700,
          },
        ],
        days: [],
        tools: [],
        storage: { originals: 0, versions: 0, registeredBytes: 0 },
        coverage: {
          unmeteredWorkAttempts: 0,
          legacyToolReceipts: 0,
          evaluation: 'NOT_CONNECTED',
          evolution: 'NOT_ENABLED',
        },
        quota: { state: 'NOT_CONFIGURED', unit: null, limit: null, remaining: null },
      };
      if (control.mode === 'wrong') value.tenantId = id(99);
      return json(
        path.startsWith('/api/platform-admin/')
          ? {
              usage: value,
              cost: {
                state: 'NOT_CONNECTED',
                currency: null,
                verifiedMinor: null,
                estimatedMinor: null,
                sharedAllocation: 'NOT_CONFIGURED',
              },
            }
          : value,
      );
    }
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
    if (path.endsWith('/members'))
      return json([
        {
          accountId: customer,
          displayName: '合成客户甲',
          phone: '+8619900000001',
          email: null,
          role: 'TENANT_ADMIN',
          status: 'ACTIVE',
          accountStatus: 'ACTIVE',
          version: 0,
        },
      ]);
    if (path.endsWith('/invitations'))
      return json([
        {
          id: id(15),
          tenantId: tenant,
          phone: '+8619900000015',
          email: null,
          role: 'MEMBER',
          status: 'ACCEPTED',
          expiresAt: '2026-10-07T12:00:00Z',
        },
      ]);
    if (path.endsWith('/workspaces'))
      return json([
        {
          id: id(16),
          tenantId: tenant,
          name: '合成业务空间',
          kind: 'SHARED',
          version: 0,
          memberCount: 1,
          ownerId: customer,
          ownerName: '合成客户甲',
          description: '',
        },
      ]);
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
test('enterprise sidebar, unified member navigation and customer return stay separate from platform', async ({
  context,
  page,
}) => {
  await fixture(context);
  const back = '#' + new URLSearchParams({ tenant, view: 'conversations', conversation: id(9) });
  await page.goto('/tenant-admin/#' + new URLSearchParams({ tenant, back }));
  const nav = page.getByRole('complementary', { name: '企业管理导航' });
  await expect(nav.locator('nav a')).toHaveCount(8);
  await expect(page.getByRole('heading', { level: 1, name: '企业概览', exact: true })).toBeVisible();
  await nav.getByRole('link', { name: '成员与空间', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '成员与空间' }).getByRole('link')).toHaveCount(4);
  await expect(page.getByRole('navigation', { name: '管理工作区' })).toHaveCount(0);
  await expect(page.locator('.tenant-list-columns')).toContainText('企业角色');
  await expect(page.getByRole('link', { name: '查看成员 合成客户甲' })).toBeVisible();
  await page.screenshot({ path: '.local/member-layout-members.png', fullPage: true });
  const memberNav = page.getByRole('navigation', { name: '成员与空间' });
  await memberNav.getByRole('link', { name: '成员邀请', exact: true }).click();
  await expect(page.locator('.tenant-list-columns')).toContainText('有效期至');
  await memberNav.getByRole('link', { name: '共享空间', exact: true }).click();
  await expect(page.locator('.tenant-list-columns')).toContainText('授权成员');
  for (const width of [834, 360]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole('link', { name: '返回客户端', exact: true })).toHaveAttribute(
    'href',
    '/workspace/' + back,
  );
  await expect(page.locator('a[href*="/platform-admin/"]')).toHaveCount(0);
  await nav.getByRole('link', { name: '企业概览', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '企业概览', exact: true })).toBeVisible();
  await expect(page.getByText('启用成员', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/tenant-admin-overview.png', fullPage: true });
  for (const width of [834, 360]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole('button', { name: '展开导航' }).click();
  const mobileNav = page.getByRole('dialog', { name: '企业管理导航' });
  await expect(mobileNav).toBeVisible();
  await mobileNav.getByRole('link', { name: '成员与空间', exact: true }).click();
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

for (const realm of ['platform', 'tenant'] as const) {
  test(`${realm} overview uses current telemetry and formal monthly usage with scoped detail`, async ({
    context,
    page,
  }) => {
    const control = { mode: 'ready', paths: [] as string[] };
    await fixture(context, control);
    const path = realm === 'platform' ? '/platform-admin/' : `/tenant-admin/#tenant=${tenant}`;
    await page.goto(path);
    const stats = page.locator('.admin-stat');
    await expect(stats.filter({ hasText: '登记执行中' }).locator('strong')).toHaveText('11');
    await expect(stats.filter({ hasText: '登记排队' }).locator('strong')).toHaveText('4');
    await expect(page.getByText('1 项运行记录的结果尚未确认，可在运行页核对。')).toBeVisible();
    const monthly = page.getByRole('region', { name: '本月用量摘要' });
    await expect(
      monthly.locator('.admin-stat').filter({ hasText: '日常模型登记请求' }).locator('strong'),
    ).toHaveText('53');
    await expect(monthly.getByText('回执调用数未知')).toBeVisible();
    await expect(monthly.getByText(/2 次维护运行的调用数尚未知/)).toBeVisible();
    expect(control.paths.some((p) => p.endsWith('/operations'))).toBe(false);
    if (realm === 'tenant') await expect(page.getByText(/采购成本/)).toHaveCount(0);
    const monthlyLinkName = realm === 'platform' ? '查看明细' : '查看本月用量';
    await page.getByRole('link', { name: monthlyLinkName, exact: true }).click();
    if (realm === 'platform') {
      await expect(page.getByRole('combobox', { name: '用量统计期间' })).toHaveText('本月');
      await page.getByRole('combobox', { name: '用量统计期间' }).click();
      await page
        .getByRole('listbox', { name: '用量统计期间' })
        .getByRole('option', { name: '上月', exact: true })
        .click();
      await expect(page.getByRole('combobox', { name: '用量统计期间' })).toHaveText('上月');
    } else {
      await expect(page.getByLabel('用量统计期间')).toHaveValue('THIS_MONTH');
      await page.getByLabel('用量统计期间').selectOption('LAST_MONTH');
      await expect(page.getByLabel('用量统计期间')).toHaveValue('LAST_MONTH');
    }
    await page
      .getByRole('complementary')
      .getByRole('link', { name: realm === 'tenant' ? '企业概览' : '概览', exact: true })
      .click();
    await page.getByRole('link', { name: monthlyLinkName, exact: true }).click();
    if (realm === 'platform')
      await expect(page.getByRole('combobox', { name: '用量统计期间' })).toHaveText('本月');
    else await expect(page.getByLabel('用量统计期间')).toHaveValue('THIS_MONTH');
    await page
      .getByRole('complementary')
      .getByRole('link', { name: realm === 'tenant' ? '企业概览' : '概览', exact: true })
      .click();
    control.mode = 'revoked';
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(page.getByText('没有访问权限', { exact: true })).toHaveCount(2);
    await expect(stats.filter({ hasText: '登记执行中' }).locator('strong')).toHaveText('—');
    await expect(page.getByText('53', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/暂无结果待确认/)).toHaveCount(0);
  });
}
test('overview rejects mismatched monthly scope and fits a narrow viewport', async ({ context, page }) => {
  await fixture(context, { mode: 'wrong' });
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto(`/tenant-admin/#tenant=${tenant}`);
  const monthly = page.getByRole('region', { name: '本月用量摘要' });
  await expect(monthly.getByText('暂时无法读取', { exact: true })).toBeVisible();
  await expect(page.getByText('53', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
