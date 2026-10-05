import { test, expect, type BrowserContext } from '@playwright/test';
import { telemetryChannels } from '../../contracts/public-api/engine-telemetry';
const tenant = '00000000-0000-4000-8000-000000000001',
  person = '00000000-0000-4000-8000-000000000002';
async function fixture(context: BrowserContext) {
  let denied = false,
    wrong = false,
    reads = 0;
  const paths: string[] = [],
    mutations: string[] = [];
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    paths.push(path);
    if (route.request().method() !== 'GET') mutations.push(path);
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path.endsWith('/csrf')) return json({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' });
    if (path.endsWith('/phone/configuration')) return json({ delivery: 'DISABLED', localPreview: false });
    const platform = path.startsWith('/api/platform-admin/');
    if (path === '/api/v1/me' || path === '/api/platform-admin/v1/auth/me')
      return json({
        account: { id: person, email: 'test@example.test', displayName: '合成管理账号' },
        platformAdmin: platform,
        memberships: platform ? [] : [{ tenantId: tenant, tenantName: '合成企业', role: 'TENANT_ADMIN' }],
      });
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
    if (path.endsWith('/engine-telemetry')) {
      reads++;
      if (denied) return json({ code: 'ACCESS_DENIED' }, 403);
      return json({
        tenantId: wrong ? '00000000-0000-4000-8000-000000000003' : platform ? null : tenant,
        checkedAt: new Date(Date.UTC(2026, 9, 4, 10, 0, reads * (platform ? 3 : 15))).toISOString(),
        recentSeconds: 300,
        evolution: 'NOT_CONNECTED',
        channels: telemetryChannels
          .filter((c) => platform || c !== 'GENERAL_ADJUSTMENT')
          .map((code, i) => ({
            code,
            running: i % 3,
            queued: i % 2,
            waiting: code === 'EXPERIENCE' ? 1 : 0,
            unknown: code === 'TASK' ? 1 : 0,
            failed: code === 'COLLECTION' ? 2 : 0,
            completedRecent: i,
            lastCompletedAt: i % 2 ? '2026-10-04T09:59:30Z' : null,
          })),
      });
    }
    return json({}, 404);
  });
  return {
    paths,
    mutations,
    revoke: () => {
      denied = true;
    },
    wrong: () => {
      wrong = true;
    },
    reads: () => reads,
  };
}
for (const realm of ['platform', 'tenant'] as const)
  test(`${realm} engine is a read-only four-part wall with honest sampling and responsive layout`, async ({
    page,
    context,
  }) => {
    const f = await fixture(context),
      errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    if (realm === 'platform') await page.clock.install();
    await page.goto(
      realm === 'platform' ? '/platform-admin/#admin=engine' : `/tenant-admin/#tenant=${tenant}&admin=engine`,
    );
    const wall = page.getByLabel('引擎运行监控');
    for (const name of ['输入', '处理', '输出', '自进化'])
      await expect(wall.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(wall.getByLabel('自进化运行状态')).toContainText('未启用');
    await expect(wall).toContainText('等待下一次采样');
    if (realm === 'platform') {
      await expect(page.getByRole('button', { name: '刷新', exact: true })).toHaveCount(0);
      await page.clock.runFor(3010);
    } else await page.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(wall.getByRole('img', { name: /已采样 2 次/ })).toBeVisible();
    expect(f.reads()).toBe(2);
    expect(f.mutations).toEqual([]);
    await expect(wall.getByText('未知', { exact: true })).toBeVisible();
    if (realm === 'tenant') await expect(wall.getByText('总库调整核验', { exact: true })).toHaveCount(0);
    else {
      await expect(wall.getByLabel('处理运行状态').getByText('总库调整核验', { exact: true })).toBeVisible();
      expect(f.paths.some((p) => p.startsWith('/api/v1/'))).toBe(false);
      await expect(page.locator('a[href*="/workspace/"],a[href*="/tenant-admin/"]')).toHaveCount(0);
    }
    for (const width of realm === 'platform' ? [1440] : [1440, 834, 360]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width !== 834) await page.screenshot({ path: `/tmp/engine-${realm}-${width}.png`, fullPage: true });
    }
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    expect(storage).not.toContain('completedRecent');
    expect(errors).toEqual([]);
    f.revoke();
    if (realm === 'platform') {
      await expect(page.getByRole('button', { name: '刷新', exact: true })).toHaveCount(0);
      await page.clock.runFor(3010);
    } else await page.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(wall.getByRole('heading', { name: '没有访问权限', exact: true })).toBeVisible();
    await expect(page.locator('.engine-wall')).toHaveCount(0);
  });
test('wrong-tenant telemetry is rejected instead of displayed', async ({ page, context }) => {
  const f = await fixture(context);
  f.wrong();
  await page.goto(`/tenant-admin/#tenant=${tenant}&admin=engine`);
  await expect(page.getByRole('heading', { name: '暂时无法读取', exact: true })).toBeVisible();
  await expect(page.locator('.engine-wall')).toHaveCount(0);
});
test('automatic polling produces real samples and stops after leaving the engine page', async ({
  page,
  context,
}) => {
  const f = await fixture(context);
  await page.clock.install();
  await page.goto('/platform-admin/#admin=engine');
  await expect(page.locator('.engine-wall')).toBeVisible();
  await page.clock.runFor(3010);
  await expect.poll(() => f.reads()).toBe(2);
  await expect(page.getByRole('img', { name: /已采样 2 次/ })).toBeVisible();
  await page.clock.runFor(3000);
  await expect.poll(() => f.reads()).toBe(3);
  await expect(page.getByRole('img', { name: /已采样 3 次/ })).toBeVisible();
  await expect(page.locator('.engine-refresh')).toContainText('每 3 秒更新');
  await page.evaluate(() => {
    location.hash = '#admin=overview';
  });
  await expect(page.locator('.engine-wall')).toHaveCount(0);
  const count = f.reads();
  await page.clock.runFor(45000);
  expect(f.reads()).toBe(count);
});

test('hidden pages stop sampling until they become visible', async ({ page, context }) => {
  const f = await fixture(context);
  await page.clock.install();
  await page.goto('/platform-admin/#admin=engine');
  await expect(page.locator('.engine-wall')).toBeVisible();
  await page.evaluate(() =>
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }),
  );
  await page.clock.runFor(45000);
  expect(f.reads()).toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => f.reads()).toBe(2);
});
test('enterprise usage has its own navigation and retains the enterprise scope', async ({
  page,
  context,
}) => {
  await fixture(context);
  await page.goto(`/tenant-admin/#tenant=${tenant}&admin=engine`);
  await expect(page.locator('.engine-wall')).toBeVisible();
  await page.getByRole('complementary').getByRole('link', { name: '运行与用量', exact: true }).click();
  await expect(page.getByRole('heading', { name: '运行与用量', exact: true })).toBeVisible();
  expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('tenant')).toBe(tenant);
  await page.getByRole('complementary').getByRole('link', { name: '引擎仪表盘', exact: true }).click();
  await expect(page.locator('.engine-wall')).toBeVisible();
});
