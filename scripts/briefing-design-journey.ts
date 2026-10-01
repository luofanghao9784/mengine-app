/** Browser checks with an in-memory synthetic HTTP fixture. No database, user files or model access. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = uid(1),
  workspace = uid(2),
  account = uid(3),
  now = '2026-10-01T01:00:00Z';
const snapshot = 'a'.repeat(64),
  requests: { path: string; method: string; body: any }[] = [],
  unknown: string[] = [];
const opened = new Map<string, string>(),
  preference = { revision: 0, pinned: false, hidden: false, size: 'STANDARD' };
let settings = { revision: 0, enabled: true },
  failSetting = true,
  changedTask = false,
  restricted = false;
const settingKeys: string[] = [],
  receipts = new Map<string, typeof settings>();
const items = Array.from({ length: 23 }, (_, i) => {
  const id = uid(100 + i),
    conversationId = uid(200 + i);
  const content = {
    kind: 'TASK',
    id,
    versionKey: `task:${id}:3:1`,
    workspaceId: workspace,
    workspaceName: '合成工作空间',
    title: `工作成果 ${i + 1}：${i % 3 === 1 ? '在复杂业务环境中保持团队协作与交付的清晰度' : '本周工作分析'}`,
    excerpt: `这是一条隔离验收的合成摘要。${i % 3 === 1 ? '核对数据范围、明确工作重点，再给出可执行的下一步。'.repeat(6) : '内容仅用于浏览器测试。'}`,
    truncated: true,
    createdAt: now,
    executionClass: 'verification',
    conversationId,
    taskRevision: 3,
    attempt: 1,
    preferenceRevision: 0,
    materialId: null,
    materialVersion: 0,
    filename: '',
    pinned: false,
    openedAt: null,
  };
  return {
    content,
    score: 0.8,
    method: {
      versionId: null,
      adoptionRevision: 0,
      scope: 'BUILTIN',
      workspaceId: null,
      configurationSha: snapshot,
    },
    presentation: { renderer: 'source-preserving-v1', style: 'DEFAULT', profileId: null, profileRevision: 0 },
    reason: '合成排序依据',
    availability: 'AVAILABLE_IN_APP',
    feedbackTarget: {
      kind: 'BRIEFING',
      taskId: id,
      taskRevision: 3,
      attempt: 1,
      presentationVersion: 'recommendation-v1',
      presentationRevision: 1,
    },
  };
});
const task = (id: string) => ({
  id,
  revision: changedTask ? 4 : 3,
  attempt: 1,
  prompt: '合成测试工作',
  mode: 'AGENT',
  status: 'SUCCEEDED',
  reply: '## 已核对的完整原文\n这是精确任务版本的完整内容，不是卡片摘要。',
  executionClass: 'verification',
  modelName: 'synthetic',
  engineVersion: 'fixture-v1',
  originals: [],
  publicQuery: null,
  webSources: [],
  skills: [],
  artifacts: [],
  sources: [],
  sourcesUnavailable: restricted,
  summaryCode: null,
  errorCode: null,
  createdAt: now,
});
const server = await createServer({
  server: { port: 0, strictPort: false, host: '127.0.0.1' },
  logLevel: 'error',
});
await server.listen();
const url = server.resolvedUrls!.local[0],
  artifacts = resolve('.local/verification/briefing-design');
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      u = new URL(req.url()),
      path = u.pathname,
      method = req.method(),
      body = req.postData() ? req.postDataJSON() : null;
    requests.push({ path: u.pathname + u.search, method, body });
    const ok = (json: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
    if (path === '/api/v1/me')
      return ok({
        account: { id: account, email: 'fixture@example.test', displayName: '合成用户' },
        platformAdmin: false,
        memberships: [{ tenantId: tenant, tenantName: '合成企业', role: 'MEMBER' }],
      });
    if (path.endsWith('/auth/csrf')) return ok({ token: 'synthetic-csrf', headerName: 'X-CSRF-TOKEN' });
    if (path.endsWith('/context'))
      return ok({
        tenant: { id: tenant, name: '合成企业', status: 'ACTIVE' },
        role: 'MEMBER',
        workspaces: [{ id: workspace, name: '合成工作空间', kind: 'PERSONAL' }],
      });
    if (path.endsWith('/attention'))
      return ok({ tenantId: tenant, scope: 'MINE', total: 0, checkedAt: now, items: [], hasMore: false });
    if (path.endsWith('/forwarding/inbox')) return ok({ items: [], hasMore: false });
    if (path.endsWith('/recommendations/settings')) {
      settingKeys.push(body.requestId);
      if (!receipts.has(body.requestId)) {
        settings = { revision: settings.revision + 1, enabled: body.enabled };
        receipts.set(body.requestId, settings);
      }
      if (failSetting) {
        failSetting = false;
        return route.abort('failed');
      }
      return ok(receipts.get(body.requestId));
    }
    if (path.endsWith('/recommendations/opened')) {
      opened.set(body.id, now);
      return ok({
        target: body,
        openedAt: now,
        evidence: 'USER_OPEN_ACTION',
        businessOutcome: 'NOT_ASSESSED',
      });
    }
    if (path.endsWith('/recommendations')) {
      const offset = Number(u.searchParams.get('offset') || 0),
        list = items
          .slice(offset, offset + 20)
          .map((i) => ({ ...i, content: { ...i.content, openedAt: opened.get(i.content.id) || null } }));
      return ok({
        tenantId: tenant,
        settings,
        items: settings.enabled ? list : [],
        snapshot,
        hasMore: settings.enabled && offset + 20 < items.length,
        eligibleTotal: 23,
        rankedCount: 23,
        poolLimited: false,
        poolLimit: 1000,
        businessOutcome: 'NOT_ASSESSED',
      });
    }
    if (/\/conversations\/[^/]+\/tasks\/[^/]+$/.test(path)) {
      const parts = path.split('/');
      return ok({
        conversation: {
          id: parts.at(-3),
          tenantId: tenant,
          workspaceId: workspace,
          title: '合成测试工作',
          updatedAt: now,
        },
        tasks: [task(parts.at(-1)!)],
        hasMore: false,
        cursor: 0,
      });
    }
    if (path.endsWith('/briefing/layout')) return ok({ tenantId: tenant, revision: 0 });
    if (path.endsWith('/briefing')) {
      const view = u.searchParams.get('view') || 'LATEST';
      const card = {
        conversationId: uid(200),
        taskId: uid(100),
        taskRevision: 3,
        attempt: 1,
        presentationVersion: 'briefing-basic-v1',
        workspaceId: workspace,
        workspaceName: '合成工作空间',
        title: '已完成的会话成果',
        excerpt: '合成原文的摘要',
        truncated: true,
        completedAt: now,
        executionClass: 'verification',
        engineVersion: 'fixture-v1',
        artifactCount: 0,
        citationCount: 0,
        originalCount: 0,
        preference,
      };
      const visible =
        view === 'HIDDEN'
          ? preference.hidden
          : view === 'FOCUSED'
            ? preference.pinned && !preference.hidden
            : !preference.hidden;
      return ok({
        tenantId: tenant,
        view,
        date: u.searchParams.get('date'),
        zone: u.searchParams.get('zone'),
        items: visible ? [card] : [],
        hasMore: false,
      });
    }
    if (/\/briefing\/[^/]+$/.test(path) && method === 'POST') {
      Object.assign(preference, {
        revision: preference.revision + 1,
        pinned: body.pinned,
        hidden: body.hidden,
        size: body.size,
      });
      return ok(preference);
    }
    if (path.endsWith('/feedback') && method === 'GET') return ok({ feedback: null });
    unknown.push(method + ' ' + path);
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ contractVersion: '1.0', code: 'NOT_FOUND' }),
    });
  });
  await page.goto(url + 'tests/fixtures/live-briefing/');
  const cards = page.locator('.recommendation-card');
  await expect(page.getByRole('tab', { name: '推荐', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: '类型', exact: true })).toBeDisabled();
  await expect(cards).toHaveCount(20);
  const before = await cards.evaluateAll((xs) =>
    xs.map((x) => ({
      id: x.getAttribute('data-content-id'),
      top: x.getBoundingClientRect().top,
      left: x.getBoundingClientRect().left,
    })),
  );
  for (let n = 0; n < 5; n++) {
    await cards.nth(n).getByRole('button').click();
    await expect(page.locator('.live-reading-dialog')).toContainText('已核对的完整原文');
    await expect(cards.nth(n)).toHaveAttribute('data-read', 'true');
    await page.getByRole('button', { name: '关闭卡片详情', exact: true }).click();
  }
  assert.equal(opened.size, 5);
  const after = await cards.evaluateAll((xs) =>
    xs.map((x) => ({
      id: x.getAttribute('data-content-id'),
      top: x.getBoundingClientRect().top,
      left: x.getBoundingClientRect().left,
    })),
  );
  assert.deepEqual(after, before, 'Read state must not change order or grid positions');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(cards).toHaveCount(3);
  assert.ok(requests.some((r) => r.path.includes('offset=20') && r.path.includes('snapshot=' + snapshot)));
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await expect(cards).toHaveCount(20);
  changedTask = true;
  await cards.nth(5).getByRole('button').click();
  await expect(page.locator('.live-reading-dialog')).toContainText('这份成果已更新');
  await expect(page.locator('.live-reading-dialog')).not.toContainText('已核对的完整原文');
  assert.equal(opened.size, 5);
  await page.getByRole('button', { name: '关闭卡片详情', exact: true }).click();
  changedTask = false;
  restricted = true;
  await cards.nth(5).getByRole('button').click();
  await expect(page.locator('.live-reading-dialog')).toContainText('资料权限已变化');
  await expect(page.locator('.live-reading-dialog')).not.toContainText('已核对的完整原文');
  assert.equal(opened.size, 5);
  await page.getByRole('button', { name: '关闭卡片详情', exact: true }).click();
  restricted = false;
  await page.locator('.recommendation-options summary').click();
  await page.getByRole('button', { name: '关闭一般推荐', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试本次设置', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '关注', exact: true })).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('button', { name: '重试本次设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '一般推荐已关闭', exact: true })).toBeVisible();
  assert.equal(settingKeys.length, 2);
  assert.equal(settingKeys[0], settingKeys[1]);
  await page.getByRole('button', { name: '开启一般推荐', exact: true }).click();
  await expect(cards).toHaveCount(20);
  await page.getByRole('tab', { name: '日期', exact: true }).click();
  await page.getByLabel('查看日期', { exact: true }).fill('2026-10-01');
  await expect(page.locator('.live-briefing-card')).toHaveCount(1);
  assert.ok(requests.some((r) => r.path.includes('/briefing?') && r.path.includes('date=2026-10-01')));
  await page.getByRole('tab', { name: '空间', exact: true }).click();
  await page.getByLabel('工作空间', { exact: true }).selectOption(workspace);
  await expect(cards).toHaveCount(20);
  assert.ok(
    requests.some((r) => r.path.includes('/recommendations?') && r.path.includes('workspaceId=' + workspace)),
  );
  await page.screenshot({ path: resolve(artifacts, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await cards.first().getByRole('button').click();
  await expect(page.locator('.live-reading-dialog')).toContainText('已核对的完整原文');
  await expect(page.getByRole('link', { name: '继续会话', exact: true })).toHaveAttribute(
    'href',
    new RegExp('briefingTask=' + uid(100)),
  );
  await page.getByRole('button', { name: '评价 / 建议', exact: true }).click();
  await expect(page.locator('.feedback-panel')).toContainText('这条画报对你有用吗');
  await page.screenshot({ path: resolve(artifacts, 'mobile-reader.png'), fullPage: false });
  await page.getByRole('button', { name: '关闭卡片详情', exact: true }).click();
  await page.screenshot({ path: resolve(artifacts, 'mobile.png'), fullPage: true });
  assert.deepEqual(unknown, [], 'Every API request must remain inside the synthetic fixture');
  console.log(
    JSON.stringify({
      status: 'passed',
      checks: [
        'default recommended',
        'unsupported type disabled',
        'five exact task readers',
        'read order and grid stable',
        'snapshot pagination',
        'revision mismatch blocked',
        'source permission blocked',
        'settings lost receipt same key',
        'server date and workspace filtering',
        'feedback entry',
        'mobile fit',
      ],
      artifacts,
    }),
  );
} finally {
  await browser.close();
  await server.close();
}
