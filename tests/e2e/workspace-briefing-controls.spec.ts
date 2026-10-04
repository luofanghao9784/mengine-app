import datasetBriefing from '../../contracts/fixtures/dataset-briefing.json' with { type: 'json' };
import type { BriefingDocument } from '../../contracts/public-api/briefing-content';
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

test('输入和中文选词留在画报，草稿可恢复，发送接受后才打开会话', async ({ page }) => {
  const sends: Record<string, unknown>[] = [];
  let complete: (() => void) | undefined;
  await fixture(page, async (route, body) => {
    sends.push(body);
    await new Promise<void>((resolve) => {
      complete = resolve;
    });
    await accepted(route, body);
  });
  await page.goto(home);
  const input = page.getByRole('textbox', { name: '新的工作需求', exact: true });
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  await input.fill('先完整输入我的工作要求');
  await input.dispatchEvent('compositionstart');
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  await input.dispatchEvent('compositionend');
  await expect(page).toHaveURL(/view=briefing$/);
  expect(sends).toHaveLength(0);
  await page.reload();
  await expect(input).toHaveValue('先完整输入我的工作要求');
  await input.evaluate((e: HTMLTextAreaElement) => e.setSelectionRange(e.value.length, e.value.length));
  await input.press('Shift+Enter');
  await input.pressSequentially('第二行');
  await expect(input).toHaveValue('先完整输入我的工作要求\n第二行');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => sends.length).toBe(1);
  await expect(page).toHaveURL(/view=briefing$/);
  await expect(page.getByRole('button', { name: '提交中…', exact: true })).toBeDisabled();
  complete!();
  await expect(page).toHaveURL(new RegExp(`view=conversations&conversation=${conversation}&from=briefing`));
  await expect(page.getByRole('region', { name: '会话视窗', exact: true })).toBeVisible();
  expect(sends[0].prompt).toBe('先完整输入我的工作要求\n第二行');
  expect(sends[0].workspaceId).toBe(space);
  expect(sends[0].sourceScope).toBe('AUTHORIZED_LIBRARY');
});

test('发送结果未知时不跳转，刷新后仍用原请求重试', async ({ page }) => {
  const sends: Record<string, unknown>[] = [];
  await fixture(page, async (route, body) => {
    sends.push(body);
    if (sends.length === 1) return route.abort('failed');
    return accepted(route, body);
  });
  await page.goto(home);
  const input = page.getByRole('textbox', { name: '新的工作需求', exact: true });
  await input.fill('合成重试验证');
  await input.press('Enter');
  await expect(page.getByRole('button', { name: '重试上次发送', exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/view=briefing$/);
  await page.reload();
  await expect(input).toHaveValue('合成重试验证');
  await expect(input).toBeDisabled();
  await page.getByRole('button', { name: '重试上次发送', exact: true }).click();
  await expect(page).toHaveURL(/view=conversations/);
  expect(sends).toHaveLength(2);
  expect(sends[1]).toEqual(sends[0]);
});

test('顶部维度独立筛选，推荐无重复下拉或转发入口，窄屏输入不溢出', async ({ page }) => {
  const requests = await fixture(page, accepted);
  await page.goto(home);
  await expect(page.getByRole('textbox', { name: '新的工作需求', exact: true })).toBeVisible();
  await expect(page.locator('.live-briefing-filters')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /转发/ })).toHaveCount(0);
  await expect(page.locator('.forwarding-inbox, .attention')).toHaveCount(0);
  await page.getByRole('tab', { name: '类型', exact: true }).click();
  await page
    .getByRole('group', { name: '内容类型' })
    .getByRole('button', { name: '数据', exact: true })
    .click();
  await expect
    .poll(() =>
      requests
        .filter((u) => u.pathname.endsWith('/recommendations'))
        .at(-1)
        ?.searchParams.get('businessType'),
    )
    .toBe('DATA');
  await page.getByRole('tab', { name: '空间', exact: true }).click();
  await page.getByLabel('画报工作空间', { exact: true }).selectOption(space);
  await expect
    .poll(() =>
      requests
        .filter((u) => u.pathname.endsWith('/recommendations'))
        .at(-1)
        ?.searchParams.get('workspaceId'),
    )
    .toBe(space);
  expect(
    requests
      .filter((u) => u.pathname.endsWith('/recommendations'))
      .at(-1)
      ?.searchParams.has('businessType'),
  ).toBe(false);
  await page.getByRole('tab', { name: '推荐', exact: true }).click();
  await expect(page.locator('.live-briefing-filters')).toHaveCount(0);
  await expect
    .poll(() =>
      requests
        .filter((u) => u.pathname.endsWith('/recommendations'))
        .at(-1)
        ?.searchParams.has('workspaceId'),
    )
    .toBe(false);
  expect(requests.some((u) => /attention|forwarding/.test(u.pathname))).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  const input = page.getByRole('textbox', { name: '新的工作需求', exact: true });
  await input.fill('窄屏合成草稿');
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeInViewport();
  const box = await page.locator('.workspace-composer').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
});

const refreshPanel = (page: Page) => page.locator('#live-briefing-panel');
async function pull(page: Page, distance: number, release = true) {
  const box = (await refreshPanel(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 6 + distance, { steps: 8 });
  if (release) await page.mouse.up();
}

test('真实画报沿 Demo 下拉阈值和取消，等待真实读取后才显示完成，失败不报成功', async ({ page }) => {
  const requests = await fixture(page, accepted);
  await page.goto(home);
  await expect(page.getByRole('textbox', { name: '新的工作需求' })).toBeVisible();
  await expect(page.getByText('推荐设置与依据', { exact: true })).toHaveCount(0);
  const count = () => requests.filter((u) => u.pathname.endsWith('/recommendations')).length;
  const before = count();
  await pull(page, 45);
  await expect(refreshPanel(page)).toHaveAttribute('data-refresh-phase', 'idle');
  expect(count()).toBe(before);
  await pull(page, 190, false);
  await expect(refreshPanel(page)).toHaveAttribute('data-refresh-phase', 'ready');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(refreshPanel(page)).toHaveAttribute('data-refresh-phase', 'idle');
  expect(count()).toBe(before);

  let finish: (() => void) | undefined;
  await page.route('**/recommendations?*', async (route) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    await route.fallback();
  });
  await pull(page, 190);
  await expect(refreshPanel(page)).toHaveAttribute('data-refresh-phase', 'refreshing');
  await expect(page.getByRole('button', { name: '刷新智能画报', exact: true })).toBeDisabled();
  await expect.poll(() => !!finish).toBe(true);
  // Longer than Demo's 650ms animation: a slow read must still be pending.
  await page.waitForTimeout(750);
  await expect(refreshPanel(page)).toHaveAttribute('data-refresh-phase', 'refreshing');
  finish!();
  await expect(refreshPanel(page)).toHaveAttribute('data-refresh-phase', 'idle');
  await expect(page.getByRole('status').filter({ hasText: '画报已刷新' })).toBeAttached();
  expect(count()).toBe(before + 1);
  expect(requests.filter((u) => /generation/.test(u.pathname))).toHaveLength(1);

  await page.unroute('**/recommendations?*');
  await page.route('**/recommendations?*', (route) => route.abort('failed'));
  await page.getByRole('button', { name: '刷新智能画报', exact: true }).click();
  await expect(page.getByRole('heading', { name: '暂时无法读取', exact: true })).toBeVisible();
  await expect(refreshPanel(page)).toHaveAttribute('data-refresh-phase', 'idle');
  await expect(page.getByRole('status').filter({ hasText: '刷新未完成' })).toBeAttached();
  await expect(page.getByRole('status').filter({ hasText: '画报已刷新' })).toHaveCount(0);
});

test('触控板在顶部刷新一次，滚回顶部的惯性不误触发，输入内容保留', async ({ page }) => {
  const requests = await fixture(page, accepted);
  await page.goto(home);
  await expect(page.getByRole('textbox', { name: '新的工作需求' })).toBeVisible();
  await page.getByRole('textbox', { name: '新的工作需求' }).fill('刷新保留合成草稿');
  await page.addStyleTag({ content: '#live-briefing-panel { min-height: 1800px; }' });
  const count = () => requests.filter((u) => u.pathname.endsWith('/recommendations')).length;
  const before = count();
  const box = (await refreshPanel(page).boundingBox())!;
  await page.mouse.move(box.x + box.width - 6, box.y + 30);
  await page.mouse.wheel(0, 550);
  await expect.poll(() => page.locator('.access-content').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await page.waitForTimeout(280);
  await page.mouse.wheel(0, -1200);
  await expect(page.locator('.access-content')).toHaveJSProperty('scrollTop', 0);
  await page.mouse.wheel(0, -60);
  await page.waitForTimeout(230);
  expect(count()).toBe(before);
  await page.waitForTimeout(280);
  await page.mouse.wheel(0, -210);
  await expect.poll(count).toBe(before + 1);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -20);
    await page.waitForTimeout(95);
  }
  await expect(refreshPanel(page)).toHaveAttribute('data-refresh-phase', 'idle');
  expect(count()).toBe(before + 1);
  await expect(page.getByRole('textbox', { name: '新的工作需求' })).toHaveValue('刷新保留合成草稿');
  await expect(page).toHaveURL(/view=briefing$/);
});

test('触屏下拉和取消沿用 Demo，刷新后留在画报', async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const requests = await fixture(page, accepted);
  await page.goto(home);
  await expect(page.getByRole('textbox', { name: '新的工作需求' })).toBeVisible();
  const box = (await refreshPanel(page).boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + 6;
  const client = await context.newCDPSession(page);
  const start = () =>
    client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  const move = () =>
    client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + 190 }] });
  const end = (cancel: boolean) =>
    client.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
  const count = () => requests.filter((u) => u.pathname.endsWith('/recommendations')).length;
  const before = count();
  await start();
  await move();
  await expect(refreshPanel(page)).toHaveAttribute('data-refresh-phase', 'ready');
  await end(true);
  await expect(refreshPanel(page)).toHaveAttribute('data-refresh-phase', 'idle');
  expect(count()).toBe(before);
  await start();
  await move();
  await end(false);
  await expect.poll(count).toBe(before + 1);
  await expect(refreshPanel(page)).toHaveAttribute('data-refresh-phase', 'idle');
  await expect(page).toHaveURL(/view=briefing$/);
  await context.close();
});

test('工作空间横滑切栏受边界保护，一次惯性只切一栏，纵滑尾流与浏览器历史分开', async ({ page }) => {
  await fixture(page, accepted);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(home.replace('view=briefing', 'view=library&scope=personal'));
  await page.getByRole('link', { name: '智能画报', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '新的工作需求' })).toBeVisible();
  await expect(page.locator('html')).toHaveCSS('overscroll-behavior-x', 'none');
  await expect(page.locator('html')).toHaveCSS('overscroll-behavior-y', 'none');
  const historyLength = await page.evaluate(() => history.length);
  await page.addStyleTag({ content: '#live-briefing-panel { min-height: 1800px; }' });
  const active = page.getByRole('tab', { selected: true });
  const box = (await refreshPanel(page).boundingBox())!;
  await page.mouse.move(box.x + box.width - 6, box.y + 20);
  await page.mouse.wheel(0, 180);
  await page.mouse.wheel(120, 0);
  await expect(active).toHaveText('推荐');
  await page.waitForTimeout(260);
  await page.mouse.wheel(100, 0);
  for (const delta of [70, 40, 20, 8]) await page.mouse.wheel(delta, 0);
  await expect(active).toHaveText('关注');
  await expect(page.locator('.access-content')).toHaveJSProperty('scrollTop', 0);
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  await expect(page).toHaveURL(/view=briefing$/);
  await page.goBack();
  await expect(page).toHaveURL(/view=library&scope=personal$/);
  await page.goForward();
  await expect(page).toHaveURL(/view=briefing$/);
});

test('表格、输入和缩放保留原操作，表格到边界也不切画报或触发下拉刷新', async ({ page }) => {
  const requests = await fixture(page, accepted);
  await page.goto(home);
  await expect(page.getByRole('textbox', { name: '新的工作需求' })).toBeVisible();
  await page.evaluate(() => {
    const table = document.createElement('div');
    table.setAttribute('aria-label', '合成可滚动表格');
    table.style.cssText = 'width:280px;height:100px;overflow:auto;overscroll-behavior:contain;';
    table.innerHTML = '<div style="width:1200px;height:800px">合成表格内容</div>';
    document.querySelector('#live-briefing-panel')!.prepend(table);
  });
  const table = page.getByLabel('合成可滚动表格');
  await table.hover();
  await page.mouse.wheel(180, 0);
  await expect.poll(() => table.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
  await table.evaluate((e) => {
    e.scrollLeft = e.scrollWidth;
  });
  await page.mouse.wheel(180, 0);
  await expect(page.getByRole('tab', { selected: true })).toHaveText('推荐');
  const reads = requests.filter((r) => r.pathname.endsWith('/recommendations')).length;
  await page.waitForTimeout(260);
  await page.mouse.wheel(0, -210);
  await page.waitForTimeout(260);
  expect(requests.filter((r) => r.pathname.endsWith('/recommendations')).length).toBe(reads);
  await expect(refreshPanel(page)).toHaveAttribute('data-refresh-phase', 'idle');
  const input = page.getByRole('textbox', { name: '新的工作需求' });
  await input.fill('合成草稿保持原位');
  await input.dispatchEvent('wheel', { deltaX: 180 });
  await expect(page.getByRole('tab', { selected: true })).toHaveText('推荐');
  const zoomPrevented = await refreshPanel(page).evaluate((e) => {
    const zoom = new WheelEvent('wheel', { deltaY: -180, ctrlKey: true, bubbles: true, cancelable: true });
    e.dispatchEvent(zoom);
    return zoom.defaultPrevented;
  });
  expect(zoomPrevented).toBe(false);
  await expect(input).toHaveValue('合成草稿保持原位');
});

test('生成入口卡正文支持触控板切栏与下拉刷新，按钮滚动不误生成', async ({ page }) => {
  const generationPosts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.includes('generation'))
      generationPosts.push(request.url());
  });
  const requests = await fixture(page, accepted);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(home);
  const copy = page.locator('.briefing-generation h3');
  await copy.hover();
  await page.mouse.wheel(110, 0);
  await expect(page.getByRole('tab', { selected: true })).toHaveText('关注');
  await page.getByRole('tab', { name: '推荐', exact: true }).click();
  await page.waitForTimeout(260);
  const reads = () => requests.filter((r) => r.pathname.endsWith('/recommendations')).length;
  const before = reads();
  await copy.hover();
  await page.mouse.wheel(0, -200);
  await expect.poll(reads).toBe(before + 1);
  await expect(refreshPanel(page)).toHaveAttribute('data-refresh-phase', 'idle');
  const tab = page.getByRole('tab', { selected: true });
  await page.getByRole('button', { name: '生成更多', exact: true }).hover();
  await page.mouse.wheel(110, 0);
  await expect(tab).toHaveText('推荐');
  expect(generationPosts).toEqual([]);
});

test('真实工作空间触摸横滑切栏，竖滑滚动和多指保持浏览器原生操作', async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await fixture(page, accepted);
  await page.goto(home);
  await expect(page.getByRole('textbox', { name: '新的工作需求' })).toBeVisible();
  await page.addStyleTag({ content: '#live-briefing-panel { min-height:1800px; }' });
  const cdp = await context.newCDPSession(page);
  const swipe = async (x: number, y: number, dx: number, dy: number) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + (dx * i) / 8, y: y + (dy * i) / 8 }],
      });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const active = page.getByRole('tab', { selected: true });
  // The generation tile is a reading surface too, not one large excluded control.
  expect(
    await page.evaluate(() => !!document.elementFromPoint(350, 260)?.closest('.briefing-generation')),
  ).toBe(true);
  await swipe(350, 260, -230, 3);
  await expect(active).toHaveText('关注');
  // Wait for the async empty feed so its loading target is not detached mid-touch.
  await expect(
    page.getByRole('heading', { name: '画报正在等待可用资料', exact: true }).first(),
  ).toBeVisible();
  await swipe(70, 260, 230, 0);
  await expect(active).toHaveText('推荐');
  await swipe(350, 520, 0, -200);
  await expect.poll(() => page.locator('.access-content').evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  await expect(active).toHaveText('推荐');
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: 220, y: 240 },
      { x: 260, y: 290 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: 80, y: 240 },
      { x: 120, y: 290 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(active).toHaveText('推荐');
  await expect(page).toHaveURL(/view=briefing$/);
  await context.close();
});

test('正式会话容器可接管区域内横滑，导航区和缩放事件保持原生', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await fixture(page, accepted);
  await page.goto(home.replace('view=briefing', 'view=conversations'));
  await expect(page.getByRole('region', { name: '会话视窗', exact: true })).toBeVisible();
  const emit = async (selector: string, ctrlKey = false) =>
    page.locator(selector).evaluate((node, ctrlKey) => {
      const event = new WheelEvent('wheel', { deltaX: 180, bubbles: true, cancelable: true, ctrlKey });
      node.dispatchEvent(event);
      return event.defaultPrevented;
    }, ctrlKey);
  expect(await emit('.access-sidebar')).toBe(false);
  expect(await emit('.live-deck-toolbar')).toBe(true);
  expect(await emit('.live-deck-toolbar', true)).toBe(false);
  expect(errors).toEqual([]);
  await expect(page).toHaveURL(/view=conversations$/);
});

async function readingConversation(page: Page, document?: BriefingDocument) {
  await fixture(page, accepted);
  const longText = '这是一段用于验证会话阅读与横向卡片滚动的合成内容。'.repeat(80);
  const detail = {
    conversation: info,
    tasks: [
      {
        ...task(longText),
        status: 'SUCCEEDED',
        executionClass: 'live',
        reply: longText,
        artifacts: [
          {
            id: uid(8),
            filename: document ? 'briefing-dataset-example.json' : 'briefing-text-example.json',
            sha256: 'a'.repeat(64),
            bytes: 100,
          },
        ],
      },
    ],
    hasMore: false,
    cursor: 1,
  };
  let readable = true;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/conversations'))
      return route.fulfill({
        json: {
          tenantId: tenant,
          enabled: true,
          agentMode: 'live',
          publicWebEnabled: false,
          items: [info],
          hasMore: false,
        },
      });
    if (path.endsWith('/tasks/' + taskId + '/briefing'))
      return route.fulfill({
        json: document ?? {
          artifactId: uid(8),
          sha256: 'a'.repeat(64),
          content: {
            schemaVersion: 'briefing-text-v1',
            businessType: 'INSIGHT',
            title: '五店两期收款对比分析',
            summary: '本画报使用合成内容验证真实标题与阅读交互，不使用会话提示词充当标题。',
            analysis: [longText.slice(0, 480), longText.slice(0, 480), longText.slice(0, 480)],
            chart: null,
            source: null,
            calculationArtifactId: null,
            calculationSha256: null,
            generatedAt: now,
          },
        },
      });
    if (path.endsWith('/tasks/' + taskId))
      return readable
        ? route.fulfill({ json: detail })
        : route.fulfill({ status: 403, json: { code: 'ACCESS_DENIED' } });
    if (path.endsWith('/conversations/' + conversation)) return route.fulfill({ json: detail });
    return route.fallback();
  });
  await page.setViewportSize({ width: 1275, height: 773 });
  await page.goto(
    home.replace(
      'view=briefing',
      `view=conversations&conversation=${conversation}&from=briefing&briefingTask=${taskId}&briefingSpace=${space}&briefingRevision=1&briefingAttempt=0`,
    ),
  );
  await expect(page.locator('[data-deck-id="briefing"] h2')).toHaveText(
    document?.content.title ?? '五店两期收款对比分析',
  );
  return {
    restrict: () => {
      readable = false;
    },
  };
}

test('触控板在会话和画报正文内横滑，起始纵向微抖不锁错方向，竖滚与内嵌表格各自处理', async ({ page }) => {
  await readingConversation(page);
  const rail = page.locator('.live-deck-scroller');
  const body = page.locator('.conversation-messages');
  await expect.poll(() => rail.evaluate((n) => n.scrollWidth - n.clientWidth)).toBeGreaterThan(100);
  await body.hover();
  await page.mouse.wheel(0, 2);
  await page.mouse.wheel(130, 8);
  await expect.poll(() => rail.evaluate((n) => n.scrollLeft)).toBeGreaterThan(100);
  await page.waitForTimeout(260);
  await body.hover();
  await page.mouse.wheel(-130, 0);
  await expect.poll(() => rail.evaluate((n) => n.scrollLeft)).toBeLessThan(5);
  await page.waitForTimeout(260);
  await page.mouse.wheel(0, 180);
  await expect.poll(() => body.evaluate((n) => n.scrollTop)).toBeGreaterThan(100);
  expect(await rail.evaluate((n) => n.scrollLeft)).toBeLessThan(5);
  await page.waitForTimeout(260);
  const source = page.locator('[data-deck-id="briefing"] .live-source-reader');
  await source.hover({ position: { x: 50, y: 150 } });
  await page.mouse.wheel(150, 0);
  await expect.poll(() => rail.evaluate((n) => n.scrollLeft)).toBeGreaterThan(100);
  await body.evaluate((n) => {
    const table = document.createElement('div');
    table.id = 'conversation-nested-table';
    table.style.cssText = 'overflow:auto;width:220px;height:60px;overscroll-behavior:contain';
    table.innerHTML = '<div style="width:800px;height:40px">合成横向数据表格</div>';
    n.prepend(table);
    n.scrollTop = 0;
  });
  const table = page.locator('#conversation-nested-table');
  await table.evaluate((n) => {
    n.scrollLeft = n.scrollWidth;
  });
  const before = await rail.evaluate((n) => n.scrollLeft);
  await page.waitForTimeout(260);
  await table.hover();
  await page.mouse.wheel(140, 0);
  expect(await rail.evaluate((n) => n.scrollLeft)).toBeCloseTo(before, 0);
});

test('会话与画报标题采用 Demo 渐变边缘，显示真实成果标题并去除重复标签与快捷键提示', async ({ page }) => {
  const state = await readingConversation(page);
  await expect(page.getByText('私人会话', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Enter 发送 · Shift + Enter 换行', { exact: true })).toHaveCount(0);
  await expect(page.getByText('仅自己可见', { exact: true })).toBeVisible();
  const heading = page.locator('[data-deck-id="briefing"] .live-card-heading h2');
  await expect(heading).not.toHaveText(info.title);
  for (const [reader, header] of [
    ['.conversation-messages', '.conversation-reader > .live-card-heading'],
    ['.live-source-reader', '[data-deck-id="briefing"] .live-card-heading'],
  ]) {
    const edge = page.locator(header);
    expect(await edge.evaluate((n) => getComputedStyle(n, '::after').opacity)).toBe('0');
    await page.locator(reader).evaluate((n) => {
      n.scrollTop = 160;
    });
    await expect.poll(() => edge.evaluate((n) => getComputedStyle(n, '::after').opacity)).toBe('1');
    const style = await edge.evaluate((n) => {
      const s = getComputedStyle(n, '::after');
      return { blur: s.backdropFilter, mask: s.maskImage, height: s.height, hit: s.pointerEvents };
    });
    expect(style).toMatchObject({ blur: 'blur(6px)', height: '18px', hit: 'none' });
    expect(style.mask).toContain('linear-gradient');
    await page.locator(reader).evaluate((n) => {
      n.scrollTop = 0;
    });
    await expect.poll(() => edge.evaluate((n) => getComputedStyle(n, '::after').opacity)).toBe('0');
  }
  // A denied task must not leave a formerly readable result title in the header.
  state.restrict();
  await page.reload();
  await expect(heading).toHaveText('画报卡片');
});

test('正式导航悬浮复用 Demo 视觉参数，图标与正文不移位，切换和移开只保留当前提示', async ({ page }) => {
  await page.goto('/#/briefing');
  const demoLink = page.locator('.sidebar nav').getByRole('button', { name: '会话', exact: true });
  await demoLink.hover();
  await expect(demoLink.locator('.nav-label')).toHaveCSS('opacity', '1');
  const visual = (node: Element) => {
    const link = getComputedStyle(node),
      label = node.querySelector('.nav-label')!;
    return {
      width: link.width,
      height: link.height,
      radius: link.borderRadius,
      color: link.color,
      layers: ['::before', '::after'].map((pseudo) => {
        const s = getComputedStyle(label, pseudo);
        return { background: s.backgroundColor, blur: s.backdropFilter, mask: s.maskImage, inset: s.inset };
      }),
      transition: getComputedStyle(label).transitionDuration,
    };
  };
  const expected = await demoLink.evaluate(visual);
  expect(expected.layers.map((layer) => layer.blur)).toEqual(['blur(4px)', 'blur(12px)']);
  await fixture(page, accepted);
  await page.goto(home);
  const nav = page.getByRole('navigation', { name: '主导航' });
  const mainBounds = await page.locator('.access-main').boundingBox();
  for (const name of ['会话', '智能画报', '资料库']) {
    const link = nav.getByRole('link', { name, exact: true });
    const bounds = await link.boundingBox();
    await link.hover();
    await expect(link.locator('.nav-label')).toHaveCSS('opacity', '1');
    await expect(nav.locator('.is-expanded')).toHaveCount(1);
    expect(await link.boundingBox()).toEqual(bounds);
    expect(await page.locator('.access-main').boundingBox()).toEqual(mainBounds);
    expect(await link.evaluate(visual)).toEqual(expected);
  }
  const label = nav.getByRole('link', { name: '资料库', exact: true }).locator('.nav-label');
  await page.mouse.move(650, 30);
  await expect(label).toHaveCSS('opacity', '0');
  await expect(nav.locator('.is-expanded')).toHaveCount(0);
  await expect(page).toHaveURL(/view=briefing$/);
});

test('正式导航键盘提示可关闭，点击后收起，窄屏无悬浮残留且减少动态设置生效', async ({ page }) => {
  await fixture(page, accepted);
  await page.goto(home);
  const nav = page.getByRole('navigation', { name: '主导航' });
  const chat = nav.getByRole('link', { name: '会话', exact: true });
  await page.locator('.access-brand').focus();
  await page.keyboard.press('Tab');
  await expect(chat).toBeFocused();
  await expect(chat.locator('.nav-label')).toHaveCSS('opacity', '1');
  await page.keyboard.press('Escape');
  await expect(chat.locator('.nav-label')).toHaveCSS('opacity', '0');
  await expect(chat).toBeFocused();
  await page.keyboard.press('Tab');
  const briefing = nav.getByRole('link', { name: '智能画报', exact: true });
  await expect(briefing.locator('.nav-label')).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  await expect(nav.locator('.is-expanded')).toHaveCount(0);
  await chat.hover();
  await chat.click();
  await expect(page).toHaveURL(/view=conversations$/);
  await expect(chat.locator('.nav-label')).toHaveCSS('opacity', '0');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await briefing.hover();
  await expect(briefing.locator('.nav-label')).toHaveCSS('transition-duration', '0s');
  await expect(briefing.locator('.nav-label')).toHaveCSS('opacity', '1');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(briefing.locator('.nav-label')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

const edgeLayers = (node: Element) =>
  ['::before', '::after'].map((pseudo) => {
    const s = getComputedStyle(node, pseudo);
    return { height: s.height, blur: s.backdropFilter, mask: s.maskImage, hit: s.pointerEvents };
  });

test('页面滚动边缘沿 Demo 显隐，画报和资料库标题固定且窄屏与减少动态设置有效', async ({ page }) => {
  await page.goto('/#/briefing');
  const expected = await page.locator('.main-shell > .topbar').evaluate(edgeLayers);
  expect(expected.map((s) => s.blur)).toEqual(['blur(2px)', 'blur(6px)']);
  await fixture(page, accepted);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const view of ['briefing', 'library&scope=personal']) {
      await page.goto(home.replace('view=briefing', 'view=' + view));
      // Give each real scroll surface a long synthetic layout without API/model work.
      await page.addStyleTag({ content: '.access-content > :first-child { min-height: 1800px; }' });
      const scroll = page.locator('.access-content'),
        header = page.locator('.access-main > .topbar');
      await scroll.evaluate((n) => {
        n.scrollTop = 0;
      });
      await expect.poll(() => header.evaluate((n) => getComputedStyle(n, '::after').opacity)).toBe('0');
      const initial = await header.boundingBox();
      await scroll.hover({ position: { x: 160, y: 230 } });
      await page.mouse.wheel(0, 190);
      await expect.poll(() => scroll.evaluate((n) => n.scrollTop)).toBeGreaterThan(80);
      await expect.poll(() => header.evaluate((n) => getComputedStyle(n, '::after').opacity)).toBe('1');
      expect(await header.evaluate(edgeLayers)).toEqual(expected);
      expect(await header.boundingBox()).toEqual(initial);
      await scroll.evaluate((n) => {
        n.scrollTop = 0;
      });
      await expect.poll(() => header.evaluate((n) => getComputedStyle(n, '::after').opacity)).toBe('0');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      expect(await header.evaluate((n) => getComputedStyle(n, '::after').transitionDuration)).toBe('0s');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    }
  }
});

test('会话输入边缘匹配 Demo 的轻模糊和独立白色渐隐，末行可读且输入不被遮挡', async ({ page }) => {
  await page.goto('/#/chat/kg-development');
  const demo = page.locator('.conversation-overlay .composer-wrap');
  await expect(demo).toBeVisible();
  const expected = await demo.evaluate(edgeLayers);
  const expectedFade = await demo.evaluate((n) => getComputedStyle(n, '::after').backgroundImage);
  await readingConversation(page);
  const composer = page.locator('.live-conversations .conversation-composer');
  const body = page.locator('.conversation-messages');
  for (const width of [1275, 834, 390]) {
    await page.setViewportSize({ width, height: 773 });
    if (width < 1000) await page.getByRole('button', { name: '对话', exact: true }).click();
    await expect(composer).toBeVisible();
    const layers = await composer.evaluate(edgeLayers);
    expect(layers.map(({ mask, ...style }) => style)).toEqual(expected.map(({ mask, ...style }) => style));
    // Production CSS may reverse a constant gradient into the equivalent default direction.
    expect([
      expected[0].mask,
      'linear-gradient(rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.533) 55%, rgb(0, 0, 0))',
    ]).toContain(layers[0].mask);
    expect(layers[1].mask).toBe('none');
    expect(await composer.evaluate((n) => getComputedStyle(n, '::after').backgroundImage)).toBe(expectedFade);
    await body.evaluate((n) => {
      n.scrollTop = n.scrollHeight;
    });
    const geometry = await body.evaluate((n) => {
      const form = n.nextElementSibling!,
        reply = n.querySelector('.conversation-reply')!;
      return {
        overlap: n.getBoundingClientRect().bottom - form.getBoundingClientRect().top,
        lastLineClearance: form.getBoundingClientRect().top - reply.getBoundingClientRect().bottom,
      };
    });
    expect(geometry.overlap).toBeCloseTo(22, 0);
    expect(geometry.lastLineClearance).toBeGreaterThanOrEqual(14);
    const input = composer.locator('textarea');
    await input.fill('仅在合成测试填写，不发送');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('仅在合成测试填写，不发送');
    await expect(composer.getByRole('button', { name: '开始任务', exact: true })).toBeEnabled();
    await input.fill('');
  }
});

test('列表与全屏阅读卡片分别跟踪自己的标题边缘，返回顶部后消失', async ({ page }) => {
  await readingConversation(page);
  await page.route('**/api/**/conversations?*', async (route) =>
    route.fulfill({
      json: {
        tenantId: tenant,
        enabled: true,
        agentMode: 'live',
        publicWebEnabled: false,
        items: Array.from({ length: 20 }, (_, index) => ({
          ...info,
          id: uid(100 + index),
          title: `合成会话 ${index + 1}`,
        })),
        hasMore: false,
      },
    }),
  );
  await page.reload();
  const list = page.locator('.live-conversation-links'),
    listHeader = page.locator('.live-list-tools');
  await expect(list.locator('a')).toHaveCount(20);
  await list.evaluate((n) => {
    n.scrollTop = 180;
  });
  await expect.poll(() => listHeader.evaluate((n) => getComputedStyle(n, '::after').opacity)).toBe('1');
  expect(
    await page
      .locator('.conversation-reader > header')
      .evaluate((n) => getComputedStyle(n, '::after').opacity),
  ).toBe('0');
  await list.evaluate((n) => {
    n.scrollTop = 0;
  });
  await expect.poll(() => listHeader.evaluate((n) => getComputedStyle(n, '::after').opacity)).toBe('0');
  const source = page.locator('[data-deck-id="briefing"]');
  // The first tap reveals a partially clipped card before its actions activate.
  await source.locator('h2').click();
  await expect(source).not.toHaveAttribute('data-needs-reveal');
  await source.getByRole('button', { name: '全屏查看画报卡片' }).click();
  await expect(source).toHaveAttribute('aria-modal', 'true');
  const reader = source.locator('.live-source-reader'),
    header = source.locator('.live-card-heading');
  await reader.hover();
  await page.mouse.wheel(0, 180);
  await expect.poll(() => header.evaluate((n) => getComputedStyle(n, '::after').opacity)).toBe('1');
  expect((await header.evaluate(edgeLayers)).map((s) => s.blur)).toEqual(['blur(2px)', 'blur(6px)']);
  await reader.evaluate((n) => {
    n.scrollTop = 0;
  });
  await expect.poll(() => header.evaluate((n) => getComputedStyle(n, '::after').opacity)).toBe('0');
  await source.getByRole('button', { name: '退出来源全屏' }).click();
  await expect(source).not.toHaveAttribute('aria-modal');
});

test('数据库画报在正式阅读页面展示固定版本与未知业务覆盖，撤权后清除内容', async ({ page }) => {
  const state = await readingConversation(page, datasetBriefing as BriefingDocument);
  const body = page.locator('[data-deck-id="briefing"]');
  await body.getByText('资料、统计口径与计算依据', { exact: true }).click();
  await expect(body).toContainText('合成销售数据 · v2');
  await expect(body).toContainText('业务覆盖时间未提供');
  await expect(body).toContainText('采集时间不代表数据统计期间');
  await expect(body).toContainText('纳入比较 5 行，其他期间 1 行不纳入比较');
  await body.getByText('查看完整对比数据', { exact: true }).click();
  await expect(body.getByRole('table')).toContainText('200.20');
  await page.screenshot({ path: '.local/dataset-briefing/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const basis = body.locator('.data-briefing-basis');
  if (!(await basis.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await basis.locator('summary').click();
  }
  await basis.getByText('纳入比较', { exact: false }).scrollIntoViewIfNeeded();
  await expect(basis.getByText('纳入比较', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/dataset-briefing/mobile.png', fullPage: true });
  state.restrict();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(body.getByRole('table')).toHaveCount(0);
  await expect(body.getByText('合成销售数据 · v2', { exact: false })).toHaveCount(0);
});
