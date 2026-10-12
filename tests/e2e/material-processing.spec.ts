import { test, expect, type BrowserContext } from '@playwright/test';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  person = id(2),
  space = id(3),
  material = id(4),
  version = id(5),
  personal = id(6);
const date = '2026-10-04T00:00:00Z';
async function fixture(context: BrowserContext, options: { reader?: boolean; lost?: boolean } = {}) {
  let revoked = false,
    queued = false;
  const posts: Record<string, unknown>[] = [];
  const document = () => ({
    id: material,
    tenantId: tenant,
    workspaceId: space,
    workspaceName: '合成销售空间',
    folderId: null,
    kind: 'DOCUMENT',
    name: '合成月度数据说明.txt',
    version: 2,
    sizeBytes: 30,
    updatedAt: date,
    path: ['合成销售空间', '合成月度数据说明.txt'],
    canMaintain: !options.reader,
  });
  const file = {
    id: version,
    number: 2,
    filename: '合成月度数据说明.txt',
    sizeBytes: 30,
    sha256: 'a'.repeat(64),
    createdBy: person,
    createdAt: date,
  };
  const analysis = () => ({
    tenantId: tenant,
    workspaceId: space,
    materialId: material,
    versionId: version,
    generation: queued ? 2 : 1,
    status: queued ? 'QUEUED' : 'FAILED',
    parserVersion: null,
    warnings: queued ? [] : ['PARSE_FAILED'],
    canMaintain: !options.reader,
    available: true,
    chunks: [],
    hasMore: false,
  });
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path.endsWith('/phone/configuration')) return json({ delivery: 'DISABLED', localPreview: false });
    if (path.endsWith('/csrf')) return json({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
    if (path === '/api/v1/me')
      return json({
        account: { id: person, email: 'synthetic@example.test', displayName: '合成管理人员' },
        platformAdmin: false,
        memberships: [{ tenantId: tenant, tenantName: '合成企业', role: 'TENANT_ADMIN' }],
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
    if (path === `/api/v1/tenants/${tenant}/context`)
      return json({
        tenant: { id: tenant, name: '合成企业', status: 'ACTIVE' },
        role: 'TENANT_ADMIN',
        workspaces: [
          { id: personal, name: '个人空间', kind: 'PERSONAL' },
          ...(revoked ? [] : [{ id: space, name: '合成销售空间', kind: 'SHARED' }]),
        ],
      });
    if (revoked) return json({ contractVersion: '1.0', code: 'MATERIAL_LOCATION_UNAVAILABLE' }, 404);
    if (path.endsWith('/knowledge/processing'))
      return json({
        tenantId: tenant,
        workspaceId: url.searchParams.get('workspace'),
        query: url.searchParams.get('q') || '',
        state: url.searchParams.get('state') || 'ALL',
        parserAvailable: true,
        maxUploadBytes: 20971520,
        summary: { total: 4, ready: 2, processing: queued ? 1 : 0, attention: queued ? 0 : 1, notStarted: 1 },
        items: [
          {
            materialId: material,
            workspaceId: space,
            workspaceName: '合成销售空间',
            name: document().name,
            versionId: version,
            version: 2,
            sizeBytes: 30,
            status: queued ? 'QUEUED' : 'FAILED',
            generation: queued ? 2 : 1,
            updatedAt: date,
            finishedAt: queued ? null : date,
            canMaintain: !options.reader,
          },
        ],
        hasMore: false,
      });
    if (path.endsWith('/analysis')) {
      if (route.request().method() === 'POST') {
        posts.push(route.request().postDataJSON());
        if (options.lost && posts.length === 1) return route.abort('failed');
        queued = true;
      }
      return json(analysis());
    }
    if (path.endsWith('/materials/' + material))
      return json({ document: document(), versions: [file], hasMore: false });
    if (path.endsWith('/versions/' + version)) return json(file);
    if (path.endsWith('/library'))
      return json({
        tenantId: tenant,
        workspaceId: path.includes('/workspaces/') ? space : null,
        folderId: null,
        trail: [],
        canMaintain: !options.reader && path.includes('/workspaces/'),
        maxUploadBytes: 20971520,
        items: [document()],
        hasMore: false,
      });
    if (path.endsWith('/lifecycle')) return json({ items: [], hasMore: false });
    return json({ contractVersion: '1.0', code: 'NOT_FOUND' }, 404);
  });
  return {
    posts,
    revoke: () => {
      revoked = true;
    },
  };
}
const start = `/tenant-admin/#tenant=${tenant}&admin=materials&back=${encodeURIComponent('#tenant=' + tenant + '&view=briefing')}`;
test('processing summary, filters, fixed-version detail and same-request retry', async ({
  page,
  context,
}) => {
  const state = await fixture(context, { lost: true });
  await page.goto(start + '&section=processing');
  await expect(page.getByRole('heading', { name: '资料处理', exact: true })).toBeVisible();
  await expect(page.locator('.processing-metrics')).toContainText('4');
  await page.getByLabel('处理状态').selectOption('ATTENTION');
  await page.getByLabel('资料名称').fill('月度');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.screenshot({ path: '.local/admin-materials/desktop.png', fullPage: true });
  await page.getByRole('button', { name: /合成月度数据说明.*查看详情/ }).click();
  await expect(page.getByRole('heading', { name: '合成月度数据说明.txt · v2' })).toBeVisible();
  await page.getByRole('button', { name: '原件与历史版本', exact: true }).click();
  await expect(page.getByRole('heading', { name: '历史版本', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '下载 v2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭资料阅读', exact: true }).click();
  await page.getByRole('button', { name: '重新解析', exact: true }).click();
  await page.getByRole('button', { name: '重试本次请求', exact: true }).click();
  await expect(page.getByRole('heading', { name: '等待解析', exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(2);
  expect(state.posts[0]).toEqual(state.posts[1]);
  expect(state.posts[0].expectedGeneration).toBe(1);
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await expect(page.getByLabel('处理状态')).toHaveValue('ATTENTION');
  await expect(page.getByLabel('资料名称')).toHaveValue('月度');
});
test('read-only detail, narrow screen and revocation clear previously visible content', async ({
  page,
  context,
}) => {
  const state = await fixture(context, { reader: true });
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto(start + '&section=processing');
  await expect(page.getByRole('button', { name: /合成月度数据说明.*查看详情/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/admin-materials/mobile.png', fullPage: true });
  await page.getByRole('button', { name: /合成月度数据说明.*查看详情/ }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.local/admin-materials/mobile-list.png', fullPage: true });
  await page.getByRole('button', { name: /合成月度数据说明.*查看详情/ }).click();
  await expect(page.getByRole('heading', { name: '解析未完成', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新解析', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '维护与回收站', exact: true })).toHaveCount(0);
  state.revoke();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('合成月度数据说明.txt', { exact: true })).toHaveCount(0);
  await expect(page.locator('.knowledge-analysis')).toHaveCount(0);
});
test('file navigation preserves admin realm and client return; recycle uses same shared spaces', async ({
  page,
  context,
}) => {
  await fixture(context);
  await page.goto(start + '&section=processing');
  await page.getByRole('link', { name: '文件与目录' }).click();
  await page.getByRole('button', { name: '全部资料', exact: true }).click();
  await expect(page).toHaveURL(/admin=materials.*section=files.*scope=all/);
  await expect(page.locator('button.material-entry').filter({ hasText: '合成月度数据说明' })).toBeVisible();
  expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('back')).toBe(
    '#tenant=' + tenant + '&view=briefing',
  );
  await page.getByRole('link', { name: '解析处理', exact: true }).click();
  await page.getByRole('button', { name: '回收站', exact: true }).click();
  await expect(page.getByRole('button', { name: '个人空间', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '合成销售空间', exact: true }).click();
  await expect(page.getByText('此空间没有回收或清理记录。')).toBeVisible();
  await expect(page.getByText('当前目录没有资料。可返回资料库选择其他目录。')).toHaveCount(0);
});

test('inline recycle and deletion records retain the enterprise realm, shared scope and client return', async ({
  page,
  context,
}) => {
  await fixture(context);
  await page.goto(start + '&section=files&scope=' + space);
  await page.locator('.library-page').getByRole('button', { name: '回收站', exact: true }).click();
  await expect(page.getByLabel('资料回收站', { exact: true })).toBeVisible();
  const assertLocation = async (recycle: string | null) => {
    const params = new URLSearchParams(new URL(page.url()).hash.slice(1));
    expect(new URL(page.url()).pathname).toBe('/tenant-admin/');
    expect(params.get('admin')).toBe('materials');
    expect(params.get('scope')).toBe(space);
    expect(params.get('back')).toBe('#tenant=' + tenant + '&view=briefing');
    expect(params.get('recycle')).toBe(recycle);
    await expect(page.locator('.admin-shell')).toBeVisible();
  };
  await assertLocation('trash');
  await page.getByRole('button', { name: '删除记录', exact: true }).click();
  await expect(page.getByLabel('资料删除记录', { exact: true })).toBeVisible();
  await assertLocation('records');
  await page
    .getByLabel('文件夹路径', { exact: true })
    .getByRole('button', { name: '合成销售空间', exact: true })
    .click();
  await assertLocation(null);
  await expect(page.locator('button.material-entry').filter({ hasText: '合成月度数据说明' })).toBeVisible();
});
