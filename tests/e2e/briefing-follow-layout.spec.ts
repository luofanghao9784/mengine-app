import { test, expect, type Page, type Locator } from '@playwright/test';

const key = 'enterprise-ai-demo-konggu-v1';
const state = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
const card = (page: Page, id: string) => page.locator(`.briefing-grid [data-card-id="${id}"]`);
const position = (card: Locator) =>
  card.evaluate((el) => ({
    row: (el as HTMLElement).style.gridRowStart,
    col: (el as HTMLElement).style.gridColumnStart,
    size: (el as HTMLElement).dataset.size,
  }));
const settled = (page: Page) =>
  expect
    .poll(() =>
      page
        .locator('.briefing-grid > *')
        .evaluateAll(
          (els) => els.flatMap((el) => el.getAnimations()).filter((a) => a.playState === 'running').length,
        ),
    )
    .toBe(0);
const follow = async (page: Page) => {
  await page.getByRole('tab', { name: '关注', exact: true }).click();
  await expect(page.locator('.briefing-page')).toHaveClass(/can-arrange/);
  await expect(page.locator('html')).not.toHaveAttribute('data-briefing-slide');
  await settled(page);
};
const prefs = async (page: Page) => {
  const s = await state(page);
  return s.briefing.followLayouts?.[s.profile.name];
};

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/#/briefing');
  await expect(page.locator('.briefing-card').first()).toBeVisible();
  // Isolated browser fixture: follow several existing source types, no altered facts.
  await page.evaluate((key) => {
    const s = JSON.parse(localStorage.getItem(key)!);
    for (const c of s.briefing.cards)
      c.pinned = ['C01', 'C02', 'C03', 'C04', 'C13', 'C14', 'C20', 'C23'].some(
        (id) => c.id === `konggu:${id}`,
      );
    localStorage.setItem(key, JSON.stringify(s));
  }, key);
  await page.reload();
  await settled(page);
});

test('推荐不开放调整，关注跨类型自由拖动；松手保存、刷新恢复且推荐布局独立', async ({ page }) => {
  const before = await state(page);
  const recommendation = await page
    .locator('.briefing-grid .briefing-card')
    .evaluateAll((els) =>
      els.map((el) => [el.getAttribute('data-card-id'), (el as HTMLElement).style.cssText]),
    );
  await expect(page.locator('.briefing-resize-handle')).toHaveCount(0);
  const first = page.locator('.briefing-card-main').first();
  await expect(first).toHaveCSS('cursor', 'pointer');
  const b = (await first.boundingBox())!;
  await page.mouse.move(b.x + 60, b.y + 70);
  await page.mouse.down();
  await page.mouse.move(b.x + 160, b.y + 140, { steps: 6 });
  await expect(page.locator('.briefing-page')).not.toHaveClass(/is-moving/);
  await page.mouse.move(12, 500);
  await page.mouse.up();
  expect(await prefs(page)).toBeUndefined();
  await follow(page);
  await expect(page.locator('.briefing-grid')).toHaveCount(1);
  await expect(page.locator('.briefing-resize-handle')).toHaveCount(8);
  await expect(page.getByRole('button', { name: /^卡片操作|^固定到关注/ })).toHaveCount(0);
  const moving = page.locator('.briefing-grid [data-size="1×1"]').first();
  const id = (await moving.getAttribute('data-card-id'))!;
  const original = await position(moving);
  await moving.scrollIntoViewIfNeeded();
  const bounds = (await moving.boundingBox())!;
  const unit = await page
    .locator('.briefing-page')
    .evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--briefing-unit')) + 10);
  await page.mouse.move(bounds.x + 50, bounds.y + 70);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 50, bounds.y + 70 - unit, { steps: 8 });
  await expect(page.locator('.briefing-page')).toHaveClass(/is-moving/);
  expect(await prefs(page)).toBeUndefined();
  await page.mouse.up();
  await settled(page);
  const moved = await position(card(page, id));
  expect(moved).not.toEqual(original);
  await expect(page.locator('dialog.briefing-detail')).toHaveCount(0);
  expect((await state(page)).briefing.cards).toEqual(before.briefing.cards);
  await page.reload();
  await follow(page);
  expect(await position(card(page, id))).toEqual(moved);
  await page.getByRole('tab', { name: '推荐', exact: true }).click();
  await expect(page.locator('.briefing-resize-handle')).toHaveCount(0);
  expect(
    await page
      .locator('.briefing-grid .briefing-card')
      .evaluateAll((els) =>
        els.map((el) => [el.getAttribute('data-card-id'), (el as HTMLElement).style.cssText]),
      ),
  ).toEqual(recommendation);
  await follow(page);
  await page.getByRole('button', { name: '恢复自动排列', exact: true }).click();
  await settled(page);
  expect(await prefs(page)).toBeUndefined();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await settled(page);
  expect(await position(card(page, id))).toEqual(moved);
});

test('关注缩放可取消与撤销，尺寸仅保存至关注，窄屏投影不覆盖宽屏偏好', async ({ page }) => {
  await follow(page);
  const before = await state(page);
  const id = (await page.locator('.briefing-grid [data-size="1×1"]').first().getAttribute('data-card-id'))!;
  const resizing = card(page, id);
  const original = await position(resizing);
  await resizing.scrollIntoViewIfNeeded();
  await resizing.hover();
  const h = (await resizing.locator('.briefing-resize-handle').boundingBox())!;
  const unit = await page
    .locator('.briefing-page')
    .evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--briefing-unit')) + 10);
  await page.mouse.move(h.x + h.width - 7, h.y + h.height - 7);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width - 7, h.y + h.height - 7 + unit * 0.8, { steps: 8 });
  await expect(resizing).toHaveAttribute('data-size', '1×2');
  expect(await prefs(page)).toBeUndefined();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await settled(page);
  expect(await position(resizing)).toEqual(original);
  // Keyboard reaches the same resize controls; width then height are explicit choices.
  await resizing.locator('.briefing-resize-handle').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await settled(page);
  const sized = await position(resizing);
  expect(sized.size).toBe('2×2');
  expect((await prefs(page)).sizes[id]).toBe('2×2');
  const saved = await prefs(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(resizing).toHaveAttribute('data-size', '1×2');
  expect(await prefs(page)).toEqual(saved);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(resizing).toHaveAttribute('data-size', '2×2');
  expect(await position(resizing)).toEqual(sized);
  await page.reload();
  await follow(page);
  expect(await position(card(page, id))).toEqual(sized);
  expect((await state(page)).briefing.cards).toEqual(before.briefing.cards);
  expect((await state(page)).chats).toEqual(before.chats);
  await page.getByRole('tab', { name: '日期', exact: true }).click();
  await expect(page.locator('.briefing-resize-handle')).toHaveCount(0);
  await follow(page);
  await card(page, id).locator('.briefing-resize-handle').focus();
  await page.keyboard.press('ArrowUp');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await settled(page);
  expect(await position(card(page, id))).toEqual(sized);
  await page.screenshot({ path: '.local/follow-layout/desktop.png' });
});

test('键盘拿起和取消不误开详情，提交后普通点击仍进入原卡详情', async ({ page }) => {
  await follow(page);
  const c = page.locator('.briefing-grid .briefing-card').first();
  const id = (await c.getAttribute('data-card-id'))!;
  const surface = card(page, id).locator('.briefing-card-main');
  const original = await position(card(page, id));
  await surface.focus();
  await page.keyboard.press('Alt+Enter');
  await page.keyboard.press('ArrowDown');
  await expect(card(page, id)).toHaveClass(/is-keyboard-moving/);
  await page.keyboard.press('Escape');
  await settled(page);
  expect(await position(card(page, id))).toEqual(original);
  expect(await prefs(page)).toBeUndefined();
  await surface.focus();
  await page.keyboard.press('Alt+Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await settled(page);
  expect(await position(card(page, id))).not.toEqual(original);
  await expect(page.locator('dialog.briefing-detail')).toHaveCount(0);
  await surface.click();
  await expect(page.locator('dialog.briefing-detail')).toBeVisible();
});

test('触屏仅关注可长按整理，取消尺寸保留布局', async ({ page, browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
  const touch = await context.newPage();
  const fixture = await state(page);
  await touch.goto('/#/briefing');
  await touch.evaluate(({ key, fixture }) => localStorage.setItem(key, JSON.stringify(fixture)), {
    key,
    fixture,
  });
  await touch.reload();
  const client = await context.newCDPSession(touch);
  const hold = async () => {
    const c = touch.locator('.briefing-card-main').first();
    await c.scrollIntoViewIfNeeded();
    await touch.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    const b = (await c.boundingBox())!;
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: b.x + 60, y: b.y + 90 }],
    });
  };
  await hold();
  await touch.waitForTimeout(650);
  await expect(touch.locator('.briefing-page')).not.toHaveClass(/is-editing|is-moving/);
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await follow(touch);
  await hold();
  await expect(touch.getByRole('button', { name: '完成', exact: true })).toBeVisible();
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(touch.locator('dialog.briefing-detail')).toHaveCount(0);
  const touchId = (await touch
    .locator('.briefing-grid [data-size="1×1"]')
    .first()
    .getAttribute('data-card-id'))!;
  const c = card(touch, touchId);
  const original = await position(c);
  await c.scrollIntoViewIfNeeded();
  await settled(touch);
  const h = (await c.locator('.briefing-resize-handle').boundingBox())!;
  const x = h.x + h.width - 8,
    y = h.y + h.height - 8;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x, y: Math.min(810, y + 240) }],
  });
  await expect(c).toHaveAttribute('data-size', '1×2');
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await settled(touch);
  expect(await position(c)).toEqual(original);
  expect(await prefs(touch)).toBeUndefined();
  await touch.getByRole('button', { name: '完成', exact: true }).tap();
  await expect(touch.locator('.briefing-page')).not.toHaveClass(/is-editing/);
  await context.close();
});
