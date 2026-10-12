import { test, expect } from '@playwright/test';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  actor = id(2);
test('Wiki sources, search pagination, immutable citations and revocation', async ({ page, context }) => {
  let denied = false;
  const queries: URL[] = [];
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
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
    if (path.endsWith('/knowledge/processing')) {
      queries.push(url);
      if (denied) return json({ contractVersion: '1.0', code: 'FORBIDDEN' }, 403);
      return json({
        tenantId: tenant,
        workspaceId: null,
        query: url.searchParams.get('q') || '',
        state: 'ALL',
        parserAvailable: true,
        maxUploadBytes: 20000,
        summary: { total: 1, ready: 1, processing: 0, attention: 0, notStarted: 0 },
        hasMore: false,
        items: [
          {
            materialId: id(3),
            workspaceId: id(4),
            workspaceName: '共享资料',
            name: '合成交付规范',
            versionId: id(5),
            version: 2,
            sizeBytes: 20,
            status: 'READY',
            generation: 1,
            updatedAt: '2026-10-12T00:00:00Z',
            finishedAt: null,
            canMaintain: false,
          },
        ],
      });
    }
    const chunk = {
      id: id(6),
      tenantId: tenant,
      workspaceId: id(4),
      materialId: id(3),
      versionId: id(5),
      runId: id(7),
      version: 2,
      filename: '合成交付规范.txt',
      locator: '第 1 段',
      method: 'TEXT',
      content: '交付验收必须核对原件。<script>alert(1)</script>',
    };
    if (path.endsWith('/knowledge/search')) {
      queries.push(url);
      if (denied) return json({ contractVersion: '1.0', code: 'FORBIDDEN' }, 403);
      return json({
        tenantId: tenant,
        workspaceId: null,
        query: url.searchParams.get('q'),
        hasMore: url.searchParams.get('offset') === '0',
        items: url.searchParams.get('q') === '不存在' ? [] : [chunk],
      });
    }
    if (path.endsWith('/knowledge/chunks/' + id(6))) {
      queries.push(url);
      if (denied) return json({ contractVersion: '1.0', code: 'MATERIAL_NOT_FOUND' }, 404);
      return json(chunk);
    }
    if (path.endsWith('/analysis'))
      return json({
        tenantId: tenant,
        workspaceId: id(4),
        materialId: id(3),
        versionId: id(5),
        generation: 1,
        status: 'READY',
        parserVersion: 'synthetic',
        warnings: [],
        canMaintain: false,
        available: true,
        chunks: [chunk],
        hasMore: false,
      });
    return json({ contractVersion: '1.0', code: 'UNAVAILABLE' }, 404);
  });
  await page.goto(`/tenant-admin/#tenant=${tenant}&admin=wiki`);
  await expect(page.getByRole('link', { name: 'Wiki 知识', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '合成交付规范' })).toBeVisible();
  await page.getByRole('button', { name: /合成交付规范/ }).click();
  await expect(
    page.getByText('交付验收必须核对原件。<script>alert(1)</script>', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('tab', { name: '原文检索' }).click();
  await page.getByLabel('原文关键词').fill('交付');
  await page.getByRole('button', { name: '检索', exact: true }).click();
  await expect(page.getByRole('button', { name: /合成交付规范.txt/ })).toBeVisible();
  await page.getByRole('button', { name: '下一页' }).click();
  await expect.poll(() => queries.at(-1)?.searchParams.get('offset')).toBe('20');
  await page.getByRole('button', { name: /合成交付规范.txt/ }).click();
  await expect(page.getByRole('heading', { name: '合成交付规范.txt · v2' })).toBeVisible();
  await page.screenshot({ path: 'test-results/wiki-source-reader.png', fullPage: true });
  denied = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: '合成交付规范.txt · v2' })).toHaveCount(0);
  await expect(
    page.getByText('交付验收必须核对原件。<script>alert(1)</script>', { exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  denied = false;
  await page.getByLabel('原文关键词').fill('不存在');
  await page.getByRole('button', { name: '检索', exact: true }).click();
  await expect(page.getByText('没有找到可访问的匹配原文。')).toBeVisible();
  await page.getByRole('tab', { name: '资料来源' }).click();
  await expect(page.getByRole('heading', { name: '合成交付规范' })).toBeVisible();
  await page.screenshot({ path: 'test-results/wiki-sources.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  denied = true;
  await page.getByRole('button', { name: '刷新 Wiki' }).click();
  await expect(page.getByRole('heading', { name: '合成交付规范' })).toHaveCount(0);
});
