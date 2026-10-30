import { test, expect, type Page } from '@playwright/test';
import { telemetryChannels } from '../../contracts/public-api/engine-telemetry';
const tenant = '00000000-0000-4000-8000-000000000001',
  actor = '00000000-0000-4000-8000-000000000002';
async function fixture(page: Page) {
  const requests: string[] = [];
  let unavailable = false;
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url()),
      p = u.pathname;
    requests.push(p);
    const reply = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (p === '/api/v1/me')
      return reply({
        account: { id: actor, email: 'scene@example.test', displayName: '合成管理员' },
        platformAdmin: false,
        memberships: [{ tenantId: tenant, tenantName: '合成企业', role: 'TENANT_ADMIN' }],
      });
    if (p.endsWith('/csrf')) return reply({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' });
    if (p.endsWith('/governance'))
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
    if (p.endsWith('/engine-telemetry'))
      return reply(
        unavailable
          ? { code: 'UNAVAILABLE' }
          : {
              tenantId: tenant,
              checkedAt: new Date().toISOString(),
              recentSeconds: 300,
              evolution: 'NOT_CONNECTED',
              channels: telemetryChannels
                .filter((code) => code !== 'GENERAL_ADJUSTMENT')
                .map((code) => ({
                  code,
                  running: code === 'TASK' ? 2 : 0,
                  queued: 0,
                  waiting: 0,
                  failed: 0,
                  unknown: 0,
                  completedRecent: 0,
                  lastCompletedAt: null,
                })),
            },
        unavailable ? 503 : 200,
      );
    if (p.endsWith('/usage'))
      return reply({
        tenantId: tenant,
        period: u.searchParams.get('period'),
        timeZone: 'Asia/Shanghai',
        from: '2026-10-01T00:00:00+08:00',
        until: '2026-10-15T12:00:00+08:00',
        checkedAt: '2026-10-15T12:00:00+08:00',
        groups: [],
        days: [
          {
            date: '2026-10-14',
            workRequests: 7,
            maintenanceCalls: 0,
            unknownMaintenanceRuns: 0,
            inputTokens: 0,
            outputTokens: 0,
          },
        ],
        tools: [],
        storage: { originals: 0, versions: 0, registeredBytes: 0 },
        coverage: {
          unmeteredWorkAttempts: 0,
          legacyToolReceipts: 0,
          evaluation: 'NOT_CONNECTED',
          evolution: 'NOT_ENABLED',
        },
        quota: { state: 'NOT_CONFIGURED', unit: null, limit: null, remaining: null },
      });
    if (p.endsWith('/scene/dispatch')) {
      const path = u.searchParams.get('path');
      if (path === '/scene-foundation')
        return reply({
          at: new Date().toISOString(),
          user: { name: '合成管理员', role: 'admin' },
          tenant: { name: '合成企业' },
          model: { configured: false, enabled: false, model: '' },
          items: [],
          passed: [0, 0, 0, 0, 0],
          sources: [
            { name: '外部数据集', count: 0 },
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
      if (path === '/scene-knowledge')
        return reply({
          items: [],
          relations: [],
          sourceKind: {},
          tabs: [],
          stats: { title: '知识构成', rows: [] },
          aside: { title: '最近入库', rows: [] },
          pending: 0,
          failed: 0,
          busy: false,
          available: false,
          needsGraph: false,
          scopeRevision: '1',
          status: '尚无可用知识',
        });
      if (path === '/scene-access')
        return reply({
          user: {
            id: actor,
            name: '合成管理员',
            role: 'admin',
            clearance: 3,
            active: true,
            tenantId: tenant,
            departmentId: '',
          },
          members: [],
          roles: { admin: '企业管理员' },
          departments: [],
          connections: [],
          resources: [],
          proposals: [],
          pending: 0,
          canViewAudit: true,
        });
    }
    return reply({ code: 'UNAVAILABLE' }, 404);
  });
  return {
    requests,
    fail: () => {
      unavailable = true;
    },
  };
}
test('新版设计读取真实接口，不把模拟遥测和统计放进企业页面', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const f = await fixture(page);
  await page.goto(`/tenant-admin/prototype/?tenant=${tenant}`);
  const nav = page.getByRole('navigation', { name: '主导航' });
  // The scene has one active main menu; scope avoids stage labels.
  await page
    .locator('.shell-switch button')
    .filter({ hasText: /^引擎概览$/ })
    .click();
  await expect(page.getByText('7 次工作请求 · 本月')).toBeVisible();
  await expect(page.getByText('8,584', { exact: false })).toHaveCount(0);
  await expect(page.getByText('执行中 2 · 排队 0', { exact: false })).toBeVisible();
  f.fail();
  await expect(page.locator('.runtime-notice')).toContainText('运行状态暂不可用', { timeout: 10000 });
  await expect(page.getByText('执行中 2 · 排队 0', { exact: false })).toHaveCount(0);
  await page.screenshot({ path: '.local/integration-20261015/scene-home.png' });
  expect(errors).toEqual([]);
  expect(f.requests.some((p) => p.endsWith('/engine-telemetry'))).toBeTruthy();
});
test('业务页保留运行用量与权限入口，暂时隐藏输出', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const f = await fixture(page);
  await page.goto(`/tenant-admin/prototype/?tenant=${tenant}`);
  await page
    .locator('.shell-switch button')
    .filter({ hasText: /^成员与权限$/ })
    .click();
  await expect(page.getByRole('button', { name: /^数据访问/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^成员与协作/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^成员与协作/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^数据访问/, exact: true }).click();
  await expect(page.getByRole('button', { name: '资源权限', exact: true })).toBeVisible();
  await page
    .locator('.shell-switch button')
    .filter({ hasText: /^用量与运行$/ })
    .click();
  await expect.poll(() => f.requests.some((p) => p.endsWith('/usage'))).toBeTruthy();
  await expect(page.locator('.scene-business-body')).toBeVisible();
  await page.screenshot({ path: '.local/integration-20261015/scene-usage.png' });
  await expect(page.locator('.shell-switch button').filter({ hasText: /^输出$/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('直接访问其他企业的场景不读取业务数据', async ({ page }) => {
  const f = await fixture(page);
  await page.goto('/tenant-admin/prototype/?tenant=00000000-0000-4000-8000-000000000099');
  await expect(page.getByText('没有该企业的访问权限')).toBeVisible();
  expect(f.requests.filter((p) => p.includes('scene/dispatch'))).toEqual([]);
});

test('企业舞台的用量下钻留在当前企业场景', async ({ page }) => {
  const f = await fixture(page);
  await page.goto(`/tenant-admin/prototype/?tenant=${tenant}`);
  await page
    .locator('.shell-switch button')
    .filter({ hasText: /^引擎概览$/ })
    .click();
  await page.locator('.eng3d-lbl[data-channel="RESPONSE"]').dispatchEvent('click');
  await page.getByRole('link', { name: '查看运行与用量', exact: true }).dispatchEvent('click');
  await expect(page.locator('.shell')).toHaveAttribute('data-place', 'usage');
  await expect(page.locator('.scene-business-body')).toBeVisible();
  expect(f.requests.some((p) => p.startsWith('/api/platform-admin/'))).toBe(false);
});

async function accessFixture(page: Page, admin = true) {
  await fixture(page);
  const writes: { path: string; body: any }[] = [];
  let conflict = false, unavailable = false;
  const state = {
    user: { id: actor, name: '合成测试成员', role: admin ? 'admin' : 'member', clearance: admin ? 3 : 0, active: true, tenantId: tenant, departmentId: 'dept-1' },
    members: [], roles: { admin: '企业管理员', member: '岗位成员' },
    departments: [{ id: 'dept-1', name: '研发部', active: 1 }], connections: [],
    resources: [{ id: 'resource-1', title: '合成业务资料', version: 2, policyVersion: 3, classification: 0, audience: 'private', status: 'ready', canManagePolicy: admin, canInspect: false, canRead: true, grants: [] }],
    proposals: [], pending: 0, canViewAudit: admin,
  };
  await page.route('**/scene/dispatch?*', async route => {
    const path = new URL(route.request().url()).searchParams.get('path')!;
    if (!path.startsWith('/scene-access')) return route.fallback();
    if (route.request().method() === 'GET') return route.fulfill({ status: unavailable ? 503 : 200, json: unavailable ? { message: '合成权限服务不可用' } : state });
    const body = route.request().postDataJSON(); writes.push({ path, body });
    if (conflict) { conflict = false; state.resources[0].policyVersion++; return route.fulfill({ status: 409, json: { message: '权限版本已变化，请刷新后重新提交' } }); }
    if (path === '/scene-access/policy') {
      if (admin) { state.resources[0].policyVersion++; state.resources[0].audience = body.patch.audience; }
      return route.fulfill({ json: { status: admin ? 'applied' : 'pending' } });
    }
    if (path === '/scene-access/departments') state.departments[0].name = body.name;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto(`/tenant-admin/prototype/?tenant=${tenant}`);
  await page.locator('.shell-switch button').filter({ hasText: /^成员与权限$/ }).click();
  await page.getByRole('button', { name: /^数据访问/, exact: true }).click();
  await expect(page.getByLabel('变更原因')).toBeVisible();
  return { state, writes, conflict: () => { conflict = true; }, fail: () => { unavailable = true; } };
}

test('权限表单携带双版本，冲突后刷新，部门重命名使用稳定 ID', async ({ page }) => {
  const f = await accessFixture(page);
  await page.getByRole('combobox', { name: '访问范围', exact: true }).selectOption('organization');
  await page.getByLabel('变更原因').fill('跨部门业务协作');
  f.conflict();
  await page.getByRole('button', { name: '保存并生效', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('权限版本已变化');
  await expect(page.getByText('内容 v2 · 权限 v4', { exact: false })).toBeVisible();
  expect(f.writes[0].body).toMatchObject({ documentId: 'resource-1', documentVersion: 2, policyVersion: 3, patch: { audience: 'organization' } });
  await page.getByLabel('变更原因').fill('核对新版本后授权');
  await page.getByRole('button', { name: '保存并生效', exact: true }).click();
  await expect(page.getByText('操作已完成。')).toBeVisible();
  expect(f.writes[1].body.policyVersion).toBe(4);
  await page.getByRole('button', { name: '部门与成员', exact: true }).click();
  await page.getByLabel('部门名称 研发部').fill('研发中心');
  await page.getByRole('button', { name: '保存部门名称', exact: true }).click();
  await expect(page.getByLabel('部门名称 研发中心')).toBeVisible();
  expect(f.writes[2]).toEqual({ path: '/scene-access/departments', body: { id: 'dept-1', name: '研发中心' } });
});

test('普通成员仅申请读取权限，刷新失败立即清除可见资源', async ({ page }) => {
  const f = await accessFixture(page, false);
  await expect(page.getByRole('button', { name: '部门与成员', exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '资源密级', exact: true })).toBeDisabled();
  await page.getByLabel('变更原因').fill('业务协作申请');
  await page.getByRole('button', { name: '提交审批', exact: true }).click();
  await expect(page.getByText('申请已提交，生效前不会增加访问权限。')).toBeVisible();
  expect(f.writes[0].body.patch).not.toHaveProperty('classification');
  f.fail();
  await expect(page.getByText('合成权限服务不可用')).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('combobox', { name: '访问范围', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '提交审批', exact: true })).toHaveCount(0);
});

test('隔离检查权限撤回后清除正文，即使内容与权限版本未变', async ({ page }) => {
  const f = await accessFixture(page);
  f.state.resources[0].canInspect = true;
  f.state.resources[0].status = 'quarantined';
  f.state.resources[0].canRead = false;
  await page.route('**/scene/dispatch?*', async route => {
    const path = new URL(route.request().url()).searchParams.get('path');
    if (!path?.endsWith('/inspect')) return route.fallback();
    expect(route.request().postDataJSON().reason).toBe('授权质量检查');
    await route.fulfill({ json: { content: '仅用于隔离检查的合成正文' } });
  });
  // Remount to load changed fixture immediately; subsequent revocation uses real polling.
  await page.locator('.shell-switch button').filter({ hasText: /^数据底座$/ }).click();
  await page.locator('.shell-switch button').filter({ hasText: /^成员与权限$/ }).click();
  await page.getByRole('button', { name: /^数据访问/, exact: true }).click();
  await page.getByLabel('变更原因').fill('授权质量检查');
  await page.getByRole('button', { name: '按填写原因检查隔离内容' }).click();
  await expect(page.getByText('仅用于隔离检查的合成正文')).toBeVisible();
  f.state.resources[0].canInspect = false;
  await expect(page.getByRole('button', { name: '按填写原因检查隔离内容' })).toHaveCount(0, { timeout: 20000 });
  await expect(page.getByText('仅用于隔离检查的合成正文')).toHaveCount(0);
});

 test('服务未配置时说明处理人，账号空间入口不被数据服务阻断', async ({page}) => {
  await fixture(page);
  await page.route('**/scene/dispatch?*', route => route.fulfill({status:503,json:{code:'SCENE_NOT_CONFIGURED',message:'请求未完成，请检查输入或当前状态。'}}));
  await page.goto(`/tenant-admin/prototype/?tenant=${tenant}`);
  await page.locator('.shell-switch button').filter({hasText:/^成员与权限$/}).click();
  await expect(page.getByRole('button',{name:/^成员与协作/})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:/^数据访问/,exact:true}).click();
  await expect(page.getByRole('status')).toContainText('数据服务尚未配置，请由部署人员接通服务');
  await page.getByRole('button',{name:/^成员与协作/}).click();
  await expect(page.getByRole('button',{name:/^成员与协作/})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByText('数据服务尚未配置', {exact:false})).toHaveCount(0);
 });

test('新版背景来源、知识与方法状态衔接，维护留在新版且撤权清除内容', async ({ page }) => {
  await fixture(page);
  let revoked = false, changed = false;
  const entry = () => ({ id: actor, versionId: actor, revision: changed?2:1, field: 'BUSINESS', label: '合成租赁业务', meaning: '', origin: 'HUMAN', humanProtected: true, provenance: '人工维护', updatedAt: '2026-10-18T00:00:00Z' });
  await page.route('**/company-information/source', route => route.fulfill({status:revoked?403:200,json:revoked?{code:'TENANT_ACCESS_DENIED'}:{tenantId:tenant,sourceId:`company-background:${tenant}`,type:'COMPANY_BACKGROUND',state:'AVAILABLE',version:'a'.repeat(64),knowledgeIntegration:'REFERENCE_READY',entries:[entry()]}}));
  await page.route('**/company-information/source/knowledge', route => route.fulfill({status:revoked?403:200,json:revoked?{code:'TENANT_ACCESS_DENIED'}:{tenantId:tenant,mode:'STRUCTURED_REFERENCE',items:[{id:`background:${actor}`,sourceEntryId:actor,sourceVersionId:actor,revision:changed?2:1,field:'BUSINESS',title:'合成租赁业务',content:'只读合成背景',origin:'HUMAN',status:'REFERENCE_READY',methods:[{id:tenant,version:1,name:'合成收款汇总',status:changed?'REVIEW_REQUIRED':'REFERENCE_CURRENT'}]}]}}));
  await page.goto(`/tenant-admin/prototype/?tenant=${tenant}`);
  await page.locator('.shell-switch button').filter({hasText:/^数据底座$/}).click();
  await expect(page.getByRole('button',{name:'企业背景 · 内部来源 →'})).toHaveCount(0);
  await page.locator('.src-pick').filter({hasText:/^内部资料库/}).click();
  await expect(page.getByRole('button',{name:'企业背景来源'})).toContainText('1 项背景');
  await page.getByRole('button',{name:'企业背景来源'}).click();
  await page.mouse.move(1400, 300);
  await page.mouse.wheel(0, 900);
  const source=page.locator('.background-detail');
  await expect(source.getByText('可读取 1 条背景',{exact:false})).toBeVisible();
  await expect(source.getByRole('heading',{name:'企业背景参考',exact:true})).toBeVisible();
  await source.getByText('来源与关联指标',{exact:false}).click();
  await expect(source.getByText('合成收款汇总 · v1 · 背景依据有效')).toBeVisible();
  changed=true;
  await source.getByRole('button',{name:'刷新背景参考'}).click();
  await source.getByText('来源与关联指标',{exact:false}).click();
  await expect(source.getByText('背景已变化，需核对并发布新方法版本',{exact:false})).toBeVisible();
  await page.screenshot({path:'.local/background-integration-desktop.png'});
  await page.setViewportSize({width:980,height:800});
  await source.getByRole('button',{name:'维护企业背景 →'}).click();
  await expect(page.getByRole('region',{name:'企业信息',exact:true})).toBeVisible();
  await expect(page).toHaveURL(/#place=company/);
  expect(new URL(page.url()).searchParams.get('view')).not.toBe('business');
  await page.locator('.shell-switch button').filter({hasText:/^知识星链$/}).click();
  await expect(page.getByRole('tab',{name:'全部 0',exact:true})).toBeVisible();
  await expect(page.locator('.card.list .row')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'企业背景参考',exact:true})).toHaveCount(0);
  await page.screenshot({path:'.local/background-integration-knowledge.png'});
  revoked=true;
  await page.reload();
  await page.locator('.shell-switch button').filter({hasText:/^知识星链$/}).click();
  await expect(page.getByText('企业背景暂不可用，未计入知识数量。',{exact:false})).toBeVisible();
  await expect(page.getByRole('tab',{name:'全部 0',exact:true})).toBeVisible();
  await expect(page.getByText('只读合成背景')).toHaveCount(0);
});

test('四项背景作为来源参考，不计入已发布知识', async ({page}) => {
  await fixture(page);
  const fields = ['NAME','INDUSTRY','BUSINESS','TERM'];
  const items = fields.map((field,i)=>({id:`background:${i}`,sourceEntryId:actor,sourceVersionId:actor,revision:1,field,title:`合成背景${i}`,content:'合成内容',origin:'HUMAN',status:'REFERENCE_READY',methods:[]}));
  await page.route('**/company-information/source/knowledge', r=>r.fulfill({json:{tenantId:tenant,mode:'STRUCTURED_REFERENCE',items}}));
  await page.route('**/company-information/source', r=>r.fulfill({json:{tenantId:tenant,sourceId:`company-background:${tenant}`,type:'COMPANY_BACKGROUND',state:'AVAILABLE',version:'a'.repeat(64),knowledgeIntegration:'REFERENCE_READY',entries:fields.map((field,i)=>({id:`00000000-0000-4000-8000-00000000000${i+3}`,versionId:actor,revision:1,field,label:`合成背景${i}`,meaning:'',origin:'HUMAN',humanProtected:true,provenance:'人工维护',updatedAt:'2026-10-18T00:00:00Z'}))}}));
  await page.goto(`/tenant-admin/prototype/?tenant=${tenant}`);
  await page.locator('.shell-switch button').filter({hasText:/^知识星链$/}).click();
  await expect(page.getByRole('tab',{name:'全部 0',exact:true})).toBeVisible();
  await expect(page.locator('.card.list .row')).toHaveCount(0);
  await page.locator('.shell-switch button').filter({hasText:/^数据底座$/}).click();
  await page.locator('.src-pick').filter({hasText:/^内部资料库/}).click();
  await page.getByRole('button',{name:'企业背景来源'}).click();
  await page.mouse.move(1400, 300);
  await page.mouse.wheel(0, 900);
  await expect(page.getByRole('heading',{name:'企业背景参考',exact:true})).toBeVisible();
  await expect(page.getByText('治理上下文，未计入已发布知识',{exact:false})).toBeVisible();
  const categories = page.getByRole('group', {name:'背景分类'});
  await categories.getByRole('button', {name:'业务术语 1', exact:true}).click();
  await expect(page.locator('.background-reading-group article')).toHaveCount(1);
  await expect(page.locator('.background-reading-group')).toContainText('合成背景3');
  await categories.getByRole('button', {name:'全部 4', exact:true}).click();
  await expect(page.locator('.background-reading-group article')).toHaveCount(4);
});

test('知识星链标题等待镜头到位，快速往返后仍重新等待', async ({ page }) => {
  await fixture(page);
  await page.route('**/company-information/source/knowledge', r => r.fulfill({json: {
    tenantId: tenant, mode: 'STRUCTURED_REFERENCE', items: [{id: `background:${actor}`, sourceEntryId: actor,
      sourceVersionId: actor, revision: 1, field: 'BUSINESS', title: '合成背景', content: '合成内容',
      origin: 'HUMAN', status: 'REFERENCE_READY', methods: []}],
  }}));
  const processed={id:'processed-knowledge',name:'合成已处理知识',group:'资料知识',why:'完整处理后发布',side:'共享空间上传',sourceCategory:'SHARED_UPLOAD',tone:'plain',verdict:'合成已发布内容',kvHead:[],kv:[],actions:[]};
  await page.route('**/scene/dispatch?path=%2Fscene-knowledge', r=>r.fulfill({json:{items:[processed],relations:[],sourceKind:{'processed-knowledge':1},tabs:[{label:'全部 1',items:[processed]}],stats:{title:'知识构成',rows:[]},aside:{title:'最近入库',rows:[]},pending:0,failed:0,busy:false,available:true,needsGraph:false,scopeRevision:'processed',status:'1 条已发布知识'}}));
  await page.goto(`/tenant-admin/prototype/?tenant=${tenant}`);
  const data = page.locator('.shell-switch button').filter({hasText:/^数据底座$/});
  const knowledge = page.locator('.shell-switch button').filter({hasText:/^知识星链$/});
  const label = page.locator('.world-label.node').first();
  await data.click();
  await page.waitForTimeout(2500);
  await knowledge.click();
  await expect(label).toHaveClass(/arriving/);
  await expect(label).toHaveCSS('opacity', '0');
  await expect(label).not.toHaveClass(/arriving/, {timeout: 10000});
  await expect(label).toHaveCSS('opacity', '1');
  await data.click();
  await page.waitForTimeout(350);
  await knowledge.click();
  await expect(label).toHaveClass(/arriving/);
  await expect(label).not.toHaveClass(/arriving/, {timeout: 10000});
  await expect(label).toHaveCSS('opacity', '1');
});

test('知识列表按真实来源折叠，待处理来源不混入知识总数', async ({page}) => {
  await fixture(page);
  const items = [0, 1, 2].map(kind => ({id:`k${kind}`,name:`合成知识${kind}`, sourceCategory:['STRUCTURED','UNSTRUCTURED','SHARED_UPLOAD'][kind],group:'企业管理',why:'合成摘要',side:'企业管理',tone:'ok',verdict:'合成内容',kvHead:[],kv:[],actions:[]}));
  const pending = {...items[0], id:'pending',name:'合成待整理资料',tone:'warn'};
  await page.route('**/scene/dispatch?path=%2Fscene-knowledge', r => r.fulfill({json:{items, relations:[], sourceKind:{k0:0,k1:1,k2:2},
    tabs:[{label:'全部 3',items},{label:'来源待处理 1',items:[pending]},...['结构化数据','非结构化资料','共享空间上传'].map((label,i)=>({label:label+' 1',items:[items[i]]}))],
    stats:{title:'知识构成',rows:[]},aside:{title:'最近入库',rows:[]}, pending:0,failed:0,busy:false,available:false,needsGraph:false,status:'已读取',scopeRevision:'1'}}));
  await page.goto(`/tenant-admin/prototype/?tenant=${tenant}`);
  await page.locator('.shell-switch button').filter({hasText:/^知识星链$/}).click();
  await expect(page.getByRole('tab')).toHaveCount(5);
  await expect(page.getByRole('tab',{name:'全部 3',exact:true})).toBeVisible();
  for (const name of ['结构化数据 1','非结构化资料 1','共享空间上传 1']) await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
  const group = page.getByRole('button',{name:'结构化数据 1',exact:true});
  await group.click();
  await expect(group).toHaveAttribute('aria-expanded','false');
  await expect(page.locator('.card.list .row').filter({hasText:'合成知识0'})).toHaveCount(0);
  await group.click();
  await page.locator('.card.list .row').filter({hasText:'合成知识0'}).click();
  await expect(page.locator('.card.detail')).toContainText('合成内容');
  await page.getByRole('tab',{name:'来源待处理 1',exact:true}).click();
  await expect(page.getByRole('button',{name:'待处理来源 1',exact:true})).toBeVisible();
  await expect(page.locator('.card.list .row')).toHaveCount(1);
  await page.getByRole('tab',{name:'全部 3',exact:true}).click();
  await expect(page.locator('.card.list .row')).toHaveCount(3);
});

test('动画核心串联数据底座、引擎概览和知识星链，拖动不触发导航', async ({page}) => {
  await fixture(page);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(`/tenant-admin/prototype/?tenant=${tenant}`);
  const nav = page.locator('.shell-switch');
  await nav.getByRole('button',{name:'数据底座',exact:true}).click();
  const corePoint = async () => page.locator('.eng3d-halowrap').evaluate(el => {
    const r = el.parentElement!.getBoundingClientRect();
    const matrix = new DOMMatrix((el as HTMLElement).style.transform);
    return {x:r.x + matrix.m41,y:r.y + matrix.m42};
  });
  await page.waitForTimeout(250);
  let p = await corePoint();
  await page.mouse.move(p.x,p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 45,p.y + 20,{steps:5});
  await page.mouse.up();
  await expect(nav.getByRole('button',{name:'数据底座',exact:true})).toHaveAttribute('aria-current','page');
  p = await corePoint();
  await page.mouse.click(p.x,p.y);
  await expect(nav.getByRole('button',{name:'引擎概览',exact:true})).toHaveAttribute('aria-current','page');
  await page.waitForTimeout(250);
  p = await corePoint();
  await page.mouse.click(p.x,p.y);
  await expect(nav.getByRole('button',{name:'知识星链',exact:true})).toHaveAttribute('aria-current','page');
  await expect(page.getByRole('tablist',{name:'知识星链栏目'})).toBeVisible();
});


test('管理页分类、企业信息导航与窄屏布局', async ({page}) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await fixture(page);
  await page.goto(`/tenant-admin/prototype/?tenant=${tenant}`);
  await page.locator('.shell-switch').getByRole('button',{name:'成员与权限',exact:true}).click();
  const menu = page.getByRole('navigation',{name:'成员权限管理范围'});
  await expect(menu.getByRole('button',{name:/成员与协作/})).toHaveAttribute('aria-pressed','true');
  await menu.getByRole('button',{name:/数据访问/}).click();
  await expect(page.getByRole('button',{name:'资源权限',exact:true})).toBeVisible();
  await menu.getByRole('button',{name:/岗位与关注/}).click();
  await expect(page.locator('.work-roles')).toBeVisible();
  await page.locator('.shell-switch').getByRole('button',{name:'企业信息',exact:true}).click();
  const company = page.getByRole('navigation',{name:'企业信息栏目'});
  await expect(company.getByRole('link',{name:/企业背景/})).toBeVisible();
  await company.getByRole('link',{name:/AI内容偏好/}).click();
  await expect(page).toHaveURL(/detail=preferences/);
  await page.setViewportSize({width:760,height:900});
  await expect(company).toBeVisible();
  const fits = await page.locator('.management-content').evaluate(el => el.scrollWidth <= el.clientWidth + 2);
  expect(fits).toBeTruthy();
  expect(errors).toEqual([]);
});

test('共享空间列表在深色管理页中保持可读的普通、悬停与键盘状态', async ({page}) => {
  await fixture(page);
  await page.route('**/tenants/*/overview', r => r.fulfill({json:{tenantId:tenant,name:'合成企业',version:1,activeMemberCount:1,disabledMemberCount:0,sharedWorkspaceCount:1,invitationDelivery:'LOCAL'}}));
  await page.route('**/workspaces?*', r => r.fulfill({json:[{id:actor,tenantId:tenant,name:'合成共享空间',kind:'SHARED',version:1,memberCount:3,ownerId:actor,ownerName:'合成负责人',description:''}]}));
  await page.goto(`/tenant-admin/prototype/?tenant=${tenant}`);
  await page.locator('.shell-switch').getByRole('button',{name:'成员与权限',exact:true}).click();
  await page.getByRole('link',{name:'共享空间',exact:true}).click();
  const row = page.getByRole('button',{name:'管理空间 合成共享空间',exact:true});
  await expect(row).toBeVisible();
  await expect(row).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(row).toHaveCSS('color','rgb(243, 246, 250)');
  await row.hover();
  await expect(row).toHaveCSS('background-color','rgba(255, 255, 255, 0.06)');
  await row.focus();
  await expect(row).toBeFocused();
  await page.setViewportSize({width:760,height:900});
  await expect(row).toBeVisible();
  expect(await page.locator('.management-content').evaluate(el => el.scrollWidth <= el.clientWidth + 2)).toBeTruthy();
});

test('知识自动链路显示等待和失败原因而不是空白完成状态', async ({page}) => {
 await fixture(page);
 await page.route('**/scene/dispatch?path=%2Fscene-knowledge',r=>r.fulfill({json:{items:[],relations:[],sourceKind:{},tabs:[],stats:{title:'知识构成',rows:[]},aside:{title:'最近入库',rows:[]},pending:0,failed:1,busy:false,available:false,needsGraph:false,scopeRevision:'progress',status:'等待 1 项 · 失败 1 项',pipeline:{waiting:1,failed:1,busy:false,steps:[{stage:'DEFINITION',source:'合成新表',state:'WAITING',reason:'SOURCE_DEFINITION_REQUIRED',message:'等待完整字段口径与规则，补齐后自动继续'},{stage:'INSIGHT',source:'企业经营知识',state:'FAILED',reason:'FAILED',message:'经营知识生成失败，保留执行记录；核对失败原因后再重试'}]}}}));
 await page.goto(`/tenant-admin/prototype/?tenant=${tenant}`);
 await page.locator('.shell-switch button').filter({hasText:/^知识星链$/}).click();
 await expect(page.getByRole('status').filter({hasText:'等待完整字段口径'})).toBeVisible();
 await expect(page.getByRole('status').filter({hasText:'经营知识生成失败'})).toBeVisible();
 await page.screenshot({path:'.local/architecture/knowledge-pipeline.png',fullPage:true});
});
