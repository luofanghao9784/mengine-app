import { test, expect } from '@playwright/test';

test('折线图在入场缩放和窗口调整后仍贴齐卡片边缘', async ({ page }) => {
  await page.goto('/tests/fixtures/live-magazine/?faces');
  // Match the real entrance animation: visual rectangles shrink without changing layout size.
  const style = await page.addStyleTag({ content: '.live-briefing-card { scale: .988 !important; }' });
  for (const width of [1350, 900, 390]) {
    await page.setViewportSize({ width, height: 849 });
    const art = page.locator('.live-briefing-body .face-art').first();
    await expect(art).toBeVisible();
    await page.waitForTimeout(150);
    await style.evaluate(node => { node.textContent = ''; });
    await expect.poll(() => art.evaluate(svg => {
      const a = svg.getBoundingClientRect();
      const b = svg.closest('.live-briefing-body')!.getBoundingClientRect();
      return Math.max(Math.abs(a.left - b.left), Math.abs(a.right - b.right), Math.abs(a.bottom - b.bottom));
    })).toBeLessThanOrEqual(1.5);
    await page.screenshot({ path: `.local/briefing-edge-20261013/${width}.png`, fullPage: true });
    await style.evaluate(node => { node.textContent = '.live-briefing-card { scale: .988 !important; }'; });
  }
});
