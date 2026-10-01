/** Real workspace components with synthetic HTTP data; no customer data or model calls. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = uid(1),
  workspace = uid(2),
  account = uid(3),
  conversation = uid(4),
  taskId = uid(5),
  now = '2026-10-01T01:00:00Z';
const sources = [6, 7].map((n) => ({
  id: uid(n),
  tenantId: tenant,
  workspaceId: workspace,
  materialId: uid(n + 10),
  versionId: uid(n + 20),
  runId: uid(n + 30),
  version: 1,
  filename: n === 6 ? '本周经营记录.md' : '门店行动方案.md',
  locator: '第 1 段',
  content:
    `合成资料 ${n}：确认本周重点，按任务核对实际进度。\n` +
    '这段材料用于验证独立阅读与滚动保留。\n'.repeat(50),
  method: 'TEXT',
}));
const convo = {
  id: conversation,
  tenantId: tenant,
  workspaceId: workspace,
  title: '本周经营分析与行动建议',
  updatedAt: now,
};
const task = {
  id: taskId,
  prompt: '请结合经营记录，整理本周的重点和下一步行动。',
  mode: 'AGENT',
  status: 'SUCCEEDED',
  revision: 3,
  attempt: 1,
  reply:
    '## 本周工作重点\n根据现有资料，建议先核对已确认的业务事实，再安排后续工作。\n\n### 下一步行动\n- 汇总各门店进度\n- 核对待确认事项\n- 明确责任人和交付日期\n\n以上是合成验收内容。',
  executionClass: 'verification',
  modelName: 'synthetic',
  engineVersion: 'fixture-v1',
  originals: [],
  publicQuery: null,
  webSources: [],
  skills: [],
  artifacts: [],
  sources,
  sourcesUnavailable: false,
  summaryCode: null,
  errorCode: null,
  createdAt: now,
};
const content = {
  kind: 'TASK',
  id: taskId,
  versionKey: `task:${taskId}:3:1`,
  workspaceId: workspace,
  workspaceName: '个人空间',
  title: convo.title,
  excerpt: '结合经营记录，整理本周重点与下一步行动。',
  truncated: true,
  createdAt: now,
  executionClass: 'verification',
  conversationId: conversation,
  taskRevision: 3,
  attempt: 1,
  preferenceRevision: 0,
  materialId: null,
  materialVersion: 0,
  filename: '',
  pinned: false,
  openedAt: null,
};
const item = {
  content,
  score: 0.8,
  method: {
    versionId: null,
    adoptionRevision: 0,
    scope: 'BUILTIN',
    workspaceId: null,
    configurationSha: 'a'.repeat(64),
  },
  presentation: { renderer: 'source-preserving-v1', style: 'DEFAULT', profileId: null, profileRevision: 0 },
  reason: '合成排序',
  availability: 'AVAILABLE_IN_APP',
  feedbackTarget: {
    kind: 'BRIEFING',
    taskId,
    taskRevision: 3,
    attempt: 1,
    presentationVersion: 'recommendation-v1',
    presentationRevision: 1,
  },
};
const writes: any[] = [],
  unknown: string[] = [],
  errors: string[] = [];
let restricted = false,
  changed = false,
  lostReply = true;
const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls!.local[0],
  artifacts = resolve('.local/verification/conversation-demo-alignment');
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      u = new URL(req.url()),
      path = u.pathname,
      method = req.method();
    const ok = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/v1/me')
      return ok({
        account: { id: account, email: 'fixture@example.test', displayName: '合成验收用户' },
        platformAdmin: false,
        memberships: [{ tenantId: tenant, tenantName: '合成企业', role: 'MEMBER' }],
      });
    if (path.endsWith('/auth/csrf')) return ok({ token: 'fixture', headerName: 'X-CSRF-TOKEN' });
    if (path.endsWith('/context'))
      return ok({
        tenant: { id: tenant, name: '合成企业', status: 'ACTIVE' },
        role: 'MEMBER',
        workspaces: [{ id: workspace, name: '个人空间', kind: 'PERSONAL' }],
      });
    if (path.endsWith('/governance'))
      return ok({
        tenantId: tenant,
        ownerId: account,
        revision: 0,
        owner: false,
        canConfigure: false,
        canAcceptInitialResponsibility: false,
        canEnterManagement: false,
        capabilities: [],
        pendingHandover: null,
      });
    if (path.endsWith('/business-status'))
      return ok({
        tenantId: tenant,
        businessEnabled: true,
        canExport: false,
        exitState: null,
        exportDeadline: null,
      });
    if (path.endsWith('/attention'))
      return ok({ tenantId: tenant, scope: 'MINE', total: 0, checkedAt: now, items: [], hasMore: false });
    if (path.endsWith('/forwarding/inbox')) return ok({ items: [], hasMore: false });
    if (path.endsWith('/recommendations'))
      return ok({
        tenantId: tenant,
        items: [item],
        settings: { revision: 0, enabled: true },
        snapshot: 'a'.repeat(64),
        hasMore: false,
        eligibleTotal: 1,
        rankedCount: 1,
        poolLimited: false,
        poolLimit: 1000,
        businessOutcome: 'NOT_ASSESSED',
      });
    if (path.endsWith('/recommendations/opened'))
      return ok({
        target: req.postDataJSON(),
        openedAt: now,
        evidence: 'USER_OPEN_ACTION',
        businessOutcome: 'NOT_ASSESSED',
      });
    if (path.endsWith('/conversations') && method === 'GET')
      return ok({
        tenantId: tenant,
        items: [convo],
        enabled: true,
        agentMode: 'verification',
        publicWebEnabled: false,
        hasMore: false,
      });
    if (/\/conversations(?:\/[^/]+\/tasks)?$/.test(path) && method === 'POST') {
      writes.push(req.postDataJSON());
      if (lostReply) {
        lostReply = false;
        return route.abort('failed');
      }
      return ok({ conversation: convo, tasks: [task], cursor: 0, hasMore: false }, 202);
    }
    if (path.endsWith('/events'))
      return restricted
        ? ok({ code: 'CONVERSATION_NOT_FOUND', contractVersion: '1.0' }, 404)
        : ok({ conversationId: conversation, items: [], cursor: 0, hasMore: false });
    if (/\/conversations\/[^/]+(?:\/tasks\/[^/]+)?$/.test(path))
      return ok({
        conversation: convo,
        tasks: [{ ...task, revision: changed ? 4 : 3, sourcesUnavailable: restricted }],
        cursor: 0,
        hasMore: false,
      });
    if (path.includes('/knowledge/chunks/'))
      return restricted
        ? ok({ code: 'MATERIAL_NOT_FOUND', contractVersion: '1.0' }, 404)
        : ok(sources.find((s) => path.endsWith(s.id)));
    if (path.endsWith('/work-receipts')) return ok({ checks: [], preferences: [], hasMore: false });
    if (path.endsWith('/feedback') && method === 'GET') return ok({ feedback: null });
    unknown.push(method + ' ' + path);
    return ok({ code: 'NOT_FOUND', contractVersion: '1.0' }, 404);
  });
  await page.goto(url + 'workspace/#tenant=' + tenant);
  await expect(page.getByRole('tab', { name: '推荐', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const launcher = page.getByLabel('新的工作需求', { exact: true });
  await launcher.dispatchEvent('compositionstart');
  await launcher.fill('保留草稿，展开后才发送');
  await expect(launcher).toBeVisible();
  assert.equal(writes.length, 0);
  await launcher.dispatchEvent('compositionend', { data: '保留草稿，展开后才发送' });
  await expect(page.getByLabel('工作要求', { exact: true })).toBeFocused();
  await expect(page.getByLabel('工作要求', { exact: true })).toHaveValue('保留草稿，展开后才发送');
  await expect(page.getByLabel('任务方式', { exact: true })).toHaveCount(0);
  assert.equal(writes.length, 0);
  await expect(page.locator('.live-viewport-morph')).toHaveCount(0);
  await expect
    .poll(() => page.locator('[data-deck-id=conversation]').evaluate((e) => getComputedStyle(e).opacity))
    .toBe('1');
  await page.screenshot({ path: resolve(artifacts, 'new-conversation-desktop.png') });
  await page.getByRole('button', { name: '开始任务', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试上次发送', exact: true })).toBeEnabled();
  await page.reload();
  await page.getByRole('button', { name: '重试上次发送', exact: true }).click();
  await expect(page).toHaveURL(/conversation=/);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].mode, 'AGENT');
  assert.deepEqual(writes[0], writes[1]);
  await page.getByRole('button', { name: '新会话', exact: true }).click();
  await expect(page).toHaveURL(/from=briefing/);
  await page.getByRole('link', { name: convo.title, exact: true }).click();
  await expect(page).toHaveURL(/from=briefing/);
  await expect(page.locator('.workspace-briefing-background')).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '关闭会话视窗', exact: true }).click();
  await page.locator('.recommendation-card').getByRole('button').first().click();
  await expect(page.locator('.live-reading-dialog')).toContainText('本周工作重点');
  await page.getByRole('link', { name: '继续会话', exact: true }).click();
  await expect(page.locator('[data-deck-id="briefing"]')).toContainText('本周工作重点');
  await expect(page.getByLabel('工作要求', { exact: true })).toBeVisible();
  assert.equal(await page.locator('.workspace-briefing-background').count(), 1);
  await page.getByLabel('工作要求', { exact: true }).fill('资料对照时保持这个草稿');
  const rail = page.locator('.live-demo-deck .deck-scroller');
  for (let i = 0; i < 2; i++) {
    // Reveal the conversation before activating its source, just as an ordinary first tap does.
    await rail.evaluate((e) => {
      e.scrollLeft = 0;
    });
    const source = page.locator('.conversation-sources button').nth(i);
    await source.click();
    if (!(await page.locator(`[data-deck-id="${sources[i].id}"]`).count())) await source.click();
    await expect(page.locator(`[data-deck-id="${sources[i].id}"]`)).toContainText('合成资料');
  }
  await expect(rail.locator('.deck-card')).toHaveCount(5);
  await page.screenshot({ path: resolve(artifacts, 'stacked-cards-desktop.png') });
  const reader = page.locator(`[data-deck-id="${sources[1].id}"]`);
  await reader.locator('.live-source-reader').evaluate((e) => {
    e.scrollTop = 100;
    e.setAttribute('data-retained', 'yes');
  });
  await reader.getByRole('button', { name: /^全屏查看/ }).click();
  const modal = page.getByRole('dialog', { name: /资料来源 门店/ });
  await expect(modal).toBeVisible();
  assert.ok(await modal.evaluate((e) => e.matches(':popover-open')));
  assert.ok(
    await modal.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    }),
  );
  for (const key of ['Tab', 'Shift+Tab', 'Tab', 'Tab']) {
    await page.keyboard.press(key);
    assert.ok(await modal.evaluate((e) => e.contains(document.activeElement)));
  }
  await page.screenshot({ path: resolve(artifacts, 'material-fullscreen.png') });
  await page.keyboard.press('Escape');
  await expect(reader.locator('.live-source-reader')).toHaveAttribute('data-retained', 'yes');
  assert.ok((await reader.locator('.live-source-reader').evaluate((e) => e.scrollTop)) > 0);
  await reader.locator('.deck-card-header').focus();
  await page.keyboard.press('Alt+Home');
  await expect(rail.locator('.deck-card').nth(1)).toHaveAttribute('data-deck-id', sources[1].id);
  await expect(reader.locator('.live-source-reader')).toHaveAttribute('data-retained', 'yes');
  await page.setViewportSize({ width: 390, height: 844 });
  const tabs = page.getByLabel('会话卡片切换', { exact: true });
  await tabs.getByRole('button', { name: '对话', exact: true }).click();
  await expect(page.getByLabel('工作要求', { exact: true })).toHaveValue('资料对照时保持这个草稿');
  await page.screenshot({ path: resolve(artifacts, 'conversation-mobile.png') });
  await tabs.getByRole('button', { name: '画报卡片', exact: true }).click();
  await expect(page.locator('[data-deck-id="briefing"]')).toBeVisible();
  await tabs.getByRole('button', { name: /资料来源 门店/ }).click();
  await expect(reader).toBeVisible();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: resolve(artifacts, 'material-mobile.png') });
  await reader.getByRole('button', { name: /^关闭资料来源/ }).click();
  await expect(page.getByLabel('工作要求', { exact: true })).toBeVisible();
  // A changed result cannot be presented under the original briefing version.
  changed = true;
  await page.reload();
  await tabs.getByRole('button', { name: '画报卡片', exact: true }).click();
  await expect(page.locator('[data-deck-id="briefing"]')).toContainText('已更新');
  await expect(page.locator('[data-deck-id="briefing"]')).not.toContainText('本周工作重点');
  // Revocation from the live event permission check clears all readers and message content.
  restricted = true;
  await expect(page.locator('.live-demo-deck')).toHaveCount(0, { timeout: 10000 });
  assert.deepEqual(unknown, []);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: IME draft handoff + normal motion, contextual navigation, natural-language send + uncertain retry, briefing handoff/version guard, multiple readers, same-node fullscreen, reorder, mobile tabs, permission revocation.',
  );
} catch (error) {
  console.error({ unknown, errors });
  throw error;
} finally {
  await browser.close();
  await server.close();
}
