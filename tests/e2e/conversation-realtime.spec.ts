import { test, expect, type Page } from '@playwright/test';
import type { ConversationTask, LiveTask } from '../../contracts/public-api/conversation';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  account = id(2),
  space = id(3),
  conversation = id(4),
  taskId = id(5);
async function fixture(page: Page) {
  const task: ConversationTask = {
    id: taskId,
    prompt: '分析这份合成资料',
    mode: 'AGENT',
    status: 'RUNNING',
    revision: 1,
    attempt: 1,
    summaryCode: null,
    errorCode: null,
    engineVersion: '0.15.4',
    sourcesUnavailable: false,
    sources: [],
    createdAt: '2026-10-03T00:00:00Z',
    reply: null,
    executionClass: 'live',
    modelName: 'synthetic',
    artifacts: [],
    publicQuery: null,
    webSources: [],
    skills: [],
    originals: [],
  };
  const live: LiveTask = {
    taskId,
    attempt: 1,
    status: 'RUNNING',
    enabled: true,
    stopping: false,
    outputs: [{ step: 1, version: 1, text: '正在核对合成资料。', state: 'STREAMING' }],
    inputs: [],
    tools: [{ sequence: 1, name: 'search_sources', status: 'STARTED' }],
    questions: [],
  };
  const info = {
    id: conversation,
    tenantId: tenant,
    workspaceId: space,
    title: '实时会话合成验收',
    updatedAt: task.createdAt,
  };
  let cursor = 1,
    deny = false,
    streamFail = false;
  const sends: unknown[] = [];
  await page.route('**/api/**', async (route) => {
    const r = route.request(),
      path = new URL(r.url()).pathname;
    let json: unknown;
    if (path === '/api/v1/me')
      json = {
        account: { id: account, phone: '+8619900009001', displayName: '合成成员' },
        platformAdmin: false,
        memberships: [{ tenantId: tenant, tenantName: '合成企业', role: 'MEMBER' }],
      };
    else if (path.endsWith('/phone/configuration')) json = { delivery: 'DISABLED', localPreview: false };
    else if (path.endsWith('/context'))
      json = {
        tenant: { id: tenant, name: '合成企业', status: 'ACTIVE' },
        role: 'MEMBER',
        workspaces: [{ id: space, name: '个人空间', kind: 'PERSONAL' }],
      };
    else if (path.endsWith('/auth/csrf')) json = { headerName: 'X-CSRF-TOKEN', token: 'synthetic' };
    else if (path.endsWith('/stream')) {
      if (deny) return route.fulfill({ status: 403, json: { code: 'ACCESS_DENIED' } });
      if (streamFail) return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } });
      return route.fulfill({
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ conversationId: conversation, items: [live] })}\n\n`,
      });
    } else if (path.endsWith('/live')) json = { conversationId: conversation, items: [live] };
    else if (path.endsWith('/inputs')) {
      const body = r.postDataJSON();
      sends.push(body);
      live.inputs.push({ id: body.requestId, text: body.text, applied: false, attempt: 1 });
      if (body.questionId) live.questions[0].answered = true;
      json = { accepted: true };
    } else if (path.endsWith('/tasks/' + taskId) && r.method() === 'POST') {
      live.stopping = true;
      json = { conversation: info, tasks: [task], cursor, hasMore: false };
    } else if (path.endsWith('/conversations'))
      json = {
        tenantId: tenant,
        enabled: true,
        agentMode: 'live',
        publicWebEnabled: false,
        items: [info],
        hasMore: false,
      };
    else if (path.endsWith('/conversations/' + conversation))
      json = { conversation: info, tasks: [task], cursor, hasMore: false };
    else if (path.endsWith('/events'))
      json = {
        conversationId: conversation,
        items: [{ seq: cursor, taskId, kind: task.status, revision: task.revision }],
        cursor,
        hasMore: false,
      };
    else if (path.endsWith('/plan-receipts')) json = [];
    else if (path.endsWith('/work-receipts')) json = { checks: [], preferences: [], hasMore: false };
    else if (path.endsWith('/attempts')) json = { taskId, items: [], hasMore: false };
    else json = { items: [], hasMore: false };
    return route.fulfill({ json });
  });
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations&conversation=${conversation}`);
  await expect(page.getByText(task.prompt, { exact: true })).toBeVisible();
  return {
    task,
    live,
    sends,
    change() {
      cursor++;
    },
    deny() {
      deny = true;
    },
    fallback() {
      streamFail = true;
    },
  };
}
test('more reply actions appear only after the task finishes, including after a retry', async ({ page }) => {
  const f = await fixture(page);
  const more = page.getByRole('button', { name: '更多回复操作', exact: true });
  await expect(page.getByRole('button', { name: '停止执行', exact: true })).toBeVisible();
  await expect(more).toHaveCount(0);
  await page.screenshot({ path: '.local/reply-more-20261005/生成中.png' });
  f.task.status = f.live.status = 'WAITING_INPUT';
  f.change();
  await expect(page.getByRole('button', { name: '停止执行', exact: true })).toHaveCount(0);
  await expect(more).toHaveCount(0);
  f.task.status = f.live.status = 'SUCCEEDED';
  f.task.reply = '已完成的回答';
  f.change();
  await expect(more).toBeVisible();
  f.task.status = f.live.status = 'RUNNING';
  f.task.attempt = f.live.attempt = 2;
  f.change();
  await expect(more).toHaveCount(0);
  f.task.status = f.live.status = 'FAILED';
  f.change();
  await expect(more).toBeVisible();
});
test('incremental answer, supplement receipt/adoption, and confirmed stop', async ({ page }) => {
  const f = await fixture(page);
  await expect(page.getByText('正在核对合成资料。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /检索资料/ })).toBeVisible();
  await page.getByLabel('补充要求', { exact: true }).fill('只分析本期');
  await page.getByRole('button', { name: '发送补充', exact: true }).click();
  await expect(page.getByText('已收到，等待采用')).toBeVisible();
  expect(f.sends).toHaveLength(1);
  f.live.inputs[0].applied = true;
  f.live.outputs[0].text = '已采用本期口径，正在继续分析。';
  f.live.outputs[0].version++;
  await expect(page.getByText('已采用', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '停止任务', exact: true }).click();
  await expect(page.getByRole('button', { name: '正在停止…', exact: true })).toBeDisabled();
  expect(f.task.status).toBe('RUNNING');
  f.task.status = 'CANCELLED';
  f.live.status = 'CANCELLED';
  f.task.revision++;
  f.change();
  await expect(page.getByText('已取消', { exact: true })).toBeVisible();
  await expect(page.getByText('未完成的回复')).toBeVisible();
});
test('question requires explicit answer, supports free text and no duplicate controls', async ({ page }) => {
  const f = await fixture(page);
  f.task.status = 'WAITING_INPUT';
  f.live.status = 'WAITING_INPUT';
  f.task.requiredInput = '要分析哪个期间？';
  f.live.questions = [
    { id: id(9), text: '要分析哪个期间？', options: ['本期', '上期'], blocking: true, answered: false },
  ];
  f.change();
  await expect(page.getByText('等待你的回答后继续')).toBeVisible();
  expect(f.sends).toHaveLength(0);
  await page.getByRole('button', { name: '上期', exact: true }).click();
  await page.getByLabel('回答 AI 的问题').fill('上期，排除退款');
  await page.getByRole('button', { name: '提交答案', exact: true }).click();
  await expect(page.getByText('回答已收到')).toBeVisible();
  expect(f.sends).toHaveLength(1);
  expect(f.sends[0]).toMatchObject({ text: '上期，排除退款', questionId: id(9), attempt: 1 });
  f.task.status = 'RUNNING';
  f.live.status = 'RUNNING';
  f.task.attempt = f.live.attempt = 2;
  f.live.inputs = [{ id: id(10), text: '上期，排除退款', applied: false, attempt: 1, resumeAnswer: true }];
  f.change();
  await expect(page.getByText('已收到，等待采用')).toBeVisible();
});
test('reading older content holds position; completion does not duplicate final answer', async ({ page }) => {
  const f = await fixture(page);
  f.live.outputs[0].text = Array.from({ length: 35 }, (_, i) => `合成分析第 ${i + 1} 段。`).join('\n\n');
  f.live.outputs[0].version++;
  const scroller = page.locator('.conversation-messages');
  await expect.poll(() => scroller.evaluate((n) => n.scrollTop)).toBeGreaterThan(50);
  await scroller.evaluate((n) => {
    n.scrollTop = 20;
    n.dispatchEvent(new Event('scroll'));
  });
  f.live.outputs[0].text += '\n\n新到达的内容。';
  f.live.outputs[0].version++;
  await expect(page.getByRole('button', { name: '有新内容 ↓' })).toBeVisible();
  expect(await scroller.evaluate((n) => n.scrollTop)).toBeLessThan(40);
  await page.getByRole('button', { name: '有新内容 ↓' }).click();
  await expect
    .poll(() => scroller.evaluate((n) => n.scrollHeight - n.scrollTop - n.clientHeight))
    .toBeLessThan(50);
  f.task.reply = '唯一的最终结论';
  f.task.status = 'SUCCEEDED';
  f.live.status = 'SUCCEEDED';
  f.live.outputs[0].text = '唯一的最终结论';
  f.change();
  await expect(page.getByText('唯一的最终结论', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /查看处理过程/ })).toHaveAttribute('aria-expanded', 'false');
  await page.screenshot({ path: '.local/realtime-conversation-desktop.png' });
});
test('fallback keeps actual state, revocation clears visible content', async ({ page }) => {
  const f = await fixture(page);
  f.fallback();
  f.live.outputs[0].text = '轮询恢复的真实结果';
  f.live.outputs[0].version++;
  await expect(page.getByText('轮询恢复的真实结果')).toBeVisible();
  f.deny();
  await expect(page.getByText('轮询恢复的真实结果')).toHaveCount(0);
});
test('narrow screen keeps supplement and question actions reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await fixture(page);
  await page.getByLabel('补充要求', { exact: true }).fill('移动端补充');
  await page.getByRole('button', { name: '发送补充', exact: true }).click();
  await expect(page.getByText('已收到，等待采用')).toBeVisible();
  expect(f.sends).toHaveLength(1);
  await page.screenshot({ path: '.local/realtime-conversation-mobile.png' });
});


test('task updates refresh the list without showing initial loading text', async ({ page }) => {
  const f = await fixture(page);
  const row = page.getByRole('link', { name: '实时会话合成验收', exact: true });
  await expect(row).toBeVisible();
  let waiting = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/**', async (route) => {
    if (!new URL(route.request().url()).pathname.endsWith('/conversations')) return route.fallback();
    waiting = true;
    await gate;
    await route.fallback();
  });
  try {
    f.task.revision++;
    f.change();
    await expect.poll(() => waiting).toBe(true);
    await expect(row).toBeVisible();
    await expect(page.getByText('正在加载会话…', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: '.local/conversation-list-stable-20261006/更新中.png' });
  } finally {
    release();
  }
  await expect(row).toBeVisible();
});
