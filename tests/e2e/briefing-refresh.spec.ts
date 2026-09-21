import { test, expect, type Page } from '@playwright/test';
const key = 'enterprise-ai-demo-konggu-v1';
const root = (page: Page) => page.locator('.briefing-page');
const state = (page: Page) => page.evaluate((key) => localStorage.getItem(key), key);
const idle = (page: Page) => expect(root(page)).toHaveAttribute('data-refresh-phase', 'idle');
async function trackArrival(page: Page) {
  await page.addInitScript(() => {
    (window as any).arrivalLog = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      if (this.matches('.briefing-card') && Array.isArray(keyframes) && keyframes[0]?.translate) {
        (window as any).arrivalLog.push({
          id: this.getAttribute('data-card-id'),
          row: this.getBoundingClientRect().top,
          col: this.getBoundingClientRect().left,
          options,
          keyframes,
        });
      }
      return animate.call(this, keyframes, options);
    };
  });
}
async function pullMouse(page: Page, distance: number, release = true) {
  await expect(page.locator('.briefing-refresh-space')).toHaveCSS('height', '0px');
  await expect(page.locator('main')).toHaveJSProperty('scrollTop', 0);
  const divider = page.locator('.briefing-date-divider').first();
  await divider.hover();
  const box = (await divider.boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + distance, { steps: 8 });
  if (release) await page.mouse.up();
}

test('刷新页面可见卡片按实际网格顺序轻微错峰入场，之后正常呈现', async ({ page }) => {
  await trackArrival(page);
  await page.goto('/#/briefing');
  await expect.poll(() => page.evaluate(() => (window as any).arrivalLog.length)).toBeGreaterThan(2);
  const entries = await page.evaluate(() => (window as any).arrivalLog);
  expect(new Set(entries.map((entry: any) => entry.id)).size).toBe(entries.length);
  expect(entries.map((entry: any) => [Number(entry.row), Number(entry.col)])).toEqual(
    entries
      .map((entry: any) => [Number(entry.row), Number(entry.col)])
      .sort((a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1]),
  );
  expect(entries.map((entry: any) => entry.options.delay)).toEqual(
    entries.map((_: any, i: number) => Math.min(i * 46, 460)),
  );
  expect(
    entries.every(
      (entry: any) =>
        entry.options.duration === 380 &&
        entry.keyframes[0].translate === '0 12px' &&
        entry.keyframes[1].opacity === 1,
    ),
  ).toBe(true);
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      if ((animation.effect as KeyframeEffect)?.getKeyframes().some((frame) => frame.translate)) {
        animation.pause();
        animation.currentTime = 220;
      }
    }
  });
  await page.screenshot({ path: '.local/briefing-refresh/arrival.png' });
  await page.evaluate(() => document.getAnimations().forEach((animation) => animation.play()));
  await expect
    .poll(() =>
      page
        .locator('.briefing-grid .briefing-card')
        .evaluateAll((els) => els.every((el) => getComputedStyle(el).opacity === '1')),
    )
    .toBe(true);
  await expect(root(page)).not.toHaveAttribute('data-briefing-arriving');
  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).arrivalLog.length)).toBeGreaterThan(2);
});

test('鼠标下拉阈值、取消、刷新反馈和再次入场完整，保留手动位置及所有数据', async ({ page }) => {
  await trackArrival(page);
  await page.goto('/#/briefing');
  const card = page.locator('[data-card-id="konggu:C01"]');
  await card.hover();
  await card.getByRole('button', { name: /^卡片操作 / }).click();
  await card.getByRole('button', { name: '用方向键调整位置', exact: true }).click();
  await expect(card).toHaveClass(/is-keyboard-moving/);
  await card.locator('.briefing-card-main').press('ArrowDown');
  await card.locator('.briefing-card-main').press('Enter');
  await page.locator('main').evaluate((el) => el.scrollTo({ top: 0, behavior: 'instant' }));
  const before = await state(page);
  const positions = () =>
    page
      .locator('.briefing-grid [data-card-id]')
      .evaluateAll((els) =>
        els.map((e) => [e.getAttribute('data-card-id'), (e as HTMLElement).style.gridArea]),
      );
  const layout = await positions();
  await pullMouse(page, 45);
  await idle(page);
  await expect(page).toHaveURL(/#\/briefing$/);
  await pullMouse(page, 190, false);
  await expect(root(page)).toHaveAttribute('data-refresh-phase', 'ready');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await idle(page);
  expect(await state(page)).toBe(before);
  const arrivalsBefore = await page.evaluate(() => (window as any).arrivalLog.length);
  await pullMouse(page, 190, false);
  await expect(root(page)).toHaveAttribute('data-refresh-phase', 'ready');
  await page.screenshot({ path: '.local/briefing-refresh/desktop-ready.png' });
  await page.mouse.up();
  await expect(root(page)).toHaveAttribute('data-refresh-phase', 'refreshing');
  await expect(page.locator('.briefing-refresh-indicator')).toContainText('演示');
  await expect(page.getByRole('button', { name: '刷新智能画报（演示）', exact: true })).toBeDisabled();
  await expect(page.locator('.briefing-compose-dock')).toBeHidden();
  await idle(page);
  await expect
    .poll(() => page.evaluate(() => (window as any).arrivalLog.length))
    .toBeGreaterThan(arrivalsBefore);
  expect(await positions()).toEqual(layout);
  expect(await state(page)).toBe(before);
  await expect(page).toHaveURL(/#\/briefing$/);
});

test('触控板顶部刷新一次，途中滚到顶部及剩余惯性不误刷新，横滑仍可切栏', async ({ page }) => {
  await page.goto('/#/briefing');
  await page.mouse.move(850, 260);
  await page.mouse.wheel(0, 550);
  await expect.poll(() => page.locator('main').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await page.waitForTimeout(280);
  await page.mouse.wheel(0, -1200);
  await expect(page.locator('main')).toHaveJSProperty('scrollTop', 0);
  await page.mouse.wheel(0, -60);
  await page.waitForTimeout(230);
  await idle(page);
  await page.evaluate(() => {
    (window as any).refreshPhases = [];
    new MutationObserver(() =>
      (window as any).refreshPhases.push(
        document.querySelector('.briefing-page')?.getAttribute('data-refresh-phase'),
      ),
    ).observe(document.querySelector('.briefing-page')!, {
      attributes: true,
      attributeFilter: ['data-refresh-phase'],
    });
  });
  await page.waitForTimeout(280);
  await page.mouse.wheel(0, -210);
  await expect(root(page)).toHaveAttribute('data-refresh-phase', 'refreshing');
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(0, -20);
    await page.waitForTimeout(95);
  }
  await idle(page);
  await page.mouse.wheel(0, -30);
  await page.waitForTimeout(250);
  await idle(page);
  expect(
    await page.evaluate(
      () => (window as any).refreshPhases.filter((phase: string) => phase === 'refreshing').length,
    ),
  ).toBe(1);
  await page.mouse.wheel(160, 0);
  await expect(page.getByRole('tab', { name: '关注', exact: true })).toHaveAttribute('aria-selected', 'true');
  await idle(page);
});

test('触屏顶部下拉、回退与取消不误开会话，正常上滑仍滚动', async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto('/#/briefing');
  const before = await state(page);
  const client = await context.newCDPSession(page);
  const start = () =>
    client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 170, y: 240 }] });
  const move = (y: number) =>
    client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 170, y }] });
  const end = (cancel = false) =>
    client.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
  await start();
  await move(430);
  await expect(root(page)).toHaveAttribute('data-refresh-phase', 'ready');
  await end(true);
  await idle(page);
  expect(await state(page)).toBe(before);
  await start();
  await move(430);
  await move(270);
  await end();
  await idle(page);
  await start();
  await move(430);
  await expect(root(page)).toHaveAttribute('data-refresh-phase', 'ready');
  await page.screenshot({ path: '.local/briefing-refresh/touch-ready.png' });
  await end();
  await expect(root(page)).toHaveAttribute('data-refresh-phase', 'refreshing');
  await idle(page);
  expect(await state(page)).toBe(before);
  await expect(page).toHaveURL(/#\/briefing$/);
  await start();
  await move(140);
  await end();
  await expect.poll(() => page.locator('main').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await idle(page);
  await context.close();
});

test('减少动态效果跳过入场动画，键盘刷新可用，离开页面取消尚未完成的演示', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await trackArrival(page);
  await page.goto('/#/briefing');
  const before = await state(page);
  const button = page.getByRole('button', { name: '刷新智能画报（演示）', exact: true });
  await button.click();
  await expect(root(page)).toHaveAttribute('data-refresh-phase', 'refreshing');
  await page.keyboard.press('Escape');
  await idle(page);
  await expect(page.getByRole('status').filter({ hasText: '正在演示刷新智能画报' })).toHaveCount(0);
  await button.focus();
  await button.press('Enter');
  await expect(root(page)).toHaveAttribute('data-refresh-phase', 'refreshing');
  await idle(page);
  expect(await page.evaluate(() => (window as any).arrivalLog)).toEqual([]);
  expect(await state(page)).toBe(before);
  await button.click();
  await expect(root(page)).toHaveAttribute('data-refresh-phase', 'refreshing');
  await page.getByRole('navigation').getByRole('button', { name: '资料库', exact: true }).click();
  await expect(root(page)).toHaveCount(0);
  await page.waitForTimeout(1100);
  await expect(page.locator('.briefing-refresh-indicator')).toHaveCount(0);
  expect(await state(page)).toBe(before);
});
