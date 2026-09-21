import { test, expect, type Page } from '@playwright/test';

const receipt = '[data-card-id="finance:demo-receipts"]';
const deckPosition = (page: Page) => page.locator('.deck-scroller').evaluate((el) => el.scrollLeft);

test('会话工作区的留白、导航和各卡片均可横向滑动，纵向阅读与内层弹窗不受影响', async ({ page }) => {
  await page.setViewportSize({ width: 1418, height: 700 });
  await page.goto('/#/briefing');
  await page.locator(`${receipt} .briefing-card-main`).click();
  await expect(page.locator('.conversation-overlay')).toHaveAttribute('data-phase', 'open');
  const targets = [
    { x: 980, y: 30 }, // toolbar canvas
    { x: 1100, y: 691 }, // bottom canvas
    { x: 53, y: 115 }, // foreground navigation
    { x: 210, y: 200 }, // list
    { x: 560, y: 280 }, // conversation
    { x: 1150, y: 280 }, // source
  ];
  for (const point of targets) {
    await page.locator('.deck-scroller').evaluate((el) => el.scrollTo({ left: 0, behavior: 'instant' }));
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(100, 2);
    await expect.poll(() => deckPosition(page)).toBeGreaterThan(90);
    await page.mouse.wheel(-100, 0);
    await expect.poll(() => deckPosition(page)).toBeLessThan(1);
  }
  await page.mouse.move(980, 30);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 120);
  await page.keyboard.up('Shift');
  await expect.poll(() => deckPosition(page)).toBeGreaterThan(100);
  await page.locator('.deck-scroller').evaluate((el) => el.scrollTo({ left: 0, behavior: 'instant' }));
  const messages = page.locator('.conversation-scroll');
  const top = await messages.evaluate((el) => el.scrollTop);
  await page.mouse.move(570, 290);
  await page.mouse.wheel(0, 180);
  await expect.poll(() => messages.evaluate((el) => el.scrollTop)).toBeGreaterThan(top);
  expect(await deckPosition(page)).toBe(0);
  await page.getByRole('button', { name: '添加资料', exact: true }).click();
  await page.mouse.move(980, 30);
  await page.mouse.wheel(150, 0);
  expect(await deckPosition(page)).toBe(0);
  await page.keyboard.press('Escape');
  await page.locator('.deck-scroller').dispatchEvent('wheel', { deltaX: 100, ctrlKey: true });
  expect(await deckPosition(page)).toBe(0);
});

async function holdMotion(page: Page) {
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    const motions: Animation[] = [];
    Object.assign(window, { testMotions: motions });
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      if (this.matches('.conversation-morph, .deck-conversation') || this.closest('.conversation-morph')) {
        animation.pause();
        animation.currentTime = 0;
        motions.push(animation);
      }
      return animation;
    };
  });
}
async function seek(page: Page, time: number) {
  await page.evaluate((time) => {
    const motions = (window as unknown as { testMotions: Animation[] }).testMotions;
    motions.forEach((animation) => (animation.currentTime = time));
  }, time);
}
async function finish(page: Page) {
  await page.evaluate(() => {
    const motions = (window as unknown as { testMotions: Animation[] }).testMotions;
    motions.forEach((animation) => animation.finish());
    motions.length = 0;
  });
}

test('返回画报时列表、来源和叠放文件同步渐出，完成后才移除视窗', async ({ page }) => {
  await page.goto('/#/briefing');
  const original = page.locator('[data-card-id="deliverable:proposal"]');
  await original.locator('.briefing-card-main').click();
  await expect(page.locator('.conversation-overlay')).toHaveAttribute('data-phase', 'open');
  const proposal = page.locator('[data-deck-id="proposal"]');
  await proposal.getByRole('button', { name: '资料信息与来源', exact: true }).click();
  await proposal.getByRole('tab', { name: '关联资料', exact: true }).click();
  await proposal.getByRole('button', { name: /服务价格表/ }).click();
  await expect(page.locator('[data-deck-id="proposal"]')).toHaveAttribute('data-folded', 'true');
  // Hold the actual exit frames, so the midpoint proves cards are fading rather
  // than simply waiting for a timer and disappearing together.
  await page.evaluate(() => {
    const animate = Element.prototype.animate;
    const motions: Animation[] = [];
    Object.assign(window, { testMotions: motions });
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      if (this.closest('.conversation-overlay')) {
        animation.pause();
        animation.currentTime = 0;
        motions.push(animation);
      }
      return animation;
    };
  });
  await page.getByRole('button', { name: '关闭会话', exact: true }).click();
  const companions = page.locator('.deck-list, .deck-source, .deck-file, .deck-toolbar');
  expect(await companions.count()).toBe(5);
  expect(
    await companions.evaluateAll((cards) => cards.map((card) => getComputedStyle(card).opacity)),
  ).toEqual(['1', '1', '1', '1', '1']);
  const closeDuration = await page.evaluate(() =>
    Math.max(
      ...(window as unknown as { testMotions: Animation[] }).testMotions.map((animation) =>
        Number(animation.effect!.getTiming().duration),
      ),
    ),
  );
  expect(closeDuration).toBeGreaterThan(200);
  expect(closeDuration).toBeLessThan(330);
  await seek(page, closeDuration / 2);
  for (const opacity of await companions.evaluateAll((cards) =>
    cards.map((card) => Number(getComputedStyle(card).opacity)),
  )) {
    expect(opacity).toBeGreaterThan(0.05);
    expect(opacity).toBeLessThan(0.9);
  }
  await expect(page.locator('.conversation-overlay')).toHaveAttribute('data-phase', 'closing');
  await finish(page);
  await expect(page.locator('.conversation-overlay')).toHaveCount(0);
  await expect(original).toBeVisible();
  await expect(original).not.toHaveClass(/conversation-origin-active/);
});

for (const id of ['finance:demo-receipts', 'followup:personal', 'deliverable:proposal', 'news:direction']) {
  test(`卡片过渡保留原始内容、与消息内引用对齐并在关闭时回到原位：${id}`, async ({ page }) => {
    await holdMotion(page);
    await page.goto('/#/briefing');
    const original = page.locator(`[data-card-id="${id}"]`);
    await original.scrollIntoViewIfNeeded();
    const before = (await original.locator('h3').boundingBox())!;
    await original.locator('.briefing-card-main').click();
    const surface = page.locator('.conversation-morph');
    const first = (await surface.locator('h3').boundingBox())!;
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(first[key]).toBeCloseTo(before[key], 0);
    await seek(page, 160);
    await expect(surface).toHaveCSS('opacity', '1');
    await expect(page.locator('.deck-conversation')).toHaveCSS('opacity', '0');
    await seek(page, 375);
    const reference = page.locator('[data-current-origin]');
    for (const selector of [
      'h3',
      '.briefing-fact, .briefing-evidence',
      '.briefing-advice, .briefing-takeaway, .briefing-primary-advice',
      '.briefing-source',
    ]) {
      const count = await reference.locator(selector).count();
      expect(await surface.locator(selector).count()).toBe(count);
      if (!count) continue;
      const frozen = await surface.locator(selector).boundingBox();
      const live = await reference.locator(selector).boundingBox();
      if (!live) continue;
      expect(frozen).not.toBeNull();
      for (const key of ['x', 'y', 'width', 'height'] as const)
        expect(frozen![key]).toBeCloseTo(live[key], 0);
    }
    await finish(page);
    await expect(page.locator('.conversation-overlay')).toHaveAttribute('data-phase', 'open');
    await expect(surface).toBeHidden();
    await expect(page.locator('.deck-conversation')).toHaveCSS('opacity', '1');
    await page.getByRole('button', { name: '关闭会话', exact: true }).click();
    await seek(page, 279.99);
    const closing = (await surface.locator('h3').boundingBox())!;
    for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(closing[key]).toBeCloseTo(before[key], 0);
    await finish(page);
    await expect(page.locator('.conversation-overlay')).toHaveCount(0);
    await expect(original).toBeVisible();
    await expect(page.locator('.briefing-footer')).toHaveCount(0);
  });
}
