import { test, expect, type BrowserContext } from '@playwright/test';
import { telemetryChannels } from '../../contracts/public-api/engine-telemetry';
const person = '00000000-0000-4000-8000-000000000002';
const tenantId = (i: number) => `00000000-0000-4000-8000-${String(100 + i).padStart(12, '0')}`;
type Counts = Partial<
  Record<
    string,
    { running?: number; queued?: number; failed?: number; unknown?: number; completedRecent?: number }
  >
>;
// Synthetic busy platform: every count below is what the page must draw, no more.
const busy: Counts = {
  COLLECTION: { running: 9, queued: 13, failed: 3 },
  KNOWLEDGE: { running: 2, queued: 4 },
  RETRIEVAL: { running: 0 },
  TASK: { running: 4, unknown: 1 },
  COMPANY: { running: 1 },
  GENERAL_ADJUSTMENT: { running: 1 },
  RESPONSE: { running: 5, completedRecent: 7 },
  EXPORT: { running: 1, unknown: 2 },
};
async function fixture(context: BrowserContext, initial: Counts = busy) {
  let counts = initial,
    reads = 0;
  const paths: string[] = [],
    mutations: string[] = [];
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    paths.push(path);
    if (route.request().method() !== 'GET') mutations.push(path);
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path.endsWith('/csrf')) return json({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' });
    if (path.endsWith('/phone/configuration')) return json({ delivery: 'DISABLED', localPreview: false });
    if (path === '/api/platform-admin/v1/auth/me')
      return json({
        account: { id: person, email: 'test@example.test', displayName: '合成平台账号' },
        platformAdmin: true,
        memberships: [],
      });
    if (path === '/api/platform-admin/v1/engine-telemetry') {
      reads++;
      return json({
        tenantId: null,
        checkedAt: new Date(Date.UTC(2026, 9, 6, 10, 0, reads * 3)).toISOString(),
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
          ...counts[code],
          ...(code === 'RESPONSE' ? { lastCompletedAt: '2026-10-06T09:59:00Z' } : {}),
        })),
      });
    }
    if (path === '/api/platform-admin/v1/engine-telemetry/tenants')
      return json({
        checkedAt: '2026-10-06T10:00:00Z',
        tenants: [
          { tenantId: tenantId(1), tenantName: '合成企业甲', running: 12 },
          { tenantId: tenantId(2), tenantName: '合成企业乙', running: 7 },
        ],
        otherTenants: 0,
        otherRunning: 0,
      });
    if (path === '/api/platform-admin/v1/operations')
      return json({
        tenantId: null,
        days: 7,
        from: '2026-09-29T10:00:00Z',
        checkedAt: '2026-10-06T10:00:00Z',
        tasks: {
          total: 6,
          queued: 0,
          running: 0,
          succeeded: 2,
          failed: 4,
          cancelled: 0,
          interrupted: 0,
          paused: 0,
          waitingInput: 0,
          waitingCapability: 0,
          partial: 0,
          resultUnknown: 0,
          retryStarts: 0,
        },
        storage: { materials: 0, versions: 0, originalBytes: 0 },
        models: [],
        attemptUsage: [],
        errors: [{ code: 'TASK_MODEL_FAILED', tasks: 4, lastOccurredAt: '2026-10-06T09:03:00Z' }],
      });
    if (path === '/api/platform-admin/v1/usage')
      return json({
        usage: {
          tenantId: null,
          period: 'LAST_30_DAYS',
          timeZone: 'Asia/Shanghai',
          from: '2026-09-06T16:00:00Z',
          until: '2026-10-06T10:00:00Z',
          checkedAt: '2026-10-06T10:00:00Z',
          groups: [],
          days: Array.from({ length: 9 }, (_, i) => ({
            date: new Date(Date.UTC(2026, 8, 28 + i)).toISOString().slice(0, 10),
            workRequests: 20 + i,
            maintenanceCalls: null,
            unknownMaintenanceRuns: 0,
            inputTokens: i === 5 ? null : 1000 * i,
            outputTokens: i === 5 ? null : 100 * i,
          })),
          tools: [],
          storage: { originals: 0, versions: 0, registeredBytes: 0 },
          coverage: {
            unmeteredWorkAttempts: 0,
            legacyToolReceipts: 0,
            evaluation: 'NOT_CONNECTED',
            evolution: 'NOT_ENABLED',
          },
          quota: { state: 'NOT_CONFIGURED', unit: null, limit: null, remaining: null },
        },
        cost: {
          state: 'NOT_CONNECTED',
          currency: null,
          verifiedMinor: null,
          estimatedMinor: null,
          sharedAllocation: 'NOT_CONFIGURED',
        },
      });
    if (path === '/api/platform-admin/v1/data-operations') {
      const kind = url.searchParams.get('kind');
      const c =
        kind === 'MATERIALS'
          ? { ready: 1284, processing: 23, attention: 4, notStarted: 0, stopped: 2 }
          : { ready: 6, processing: 1, attention: 1, notStarted: 2, stopped: 0 };
      return json({
        kind,
        query: '',
        state: 'ALL',
        offset: 0,
        checkedAt: '2026-10-06T10:00:00Z',
        matchedTenants: 0,
        counts: { total: Object.values(c).reduce((a, b) => a + b, 0), ...c },
        items: [],
        hasMore: false,
      });
    }
    return json({}, 404);
  });
  return {
    paths,
    mutations,
    reads: () => reads,
    set: (next: Counts) => {
      counts = next;
    },
  };
}
const label = (code: string) => `.eng3d-lbl[data-channel="${code}"]`;
const photons = (page: import('@playwright/test').Page, code: string) =>
  page.locator(label(code)).getAttribute('data-photons');

test('3D stage and observed sections show only real counts', async ({ page, context }) => {
  const f = await fixture(context),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install();
  await page.goto('/platform-admin/#admin=engine');
  const stage = page.locator('.eng3d');
  await expect(stage.locator('.eng3d-trail')).toContainText('23 项执行中');
  await expect(stage.locator('.eng3d-warn')).toHaveText('4 项需要留意');
  await expect(stage.locator('.eng3d-core b')).toHaveText('23');
  await expect(stage.locator('canvas.eng3d-gl')).toBeVisible();
  // Photons: one per running record, at most six per lane; queue motes: one per record, at most ten, then +n.
  expect(await photons(page, 'COLLECTION')).toBe('6');
  expect(await photons(page, 'KNOWLEDGE')).toBe('2');
  expect(await photons(page, 'RETRIEVAL')).toBe('0');
  expect(await photons(page, 'RESPONSE')).toBe('5');
  expect(await photons(page, 'EXPORT')).toBe('1');
  await expect(page.locator(label('COLLECTION'))).toHaveAttribute('data-queue-dots', '10');
  await expect(page.locator(`${label('COLLECTION')} .more`)).toHaveText('+3');
  await expect(page.locator(label('KNOWLEDGE'))).toHaveAttribute('data-queue-dots', '4');
  await expect(page.locator(`${label('KNOWLEDGE')} .more`)).toHaveCount(0);
  await expect(page.locator('.eng3d-lbl[data-channel="TASK"]')).toHaveCount(0);
  for (const cap of ['输入', '工作循环', '输出', '自进化循环'])
    await expect(stage.getByRole('button', { name: cap, exact: true })).toBeAttached();
  const mix = stage.locator('.eng3d-mix');
  await expect(mix).toContainText('输入11');
  await expect(mix).toContainText('处理6');
  await expect(mix).toContainText('输出6');
  // Prototype-only controls never ship.
  await expect(page.getByText('演示场景')).toHaveCount(0);
  await expect(page.getByRole('group', { name: '查看范围' })).toHaveCount(0);
  for (const name of ['近 5 分钟脉搏', '需要留意', '近 7 天节律', '资料与接入', '企业执行分布'])
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const attention = page.locator('#engine-attention');
  await expect(attention).toContainText('模型请求未完成');
  await expect(attention).toContainText('外部取数有保留的失败或中断');
  await expect(attention).toContainText('成果导出有结果待核对');
  await expect(attention).toContainText('外部取数排队较长');
  await expect(page.locator('.engine-dash-week > div')).toHaveCount(7);
  await expect(page.locator('.engine-dash-week').getByText('未回报')).toHaveCount(1);
  await expect(page.locator('.engine-dash-tok')).toHaveCount(6);
  await expect(page.locator('.engine-dash-intake[data-kind="MATERIALS"]')).toContainText('共 1,313');
  await expect(page.locator('.engine-dash-tenants li')).toHaveCount(2);
  await expect(page.locator('.engine-dash-tenants')).toContainText('合成企业甲');
  await page.clock.runFor(3010);
  await expect(page.getByRole('img', { name: /已采样 2 次/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/engine-platform-3d-1440.png' });
  await page.locator('.engine-dash-lower').screenshot({ path: '/tmp/engine-platform-3d-lower.png' });
  console.log('webgl', await stage.getAttribute('data-webgl'));
  expect(f.mutations).toEqual([]);
  expect(f.paths.some((p) => p.startsWith('/api/v1/') || p.startsWith('/api/tenant-admin/'))).toBe(false);
  expect(errors).toEqual([]);
});

test('stage keys push into a stage, panel lists its channels, Esc steps back', async ({ page, context }) => {
  await fixture(context);
  await page.goto('/platform-admin/#admin=engine');
  await expect(page.locator('.eng3d-core b')).toHaveText('23');
  await page.keyboard.press('2');
  const panel = page.getByRole('complementary', { name: '处理详情' });
  await expect(panel).toBeVisible();

  await expect(panel.getByRole('button', { name: '返回总览' })).toBeFocused();
  await expect(panel.locator('.row')).toHaveCount(5);
  await expect(panel).toContainText('总库调整核验');
  await expect(panel.locator('.psum')).toContainText('6 项执行中');
  await panel.locator('.row[data-channel="TASK"]').click();
  await expect(panel.locator('.det .kv')).toContainText('待核对1');
  await page.waitForTimeout(900);
  await page.screenshot({ path: '/tmp/engine-platform-3d-panel.png' });
  await page.keyboard.press('Escape');
  await expect(panel.locator('.det')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.eng3d-panel')).not.toHaveAttribute('data-open');
  await expect(page.getByRole('button', { name: '引擎仪表盘', exact: true })).toBeFocused();
  await page.keyboard.press('4');
  const evo = page.getByRole('complementary', { name: '自进化详情' });
  await expect(evo.locator('.row')).toHaveCount(4);
  await expect(evo).toContainText('未接入');
  await expect(evo).not.toContainText(/\d+ 项执行中/);
  await page.keyboard.press('Escape');
  // Projected labels follow the drifting camera every frame, so Playwright never sees them as "stable".
  await expect(page.locator(label('COLLECTION'))).toHaveCSS('opacity', '1');
  await page.locator(label('COLLECTION')).click({ force: true });
  const input = page.getByRole('complementary', { name: '输入详情' });
  await expect(input.locator('.row[aria-current="true"]')).toHaveAttribute('data-channel', 'COLLECTION');
  await expect(page.locator('.eng3d-panel')).toHaveAttribute('data-side', 'left');
  await expect(input.getByRole('link', { name: '打开数据处理' })).toHaveAttribute('href', /admin=database/);
});

test('lens switches the core, ring and labels to another real count', async ({ page, context }) => {
  await fixture(context);
  await page.goto('/platform-admin/#admin=engine');
  await page.locator('.eng3d-reads [data-lens="q"]').click();
  await expect(page.locator('.eng3d-reads [data-lens="q"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.eng3d-core b')).toHaveText('17');
  await expect(page.locator('.eng3d-core span')).toHaveText('排队');
  await expect(page.locator(`${label('COLLECTION')} .v`)).toHaveText('13');
  await expect(page.locator(`${label('COLLECTION')} .q`)).toContainText('执行中 9');
  await page.locator('.eng3d-reads [data-lens="w"]').click();
  await expect(page.locator('.eng3d-core b')).toHaveText('0');
  await expect(page.locator('.eng3d-ring circle[data-arc]')).toHaveCount(3);
  expect(await page.locator('.eng3d-ring circle[data-arc="in"]').getAttribute('stroke-dasharray')).toMatch(
    /^0 /,
  );
});

test('change log shows exact snapshot differences; idle has no photons', async ({ page, context }) => {
  const f = await fixture(context);
  await page.clock.install();
  await page.goto('/platform-admin/#admin=engine');
  await expect(page.locator('.eng3d-core b')).toHaveText('23');
  await expect(page.locator('.eng3d-log button')).toHaveCount(0);
  f.set({ ...busy, COLLECTION: { running: 5, queued: 13, failed: 4 } });
  await page.clock.runFor(3010);
  const log = page.locator('.eng3d-log');
  await expect(log).toContainText('外部取数 新增异常');
  await expect(log).toContainText('外部取数 执行中减少');
  await expect(log.locator('b.down').first()).toHaveText('-4');
  await expect(log.locator('button')).toHaveCount(2);
  f.set({});
  await page.clock.runFor(3010);
  await expect(page.locator('.eng3d-trail')).toContainText('空闲，没有执行中的记录');
  for (const code of ['COLLECTION', 'KNOWLEDGE', 'RETRIEVAL', 'RESPONSE', 'EXPORT'])
    expect(await photons(page, code)).toBe('0');
  await expect(log.locator('button')).toHaveCount(4);
});

test('reduced motion draws no photons while numbers keep updating', async ({ page, context }) => {
  const f = await fixture(context);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await page.goto('/platform-admin/#admin=engine');
  await expect(page.locator('.eng3d')).toHaveAttribute('data-motion', 'reduced');
  await expect(page.locator('.eng3d-core b')).toHaveText('23');
  expect(await photons(page, 'COLLECTION')).toBe('0');
  expect(await page.locator('.eng3d-snap svg path').evaluate((e) => getComputedStyle(e).animationName)).toBe(
    'none',
  );
  f.set({ ...busy, TASK: { running: 10 } });
  await page.clock.runFor(3010);
  await expect(page.locator('.eng3d-core b')).toHaveText('29');
  expect(await photons(page, 'RESPONSE')).toBe('0');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('.eng3d')).toHaveAttribute('data-motion', 'full');
  expect(await photons(page, 'RESPONSE')).toBe('5');
});

test('unavailable operations summary preserves known task alerts', async ({ page, context }) => {
  await fixture(context, { TASK: { failed: 2 }, RESPONSE: { unknown: 1 } });
  await context.route('**/api/platform-admin/v1/operations?*', (route) =>
    route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } }),
  );
  await page.goto('/platform-admin/#admin=engine');
  const attention = page.locator('#engine-attention');
  await expect(attention).toContainText('任务异常汇总暂时无法读取');
  await expect(attention).toContainText('会话与画报有保留的失败或中断');
  await expect(attention).toContainText('会话流式输出有结果待核对');
  await expect(attention).not.toContainText('目前没有失败');
});

test('revoked telemetry clears stage, trends and prior counts', async ({ page, context }) => {
  await fixture(context);
  await page.clock.install();
  await page.goto('/platform-admin/#admin=engine');
  await expect(page.locator('.eng3d-core b')).toHaveText('23');
  await context.route('**/api/platform-admin/v1/engine-telemetry', (route) =>
    route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }),
  );
  await page.clock.runFor(3010);
  await expect(page.locator('.engine-dash-failure')).toBeVisible();
  await expect(page.locator('.eng3d, .engine-dash-lower')).toHaveCount(0);
});

test('WebGL unavailable keeps actual readings and keyboard details accessible', async ({ page, context }) => {
  await fixture(context);
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind: string, ...args: unknown[]) {
      if (kind === 'webgl2') return null;
      return (get as Function).call(this, kind, ...args);
    } as typeof get;
  });
  await page.goto('/platform-admin/#admin=engine');
  await expect(page.locator('.eng3d')).toHaveAttribute('data-webgl', 'off');
  await expect(page.locator('.eng3d-nogl')).toBeVisible();
  await expect(page.locator('.eng3d-core b')).toHaveText('23');
  await page.keyboard.press('2');
  await expect(page.getByRole('complementary', { name: '处理详情' })).toContainText('6 项执行中');
});

test('异常明细保留待核对来源并按企业展示治理问题', async ({ page, context }) => {
  await fixture(context);
  const requests: string[] = [];
  await context.route('**/api/platform-admin/v1/engine-telemetry/attention?**', async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      json: {
        total: 1,
        offset: 0,
        hasMore: false,
        tenants: [{ id: tenantId(1), name: '合成企业甲' }],
        items: [
          {
            id: tenantId(8),
            tenantId: tenantId(1),
            tenantName: '合成企业甲',
            channel: 'TASK',
            state: 'RESULT_UNKNOWN',
            title: '自动画报任务',
            code: 'TASK_RESULT_UNKNOWN',
            note: '',
            at: '2026-10-14T08:00:00Z',
            sources: [
              {
                kind: 'DATASET',
                id: tenantId(9),
                name: '寄养记录',
                version: '快照 V1',
                relationship: '任务已读取 · 尝试 1',
                current: false,
              },
            ],
          },
        ],
      },
    });
  });
  await context.route('**/scene/dispatch?**', async (route) => {
    const detail = new URL(route.request().url()).searchParams.get('path')?.endsWith('/boarding');
    await route.fulfill({
      json: detail
        ? {
            asset: { version: 2, policyVersion: 1, actions: ['recheck'] },
            findings: [
              {
                id: 'finding',
                title: '关联未匹配记录',
                detail: '666/1000 条寄养记录没有对应消费记录，需业务核对。',
                count: 666,
                status: 'open',
              },
            ],
          }
        : {
            items: [
              { id: 'boarding', title: '寄养记录', version: 2, label: '1 项治理问题', needsAttention: true },
            ],
          },
    });
  });
  const retries: Record<string, unknown>[] = [];
  await context.route('**/api/platform-admin/v1/engine-telemetry/attention/retry', async (route) => {
    retries.push(route.request().postDataJSON());
    if (retries.length === 1)
      await route.fulfill({
        status: 409,
        json: { contractVersion: '1.0', code: 'TASK_RECONCILIATION_REQUIRED' },
      });
    else await route.fulfill({ json: { id: tenantId(10), state: 'QUEUED', message: '已提交引擎处理。' } });
  });
  await page.goto('/platform-admin/#admin=engine');
  await page.getByText('查看异常与待核对数据', { exact: true }).click();
  await expect(page.getByText('自动画报任务 · 待核对', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '核对并重试', exact: true }).click();
  await expect(page.locator('.engine-retry-action').getByRole('status')).toContainText('暂未重新执行');
  await page.getByRole('button', { name: '核对并重试', exact: true }).click();
  await expect(page.locator('.engine-retry-action').getByRole('status')).toContainText('已提交引擎处理');
  await expect(page.getByRole('button', { name: '已提交 / 已核对', exact: true })).toBeDisabled();
  expect(retries).toHaveLength(2);
  expect(retries[0]).toMatchObject({
    tenantId: tenantId(1),
    id: tenantId(8),
    channel: 'TASK',
    expectedState: 'RESULT_UNKNOWN',
  });
  expect(retries[0].requestId).toBe(retries[1].requestId);
  await page.getByText('涉及数据：1 条来源版本记录', { exact: true }).click();
  await expect(
    page.getByText('快照 V1 · 任务已读取 · 尝试 1 · 历史版本或已撤下', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('异常所属企业').selectOption(tenantId(1));
  await page.getByLabel('异常状态').selectOption('UNKNOWN');
  await expect
    .poll(() => requests.some((u) => u.includes('state=UNKNOWN') && u.includes('tenant=' + tenantId(1))))
    .toBeTruthy();
  await page.getByText('该企业的数据治理待核对项', { exact: true }).click();
  await page.getByText('寄养记录 · V2 · 1 项治理问题', { exact: true }).click();
  await expect(
    page.getByText('666/1000 条寄养记录没有对应消费记录，需业务核对。', { exact: true }),
  ).toBeVisible();
});
