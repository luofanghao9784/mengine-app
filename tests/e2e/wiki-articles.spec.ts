import { test, expect } from '@playwright/test';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  actor = id(2);
test('Wiki explicit publication, revision edit, archive, restore and revoked access', async ({
  page,
  context,
}) => {
  let denied = false;
  let stale = false;
  let starts = 0;
  let shared: Record<string, unknown> | undefined;
  const versions: Record<string, unknown>[] = [];
  const publishBodies: Record<string, unknown>[] = [];
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
    if (path.includes('/wiki-articles')) {
      if (denied) return json({ contractVersion: '1.0', code: 'MATERIAL_NOT_FOUND' }, 404);
      if (path.includes('/prepare/'))
        return json({ expectedRevision: shared?.revision || 0, canPublish: true });
      if (path.includes('/publish/')) {
        const b = route.request().postDataJSON();
        publishBodies.push(b);
        expect(b.acknowledged).toBe(true);
        expect(b.expectedRevision).toBe(0);
        shared = {
          id: id(20),
          tenantId: tenant,
          materialId: id(3),
          revision: 1,
          archived: false,
          sourceChanged: false,
          canMaintain: true,
          sourceName: '合成交付规范',
          sourceVersionId: id(5),
          sourceVersion: 2,
          executionClass: 'verification',
          modelName: 'fixture',
          article: { title: b.title, intro: b.intro, content: b.content, evidence: draft.article!.evidence },
        };
        versions.unshift({
          revision: 1,
          action: 'PUBLISH',
          actorId: actor,
          createdAt: '2026-10-12T00:00:00Z',
          sourceChanged: false,
          article: shared.article,
        });
        return json(shared);
      }
      if (path.endsWith('/history'))
        return json({
          items: shared?.sourceChanged
            ? versions.map((v) => ({ ...v, sourceChanged: true, article: null }))
            : versions,
          hasMore: false,
        });
      if (path.endsWith('/wiki-articles'))
        return json({
          items: shared && shared.archived === (url.searchParams.get('archived') === 'true') ? [shared] : [],
          hasMore: false,
        });
      if (route.request().method() === 'POST') {
        const b = route.request().postDataJSON();
        expect(b.expectedRevision).toBe(shared!.revision);
        if (b.action === 'EDIT')
          shared = {
            ...shared!,
            revision: Number(shared!.revision) + 1,
            article: {
              title: b.title,
              intro: b.intro,
              content: b.content,
              evidence: draft.article!.evidence,
            },
          };
        else
          shared = { ...shared!, revision: Number(shared!.revision) + 1, archived: b.action === 'ARCHIVE' };
        versions.unshift({
          revision: shared.revision,
          action: b.action,
          actorId: actor,
          createdAt: '2026-10-12T00:00:00Z',
          sourceChanged: false,
          article: shared.article,
        });
        return json(shared);
      }
      return json(shared);
    }
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
  await page.getByRole('button', { name: '校订并发布到 Wiki' }).click();
  await expect(page.getByRole('button', { name: '确认发布', exact: true })).toBeDisabled();
  await page.getByLabel('知识标题', { exact: true }).fill('人工核对的共享知识');
  await page.getByLabel('我已核对内容，同意按来源资料的读取范围发布').check();
  await page.getByRole('button', { name: '确认发布', exact: true }).click();
  await expect(page.getByText('已发布为 Wiki 知识第 1 版。')).toBeVisible();
  expect(publishBodies).toHaveLength(1);
  await page.getByRole('button', { name: '完成发布' }).click();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('tab', { name: '共享知识', exact: true }).click();
  await page.getByRole('button', { name: /人工核对的共享知识/ }).click();
  await page.getByRole('button', { name: '校订知识', exact: true }).click();
  await page.getByRole('textbox', { name: '知识正文', exact: true }).fill('第二版人工校订内容。');
  await page.getByRole('button', { name: '保存校订并更新共享知识' }).click();
  await expect(page.getByText('第二版人工校订内容。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '维护记录', exact: true }).click();
  await expect(page.getByText(/第 2 版 · 校订/)).toBeVisible();
  await page.screenshot({ path: 'test-results/wiki-article-maintenance.png', fullPage: true });
  await page.getByRole('button', { name: '下架知识', exact: true }).click();
  await expect(page.getByRole('button', { name: '恢复上架', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await expect(page.getByText('暂无可访问的共享知识。')).toBeVisible();
  await page.getByRole('button', { name: '查看已下架知识', exact: true }).click();
  await page.getByRole('button', { name: /人工核对的共享知识/ }).click();
  await page.getByRole('button', { name: '恢复上架', exact: true }).click();
  await expect(page.getByRole('button', { name: '下架知识', exact: true })).toBeVisible();
  shared = { ...shared!, sourceChanged: true, article: null };
  await page.getByRole('button', { name: '刷新知识', exact: true }).click();
  await expect(page.getByText('第二版人工校订内容。', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/来源版本或解析批次已变化/)).toBeVisible();
  denied = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: '下架知识', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await expect(page.getByText('人工核对的共享知识', { exact: true })).toHaveCount(0);
});
