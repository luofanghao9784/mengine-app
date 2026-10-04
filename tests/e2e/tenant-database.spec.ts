import { test, expect, type BrowserContext } from '@playwright/test';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  connection = id(2),
  dataset = id(3),
  person = id(4),
  space = id(5);
const run = {
  id: id(6),
  triggerKind: 'MANUAL',
  status: 'RUNNING',
  reason: null,
  createdAt: '2026-10-04T00:00:00Z',
  startedAt: '2026-10-04T00:00:01Z',
  finishedAt: null,
};
async function fixture(
  context: BrowserContext,
  options: { reader?: boolean; unavailable?: boolean; lost?: boolean } = {},
) {
  const requests: Record<string, unknown>[] = [];
  let schedule = { enabled: true, frequency: 'HOURLY', dailyTime: null, timeZone: 'Asia/Shanghai' },
    revision = 0,
    started = false,
    postCount = 0;
  const conn = () => ({
    id: connection,
    name: '合成后台',
    routeLabel: '合成后台 → 获准销售数据',
    accessSummary: '销售空间 · 按部署规则使用',
    status: options.unavailable ? 'UNAVAILABLE' : 'READY',
    revision,
    canControl: !options.reader,
    schedule,
    nextDue: schedule.enabled ? '2026-10-04T01:00:00Z' : null,
    lastSuccessAt: '2026-10-04T00:00:00Z',
    currentRun: started ? run : null,
    lastRun: started ? run : null,
  });
  const data = () => ({
    id: dataset,
    connectionId: connection,
    workspaceId: space,
    workspaceName: '合成销售空间',
    name: '合成订单数据',
    description: '合成销售记录',
    columns: ['门店', '数量'],
    version: 1,
    rowCount: 1,
    collectedAt: '2026-10-04T00:00:00Z',
    coverageThrough: '2026-10-03T23:50:00Z',
    latestRun: started ? run : null,
  });
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    const json = (value: unknown) => route.fulfill({ json: value });
    if (path.endsWith('/phone/configuration')) return json({ delivery: 'DISABLED', localPreview: false });
    if (path.endsWith('/csrf')) return json({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
    if (path === '/api/v1/me')
      return json({
        account: { id: person, email: 'synthetic@example.test', displayName: '合成人员' },
        platformAdmin: false,
        memberships: [
          { tenantId: tenant, tenantName: '合成企业', role: options.reader ? 'MEMBER' : 'TENANT_ADMIN' },
        ],
      });
    if (path.endsWith('/governance'))
      return json({
        tenantId: tenant,
        ownerId: person,
        revision: 0,
        owner: !options.reader,
        canConfigure: !options.reader,
        canEnterManagement: true,
        canAcceptInitialResponsibility: false,
        pendingHandover: null,
        capabilities: [],
      });
    if (path.endsWith('/summary'))
      return json({ datasets: 1, available: 1, updating: started ? 1 : 0, failed: 0 });
    if (path.endsWith('/datasets')) return json({ items: [data()], hasMore: false });
    if (path.endsWith('/datasets/' + dataset))
      return json({ dataset: data(), rows: [['合成门店', '3']], hasMore: false });
    if (path.endsWith('/connections')) return json([conn()]);
    if (path.endsWith('/connections/' + connection)) return json(conn());
    if (path.endsWith('/runs')) return json(started ? [run] : []);
    if (path.endsWith('/schedule')) {
      const body = route.request().postDataJSON();
      requests.push(body);
      schedule = body.schedule;
      revision++;
      return json(conn());
    }
    if (path.endsWith('/update')) {
      const body = route.request().postDataJSON();
      requests.push(body);
      started = true;
      postCount++;
      if (options.lost && postCount === 1) return route.abort('failed');
      return json(run);
    }
    return route.fulfill({ status: 404, json: { contractVersion: '1.0', code: 'UNAVAILABLE' } });
  });
  return requests;
}
test('dataset dashboard, scoped preview and connector controls preserve independent schedules', async ({
  page,
  context,
}) => {
  const writes = await fixture(context);
  await page.goto(`/tenant-admin/#tenant=${tenant}&admin=database`);
  await expect(page.getByRole('link', { name: /合成订单数据/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/tenant-database-dashboard.png', fullPage: true });
  await page.getByRole('link', { name: /合成订单数据/ }).click();
  await expect(page.getByRole('cell', { name: '合成门店' })).toBeVisible();
  await page.screenshot({ path: 'test-results/tenant-dataset-preview.png', fullPage: true });
  await page.getByRole('link', { name: '查看对应接入' }).click();
  await page.getByRole('button', { name: '调整自动取数' }).click();
  await page.getByRole('checkbox', { name: '自动取数', exact: true }).uncheck();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('未安排（自动取数已关闭）')).toBeVisible();
  expect(writes[0]).toMatchObject({
    expectedRevision: 0,
    schedule: { enabled: false, frequency: 'HOURLY', timeZone: 'Asia/Shanghai' },
  });
  await page.getByRole('button', { name: '立即更新', exact: true }).click();
  await expect(page.getByRole('button', { name: '更新中', exact: true })).toBeDisabled();
  expect(writes[1]).toMatchObject({ expectedRevision: 1 });
  expect(writes[1]).not.toHaveProperty('schedule');
  await page.getByRole('button', { name: '调整自动取数' }).click();
  await page.getByLabel('更新频率').selectOption('DAILY');
  await page.getByLabel('每天执行时间').fill('08:30');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: '更新中', exact: true })).toBeDisabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => writes.length).toBe(3);
  expect(writes[2]).toMatchObject({ schedule: { enabled: false, frequency: 'DAILY', dailyTime: '08:30' } });
  await page.setViewportSize({ width: 360, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/tenant-collection-detail.png', fullPage: true });
});
test('space responsible reader sees scoped data without collection controls or deployment settings', async ({
  page,
  context,
}) => {
  await fixture(context, { reader: true });
  await page.goto(`/tenant-admin/#tenant=${tenant}&admin=database&section=access&connection=${connection}`);
  await expect(page.getByRole('heading', { name: '合成后台' })).toBeVisible();
  await expect(page.getByRole('button', { name: '调整自动取数' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '立即更新' })).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '数据管理', exact: true })).toBeVisible();
});
test('unavailable connection blocks update and uncertain response reuses the original request', async ({
  page,
  context,
}) => {
  await fixture(context, { unavailable: true });
  await page.goto(`/tenant-admin/#tenant=${tenant}&admin=database&section=access&connection=${connection}`);
  await expect(page.getByRole('button', { name: '立即更新', exact: true })).toBeDisabled();
  await context.unrouteAll({ behavior: 'wait' });
  const writes = await fixture(context, { lost: true });
  await page.reload();
  await page.getByRole('button', { name: '立即更新', exact: true }).click();
  await expect(page.getByRole('button', { name: '核对本次更新', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '核对本次更新', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[0]).toEqual(writes[1]);
  await expect(page.getByRole('button', { name: '更新中', exact: true })).toBeDisabled();
});
