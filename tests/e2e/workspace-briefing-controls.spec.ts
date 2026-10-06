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
  supplementalInput: '',
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
  await expect(page.locator('.live-viewport-morph')).toHaveCount(0);
  await expect(page.locator('.live-demo-deck > .live-deck-scroller')).toHaveCSS(
    'animation-name',
    'live-deck-enter',
  );
  const gaps = await page.locator('.live-deck-arrows .icon-button').evaluateAll((buttons) => {
    const boxes = buttons.map((button) => button.getBoundingClientRect());
    return boxes.slice(1).map((box, i) => box.left - boxes[i].right);
  });
  expect(gaps).toEqual([8, 8]);
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
  await expect(page.getByRole('button', { name: '刷新智能画报', exact: true })).toHaveCount(0);
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
  await pull(page, 190);
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
    page.getByRole('heading', { name: '还没有关注的卡片', exact: true }).first(),
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
  await page.waitForTimeout(260);
  await table.hover();
  const before = await rail.evaluate((n) => n.scrollLeft);
  await page.mouse.wheel(140, 0);
  expect(await rail.evaluate((n) => n.scrollLeft)).toBeCloseTo(before, 0);
});

test('会话与画报标题采用 Demo 渐变边缘，显示真实成果标题并去除重复标签与快捷键提示', async ({ page }) => {
  const state = await readingConversation(page);
  await expect.poll(() => page.locator('.live-card-heading').evaluateAll(nodes =>
    nodes.map(node => Math.round(node.getBoundingClientRect().height)),
  )).toEqual([48, 48, 48]);
  await expect(page.getByText('私人会话', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Enter 发送 · Shift + Enter 换行', { exact: true })).toHaveCount(0);
  const heading = page.locator('[data-deck-id="briefing"] .live-card-heading h2');
  await expect(heading).not.toHaveText(info.title);
  for (const [reader, header] of [
    ['.conversation-messages', '.conversation-reader > .live-card-heading'],
    ['.live-source-reader', '[data-deck-id="briefing"] .live-card-heading'],
  ]) {
    const edge = page.locator(header);
    await page.locator(reader).evaluate(n => { n.scrollTop = 0; });
    await expect.poll(() => edge.evaluate((n) => getComputedStyle(n, '::after').opacity)).toBe('0');
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
  await page.emulateMedia({ reducedMotion: 'reduce' });
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
    // DEC-130：客户端导航按钮改为 D 克制版的圆角方块；悬浮标签的虚化层与动效仍沿用 Demo。
    const actual = await link.evaluate(visual);
    expect(actual.layers.map(({ blur, mask, inset }) => ({ blur, mask, inset }))).toEqual(
      expected.layers.map(({ blur, mask, inset }) => ({ blur, mask, inset })),
    );
    expect(actual.transition).toBe(expected.transition);
    expect([actual.width, actual.height, actual.radius]).toEqual(['44px', '44px', '14px']);
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

test('会话白色遮罩顶部与输入框持平，末行可读且输入不被遮挡', async ({ page }) => {
  await readingConversation(page);
  const composer = page.locator('.live-conversations .conversation-composer');
  const body = page.locator('.conversation-messages');
  for (const width of [1275, 834, 390]) {
    await page.setViewportSize({ width, height: 773 });
    if (width < 1000) await page.getByRole('button', { name: '对话', exact: true }).click();
    await expect(composer).toBeVisible();
    const backing = await composer.evaluate((node) => {
      const style = getComputedStyle(node, '::before');
      return {
        top: node.getBoundingClientRect().top + parseFloat(style.top),
        surface: node.querySelector('.live-composer-surface')!.getBoundingClientRect().top,
        after: getComputedStyle(node, '::after').backdropFilter,
        fade: getComputedStyle(node, '::after').backgroundImage,
      };
    });
    expect(backing.top).toBeCloseTo(backing.surface, 0);
    expect(backing.after).toBe('blur(2px)');
    expect(backing.fade).toContain('linear-gradient');
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

test('列表标题跟随自己的滚动，阅读弹窗标题固定且不改变列表', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
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
  await expect(page.locator('.conversation-messages')).toContainText('合成');
  await page.locator('.conversation-messages').hover();
  await page.mouse.wheel(0, -100000);
  await expect.poll(() => page.locator('.conversation-reader > header').evaluate(n => getComputedStyle(n, '::after').opacity)).toBe('0');
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
  const full = page.locator('dialog.live-reading-dialog[open]');
  await expect(full).toBeVisible();
  const reader = full.locator('.live-reading-scroll'),
    header = full.locator('.live-reading-header');
  const headerBefore = await header.boundingBox();
  await reader.hover();
  await page.mouse.wheel(0, 180);
  await expect.poll(() => reader.evaluate((n) => n.scrollTop)).toBeGreaterThan(0);
  expect(await header.boundingBox()).toEqual(headerBefore);
  await expect.poll(() => list.evaluate((n) => n.scrollTop)).toBe(0);
  await reader.evaluate((n) => { n.scrollTop = 0; });
  await expect.poll(() => reader.evaluate((n) => n.scrollTop)).toBe(0);
  expect(await header.boundingBox()).toEqual(headerBefore);
  await full.getByRole('button', { name: '关闭卡片详情', exact: true }).click();
  await expect(full).toHaveCount(0);
});

test('数据库画报在正式阅读页面展示固定版本与未知业务覆盖，撤权后清除内容', async ({ page }) => {
  const state = await readingConversation(page, datasetBriefing as BriefingDocument);
  let body = page.locator('[data-deck-id="briefing"]');
  if (await body.getAttribute('data-needs-reveal')) {
    await body.locator('h2').click();
    await expect(body).not.toHaveAttribute('data-needs-reveal', 'true');
  }
  await body.getByRole('button', { name: '全屏查看画报卡片', exact: true }).click();
  body = page.locator('dialog.live-reading-dialog[open]');
  await expect(body.getByRole('button', { name: '关闭卡片详情', exact: true })).toBeVisible();
  await body.getByText('资料、统计口径与计算依据', { exact: true }).click();
  await expect(body).toContainText('合成销售数据 · v2');
  await expect(body).toContainText('业务覆盖时间未提供');
  await expect(body).toContainText('采集时间不代表数据统计期间');
  await expect(body.getByText('纳入比较 5 行，其他期间 1 行不纳入比较', { exact: false })).toBeVisible();
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

test('数据库洞察画报显示版本依据，不显示未进行的图表计算', async ({ page }) => {
  const document = structuredClone(datasetBriefing) as BriefingDocument;
  Object.assign(document.content, {
    schemaVersion: 'briefing-text-v1',
    businessType: 'INSIGHT',
    chart: null,
    calculationArtifactId: null,
    calculationSha256: null,
    datasetBasis: null,
  });
  const state = await readingConversation(page, document);
  let body = page.locator('[data-deck-id="briefing"]');
  if (await body.getAttribute('data-needs-reveal')) {
    await body.locator('h2').click();
    await expect(body).not.toHaveAttribute('data-needs-reveal', 'true');
  }
  await body.getByRole('button', { name: '全屏查看画报卡片', exact: true }).click();
  body = page.locator('dialog.live-reading-dialog[open]');
  await expect(body.getByRole('button', { name: '关闭卡片详情', exact: true })).toBeVisible();
  await body.getByText('数据依据', { exact: true }).click();
  await expect(body).toContainText('合成销售数据 · v2');
  await expect(body.getByText('快照行数不代表逐行阅读', { exact: false })).toBeVisible();
  await expect(body.getByRole('table')).toHaveCount(0);
  await expect(body.locator('.data-briefing-chart')).toHaveCount(0);
  await page.screenshot({ path: '.local/dataset-briefing/insight.png', fullPage: true });
  state.restrict();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(body.getByText('数据依据', { exact: true })).toHaveCount(0);
});

test('会话列表滚动加载，失败重试保留已有会话和草稿', async ({ page }) => {
  await fixture(page, accepted);
  let fail = true;
  const offsets: number[] = [];
  await page.route('**/conversations?*', async (route) => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset'));
    offsets.push(offset);
    if (offset && fail) return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } });
    const items = Array.from({ length: offset ? 3 : 20 }, (_, i) => ({
      ...info,
      id: uid(100 + offset + i),
      title: `滚动会话${offset + i}`,
    }));
    return route.fulfill({
      json: {
        tenantId: tenant,
        enabled: true,
        agentMode: 'off',
        publicWebEnabled: false,
        items,
        hasMore: !offset,
      },
    });
  });
  await page.goto(home.replace('view=briefing', 'view=conversations'));
  const list = page.locator('.live-conversation-links');
  await expect(list.getByText('滚动会话0', { exact: true })).toBeVisible();
  await expect(page.locator('#conversation-list .platform-pagination')).toHaveCount(0);
  await page.getByRole('textbox', { name: '工作要求', exact: true }).fill('保留滚动中的草稿');
  await list.evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  await expect(page.getByRole('button', { name: '重试加载更多会话' })).toBeVisible();
  await expect(list.getByText('滚动会话0', { exact: true })).toHaveCount(1);
  fail = false;
  await page.getByRole('button', { name: '重试加载更多会话' }).click();
  await expect(list.getByText('滚动会话22', { exact: true })).toBeVisible();
  await expect(list.getByText('滚动会话0', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: '工作要求', exact: true })).toHaveValue('保留滚动中的草稿');
  expect(offsets).toEqual([0, 20, 20]);
});

test('新会话选择工作空间并随草稿恢复，已有会话仅显示空间', async ({ page }) => {
  const shared = uid(9);
  const sharedInfo = { ...info, workspaceId: shared };
  let sent: Record<string, unknown> | undefined;
  await fixture(page, async (route, body) => {
    sent = body;
    await route.fulfill({
      status: 201,
      json: { conversation: sharedInfo, tasks: [task(String(body.prompt))], hasMore: false, cursor: 1 },
    });
  });
  await page.route('**/context', (route) =>
    route.fulfill({
      json: {
        tenant: { id: tenant, name: '合成企业', status: 'ACTIVE' },
        role: 'MEMBER',
        workspaces: [
          { id: space, name: '个人空间', kind: 'PERSONAL' },
          { id: shared, name: '研发空间', kind: 'SHARED' },
        ],
      },
    }),
  );
  await page.route('**/conversations/' + conversation + '?*', (route) =>
    route.fulfill({
      json: { conversation: sharedInfo, tasks: [task('空间选择验证')], hasMore: false, cursor: 1 },
    }),
  );
  await page.goto(home.replace('view=briefing', 'view=conversations'));
  await page.getByRole('textbox', { name: '工作要求', exact: true }).fill('空间选择验证');
  await page.getByRole('button', { name: '选择工作空间', exact: true }).click();
  await page.getByRole('button', { name: '研发空间', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: '选择工作空间', exact: true })).toContainText('研发空间');
  await page.getByRole('button', { name: '开始任务', exact: true }).click();
  await expect.poll(() => sent?.workspaceId).toBe(shared);
  await expect(page.locator('.live-workspace-label')).toHaveText('研发空间');
  await expect(page.getByRole('button', { name: '选择工作空间', exact: true })).toHaveCount(0);
});

test('资料属性在原卡片右侧展开，关闭和全屏保留正文', async ({ page }) => {
  await fixture(page, accepted);
  const chunk = {
    id: uid(60),
    tenantId: tenant,
    workspaceId: space,
    materialId: uid(61),
    versionId: uid(62),
    runId: uid(63),
    version: 1,
    filename: '字段字典.md',
    locator: '第 11 行',
    method: 'TEXT',
    content: '合成资料正文',
  };
  await page.route('**/conversations/' + conversation + '?*', (route) =>
    route.fulfill({
      json: {
        conversation: info,
        tasks: [{ ...task('合成问题'), sources: [chunk] }],
        hasMore: false,
        cursor: 1,
      },
    }),
  );
  await page.route('**/knowledge/chunks/' + chunk.id, (route) => route.fulfill({ json: chunk }));
  await page.goto(home.replace('view=briefing', `view=conversations&conversation=${conversation}`));
  await page.getByLabel('资料引用（1）', { exact: true }).click();
  await page.locator('.reply-reference-fragment > summary').click();
  await page.getByRole('button', { name: '查看来源：第 11 行', exact: true }).click();
  const card = page.locator(`[data-deck-id="${chunk.id}"]`);
  await expect(card).toBeVisible();
  const count = await page.locator('[data-deck-id]').count();
  const originalWidth = (await card.boundingBox())!.width;
  await card.getByRole('button', { name: '查看资料属性 字段字典.md · v1' }).click();
  const panel = card.locator('.live-inline-properties');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('引用位置');
  await expect.poll(async () => (await card.boundingBox())!.width).toBeCloseTo(originalWidth + 280, 0);
  const bodyBounds = (await card.locator('.live-source-reader').boundingBox())!;
  const panelBounds = (await panel.boundingBox())!;
  expect(panelBounds.x).toBeGreaterThanOrEqual(bodyBounds.x + bodyBounds.width - 1);

  await expect(page.locator('[data-deck-id]')).toHaveCount(count);
  await expect
    .poll(() =>
      panel.evaluate((node) => {
        const p = node.getBoundingClientRect(),
          c = node.closest('[data-deck-id]')!.getBoundingClientRect();
        return p.right <= c.right && p.left >= c.left && p.bottom <= c.bottom;
      }),
    )
    .toBe(true);
  await panel.getByRole('button', { name: /关闭资料属性/ }).press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(card.getByText('合成资料正文', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: /全屏查看资料来源/ }).click();
  expect(await card.locator('.live-card-heading').evaluate(n => n.getBoundingClientRect().height)).toBe(48);
  await card.getByRole('button', { name: '查看资料属性 字段字典.md · v1' }).click();
  await expect(panel).toBeVisible();
  await page.setViewportSize({ width: 390, height: 773 });
  await expect(panel).toBeVisible();
  expect(await card.locator('.live-card-heading').evaluate(n => n.getBoundingClientRect().height)).toBe(48);
  await expect.poll(() => panel.evaluate((n) => n.getBoundingClientRect().right <= innerWidth)).toBe(true);
});

test('资料卡显示封面图标、无权限说明栏且顶部范围居中', async ({ page }) => {
  await fixture(page, accepted);
  let reads = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/library')) reads++;
  });
  await page.route('**/api/**/library?*', (route) =>
    route.fulfill({
      json: {
        tenantId: tenant,
        workspaceId: space,
        folderId: null,
        trail: [],
        canMaintain: true,
        maxUploadBytes: 1000000,
        hasMore: false,
        items: ['FOLDER', 'DRAFT'].map((kind, index) => ({
          id: uid(70 + index),
          tenantId: tenant,
          workspaceId: space,
          workspaceName: '个人空间',
          folderId: null,
          kind,
          name: kind === 'FOLDER' ? '资料文件夹' : '工作文稿',
          version: kind === 'FOLDER' ? 0 : 1,
          sizeBytes: kind === 'FOLDER' ? null : 10,
          updatedAt: now,
          path: ['资料'],
          canMaintain: true,
        })),
      },
    }),
  );
  for (const width of [1350, 952, 390]) {
    await page.setViewportSize({ width, height: 853 });
    await page.goto(home.replace('view=briefing', 'view=library&scope=personal'));
    await expect(page.locator('.material-cover-art')).toHaveCount(2);
    await expect(page.locator('.material-cover-art').first()).toBeVisible();
    // A folder has no description row; its cover must still start at the same inset.
    const geometry = await page.locator('.material-entry').evaluateAll((entries) =>
      entries.map((entry) => {
        const card = entry.getBoundingClientRect();
        const cover = entry.querySelector('.material-cover')!.getBoundingClientRect();
        const title = entry.querySelector('.material-entry-body > strong')!.getBoundingClientRect();
        return { coverTop: cover.top - card.top, coverHeight: cover.height, titleTop: title.top - card.top };
      }),
    );
    expect(geometry[0].coverHeight).toBe(width <= 650 ? 140 : 180);
    expect(geometry[0].coverHeight).toBe(geometry[1].coverHeight);
    expect(Math.abs(geometry[0].coverTop - geometry[1].coverTop)).toBeLessThan(1);
    expect(Math.abs(geometry[0].titleTop - geometry[1].titleTop)).toBeLessThan(1);
    await expect(page.getByText('可上传与维护', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '上传资料', exact: true })).toBeVisible();
    await expect(
      page.locator('.library-controls').getByRole('button', { name: '新建文件夹', exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('.library-controls').getByRole('button', { name: '回收站', exact: true }),
    ).toBeVisible();
    const search = (await page.getByRole('search', { name: '资料搜索' }).boundingBox())!;
    const upload = (await page.getByRole('button', { name: '上传资料', exact: true }).boundingBox())!;
    expect(search.x + search.width).toBeLessThanOrEqual(upload.x);
    expect(Math.abs(search.y + search.height / 2 - upload.y - upload.height / 2)).toBeLessThan(2);
    const crumbs = (await page.getByRole('navigation', { name: '文件夹路径' }).boundingBox())!;
    const views = (await page.getByRole('group', { name: '资料显示方式' }).boundingBox())!;
    expect(Math.abs(crumbs.y + crumbs.height / 2 - views.y - views.height / 2)).toBeLessThan(2);
    expect(await page.locator('.library-toolbar').evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(true);
    await expect(page.getByRole('button', { name: '资料操作', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '刷新', exact: true })).toHaveCount(0);
    const before = reads;
    await page.locator('.material-entry').first().hover();
    await page.locator('.access-content').evaluate((node) => {
      node.scrollTop = 0;
    });
    await page.mouse.wheel(0, -240);
    await expect.poll(() => reads).toBeGreaterThan(before);
    await expect(page.locator('.library-page')).toHaveAttribute('data-refresh-phase', 'idle');
    await expect(page.locator('.material-entry').first()).toHaveCSS('border-radius', '24px');
    if (width === 952) {
      const delta = await page.locator('.material-topbar').evaluate((node) => {
        const bar = node.getBoundingClientRect(),
          tabs = node.querySelector('.material-tabs')!.getBoundingClientRect();
        return Math.abs(
          (tabs.left + tabs.right) / 2 -
            (bar.left + bar.right - parseFloat(getComputedStyle(node).paddingRight)) / 2,
        );
      });
      expect(delta).toBeLessThan(2);
    }
  }
});

test('关注布局保存到账户，另一页面读取且冲突不覆盖新布局', async ({ page, context }) => {
  let saved: unknown = null;
  let revision = 0;
  const install = async (tab: Page) => {
    await fixture(tab, accepted);
    await tab.route('**/briefing?*', (route) =>
      route.fulfill({
        json: {
          tenantId: tenant,
          view: 'FOCUSED',
          date: null,
          zone: 'Asia/Shanghai',
          hasMore: false,
          asOf: now,
          items: [5, 6].map((n) => ({
            cardId: uid(n),
            taskId: uid(n),
            conversationId: conversation,
            taskRevision: 1,
            attempt: 1,
            presentationVersion: 'briefing-basic-v1',
            workspaceId: space,
            workspaceName: '个人空间',
            title: '合成关注卡片' + n,
            excerpt: '用于验证账户布局，不调用模型。',
            truncated: false,
            completedAt: now,
            executionClass: 'verification',
            engineVersion: '0.1',
            artifactCount: 0,
            citationCount: 0,
            originalCount: 0,
            preference: { revision: 0, pinned: true, hidden: false, size: 'STANDARD' },
          })),
        },
      }),
    );
    await tab.route('**/briefing/boards/PRIVATE', async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        if (body.expectedRevision !== revision)
          return route.fulfill({ status: 409, json: { code: 'BRIEFING_LAYOUT_CHANGED' } });
        saved = body.preference;
        revision++;
        return route.fulfill({
          json: {
            appliedRevision: revision,
            current: { tenantId: tenant, board: 'PRIVATE', revision, preference: saved },
          },
        });
      }
      return route.fulfill({ json: { tenantId: tenant, board: 'PRIVATE', revision, preference: saved } });
    });
    await tab.goto(home);
    await tab.getByRole('tab', { name: '关注', exact: true }).click();
    await expect(tab.locator('.live-follow-tile')).toHaveCount(2);
  };
  await install(page);
  const second = await context.newPage();
  await install(second);
  const tile = page.locator('.live-follow-tile').first();
  await tile.hover();
  const handle = tile.locator('.briefing-resize-handle');
  const bounds = (await tile.boundingBox())!;
  const grip = (await handle.boundingBox())!;
  expect(Math.abs(grip.x + grip.width - bounds.x - bounds.width)).toBeLessThan(3);
  expect(Math.abs(grip.y + grip.height - bounds.y - bounds.height)).toBeLessThan(3);
  await page.mouse.move(grip.x + grip.width - 5, grip.y + grip.height - 5);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width - 5, grip.y + grip.height + bounds.height * 0.8, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => revision).toBe(1);
  await second.reload();
  await expect(second.locator('.live-follow-tile').first()).toHaveAttribute('data-size', '1×2');
  // Another device changes the board after this page read revision 1.
  revision = 2;
  const before = JSON.stringify(saved);
  await second.locator('.briefing-resize-handle').first().press('ArrowRight');
  await expect(second.getByRole('button', { name: '读取账户最新布局' })).toBeVisible();
  expect(JSON.stringify(saved)).toBe(before);
  await second.getByRole('button', { name: '读取账户最新布局' }).click();
  await expect(second.locator('.live-follow-tile').first()).toHaveAttribute('data-size', '1×2');
  await second.close();
});

test('账号设置保持单面板、邀请返回保留当前页面，窄屏可用', async ({ page }) => {
  await fixture(page, async (route) => route.fulfill({ status: 400, json: {} }));
  await page.goto(home);
  await page.getByRole('button', { name: '个人设置与账号', exact: true }).click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toHaveCount(1);
  await expect(dialog.getByText('当前企业', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '合成企业' })).toHaveCount(0);
  await dialog.getByRole('button', { name: '个人设置', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: '账号与安全' })).toBeVisible();
  await dialog.getByRole('button', { name: '修改密码', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  await dialog.getByRole('button', { name: '返回账号与安全' }).click();
  await dialog.getByRole('button', { name: '企业与邀请', exact: true }).click();
  await dialog.getByRole('button', { name: '通过邀请加入企业' }).click();
  await expect(dialog.getByRole('heading', { name: '加入企业', exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp('view=briefing'));
  await dialog.getByRole('button', { name: '返回企业与邀请' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByRole('button', { name: '通过邀请加入企业' })).toBeVisible();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  await dialog.getByRole('button', { name: '关闭弹窗' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp('view=briefing'));
});

test('设置加入企业后由用户选择去向，切换企业不携带原文件夹', async ({ page }) => {
  await fixture(page, async (route) => route.fulfill({ status: 400, json: {} }));
  const other = { tenantId: uid(81), tenantName: '第二合成企业', role: 'MEMBER' };
  const identity = {
    account: { id: account, phone: '+8619900009001', displayName: '合成成员' },
    platformAdmin: true,
    memberships: [{ tenantId: tenant, tenantName: '合成企业', role: 'MEMBER' }, other],
  };
  await page.route('**/api/v1/me', (route) => route.fulfill({ json: identity }));
  await page.route('**/auth/phone/invitation', (route) =>
    route.fulfill({
      json: {
        tenantName: other.tenantName,
        tenantId: other.tenantId,
        phone: identity.account.phone,
        maskedPhone: '199****9001',
        status: 'PENDING',
        action: 'CONFIRM',
        designatedOwner: false,
      },
    }),
  );
  await page.route('**/auth/phone/accept', (route) =>
    route.fulfill({ json: { identity, membership: other } }),
  );
  await page.goto(home);
  await page.getByRole('button', { name: '个人设置与账号', exact: true }).click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog.getByRole('link', { name: '总台', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '个人设置', exact: true }).click();
  await dialog.getByRole('button', { name: '企业与邀请', exact: true }).click();
  await dialog.getByRole('button', { name: '通过邀请加入企业' }).click();
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog.getByRole('heading', { name: '已加入 第二合成企业' })).toBeVisible();
  await dialog.getByRole('button', { name: '留在当前企业' }).click();
  await expect(page).toHaveURL(new RegExp(`tenant=${tenant}&view=briefing`));
  await page.goto(`/workspace/#tenant=${tenant}&view=library&scope=personal&folder=${uid(90)}`);
  await page.getByRole('button', { name: '个人设置与账号', exact: true }).click();
  await dialog.getByRole('button', { name: /当前企业/ }).click();
  await dialog.getByRole('button', { name: '第二合成企业', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`tenant=${other.tenantId}.*view=library`));
  expect(page.url()).not.toContain('folder=');
});

test('个人档案编辑留在设置面板内，未保存返回可取消', async ({ page }) => {
  await fixture(page, async (route) => route.fulfill({ status: 400, json: {} }));
  await page.route('**/profiles/PERSONAL/**', (route) =>
    route.fulfill({
      json: {
        tenantId: tenant,
        scope: 'PERSONAL',
        subjectId: account,
        canMaintain: true,
        hasMore: false,
        items: [],
        entries: [],
      },
    }),
  );
  await page.goto(home);
  await page.getByRole('button', { name: '个人设置与账号', exact: true }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByRole('button', { name: '个人设置', exact: true }).click();
  await dialog.getByRole('button', { name: 'AI 偏好与个人档案', exact: true }).click();
  await expect(dialog.getByText('适用于：合成企业 · 其他企业独立保存')).toBeVisible();
  await dialog.getByRole('button', { name: '新增档案记录' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  await dialog.locator('form input').first().fill('合成个人偏好');
  page.once('dialog', (popup) => popup.dismiss());
  await dialog.getByRole('button', { name: '返回档案', exact: true }).click();
  await expect(dialog.locator('form input').first()).toHaveValue('合成个人偏好');
  page.once('dialog', (popup) => popup.accept());
  await dialog.getByRole('button', { name: '返回档案', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '新增档案记录' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.local/account-settings-mobile.png' });
});

test('添加资料浮层不撑高输入框，支持Esc与外部点击收起', async ({ page }) => {
  await fixture(page, accepted);
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations`);
  const add = page.getByRole('button', { name: '添加资料', exact: true });
  const composer = page.locator('.conversation-composer');
  await expect(add).toBeVisible();
  const before = (await composer.boundingBox())!;
  await add.click();
  const popup = page.getByRole('dialog', { name: '添加资料', exact: true });
  await expect(popup).toBeVisible();
  await expect(popup.getByRole('button', { name: '本地上传' })).toBeVisible();
  await expect(popup.getByRole('button', { name: '选择已有资料' })).toBeVisible();
  const after = (await composer.boundingBox())!;
  expect(Math.abs(after.height - before.height)).toBeLessThan(1);
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  await expect(add).toBeFocused();
  await add.click();
  await page.locator('textarea').first().click();
  await expect(popup).toHaveCount(0);
  await add.click();
  const chooser = page.waitForEvent('filechooser');
  await popup.getByRole('button', { name: '本地上传' }).click();
  await chooser;
  await expect(popup).toHaveCount(0);
});

test('新会话保留品牌引导且输入框固定底部，输入不跳转', async ({ page }) => {
  await fixture(page, accepted);
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations`);
  const welcome = page.getByRole('region', { name: '新会话引导' });
  await expect(welcome.getByRole('img', { name: 'Mengine · 梦擎工作空间' })).toBeVisible();
  await expect(welcome.getByText('你好啊，', { exact: true })).toHaveCount(0);
  await expect(welcome.getByRole('heading')).toHaveText('有什么想法？我帮你实现。');
  const field = page.getByPlaceholder('告诉我你想处理的工作');
  await field.fill('待发送的合成需求');
  await expect(welcome).toBeVisible();
  expect(page.url()).not.toContain('conversation=');
  const intro = (await welcome.boundingBox())!;
  const composer = (await page.locator('.conversation-composer').boundingBox())!;
  expect(composer.y - intro.y - intro.height).toBeGreaterThanOrEqual(24);
  const reader = (await page.locator('.conversation-reader').boundingBox())!;
  expect(Math.abs(reader.y + reader.height - composer.y - composer.height)).toBeLessThanOrEqual(16);
  await page.screenshot({ path: '.local/conversation-welcome.png' });
});

test('完成回复集中操作，点踩再展开建议，评价加载不占正文', async ({ page }) => {
  await fixture(page, accepted);
  await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} } }); });
  await page.route('**/conversations/' + conversation + '?*', route => route.fulfill({ json: {
    conversation: info, tasks: [{ ...task('你好'), status: 'SUCCEEDED', reply: '你好！有什么我可以帮你的吗？', attempt: 1, executionClass: 'live', waitReason: null }], hasMore: false, cursor: 1,
  } }));
  let stored: unknown = null;
  await page.route('**/feedback?*', route => route.fulfill({ json: { feedback: stored } }));
  await page.route('**/feedback', route => {
    const body = route.request().postDataJSON();
    expect(body.assessment.rating).toBe('NOT_ACHIEVED');
    expect(body.assessment.suggestion).toBe('请更具体');
    stored = { id: uid(98), tenantId: tenant, workspaceId: space, target: body.target, assessment: body.assessment, revision: 1, status: 'ACTIVE', snapshot: { taskState: 'SUCCEEDED', executionClass: 'live', contentSha256: 'a'.repeat(64), sourceVersionCount: 0 }, createdAt: now, updatedAt: now };
    return route.fulfill({ json: stored });
  });
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations&conversation=${conversation}`);
  const result = page.locator('.conversation-result');
  await expect(result.getByText('你好！有什么我可以帮你的吗？')).toBeVisible();
  await expect(result.getByText('本次处理完成')).toHaveCount(0);
  await expect(result.getByText('AI 任务', { exact: true })).toHaveCount(0);
  await expect(result.getByRole('button', { name: '保存到个人资料', exact: true })).toHaveCount(0);
  await result.getByRole('button', { name: '踩', exact: true }).click();
  const popup = page.getByRole('dialog', { name: '改进建议', exact: true });
  await popup.getByRole('textbox').fill('请更具体');
  await popup.getByRole('button', { name: '提交评价' }).click();
  await expect(popup).toHaveCount(0);
  await expect(result.getByRole('button', { name: '踩', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(result.getByText('已收到评价', { exact: true })).toHaveCount(0);
  const copy = result.getByRole('button', { name: '复制回复' });
  await copy.click();
  await expect(copy).toHaveClass(/is-copied/);
  await expect(result.getByText('已复制', { exact: true })).toHaveCount(0);
  await result.getByRole('button', { name: '更多回复操作' }).click();
  await expect(page.getByRole('button', { name: '保存到个人资料', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '查看过程', exact: true })).toBeVisible();
  const menu = page.getByRole('dialog', { name: '更多回复操作' });
  const styles = await menu.locator('button').evaluateAll(buttons => buttons.map(button => { const s = getComputedStyle(button); return [s.width, s.height, s.padding, s.borderWidth, s.fontSize, s.fontWeight]; }));
  expect(styles[0]).toEqual(styles[1]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '更多回复操作' })).toHaveCount(0);
  await page.screenshot({ path: '.local/reply-clean.png' });
});

test('处理过程轻量折叠并按需显示历史翻页', async ({ page }) => {
  await fixture(page, accepted);
  await page.route('**/conversations/' + conversation + '?*', route => route.fulfill({ json: {
    conversation: info, tasks: [{ ...task('你好'), status: 'SUCCEEDED', reply: '已完成', attempt: 1, executionClass: 'live', waitReason: null }], hasMore: false, cursor: 1,
  } }));
  let multiple = false;
  await page.route('**/tasks/*/attempts?*', route => route.fulfill({ json: {
    taskId, items: [{ number: 1, status: 'SUCCEEDED', input: '你好', reply: '**执行结果**', summaryCode: null, errorCode: null, engineVersion: null, modelName: null, tools: [], sources: [], artifacts: [], startedAt: now, finishedAt: now, provenance: 'RECORDED', reconciliationCode: null }], hasMore: multiple && new URL(route.request().url()).searchParams.get('offset') === '0',
  } }));
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations&conversation=${conversation}`);
  const open = async () => {
    await page.getByRole('button', { name: '更多回复操作', exact: true }).click();
    await page.getByRole('button', { name: '查看过程', exact: true }).click();
  };
  await open();
  const process = page.getByRole('region', { name: '回复处理过程' });
  await expect(process.locator('summary')).toBeVisible();
  await expect(process.getByRole('navigation')).toHaveCount(0);
  await process.locator('summary').click();
  await expect(process.locator('strong', { hasText: '执行结果' })).toBeVisible();
  await process.getByRole('button', { name: '收起过程' }).click();
  await expect(process).toHaveCount(0);
  multiple = true;
  await open();
  await process.getByRole('button', { name: '更早的执行' }).click();
  await expect(process.getByRole('button', { name: '更早的执行' })).toBeDisabled();
  await expect(process.getByRole('button', { name: '上一页' })).toBeEnabled();
  await process.getByRole('button', { name: '上一页' }).click();
  await expect(process.getByRole('button', { name: '更早的执行' })).toBeEnabled();
  await page.screenshot({ path: '.local/process-panel.png' });
});

test('待补充卡片关联主输入框且允许另起话题', async ({ page }) => {
  await fixture(page, accepted);
  let status = 'WAITING_INPUT', revision = 1;
  const detail = () => ({ conversation: info, tasks: [{ ...task('分析资料'), status, revision, attempt: 1, executionClass: 'live', requiredInput: '请补充需要分析的月份', waitReason: null }], hasMore: false, cursor: 1 });
  await page.route('**/conversations/' + conversation + '?*', route => route.fulfill({ json: detail() }));
  await page.route(`**/conversations/${conversation}/tasks/${taskId}`, route => {
    const body = route.request().postDataJSON();
    expect(body.action).toBe('RESUME'); expect(body.input).toBe('九月');
    status = 'RUNNING'; revision++;
    return route.fulfill({ json: detail() });
  });
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations&conversation=${conversation}`);
  const card = page.getByRole('region', { name: '需要你补充信息或资料' });
  await expect(card.getByText('请补充需要分析的月份')).toBeVisible();
  await expect(card.getByRole('textbox')).toHaveCount(0);
  const composer = page.locator('.conversation-composer');
  await composer.getByRole('button', { name: '另起话题' }).click();
  await composer.getByRole('textbox', { name: '工作要求', exact: true }).fill('新的话题');
  await expect(composer.getByRole('button', { name: '开始任务', exact: true })).toBeEnabled();
  await expect(composer.getByRole('button', { name: '停止执行', exact: true })).toHaveCount(0);
  await card.getByRole('button', { name: '在输入框回答' }).click();
  await composer.getByRole('textbox', { name: '工作要求', exact: true }).fill('九月');
  await composer.getByRole('button', { name: '提交回答并继续', exact: true }).click();
  await expect(composer.getByRole('button', { name: '停止执行', exact: true })).toBeVisible();
  await expect(composer.getByRole('textbox', { name: '工作要求', exact: true })).toHaveValue('');
});

test('暂停卡片支持继续，运行中支持补充与停止', async ({ page }) => {
  await fixture(page, accepted);
  let status = 'PAUSED', revision = 2;
  const detail = () => ({ conversation: info, tasks: [{ ...task('分析资料'), status, revision, attempt: 1, reply: '已完成部分分析', executionClass: 'live', waitReason: null }], hasMore: false, cursor: 1 });
  await page.route('**/conversations/' + conversation + '?*', route => route.fulfill({ json: detail() }));
  const actions: string[] = [];
  await page.route(`**/conversations/${conversation}/tasks/${taskId}`, route => {
    const body = route.request().postDataJSON(); expect(body.expectedRevision).toBe(revision);
    actions.push(body.action);
    if (body.action === 'SUPPLEMENT') expect(body.input).toBe('请重点核对九月');
    status = body.action === 'PAUSE' ? 'PAUSED' : 'RUNNING'; revision++;
    return route.fulfill({ json: detail() });
  });
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations&conversation=${conversation}`);
  const composer = page.locator('.conversation-composer');
  await expect(composer.getByRole('button', { name: '开始任务', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '恢复任务', exact: true })).toHaveCount(0);
  await page.getByRole('region', { name: '本次已停止' }).getByRole('button', { name: '继续处理' }).click();
  await expect(composer.getByRole('button', { name: '停止执行', exact: true })).toBeVisible();
  await composer.getByRole('textbox', { name: '工作要求', exact: true }).fill('请重点核对九月');
  await expect(composer.getByRole('button', { name: '停止执行', exact: true })).toBeVisible();
  await composer.getByRole('button', { name: '发送补充', exact: true }).click();
  await expect(composer.getByRole('textbox', { name: '工作要求', exact: true })).toHaveValue('');
  await composer.getByRole('button', { name: '停止执行', exact: true }).click();
  await expect(composer.getByRole('button', { name: '开始任务', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '继续处理' })).toBeVisible();
  expect(actions).toEqual(['RESUME', 'SUPPLEMENT', 'PAUSE']);
  await page.screenshot({ path: '.local/task-intervention.png' });
});

test('运行中补充断线重试沿用同一请求，旧卡片不能并发恢复', async ({ page }) => {
  await fixture(page, accepted);
  const stopped = { ...task('旧任务'), id: uid(88), status: 'PAUSED', revision: 1, attempt: 1, executionClass: 'live' };
  const running = { ...task('当前任务'), status: 'RUNNING', revision: 2, attempt: 1, executionClass: 'live' };
  const detail = () => ({ conversation: info, tasks: [stopped, running], hasMore: false, cursor: 2 });
  await page.route('**/conversations/' + conversation + '?*', route => route.fulfill({ json: detail() }));
  const bodies: unknown[] = [];
  await page.route(`**/conversations/${conversation}/tasks/${taskId}`, route => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) return route.abort('failed');
    return route.fulfill({ json: detail() });
  });
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations&conversation=${conversation}`);
  const card = page.getByRole('region', { name: '本次已停止' });
  await expect(card.getByText('另一项工作正在执行，请先停止当前执行，再处理此卡片。')).toBeVisible();
  await expect(card.getByRole('button', { name: '继续处理' })).toBeDisabled();
  const composer = page.locator('.conversation-composer');
  await composer.getByRole('textbox', { name: '工作要求', exact: true }).fill('补充合成要求');
  await composer.getByRole('button', { name: '发送补充' }).click();
  await expect(composer.getByRole('textbox', { name: '工作要求', exact: true })).toBeDisabled();
  await composer.getByRole('button', { name: '重试本次发送' }).click();
  await expect(composer.getByRole('textbox', { name: '工作要求', exact: true })).toHaveValue('');
  expect(bodies).toHaveLength(2); expect(bodies[0]).toEqual(bodies[1]);
});

test('待补充卡片选资料后显式提交，完成后保留已补充记录', async ({ page }) => {
  await fixture(page, accepted);
  const materialId = uid(80), versionId = uid(81);
  const version = { id: versionId, number: 1, filename: '九月收款明细.txt', sizeBytes: 100, sha256: 'a'.repeat(64), createdBy: account, createdAt: now };
  const document = { id: materialId, tenantId: tenant, workspaceId: space, workspaceName: '个人空间', folderId: null, kind: 'DOCUMENT', name: version.filename, version: 1, sizeBytes: 100, updatedAt: now, path: ['个人空间'], canMaintain: true };
  await page.route(`**/conversations/${conversation}/attachments`, route => route.fulfill({ json: [{ document, versions: [version], hasMore: false }] }));
  await page.route(`**/versions/${versionId}/analysis?*`, route => route.fulfill({ json: { tenantId: tenant, workspaceId: space, materialId, versionId, generation: 1, status: 'READY', parserVersion: 'synthetic', warnings: [], canMaintain: true, available: true, hasMore: false, chunks: [] } }));
  let submitted = false;
  const detail = () => ({ conversation: info, tasks: [{ ...task('核对收款'), status: submitted ? 'RUNNING' : 'WAITING_INPUT', revision: submitted ? 2 : 1, attempt: 1, executionClass: 'live', requiredInput: submitted ? null : '需要九月收款明细，才能逐笔核对。', supplementalInput: submitted ? '已补充所选资料，请继续处理。' : null, waitReason: null }], hasMore: false, cursor: 1 });
  await page.route('**/conversations/' + conversation + '?*', route => route.fulfill({ json: detail() }));
  await page.route(`**/conversations/${conversation}/tasks/${taskId}`, route => {
    const body = route.request().postDataJSON();
    expect(body.action).toBe('RESUME'); expect(body.originals).toEqual([{ materialId, versionId }]);
    submitted = true; return route.fulfill({ json: detail() });
  });
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations&conversation=${conversation}`);
  const card = page.getByRole('region', { name: '需要你补充信息或资料' });
  await card.getByText('本会话保留的资料（1）').click();
  await card.getByRole('button', { name: '本次引用' }).click();
  await expect(card.getByRole('button', { name: '提交资料并继续' })).toBeEnabled();
  expect(submitted).toBe(false);
  await card.getByRole('button', { name: '移除 九月收款明细.txt' }).click();
  await expect(card.getByRole('button', { name: '提交资料并继续' })).toHaveCount(0);
  await card.getByText('本会话保留的资料（1）').click();
  await card.getByRole('button', { name: '本次引用' }).click();
  await page.screenshot({ path: '.local/task-input-card.png' });
  await card.getByRole('button', { name: '提交资料并继续' }).click();
  await expect(page.locator('.task-supplement-receipt summary')).toHaveText('已补充');
  await expect(card).toHaveCount(0);
});

test('新会话接受空补充字段并正常打开已创建任务', async ({ page }) => {
  let sends = 0;
  await fixture(page, async (route, body) => { sends++; return accepted(route, body); });
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations`);
  await page.getByRole('textbox', { name: '工作要求', exact: true }).fill('你好');
  await page.getByRole('button', { name: '开始任务', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`conversation=${conversation}`));
  await expect(page.locator('.conversation-user')).toHaveText('你好');
  await expect(page.getByRole('textbox', { name: '工作要求', exact: true })).toHaveValue('');
  await expect(page.locator('.conversation-composer').getByRole('alert')).toHaveCount(0);
  expect(sends).toBe(1);
});

for (const width of [1424, 390]) {
  test(`发送报错显示在输入框上方且不移动输入框 ${width}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: 954 });
    let sends = 0;
    await fixture(page, async (route, body) => ++sends === 1 ? route.abort('failed') : accepted(route, body));
    await page.goto(`/workspace/#tenant=${tenant}&view=conversations`);
    const input = page.getByRole('textbox', { name: '工作要求', exact: true });
    const surface = page.locator('.live-composer-surface');
    await input.fill('合成错误位置验证');
    const before = (await surface.boundingBox())!;
    const beforeInput = (await input.boundingBox())!;
    await page.getByRole('button', { name: '开始任务', exact: true }).click();
    const alert = page.locator('.composer-notices').getByRole('alert');
    await expect(alert).toBeVisible();
    const after = (await surface.boundingBox())!;
    const notice = (await alert.boundingBox())!;
    expect(after.y).toBeCloseTo(before.y, 0);
    expect(after.height).toBeCloseTo(before.height, 0);
    expect((await input.boundingBox())!.y).toBeCloseTo(beforeInput.y, 0);
    expect(notice.y + notice.height).toBeLessThanOrEqual(after.y - 8);
    expect(notice.x).toBeGreaterThanOrEqual(after.x - 1);
    expect(notice.x + notice.width).toBeLessThanOrEqual(after.x + after.width + 1);
    await page.screenshot({ path: `.local/composer-notices-${width}.png` });
    await page.getByRole('button', { name: '重试上次发送', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`conversation=${conversation}`));
    await expect(alert).toHaveCount(0);
    expect((await surface.boundingBox())!.y).toBeCloseTo(before.y, 0);
  });
}

test('停止执行报错也放在输入框上方且不撑高输入框', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fixture(page, accepted);
  await page.route('**/conversations/' + conversation + '?*', route => route.fulfill({ json: {
    conversation: info, tasks: [{ ...task('合成任务'), status: 'RUNNING', executionClass: 'live' }], hasMore: false, cursor: 1,
  } }));
  await page.route(`**/conversations/${conversation}/tasks/${taskId}`, route => route.abort('failed'));
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations&conversation=${conversation}`);
  const surface = page.locator('.live-composer-surface');
  await expect(page.getByRole('button', { name: '停止执行', exact: true })).toBeVisible();
  const before = (await surface.boundingBox())!;
  await page.getByRole('button', { name: '停止执行', exact: true }).click();
  const alert = page.locator('.composer-notices').getByRole('alert');
  await expect(alert).toBeVisible();
  const notice = (await alert.boundingBox())!;
  expect(notice.y + notice.height).toBeLessThanOrEqual(before.y - 8);
  const after = (await surface.boundingBox())!;
  expect(after.y).toBeCloseTo(before.y, 0); expect(after.height).toBeCloseTo(before.height, 0);
});

test('真实增量投影逐步显示，停止保留内容，完成后不重复', async ({ page }) => {
  await fixture(page, accepted);
  await page.addInitScript(() => {
    const streams = new Set<TestStream>();
    class TestStream extends EventTarget {
      onopen: (() => void) | null = null; onerror: (() => void) | null = null;
      constructor(_url: string) { super(); streams.add(this); setTimeout(() => this.onopen?.(), 0); }
      close() { streams.delete(this); }
    }
    Object.assign(window, { EventSource: TestStream, emitAnswer: (items: unknown[]) => {
      for (const stream of streams) stream.dispatchEvent(new MessageEvent('answer', { data: JSON.stringify({items}) }));
    }});
  });
  let status = 'RUNNING', reply: string | null = null, cursor = 1;
  const detail = () => ({ conversation:info,tasks:[{...task('合成流式任务'),status,reply,attempt:1,revision:1,executionClass:'live'}],hasMore:false,cursor });
  await page.route('**/conversations/' + conversation + '?*', route => route.fulfill({json:detail()}));
  await page.route('**/conversations/' + conversation + '/events?*', route => route.fulfill({json:{conversationId:conversation,items:Number(new URL(route.request().url()).searchParams.get('after')) < cursor ? [{seq:cursor,taskId,kind:status,revision:1}] : [],cursor,hasMore:false}}));
  await page.route('**/answer-snapshot', route => route.fulfill({json:{items:[]}}));
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations&conversation=${conversation}`);
  await expect(page.getByRole('button',{name:'停止执行',exact:true})).toBeVisible();
  const emit = async (text:string,version:number,state='STREAMING') => page.evaluate(({taskId,text,version,state}) => {
    (window as unknown as {emitAnswer:(items:unknown[])=>void}).emitAnswer([{taskId,attempt:1,step:1,version,text,state}]);
  },{taskId,text,version,state});
  const answer=page.getByLabel('正在生成的回复');
  await emit('第一段',1);await expect(answer).toHaveText('第一段');
  await emit('第一段，第二段',2);await expect(answer).toHaveText('第一段，第二段');
  status='PAUSED';cursor++;await emit('第一段，第二段',2,'INTERRUPTED');
  await expect(answer).toHaveText('第一段，第二段');
  await expect(page.getByRole('region',{name:'本次已停止'})).toBeVisible();
  status='SUCCEEDED';reply='第一段，第二段，最终结论';cursor++;
  await emit(reply,3,'COMPLETE');
  await expect(page.locator('.conversation-reply')).toHaveCount(1);
  await expect(page.locator('.conversation-reply')).toHaveText(reply);
  await expect(answer).toHaveCount(0);
});

test('流式断线保留已显示文字并从快照恢复', async ({ page }) => {
  await fixture(page,accepted);
  await page.addInitScript(()=>{
    class BrokenStream { onopen=null; onerror: (()=>void)|null=null; constructor(_url:string){setTimeout(()=>this.onerror?.(),10);}addEventListener(){}close(){} }
    Object.assign(window,{EventSource:BrokenStream});
  });
  const current={...task('断线恢复测试'),status:'RUNNING',attempt:1,revision:1,executionClass:'live',reply:null};
  await page.route('**/conversations/'+conversation+'?*',route=>route.fulfill({json:{conversation:info,tasks:[current],hasMore:false,cursor:1}}));
  let version=1,fail=false;
  await page.route('**/answer-snapshot',route=>fail?route.abort('failed'):route.fulfill({json:{items:[{taskId,attempt:1,step:1,version,text:version===1?'已经收到':'已经收到，重连后补齐',state:'STREAMING'}]}}));
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations&conversation=${conversation}`);
  const answer=page.getByLabel('正在生成的回复');await expect(answer).toContainText('已经收到');
  fail=true;
  await page.route('**/conversations/'+conversation+'/events?*',route=>route.abort('failed'));
  await expect(page.getByRole('status').filter({hasText:'正在恢复连接，已有内容已保留'})).toBeVisible({timeout:10000});
  await expect(answer).toContainText('已经收到');
  fail=false;version=2;await expect(answer).toContainText('已经收到，重连后补齐');
  await expect(page.locator('.conversation-reply')).toHaveCount(1);
});

test('会话初次加载和再次发送后定位底部，普通回复更新继续跟随', async ({ page }) => {
  let sent = false, completed = false, cursor = 1;
  await fixture(page, async (route, body) => {
    sent = true; cursor++;
    await route.fulfill({ status: 201, json: detail() });
  });
  const longReply = Array.from({length: 45}, (_, i) => `第${i + 1}段合成历史内容，用于验证滚动位置。`).join('\n\n');
  const detail = () => ({ conversation: info, tasks: [
    {...task('历史消息'), status: 'SUCCEEDED', reply: longReply, attempt: 1, executionClass: 'live', waitReason: null},
    ...(sent ? [{...task('新发出的要求'), id: uid(90), status: completed ? 'SUCCEEDED' : 'RUNNING', attempt: 1, executionClass: 'live', waitReason: null, reply: completed ? longReply + '\n\n新回复的结尾' : null}] : []),
  ], hasMore: false, cursor });
  await page.route('**/conversations/' + conversation + '/tasks', async route => {
    sent=true;cursor++;await route.fulfill({status:201,json:detail()});
  });
  await page.route('**/conversations/' + conversation + '?*', route => route.fulfill({json:detail()}));
  await page.route('**/conversations/' + conversation + '/events?*', route => route.fulfill({json:{conversationId:conversation,items:Number(new URL(route.request().url()).searchParams.get('after')) < cursor ? [{seq:cursor,taskId:uid(90),kind:completed?'SUCCEEDED':'RUNNING',revision:1}] : [],cursor,hasMore:false}}));
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations&conversation=${conversation}`);
  const messages = page.locator('.conversation-messages');
  const bottom = () => messages.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop);
  await expect.poll(bottom).toBeLessThan(3);
  await messages.hover(); await page.mouse.wheel(0,-550);
  await expect.poll(bottom).toBeGreaterThan(300);
  await page.getByRole('textbox',{name:'工作要求',exact:true}).fill('新发出的要求');
  await page.getByRole('button',{name:'开始任务',exact:true}).click();
  await expect(messages).toContainText('新发出的要求');
  await expect.poll(bottom).toBeLessThan(3);
  completed=true;cursor++;
  await expect(messages).toContainText('新回复的结尾');
  await expect.poll(bottom).toBeLessThan(3);
});

test('流式增长跟随底部，上滑或选择文字不被打断，回到底部恢复跟随', async ({ page }) => {
  await fixture(page,accepted);
  await page.addInitScript(() => {
    const streams = new Set<EventTarget>();
    class TestStream extends EventTarget {
      onopen: (()=>void)|null=null; onerror=null;
      constructor(_url:string){super();streams.add(this);setTimeout(()=>this.onopen?.(),0);}
      close(){streams.delete(this);}
    }
    Object.assign(window,{EventSource:TestStream,emitAnswer:(items:unknown[])=>{
      for(const stream of streams)stream.dispatchEvent(new MessageEvent('answer',{data:JSON.stringify({items})}));
    }});
  });
  await page.route('**/conversations/'+conversation+'?*',route=>route.fulfill({json:{conversation:info,tasks:[{...task('合成流式任务'),status:'RUNNING',attempt:1,executionClass:'live',waitReason:null}],hasMore:false,cursor:1}}));
  await page.route('**/answer-snapshot',route=>route.fulfill({json:{items:[]}}));
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations&conversation=${conversation}`);
  await expect(page.getByRole('button',{name:'停止执行',exact:true})).toBeVisible();
  let text=Array.from({length:40},(_,i)=>`第${i}段正在生成的合成文本。`).join('\n\n'), version=0;
  const emit=async()=>{version++;await page.evaluate(({text,version,taskId})=>{
    (window as unknown as {emitAnswer:(items:unknown[])=>void}).emitAnswer([{taskId,attempt:1,step:1,version,text,state:'STREAMING'}]);
  },{text,version,taskId});};
  const messages=page.locator('.conversation-messages');
  const bottom=()=>messages.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop);
  await emit(); await expect.poll(bottom).toBeLessThan(3);
  text+='\n\n新增末尾内容。'.repeat(8);await emit();await expect.poll(bottom).toBeLessThan(3);
  await messages.hover();await page.mouse.wheel(0,-600);await expect.poll(bottom).toBeGreaterThan(350);
  const readingTop=await messages.evaluate(el=>el.scrollTop);
  text+='\n\n阅读期间新增内容。'.repeat(8);await emit();
  await expect(page.getByLabel('正在生成的回复')).toContainText('阅读期间新增内容');
  await expect.poll(()=>messages.evaluate(el=>el.scrollTop)).toBeCloseTo(readingTop,0);
  await page.mouse.wheel(0,100000);await expect.poll(bottom).toBeLessThan(3);
  text+='\n\n回到底部后的新增内容。'.repeat(8);await emit();await expect.poll(bottom).toBeLessThan(3);
  await messages.evaluate(el=>{
    const text=el.querySelector('.conversation-reply')!.firstChild!;
    const range=document.createRange();range.selectNodeContents(text);
    const selection=document.getSelection()!;selection.removeAllRanges();selection.addRange(range);
  });
  const selectionTop=await messages.evaluate(el=>el.scrollTop);
  text+='\n\n选中文字时新增内容。'.repeat(8);await emit();
  await expect(page.getByLabel('正在生成的回复')).toContainText('选中文字时新增内容');
  await expect.poll(()=>messages.evaluate(el=>el.scrollTop)).toBeCloseTo(selectionTop,0);
  await messages.evaluate(()=>document.getSelection()?.removeAllRanges());
  await expect.poll(bottom).toBeLessThan(3);
});

test('切换会话保持视窗和列表，局部加载不重播动画且隔离回复草稿', async ({ page }) => {
  await fixture(page, accepted);
  const second=uid(92), third=uid(93);
  await page.route('**/conversations?*',route=>route.fulfill({json:{tenantId:tenant,enabled:true,agentMode:'live',publicWebEnabled:false,items:[info,{...info,id:second,title:'第二会话'},{...info,id:third,title:'第三会话'}],hasMore:false}}));
  let releaseSecond: (()=>void)|undefined;
  const gate=new Promise<void>(resolve=>{releaseSecond=resolve;});
  await page.route('**/conversations/*?*',async route=>{
    const id=new URL(route.request().url()).pathname.split('/').at(-1);
    if(id===second)await gate;
    await route.fulfill({json:{conversation:{...info,id,title:id===second?'第二会话':id===third?'第三会话':info.title},tasks:[{...task('问题 '+id),id:id===second?uid(94):id===third?uid(95):taskId,status:'SUCCEEDED',executionClass:'live',attempt:1,reply:id===second?'第二会话独立回复':id===third?'第三会话独立回复':'第一会话独立回复'}],hasMore:false,cursor:1}});
  });
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations&conversation=${conversation}`);
  await expect(page.locator('.conversation-reply')).toHaveText('第一会话独立回复');
  await page.getByRole('textbox',{name:'工作要求',exact:true}).fill('第一会话未发送草稿');
  await expect.poll(()=>page.locator('.live-deck-scroller').evaluate(el=>el.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
  await page.evaluate(()=>{
    Object.assign(window,{savedDeck:document.querySelector('.live-deck-scroller'),savedList:document.querySelector('.live-conversation-list')});
  });
  await page.getByRole('link',{name:'第二会话',exact:true}).click();
  await expect(page.locator('.conversation-messages')).toContainText('正在读取');
  await expect(page.locator('.conversation-reply')).toHaveCount(0);
  await expect(page.getByRole('textbox',{name:'工作要求',exact:true})).toHaveValue('');
  const stable=()=>page.evaluate(()=>{
    const saved=window as unknown as {savedDeck:Element;savedList:Element};
    return {deck:saved.savedDeck===document.querySelector('.live-deck-scroller'),list:saved.savedList===document.querySelector('.live-conversation-list'),animations:saved.savedDeck.getAnimations().filter(a=>a.playState==='running').length};
  });
  expect(await stable()).toEqual({deck:true,list:true,animations:0});
  // A slow previous request must not replace a more recently selected conversation.
  await page.getByRole('link',{name:'第三会话',exact:true}).click();
  await expect(page.locator('.conversation-reply')).toHaveText('第三会话独立回复');
  releaseSecond!();
  await page.getByRole('textbox',{name:'工作要求',exact:true}).fill('第三会话草稿');
  await expect(page.locator('.conversation-reply')).toHaveText('第三会话独立回复');
  expect(await stable()).toEqual({deck:true,list:true,animations:0});
  await page.getByRole('link',{name:info.title,exact:true}).click();
  await expect(page.locator('.conversation-reply')).toHaveText('第一会话独立回复');
  await expect(page.getByRole('textbox',{name:'工作要求',exact:true})).toHaveValue('第一会话未发送草稿');
  expect(await stable()).toEqual({deck:true,list:true,animations:0});
  await page.getByRole('button',{name:'新会话',exact:true}).click();
  await expect(page.getByRole('region',{name:'新会话引导'})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'工作要求',exact:true})).toHaveValue('');
  expect(await stable()).toEqual({deck:true,list:true,animations:0});
});

test('新会话列表靠左且紧凑，切换后保持位置', async ({ page }) => {
  await fixture(page, accepted);
  await page.route('**/conversations?*', route => route.fulfill({ json: {
    tenantId: tenant, enabled: true, agentMode: 'live', publicWebEnabled: false,
    items: [info], hasMore: false,
  } }));
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations`);
  const list = page.locator('[data-deck-id="list"]');
  const leftInset = () => page.locator('.live-deck-scroller').evaluate(el => {
    const card = el.querySelector('[data-deck-id="list"]')!;
    return card.getBoundingClientRect().left - el.getBoundingClientRect().left
      - parseFloat(getComputedStyle(el).paddingLeft);
  });
  for (const width of [1350, 1600, 1100]) {
    await page.setViewportSize({ width, height: 841 });
    await expect.poll(leftInset).toBeCloseTo(0, 0);
    await expect(list).toBeVisible();
    await expect.poll(() => page.locator('.workspace-conversation-page').evaluate(el =>
      el.querySelector('[data-deck-id="list"]')!.getBoundingClientRect().left - el.getBoundingClientRect().left,
    )).toBeCloseTo(0, 0);
  }
  await expect(page.locator('.live-conversation-group a svg')).toHaveCount(0);
  await expect(page.locator('.live-conversation-group summary svg')).toHaveCount(1);
  expect(await page.locator('.live-list-tools .live-card-heading').evaluate(el => el.getBoundingClientRect().height)).toBeCloseTo(48, 0);
  await page.getByRole('link', { name: info.title, exact: true }).click();
  await expect(page.locator('.conversation-reader')).not.toHaveClass(/is-new-conversation/);
  await expect.poll(leftInset).toBeCloseTo(0, 0);
  await page.getByRole('button', { name: '新会话', exact: true }).click();
  await expect(page.locator('.conversation-reader')).toHaveClass(/is-new-conversation/);
  await expect.poll(leftInset).toBeCloseTo(0, 0);
  await page.setViewportSize({ width: 390, height: 841 });
  await expect(page.getByRole('textbox', { name: '工作要求', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('后台标题原位替换临时输入，保持列表排序、视窗和草稿', async ({ page }) => {
  await fixture(page, accepted);
  let generated=false;
  const fallback='请用资料库中的合成经营数据分析各门店两期收款并生成经营分析画报'.repeat(3);
  const title=()=>generated?'五店两期收款分析':fallback;
  await page.route('**/conversations?*',route=>route.fulfill({json:{tenantId:tenant,enabled:true,agentMode:'live',publicWebEnabled:false,items:[{...info,title:title()},{...info,id:uid(96),title:'其他会话'}],hasMore:false}}));
  await page.route('**/conversations/*?*',route=>route.fulfill({json:{conversation:{...info,title:title()},tasks:[{...task('合成分析要求'),status:'SUCCEEDED',executionClass:'live',attempt:1,reply:'分析正文'}],hasMore:false,cursor:generated?2:1}}));
  await page.route('**/events?*',route=>route.fulfill({json:{conversationId:conversation,items:generated&&new URL(route.request().url()).searchParams.get('after')==='1'?[{seq:2,taskId,kind:'TITLE_UPDATED',revision:0}]:[],cursor:generated?2:1,hasMore:false}}));
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations&conversation=${conversation}`);
  const heading=page.locator('.conversation-reader > header h2');
  await expect(heading).toHaveText(fallback);
  expect(await heading.evaluate(el=>getComputedStyle(el).whiteSpace)).toBe('nowrap');
  await page.getByRole('textbox',{name:'工作要求',exact:true}).fill('尚未发送的草稿');
  await expect.poll(()=>page.locator('.live-deck-scroller').evaluate(el=>el.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
  await page.evaluate(()=>Object.assign(window,{titleDeck:document.querySelector('.live-deck-scroller')}));
  generated=true;
  await expect(heading).toHaveText('五店两期收款分析');
  await expect(page.locator('.live-conversation-links a').first()).toHaveText('五店两期收款分析');
  await expect(page.getByRole('textbox',{name:'工作要求',exact:true})).toHaveValue('尚未发送的草稿');
  expect(await page.evaluate(()=>{const deck=(window as unknown as {titleDeck:Element}).titleDeck;return deck===document.querySelector('.live-deck-scroller')&&deck.getAnimations().every(a=>a.playState!=='running');})).toBe(true);
});


test('部分完成回复直接展示正文，不显示状态跟进卡片且可继续发送', async ({ page }) => {
  await fixture(page, accepted);
  const partial = {...task('合成短文'),status:'PARTIAL',attempt:1,reply:'已经生成的合成短文正文。',executionClass:'live',waitReason:null};
  await page.route('**/conversations/'+conversation+'?*',route=>route.fulfill({json:{conversation:info,tasks:[partial],hasMore:false,cursor:1}}));
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations&conversation=${conversation}`);
  await expect(page.locator('.conversation-reply')).toHaveText(partial.reply);
  await expect(page.locator('.task-intervention-card')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'继续处理',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'结束此项工作',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'复制回复',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'更多回复操作',exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'工作要求',exact:true}).fill('请修改第二段');
  await expect(page.getByRole('button',{name:'开始任务',exact:true})).toBeEnabled();
});

async function managementFixture(page: Page, reply = '合成回复') {
  await fixture(page, accepted);
  let trashed = false, running = true, unread = true, revision = 0, replyRevision=1;
  const actions: Record<string,unknown>[] = [], reads: number[] = [];
  const current = () => ({...info,managementRevision:revision,running:!trashed&&running,unread,replyRevision,latestReplyTaskId:taskId,trashedAt:trashed?now:null});
  await page.route('**/conversations**', async route => {
    const path = new URL(route.request().url()).pathname;
    if(path.endsWith('/management')) {
      const body=route.request().postDataJSON(); actions.push(body);
      expect(route.request().headers()['x-csrf-token']).toBe('synthetic-csrf');
      trashed=body.action==='TRASH';running=false;revision++;
      return route.fulfill({json:{id:conversation,revision,trashedAt:trashed?now:null}});
    }
    if(path.endsWith('/read')) {
      reads.push(route.request().postDataJSON().replyRevision);unread=false;
      return route.fulfill({json:{id:conversation,readReplyRevision:replyRevision}});
    }
    if(path.endsWith('/conversations')||path.endsWith('/conversations/trash'))return route.fulfill({json:{tenantId:tenant,enabled:true,agentMode:'off',publicWebEnabled:false,items:trashed===path.endsWith('/trash')?[current()]:[],hasMore:false}});
    if(path.endsWith('/conversations/'+conversation))return route.fulfill({json:{conversation:current(),tasks:[{...task('合成历史'),status:'SUCCEEDED',reply,attempt:1,executionClass:'live',modelName:'fixture',waitReason:null}],hasMore:false,cursor:1}});
    if(path.endsWith('/events'))return route.fulfill({json:{conversationId:conversation,items:Number(new URL(route.request().url()).searchParams.get('after'))<replyRevision?[{seq:replyRevision,taskId,kind:'SUCCEEDED',revision:replyRevision}]:[],cursor:replyRevision,hasMore:false}});
    return route.fallback();
  });
  return {actions,reads,newReply:()=>{replyRevision++;unread=true;},finish:()=>{running=false;},makeUnread:()=>{unread=true;}};
}
test('会话管理：仅用图标标记进行中与未读，轮询反映执行结束',async({page})=>{
  const state=await managementFixture(page);
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations`);
  const list=page.locator('.live-conversation-list');
  await expect(list.getByRole('img',{name:'进行中',exact:true})).toBeVisible();
  await expect(list.getByRole('img',{name:'未读回复'})).toBeVisible();
  await expect(list.getByText('进行中',{exact:true})).toHaveCount(0);
  state.finish();await expect(list.getByRole('img',{name:'进行中',exact:true})).toHaveCount(0,{timeout:10000});
  expect(state.reads).toEqual([]);
});
test('会话管理：停止并删除，设置回收站恢复历史且不重启',async({page})=>{
  const state=await managementFixture(page);
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations`);
  await page.getByRole('link',{name:info.title}).hover();
  await page.getByRole('link',{name:info.title}).hover();
  await page.getByRole('button',{name:'删除会话：'+info.title,exact:true}).click();
  await page.locator('dialog[open]').getByRole('button',{name:'停止并删除',exact:true}).click();
  await expect(page.getByRole('link',{name:info.title})).toHaveCount(0);
  expect(state.actions[0]).toMatchObject({action:'TRASH',expectedRevision:0,stopRunning:true});
  await page.getByRole('button',{name:'个人设置与账号',exact:true}).click();
  const dialog=page.locator('dialog[open]');
  await dialog.getByRole('button',{name:'个人设置',exact:true}).click();
  await dialog.getByRole('button',{name:'会话回收站',exact:true}).click();
  await expect(dialog.getByText(info.title,{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'恢复',exact:true}).click();
  await expect(dialog.getByText('回收站为空',{exact:true})).toBeVisible();
  expect(state.actions[1]).toMatchObject({action:'RESTORE',expectedRevision:1,stopRunning:false});
  await dialog.getByRole('button',{name:'关闭弹窗',exact:true}).click();
  await expect(page.getByRole('link',{name:info.title})).toBeVisible();
  await expect(page.getByRole('img',{name:'进行中',exact:true})).toHaveCount(0);
});
test('会话管理：实际看到回复后确认已读，重复停留不重复提交',async({page})=>{
  const state=await managementFixture(page);state.finish();
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations&conversation=${conversation}`);
  await expect(page.getByText('合成回复',{exact:true})).toBeVisible();
  await expect.poll(()=>state.reads).toEqual([1]);
  await expect(page.getByRole('img',{name:'未读回复'})).toHaveCount(0);
  await page.waitForTimeout(1800);expect(state.reads).toEqual([1]);
});

test('会话管理：阅读旧内容时新回复保持未读，看到末尾才清除',async({page})=>{
  const state=await managementFixture(page,'合成段落内容。\n\n'.repeat(140));state.finish();
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations&conversation=${conversation}`);
  await expect.poll(()=>state.reads).toEqual([1]);
  const messages=page.locator('.conversation-messages');
  await messages.hover();await page.mouse.wheel(0,-600);
  await expect.poll(()=>messages.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeGreaterThan(300);
  state.newReply();
  await expect(page.getByRole('img',{name:'未读回复'})).toBeVisible({timeout:10000});
  await page.waitForTimeout(2000);expect(state.reads).toEqual([1]);
  await messages.hover();await page.mouse.wheel(0,1200);
  await expect.poll(()=>state.reads,{timeout:10000}).toEqual([1,2]);
});
test('会话管理：窄屏鼠标悬浮直接删除并取消',async({page})=>{
  await page.setViewportSize({width:390,height:841});await managementFixture(page);
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations`);
  await page.getByRole('button',{name:'列表',exact:true}).click();
  await page.getByRole('link',{name:info.title}).hover();
  await page.getByRole('button',{name:'删除会话：'+info.title,exact:true}).click();
  await page.locator('dialog[open]').getByRole('button',{name:'取消',exact:true}).click();
  await expect(page.getByRole('link',{name:info.title})).toHaveCount(1);
});

test('会话管理：删除当前会话后返回新会话，导航锁不滞留旧页面',async({page})=>{
  const state=await managementFixture(page);state.finish();
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations&conversation=${conversation}`);
  await expect(page.getByText('合成回复',{exact:true})).toBeVisible();
  await page.getByRole('link',{name:info.title}).hover();
  await page.getByRole('button',{name:'删除会话：'+info.title,exact:true}).click();
  await page.locator('dialog[open]').getByRole('button',{name:'删除会话',exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`tenant=${tenant}&view=conversations$`));
  await expect(page.locator('.conversation-reader')).toHaveClass(/is-new-conversation/);
  await expect(page.getByRole('link',{name:info.title})).toHaveCount(0);
});

test('画报来源会话：标题前图标持久显示，普通会话不标记且保留状态图标', async ({ page }) => {
  await fixture(page, accepted);
  const ordinary = { ...info, id: uid(97), title: '普通会话里提到画报', briefingDiscussion: false };
  await page.route('**/conversations?*', route => route.fulfill({ json: {
    tenantId: tenant, enabled: true, agentMode: 'off', publicWebEnabled: false,
    items: [{ ...info, briefingDiscussion: true, running: true, unread: true }, ordinary], hasMore: false,
  } }));
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations`);
  const row = page.locator('.live-conversation-row').filter({ hasText: info.title });
  await expect(row.getByRole('img', { name: '画报会话', exact: true })).toBeVisible();
  await expect(row.getByRole('img', { name: '进行中', exact: true })).toBeVisible();
  await expect(row.getByRole('img', { name: '未读回复', exact: true })).toBeVisible();
  await expect(page.locator('.live-conversation-row').filter({ hasText: ordinary.title }).getByRole('img', { name: '画报会话' })).toHaveCount(0);
  await page.reload();
  await expect(row.getByRole('img', { name: '画报会话', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await expect(row.getByRole('img', { name: '画报会话', exact: true })).toBeVisible();
  expect(await row.locator('.conversation-list-title').evaluate(el => getComputedStyle(el).textOverflow)).toBe('ellipsis');
  expect(await row.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('会话列表删除入口：默认不占标题宽度，悬浮或键盘聚焦才显示，同款画报图标', async ({ page }) => {
  const state = await managementFixture(page); state.finish();
  await page.route('**/conversations?*', route => route.fulfill({json:{tenantId:tenant, enabled:true, agentMode:'off', publicWebEnabled:false, items:[{...info, briefingDiscussion:true, title:'用于核对会话列表标题空间的合成画报标题'}], hasMore:false}}));
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations`);
  const row = page.locator('.live-conversation-row');
  const button = row.getByRole('button', {name:'删除会话：用于核对会话列表标题空间的合成画报标题', exact:true});
  await expect(row).toBeVisible();
  await expect(button).toBeHidden();
  const normalWidth = await row.locator('.conversation-list-title').evaluate(el => el.getBoundingClientRect().width);
  expect(await row.locator('.conversation-row-delete').evaluate(el => el.getBoundingClientRect().width)).toBe(0);
  expect(await row.locator('.conversation-briefing-tag svg').getAttribute('class')).toContain('lucide-layout-panel-top');
  const navPaths = await page.getByRole('link', {name:'智能画报', exact:true}).locator('svg').innerHTML();
  expect(await row.locator('.conversation-briefing-tag svg').innerHTML()).toBe(navPaths);
  await row.locator('a').hover();
  await expect(button).toBeVisible();
  expect(await row.locator('.conversation-list-title').evaluate(el => el.getBoundingClientRect().width)).toBeLessThan(normalWidth);
  await button.click();
  await expect(page.locator('dialog[open]').getByRole('button', {name:'取消',exact:true})).toBeVisible();
  await page.locator('dialog[open]').getByRole('button', {name:'取消',exact:true}).click();
  expect(state.actions).toEqual([]);
  await page.mouse.move(0,0);
  await page.keyboard.press('Tab');
  await row.locator('a').focus();
  await expect(row.locator('a')).toBeFocused();
  await expect(button).toBeVisible();
});

test.describe('会话列表触屏长按', () => {
  test.use({hasTouch:true});
  test('长按显示删除，释放不打开会话，点击外部收起，滑动不触发', async ({ page }) => {
    const state = await managementFixture(page); state.finish();
    await page.setViewportSize({width:390,height:844});
    await page.goto(`/workspace/#tenant=${tenant}&view=conversations`);
    await page.getByRole('button',{name:'列表',exact:true}).click();
    const row = page.locator('.live-conversation-row');
    const link = row.locator('a');
    const button = row.getByRole('button',{name:'删除会话：'+info.title,exact:true});
    await expect(link).toBeVisible();
    await expect(button).toBeHidden();
    const touch = {pointerType:'touch',pointerId:1,isPrimary:true,clientX:150,clientY:160};
    await link.evaluate((el,init) => el.dispatchEvent(new PointerEvent('pointerdown',{...init,bubbles:true})),touch);
    await expect(row).toHaveClass(/is-delete-revealed/);
    await link.dispatchEvent('pointerup',touch);
    await link.dispatchEvent('click',{});
    await expect(page).toHaveURL(new RegExp(`tenant=${tenant}&view=conversations$`));
    await expect(button).toBeVisible();
    await button.tap();
    await expect(page.locator('dialog[open]').getByRole('button',{name:'取消',exact:true})).toBeVisible();
    await page.locator('dialog[open]').getByRole('button',{name:'取消',exact:true}).tap();
    expect(state.actions).toEqual([]);
    await link.evaluate((el,init) => el.dispatchEvent(new PointerEvent('pointerdown',{...init,bubbles:true})),touch);
    await expect(row).toHaveClass(/is-delete-revealed/);
    await link.dispatchEvent('pointerup',touch);
    await page.locator('.live-conversation-list h2').tap();
    await expect(button).toBeHidden();
    await link.dispatchEvent('pointerdown',touch);
    await link.dispatchEvent('pointermove',{...touch,clientY:190});
    await page.waitForTimeout(600);
    await expect(button).toBeHidden();
    await link.dispatchEvent('pointercancel',touch);
    await link.tap();
    await expect(page).toHaveURL(new RegExp(`conversation=${conversation}`));
    expect(state.actions).toEqual([]);
  });
});

test('排队任务包含 LIVE 事件时自动显示完成回复并恢复发送', async ({ page }) => {
  await fixture(page, accepted);
  const current = { ...task('等待完成的合成问题'), status: 'QUEUED', attempt: 1, revision: 0, executionClass: 'live', waitReason: null, reply: null as string | null };
  let cursor = 1;
  const events: { seq: number; taskId: string; kind: string; revision: number }[] = [];
  await page.route('**/conversations/' + conversation + '?*', route => route.fulfill({ json: {
    conversation: info, tasks: [current], hasMore: false, cursor,
  } }));
  await page.route('**/conversations/' + conversation + '/events?*', route => {
    const after = Number(new URL(route.request().url()).searchParams.get('after'));
    return route.fulfill({ json: { conversationId: conversation, items: events.filter(e => e.seq > after), cursor, hasMore: false } });
  });
  await page.route('**/answer-stream', route => route.fulfill({ status: 503 }));
  await page.route('**/answer-snapshot', route => route.fulfill({ json: { items: [] } }));
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations&conversation=${conversation}`);
  await expect(page.getByText('等待处理', { exact: true })).toBeVisible();
  const input = page.getByRole('textbox', { name: '工作要求', exact: true });
  await input.fill('保留下一条尚未发送的要求');
  const append = (kind: string, revision: number) => events.push({ seq: ++cursor, taskId, kind, revision });
  current.status = 'RUNNING'; current.revision = 1;
  append('RUNNING', 1); append('LIVE', 1);
  await expect(page.getByText('正在思考', { exact: true })).toBeVisible();
  current.status = 'SUCCEEDED'; current.revision = 2; current.reply = '后台完成的正式回复';
  append('LIVE', 1); append('SUCCEEDED', 2);
  await expect(page.locator('.conversation-reply')).toHaveText('后台完成的正式回复');
  await expect(page.locator('.reply-progress')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '停止执行', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '开始任务', exact: true })).toBeEnabled();
  await expect(input).toHaveValue('保留下一条尚未发送的要求');
});
