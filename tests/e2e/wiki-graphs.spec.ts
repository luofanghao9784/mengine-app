import { test, expect } from '@playwright/test';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  actor = id(2);
test('knowledge graph select, analysis, evidence, source change and revocation', async ({
  page,
  context,
}) => {
  let stale = false,
    denied = false,
    created = false;
  const bodies: unknown[] = [];
  const documents = [
    { id: id(10), revision: 1, title: '交付核对规范', content: '交付必须逐项核对原件。' },
    { id: id(11), revision: 2, title: '验收核对方法', content: '验收必须逐项核对原件。' },
    { id: id(12), revision: 1, title: '其他独立知识', content: '独立知识使用合成资料。' },
  ];
  const graph = () => ({
    id: id(20),
    tenantId: tenant,
    taskId: id(21),
    conversationId: id(22),
    status: stale ? 'SOURCE_CHANGED' : 'SUCCEEDED',
    executionClass: 'verification',
    modelName: 'fixture',
    documents: stale ? [] : documents.slice(0, 2),
    graph: stale
      ? null
      : {
          selected: [id(10), id(11)],
          relations: [
            {
              from: id(10),
              to: id(11),
              kind: 'sequence',
              reason: '交付核对后开展验收核对',
              evidence: [
                { articleId: id(10), quote: '必须逐项核对原件' },
                { articleId: id(11), quote: '必须逐项核对原件' },
              ],
            },
          ],
        },
  });
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path.endsWith('/phone/configuration')) return json({ delivery: 'DISABLED', localPreview: false });
    if (path === '/api/v1/me')
      return json({
        account: { id: actor, email: 'synthetic@example.test', displayName: '合成管理员' },
        platformAdmin: false,
        memberships: [{ tenantId: tenant, tenantName: '合成企业', role: 'TENANT_ADMIN' }],
      });
    if (path.endsWith('/governance'))
      return json({
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
    if (path === '/api/v1/auth/csrf')
      return json({ token: 'synthetic', headerName: 'X-CSRF-TOKEN', parameterName: '_csrf' });
    if (path.includes('/wiki-graphs')) {
      if (denied) return json({ contractVersion: '1.0', code: 'MATERIAL_NOT_FOUND' }, 404);
      if (route.request().method() === 'POST') {
        bodies.push(route.request().postDataJSON());
        created = true;
        return json(graph());
      }
      return path.endsWith('/wiki-graphs')
        ? json({ items: created ? [graph()] : [], hasMore: false })
        : json(graph());
    }
    if (path.includes('/wiki-articles')) {
      const items = documents.map((d, i) => ({
        id: d.id,
        tenantId: tenant,
        materialId: id(30 + i),
        revision: d.revision,
        archived: false,
        sourceChanged: false,
        canMaintain: false,
        sourceName: '合成来源' + i,
        sourceVersionId: id(40 + i),
        sourceVersion: 1,
        executionClass: 'verification',
        modelName: 'fixture',
        article: {
          title: d.title,
          intro: '合成摘要',
          content: d.content,
          evidence: [{ chunkId: id(50 + i), quote: '必须逐项核对原件' }],
        },
      }));
      return path.endsWith('/wiki-articles')
        ? json({ items, hasMore: false })
        : json(items.find((a) => path.endsWith(a.id)));
    }
    if (path.endsWith('/knowledge/processing'))
      return json({
        tenantId: tenant,
        workspaceId: null,
        query: '',
        state: 'ALL',
        parserAvailable: true,
        maxUploadBytes: 20000,
        summary: { total: 0, ready: 0, processing: 0, attention: 0, notStarted: 0 },
        items: [],
        hasMore: false,
      });
    return json({ contractVersion: '1.0', code: 'UNAVAILABLE' }, 404);
  });
  await page.goto(`/tenant-admin/#tenant=${tenant}&admin=wiki`);
  await page.getByRole('tab', { name: '知识关系', exact: true }).click();
  await expect(page.getByRole('button', { name: '分析关系与推荐', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: /交付核对规范/ }).check();
  await page.getByRole('checkbox', { name: /验收核对方法/ }).check();
  await page.getByRole('button', { name: '分析关系与推荐', exact: true }).click();
  await expect(page.getByRole('img', { name: /知识关系图，2 个节点，1 条关系/ })).toBeVisible();
  await expect(page.getByText('交付核对后开展验收核对', { exact: true })).toBeVisible();
  expect((bodies[0] as { articles: unknown }).articles).toEqual([
    { articleId: id(10), revision: 1 },
    { articleId: id(11), revision: 2 },
  ]);
  await page.getByRole('button', { name: '打开依据知识', exact: true }).first().click();
  await expect(page.getByText('交付必须逐项核对原件。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).last().click();
  await page.screenshot({ path: 'test-results/wiki-graph.png', fullPage: true });
  await page.getByRole('button', {name:'关闭弹窗',exact:true}).click();
  await page.getByRole('button', {name:'自动推荐知识星图',exact:true}).click();
  await expect(page.getByRole('img', {name:/知识关系图，2 个节点，1 条关系/})).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(Object.keys(bodies[1] as object)).toEqual(['requestId']);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  stale = true;
  await page.getByRole('button', { name: '刷新分析状态', exact: true }).click();
  await expect(page.getByRole('img', { name: /知识关系图/ })).toHaveCount(0);
  await expect(page.getByText('交付核对后开展验收核对', { exact: true })).toHaveCount(0);
  denied = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: '刷新分析状态', exact: true })).toHaveCount(0);
});
