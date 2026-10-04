import { test, expect, type BrowserContext } from '@playwright/test';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  tenant = id(1),
  other = id(2),
  person = id(3);
const at = '2026-10-04T10:00:00Z';
async function fixture(context: BrowserContext) {
  let mode = 'ready';
  const paths: string[] = [],
    methods: string[] = [];
  await context.route('**/api/**', async (route) => {
    const u = new URL(route.request().url()),
      p = u.pathname,
      platform = p.startsWith('/api/platform-admin/');
    paths.push(route.request().url());
    methods.push(route.request().method());
    const json = (v: unknown, status = 200) => route.fulfill({ json: v, status });
    if (p.endsWith('/csrf')) return json({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' });
    if (p.endsWith('/phone/configuration')) return json({ delivery: 'DISABLED', localPreview: false });
    if (p === '/api/v1/me' || p === '/api/platform-admin/v1/auth/me')
      return json({
        account: { id: person, email: 'synthetic@example.test', displayName: '合成管理员' },
        platformAdmin: platform,
        memberships: platform ? [] : [{ tenantId: tenant, tenantName: '合成企业 A', role: 'TENANT_ADMIN' }],
      });
    if (p.endsWith('/governance'))
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
    if (p === '/api/platform-admin/v1/tenants')
      return json(
        u.searchParams.get('q') === '无结果'
          ? []
          : [
              {
                id: tenant,
                name: '合成企业 A',
                status: 'ACTIVE',
                createdAt: at,
                activeMemberCount: 1,
                owner: { state: 'UNDESIGNATED', accountId: null, name: null },
              },
            ],
      );
    if (p === `/api/platform-admin/v1/tenants/${tenant}`)
      return json({
        tenant: { id: tenant, name: '合成企业 A', status: 'ACTIVE' },
        version: 0,
        createdAt: at,
        activeMemberCount: 1,
        workspaceCount: 1,
        owner: { state: 'UNDESIGNATED', accountId: null, name: null },
        serviceChange: null,
        initialAdminInvitation: null,
      });
    if (p.endsWith('/usage')) {
      if (mode === 'revoked') return json({ code: 'ACCESS_DENIED' }, 403);
      const period = u.searchParams.get('period') || 'THIS_MONTH',
        scoped = p.includes('/tenants/');
      const g = {
        purpose: 'WORK',
        executionClass: 'live',
        basis: 'REQUEST_STARTED',
        units: 5,
        reportedUnits: 3,
        unknownCallUnits: 0,
        pendingUnits: 1,
        modelCalls: 5,
        inputTokens: 120,
        outputTokens: 30,
      };
      const usage = {
        tenantId: mode === 'wrong' ? other : scoped ? tenant : null,
        period,
        timeZone: 'Asia/Shanghai',
        from:
          period === 'LAST_MONTH'
            ? '2026-08-31T16:00:00Z'
            : period === 'LAST_30_DAYS'
              ? '2026-09-04T16:00:00Z'
              : '2026-09-30T16:00:00Z',
        until: period === 'LAST_MONTH' ? '2026-09-30T16:00:00Z' : at,
        checkedAt: at,
        groups:
          mode === 'empty'
            ? []
            : [
                g,
                {
                  ...g,
                  purpose: 'MAINTENANCE',
                  basis: 'RUN_STARTED',
                  units: 1,
                  reportedUnits: 0,
                  unknownCallUnits: 1,
                  pendingUnits: 1,
                  modelCalls: null,
                  inputTokens: null,
                  outputTokens: null,
                },
                {
                  ...g,
                  executionClass: 'verification',
                  units: 2,
                  reportedUnits: 2,
                  modelCalls: 2,
                  pendingUnits: 0,
                },
              ],
        days: Array.from({ length: period === 'THIS_MONTH' ? 4 : 30 }, (_, index) => {
          const start =
            period === 'LAST_MONTH' ? '2026-09-01' : period === 'LAST_30_DAYS' ? '2026-09-05' : '2026-10-01';
          const count = period === 'THIS_MONTH' ? 4 : 30;
          const last = index === count - 1 && mode !== 'empty';
          return {
            date: new Date(Date.parse(start) + index * 86400_000).toISOString().slice(0, 10),
            workRequests: last ? 5 : 0,
            maintenanceCalls: last ? null : 0,
            unknownMaintenanceRuns: last ? 1 : 0,
            inputTokens: last ? 120 : null,
            outputTokens: last ? 30 : null,
          };
        }),
        tools: [
          {
            executionClass: 'live',
            starts: 4,
            succeeded: 2,
            failed: 1,
            pending: 1,
            timed: 3,
            elapsedMillis: 4200,
          },
        ],
        storage: { originals: 3, versions: 5, registeredBytes: 1536000 },
        coverage: {
          unmeteredWorkAttempts: 1,
          legacyToolReceipts: 2,
          evaluation: 'NOT_CONNECTED',
          evolution: 'NOT_ENABLED',
        },
        quota: { state: 'NOT_CONFIGURED', unit: null, limit: null, remaining: null },
      };
      const result = platform
        ? {
            usage,
            cost: {
              state: 'NOT_CONNECTED',
              currency: null,
              verifiedMinor: null,
              estimatedMinor: null,
              sharedAllocation: 'NOT_CONFIGURED',
            },
          }
        : usage;
      return json(mode === 'leak' ? { ...result, content: 'private-do-not-show' } : result);
    }
    return json({ code: 'NOT_FOUND' }, 404);
  });
  return {
    paths,
    methods,
    mode: (m: string) => {
      mode = m;
    },
  };
}
test('platform defaults to month, filters enterprise with same facts, preserves period and shows unknown cost', async ({
  page,
  context,
}) => {
  const f = await fixture(context);
  await page.goto('/platform-admin/#admin=usage');
  await expect(page.getByRole('combobox', { name: '用量统计期间' })).toHaveText('本月');
  await expect(page.getByRole('region', { name: '运行成本' })).toContainText('已核实成本');
  await expect(page.getByRole('region', { name: '用途与计量覆盖' })).toContainText('合成验证');
  await page.getByRole('combobox', { name: '用量统计期间' }).click();
  await page
    .getByRole('listbox', { name: '用量统计期间' })
    .getByRole('option', { name: '上月', exact: true })
    .click();
  await expect(page.getByText(/统计：2026\/9\/1/)).toBeVisible();
  await page.getByRole('link', { name: /合成企业 A.*查看用量/ }).click();
  await expect(page.getByRole('link', { name: '返回全平台用量' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '用量统计期间' })).toHaveText('上月');
  expect(f.paths.some((p) => p.includes(`/tenants/${tenant}/usage?period=LAST_MONTH`))).toBeTruthy();
  await page.getByRole('link', { name: '返回全平台用量' }).click();
  await page.getByRole('textbox', { name: '搜索企业' }).fill('无结果');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.getByText('没有匹配的企业。')).toBeVisible();
  expect(f.methods.every((m) => m === 'GET')).toBeTruthy();
  await page.screenshot({ path: '/tmp/usage-platform-details-1440.png' });
  await page.locator('.usage-heading').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/usage-platform-1440.png' });
});
test('enterprise page omits procurement cost, shows incomplete usage and quota without inventing limits', async ({
  page,
  context,
}) => {
  const f = await fixture(context);
  await page.goto(`/tenant-admin/#tenant=${tenant}&admin=engine&detail=usage`);
  await expect(page.getByRole('heading', { name: '本企业用量', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '企业额度' })).toContainText('剩余额度未知');
  await expect(page.getByRole('region', { name: '运行成本' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '用途与计量覆盖' })).toContainText('Token 完整回执 3 / 5');
  await page.getByText('查看每日数值', { exact: true }).click();
  await expect(page.getByRole('table')).toContainText('2026-10-04');
  await page.setViewportSize({ width: 360, height: 820 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: '/tmp/usage-tenant-360.png' });
  f.mode('revoked');
  await page.getByRole('button', { name: '更新用量' }).click();
  await expect(page.getByText('没有访问权限', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '每日用量趋势' })).toHaveCount(0);
});
for (const mode of ['wrong', 'leak'])
  test(`usage rejects ${mode} response instead of displaying foreign facts`, async ({ page, context }) => {
    const f = await fixture(context);
    f.mode(mode);
    await page.goto(`/tenant-admin/#tenant=${tenant}&admin=engine&detail=usage`);
    await expect(page.getByText('暂时无法读取', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: '用途与计量覆盖' })).toHaveCount(0);
    await expect(page.getByText('private-do-not-show')).toHaveCount(0);
  });
test('empty observations do not imply free service or complete monitoring', async ({ page, context }) => {
  const f = await fixture(context);
  f.mode('empty');
  await page.goto('/platform-admin/#admin=usage');
  await expect(page.getByText('该期间暂无模型计量记录。')).toBeVisible();
  await expect(page.getByRole('region', { name: '运行成本' })).toContainText('未接入');
  await expect(page.getByRole('region', { name: '企业额度' })).toContainText('未配置');
  await expect(page.getByText('剩余额度未知', { exact: false })).toBeVisible();
});

test('platform enterprise detail uses the same scoped usage facts and retains selected period on refresh', async ({
  page,
  context,
}) => {
  const f = await fixture(context);
  await page.goto(`/platform-admin/#admin=tenants&enterprise=${tenant}&section=usage`);
  await expect(page.getByRole('region', { name: '企业详情' })).toBeVisible();
  const cards = page.locator('.enterprise-usage > .usage-metrics');
  await expect(cards).toContainText('日常登记请求');
  await expect(cards.locator('div').nth(0).locator('dd')).toHaveText('5');
  await expect(cards.locator('div').nth(1).locator('dd')).toHaveText('150');
  await expect(cards).toContainText('部分消耗未上报');
  await expect(page.getByRole('region', { name: '用量构成' })).toContainText('未知');
  await expect(page.getByRole('region', { name: '用途与计量覆盖' })).not.toBeVisible();
  await page.getByText('计量明细与说明', { exact: true }).click();
  await expect(page.getByRole('region', { name: '用途与计量覆盖' })).toContainText('合成验证');
  await page.getByRole('combobox', { name: '用量统计期间' }).click();
  await page
    .getByRole('listbox', { name: '用量统计期间' })
    .getByRole('option', { name: '近 30 天', exact: true })
    .click();
  await expect(page.getByText(/统计：2026\/9\/5/)).toBeVisible();
  await page.getByRole('button', { name: '更新用量', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '用量统计期间' })).toHaveText('近 30 天');
  expect(
    f.paths.filter((p) => p.includes('/usage?')).every((p) => p.includes(`/tenants/${tenant}/usage?`)),
  ).toBeTruthy();
});
