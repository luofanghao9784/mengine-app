import { test, expect } from '@playwright/test';

test.use({ browserName: 'webkit' });

test('鼠标离开卡片后，滚动条出现与消失不使卡片反复改变尺寸', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1290, height: 893 });
  await page.goto('/tests/fixtures/safari-briefing/');
  await expect(page.locator('.live-briefing-tile')).toHaveCount(2);
  await page.mouse.move(10, 10);
  for (const viewport of [
    { width: 1290, height: 892 },
    { width: 1290, height: 893 },
    { width: 1290, height: 894 },
    { width: 390, height: 844 },
    { width: 1290, height: 893 },
  ]) {
    await page.setViewportSize(viewport);
    // Allow responsive layout and its finite transition to finish first.
    await page.waitForTimeout(400);
    const geometry = await page.locator('.live-magazine-grid').evaluate(async (grid) => {
      const samples: number[][] = [];
      for (let frame = 0; frame < 90; frame++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        samples.push([
          grid.clientWidth,
          ...[...grid.children].flatMap((tile) => {
            const rect = tile.getBoundingClientRect();
            return [rect.left, rect.top, rect.width, rect.height];
          }),
        ]);
      }
      return samples[0].map(
        (_, index) => Math.max(...samples.map((s) => s[index])) - Math.min(...samples.map((s) => s[index])),
      );
    });
    expect(Math.max(...geometry), `布局应稳定：${viewport.width}×${viewport.height}`).toBeLessThan(0.1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
  }
  await page.setViewportSize({ width: 1290, height: 600 });
  const scroller = page.locator('.access-content');
  await scroller.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
