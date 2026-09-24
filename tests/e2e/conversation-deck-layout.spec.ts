import { test, expect, type Page } from '@playwright/test';

const overlay = (page: Page) => page.locator('.conversation-overlay');
const card = (page: Page, id: string) => page.locator(`.deck-scroller [data-deck-id="${id}"]`);
const title = (page: Page, id: string) => card(page, id).locator('[data-deck-draggable]');
const order = (page: Page) =>
  page
    .locator('.deck-scroller [data-deck-id]')
    .evaluateAll((nodes) =>
      nodes
        .sort(
          (a, b) =>
            Number((a as HTMLElement).dataset.deckOrder) - Number((b as HTMLElement).dataset.deckOrder),
        )
        .map((node) => (node as HTMLElement).dataset.deckId!),
    );
const width = async (page: Page) => (await card(page, 'conversation').boundingBox())!.width;
async function openCards(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 2366, height: 1253 });
  await page.goto('/#/briefing');
  await page.locator('[data-card-id="konggu:C09"] .briefing-card-main').click();
  await page.locator('.briefing-detail').getByRole('button', { name: '发起会话', exact: true }).click();
  await expect(overlay(page)).toHaveAttribute('data-phase', 'open');
  await expect(page.locator('.deck-scroller .deck-file')).toHaveCount(2);
}
async function drag(page: Page, id: string, x: number, release = true) {
  const rect = (await title(page, id).boundingBox())!;
  await page.mouse.move(rect.x + 40, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, rect.y + rect.height / 2, { steps: 12 });
  if (release) await page.mouse.up();
}

// Pause only the deck's position transitions so intermediate painted geometry
// can be sampled deterministically, even on a slower browser/CI worker.
async function pauseDeckMotion(page: Page) {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const result = animate.call(this, frames, options);
      if (typeof options === 'object' && options.id === 'deck-reflow') {
        result.pause();
        result.currentTime = 0;
      }
      return result;
    };
  });
}

const deckAnimationCount = (page: Page) =>
  page.evaluate(() => document.getAnimations().filter((animation) => animation.id === 'deck-reflow').length);

async function sampleMotion(page: Page, id: string) {
  return card(page, id).evaluate((node) => {
    const animation = node.getAnimations().find((item) => item.id === 'deck-reflow');
    if (!animation) throw new Error('Expected an active card position animation');
    const timing = animation.effect!.getTiming();
    animation.currentTime = 0;
    const start = node.getBoundingClientRect().x;
    animation.currentTime = 240;
    const end = node.getBoundingClientRect().x;
    animation.currentTime = 80;
    const middle = node.getBoundingClientRect().x;
    return { start, middle, end, width: node.getBoundingClientRect().width, timing };
  });
}

test('邻卡在松手前平滑让位，连续反向与取消从当前动画位置衔接', async ({ page }) => {
  await openCards(page);
  await pauseDeckMotion(page);
  const original = await order(page);
  const last = original.at(-1)!;
  const list = (await card(page, 'list').boundingBox())!;
  const oldChat = (await card(page, 'conversation').boundingBox())!;
  const header = (await title(page, last).boundingBox())!;
  const y = header.y + 24;
  await page.mouse.move(header.x + 40, y);
  await page.mouse.down();
  await page.mouse.move(list.x + list.width + 25, y);
  await expect.poll(() => order(page)).toEqual(['list', last, ...original.slice(1, -1)]);
  await expect(page.locator('.deck-drag-ghost')).toHaveCount(1);
  const first = await sampleMotion(page, 'conversation');
  expect(first.timing.duration).toBe(240);
  expect(first.timing.easing.replaceAll(' ', '')).toBe('cubic-bezier(0.22,0.68,0,1)');
  expect(Math.abs(first.start - oldChat.x)).toBeLessThan(1);
  expect(first.middle).toBeGreaterThan(first.start + 1);
  expect(first.middle).toBeLessThan(first.end - 1);
  expect((await card(page, 'list').boundingBox())!.x).toBe(list.x);
  expect(await card(page, 'list').evaluate((node) => node.getAnimations().length)).toBe(0);
  await page.evaluate(() => {
    document
      .getAnimations()
      .filter((animation) => animation.id === 'deck-reflow')
      .forEach((animation) => {
        animation.currentTime = 80;
      });
  });
  await page.screenshot({ path: '.local/conversation-deck/animated-reflow.png' });

  // Cross back while the first transition is unfinished. Hit testing uses the
  // final layout, but the new animation must begin at the painted position.
  await page.mouse.move(first.end + first.width / 2 + 20, y);
  await expect.poll(() => order(page)).toEqual(['list', 'conversation', last, ...original.slice(2, -1)]);
  const reverse = await sampleMotion(page, 'conversation');
  expect(Math.abs(reverse.start - first.middle)).toBeLessThan(1);
  expect(Math.abs(reverse.end - oldChat.x)).toBeLessThan(1);
  expect(reverse.middle).toBeLessThan(reverse.start - 1);
  expect(reverse.middle).toBeGreaterThan(reverse.end + 1);

  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect.poll(() => order(page)).toEqual(original);
  await expect(page.locator('.deck-drag-ghost')).toHaveCount(0);
  const cancelled = await sampleMotion(page, 'conversation');
  expect(Math.abs(cancelled.start - reverse.middle)).toBeLessThan(1);
  expect(Math.abs(cancelled.end - oldChat.x)).toBeLessThan(1);
  await page.evaluate(() => {
    document
      .getAnimations()
      .filter((animation) => animation.id === 'deck-reflow')
      .forEach((animation) => animation.play());
  });
  await expect.poll(() => deckAnimationCount(page)).toBe(0);
  expect(Math.abs((await card(page, 'conversation').boundingBox())!.x - oldChat.x)).toBeLessThan(1);
  await expect(overlay(page)).toBeVisible();
});

test('触摸实时让位同样有动画，减少动态效果会立即停止并直接复位', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true });
  const page = await context.newPage();
  await openCards(page);
  await pauseDeckMotion(page);
  const client = await context.newCDPSession(page);
  const original = await order(page);
  const oldChat = (await card(page, 'conversation').boundingBox())!;
  const header = (await title(page, original.at(-1)!).boundingBox())!;
  const y = header.y + 24;
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: header.x + 35, y }],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 370, y }] });
  await expect.poll(() => order(page)).not.toEqual(original);
  const moving = await sampleMotion(page, 'conversation');
  expect(moving.middle).toBeGreaterThan(moving.start + 1);
  expect(moving.middle).toBeLessThan(moving.end - 1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => deckAnimationCount(page)).toBe(0);
  expect(Math.abs((await card(page, 'conversation').boundingBox())!.x - moving.end)).toBeLessThan(1);
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect.poll(() => order(page)).toEqual(original);
  expect(await deckAnimationCount(page)).toBe(0);
  expect(Math.abs((await card(page, 'conversation').boundingBox())!.x - oldChat.x)).toBeLessThan(1);
  await expect(page.locator('.deck-drag-ghost')).toHaveCount(0);
  await context.close();
});

test('新会话居中且列表紧邻左侧，不铺满画布，窄屏输入完整可用', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/home');
  for (const viewport of [1440, 1920, 2366, 3200]) {
    await page.setViewportSize({ width: viewport, height: 1000 });
    await expect.poll(() => width(page)).toBeGreaterThan(560);
    // Sample all boxes in one frame after ResizeObserver has applied the new
    // viewport; separate browser reads can straddle two responsive layouts.
    await expect
      .poll(() =>
        page.locator('.deck-scroller').evaluate((node) => {
          const list = node.querySelector('[data-deck-id="list"]')!.getBoundingClientRect();
          const chat = node.querySelector('[data-deck-id="conversation"]')!.getBoundingClientRect();
          const rail = node.getBoundingClientRect();
          return {
            adjacent: Math.abs(chat.x - list.x - list.width - 8) <= 1,
            centered: Math.abs(chat.x + chat.width / 2 - rail.x - rail.width / 2) <= 4,
          };
        }),
      )
      .toEqual({ adjacent: true, centered: true });
    expect(await width(page)).toBeLessThanOrEqual(880);
    expect(await page.locator('.deck-scroller').evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThan(
      2,
    );
  }
  await page.setViewportSize({ width: 2366, height: 1253 });
  await page.screenshot({ path: '.local/conversation-deck/centered.png' });
  for (const viewport of [1000, 768, 390, 320]) {
    await page.setViewportSize({ width: viewport, height: 844 });
    await expect(page.locator('.draft-composer textarea')).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('增加卡片时会话让出空间，关闭文件后回宽，手动宽度保留且双击恢复自适应', async ({ page }) => {
  await openCards(page);
  const initial = await width(page);
  expect(initial).toBeLessThan(880);
  await page.locator('.deck-file').last().getByRole('button', { name: '关闭成果预览' }).click();
  await expect.poll(() => width(page)).toBeGreaterThan(initial);
  const handle = page.getByRole('separator', { name: '调整当前会话宽度', exact: true });
  await handle.press('End');
  await expect.poll(() => width(page)).toBe(1040);
  await page.setViewportSize({ width: 1100, height: 852 });
  await expect.poll(() => width(page)).toBeLessThan(1040);
  await page.setViewportSize({ width: 2366, height: 1253 });
  await expect.poll(() => width(page)).toBe(1040);
  await handle.dblclick();
  await expect.poll(() => width(page)).toBe(880);
  await page.screenshot({ path: '.local/conversation-deck/companions.png' });
});

test('标题拖动改变卡片位置和顺序，列表不可移动，草稿与资料阅读状态保留', async ({ page }) => {
  await openCards(page);
  const original = await order(page);
  const last = original.at(-1)!;
  await card(page, last).getByRole('button', { name: '版本记录', exact: true }).click();
  await page.getByLabel('继续对话', { exact: true }).fill('保留这段未发送草稿');
  const list = (await card(page, 'list').boundingBox())!;
  const oldConversationX = (await card(page, 'conversation').boundingBox())!.x;
  await drag(page, last, list.x + list.width + 25, false);
  await expect
    .poll(() => order(page))
    .toEqual(['list', last, ...original.filter((id) => !['list', last].includes(id))]);
  await expect
    .poll(async () => (await card(page, 'conversation').boundingBox())!.x)
    .toBeGreaterThan(oldConversationX);
  await expect(page.locator('.deck-drag-ghost')).toHaveCount(1);
  await page.screenshot({ path: '.local/conversation-deck/live-drag.png' });
  await page.mouse.up();
  await expect(page.getByLabel('继续对话', { exact: true })).toHaveValue('保留这段未发送草稿');
  await expect(card(page, last).getByRole('button', { name: '版本记录', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(
    await page
      .locator('.deck-scroller [data-deck-id]')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.deckId)),
  ).toEqual(await order(page));
  expect((await card(page, 'list').boundingBox())!.x).toBe(list.x);
  await expect(card(page, 'list').locator('[data-deck-draggable]')).toHaveCount(0);
  await expect(page.locator('.deck-drag-ghost')).toHaveCount(0);
  const saved = await order(page);
  await page.getByRole('button', { name: '关闭会话', exact: true }).click();
  await page.locator('[data-card-id="konggu:C09"] .briefing-card-main').click();
  await page.locator('.briefing-detail').getByRole('button', { name: '发起会话', exact: true }).click();
  await expect.poll(() => order(page)).toEqual(saved);
  await expect(page.getByLabel('继续对话', { exact: true })).toHaveValue('保留这段未发送草稿');
  await page.screenshot({ path: '.local/conversation-deck/reordered.png' });
});

test('拖动可用 Escape 取消，标题按钮保持可点击，键盘可把会话移至末尾再复原', async ({ page }) => {
  await openCards(page);
  const original = await order(page);
  await title(page, 'conversation').click({ position: { x: 40, y: 25 } });
  await expect(overlay(page)).toBeVisible();
  await drag(page, 'conversation', 1700, false);
  await expect(page.locator('.deck-drag-ghost')).toHaveCount(1);
  await expect.poll(() => order(page)).not.toEqual(original);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(overlay(page)).toBeVisible();
  await expect(page.locator('.deck-drag-ghost')).toHaveCount(0);
  expect(await order(page)).toEqual(original);
  await title(page, 'conversation').press('Alt+End');
  await expect
    .poll(() => order(page))
    .toEqual([...original.filter((id) => id !== 'conversation'), 'conversation']);
  await title(page, 'conversation').press('Alt+Home');
  await expect.poll(() => order(page)).toEqual(original);
  // Repeat after reordering: Escape must cancel the gesture before the workspace closes.
  await drag(page, 'conversation', 1700, false);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(overlay(page)).toBeVisible();
  await expect(page.locator('.deck-drag-ghost')).toHaveCount(0);
  await page.getByRole('button', { name: '会话选项', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '会话选项', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(overlay(page)).toBeVisible();
});

test('重排后层叠边缘仍能展开，缩放窗口后最后一个文件完整可达', async ({ page }) => {
  await openCards(page);
  await title(page, 'conversation').press('Alt+ArrowRight');
  for (const viewport of [1418, 1100, 1001]) {
    await page.setViewportSize({ width: viewport, height: 852 });
    await page
      .locator('.deck-scroller')
      .evaluate((node) => node.scrollTo({ left: node.scrollWidth, behavior: 'instant' }));
    const ids = await order(page);
    await expect(card(page, ids.at(-1)!)).toBeInViewport({ ratio: 0.99 });
    await expect(page.getByLabel('继续对话', { exact: true })).toBeInViewport({ ratio: 1 });
    await expect(card(page, 'source')).toHaveAttribute('data-folded', 'true');
    const spines = await page
      .locator('.deck-scroller [data-deck-id]')
      .evaluateAll((nodes) =>
        nodes.flatMap((node, index) =>
          node.hasAttribute('data-folded') && nodes[index + 1]
            ? [nodes[index + 1].getBoundingClientRect().left - node.getBoundingClientRect().left]
            : [],
        ),
      );
    for (const spine of spines) expect(spine).toBeCloseTo(12, 0);
    await page.getByRole('button', { name: '展开画报卡片', exact: true }).click();
    await expect(card(page, 'source').locator('.deck-card-content')).not.toHaveAttribute('inert');
  }
});

test('触屏拖动标题可排序与取消，手机单卡模式保留正文滚动及切换顺序', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 2366, height: 1253 } });
  const page = await context.newPage();
  await openCards(page);
  const client = await context.newCDPSession(page);
  const original = await order(page);
  const header = (await title(page, original.at(-1)!).boundingBox())!;
  const y = header.y + 24;
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: header.x + 35, y }],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 370, y }] });
  await expect(page.locator('.deck-drag-ghost')).toHaveCount(1);
  await expect.poll(() => order(page)).not.toEqual(original);
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  expect(await order(page)).toEqual(original);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: header.x + 35, y }],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 370, y }] });
  await expect.poll(() => order(page)).not.toEqual(original);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => order(page)).not.toEqual(original);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileOriginal = await order(page);
  await page.getByLabel('会话卡片切换').getByRole('button', { name: '对话', exact: true }).click();
  const mobileTitle = (await title(page, 'conversation').boundingBox())!;
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: mobileTitle.x + 80, y: mobileTitle.y + 24 }],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: mobileTitle.x + 220, y: mobileTitle.y + 24 }],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect
    .poll(async () => (await order(page)).indexOf('conversation'))
    .toBe(mobileOriginal.indexOf('conversation') + 1);
  await expect(page.getByLabel('继续对话', { exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.deck-drag-ghost')).toHaveCount(0);
  await page.screenshot({ path: '.local/conversation-deck/mobile.png' });
  await page
    .getByLabel('会话卡片切换')
    .getByRole('button', { name: '会员购买与30天复购摘要', exact: true })
    .click();
  const beforeScrollOrder = await order(page);
  const reader = card(page, 'kg-D06').locator('.reader-scroll');
  const reading = (await reader.boundingBox())!;
  const readingX = reading.x + reading.width / 2;
  const readingY = reading.y + reading.height - 50;
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: readingX, y: readingY }],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: readingX, y: readingY - 180 }],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => reader.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  expect(await order(page)).toEqual(beforeScrollOrder);
  await expect(page.locator('.deck-drag-ghost')).toHaveCount(0);
  await context.close();
});
