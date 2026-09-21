import { test, expect, type Page } from '@playwright/test';

const active = (page: Page) => page.getByRole('tab', { selected: true });
const settled = (page: Page) => expect(page.locator('html')).not.toHaveAttribute('data-briefing-slide');
async function drag(page: Page, x: number, y: number, dx: number, dy = 0) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}

test('触控板按分栏顺序切换，一次惯性滚动只前进一栏，首尾不循环且纵向滚动不切栏', async ({ page }) => {
  await page.goto('/#/briefing');
  await page.mouse.move(900, 350);
  await page.mouse.wheel(0, 500);
  await expect.poll(() => page.locator('.page-main').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await expect(active(page)).toHaveText('最新');
  await page.mouse.wheel(100, 0);
  for (const delta of [70, 45, 25, 12, 5]) await page.mouse.wheel(delta, 0);
  await expect(active(page)).toHaveText('关注');
  await settled(page);
  await expect(page.locator('.page-main')).toHaveJSProperty('scrollTop', 0);
  await page.waitForTimeout(240); // A new gesture after the inertial burst has ended.
  await page.mouse.wheel(-100, 0);
  await expect(active(page)).toHaveText('最新');
  await settled(page);
  await page.waitForTimeout(240);
  await page.mouse.wheel(-100, 0);
  await expect(active(page)).toHaveText('最新');
  await page.getByRole('tab', { name: '空间', exact: true }).click();
  await settled(page);
  await page.mouse.wheel(100, 0);
  await expect(active(page)).toHaveText('空间');
});

test('从空白处拖动切栏不会打开会话，空分栏可滑回，短拖动与输入区保留原操作', async ({ page }) => {
  await page.goto('/#/briefing');
  const box = (await page.locator('.briefing-date-divider').first().boundingBox())!;
  await drag(page, box.x + box.width / 2, box.y + box.height / 2, -170);
  await expect(active(page)).toHaveText('关注');
  await settled(page);
  await expect(page.locator('.conversation-overlay')).toHaveCount(0);
  await expect(page.getByText('把关心的变化留在这里')).toBeVisible();
  await drag(page, 350, 160, 180);
  await expect(active(page)).toHaveText('最新');
  await settled(page);
  await drag(page, 800, 95, -30);
  await expect(active(page)).toHaveText('最新');
  await page.getByRole('tab', { name: '空间', exact: true }).click();
  await settled(page);
  await page.getByLabel('画报工作空间').selectOption('finance');
  await page.getByLabel('画报工作空间').dispatchEvent('wheel', { deltaX: -160 });
  await expect(active(page)).toHaveText('空间');
  await page.mouse.move(900, 350);
  await page.mouse.wheel(-100, 0);
  await expect(active(page)).toHaveText('类型');
  await settled(page);
  await page.getByRole('tab', { name: '空间', exact: true }).click();
  await expect(page.getByLabel('画报工作空间')).toHaveValue('finance');
});

test('画报内容双向滑入滑出，标题和悬浮输入保持原位，快速切栏与离开可结束动画', async ({ page }) => {
  await page.goto('/#/briefing');
  const header = await page.locator('.briefing-topbar').boundingBox();
  const composer = await page.locator('.briefing-compose-dock').boundingBox();
  await page.getByRole('tab', { name: '类型', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .getAnimations()
            .filter((a) => a instanceof CSSAnimation && a.animationName.startsWith('briefing-slide')).length,
      ),
    )
    .toBe(2);
  const offsets = await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      if (animation instanceof CSSAnimation && animation.animationName.startsWith('briefing-slide')) {
        animation.pause();
        animation.currentTime = 160;
      }
    }
    return ['old', 'new'].map(
      (kind) =>
        new DOMMatrix(
          getComputedStyle(document.documentElement, `::view-transition-${kind}(briefing-content)`).transform,
        ).m41,
    );
  });
  expect(offsets[0]).toBeLessThan(0);
  expect(offsets[1]).toBeGreaterThan(0);
  expect(await page.locator('.briefing-topbar').boundingBox()).toEqual(header);
  expect(await page.locator('.briefing-compose-dock').boundingBox()).toEqual(composer);
  await page.evaluate(() => document.getAnimations().forEach((a) => a.play()));
  await settled(page);
  await page.getByRole('tab', { name: '关注', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-briefing-slide', 'previous');
  await page.getByRole('tab', { name: '日期', exact: true }).click();
  await page.getByRole('tab', { name: '空间', exact: true }).click();
  await expect(active(page)).toHaveText('空间');
  await page.getByRole('navigation').getByRole('button', { name: '资料库', exact: true }).click();
  await settled(page);
  await expect(page.getByRole('heading', { name: '资料库', exact: true })).toBeVisible();
});

test('减少动态效果直接切换，缺少快照过渡支持时仍可滑动切栏，浮层内手势不改画报分栏', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/briefing');
  await page.mouse.move(900, 350);
  await page.mouse.wheel(100, 0);
  await expect(active(page)).toHaveText('关注');
  await settled(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => Object.defineProperty(document, 'startViewTransition', { value: undefined }));
  await page.getByRole('tab', { name: '最新', exact: true }).click();
  await expect(active(page)).toHaveText('最新');
  await page.locator('[data-card-id="konggu:C01"] .briefing-card-main').click();
  await expect(page.locator('.conversation-overlay')).toHaveAttribute('data-phase', 'open');
  await page.mouse.move(900, 350);
  await page.mouse.wheel(150, 0);
  await page.getByRole('button', { name: '关闭会话', exact: true }).click();
  await expect(active(page)).toHaveText('最新');
  await settled(page);
});

test.describe('手机触控', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('真实横向触摸切栏，纵向触摸滚动、取消及多指手势不会切栏或误开卡片', async ({ page }) => {
    await page.goto('/#/briefing');
    const cdp = await page.context().newCDPSession(page);
    const touch = async (from: { x: number; y: number }, to: { x: number; y: number }, cancel = false) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
      for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 }],
        });
      }
      await cdp.send('Input.dispatchTouchEvent', {
        type: cancel ? 'touchCancel' : 'touchEnd',
        touchPoints: [],
      });
    };
    await touch({ x: 320, y: 240 }, { x: 70, y: 240 });
    await expect(active(page)).toHaveText('关注');
    await settled(page);
    await expect(page.locator('.conversation-overlay')).toHaveCount(0);
    await touch({ x: 50, y: 150 }, { x: 290, y: 150 }, true);
    await expect(active(page)).toHaveText('关注');
    await touch({ x: 50, y: 150 }, { x: 290, y: 150 });
    await expect(active(page)).toHaveText('最新');
    await settled(page);
    await touch({ x: 200, y: 600 }, { x: 200, y: 240 });
    await expect.poll(() => page.locator('.page-main').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect(active(page)).toHaveText('最新');
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: 260, y: 240 },
        { x: 290, y: 300 },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: 80, y: 240 },
        { x: 110, y: 300 },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(active(page)).toHaveText('最新');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
