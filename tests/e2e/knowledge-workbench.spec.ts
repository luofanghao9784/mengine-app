import { test, expect, type BrowserContext } from '@playwright/test';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  other = id(9),
  person = id(2),
  space = id(3),
  material = id(4),
  version = id(5);
const date = '2026-10-12T06:00:00Z';
async function fixture(context: BrowserContext, editable = false) {
  const writes: string[] = [];
  let mode: 'normal' | 'empty' | 'error' | 'revoked' = 'normal';
  const requests: URL[] = [];
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
        memberships: [
          { tenantId: tenant, tenantName: '合成企业', role: 'TENANT_ADMIN' },
          { tenantId: other, tenantName: '另一企业', role: 'TENANT_ADMIN' },
        ],
      });
    if (path.endsWith('/governance'))
      return json({
        tenantId: path.includes(other) ? other : tenant,
        ownerId: person,
        revision: 0,
        owner: true,
        canConfigure: true,
        canEnterManagement: true,
        canAcceptInitialResponsibility: false,
        pendingHandover: null,
        capabilities: [],
      });
    if (path.endsWith('/context'))
      return json({
        tenant: { id: path.includes(other) ? other : tenant, name: '合成企业', status: 'ACTIVE' },
        role: 'TENANT_ADMIN',
        workspaces: [{ id: space, name: '销售空间', kind: 'SHARED' }],
      });
    if (path.endsWith('/knowledge/workbench')) {
      requests.push(url);
      if (mode === 'error' || mode === 'revoked')
        return json(
          { contractVersion: '1.0', code: 'MATERIAL_LOCATION_UNAVAILABLE' },
          mode === 'error' ? 500 : 403,
        );
      const empty = mode === 'empty' || path.includes(other),
        state = url.searchParams.get('state'),
        q = url.searchParams.get('q');
      const item = {
        id: material,
        workspaceId: space,
        workspaceName: '销售空间',
        name: '合成经营资料.txt',
        version: 2,
        status: 'READY',
        updatedAt: date,
      };
      return json({
        tenantId: path.includes(other) ? other : tenant,
        checkedAt: date,
        summary: empty
          ? { total: 0, ready: 0, processing: 0, attention: 0, notStarted: 0 }
          : { total: 1, ready: 1, processing: 0, attention: 0, notStarted: 0 },
        spaces: empty ? [] : [{ id: space, name: '销售空间', count: 1 }],
        filteredTotal: empty || state === 'ATTENTION' || q === '不存在' ? 0 : 1,
        items: empty || state === 'ATTENTION' || q === '不存在' ? [] : [item],
        hasMore: false,
      });
    }
    if (path.endsWith('/pipeline'))
      return json({
        materialId: material,
        version: 2,
        receivedAt: date,
        parsing: 'READY',
        governance: 'CHECKED',
        issues: 2,
        publication: 'NOT_PUBLISHED',
      });
    if (path.endsWith('/editable-text'))
      return json({
        materialId: material,
        versionId: version,
        version: 2,
        filename: '合成经营资料.txt',
        content: '原始正文',
      });
    if (path.endsWith('/versions') && route.request().method() === 'POST') {
      writes.push(route.request().postData() || '');
      return json({ contractVersion: '1.0', code: 'MATERIAL_VERSION_CONFLICT' }, 409);
    }
    if (path.endsWith('/materials/' + material))
      return json({
        document: {
          id: material,
          tenantId: tenant,
          workspaceId: space,
          workspaceName: '销售空间',
          folderId: null,
          kind: 'DOCUMENT',
          name: '合成经营资料.txt',
          version: 2,
          sizeBytes: 30,
          updatedAt: date,
          path: ['销售空间', '合成经营资料.txt'],
          canMaintain: editable,
          canDownload: false,
        },
        versions: [
          {
            id: version,
            number: 2,
            filename: '合成经营资料.txt',
            sizeBytes: 30,
            sha256: 'a'.repeat(64),
            createdBy: person,
            createdAt: date,
          },
        ],
        hasMore: false,
      });
    return json({ contractVersion: '1.0', code: 'NOT_FOUND' }, 404);
  });
  return {
    requests,
    writes,
    setMode: (next: typeof mode) => {
      mode = next;
    },
  };
}
const start = `/tenant-admin/#tenant=${tenant}&admin=overview&layout=workbench`;
test('knowledge metrics, space drilldown, search and document detail use authorized API', async ({
  page,
  context,
}) => {
  const f = await fixture(context);
  await page.goto(start);
  await expect(page.getByRole('heading', { name: '让知识，在正确的权限下流动.' })).toBeVisible();
  await expect(page.locator('.kw-metrics')).toContainText('可访问知识资产');
  await page.locator('.kw-distribution button').click();
  expect(f.requests.at(-1)?.searchParams.get('workspace')).toBe(space);
  await page.getByLabel('搜索获权资料').fill('不存在');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.getByText('没有符合条件的资料')).toBeVisible();
  await page.getByRole('button', { name: '查看全部', exact: true }).click();
  await page.getByRole('button', { name: '合成经营资料.txt 版本 2' }).click();
  await expect(page.getByRole('heading', { name: '历史版本', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭资料阅读' }).click();
  await expect(page.getByRole('button', { name: '关闭资料阅读' })).toHaveCount(0);
  await page.screenshot({ path: '.local/knowledge-workbench/desktop.png', fullPage: true });
});
test('permission rejection clears assets and retry recovers without reporting zero', async ({
  page,
  context,
}) => {
  const f = await fixture(context);
  await page.goto(start);
  await expect(page.locator('.kw-document')).toBeVisible();
  f.setMode('revoked');
  await page.getByRole('button', { name: '刷新知识工作台' }).click();
  await expect(page.locator('.kw-document')).toHaveCount(0);
  await expect(page.locator('.knowledge-workbench')).toContainText('没有访问权限');
  await expect(page.locator('.kw-metrics')).toHaveCount(0);
  f.setMode('error');
  await page.locator('.knowledge-workbench').getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('.knowledge-workbench')).toContainText('暂时无法读取');
  f.setMode('normal');
  await page.locator('.knowledge-workbench').getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('.kw-document')).toBeVisible();
});
test('empty state and switching enterprises do not retain previous assets', async ({ page, context }) => {
  await fixture(context);
  await page.goto(start);
  await expect(page.locator('.kw-document')).toBeVisible();
  await page.evaluate((t) => {
    location.hash = `tenant=${t}&admin=overview&layout=workbench`;
  }, other);
  await expect(page.getByText('暂无可访问的共享资料')).toBeVisible();
  await expect(page.locator('.kw-document')).toHaveCount(0);
});
test('narrow layout preserves readable metrics and avoids page overflow', async ({ page, context }) => {
  await fixture(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(start);
  await expect(page.locator('.kw-document')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/knowledge-workbench/mobile.png', fullPage: true });
});

test('text editor preserves pinned version and surfaces concurrent update conflict', async ({
  page,
  context,
}) => {
  const f = await fixture(context, true);
  await page.goto(start);
  await page.getByRole('button', { name: '合成经营资料.txt 版本 2' }).click();
  await expect(page.getByRole('region', { name: '资料处理四阶段' })).toContainText('2 项需关注');
  await expect(page.getByRole('region', { name: '资料处理四阶段' })).toContainText('尚未发布 Wiki');
  await page.getByRole('button', { name: '编辑正文', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '资料正文' })).toHaveValue('原始正文');
  await page.getByRole('textbox', { name: '资料正文' }).fill('人工修改正文');
  await page.getByRole('button', { name: '保存新版本', exact: true }).click();
  await expect.poll(() => f.writes.length).toBe(1);
  expect(f.writes[0]).toContain('"expectedVersion":2');
  expect(f.writes[0]).toContain('人工修改正文');
  await expect(page.getByRole('alert').filter({ hasText: '版本' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '资料正文' })).toHaveValue('人工修改正文');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/material-text-editor.png' });
});

test('both knowledge page versions remain reachable and unavailable metrics are not fabricated', async ({
  page,
  context,
}) => {
  await fixture(context);
  await page.goto(start.replace('&layout=workbench', ''));
  await expect(page.locator('.mengine-orbit canvas')).toBeVisible();
  await expect(page.locator('.mengine-metrics')).toContainText('暂时无法读取');
  await expect(page.getByRole('link', { name: '企业资料列表', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '数据治理', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '资料工作台', exact: true }).click();
  await expect(page.locator('.kw-metrics')).toBeVisible();
  await page.getByRole('link', { name: '知识仪表盘', exact: true }).click();
  await expect(page.locator('.mengine-orbit canvas')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('catalog displays real governance columns and opens the existing permission-aware reader', async ({
  page,
  context,
}) => {
  await fixture(context);
  await context.route('**/material-governance?*', (route) =>
    route.fulfill({
      json: {
        tenantId: tenant,
        summary: { total: 1, checked: 1, attention: 0, sensitive: 0, average: 92 },
        filteredTotal: 1,
        hasMore: false,
        items: [
          {
            id: material,
            workspaceId: space,
            workspaceName: '销售空间',
            name: '合成经营资料.txt',
            version: 2,
            revision: 0,
            canEdit: false,
            canRedact: false,
            source: 'ORIGINAL_TEXT',
            quality: 92,
            issues: [],
            tags: ['经营'],
            reviewAt: '2026-12-01',
            checkedAt: date,
          },
        ],
      },
    }),
  );
  await page.goto(`/tenant-admin/#tenant=${tenant}&admin=catalog`);
  await expect(page.getByRole('cell', { name: '92 / 100' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '经营', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '阅读资料', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: '编辑正文', exact: true })).toHaveCount(0);
});
