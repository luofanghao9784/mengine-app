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
async function fixture(page: Page, items: unknown[] = [asset], auditValid: boolean | null = true) {
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
          auditValid,
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
          asset: items.find(x => (x as typeof asset).id === asset.id) || asset,
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
            detail: '快照 第 1 版 · 41 条记录',
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
  // Lift the normal scene sheet before interacting with pagination below the fold.
  await page.mouse.move(1400, 300);
  await page.mouse.wheel(0, 900);
  const result = page.getByRole('region', { name: '结构化处理结果' });
  await expect(result.getByText('来源预约编号', { exact: true })).toBeVisible();
  await expect(result.getByText('S001', { exact: true })).toBeVisible();
  await expect(result.getByText('快照 第 1 版 · 41 条记录', { exact: true })).toBeVisible();
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

test('未核验审计不显示异常，已失败审计仍保留警示', async ({ page }) => {
  await fixture(page, [asset], null);
  await expect(page.locator('.updated')).toContainText('审计未核验');
  await expect(page.locator('.updated')).not.toContainText('审计异常');
  await page.unroute('**/api/**');
  await fixture(page, [asset], false);
  await expect(page.locator('.updated')).toContainText('审计异常');
});

test('不同连接按来源名称分组，保留业务表名', async ({ page }) => {
  await fixture(page, [{ ...asset, source: '合成租赁系统' }, {
    ...asset, id: 'dataset-00000000-0000-4000-8000-000000000004', title: '合成房东合同', source: '合成合同系统',
  }]);
  await expect(page.getByRole('button', { name: '合成租赁系统 1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '合成合同系统 1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /合成服务预约 来源快照已保存/ })).toBeVisible();
});

async function refreshVisibleSnapshot(page: Page, operation: string, status: number) {
  const refreshed = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/scene/dispatch') &&
      url.searchParams.get('path') === operation && response.status() === status;
  });
  // Exercise the same refresh path used when a user returns to a visible tab.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await refreshed;
}

test('资产权限快照：503保留已读列表和详情，403清除全部旧内容', async ({ page }) => {
  await fixture(page);
  await expect(page.getByText('S001', { exact: true })).toBeVisible();
  let status = 503;
  await page.route('**/scene/dispatch?path=%2Fscene-foundation', (route) => route.fulfill({
    status,
    json: { code: status === 503 ? 'SCENE_UPSTREAM_UNAVAILABLE' : 'SCENE_OPERATION_FORBIDDEN' },
  }));

  await refreshVisibleSnapshot(page, '/scene-foundation', 503);
  await expect(page.getByRole('alert')).toContainText('数据服务连接失败');
  await expect(page.locator('.live-select').filter({ hasText: asset.title })).toHaveCount(1);
  await expect(page.getByText('S001', { exact: true })).toBeVisible();

  status = 403;
  await refreshVisibleSnapshot(page, '/scene-foundation', 403);
  await expect(page.getByText(asset.title, { exact: true })).toHaveCount(0);
  await expect(page.getByText('S001', { exact: true })).toHaveCount(0);
  await expect(page.locator('.live-select')).toHaveCount(0);
});

for (const denied of [401, 403]) {
  test(`知识权限快照：503保留已读内容，${denied}清除列表和详情`, async ({ page }) => {
    await fixture(page);
    const item = {
      id: 'synthetic-private-knowledge', name: '合成受限知识', group: '资料知识',
      why: '合成受限摘要', side: '合成空间', tone: 'ok', verdict: '合成验证结论',
      kvHead: ['项目', '内容', '状态'], kv: [['规则', '合成受限知识正文', '已核验']], actions: [],
    };
    let status = 200;
    await page.route('**/scene/dispatch?path=%2Fscene-knowledge', (route) => route.fulfill({
      status,
      json: status !== 200
        ? { code: status === 503 ? 'SCENE_UPSTREAM_UNAVAILABLE' : 'SCENE_OPERATION_FORBIDDEN' }
        : {
            items: [item], relations: [], sourceKind: { [item.id]: 1 },
            tabs: [{ label: '全部 1', items: [item] }],
            stats: { title: '知识构成', rows: [] }, aside: { title: '最近入库', rows: [] },
            pending: 0, failed: 0, busy: false, available: false, needsGraph: false,
            scopeRevision: 'synthetic-scope-1', status: '已读取合成知识',
          },
    }));
    await page.locator('.shell-switch').getByRole('button', { name: '知识星链', exact: true }).click();
    const row = page.locator('.card.list .row').filter({ hasText: item.name });
    await expect(row).toHaveCount(1);
    await expect(page.getByText('合成受限知识正文', { exact: true })).toBeVisible();

    status = 503;
    await refreshVisibleSnapshot(page, '/scene-knowledge', 503);
    await expect(page.locator('.card.detail .verdict')).toContainText('数据服务连接失败');
    await expect(row).toHaveCount(1);
    await expect(page.getByText('合成受限知识正文', { exact: true })).toBeVisible();

    status = denied;
    await refreshVisibleSnapshot(page, '/scene-knowledge', denied);
    await expect(row).toHaveCount(0);
    await expect(page.getByText(item.name, { exact: true })).toHaveCount(0);
    await expect(page.getByText('合成受限知识正文', { exact: true })).toHaveCount(0);
  });
}

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
  await expect.poll(async () => (await page.locator('.world-labels .gate').allTextContents()).sort()).toEqual(['0解析', '0口径标注', '0检查'].sort());
});
test('原生治理明确提示缺少企业背景，不显示可执行按钮', async ({ page }) => {
  const blocked = { ...asset, available: false, gate: 2, stageStates: ['READY', 'READY', 'WAITING', 'WAITING', 'WAITING'],
    nativeGovernance: { state: 'BACKGROUND_REQUIRED', message: '尚未开始：请先在企业信息登记企业背景', canRun: false } };
  await fixture(page, [blocked]);
  await page.getByRole('tab', { name: /^口径标注/ }).click();
  const panel = page.getByRole('region', { name: '本表治理处理' });
  await expect(panel).toContainText('请先在企业信息登记企业背景');
  await expect(panel.getByRole('button', { name: '完善企业背景' })).toBeVisible();
  await expect(panel.getByRole('button', { name: '生成治理草稿' })).toHaveCount(0);
});
test('发布治理但未核验记录质量时显示未知，不伪造可用行数', async ({ page }) => {
  await fixture(page, [{ ...asset, ready: null, quality: null, isolated: null,
    stageStates: ['READY', 'READY', 'PARTIAL', 'ATTENTION', 'READY'],
    nativeGovernance: { state: 'PUBLISHED', message: '治理结果已发布，仍有待核实项', canRun: true } }]);
  await expect(page.locator('.head-nums dd')).toHaveText(['41', '—', '—', '—']);
  await expect(page.getByRole('tab', { name: 'AI 可用 按已发布口径使用', exact: true })).toBeVisible();
  await expect(page.locator('.card.asset')).not.toContainText('null 条可用');
  await page.getByRole('tab', { name: 'AI 可用 按已发布口径使用', exact: true }).click();
  await expect(page.locator('.card.asset')).toContainText('按已发布口径查询（合格记录数未核验）');
  await expect(page.locator('.card.asset')).not.toContainText('null 条合格记录');
});
test('原生治理生成草稿后必须核对再显式发布', async ({ page }) => {
  const native = { ...asset, available: false, gate: 2, stageStates: ['READY', 'READY', 'WAITING', 'WAITING', 'WAITING'],
    nativeGovernance: { state: 'NOT_STARTED', message: '尚未开始口径治理', canRun: true, jobId: '', revision: 1 } };
  await fixture(page, [native]);
  let publishes = 0;
  await page.route('**/governance-jobs**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/execute')) {
      expect(route.request().postDataJSON()).toMatchObject({ kind: 'DATASET', executor: 'SYSTEM_MODEL', sourceId: asset.id.slice(8) });
      native.nativeGovernance = { state: 'DRAFT_READY', message: '治理草稿已生成，待核对并发布', canRun: true, jobId: 'synthetic-job', revision: 2 };
      native.gate = 3; native.stageStates = ['READY', 'READY', 'READY', 'PARTIAL', 'WAITING'];
      return route.fulfill({ json: {} });
    }
    if (path.endsWith('/publish')) {
      publishes++; expect(route.request().postDataJSON()).toEqual({ revision: 2, inputHash: 'synthetic-hash' });
      native.available = true; native.gate = 4;
      native.nativeGovernance.state = 'PUBLISHED';native.nativeGovernance.message = '治理结果已发布';
      native.stageStates = ['READY', 'READY', 'READY', 'READY', 'READY'];
      return route.fulfill({ json: {} });
    }
    return route.fulfill({ json: { revision: 2, sourceCurrent: true, request: { inputHash: 'synthetic-hash' },
      output: { summary: '合成检查，仅元数据', limitations: ['金额单位未知'], fields: [{ column: '编号', decision: 'UNKNOWN', meaning: '待核实', unit: '', evidence: '缺少依据' }] } } });
  });
  await page.getByRole('tab', { name: /^口径标注/ }).click();
  await page.getByRole('button', { name: '生成治理草稿' }).click();
  await expect(page.getByText('待发布的治理草稿', { exact: true })).toBeVisible();
  expect(publishes).toBe(0);
  await expect(page.getByRole('region', { name: '本表治理处理' })).toContainText('金额单位未知');
  // This prototype opens the card deck halfway down; use its normal scroll gesture to lift it.
  await page.mouse.move(1400, 300);
  await page.mouse.wheel(0, 900);
  await page.getByRole('button', { name: '核对后发布治理结果' }).click();
  await expect(page.getByRole('region', { name: '本表治理处理' })).toContainText('治理结果已发布');
  expect(publishes).toBe(1);
});

test('数据底座字段、来源、版本与部署审计只显示人话', async ({ page }) => {
  await fixture(page);
  const copyAsset = { ...asset, title: 'synth_demo.sqlite 字段说明 v1', tags: ['internal_material', 'FUTURE_CATEGORY'] };
  await page.route('**/scene/dispatch?**', route => {
    const path = new URL(route.request().url()).searchParams.get('path');
    if (path === '/scene-foundation') return route.fulfill({ json: {
      at: '2026-10-31T00:00:00Z', user: { name: '张三', role: 'admin' }, tenant: { name: '合成企业' },
      model: { configured: false, enabled: false, model: '' }, items: [copyAsset], passed: [1, 1, 1, 1, 1],
      sources: [{ name: '外部数据集', count: 1 }], auditValid: true,
      governance: { attention: 0, isolated: 0, overdue: 0, failed: 0, averageQuality: null, departments: [] }, canScan: false,
    } });
    if (path === '/scene-foundation/' + asset.id) return route.fulfill({ json: {
      asset: copyAsset, analysis: null, findings: [], events: [], batches: [],
      dictionary: { current: true, revision: 2, at: '2026-10-31T00:00:00Z', provider: 'Codex-CT027-B', tableMeaning: '线索口径', usageRules: '合成演示', warnings: [], job: null,
        fields: [{ name: 'funnel_stage', label: '业务阶段标题', type: 'text', meaning: '线索所在阶段', unit: '', required: false, sensitive: false, rules: '', evidence: 'synth_demo.sqlite 字段说明 v1' },
          { name: 'future_column', label: '', type: 'future_type', meaning: '待核实', unit: '', required: false, sensitive: false, rules: '', evidence: '' }], relations: [] },
      audit: [{ at: '2026-10-31T00:00:00Z', actor: '张三（TENANT_ADMIN+owner）', action: 'deployment.governance.applied', detail: '部署 ct027-b-synth-demo-v1；全量检查 26 条；保留异常隔离' },
        { at: '2026-10-31T00:00:00Z', actor: 'SYSTEM', action: 'future.action', detail: '内部记录' }],
    } });
    return route.fallback();
  });
  await page.reload();
  await page.mouse.move(1400, 300);
  await page.mouse.wheel(0, 900);
  await expect(page.getByRole('heading', { name: '演示数据字段说明 · 第 1 版' })).toBeVisible();
  await page.getByRole('tab', { name: /^口径标注/ }).click();
  await expect(page.locator('.card.asset')).toContainText('总部整理');
  await expect(page.locator('.card.asset')).toContainText('业务阶段标题');
  await expect(page.locator('.card.asset')).toContainText('其他记录');
  await expect(page.locator('.card.asset')).not.toContainText('funnel_stage');
  await page.getByRole('tablist', { name: '治理流程' }).getByRole('tab', { name: /^AI 可用/ }).click();
  await expect(page.locator('.card.asset')).toContainText('张三（企业负责人） · 更新数据口径');
  await expect(page.locator('.card.asset')).toContainText('检查 26 条，异常记录已隔离');
  await expect(page.locator('.card.asset')).toContainText('系统 · 其他操作');
  await expect(page.locator('body')).not.toContainText(/ct027-b-synth-demo-v1|deployment\.governance\.applied|Codex-CT027-B|synth_demo\.sqlite|TENANT_ADMIN|future\.action/);
  await expect(page.locator('.step-body')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: 'test-results/data-copy-audit.png', fullPage: true, animations: 'disabled' });
});


test('知识来源中文化，部署编号整行隐藏，动态版次统一', async ({ page }) => {
  await fixture(page);
  const item = {
    id: 'copy-knowledge', name: '合成经营知识', group: '内部资料', why: '总部整理', side: '内部资料', tone: 'ok', verdict: '合成验证结论',
    kvHead: ['项目', '内容', '状态'], kv: [
      ['来源', 'Codex-CT027-B（部署治理）', '来源 v2 · 知识 v1', 'plain'],
      ['部署 ct027-b-synth-demo-v1', '不应显示的整段', '', 'plain'],
      ['部署', 'future-package-v2', '同样不应显示', 'plain'],
    ], actions: [],
  };
  await page.route('**/scene/dispatch?path=%2Fscene-knowledge', route => route.fulfill({ json: {
    items: [item], relations: [], sourceKind: { [item.id]: 1 }, tabs: [{ label: '全部 1', items: [item] }],
    stats: { title: '知识构成', rows: [] }, aside: { title: '最近入库', rows: [] }, pending: 0, failed: 0, busy: false,
    available: false, needsGraph: false, scopeRevision: 'synthetic-scope', status: '已读取合成知识',
  } }));
  await page.locator('.shell-switch').getByRole('button', { name: '知识星链', exact: true }).click();
  const detail = page.locator('.card.detail');
  await expect(detail.getByRole('cell', { name: '总部整理', exact: true })).toBeVisible();
  await expect(detail).toContainText('来源第 2 版 · 知识第 1 版');
  await expect(detail).not.toContainText(/Codex|ct027|future-package|不应显示|同样不应显示/);
  await page.screenshot({ path: 'test-results/data-copy-knowledge.png', fullPage: true });
});
