import { test, expect, type Page } from '@playwright/test';
const tenant = '00000000-0000-4000-8000-000000000001',
  actor = '00000000-0000-4000-8000-000000000002';
const asset = {
  id: 'dataset-00000000-0000-4000-8000-000000000003',
  title: '合成服务预约',
  department: '合成服务空间',
  kind: 'table',
  sourceKind: 0,
  source: '企业业务数据',
  status: 'ready',
  label: '来源快照已保存',
  gate: 4,
  available: true,
  needsAttention: false,
  checksPassed: false,
  paused: false,
  version: 1,
  policyVersion: 0,
  updatedAt: '2026-10-19T00:00:00Z',
  reviewAt: null,
  quality: 0,
  classification: 0,
  issues: [],
  tags: [],
  total: 41,
  ready: 41,
  isolated: 0,
  fieldCount: 2,
  dictionaryStatus: 'waiting',
  actions: [],
  tone: 'plain',
  updatePolicy: '来源版本',
  sync: null,
  stageStates: ['READY', 'READY', 'WAITING', 'READY', 'READY'],
};
async function fixture(page: Page, items: unknown[] = [asset]) {
  let failure = 0;
  const seen: string[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    const reply = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (path === '/api/v1/me')
      return reply({
        account: { id: actor, email: 'synthetic@example.test', displayName: '合成人员' },
        platformAdmin: false,
        memberships: [{ tenantId: tenant, tenantName: '合成企业', role: 'TENANT_ADMIN' }],
      });
    if (path.endsWith('/csrf')) return reply({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' });
    if (path.endsWith('/governance'))
      return reply({
        tenantId: tenant,
        ownerId: actor,
        revision: 0,
        owner: true,
        canConfigure: true,
        canEnterManagement: true,
        canAcceptInitialResponsibility: false,
        pendingHandover: null,
        capabilities: [],
      });
    if (path.endsWith('/scene/dispatch')) {
      const operation = url.searchParams.get('path');
      if (operation === '/scene-foundation')
        return reply({
          at: '2026-10-19T00:00:00Z',
          user: { name: '合成人员', role: 'admin' },
          tenant: { name: '合成企业' },
          model: { configured: false, enabled: false, model: '' },
          items,
          passed: [1, 1, 0, 1, 1],
          sources: [
            { name: '外部数据集', count: 1 },
            { name: '内部资料库', count: 0 },
            { name: '外网数据集', count: 0 },
          ],
          auditValid: true,
          governance: {
            attention: 0,
            isolated: 0,
            overdue: 0,
            failed: 0,
            averageQuality: null,
            departments: [],
          },
          canScan: false,
        });
      if (operation === '/scene-foundation/' + asset.id)
        return reply({
          asset,
          analysis: null,
          dictionary: null,
          audit: [],
          events: [],
          batches: [],
          findings: [],
        });
    }
    if (path.endsWith('/processing')) {
      seen.push(url.searchParams.get('revision') || 'first');
      if (failure)
        return reply({ contractVersion: '1.0', code: failure === 409 ? 'FOUNDATION_VERSION_CHANGED' : 'ACCESS_DENIED' }, failure);
      const offset = Number(url.searchParams.get('offset'));
      return reply({
        assetId: asset.id,
        name: asset.title,
        version: 1,
        revision: 'source-r1',
        recordKind: 'DATASET_ROWS',
        recordCount: 41,
        fields: [
          {
            name: '预约号',
            type: 'TEXT',
            meaning: '来源预约编号',
            unit: '',
            origin: 'SOURCE_COLUMN',
            evidence: '合成来源字典',
          },
          {
            name: '服务类型',
            type: 'TEXT',
            meaning: '预约服务分类',
            unit: '',
            origin: 'SOURCE_COLUMN',
            evidence: '合成来源字典',
          },
        ],
        records: Array.from({ length: Math.min(20, 41 - offset) }, (_, i) => [
          'S' + String(offset + i + 1).padStart(3, '0'),
          '美容',
        ]),
        offset,
        hasMore: offset < 40,
        stages: [
          {
            key: 'structure',
            name: '解析与结构化',
            state: 'READY',
            at: '2026-10-19T00:00:00Z',
            detail: '按来源列保存，没有推测新列',
            outputs: ['41 条记录', '2 个来源字段'],
            fields: ['预约号', '服务类型'],
          },
        ],
        history: [
          {
            id: 'run-1',
            stage: '数据采集',
            state: 'SUCCEEDED',
            createdAt: '2026-10-18T23:59:00Z',
            finishedAt: '2026-10-19T00:00:00Z',
            detail: '快照 v1 · 41 条记录',
          },
        ],
        notes: ['字段来自来源表头。'],
      });
    }
    return reply({ code: 'UNAVAILABLE' }, 404);
  });
  await page.goto(`/tenant-admin/prototype/?tenant=${tenant}`);
  await expect(page.getByRole('tab', { name: /^全部\d+$/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: /^解析/ }).click();
  return {
    fail: (status: number) => {
      failure = status;
    },
    seen,
  };
}
test('显示字段、真实分页、阶段产物和批次，版本变化不拼接旧记录', async ({ page }) => {
  const state = await fixture(page);
  const result = page.getByRole('region', { name: '结构化处理结果' });
  await expect(result.getByText('来源预约编号', { exact: true })).toBeVisible();
  await expect(result.getByText('S001', { exact: true })).toBeVisible();
  await expect(result.getByText('快照 v1 · 41 条记录', { exact: true })).toBeVisible();
  await result.getByRole('button', { name: '下一页记录' }).click();
  await expect(result.getByText('S021', { exact: true })).toBeVisible();
  expect(state.seen).toEqual(['first', 'source-r1']);
  state.fail(409);
  await result.getByRole('button', { name: '下一页记录' }).click();
  await expect(result.getByRole('alert')).toContainText('来源版本或解析结果已变化');
  await expect(result.getByText('S021', { exact: true })).toHaveCount(0);
});
test('撤权刷新后清除已显示记录', async ({ page }) => {
  const state = await fixture(page);
  const result = page.getByRole('region', { name: '结构化处理结果' });
  await expect(result.getByText('S001', { exact: true })).toBeVisible();
  state.fail(403);
  await result.getByRole('button', { name: '刷新处理结果' }).click();
  await expect(result.getByRole('alert')).toContainText('没有此来源的读取权限');
  await expect(result.getByText('S001', { exact: true })).toHaveCount(0);
});
test('来源统计仅汇总显示，列表进度按实际阶段点亮并与详情一致', async ({ page }) => {
  await fixture(page);
  await expect(page.locator('.src-gates')).toHaveCount(1);
  await expect(page.locator('.src').filter({ has: page.locator('.src-gates') }).locator('.src-name')).toHaveText('全部来源');
  const bars = page.locator('.live-select .stages i');
  const states = ['done', 'done', 'wait', 'done', 'done'];
  for (const [i, state] of states.entries()) {
    await expect(bars.nth(i)).toHaveAttribute('data-state', state);
    await expect(page.locator('.pipeline > li').nth(i)).toHaveAttribute('data-state', state);
  }
  const colors = await bars.evaluateAll(elements => elements.map(el => getComputedStyle(el).backgroundColor));
  expect(colors[0]).not.toEqual(colors[2]);
  expect(colors[4]).toEqual(colors[0]);
});
test('默认显示全部，治理状态筛选与定时取数分开，列表无场景引线', async ({ page }) => {
  await fixture(page, [asset,
    { ...asset, id: 'pending', title: '待治理资产', available: false, needsAttention: true, stageStates: ['READY', 'READY', 'WAITING', 'ATTENTION', 'WAITING'] },
    { ...asset, id: 'processing', title: '正在解析资产', available: false, stageStates: ['READY', 'RUNNING', 'WAITING', 'WAITING', 'WAITING'] },
    { ...asset, id: 'scheduled', title: '定时就绪资产', sync: { state: 'idle', enabled: true, intervalMinutes: 60 }, stageStates: ['READY', 'READY', 'READY', 'READY', 'READY'] },
  ]);
  const tabs = page.getByRole('tablist', { name: '治理状态' });
  await expect(tabs.getByRole('tab')).toHaveText(['全部4', '需处理1', '处理中1', 'AI 可用2']);
  await expect(tabs.getByRole('tab', { name: '全部4', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.live-select')).toHaveCount(4);
  await tabs.getByRole('tab', { name: '需处理1', exact: true }).click();
  await expect(page.locator('.live-select')).toHaveCount(1);
  await expect(page.locator('.live-select')).toContainText('待治理资产');
  await tabs.getByRole('tab', { name: '处理中1', exact: true }).click();
  await expect(page.locator('.live-select')).toHaveCount(1);
  await expect(page.locator('.live-select')).toContainText('正在解析资产');
  await tabs.getByRole('tab', { name: 'AI 可用2', exact: true }).click();
  await expect(page.locator('.live-select')).toHaveCount(2);
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.getByLabel('取数方式', { exact: true }).selectOption('scheduled');
  await expect(page.locator('.live-select')).toHaveCount(1);
  await expect(page.locator('.live-select')).toContainText('定时就绪资产');
  await expect(page.locator('.world-leader')).toHaveCount(0);
});
test('同系统的多个导入批次可一起折叠，其他来源独立显示', async ({ page }) => {
  await fixture(page, [
    { ...asset, source: 'local-9pop-payslips-20261015 / payslips_lx' },
    { ...asset, id: 'dividend', title: '分红数据', source: 'local-9pop-dividend_periods-20261015 / dividend_periods_lx' },
    { ...asset, id: 'orders', title: '订单数据', source: '首批三表本地快照20261019 / full_orders_lx' },
    { ...asset, id: 'other', title: '另一系统数据', source: '另一管理系统 / records' },
  ]);
  const group = page.getByRole('button', { name: /^9POP 管理系统\s*3$/ });
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.live-select')).toHaveCount(4);
  await group.click();
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.live-select')).toHaveCount(1);
  await expect(page.locator('.live-select')).toContainText('另一系统数据');
  await expect(page.locator('.card.asset h2')).toContainText(asset.title);
  await group.click();
  await expect(page.locator('.live-select')).toHaveCount(4);
});
test('企业名称融入场景，宽屏右上、窄屏标题下方', async ({ page }) => {
  await fixture(page);
  const name = page.locator('.shell-enterprise-name');
  await expect(name).toHaveText('合成企业');
  const desktop = await name.boundingBox();
  expect(desktop!.x).toBeGreaterThan(1100);
  await page.setViewportSize({ width: 1000, height: 852 });
  const narrow = await name.boundingBox();
  const title = await page.locator('.shell-strip h1').boundingBox();
  expect(narrow!.x).toBe(62);
  expect(narrow!.y).toBeGreaterThan(title!.y);
  await expect(page.getByRole('combobox', { name: '切换企业' })).toHaveCount(0);
});
test('动画只显示三个治理阶段，数量统计当前停留资产', async ({ page }) => {
  await fixture(page, [asset,
    { ...asset, id: 'parsing', gate: 1, available: false, title: '解析中' },
    { ...asset, id: 'annotation', gate: 2, available: false, title: '待标注' },
    { ...asset, id: 'checking', gate: 3, available: false, title: '待检查' },
    { ...asset, id: 'checking-two', gate: 3, available: false, title: '检查异常' },
  ]);
  const labels = page.locator('.world-labels');
  await expect(labels.locator('.gate')).toHaveCount(3);
  await expect(labels.locator('.gate').filter({hasText:'解析'})).toHaveText('1解析');
  await expect(labels.locator('.gate').filter({hasText:'口径标注'})).toHaveText('1口径标注');
  await expect(labels.locator('.gate').filter({hasText:'检查'})).toHaveText('2检查');
  await expect(labels.locator('.stage')).toHaveCount(0);
});
test('已可用资产不重复计入动画治理环节', async ({ page }) => {
  await fixture(page);
  await expect(page.locator('.world-labels .gate')).toHaveText(['0解析', '0口径标注', '0检查']);
});
