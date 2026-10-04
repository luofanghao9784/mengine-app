import { test, expect } from '@playwright/test';

test('真实关注网格保留拖动缩放与刷新恢复，移除恢复和撤销工具栏', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/tests/fixtures/live-magazine/?follow');
  const tile = page.locator('.live-follow-tile[data-card-id="fixture-2"]');
  const body = tile.locator('.live-briefing-body');
  await expect(tile).toBeVisible();
  const start = await tile.getAttribute('style');
  const box = (await body.boundingBox())!;
  await page.mouse.move(box.x + 50, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 50, box.y + 330, { steps: 8 });
  await expect(tile).toHaveClass(/is-moving/);
  await expect(page.locator('.briefing-move-ghost')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(tile).not.toHaveClass(/is-moving/);
  await expect(tile).toHaveAttribute('style', start!);
  await body.press('Alt+Enter');
  await body.press('ArrowDown');
  await body.press('Enter');
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '恢复自动排列', exact: true })).toHaveCount(0);
  await expect(page.locator('.live-follow-tools')).toHaveCount(0);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  const moved = await tile.getAttribute('style');
  expect(moved).not.toBe(start);
  await page.reload();
  await expect(tile).toHaveAttribute('style', moved!);
  const handle = tile.locator('.briefing-resize-handle');
  await handle.press('ArrowRight');
  await handle.press('ArrowDown');
  await expect(tile).toHaveAttribute('data-size', '2×2');
  await page.reload();
  await expect(tile).toHaveAttribute('data-size', '2×2');
  await handle.press('ArrowUp');
  await expect(tile).toHaveAttribute('data-size', '2×1');
  await handle.press('ArrowDown');
  await expect(tile).toHaveAttribute('data-size', '2×2');
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(tile).toHaveAttribute('data-size', '1×2');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(tile).toHaveAttribute('data-size', '2×2');
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '恢复自动排列', exact: true })).toHaveCount(0);
});

test('真实关注触屏长按进入编辑，完成后恢复阅读', async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{"code":"UNAUTHENTICATED"}' }),
  );
  await page.goto('/tests/fixtures/live-magazine/?follow');
  const card = page.locator('.live-follow-tile').first();
  await card.scrollIntoViewIfNeeded();
  const b = (await card.boundingBox())!;
  const client = await context.newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: b.x + 60, y: b.y + 90 }],
  });
  await expect(page.locator('.live-follow-board')).toHaveClass(/is-editing/);
  await expect(card).toHaveClass(/is-moving/);
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(card).not.toHaveClass(/is-moving/);
  await expect(page.getByRole('button', { name: '完成', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.locator('.live-follow-board')).not.toHaveClass(/is-editing/);
  await card.locator('.live-briefing-body').click();
  await expect(page.locator('dialog[open]')).toBeVisible();
  await context.close();
});

test('关注把手鼠标拖拽限制最大2×2，长标题不扩展第三行', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/tests/fixtures/live-magazine/?follow');
  const tile = page.locator('.live-follow-tile[data-card-id="fixture-2"]');
  await tile.hover();
  const grip = (await tile.locator('.briefing-resize-handle').boundingBox())!;
  await page.mouse.move(grip.x + grip.width - 5, grip.y + grip.height - 5);
  await page.mouse.down();
  await page.mouse.move(1250, 850, { steps: 16 });
  await page.mouse.up();
  await expect(tile).toHaveAttribute('data-size', '2×2');
  const spans = await page.locator('.live-follow-tile').evaluateAll((tiles) =>
    tiles.map((tile) => {
      const style = getComputedStyle(tile);
      return [
        Number(style.gridColumnEnd.replace('span ', '')),
        Number(style.gridRowEnd.replace('span ', '')),
      ];
    }),
  );
  expect(spans.every(([width, height]) => width <= 2 && height <= 2)).toBeTruthy();
});
