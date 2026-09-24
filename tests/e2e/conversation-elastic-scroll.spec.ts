import { test, expect, type Page } from '@playwright/test';

const deck = (page: Page) => page.locator('.deck-scroller');
async function openCards(page: Page, width = 1440) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width, height: 852 });
  await page.goto('/#/briefing');
  await page.locator('[data-card-id="konggu:C09"] .briefing-card-main').click();
  await page.locator('.briefing-detail').getByRole('button', { name: '发起会话', exact: true }).click();
  await expect(page.locator('.conversation-overlay')).toHaveAttribute('data-phase', 'open');
  await expect(page.locator('.deck-file')).toHaveCount(2);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

async function snapshot(page: Page, wheel?: WheelEventInit, repeat = 1) {
  return page.evaluate(
    ({ wheel, repeat }) => {
      const rail = document.querySelector<HTMLElement>('.deck-scroller')!;
      const read = () => ({
        edge: rail.dataset.elasticEdge,
        scroll: rail.scrollLeft,
        max: rail.scrollWidth - rail.clientWidth,
        cards: Array.from(rail.querySelectorAll<HTMLElement>('[data-deck-id]')).map((card) => ({
          id: card.dataset.deckId,
          x: card.getBoundingClientRect().x,
          width: Math.round(card.getBoundingClientRect().width * 1000) / 1000,
          offset: parseFloat(card.style.getPropertyValue('--deck-elastic-x')) || 0,
          folded: card.hasAttribute('data-folded'),
          covered: card.querySelector('.deck-card-content')!.hasAttribute('inert'),
        })),
      });
      return Array.from({ length: repeat }, () => {
        const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...wheel });
        if (wheel) document.querySelector('.deck-toolbar')!.dispatchEvent(event);
        return { ...read(), prevented: event.defaultPrevented };
      });
    },
    { wheel, repeat },
  );
}

async function rest(page: Page) {
  await expect(deck(page)).not.toHaveAttribute('data-elastic-edge');
  expect((await snapshot(page))[0].cards.every((card) => card.offset === 0)).toBe(true);
}

// Explicitly model the OS wheel tail, including browsers without momentum metadata.
async function wheelSequence(page: Page, samples: { delta: number; momentum?: boolean }[]) {
  return page.evaluate(async (samples) => {
    const rail = document.querySelector<HTMLElement>('.deck-scroller')!;
    const card = Array.from(rail.querySelectorAll<HTMLElement>('[data-deck-id]')).at(-1)!;
    const frames = [];
    for (const sample of samples) {
      const event = new WheelEvent('wheel', { deltaX: sample.delta, bubbles: true, cancelable: true });
      Object.defineProperty(event, 'momentum', { value: sample.momentum });
      document.querySelector('.deck-toolbar')!.dispatchEvent(event);
      await new Promise((resolve) => setTimeout(resolve, 16));
      frames.push({
        offset: Math.abs(parseFloat(card.style.getPropertyValue('--deck-elastic-x')) || 0),
        scroll: rail.scrollLeft,
        edge: rail.dataset.elasticEdge,
      });
    }
    return frames;
  }, samples);
}

for (const native of [true, false]) {
  test(`${native ? '原生惯性标记' : '无惯性标记的衰减尾流'}：两端松手后及时回弹，长尾不再拉住或重开弹性`, async ({
    page,
  }) => {
    await openCards(page);
    for (const direction of [-1, 1]) {
      await deck(page).evaluate((node, direction) => {
        node.scrollTo({ left: direction < 0 ? 0 : node.scrollWidth, behavior: 'instant' });
      }, direction);
      const frames = await wheelSequence(page, [
        ...Array.from({ length: 3 }, () => ({ delta: direction * 60, momentum: native ? false : undefined })),
        ...Array.from({ length: 55 }, (_, index) => ({
          delta: direction * Math.max(0.8, 60 * 0.87 ** (index + 1)),
          momentum: native ? true : undefined,
        })),
      ]);
      const peak = Math.max(...frames.slice(0, 10).map((frame) => frame.offset));
      expect(peak).toBeGreaterThan(5);
      // During the tail (rather than after it ends), the spring must visibly return.
      expect(frames[native ? 6 : 12].offset).toBeLessThan(peak * 0.8);
      expect(frames[24].offset).toBeLessThan(2);
      expect(frames.slice(45).every((frame) => frame.offset === 0 && !frame.edge)).toBe(true);
      expect(frames.every((frame) => frame.scroll === frames[0].scroll)).toBe(true);
      await rest(page);
    }
  });
}

test('原生标记区分主动减速与惯性，重新滑动立即接手，内部惯性仍能滚动', async ({ page }) => {
  await openCards(page);
  const active = await wheelSequence(
    page,
    [60, 60, 60, 50, 40, 30, 20, 10, 8, 5].map((delta) => ({ delta: -delta, momentum: false })),
  );
  expect(active.every((frame, index) => !index || frame.offset >= active[index - 1].offset)).toBe(true);
  const tail = await wheelSequence(
    page,
    Array.from({ length: 4 }, () => ({ delta: -30, momentum: true })),
  );
  expect(tail.at(-1)!.offset).toBeLessThan(active.at(-1)!.offset * 0.8);
  const resumed = await wheelSequence(page, [{ delta: -60, momentum: false }]);
  expect(resumed[0].offset).toBeGreaterThan(tail.at(-1)!.offset);
  const interior = await wheelSequence(page, [{ delta: 100, momentum: true }]);
  expect(interior[0].scroll).toBe(100);
  await rest(page);
});

test('兼容路径保留持续推拉、重新加力与下一次轻滑，无尾流时尽快回弹', async ({ page }) => {
  await openCards(page);
  const held = await wheelSequence(
    page,
    Array.from({ length: 12 }, () => ({ delta: -25 })),
  );
  expect(held.every((frame, index) => !index || frame.offset >= held[index - 1].offset)).toBe(true);
  const tail = await wheelSequence(
    page,
    [22, 18, 14, 11, 8, 6, 4, 2, 1].map((delta) => ({ delta: -delta })),
  );
  expect(tail.at(-1)!.offset).toBeLessThan(held.at(-1)!.offset * 0.8);
  const resumed = await wheelSequence(page, [{ delta: -60 }]);
  expect(resumed[0].offset).toBeGreaterThan(tail.at(-1)!.offset);
  await rest(page);
  expect((await wheelSequence(page, [{ delta: -8 }]))[0].offset).toBeGreaterThan(0);
  await rest(page);
  const stopped = await page.evaluate(async () => {
    const card = Array.from(document.querySelectorAll<HTMLElement>('.deck-scroller [data-deck-id]')).at(-1)!;
    const offset = () => Math.abs(parseFloat(card.style.getPropertyValue('--deck-elastic-x')) || 0);
    const event = new WheelEvent('wheel', { deltaX: -100, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'momentum', { value: undefined });
    document.querySelector('.deck-toolbar')!.dispatchEvent(event);
    const peak = offset();
    await new Promise((resolve) => setTimeout(resolve, 85));
    // Read a painted frame, rather than racing the spring's RAF with a timer.
    await new Promise(requestAnimationFrame);
    return { peak, after: offset() };
  });
  expect(stopped.peak).toBeGreaterThan(5);
  expect(stopped.after).toBeLessThan(stopped.peak * 0.85);
  await rest(page);
});

test('两端越界分别拉伸间隙与压缩叠边，阻力递增并回弹，宽度和折叠语义不变', async ({ page }) => {
  await openCards(page);
  const before = (await snapshot(page))[0];
  const stretched = await snapshot(page, { deltaX: -70 }, 3);
  const last = stretched.at(-1)!;
  expect(last.edge).toBe('expanded');
  expect(last.scroll).toBe(0);
  expect(last.cards[0].x).toBe(before.cards[0].x);
  expect(last.cards.map((card) => card.width)).toEqual(before.cards.map((card) => card.width));
  for (let i = 1; i < last.cards.length; i++) {
    expect(last.cards[i].x - last.cards[i - 1].x).toBeGreaterThan(before.cards[i].x - before.cards[i - 1].x);
  }
  const shifts = stretched.map((frame) => frame.cards.at(-1)!.offset);
  expect(shifts[2]).toBeLessThan(32);
  expect(shifts[2] - shifts[1]).toBeLessThan(shifts[1] - shifts[0]);
  await page.waitForFunction((peak) => {
    const last = document.querySelector<HTMLElement>('.deck-scroller [data-deck-id]:nth-last-child(2)');
    const current = parseFloat(last?.style.getPropertyValue('--deck-elastic-x') || '0');
    return current > 0.1 && current < peak * 0.8;
  }, shifts[2]);
  await rest(page);
  expect((await snapshot(page))[0].cards).toEqual(before.cards);

  await deck(page).evaluate((node) => node.scrollTo({ left: node.scrollWidth, behavior: 'instant' }));
  await expect(page.locator('.deck-list')).toHaveAttribute('data-folded', 'true');
  const end = (await snapshot(page))[0];
  const compressed = (await snapshot(page, { deltaX: 130 }))[0];
  expect(compressed.edge).toBe('compressed');
  expect(compressed.scroll).toBe(end.scroll);
  expect(compressed.max).toBe(end.max);
  expect(compressed.cards.map(({ id, width, folded, covered }) => ({ id, width, folded, covered }))).toEqual(
    end.cards.map(({ id, width, folded, covered }) => ({ id, width, folded, covered })),
  );
  expect(compressed.cards[1].x - compressed.cards[0].x).toBeLessThan(end.cards[1].x - end.cards[0].x);
  expect(compressed.cards[1].x - compressed.cards[0].x).toBeGreaterThanOrEqual(8);
  expect(compressed.cards[2].x - compressed.cards[1].x).toBeLessThan(end.cards[2].x - end.cards[1].x);
  expect(compressed.cards.at(-1)!.offset).toBeGreaterThan(-32);
  await rest(page);
  expect((await snapshot(page))[0].cards).toEqual(end.cards);
});

test('反向立即恢复滚动，竖向阅读、缩放、弹窗与减少动态效果保持原行为', async ({ page }) => {
  await openCards(page);
  await page.mouse.move(700, 40);
  await page.mouse.wheel(120, 0);
  await expect.poll(async () => (await snapshot(page))[0].scroll).toBeGreaterThan(80);
  await expect(deck(page)).not.toHaveAttribute('data-elastic-edge');
  const interior = (await snapshot(page))[0];
  expect((await snapshot(page, { deltaY: 100 }))[0].prevented).toBe(false);
  expect((await snapshot(page, { deltaX: 100, ctrlKey: true }))[0].prevented).toBe(false);
  expect((await snapshot(page))[0].scroll).toBe(interior.scroll);

  await deck(page).evaluate((node) => node.scrollTo({ left: node.scrollWidth, behavior: 'instant' }));
  const edge = (await snapshot(page, { deltaX: 200 }))[0];
  const reverse = (await snapshot(page, { deltaX: -120 }))[0];
  expect(reverse.scroll).toBeCloseTo(edge.scroll - 120, 0);
  await rest(page);
  await snapshot(page, { deltaX: 3000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await rest(page);
  expect((await snapshot(page, { deltaX: 3000 }))[0].edge).toBeUndefined();

  await deck(page).evaluate((node) => node.scrollTo({ left: 0, behavior: 'instant' }));
  await page.getByRole('button', { name: '会话选项', exact: true }).click();
  expect(
    await page.getByRole('dialog', { name: '会话选项', exact: true }).evaluate((node) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: -200 });
      node.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(false);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '添加资料', exact: true }).click();
  await expect(page.locator('dialog[open]')).toBeVisible();
  expect((await snapshot(page, { deltaX: -200 }))[0].prevented).toBe(false);
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await snapshot(page, { deltaX: -200 });
  await page.getByRole('button', { name: '关闭会话', exact: true }).click();
  await expect(page.locator('.conversation-overlay')).toHaveCount(0);
  expect(await page.locator('[style*="--deck-elastic-x"]').count()).toBe(0);
});

test('触屏在两端随手势压缩和拉伸，松手回弹，正文竖滑和内部横滑仍为原生滚动', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true });
  const page = await context.newPage();
  await openCards(page);
  const client = await context.newCDPSession(page);
  const touch = (type: string, x = 0, y = 0) =>
    client.send('Input.dispatchTouchEvent', {
      type: type as 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
      touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y }],
    });
  await deck(page).evaluate((node) => node.scrollTo({ left: node.scrollWidth, behavior: 'instant' }));
  await expect(page.locator('.deck-list')).toHaveAttribute('data-folded', 'true');
  const reader = page.locator('.deck-file').last().locator('.reader-scroll');
  const box = (await reader.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 160;
  await touch('touchStart', x, y);
  await touch('touchMove', x - 100, y);
  await expect(deck(page)).toHaveAttribute('data-elastic-edge', 'compressed');
  const held = (await snapshot(page))[0];
  await page.waitForTimeout(180); // Finger stays down: do not start the idle wheel rebound.
  expect((await snapshot(page))[0].cards).toEqual(held.cards);
  await page.screenshot({ path: '.local/conversation-deck/elastic-compressed.png' });
  await touch('touchEnd');
  await rest(page);
  const top = await reader.evaluate((node) => node.scrollTop);
  await touch('touchStart', x, y + 150);
  await touch('touchMove', x, y);
  await touch('touchEnd');
  await expect.poll(() => reader.evaluate((node) => node.scrollTop)).toBeGreaterThan(top);
  await expect(deck(page)).not.toHaveAttribute('data-elastic-edge');

  await deck(page).evaluate((node) => node.scrollTo({ left: 0, behavior: 'instant' }));
  const conversation = (await page.locator('.conversation-scroll').boundingBox())!;
  const chatX = conversation.x + 80;
  const chatY = conversation.y + 70;
  await touch('touchStart', chatX, chatY);
  await touch('touchMove', chatX + 100, chatY);
  await expect(deck(page)).toHaveAttribute('data-elastic-edge', 'expanded');
  await page.screenshot({ path: '.local/conversation-deck/elastic-expanded.png' });
  await touch('touchCancel');
  await rest(page);
  await deck(page).evaluate((node) => node.scrollTo({ left: 200, behavior: 'instant' }));
  await touch('touchStart', 450, chatY);
  await touch('touchMove', 380, chatY);
  await expect.poll(async () => (await snapshot(page))[0].scroll).toBeGreaterThan(220);
  await touch('touchCancel');
  await expect(deck(page)).not.toHaveAttribute('data-elastic-edge');
  await context.close();
});

test('全部卡片放得下时仍有边界反馈，调整窗口后清理弹性且手机单卡不触发', async ({ page }) => {
  await openCards(page, 3200);
  expect((await snapshot(page))[0].max).toBeLessThan(2);
  const pulled = (await snapshot(page, { deltaX: -200 }))[0];
  expect(pulled.edge).toBe('expanded');
  expect(pulled.scroll).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await rest(page);
  const mobile = (await snapshot(page, { deltaX: 200 }))[0];
  expect(mobile.edge).toBeUndefined();
  expect(mobile.prevented).toBe(false);
  await expect(page.getByLabel('继续对话', { exact: true })).toBeInViewport({ ratio: 1 });
});
