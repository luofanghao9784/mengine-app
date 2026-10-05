import { test, expect, type BrowserContext } from '@playwright/test';
import { telemetryChannels } from '../../contracts/public-api/engine-telemetry';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(21);
const checkedAt = '2026-10-04T10:00:00Z';
async function fixture(context: BrowserContext) {
  let revoked = false,
    leak = false,
    wrong = false;
  const paths: string[] = [],
    mutations: string[] = [];
  const counts = (ready = 0, attention = 0) => ({
    total: ready + attention,
    ready,
    processing: 0,
    attention,
    notStarted: 0,
    stopped: 0,
  });
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      p = url.pathname;
    paths.push(route.request().url());
    if (route.request().method() !== 'GET') mutations.push(p);
    const json = (v: unknown, status = 200) => route.fulfill({ json: v, status });
    if (p === '/api/platform-admin/v1/auth/me')
      return json({
        account: { id: id(1), email: 'synthetic@example.test', displayName: '合成平台人员' },
        platformAdmin: true,
        memberships: [],
      });
    if (p.endsWith('/csrf')) return json({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
    if (p.endsWith('/engine-telemetry'))
      return json({
        tenantId: null,
        checkedAt,
        recentSeconds: 300,
        evolution: 'NOT_CONNECTED',
        channels: telemetryChannels.map((code) => ({
          code,
          running: 0,
          queued: 0,
          waiting: 0,
          failed: 0,
          unknown: 0,
          completedRecent: 0,
          lastCompletedAt: null,
        })),
      });
    if (p.endsWith('/data-operations')) {
      const kind = url.searchParams.get('kind') || 'CONNECTIONS',
        state = url.searchParams.get('state') || 'ALL',
        offset = Number(url.searchParams.get('offset') || 0);
      if (revoked) return json({ code: 'ACCESS_DENIED' }, 403);
      if (p.includes('/tenants/')) {
        const tid = p.split('/tenants/')[1].split('/')[0];
        return json({
          kind,
          state,
          offset,
          checkedAt,
          tenantId: wrong ? id(900) : tid,
          tenantName: `合成企业 ${Number(tid.slice(-12)) - 20}`,
          tenantStatus: 'ACTIVE',
          counts: counts(0, 1),
          hasMore: false,
          items:
            state === 'READY'
              ? []
              : [
                  {
                    monitorKey: 'a'.repeat(32),
                    format: kind === 'MATERIALS' ? 'PDF' : null,
                    sizeBytes: kind === 'MATERIALS' ? 2048 : null,
                    version: kind === 'MATERIALS' ? 3 : null,
                    datasetCount: kind === 'CONNECTIONS' ? 2 : null,
                    rowCount: kind === 'CONNECTIONS' ? 24 : null,
                    runId: id(500),
                    stage: 'FAILED',
                    configuration: kind === 'CONNECTIONS' ? 'READY' : null,
                    category: 'ATTENTION',
                    diagnostic: kind === 'CONNECTIONS' ? 'OTHER' : 'PARSE_FAILED',
                    createdAt: '2026-10-04T09:00:00Z',
                    finishedAt: checkedAt,
                    lastSuccessAt: '2026-10-03T09:00:00Z',
                    ...(leak ? { filename: '不应泄露的文件名.txt' } : {}),
                  },
                ],
        });
      }
      const query = url.searchParams.get('query') || '';
      const all = Array.from({ length: 21 }, (_, i) => ({
        tenantId: id(i + 21),
        tenantName: `合成企业 ${i + 1}`,
        tenantStatus: 'ACTIVE',
        counts: counts(i % 2 ? 1 : 0, i % 2 ? 0 : 1),
        lastSuccessAt: checkedAt,
      })).filter(
        (t) =>
          t.tenantName.includes(query) &&
          (state === 'ALL' ||
            (state === 'ATTENTION' && t.counts.attention) ||
            (state === 'READY' && t.counts.ready)),
      );
      return json({
        kind,
        query,
        state,
        offset,
        checkedAt,
        matchedTenants: all.length,
        counts: counts(
          all.filter((t) => t.counts.ready).length,
          all.filter((t) => t.counts.attention).length,
        ),
        items: all.slice(offset, offset + 20),
        hasMore: all.length > offset + 20,
      });
    }
    return json({}, 404);
  });
  return {
    paths,
    mutations,
    revoke: () => {
      revoked = true;
    },
    leak: () => {
      leak = true;
    },
    wrong: () => {
      wrong = true;
    },
  };
}
test('system running opens an independent data subpage; list search and paging survive detail and return', async ({
  page,
  context,
}) => {
  const f = await fixture(context);
  await page.goto('/platform-admin/#admin=engine');
  await expect(page.locator('.engine-wall')).toBeVisible();
  await page.getByRole('link', { name: '数据库', exact: true }).click();
  await expect(page.getByRole('heading', { name: '数据接入监测', exact: true })).toBeVisible();
  await expect(page.locator('.engine-wall')).toHaveCount(0);
  await expect(page.getByLabel('搜索企业')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '运行状态' })).toHaveCount(0);
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.getByRole('heading', { name: '合成企业 21', exact: true })).toBeVisible();
  await page
    .getByRole('link')
    .filter({ has: page.getByRole('heading', { name: '合成企业 21', exact: true }) })
    .click();
  await expect(page.getByRole('heading', { name: '合成企业 21 · 数据接入' })).toBeVisible();
  await expect(page.getByText('处理未完成，详细技术原因尚未确认。', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '返回企业列表' }).click();
  await expect(page.getByText('第 2 页', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '合成企业 21', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '引擎仪表盘', exact: true }).click();
  await expect(page.locator('.engine-wall')).toBeVisible();
  expect(f.paths.every((p) => new URL(p).pathname.startsWith('/api/platform-admin/'))).toBe(true);
  expect(f.mutations).toEqual([]);
});
test('independent material library only offers technical records', async ({ page, context }) => {
  const f = await fixture(context);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/platform-admin/#admin=engine&detail=data&enterprise=${tenant}&kind=CONNECTIONS`);
  await page.getByRole('link', { name: '资料库', exact: true }).click();
  await expect(page).toHaveURL(/admin=materials/);
  await page.getByRole('heading', { name: '合成企业 1', exact: true }).click();
  await expect(page.getByRole('heading', { name: '合成企业 1 · 资料处理' })).toBeVisible();
  await expect(page.getByText('解析未完成，需在原处理系统核对。', { exact: true })).toBeVisible();
  await expect(page.getByText(id(500), { exact: true })).toBeVisible();
  await expect(page.getByText('PDF', { exact: true })).toBeVisible();
  await expect(page.getByText('2.0 KB', { exact: true })).toBeVisible();
  await expect(page.getByText('V3', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '企业支持入口' })).toHaveAttribute(
    'href',
    `#admin=tenants&enterprise=${tenant}&section=basic`,
  );
  for (const label of ['下载', '打开原件', '重试任务', '立即取数', '预览'])
    await expect(page.getByRole('button', { name: label })).toHaveCount(0);
  await expect(page.locator('a[href*="/workspace/"],a[href*="/tenant-admin/"]')).toHaveCount(0);
  for (const width of [1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width !== 834)
      await page.screenshot({ path: `/tmp/platform-data-operations-${width}.png`, fullPage: true });
  }
  const storage = await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }));
  expect(storage).not.toContain('monitorKey');
  expect(storage).not.toContain(id(500));
  expect(errors).toEqual([]);
  expect(f.mutations).toEqual([]);
  f.revoke();
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByRole('heading', { name: '没有访问权限', exact: true })).toBeVisible();
  await expect(page.getByText(id(500), { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '合成企业 1 · 资料处理' })).toHaveCount(0);
});
for (const problem of ['leak', 'wrong'] as const)
  test(`data detail rejects ${problem} response before displaying content`, async ({ page, context }) => {
    const f = await fixture(context);
    f[problem]();
    await page.goto(`/platform-admin/#admin=engine&detail=data&kind=MATERIALS&enterprise=${tenant}`);
    await expect(page.getByRole('heading', { name: '暂时无法读取', exact: true })).toBeVisible();
    await expect(page.getByText('不应泄露的文件名.txt')).toHaveCount(0);
    await expect(page.locator('.data-ops-records')).toHaveCount(0);
  });
test('empty search remains explicit and does not report a healthy enterprise', async ({ page, context }) => {
  await fixture(context);
  await page.goto('/platform-admin/#admin=materials');
  await page.getByLabel('搜索企业').fill('不存在');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.getByText('没有符合条件的企业。', { exact: true })).toBeVisible();
  await expect(page.locator('.data-ops-tenants a')).toHaveCount(0);
});
