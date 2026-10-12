import { test, expect } from '@playwright/test';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  actor = id(2);
test('Wiki private learning: create, read, source invalidation and revocation', async ({ page, context }) => {
  let denied = false;
  let stale = false;
  let starts = 0;
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
    const draft = {
      id: id(10),
      tenantId: tenant,
      materialId: id(3),
      versionId: id(5),
      conversationId: id(11),
      taskId: id(12),
      sourceName: '合成交付规范',
      sourceVersion: 2,
      status: stale ? 'SOURCE_CHANGED' : 'SUCCEEDED',
      executionClass: 'verification',
      modelName: 'fixture',
      article: stale
        ? null
        : {
            title: '交付验收学习草稿',
            intro: '合成资料学习摘要',
            content: '依据合成片段，请核对真实原件。',
            evidence: [{ chunkId: id(6), quote: '交付验收必须核对原件' }],
          },
    };
    if (path === '/api/v1/auth/csrf')
      return json({ token: 'synthetic', headerName: 'X-CSRF-TOKEN', parameterName: '_csrf' });
    if (path.includes('/wiki-learning')) {
      if (denied) return json({ contractVersion: '1.0', code: 'MATERIAL_NOT_FOUND' }, 404);
      if (route.request().method() === 'POST') {
        starts++;
        expect(route.request().postDataJSON()).toMatchObject({ versionId: id(5), generation: 1 });
        return json(draft);
      }
      if (path.endsWith('/wiki-learning')) return json({ items: [draft], hasMore: false });
      return json(draft);
    }
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
  await page.getByRole('button', { name: /合成交付规范/ }).click();
  await page.getByRole('button', { name: '生成学习草稿', exact: true }).click();
  await expect(page.getByRole('heading', { name: '交付验收学习草稿', exact: true })).toBeVisible();
  expect(starts).toBe(1);
  await expect(page.getByRole('link', {name:'查看原任务',exact:true})).toHaveAttribute('href', `/workspace/#tenant=${tenant}&view=conversations&conversation=${id(11)}&task=${id(12)}`);
  await expect(page.getByText('模拟验证草稿', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '核对原文 1' }).click();
  await expect(
    page.getByText('交付验收必须核对原件。<script>alert(1)</script>', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/wiki-learning-draft.png', fullPage: true });
  stale = true;
  await page.getByRole('button', { name: '刷新学习状态' }).click();
  await expect(page.getByRole('heading', { name: '交付验收学习草稿', exact: true })).toHaveCount(0);
  await expect(page.getByText(/来源已变化，请重新学习/).first()).toBeVisible();
  await expect(
    page.getByText('交付验收必须核对原件。<script>alert(1)</script>', { exact: true }),
  ).toHaveCount(0);
  stale = false;
  await page.getByRole('button', { name: '刷新学习状态' }).click();
  await expect(page.getByRole('heading', { name: '交付验收学习草稿', exact: true })).toBeVisible();
  denied = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: '交付验收学习草稿', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await expect(page.getByText('交付验收学习草稿', { exact: true })).toHaveCount(0);
});
