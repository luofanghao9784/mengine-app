import { test, expect, type Page, type Locator } from '@playwright/test';
const key = 'enterprise-ai-demo-konggu-v1';
const card = (p: Page, id: string) => p.locator(`.briefing-grid [data-card-id="${id}"]`);
const state = (p: Page) => p.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
const position = (c: Locator) =>
  c.evaluate((el: HTMLElement) => ({
    row: el.style.gridRow,
    col: el.style.gridColumn,
    size: el.dataset.size,
  }));
const layout = (p: Page) =>
  p.locator('.briefing-grid .briefing-card').evaluateAll((els) =>
    els.map((el) => ({
      id: el.getAttribute('data-card-id'),
      row: (el as HTMLElement).style.gridRow,
      col: (el as HTMLElement).style.gridColumn,
      size: el.getAttribute('data-size'),
    })),
  );
const settled = (p: Page) =>
  expect
    .poll(() =>
      p
        .locator('.briefing-grid > *')
        .evaluateAll(
          (els) => els.flatMap((el) => el.getAnimations()).filter((a) => a.playState === 'running').length,
        ),
    )
    .toBe(0);
async function begin(page: Page, id = 'konggu:C01') {
  const c = card(page, id);
  await c.scrollIntoViewIfNeeded();
  await settled(page);
  const h = c.locator('.briefing-card-main');
  await h.hover();
  const b = (await h.boundingBox())!;
  const pitch = await page
    .locator('.briefing-page')
    .evaluate((e) => parseFloat(getComputedStyle(e).getPropertyValue('--briefing-unit')) + 10);
  const x = b.x + b.width / 2,
    y = b.y + Math.min(b.height / 2, 90);
  await page.mouse.move(x, y);
  await page.mouse.down();
  return { x, y, pitch, c };
}
async function keyboardMove(page: Page, id: string, direction: string) {
  const c = card(page, id);
  await c.hover();
  await c.getByRole('button', { name: /^卡片操作 / }).click();
  await c.getByRole('button', { name: '用方向键调整位置', exact: true }).click();
  const surface = c.locator('.briefing-card-main');
  await expect(c).toHaveClass(/is-keyboard-moving/);
  await surface.press(direction);
  await settled(page);
  await expect(surface).toBeFocused();
  await surface.press('Enter');
  await settled(page);
}
async function valid(page: Page) {
  expect(
    await page.locator('.briefing-grid').evaluateAll((grids) =>
      grids.every((grid) => {
        const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
        const cells = new Set<string>();
        let prev = -1;
        return [...grid.querySelectorAll<HTMLElement>(':scope > .briefing-card')].every((el) => {
          const row = Number(el.style.gridRowStart) - 1,
            col = Number(el.style.gridColumnStart) - 1;
          const [w, h] = el.dataset.size!.split('×').map(Number);
          if (col + w > columns || row * columns + col <= prev) return false;
          prev = row * columns + col;
          for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
              const key = `${row + y}/${col + x}`;
              if (cells.has(key)) return false;
              cells.add(key);
            }
          return true;
        });
      }),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
test.beforeEach(async ({ page }) => {
  await page.goto('/#/briefing');
  await expect(card(page, 'konggu:C01')).toBeVisible();
});

test('直接拖动卡片，预览不写数据，Esc 恢复；落点保存、撤销与刷新正确', async ({ page }) => {
  const c = card(page, 'konggu:C01');
  await expect(page.locator('.briefing-move-handle')).toHaveCount(0);
  const before = await state(page),
    original = await layout(page);
  let p = await begin(page);
  await page.mouse.move(p.x - p.pitch, p.y + p.pitch, { steps: 8 });
  await expect(c).toHaveClass(/is-moving/);
  await expect(page.locator('.briefing-move-ghost')).toHaveCount(1);
  expect(await state(page)).toEqual(before);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await settled(page);
  expect(await layout(page)).toEqual(original);
  expect(await state(page)).toEqual(before);
  p = await begin(page);
  await page.mouse.move(p.x - p.pitch, p.y + p.pitch, { steps: 8 });
  await settled(page);
  const preview = await position(c);
  await page.screenshot({ path: '.local/briefing-direct-drag/desktop-drag.png' });
  await page.mouse.up();
  await settled(page);
  expect(await position(c)).toEqual(preview);
  const after = await state(page);
  expect(after.briefing.cards).toEqual(before.briefing.cards);
  expect(after.chats).toEqual(before.chats);
  expect(after.materials).toEqual(before.materials);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await settled(page);
  expect(await layout(page)).toEqual(original);
  p = await begin(page);
  await page.mouse.move(p.x - p.pitch, p.y + p.pitch, { steps: 8 });
  await page.mouse.up();
  await settled(page);
  const saved = await layout(page);
  await page.reload();
  await settled(page);
  expect(await layout(page)).toEqual(saved);
  await valid(page);
  await expect(page).toHaveURL(/#\/briefing$/);
});

test('桌面短按与轻微抖动仍打开会话，卡片横拖不会误切分类或刷新', async ({ page }) => {
  const before = await state(page);
  let p = await begin(page);
  await page.mouse.move(p.x + p.pitch, p.y, { steps: 8 });
  await expect(p.c).toHaveClass(/is-moving/);
  await expect(page.getByRole('tab', { selected: true })).toHaveText('最新');
  await expect(page.locator('.briefing-page')).toHaveAttribute('data-refresh-phase', 'idle');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await state(page)).toEqual(before);
  await page.waitForTimeout(550);
  p = await begin(page);
  await page.mouse.move(p.x + 2, p.y + 2);
  await expect(p.c).not.toHaveClass(/is-moving/);
  await page.mouse.up();
  await expect(page).toHaveURL(/#\/chat\//);
});

test('键盘连续移动、缩放保留落点，视图独立，窄屏适配后返回及刷新保留', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await keyboardMove(page, 'konggu:C01', 'ArrowDown');
  const first = await position(card(page, 'konggu:C01'));
  await keyboardMove(page, 'konggu:C02', 'ArrowDown');
  expect(await position(card(page, 'konggu:C01'))).toEqual(first);
  const c = card(page, 'konggu:C02'),
    beforeResize = await position(c);
  await c.locator('.briefing-resize-handle').focus();
  await page.keyboard.press('ArrowUp');
  const resized = await position(c);
  expect(resized.row.split(' / ')[0]).toBe(beforeResize.row.split(' / ')[0]);
  expect(resized.col).toBe(beforeResize.col);
  expect(resized.size).toBe('1×1');
  const latest = await layout(page);
  await page.getByRole('tab', { name: '类型', exact: true }).click();
  await keyboardMove(page, 'konggu:C01', 'ArrowDown');
  await page.getByRole('tab', { name: '最新', exact: true }).click();
  expect(await layout(page)).toEqual(latest);
  for (const width of [768, 390, 320, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(80);
    await valid(page);
  }
  expect(await layout(page)).toEqual(latest);
  await page.reload();
  await settled(page);
  expect(await layout(page)).toEqual(latest);
  await c.hover();
  await c.getByRole('button', { name: /^卡片操作 / }).click();
  await page.getByRole('button', { name: '恢复本组自动排列', exact: true }).click();
  expect(await layout(page)).not.toEqual(latest);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await layout(page)).toEqual(latest);
});

test('窗口变化、失焦和 pointercancel 取消拖移，跨组拖动仍留在当前组', async ({ page }) => {
  const before = await state(page);
  let p = await begin(page);
  await page.mouse.move(p.x, p.y + p.pitch);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.mouse.up();
  await expect(page.locator('.briefing-move-ghost')).toHaveCount(0);
  expect(await state(page)).toEqual(before);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await settled(page);
  p = await begin(page);
  await page.mouse.move(p.x, p.y + p.pitch);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.up();
  await expect(page.locator('.briefing-move-ghost')).toHaveCount(0);
  expect(await state(page)).toEqual(before);
  p = await begin(page);
  const group = await p.c.locator('xpath=..').getAttribute('data-group-id');
  await page.mouse.move(p.x, 4000);
  await page.mouse.up();
  await settled(page);
  expect(await p.c.locator('xpath=..').getAttribute('data-group-id')).toBe(group);
  await valid(page);
});

test('触屏同一次长按直接拖动，取消与保存正确，完成退出恢复阅读点击', async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto('/#/briefing');
  const c = card(page, 'konggu:C30');
  await c.waitFor();
  await c.scrollIntoViewIfNeeded();
  await settled(page);
  await expect(page.locator('.briefing-move-handle')).toHaveCount(0);
  await expect(c.locator('.briefing-resize-handle')).toHaveCSS('opacity', '0');
  const client = await context.newCDPSession(page);
  const before = await state(page);
  const hold = async () => {
    await c.scrollIntoViewIfNeeded();
    await settled(page);
    const box = (await c.boundingBox())!;
    const x = box.x + 70,
      y = box.y + 90;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await expect(c).toHaveClass(/is-moving/);
    await expect(page.getByRole('button', { name: '完成', exact: true })).toBeVisible();
    return { x, y };
  };
  let point = await hold();
  const doneBox = (await page.getByRole('button', { name: '完成', exact: true }).boundingBox())!;
  expect(doneBox.x).toBeGreaterThan(290);
  expect(doneBox.y).toBeLessThan(65);
  const originalScroll = await page.locator('main').evaluate((el) => el.scrollTop);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: point.x, y: point.y + 310 }],
  });
  await expect(c).toHaveClass(/is-moving/);
  expect(await page.locator('main').evaluate((el) => el.scrollTop)).toBe(originalScroll);
  expect(await state(page)).toEqual(before);
  await page.screenshot({ path: '.local/briefing-direct-drag/touch-drag.png' });
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(c).not.toHaveClass(/is-moving/);
  expect(await state(page)).toEqual(before);
  expect(
    await page
      .locator('.briefing-grid .briefing-card-tools, .briefing-grid .briefing-resize-handle')
      .evaluateAll((els) => els.every((el) => getComputedStyle(el).opacity === '1')),
  ).toBe(true);
  await page.screenshot({ path: '.local/briefing-direct-drag/touch-editing.png' });
  point = await hold();
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: point.x, y: point.y + 310 }],
  });
  await settled(page);
  const preview = await position(c);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settled(page);
  expect(await position(c)).toEqual(preview);
  expect((await state(page)).briefing.layouts).toBeTruthy();
  await expect(page).toHaveURL(/#\/briefing$/);
  await valid(page);
  await page.getByRole('button', { name: '完成', exact: true }).tap();
  await expect(page.locator('.briefing-page')).not.toHaveClass(/is-editing/);
  await expect(c.locator('.briefing-resize-handle')).toHaveCSS('opacity', '0');
  await page.waitForTimeout(550);
  await c.locator('.briefing-card-main').tap();
  await expect(page).toHaveURL(/#\/chat\//);
  await context.close();
});

test('触屏正常滚动取消长按计时，短按仍打开会话', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('/#/briefing');
  const c = card(page, 'konggu:C30');
  await c.waitFor();
  await c.scrollIntoViewIfNeeded();
  const client = await context.newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 170, y: 440 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 175, y: 280 }] });
  await page.waitForTimeout(650);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.briefing-page')).not.toHaveClass(/is-editing/);
  await expect(page.getByRole('button', { name: '完成', exact: true })).toHaveCount(0);
  expect(await page.locator('main').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await c.locator('.briefing-card-main').tap();
  await expect(page).toHaveURL(/#\/chat\//);
  await context.close();
});

test('触屏滑动后停住与多指不触发长按，编辑中仍须长按且可正常滚动', async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto('/#/briefing');
  const c = card(page, 'konggu:C30');
  await c.waitFor();
  await c.scrollIntoViewIfNeeded();
  await settled(page);
  const before = await state(page);
  const client = await context.newCDPSession(page);
  const root = page.locator('.briefing-page');
  const box = (await c.boundingBox())!;
  const x = box.x + 70,
    y = box.y + 130;
  const start = () =>
    client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  const end = (cancel = false) =>
    client.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
  // Moving just beyond the hold tolerance cancels it permanently, even before native scrolling begins.
  await start();
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 9 }] });
  await page.waitForTimeout(650);
  await expect(root).not.toHaveClass(/is-moving|is-editing/);
  await end(true);
  await start();
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x, y },
      { x: x + 80, y: y + 40 },
    ],
  });
  await page.waitForTimeout(650);
  await expect(root).not.toHaveClass(/is-moving|is-editing/);
  await end(true);
  await start();
  await expect(root).toHaveClass(/is-editing/);
  await end();
  await expect(root).not.toHaveClass(/is-moving/);
  expect(await state(page)).toEqual(before);
  const scrollBefore = await page.locator('main').evaluate((el) => el.scrollTop);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 170, y: 440 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 174, y: 270 }] });
  await page.waitForTimeout(650);
  await expect(root).toHaveClass(/is-editing/);
  await expect(root).not.toHaveClass(/is-moving/);
  await expect(page.locator('.briefing-move-ghost')).toHaveCount(0);
  await end();
  expect(await page.locator('main').evaluate((el) => el.scrollTop)).toBeGreaterThan(scrollBefore);
  expect(await state(page)).toEqual(before);
  await expect(page).toHaveURL(/#\/briefing$/);
  await page.getByRole('button', { name: '完成', exact: true }).tap();
  await expect(root).not.toHaveClass(/is-editing/);
  await context.close();
});

test('触屏编辑中的尺寸把手仍可拖拽，取消恢复、保存刷新后尺寸与位置均保留', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('/#/briefing');
  const c = card(page, 'konggu:C13');
  await c.scrollIntoViewIfNeeded();
  const client = await context.newCDPSession(page);
  const box = (await c.boundingBox())!;
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box.x + 70, y: box.y + 100 }],
  });
  await expect(page.getByRole('button', { name: '完成', exact: true })).toBeVisible();
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.briefing-compose-dock')).toBeHidden();
  await page.screenshot({ path: '.local/briefing-move/touch-editing-cards.png' });
  const before = await state(page);
  const original = await position(c);
  const startResize = async () => {
    await c.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await settled(page);
    const b = (await c.locator('.briefing-resize-handle').boundingBox())!;
    const x = b.x + b.width - 8,
      y = b.y + b.height - 8;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: Math.min(820, y + 300) }],
    });
    await expect(c).toHaveAttribute('data-size', '1×2');
  };
  await startResize();
  expect(await state(page)).toEqual(before);
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(c).toHaveAttribute('data-size', '1×1');
  await settled(page);
  expect(await position(c)).toEqual(original);
  expect(await state(page)).toEqual(before);
  await startResize();
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settled(page);
  const saved = await position(c);
  expect(saved.row.split(' / ')[0]).toBe(original.row.split(' / ')[0]);
  await page.getByRole('button', { name: '完成', exact: true }).tap();
  await page.reload();
  await settled(page);
  expect(await position(c)).toEqual(saved);
  await valid(page);
  await context.close();
});
