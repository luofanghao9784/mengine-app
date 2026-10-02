import { test, expect, type Page, type Route } from '@playwright/test';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = uid(1),
  account = uid(2),
  space = uid(3),
  conversation = uid(4),
  taskId = uid(5);
const now = '2026-10-02T00:00:00Z';
const home = `/workspace/#tenant=${tenant}&view=briefing`;
const info = {
  id: conversation,
  tenantId: tenant,
  workspaceId: space,
  title: '合成发送验证',
  updatedAt: now,
};
const task = (prompt: string) => ({
  id: taskId,
  prompt,
  mode: 'AGENT',
  status: 'WAITING_CAPABILITY',
  revision: 1,
  attempt: 0,
  summaryCode: null,
  errorCode: null,
  engineVersion: null,
  sourcesUnavailable: false,
  sources: [],
  createdAt: now,
  reply: null,
  executionClass: null,
  modelName: null,
  artifacts: [],
  publicQuery: null,
  webSources: [],
  skills: [],
  originals: [],
  waitReason: 'AGENT_DISABLED',
  requiredInput: null,
  reconciliationRequired: false,
});
async function fixture(page: Page, send: (route: Route, body: Record<string, unknown>) => Promise<void>) {
  const requests: URL[] = [];
  let prompt = '';
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    requests.push(url);
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
    else if (path.endsWith('/auth/csrf')) json = { headerName: 'X-CSRF-TOKEN', token: 'synthetic-csrf' };
    else if (path.endsWith('/conversations') && request.method() === 'POST') {
      const body = request.postDataJSON();
      prompt = body.prompt;
      expect(request.headers()['x-csrf-token']).toBe('synthetic-csrf');
      return send(route, body);
    } else if (path.endsWith('/conversations'))
      json = {
        tenantId: tenant,
        enabled: true,
        agentMode: 'off',
        publicWebEnabled: false,
        items: prompt ? [info] : [],
        hasMore: false,
      };
    else if (path.endsWith('/conversations/' + conversation))
      json = {
        conversation: info,
        tasks: [task(prompt)],
        hasMore: false,
        cursor: 1,
      };
    else if (path.endsWith('/events'))
      json = { conversationId: conversation, items: [], cursor: 1, hasMore: false };
    else if (path.endsWith('/plan-receipts')) json = [];
    else if (path.endsWith('/recommendations'))
      json = {
        tenantId: tenant,
        settings: { revision: 0, enabled: true },
        items: [],
        snapshot: 'a'.repeat(64),
        hasMore: false,
        eligibleTotal: 0,
        rankedCount: 0,
        poolLimited: false,
        poolLimit: 1000,
        businessOutcome: 'NOT_ASSESSED',
      };
    else if (path.endsWith('/briefing/layout')) json = { tenantId: tenant, revision: 0 };
    else if (path.endsWith('/briefing'))
      json = {
        tenantId: tenant,
        view: url.searchParams.get('view'),
        date: url.searchParams.get('date'),
        zone: url.searchParams.get('zone'),
        items: [],
        hasMore: false,
        asOf: now,
      };
    else if (path.endsWith('/briefing/generation')) json = { policies: [], batches: [] };
    else return route.fulfill({ status: 404, json: { code: 'FIXTURE_UNAVAILABLE' } });
    return route.fulfill({ json });
  });
  return requests;
}
const accepted = (route: Route, body: Record<string, unknown>) =>
  route.fulfill({
    status: 201,
    json: { conversation: info, tasks: [task(String(body.prompt))], hasMore: false, cursor: 1 },
  });

const item = (id: string, title: string) => ({
  content: {
    kind: 'TASK',
    id,
    versionKey: `task:${id}:1:1`,
    workspaceId: space,
    workspaceName: '个人空间',
    title,
    excerpt: '依据资料得到的新发现，可以继续阅读。',
    truncated: false,
    createdAt: now,
    executionClass: 'verification',
    conversationId: conversation,
    taskRevision: 1,
    attempt: 1,
    preferenceRevision: 0,
    materialId: null,
    materialVersion: 0,
    filename: '',
    pinned: false,
    openedAt: null,
  },
  score: 0.5,
  method: {
    versionId: null,
    adoptionRevision: 0,
    scope: 'BUILTIN',
    workspaceId: null,
    configurationSha: 'a'.repeat(64),
  },
  presentation: { renderer: 'source-preserving-v1', style: 'DEFAULT', profileId: null, profileRevision: 0 },
  reason: '',
  availability: 'AVAILABLE_IN_APP',
  feedbackTarget: {
    kind: 'BRIEFING',
    taskId: id,
    taskRevision: 1,
    attempt: 1,
    presentationVersion: 'recommendation-v1',
    presentationRevision: 1,
  },
});
const oldCard = item(uid(21), '已有经营发现'),
  newCard = item(uid(22), '新增经营发现');
const batch = (status = 'RUNNING', reason: string | null = null) => ({
  id: uid(30),
  workspaceId: space,
  trigger: 'GENERATE_MORE',
  businessType: null,
  status,
  reason,
  taskId: uid(22),
  cardIds: status === 'SUCCEEDED' ? [uid(22)] : [],
  createdAt: now,
  finishedAt: status === 'SUCCEEDED' || status === 'FAILED' ? now : null,
});
async function generationFixture(page: Page, initial = false) {
  await fixture(page, accepted);
  let batches: ReturnType<typeof batch>[] = initial ? [batch()] : [];
  let posts: unknown[] = [];
  let olderBatch = batch();
  let failPost = false,
    forbidden = false,
    readFailure = false,
    holdCards = false;
  let releaseCards: (() => void) | undefined;
  let reads = 0,
    includeNew = false;
  await page.route('**/api/**/recommendations?*', (route) =>
    route.fulfill({
      json: {
        tenantId: tenant,
        settings: { revision: 0, enabled: true },
        items: includeNew ? [newCard, oldCard] : [oldCard],
        snapshot: 'a'.repeat(64),
        hasMore: false,
        eligibleTotal: 1,
        rankedCount: 1,
        poolLimited: false,
        poolLimit: 1000,
        businessOutcome: 'NOT_ASSESSED',
      },
    }),
  );
  await page.route('**/api/**/recommendations/cards?*', async (route) => {
    if (holdCards)
      await new Promise<void>((resolve) => {
        releaseCards = resolve;
      });
    return route.fulfill(readFailure ? { status: 503, json: { code: 'UNAVAILABLE' } } : { json: [newCard] });
  });
  await page.route('**/api/**/briefing/generation*', async (route) => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON());
      if (failPost) {
        failPost = false;
        return route.abort('failed');
      }
      batches = [batch()];
      return route.fulfill({ json: batches[0] });
    }
    reads++;
    return route.fulfill(
      forbidden ? { status: 403, json: { code: 'FORBIDDEN' } } : { json: { policies: [], batches } },
    );
  });
  await page.route('**/api/**/briefing/generation/' + uid(30), (route) =>
    route.fulfill({ json: olderBatch }),
  );
  await page.route('**/api/**/briefing/generation/*/cancel', async (route) => {
    batches = [batch('CANCELLED')];
    return route.fulfill({ json: batches[0] });
  });
  return {
    dropFromHistory: () => {
      batches = [];
    },
    includeNew: () => {
      includeNew = true;
    },
    posts,
    get reads() {
      return reads;
    },
    set: (status: string, reason: string | null = null) => {
      olderBatch = batch(status, reason);
      batches = [olderBatch];
    },
    failNext: () => {
      failPost = true;
    },
    forbid: () => {
      forbidden = true;
    },
    readFailure: (value: boolean) => {
      readFailure = value;
    },
    hold: () => {
      holdCards = true;
    },
    release: () => {
      holdCards = false;
      releaseCards?.();
    },
  };
}

test('生成入口是网格末尾的1×1卡片，流光占位原位替换，轮询不移动旧卡', async ({ page }) => {
  test.setTimeout(40000);
  const f = await generationFixture(page);
  await page.goto(home);
  const more = page.locator('[data-card-id="generation:more"]');
  await expect(more).toHaveAttribute('data-size', '1×1');
  await expect(page.getByText('自动生成设置', { exact: true })).toHaveCount(0);
  const box = await more.boundingBox();
  expect(Math.abs(box!.height - box!.width)).toBeLessThan(2);
  const old = page.locator(`[data-card-id^="${uid(21)}:"]`);
  await expect(old).toBeVisible();
  await expect
    .poll(() => old.evaluate((el) => el.getAnimations().filter((a) => a.playState === 'running').length))
    .toBe(0);
  const originalBox = await old.boundingBox();
  await page.getByRole('button', { name: '生成更多', exact: true }).click();
  const slot = page.locator(`[data-card-id="generation:${uid(30)}"]`);
  await expect(slot.locator('.is-generating')).toBeVisible();
  await expect(page.getByRole('tab', { name: '推荐', exact: true })).toBeEnabled();
  await expect
    .poll(() => slot.evaluate((el) => el.getAnimations().filter((a) => a.playState === 'running').length))
    .toBe(0);
  const slotBox = await slot.boundingBox();
  await page.screenshot({ path: 'test-results/generation-running.png', fullPage: true });
  await slot.evaluate((el) => el.setAttribute('data-retained-node', 'yes'));
  await expect(page.getByRole('button', { name: '正在准备新画报', exact: true })).toBeDisabled();
  f.hold();
  f.set('SUCCEEDED');
  await expect(slot).toContainText('正在读取新画报', { timeout: 10000 });
  await expect(slot).toHaveAttribute('data-retained-node', 'yes');
  f.release();
  await expect(slot).toContainText('新增经营发现');
  await expect(slot).toHaveAttribute('data-retained-node', 'yes');
  await expect(page.locator('.recommendation-card')).toHaveCount(2);
  await expect
    .poll(() => slot.evaluate((el) => el.getAnimations().filter((a) => a.playState === 'running').length))
    .toBe(0);
  const finalBox = await slot.boundingBox();
  expect(finalBox!.x).toBe(slotBox!.x);
  expect(finalBox!.y).toBe(slotBox!.y);
  expect(await old.boundingBox()).toEqual(originalBox);
  await expect(page.getByRole('button', { name: '生成更多', exact: true })).toBeEnabled();
  expect(await more.evaluate((el) => el.parentElement!.lastElementChild === el)).toBe(true);
  const before = f.reads;
  await expect.poll(() => f.reads, { timeout: 10000 }).toBeGreaterThan(before);
  await expect(slot).toContainText('新增经营发现');
  expect(f.posts).toHaveLength(1);
  f.includeNew();
  await page.getByRole('button', { name: '刷新智能画报', exact: true }).click();
  await expect(page.locator('.recommendation-card')).toHaveCount(2);
  await expect(slot).toContainText('新增经营发现');
  expect(f.posts).toHaveLength(1);
  await page.screenshot({ path: 'test-results/generation-delivered.png', fullPage: true });
});

test('等待和失败有真实状态，取消去掉占位，刷新只读取不发起生成', async ({ page }) => {
  test.setTimeout(40000);
  const f = await generationFixture(page, true);
  await page.goto(home);
  await expect(page.locator('.is-generating')).toBeVisible();
  f.set('WAITING_RESOURCE', 'DAILY_RUN_LIMIT');
  await expect(page.locator('.generation-placeholder')).toContainText('等待可用额度', { timeout: 10000 });
  await expect(page.locator('.is-generating')).toHaveCount(0);
  await page.reload();
  expect(f.posts).toHaveLength(0);
  await page.getByRole('button', { name: '取消本次', exact: true }).click();
  await expect(page.locator('.generation-placeholder')).toHaveCount(0);
  await expect(page.locator('.briefing-generation')).toContainText('已取消本次生成');
  await page.getByRole('button', { name: '生成更多', exact: true }).click();
  await expect(page.locator('.generation-placeholder')).toHaveAttribute('data-batch-id', uid(30));
  await expect(page.getByRole('tab', { name: '推荐', exact: true })).toBeEnabled();
  f.set('FAILED', 'TASK_LIMIT');
  await expect(page.locator('.briefing-generation')).toContainText('主模型达到本次执行上限', {
    timeout: 10000,
  });
  await expect(page.locator('.generation-placeholder')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '生成更多', exact: true })).toBeEnabled();
});

test('结果未知重试使用同一请求，完成后读卡失败可重读且不会重新生成', async ({ page }) => {
  test.setTimeout(40000);
  const f = await generationFixture(page);
  await page.goto(home);
  f.failNext();
  await page.getByRole('button', { name: '生成更多', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试本次请求' })).toBeEnabled();
  await page.getByRole('button', { name: '重试本次请求' }).click();
  await expect(page.locator('.is-generating')).toBeVisible();
  await expect.poll(() => f.posts.length).toBe(2);
  await expect(page.locator('.generation-placeholder')).toHaveAttribute('data-batch-id', uid(30));
  expect(f.posts[1]).toEqual(f.posts[0]);
  f.readFailure(true);
  f.set('SUCCEEDED');
  await expect(page.getByRole('button', { name: '重新读取', exact: true })).toBeVisible({ timeout: 10000 });
  f.readFailure(false);
  await page.getByRole('button', { name: '重新读取', exact: true }).click();
  await expect(page.locator('.recommendation-card')).toHaveCount(2);
  expect(f.posts).toHaveLength(2);
  f.forbid();
  await expect(page.getByText('新增经营发现', { exact: true })).toHaveCount(0, { timeout: 10000 });
});

test('移动端1×1和减少动态效果设置均生效', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await generationFixture(page, true);
  await page.goto(home);
  const placeholder = page.locator('.generation-placeholder');
  await expect(placeholder).toBeVisible();
  expect(await placeholder.evaluate((el) => getComputedStyle(el, '::before').animationName)).toBe('none');
  const box = await page.locator('[data-card-id="generation:more"]').boundingBox();
  expect(Math.abs(box!.height - box!.width)).toBeLessThan(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/generation-mobile.png', fullPage: true });
});

test('后台自动生成的占位与结果也进入网格，不额外发起生成请求', async ({ page }) => {
  test.setTimeout(40000);
  const f = await generationFixture(page);
  await page.goto(home);
  await expect(page.locator('.recommendation-card')).toHaveCount(1);
  f.set('RUNNING');
  await expect(page.locator('.generation-placeholder')).toHaveAttribute('data-batch-id', uid(30), {
    timeout: 10000,
  });
  f.set('SUCCEEDED');
  await expect(page.locator(`[data-card-id="generation:${uid(30)}"]`)).toContainText('新增经营发现', {
    timeout: 10000,
  });
  await expect(page.locator('.recommendation-card')).toHaveCount(2);
  expect(f.posts).toHaveLength(0);
  const reads = f.reads;
  f.dropFromHistory();
  await expect.poll(() => f.reads, { timeout: 10000 }).toBeGreaterThan(reads);
  await expect(page.locator(`[data-card-id="generation:${uid(30)}"]`)).toContainText('新增经营发现');
  await expect(page.locator('.recommendation-card')).toHaveCount(2);
});
