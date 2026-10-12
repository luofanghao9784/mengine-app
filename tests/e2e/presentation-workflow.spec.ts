import { test, expect } from '@playwright/test';
import type { ConversationTask } from '../../contracts/public-api/conversation';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  account = id(2),
  space = id(3),
  conversation = id(4),
  taskId = id(5);
test('PPT entry, persisted outline, title/order editing, uncertain confirmation retry and mobile layout', async ({
  page,
}) => {
  const now = '2026-10-12T00:00:00Z';
  const info = {
    id: conversation,
    tenantId: tenant,
    workspaceId: space,
    title: '合成季度汇报',
    updatedAt: now,
  };
  const task: ConversationTask = {
    id: taskId,
    prompt: '季度汇报',
    mode: 'AGENT',
    status: 'WAITING_INPUT',
    waitReason: 'PRESENTATION_CONFIRMATION',
    revision: 2,
    attempt: 1,
    summaryCode: null,
    errorCode: null,
    engineVersion: 'test',
    sourcesUnavailable: false,
    sources: [],
    createdAt: now,
    reply: 'PPT 大纲已准备好，请确认。',
    executionClass: 'live',
    modelName: 'synthetic',
    artifacts: [],
    publicQuery: null,
    webSources: [],
    skills: [{ id: 'pptx-generator', version: '1.0.0', sha256: 'a'.repeat(64) }],
    originals: [],
  };
  const spec = {
    title: '季度汇报',
    theme: 'ocean',
    slides: [
      { kind: 'cover', title: '季度汇报封面', subtitle: '合成验收资料', sourceIds: [] },
      { kind: 'bullets', title: '工作进展', bullets: ['完成首批试点', '下月安排复盘'], sourceIds: [] },
    ],
  };
  let sent: any,
    confirmations: any[] = [],
    fail = true;
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === '/api/v1/me')
      return json({
        account: { id: account, phone: '+8619900009001', displayName: '合成成员' },
        platformAdmin: false,
        memberships: [{ tenantId: tenant, tenantName: '合成企业', role: 'MEMBER' }],
      });
    if (path.endsWith('/phone/configuration')) return json({ delivery: 'DISABLED', localPreview: false });
    if (path.endsWith('/auth/csrf')) return json({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' });
    if (path.endsWith('/context'))
      return json({
        tenant: { id: tenant, name: '合成企业', status: 'ACTIVE' },
        role: 'MEMBER',
        workspaces: [{ id: space, name: '个人空间', kind: 'PERSONAL' }],
      });
    if (path.endsWith('/presentation-capability')) return json({ available: true });
    if (path.endsWith('/presentation/confirm')) {
      confirmations.push(req.postDataJSON());
      if (fail) {
        fail = false;
        return route.abort('failed');
      }
      task.status = 'QUEUED';
      task.revision++;
      return json({ conversation: info, tasks: [task], cursor: 2, hasMore: false });
    }
    if (path.endsWith('/presentation'))
      return json({ state: 'DRAFT', revision: 1, spec, options: { pages: 2, theme: 'ocean' } });
    if (path.endsWith('/conversations') && req.method() === 'POST') {
      sent = req.postDataJSON();
      return json({ conversation: info, tasks: [task], cursor: 1, hasMore: false }, 202);
    }
    if (path.endsWith('/conversations'))
      return json({
        tenantId: tenant,
        enabled: true,
        agentMode: 'live',
        publicWebEnabled: false,
        items: sent ? [info] : [],
        hasMore: false,
      });
    if (path.endsWith('/conversations/' + conversation))
      return json({ conversation: info, tasks: [task], cursor: 1, hasMore: false });
    if (path.endsWith('/events'))
      return json({ conversationId: conversation, items: [], cursor: 1, hasMore: false });
    if (path.endsWith('/stream'))
      return route.fulfill({
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ conversationId: conversation, items: [] })}\n\n`,
      });
    if (path.endsWith('/live')) return json({ conversationId: conversation, items: [] });
    if (path.endsWith('/work-receipts')) return json({ checks: [], preferences: [], hasMore: false });
    if (path.endsWith('/plan-receipts')) return json([]);
    return json({ items: [], hasMore: false });
  });
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations`);
  await page.getByRole('button', { name: '技能：PPT 生成' }).click();
  await page.getByLabel('PPT 页数').selectOption('2');
  await page.getByLabel('工作要求', { exact: true }).fill('季度汇报');
  await page.getByRole('button', { name: '开始任务', exact: true }).click();
  await expect(page.getByRole('region', { name: 'PPT 大纲确认' })).toBeVisible();
  expect(sent.presentation).toEqual({ pages: 2, theme: 'ocean' });
  await page.reload();
  await expect(page.getByLabel('演示标题')).toHaveValue('季度汇报');
  await page.getByLabel('演示标题').fill('确认后的季度汇报');
  await page.getByRole('button', { name: '上移第 2 页' }).click();
  await page.getByLabel('第 1 页标题').fill('先看工作进展');
  await page.getByRole('button', { name: '确认大纲并生成 PPT' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.local/ppt-renderer/workflow-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '确认大纲并生成 PPT' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: '确认大纲并生成 PPT' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.local/ppt-renderer/workflow-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '确认大纲并生成 PPT' }).click();
  await expect(page.getByRole('button', { name: '重试本次确认' })).toBeVisible();
  await page.getByRole('button', { name: '重试本次确认' }).click();
  await expect(page.getByRole('region', { name: 'PPT 大纲确认' })).toHaveCount(0);
  expect(confirmations).toHaveLength(2);
  expect(confirmations[0]).toEqual(confirmations[1]);
  expect(confirmations[0].slides).toEqual([
    { index: 1, title: '先看工作进展' },
    { index: 0, title: '季度汇报封面' },
  ]);
});
