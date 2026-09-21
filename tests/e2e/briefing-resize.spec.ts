import { test, expect, type Page } from '@playwright/test';

const storageKey = 'enterprise-ai-demo-v1';
const card = (p: Page, id = 'followup:personal') => p.locator(`.briefing-grid [data-card-id="${id}"]`);
const state = (p: Page) => p.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey);
const position = (p: Page, id = 'followup:personal') =>
  card(p, id).evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y + el.closest('main')!.scrollTop,
      col: el.style.gridColumnStart,
      row: el.style.gridRowStart,
    };
  });
const staysAt = async (p: Page, original: Awaited<ReturnType<typeof position>>, id = 'followup:personal') => {
  const current = await position(p, id);
  expect(current.col).toBe(original.col);
  expect(current.row).toBe(original.row);
  expect(Math.abs(current.x - original.x)).toBeLessThan(1);
  expect(Math.abs(current.y - original.y)).toBeLessThan(1);
};
const settled = (p: Page) =>
  expect
    .poll(() =>
      p
        .locator('.briefing-grid > *')
        .evaluateAll(
          (els) =>
            els.flatMap((el) => el.getAnimations()).filter((animation) => animation.playState === 'running')
              .length,
        ),
    )
    .toBe(0);
const start = async (p: Page, id = 'followup:personal') => {
  const c = card(p, id);
  await c.hover();
  const handle = c.locator('.briefing-resize-handle');
  await expect(handle).toHaveCSS('opacity', '1');
  const bounds = (await handle.boundingBox())!;
  const point = { x: bounds.x + bounds.width - 7, y: bounds.y + bounds.height - 7 };
  const pitch = await p
    .locator('.briefing-page')
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).getPropertyValue('--briefing-unit')) + 10);
  await p.mouse.move(point.x, point.y);
  await p.mouse.down();
  return { ...point, pitch };
};

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1418, height: 1000 });
  await page.goto('/#/briefing');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('弧形把手取代尺寸菜单，拖动实时重排，松手才保存且不进入会话', async ({ page }) => {
  const before = await state(page);
  const c = card(page);
  await c.hover();
  await c.getByRole('button', { name: /^卡片操作 / }).click();
  await expect(page.getByRole('button', { name: /^尺寸 / })).toHaveCount(0);
  await page.keyboard.press('Escape');
  const neighbours = page.locator('.briefing-grid [data-card-id]:not([data-card-id="followup:personal"])');
  const positions = () =>
    neighbours.evaluateAll((els) =>
      els.map((el) => [
        el.getAttribute('data-card-id'),
        (el as HTMLElement).style.gridColumn,
        (el as HTMLElement).style.gridRow,
      ]),
    );
  const originalPositions = await positions();
  const pointer = await start(page);
  const original = await position(page);
  await page.mouse.move(pointer.x - pointer.pitch * 0.8, pointer.y + pointer.pitch * 0.8, { steps: 8 });
  await expect(c).toHaveAttribute('data-size', '1×2');
  await expect(page.locator('.briefing-resize-hint')).toHaveText('1×2');
  expect(await state(page)).toEqual(before);
  await staysAt(page, original);
  await expect.poll(positions).not.toEqual(originalPositions);
  await page.mouse.up();
  await settled(page);
  await staysAt(page, original);
  const after = await state(page);
  const oldCard = before.briefing.cards.find((c: any) => c.id === 'followup:personal');
  const newCard = after.briefing.cards.find((c: any) => c.id === oldCard.id);
  expect(newCard.config.size).toBe('1×2');
  expect(newCard.history).toEqual(oldCard.history);
  expect(newCard.updatedAt).toBe(oldCard.updatedAt);
  expect(after.chats).toEqual(before.chats);
  expect(after.records).toEqual(before.records);
  await expect(page).toHaveURL(/#\/briefing$/);
  await page.reload();
  await expect(c).toHaveAttribute('data-size', '1×2');
});

test('快速往返时动画接续当前位置，文字不缩放，Esc 回滚未保存预览', async ({ page }) => {
  const before = await state(page);
  const c = card(page);
  const pointer = await start(page);
  const original = await position(page);
  await page.mouse.move(pointer.x - pointer.pitch * 0.8, pointer.y + pointer.pitch * 0.8);
  await expect(c).toHaveAttribute('data-size', '1×2');
  await staysAt(page, original);
  const animations = await c.evaluate((el) =>
    el.getAnimations().flatMap((a) => (a.effect as KeyframeEffect).getKeyframes()),
  );
  expect(animations.some((frame) => String(frame.transform).includes('translate'))).toBe(true);
  expect(animations.some((frame) => String(frame.transform).includes('scale'))).toBe(false);
  await page.mouse.move(pointer.x, pointer.y + pointer.pitch * 0.8);
  await expect(c).toHaveAttribute('data-size', '2×2');
  await staysAt(page, original);
  await page.mouse.move(pointer.x - pointer.pitch * 0.8, pointer.y);
  await expect(c).toHaveAttribute('data-size', '1×1');
  await staysAt(page, original);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.briefing-page')).not.toHaveClass(/is-resizing/);
  await expect(c).toHaveAttribute('data-size', '2×1');
  await settled(page);
  await staysAt(page, original);
  expect(await state(page)).toEqual(before);
  await expect(c.locator('.briefing-resize-handle')).toBeFocused();
});

test('最右列保持原位不换行，可向下增高，日期视图沿用已保存尺寸', async ({ page }) => {
  const id = await page
    .locator('.briefing-grid [data-size="1×1"]')
    .evaluateAll(
      (els) =>
        (els.find((el) => (el as HTMLElement).style.gridColumnStart === '5') as HTMLElement).dataset.cardId!,
    );
  const c = card(page, id);
  await c.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const pointer = await start(page, id);
  const original = await position(page, id);
  await page.mouse.move(1414, pointer.y + pointer.pitch * 0.8, { steps: 4 });
  await expect(c).toHaveAttribute('data-size', '1×2');
  await staysAt(page, original, id);
  await page.mouse.up();
  await settled(page);
  await staysAt(page, original, id);
  await c.locator('.briefing-resize-handle').press('ArrowRight');
  await expect(c).toHaveAttribute('data-size', '1×2');
  expect((await state(page)).briefing.cards.find((c: any) => c.id === id).config.size).toBe('1×2');
  await page.getByRole('tab', { name: '日期', exact: true }).click();
  await expect(c).toHaveAttribute('data-size', '1×2');
  await expect(c.locator('.briefing-resize-handle')).toHaveCount(1);
});

test('旧日期可拖拽及键盘调尺寸，取消不保存，刷新保留且不改历史事实', async ({ page }) => {
  await page.evaluate(() => {
    const key = 'enterprise-ai-demo-v1';
    const s = JSON.parse(localStorage.getItem(key)!);
    const c = s.briefing.cards.find((x: any) => x.id === 'dream');
    c.updatedAt = '2026-09-18T01:00:00.000Z';
    c.history[0].at = c.updatedAt;
    localStorage.setItem(key, JSON.stringify(s));
  });
  await page.reload();
  const c = card(page, 'dream');
  await c.locator('.briefing-card-main').click();
  await page.getByRole('button', { name: '按当前方案处理', exact: true }).click();
  await page.goto('/#/briefing');
  await expect(c).toContainText('已按月份归类');
  await page.getByRole('tab', { name: '日期', exact: true }).click();
  await page.getByLabel('回看日期', { exact: true }).fill('2026-09-18');
  await expect(c).toContainText('等待确认');
  const before = await state(page);
  await c.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const pointer = await start(page, 'dream');
  const original = await position(page, 'dream');
  await page.mouse.move(pointer.x + pointer.pitch * 0.8, pointer.y + pointer.pitch * 0.8, { steps: 8 });
  await expect(c).toHaveAttribute('data-size', '2×2');
  await staysAt(page, original, 'dream');
  expect(await state(page)).toEqual(before);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(c).toHaveAttribute('data-size', '1×1');
  expect(await state(page)).toEqual(before);
  await settled(page);
  await c.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const retry = await start(page, 'dream');
  await page.mouse.move(retry.x + retry.pitch * 0.8, retry.y + retry.pitch * 0.8, { steps: 8 });
  await page.mouse.up();
  await settled(page);
  await expect(c).toHaveAttribute('data-size', '2×2');
  await staysAt(page, original, 'dream');
  await c.locator('.briefing-resize-handle').press('ArrowUp');
  await expect(c).toHaveAttribute('data-size', '2×1');
  await staysAt(page, original, 'dream');
  const after = await state(page);
  const oldCard = before.briefing.cards.find((x: any) => x.id === 'dream');
  oldCard.config = { ...(oldCard.config || { title: oldCard.data.title, compact: false }), size: '2×1' };
  expect(after).toEqual(before);
  await expect(c).toContainText('等待确认');
  await page.getByRole('tab', { name: '最新', exact: true }).click();
  await expect(c).toHaveAttribute('data-size', '2×1');
  await expect(c).toContainText('已按月份归类');
  await page.reload();
  await page.getByRole('tab', { name: '日期', exact: true }).click();
  await page.getByLabel('回看日期', { exact: true }).fill('2026-09-18');
  await expect(c).toHaveAttribute('data-size', '2×1');
  await expect(c).toContainText('等待确认');
});

test('键盘方向键调整四种规格，减少动态效果时直接完成排列', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const c = card(page);
  const handle = c.locator('.briefing-resize-handle');
  await handle.focus();
  const original = await position(page);
  for (const [key, size] of [
    ['ArrowLeft', '1×1'],
    ['ArrowDown', '1×2'],
    ['ArrowRight', '2×2'],
    ['ArrowUp', '2×1'],
  ]) {
    await handle.press(key);
    await expect(c).toHaveAttribute('data-size', size);
    await staysAt(page, original);
    expect(await c.evaluate((el) => el.getAnimations().length)).toBe(0);
  }
  await expect(page.getByRole('status')).toHaveText('卡片已调整为 2×1');
  await expect(handle).toBeFocused();
});

test('连续调整同组不同卡片各自原位保存，取消下一次预览恢复整组，改变列数无越界', async ({ page }) => {
  const first = card(page);
  await first.locator('.briefing-resize-handle').focus();
  await page.keyboard.press('ArrowLeft');
  await settled(page);
  const group = first.locator('xpath=ancestor::section');
  const nextId = await group
    .locator('[data-card-id]')
    .evaluateAll(
      (els) =>
        (els.find((el) => el.getAttribute('data-card-id') !== 'followup:personal') as HTMLElement).dataset
          .cardId!,
    );
  const next = card(page, nextId);
  const previousSize = (await next.getAttribute('data-size'))!;
  await next.locator('.briefing-resize-handle').focus();
  const original = await position(page, nextId);
  await page.keyboard.press(previousSize.endsWith('1') ? 'ArrowDown' : 'ArrowUp');
  await settled(page);
  await staysAt(page, original, nextId);
  const cells = () =>
    group
      .locator('[data-card-id]')
      .evaluateAll((els) =>
        els.map((el) => [
          el.getAttribute('data-card-id'),
          el.getAttribute('data-size'),
          (el as HTMLElement).style.gridColumn,
          (el as HTMLElement).style.gridRow,
        ]),
      );
  const beforeLayout = await cells();
  const before = await state(page);
  await first.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const pointer = await start(page);
  const initial = await first.getAttribute('data-size');
  await page.mouse.move(pointer.x, pointer.y + (initial!.endsWith('1') ? 0.8 : -0.8) * pointer.pitch, {
    steps: 8,
  });
  await expect(first).not.toHaveAttribute('data-size', initial!);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await settled(page);
  expect(await cells()).toEqual(beforeLayout);
  expect(await state(page)).toEqual(before);
  await next.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: '.local/briefing-anchor/after-resize.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page
        .locator('.briefing-page')
        .evaluate((el) => getComputedStyle(el).getPropertyValue('--briefing-columns').trim()),
    )
    .toBe('1');
  expect(
    await page
      .locator('.briefing-grid [data-card-id]')
      .evaluateAll((els) =>
        els.every(
          (el) =>
            (el as HTMLElement).style.gridColumnStart === '1' &&
            el.getAttribute('data-size')!.startsWith('1'),
        ),
      ),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await state(page)).toEqual(before);
});

test('触屏可拖动竖向把手，单列不产生两格宽卡，pointercancel 不保存', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('/#/briefing');
  const target = card(page, 'dream');
  await target.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const handle = target.locator('.briefing-resize-handle');
  await expect(handle).toHaveCSS('opacity', '1');
  const b = (await handle.boundingBox())!;
  const x = b.x + b.width - 7,
    y = b.y + b.height - 7;
  const before = await state(page);
  const client = await context.newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: x + 12, y: Math.min(820, y + 245) }],
  });
  await expect(target).toHaveAttribute('data-size', '1×2');
  expect(await state(page)).toEqual(before);
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(target).toHaveAttribute('data-size', '1×1');
  expect(await state(page)).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.close();
});
