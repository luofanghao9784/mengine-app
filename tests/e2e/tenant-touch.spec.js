import { test, devices, expect } from '@playwright/test';
import assert from 'node:assert/strict';

test.use({ ...devices['iPad Pro 11'], defaultBrowserType: 'chromium' });
test('tenant sheet touch routing preserves native scrolling, pinch and desktop wheel', async ({
  page,
  browser,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Real touch streams use Chromium CDP; WebKit checked separately.');
  test.setTimeout(90000);
  const p = page,
    results = [],
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 401, json: { message: 'Synthetic unauthenticated test' } }),
  );
  await page.route('**/mengine-api/**', (route) =>
    route.fulfill({ status: 503, json: { message: 'Synthetic unavailable source' } }),
  );
  await page.goto('/tenant-admin/prototype/', { waitUntil: 'networkidle' });
  const c = await p.context().newCDPSession(p);
  const sheet = () => p.locator('.shell').getAttribute('data-sheet');
  async function swipe(x, y, dx, dy) {
    await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) {
      await c.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + (dx * i) / 8, y: y + (dy * i) / 8 }],
      });
      await p.waitForTimeout(25);
    }
    await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(400);
  }
  async function navSwipe(dy, dx = 0) {
    const r = await p.locator('.shell-switch').boundingBox();
    await swipe(r.x + 100, r.y + r.height / 2, dx, dy);
  }
  assert.equal(await sheet(), 'half');
  const initialTop = await p.locator('.shell').evaluate(e => parseFloat(e.style.getPropertyValue('--deck-top')));
  const start = await p.locator('.shell-switch').boundingBox();
  const x = start.x + 100, y = start.y + start.height / 2;
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (const distance of [100, 160, 120]) {
    await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - distance }] });
    await p.waitForTimeout(400);
    assert.equal(await sheet(), 'moving', 'held finger never snaps on idle');
    const top = await p.locator('.shell').evaluate(e => parseFloat(e.style.getPropertyValue('--deck-top')));
    assert.ok(Math.abs(top - (initialTop - distance)) < 2, `follows finger: ${top}`);
  }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(400);
  assert.equal(await sheet(), 'half', 'short drag releases to nearest stop');
  results.push('continuous 1:1 movement, pause, reversal and release snap');
  await navSwipe(-450);
  assert.equal(await sheet(), 'peek');
  results.push('single finger up: half -> peek');
  await navSwipe(450);
  assert.equal(await sheet(), 'half');
  results.push('single finger down: peek -> half');
  await navSwipe(0, 180);
  assert.equal(await sheet(), 'half');
  results.push('horizontal swipe leaves sheet unchanged');
  await p.evaluate(() => {
    const s = document.createElement('div');
    s.id = 'touch-test-list';
    s.className = 'card-scroll';
    s.style.cssText =
      'position:fixed;left:40px;top:820px;width:650px;height:220px;z-index:9999;overflow-y:auto;background:#222';
    s.innerHTML = '<div style="height:1800px">Synthetic touch scroll fixture</div>';
    document.querySelector('.deck').append(s);
  });
  await swipe(300, 990, 0, -120);
  const scroll = await p.locator('#touch-test-list').evaluate((e) => e.scrollTop);
  assert.ok(scroll > 30, `native scroll ${scroll}`);
  assert.equal(await sheet(), 'half');
  results.push('native list scroll advances content without moving sheet');
  await p.locator('#touch-test-list').evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  await p.waitForTimeout(400);
  await swipe(300, 990, 0, -450);
  assert.equal(await sheet(), 'peek');
  results.push('NEW gesture at list bottom raises sheet');
  await p.locator('#touch-test-list').evaluate((e) => e.remove());
  await navSwipe(450);
  assert.equal(await sheet(), 'half');
  const r = await p.locator('.shell-switch').boundingBox();
  await c.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: r.x + 80, y: r.y + 20 },
      { x: r.x + 160, y: r.y + 20 },
    ],
  });
  await c.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: r.x + 60, y: r.y - 90 },
      { x: r.x + 180, y: r.y - 90 },
    ],
  });
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(400);
  assert.equal(await sheet(), 'half');
  results.push('two-finger gesture does not move sheet');
  const desktop = await browser.newPage({
    viewport: { width: 834, height: 1194 },
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 1,
  });
  await desktop.route('**/api/**', (route) => route.fulfill({ status: 401, json: {} }));
  await desktop.route('**/mengine-api/**', (route) => route.fulfill({ status: 503, json: {} }));
  await desktop.goto(new URL('/tenant-admin/prototype/', page.url()).href, { waitUntil: 'networkidle' });
  await desktop.bringToFront();
  await expect(desktop.locator('.shell')).toHaveAttribute('data-sheet', 'half');
  const desktopNav = await desktop.locator('.shell-switch').boundingBox();
  assert.ok(desktopNav);
  await desktop.mouse.move(desktopNav.x + desktopNav.width / 2, desktopNav.y + desktopNav.height / 2);
  await desktop.mouse.wheel(0, 500);
  await expect(desktop.locator('.shell')).toHaveAttribute('data-sheet', 'peek');
  await desktop.close();
  results.push('desktop wheel retained');
  assert.deepEqual(errors, []);
});
