import { test, expect, type Page, type Route } from '@playwright/test';
import { magazineGridMetrics } from '../../src/briefingGrid';

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

test('生成入口原位显示进度且不新增占位，完成后展示结果与入口', async ({ page }) => {
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
  let slot = more;
  await expect(slot.locator('.is-generating')).toBeVisible();
  await expect(page.getByRole('tab', { name: '推荐', exact: true })).toBeEnabled();
  await expect
    .poll(() => slot.evaluate((el) => el.getAnimations().filter((a) => a.playState === 'running').length))
    .toBe(0);
  const slotBox = await slot.boundingBox();
  await page.screenshot({ path: 'test-results/generation-running.png', fullPage: true });
  await slot.evaluate((el) => el.setAttribute('data-retained-node', 'yes'));
  await expect(page.getByRole('button', { name: '生成更多', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-card-id^="generation:"]')).toHaveCount(1);
  expect(f.posts).toHaveLength(1);
  f.hold();
  f.set('SUCCEEDED');
  await expect(slot).toContainText('正在读取新画报', { timeout: 10000 });
  await expect(slot).toHaveAttribute('data-retained-node', 'yes');
  f.release();
  slot = page.locator(`[data-card-id="generation:${uid(30)}"]`);
  await expect(slot).toContainText('新增经营发现');
  await expect(more).toHaveAttribute('data-retained-node', 'yes');
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
  await page.locator('.access-content').evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.locator('#live-briefing-panel').hover({ position: { x: 10, y: 6 } });
  await page.mouse.wheel(0, -220);
  await expect(page.locator('#live-briefing-panel')).toHaveAttribute('data-refresh-phase', 'idle');
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
  await expect(page.locator('.briefing-generation')).toContainText('本次未完成，可稍后重试', {
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

test('异步推荐卡片提交后才按 Demo 参数入场，下拉完成后重播且无卡面悬浮操作', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).arrivalLog = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (this.matches('.live-briefing-card') && Array.isArray(frames) && frames[0]?.translate) {
        (window as any).arrivalLog.push({ title: this.getAttribute('aria-label'), frames, options });
      }
      return animate.call(this, frames, options);
    };
  });
  const f = await generationFixture(page);
  let hold = true;
  let finish: (() => void) | undefined;
  await page.route('**/api/**/recommendations?*', async (route) => {
    if (hold)
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    await route.fallback();
  });
  await page.goto(home);
  await expect.poll(() => !!finish).toBe(true);
  await expect(page.locator('.recommendation-card')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).arrivalLog)).toEqual([]);
  finish!();
  await expect(page.locator('.recommendation-card')).toHaveCount(1);
  const arrivals = () =>
    page.evaluate(() => (window as any).arrivalLog.filter((x: any) => x.title?.startsWith('推荐成果：')));
  await expect.poll(async () => (await arrivals()).length).toBe(1);
  const [entry] = await arrivals();
  expect(entry.options).toMatchObject({ duration: 380, delay: 0, easing: 'cubic-bezier(.2,.65,.25,1)' });
  expect(entry.frames[0]).toMatchObject({ opacity: 0, translate: '0 12px', scale: '.988' });
  await page.locator('.recommendation-card').hover();
  await expect(page.locator('.live-card-action-rail')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '刷新智能画报', exact: true })).toHaveCount(0);
  hold = false;
  await page.mouse.wheel(0, -220);
  await expect.poll(async () => (await arrivals()).length).toBe(2);
  expect(f.posts).toHaveLength(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.locator('.recommendation-card')).toHaveCount(1);
  expect(await arrivals()).toEqual([]);
});

test('阅读弹窗仅保留有用、没用、关注，桌面和窄屏图标均居中且原因选择可用', async ({ page }) => {
  await generationFixture(page);
  await page.route('**/api/**/feedback?*', (route) => route.fulfill({ json: { feedback: null } }));
  for (const width of [952, 390]) {
    await page.setViewportSize({ width, height: 853 });
    await page.goto(home);
    await page.getByRole('button', { name: '阅读：已有经营发现', exact: true }).click();
    const dialog = page.locator('.live-reading-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS('transform', 'none');
    const rail = dialog.locator('.live-feedback-actions');
    await expect(rail.getByRole('button')).toHaveCount(3);
    await expect(rail.getByRole('button', { name: '评价记录与建议' })).toHaveCount(0);
    for (const name of ['有用', '没用', '关注']) {
      const button = rail.getByRole('button', { name, exact: true });
      await expect(button).toBeEnabled();
      const offsets = await button.evaluate((el) => {
        const box = el.getBoundingClientRect(),
          icon = el.querySelector('svg')!.getBoundingClientRect();
        return [
          Math.abs(icon.x + icon.width / 2 - box.x - box.width / 2),
          Math.abs(icon.y + icon.height / 2 - box.y - box.height / 2),
        ];
      });
      expect(offsets.every((offset) => offset < 0.5)).toBe(true);
    }
    await rail.getByRole('button', { name: '没用', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '选择没用的原因' })).toBeVisible();
    await page.getByRole('button', { name: '取消选择原因' }).click();
    await page.screenshot({ path: `test-results/reading-actions-${width}.png` });
    await dialog.getByRole('button', { name: '关闭卡片详情' }).click();
    await expect(dialog).toHaveCount(0);
  }
});

test('阅读弹窗复用 Demo 的淡入轻移缩放关键帧，减少动态效果时停用', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).readingAnimations = [];
    const showModal = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function () {
      showModal.call(this);
      if (this.matches('.live-reading-dialog')) {
        (window as any).readingAnimations = this.getAnimations().map((animation) => ({
          name: (animation as CSSAnimation).animationName,
          frames: (animation.effect as KeyframeEffect).getKeyframes(),
          duration: animation.effect!.getTiming().duration,
        }));
      }
    };
  });
  await generationFixture(page);
  await page.route('**/api/**/feedback?*', (route) => route.fulfill({ json: { feedback: null } }));
  await page.goto(home);
  await page.getByRole('button', { name: '阅读：已有经营发现', exact: true }).click();
  const animations = await page.evaluate(() => (window as any).readingAnimations);
  expect(animations).toHaveLength(1);
  expect(animations[0]).toMatchObject({ name: 'briefing-detail-in', duration: 180 });
  expect(animations[0].frames[0]).toMatchObject({ opacity: '0', transform: 'translateY(10px) scale(0.99)' });
  expect(animations[0].frames.at(-1)).toMatchObject({ opacity: '1', transform: 'none' });
  await page.getByRole('button', { name: '关闭卡片详情' }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '阅读：已有经营发现', exact: true }).click();
  expect(await page.evaluate(() => (window as any).readingAnimations)).toEqual([]);
  await expect(page.locator('.live-reading-dialog')).toHaveCSS('animation-name', 'none');
});

for (const existingDiscussion of [true, false]) {
test(`从画报打开独立讨论，保留2×2尺寸且不携带生成任务：${existingDiscussion ? '已有讨论' : '未发送讨论'}`, async ({ page }) => {
  const f = await generationFixture(page);
  const discussion = uid(80);
  const context = {
    conversationId: conversation,
    taskId: uid(21),
    workspaceId: space,
    taskRevision: 1,
    attempt: 1,
  };
  const detail = {
    conversation: { ...info, id: discussion, title: '已有经营发现' },
    tasks: [],
    hasMore: false,
    cursor: 0,
    briefingContext: context,
  };
  let opens = 0;
  await page.route('**/tasks/' + uid(21) + '/discussion?*', (route) => {
    opens++;
    return route.fulfill({ json: { conversationId: existingDiscussion ? discussion : null, title: detail.conversation.title, briefingContext: context } });
  });
  await page.route('**/conversations/' + discussion + '?*', (route) => route.fulfill({ json: detail }));
  await page.route('**/conversations/' + discussion + '/events?*', (route) =>
    route.fulfill({ json: { conversationId: discussion, items: [], cursor: 0, hasMore: false } }),
  );
  await page.route('**/tasks/' + uid(21), (route) =>
    route.fulfill({
      json: {
        conversation: info,
        tasks: [
          {
            ...task('生成任务指令不应进入讨论'),
            executionClass: 'verification',
            id: uid(21),
            status: 'SUCCEEDED',
            attempt: 1,
            revision: 1,
            reply: '这是一张已完成画报的真实内容。',
          },
        ],
        hasMore: false,
        cursor: 1,
      },
    }),
  );
  await page.goto(home);
  const magazineUnits = new Map<number, number>();
  for (const width of [390, 949, 1426]) {
    await page.setViewportSize({ width, height: 841 });
    const grid = page.locator('.live-briefing-grid[data-packed]').first();
    await expect(grid).toBeVisible();
    await expect.poll(async () => {
      const measured = await grid.evaluate((node) => ({ width: node.clientWidth, unit: Number.parseFloat(getComputedStyle(node).getPropertyValue('--briefing-unit')) }));
      return Math.abs(measured.unit - magazineGridMetrics(measured.width).unit);
    }).toBeLessThan(0.5);
    magazineUnits.set(width, await grid.evaluate((node) => Number.parseFloat(getComputedStyle(node).getPropertyValue('--briefing-unit'))));
  }
  // Synthetic saved follow geometry: the discussion must retain this exact span.
  const originalTile = page.locator('.live-briefing-tile').filter({ has: page.getByRole('button', { name: '阅读：已有经营发现', exact: true }) });
  await originalTile.evaluate((node) => { node.setAttribute('data-size', '2×2'); node.style.gridColumn = '1 / span 2'; node.style.gridRow = '1 / span 2'; });
  await page.getByRole('button', { name: '阅读：已有经营发现', exact: true }).click();
  await page.getByRole('button', { name: '发起会话', exact: true }).click();
  if (existingDiscussion) await expect(page).toHaveURL(new RegExp('conversation=' + discussion));
  else await expect(page.locator('.is-new-conversation')).toBeVisible();
  await expect(page.getByRole('region', { name: '画报讨论上下文' })).toContainText(
    '这是一张已完成画报的真实内容。',
  );
  await expect(page.getByText('生成任务指令不应进入讨论', { exact: true })).toHaveCount(0);
  const preview = page.getByRole('region', { name: '画报讨论上下文' });
  await expect(preview.locator('.briefing-magazine')).toBeVisible();
  for (const width of [390, 949, 1426]) {
    await page.setViewportSize({ width, height: 841 });
    const tile = preview.locator('.live-briefing-tile');
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {})));
    });
    // ResizeObserver and the deck width update independently. Compare the
    // container and tile in one settled snapshot, not across layout frames.
    await expect.poll(() => preview.locator('.live-magazine-grid').evaluate((node, sourceUnit) => {
      const unit = Math.min(sourceUnit, (node.clientWidth - 10) / 2);
      const actualUnit = Number.parseFloat(getComputedStyle(node).getPropertyValue('--briefing-unit'));
      const box = node.querySelector('.live-briefing-tile')!.getBoundingClientRect();
      return Math.max(Math.abs(actualUnit - unit), Math.abs(box.width - (unit * 2 + 10)), Math.abs(box.height - (unit * 2 + 10)));
    }, magazineUnits.get(1426)!)).toBeLessThan(0.5);
    await expect(tile).toHaveAttribute('data-size', '2×2');
    const body = preview.locator('.live-briefing-body');
    await expect(preview.locator('h3')).toBeVisible();
    expect(await body.evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
    const before = await preview.locator('.conversation-briefing-preview').evaluate((node) => ({
      shadow: getComputedStyle(node).boxShadow,
      border: getComputedStyle(node).borderColor,
    }));
    await body.hover({ position: { x: 30, y: 30 } });
    await expect(preview.locator('.conversation-briefing-preview')).toHaveCSS('translate', 'none');
    await expect(preview.locator('.conversation-briefing-preview')).toHaveCSS('box-shadow', before.shadow);
    await expect(preview.locator('.conversation-briefing-preview')).toHaveCSS('border-color', before.border);
    await expect(preview.locator('.conversation-briefing-preview')).toHaveCSS('transform', 'none');
    await page.screenshot({ path: `.local/briefing-preview-fidelity/preview-${width}.png` });
  }

  await preview.locator('.conversation-briefing-preview').evaluate((node) => {
    node.style.minHeight = '900px';
  });
  await preview.locator('.live-briefing-body').hover({ position: { x: 30, y: 30 } });
  const composer = page.locator('.conversation-composer');
  expect(
    await composer.evaluate((node) => {
      const surface = node.querySelector('.live-composer-surface')!.getBoundingClientRect();
      return node.contains(document.elementFromPoint(surface.x + surface.width / 2, surface.y + 4));
    }),
  ).toBe(true);
  await composer.locator('textarea').fill('继续分析');
  await expect(composer.locator('textarea')).toHaveValue('继续分析');
  await preview.locator('.conversation-briefing-preview').evaluate((node) => {
    node.style.minHeight = '';
  });

  await expect(preview.locator('.live-reading-sources')).toHaveCount(0);
  await expect(page.getByText('仅自己可见', { exact: true })).toHaveCount(0);
  await page.locator('.deck-source').getByRole('button', { name: '关闭画报卡片', exact: true }).click();
  await preview.getByRole('button').click();
  await expect(page.locator('.deck-source')).toBeVisible();

  const resizer = page.getByRole('separator', { name: '调整当前会话宽度', exact: true });
  const box = (await resizer.boundingBox())!;
  const initialWidth = await page.locator('.deck-conversation').evaluate((node) => node.getBoundingClientRect().width);
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  for (const delta of [40, 100, 160, 60]) {
    await page.mouse.move(box.x + box.width / 2 + delta, box.y + 100, { steps: 8 });
    await expect(resizer).toHaveAttribute('aria-valuenow', String(Math.min(1040, initialWidth + delta)));
  }
  await page.mouse.up();

  await page.reload();
  await expect(page.getByRole('region', { name: '画报讨论上下文' })).toBeVisible();
  if (existingDiscussion) {
    await page.goto(`/workspace/#tenant=${tenant}&view=conversations&conversation=${discussion}`);
    await page.reload();
    await expect(page.getByRole('region', { name: '画报讨论上下文' })).toBeVisible();
  }
  expect(opens).toBe(1);
  expect(f.posts).toHaveLength(0);
});

}

test('画报首次追问在发送后成立，丢响应重试保留请求与确切卡片引用', async ({ page }) => {
  await generationFixture(page);
  const discussion = uid(81);
  const context = { conversationId: conversation, taskId: uid(21), workspaceId: space, taskRevision: 1, attempt: 1 };
  let established = false;
  const sends: Record<string, unknown>[] = [];
  const detail = () => ({ conversation: { ...info, id: discussion, title: '已有经营发现' }, tasks: [task('解释这张画报')], hasMore: false, cursor: 1, briefingContext: context });
  await page.route('**/tasks/' + uid(21) + '/discussion?*', route => {
    expect(route.request().method()).toBe('GET');
    return route.fulfill({ json: { conversationId: established ? discussion : null, title: '已有经营发现', briefingContext: context } });
  });
  await page.route('**/tasks/' + uid(21), route => route.fulfill({ json: { conversation: info, tasks: [{ ...task('后台生成指令'), executionClass: 'verification', id: uid(21), status: 'SUCCEEDED', revision: 1, attempt: 1, reply: '这份画报依据获准来源形成。' }], hasMore: false, cursor: 1 } }));
  await page.route('**/conversations', route => {
    if (route.request().method() === 'POST') {
      sends.push(route.request().postDataJSON()); established = true;
      if (sends.length === 1) return route.abort('failed');
      return route.fulfill({ status: 202, json: detail() });
    }
    return route.fulfill({ json: { tenantId: tenant, enabled: true, agentMode: 'off', publicWebEnabled: false, items: established ? [detail().conversation] : [], hasMore: false } });
  });
  await page.route('**/conversations?*', route => route.fulfill({ json: { tenantId: tenant, enabled: true, agentMode: 'off', publicWebEnabled: false, items: established ? [detail().conversation] : [], hasMore: false } }));
  await page.route('**/conversations/' + discussion + '?*', route => route.fulfill({ json: detail() }));
  await page.route('**/conversations/' + discussion + '/events?*', route => route.fulfill({ json: { conversationId: discussion, items: [], cursor: 1, hasMore: false } }));
  await page.goto(home);
  await page.getByRole('button', { name: '阅读：已有经营发现', exact: true }).click();
  await page.getByRole('button', { name: '发起会话', exact: true }).click();
  expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).has('conversation')).toBe(false);
  expect(sends).toHaveLength(0);
  await expect(page.getByRole('region', { name: '画报讨论上下文' })).toContainText('这份画报依据获准来源形成。');
  await page.reload();
  const composer = page.locator('.conversation-composer');
  await composer.locator('textarea').fill('解释这张画报');
  await composer.locator('button[type=submit]').click();
  await expect(composer).toContainText('重试上次发送');
  await page.reload();
  await expect(composer).toContainText('重试上次发送');
  await composer.locator('button[type=submit]').click();
  await expect(page).toHaveURL(new RegExp('conversation=' + discussion));
  expect(sends).toHaveLength(2);
  expect(sends[1]).toEqual(sends[0]);
  expect(sends[0].briefingContext).toEqual(context);
  await expect(page.locator('nav.live-conversation-list a')).toHaveCount(1);
  await expect(page.getByText('后台生成指令', { exact: true })).toHaveCount(0);
  await page.goto(home);
  await page.getByRole('button', { name: '阅读：已有经营发现', exact: true }).click();
  await page.getByRole('button', { name: '发起会话', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('conversation=' + discussion));
  expect(sends).toHaveLength(2);
});

test('重新聚焦核验数据但不重建或重排画报，撤权内容仍移除', async ({ page }) => {
  await generationFixture(page);
  let items = [oldCard, newCard];
  let reads = 0;
  await page.route('**/api/**/recommendations?*', (route) => {
    reads++;
    return route.fulfill({
      json: {
        tenantId: tenant,
        settings: { revision: 0, enabled: true },
        items,
        snapshot: 'a'.repeat(64),
        hasMore: false,
        eligibleTotal: items.length,
        rankedCount: items.length,
        poolLimited: false,
        poolLimit: 1000,
        businessOutcome: 'NOT_ASSESSED',
      },
    });
  });
  await page.goto(home);
  await expect(page.locator('.recommendation-card')).toHaveCount(2);
  await expect
    .poll(() =>
      page
        .locator('.recommendation-card')
        .evaluateAll(
          (nodes) => nodes.flatMap((n) => n.getAnimations()).filter((a) => a.playState === 'running').length,
        ),
    )
    .toBe(0);
  const before = await page.locator('.live-briefing-tile').evaluateAll((nodes) =>
    nodes.map((n) => {
      n.setAttribute('data-retained', 'yes');
      const r = n.getBoundingClientRect();
      return { id: n.getAttribute('data-card-id'), x: r.x, y: r.y, width: r.width, height: r.height };
    }),
  );
  items = [newCard, oldCard];
  const priorReads = reads;
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => reads).toBeGreaterThan(priorReads);
  await expect(page.locator('.live-briefing-tile[data-retained="yes"]')).toHaveCount(3);
  const after = await page.locator('.live-briefing-tile').evaluateAll((nodes) =>
    nodes.map((n) => {
      const r = n.getBoundingClientRect();
      return { id: n.getAttribute('data-card-id'), x: r.x, y: r.y, width: r.width, height: r.height };
    }),
  );
  expect(after).toEqual(before);
  items = [oldCard];
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: '阅读：新增经营发现', exact: true })).toHaveCount(0);
});

test('多张卡片按阅读顺序逐张浮出，鼠标经过不打断入场', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).entrances = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      if (this.matches('.live-briefing-card') && Array.isArray(frames) && frames[0]?.translate) {
        animation.pause();
        (window as any).entrances.push({ animation, element: this, options, frames });
      }
      return animation;
    };
  });
  const f = await generationFixture(page);
  f.includeNew();
  await page.goto(home);
  await expect.poll(() => page.evaluate(() => (window as any).entrances.length)).toBe(3);
  const timing = await page.evaluate(() =>
    (window as any).entrances.map((e: any) => ({
      delay: e.options.delay,
      duration: e.options.duration,
      opacity: getComputedStyle(e.element).opacity,
      translate: e.frames[0].translate,
    })),
  );
  expect(timing.map((v: any) => v.delay)).toEqual([0, 46, 92]);
  expect(timing.every((v: any) => v.opacity === '0' && v.duration === 380 && v.translate === '0 12px')).toBe(
    true,
  );
  await page.locator('.recommendation-card').first().dispatchEvent('pointerover', { pointerType: 'mouse' });
  expect(
    await page.evaluate(() =>
      (window as any).entrances.every((e: any) => e.animation.playState === 'paused'),
    ),
  ).toBe(true);
  await page.evaluate(() => (window as any).entrances.forEach((e: any) => e.animation.play()));
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).entrances.every((e: any) => getComputedStyle(e.element).opacity === '1'),
      ),
    )
    .toBe(true);
});

test('画报滚动续载保留原卡片，失败可重试且无翻页器', async ({ page }) => {
  await generationFixture(page);
  let moreReads = 0;
  await page.route('**/api/**/recommendations?*', (route) => {
    const url = new URL(route.request().url());
    const more = url.searchParams.get('offset') === '20';
    if (more) {
      expect(url.searchParams.get('snapshot')).toBe('a'.repeat(64));
      moreReads++;
      if (moreReads === 1) return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } });
    }
    return route.fulfill({
      json: {
        tenantId: tenant,
        settings: { revision: 0, enabled: true },
        items: more ? [oldCard, newCard] : [oldCard],
        snapshot: 'a'.repeat(64),
        hasMore: !more,
        eligibleTotal: 2,
        rankedCount: 2,
        poolLimited: false,
        poolLimit: 1000,
        businessOutcome: 'NOT_ASSESSED',
      },
    });
  });
  await page.goto(home);
  await page.locator('.briefing-feed-tail').scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: '重试加载更多画报' })).toBeVisible();
  await expect(page.locator('.recommendation-card')).toHaveCount(1);
  await page.locator('.recommendation-card').evaluate((node) => node.setAttribute('data-retained', 'yes'));
  await page.getByRole('button', { name: '重试加载更多画报' }).click();
  await expect(page.locator('.recommendation-card')).toHaveCount(2);
  await expect(page.locator('.recommendation-card[data-retained="yes"]')).toHaveCount(1);
  await expect(page.locator('.platform-pagination')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '更多画报视图' })).toHaveCount(0);
});

test('仅推荐栏显示生成卡片', async ({ page }) => {
  await generationFixture(page);
  await page.goto(home);
  await expect(page.locator('.briefing-generation')).toHaveCount(1);
  for (const name of ['关注', '日期', '类型', '空间']) {
    await page.getByRole('tab', { name, exact: true }).click();
    await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.briefing-generation')).toHaveCount(0);
  }
  await page.getByRole('tab', { name: '推荐', exact: true }).click();
  await expect(page.locator('.briefing-generation')).toHaveCount(1);
});

test('画报滚动区为左侧卡片阴影保留空间且导航仍在上层', async ({ page }) => {
  await generationFixture(page);
  await page.setViewportSize({ width: 952, height: 853 });
  await page.goto(home);
  await expect(page.locator('.recommendation-card').first()).toBeVisible();
  const bounds = await page
    .locator('.recommendation-card')
    .first()
    .evaluate((card) => {
      const scroll = card.closest('.access-content')!;
      const main = scroll.parentElement!;
      const sidebar = document.querySelector('.access-sidebar')!;
      const button = sidebar.querySelector('button, a')!;
      const rect = button.getBoundingClientRect();
      return {
        gutter: card.getBoundingClientRect().left - scroll.getBoundingClientRect().left,
        alignment:
          card.closest('.live-briefing-tile')!.getBoundingClientRect().left -
          main.getBoundingClientRect().left,
        noHorizontalScroll: scroll.scrollWidth === scroll.clientWidth,
        navigationOnTop: button.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
        ),
      };
    });
  expect(bounds.gutter).toBeGreaterThanOrEqual(28);
  expect(bounds.alignment).toBeCloseTo(0, 0);
  expect(bounds.noHorizontalScroll).toBe(true);
  expect(bounds.navigationOnTop).toBe(true);
});

test('外部画报显示已保存评价，改评与撤销同步且刷新恢复', async ({ page }) => {
  await generationFixture(page);
  let rating = 'USEFUL',
    withdrawn = false;
  await page.route('**/api/**/feedback?*', (route) =>
    route.fulfill({
      json: {
        feedback: {
          id: uid(90),
          tenantId: tenant,
          workspaceId: space,
          target: oldCard.feedbackTarget,
          revision: 1,
          status: withdrawn ? 'WITHDRAWN' : 'ACTIVE',
          assessment: { rating, reasons: rating === 'NOT_USEFUL' ? ['UNHELPFUL'] : [], suggestion: '' },
          snapshot: {
            taskState: 'SUCCEEDED',
            executionClass: 'live',
            contentSha256: 'a'.repeat(64),
            sourceVersionCount: 0,
          },
          createdAt: now,
          updatedAt: now,
        },
      },
    }),
  );
  await page.goto(home);
  const card = page.locator('.recommendation-card').first();
  await expect(card.getByRole('img', { name: '已评价有用' })).toBeVisible();
  rating = 'NOT_USEFUL';
  await page.evaluate(
    (tenant) => window.dispatchEvent(new CustomEvent('briefing-feedback-changed', { detail: { tenant } })),
    tenant,
  );
  await expect(card.getByRole('img', { name: '已评价没用' })).toBeVisible();
  await expect(card.getByRole('img', { name: '已评价有用' })).toHaveCount(0);
  await page.reload();
  await expect(card.getByRole('img', { name: '已评价没用' })).toBeVisible();
  withdrawn = true;
  await page.evaluate(
    (tenant) => window.dispatchEvent(new CustomEvent('briefing-feedback-changed', { detail: { tenant } })),
    tenant,
  );
  await expect(card.getByRole('img', { name: '已评价没用' })).toHaveCount(0);
});

test('切回智能画报不播放临时布局重排，仍逐张浮出', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).tileMoves = 0;
    (window as any).cardArrivals = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (this.matches('.live-briefing-tile')) (window as any).tileMoves++;
      if (this.matches('.live-briefing-card') && Array.isArray(frames) && frames[0]?.translate)
        (window as any).cardArrivals++;
      return animate.call(this, frames, options);
    };
  });
  const f = await generationFixture(page);
  f.includeNew();
  await page.setViewportSize({ width: 952, height: 853 });
  await page.goto(home);
  await expect(page.locator('.recommendation-card')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => (window as any).cardArrivals)).toBeGreaterThan(0);
  const first = await page.evaluate(() => (window as any).cardArrivals);
  await page.evaluate((tenant) => {
    location.hash = `tenant=${tenant}&view=conversations`;
  }, tenant);
  await expect(page.locator('.conversation-composer')).toBeVisible();
  await page.evaluate((tenant) => {
    location.hash = `tenant=${tenant}&view=briefing`;
  }, tenant);
  await expect(page.locator('.recommendation-card')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => (window as any).cardArrivals)).toBeGreaterThan(first);
  expect(await page.evaluate(() => (window as any).tileMoves)).toBe(0);
});

test('生成请求等待时不出现全页状态气泡，已有卡片与入口位置保持稳定', async ({ page }) => {
  await generationFixture(page);
  let release!: () => void;
  let waiting = false;
  await page.route('**/api/**/briefing/generation*', async route => {
    if (route.request().method() === 'POST') {
      waiting = true;
      await new Promise<void>(resolve => { release = resolve; });
    }
    await route.fallback();
  });
  await page.goto(home);
  const more = page.locator('[data-card-id="generation:more"]');
  const old = page.locator(`[data-card-id^="${uid(21)}:"]`);
  await expect(page.getByRole('button', { name: '生成更多', exact: true })).toBeEnabled();
  const oldBox = await old.boundingBox(), moreBox = await more.boundingBox();
  const oldNode = await old.elementHandle();
  const generationNode = await more.locator('article').elementHandle();
  await page.getByRole('button', { name: '生成更多', exact: true }).click();
  await expect.poll(() => waiting).toBe(true);
  await expect(more).toContainText('正在准备新画报');
  await expect(page.getByText('正在核对本次提交，请在原处完成或重试后再切换页面。', { exact: true })).toHaveCount(0);
  await expect(page.locator('.briefing-local-loading')).toHaveCount(0);
  expect(await oldNode!.evaluate(el => el.isConnected)).toBe(true);
  expect(await generationNode!.evaluate(el => el.isConnected)).toBe(true);
  expect(await old.boundingBox()).toEqual(oldBox);
  expect(await more.boundingBox()).toEqual(moreBox);
  // The existing write guard remains in force while only its redundant banner is hidden.
  await expect(page.getByRole('navigation', { name: '主导航' })).toHaveAttribute('inert', '');
  release();
  await expect(more).toContainText('正在分析资料');
  expect(await generationNode!.evaluate(el => el.isConnected)).toBe(true);
  expect(await old.boundingBox()).toEqual(oldBox);
  expect(await more.boundingBox()).toEqual(moreBox);
});

test('生成入口在新增卡片和响应式重排后位于末排末尾', async ({ page }) => {
  const f = await generationFixture(page, true);
  await page.setViewportSize({ width: 944, height: 841 });
  await page.goto(home);
  const more = page.locator('[data-card-id="generation:more"]');
  await expect(more).toHaveAttribute('data-at-end', 'true');
  const node = await more.locator('article').elementHandle();
  const belowAll = () => page.locator('.live-magazine-grid').first().evaluate(el => {
    const control = el.querySelector<HTMLElement>('[data-card-id="generation:more"]')!;
    const cards = [...el.querySelectorAll<HTMLElement>('.live-briefing-tile')].filter(card => card !== control);
    const bottom = Math.max(0,...cards.map(card => card.offsetTop + card.offsetHeight));
    const last = cards.filter(card => Math.abs(card.offsetTop + card.offsetHeight - bottom) < 1);
    const right = Math.max(0,...last.map(card=>card.offsetLeft+card.offsetWidth));
    return control.offsetTop >= bottom - 1 || (control.offsetTop + control.offsetHeight >= bottom - 1 && control.offsetLeft >= right - 1);
  });
  await expect.poll(belowAll).toBe(true);
  f.set('SUCCEEDED');
  await expect(page.getByText('新增经营发现', {exact:true})).toBeVisible({timeout:10000});
  expect(await node!.evaluate(el => el.isConnected)).toBe(true);
  for (const width of [390, 944, 1440]) {
    await page.setViewportSize({width,height:841});
    await expect.poll(belowAll).toBe(true);
    expect(await more.evaluate(el => el.getAnimations().filter(a => a.playState === 'running').length)).toBe(0);
  }
});

test('画报阅读隐藏内部说明与计算文件，资料引用复用会话文件卡片', async ({ page }) => {
  await generationFixture(page);
  await page.route('**/api/**/feedback?*', route => route.fulfill({ json: { feedback: null } }));
  await page.route('**/tasks/' + uid(21), route => route.fulfill({ json: {
    conversation: info,
    tasks: [{ ...task('合成阅读'), id: uid(21), status: 'SUCCEEDED', revision: 1, attempt: 1,
      reply: '根据收款明细形成的业务分析。', executionClass: 'verification',
      sources: [{ id: uid(70), tenantId: tenant, workspaceId: space, materialId: uid(71), versionId: uid(72), runId: uid(73),
        version: 2, filename: '收款明细.csv', locator: '第 1–20 行', method: 'TABLE', content: '合成来源摘要' }],
      artifacts: [{ id: uid(74), filename: 'dataset-comparison-test.json', sha256: 'a'.repeat(64), bytes: 12 },
        { id: uid(75), filename: 'report.csv', sha256: 'b'.repeat(64), bytes: 12 }],
    }], hasMore: false, cursor: 1,
  } }));
  await page.goto(home);
  await page.getByRole('button', { name: '阅读：已有经营发现', exact: true }).click();
  const dialog = page.locator('.live-reading-dialog');
  await expect(dialog).toContainText('根据收款明细形成的业务分析。');
  await expect(dialog.getByText('推荐与呈现依据')).toHaveCount(0);
  await expect(dialog.getByText('生成规则版本')).toHaveCount(0);
  await expect(dialog.getByText('dataset-comparison-test.json')).toHaveCount(0);
  await dialog.getByLabel('资料引用（1）').click();
  await expect(dialog.locator('.reply-reference-library:not(.reading-evidence) .reply-reference-file header')).toContainText('收款明细.csv');
  await dialog.getByText('第 1–20 行', { exact: true }).click();
  await expect(dialog.getByText('合成来源摘要')).toBeVisible();
  await expect(dialog.getByRole('link', { name: '在会话中查看来源' })).toBeVisible();
  await dialog.getByText('成果附件', { exact: true }).click();
  await expect(dialog.locator('.reading-evidence[open]')).toContainText('report.csv');
});

test('会话联网按钮替代关键词表单，默认按需与勾选要求使用不同任务模式', async ({ page }) => {
  for (const required of [false, true]) {
    let body: any;
    await fixture(page, async (route, value) => { body=value; return accepted(route,value); });
    await page.route('**/api/**/conversations?*', route => route.request().method()==='GET'
      ? route.fulfill({json:{tenantId:tenant,enabled:true,agentMode:'live',publicWebEnabled:true,items:[],hasMore:false}})
      : route.fallback());
    await page.goto(`/workspace/#tenant=${tenant}&view=conversations`);
    const web = page.getByRole('button',{name:'联网',exact:true});
    await expect(web).toHaveAttribute('aria-pressed','false');
    await expect(page.getByText('查找公开资料（可选）')).toHaveCount(0);
    if(required)await web.click();
    await expect(web).toHaveAttribute('aria-pressed',String(required));
    await page.getByPlaceholder('告诉我你想处理的工作').fill('合成联网请求');
    await page.locator('.live-composer-submit').click();
    await expect.poll(()=>body?.publicQuery).toBe(required?'web:required:v1':'web:optional:v1');
    await page.screenshot({path:`test-results/web-shortcut-${required}.png`});
  }
});

test('已完成画报读取失败可关闭并回到生成首页，轮询与刷新不会重新卡住', async ({ page }) => {
  const f = await generationFixture(page, true);
  f.readFailure(true);
  await page.goto(home);
  await expect(page.locator('.generation-placeholder')).toBeVisible();
  f.set('SUCCEEDED');
  await expect(page.getByRole('button', { name: '重新读取', exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: '返回生成首页', exact: true }).click();
  await expect(page.locator('.generation-placeholder')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '生成更多', exact: true })).toBeEnabled();
  const reads = f.reads;
  await expect.poll(() => f.reads).toBeGreaterThan(reads);
  await expect(page.locator('.generation-placeholder')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: '生成更多', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '生成更多', exact: true }).click();
  await expect(page.getByRole('heading', { name: '选择生成数量', exact: true })).toBeVisible();
  expect(f.posts).toHaveLength(0);
});
