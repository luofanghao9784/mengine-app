import { test, expect } from '@playwright/test';

test('模型版式保留精确值、缺失、完整正文，桌面与窄屏无卡片内部滚动或覆盖', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/tests/fixtures/live-magazine/?expressive');
  await expect(page.locator('.live-briefing-tile')).toHaveCount(10);
  for (const style of ['DUMBBELL', 'DELTA_BAR', 'CURRENT_BAR', 'TABLE']) {
    await expect(page.locator(`[data-chart-style="${style}"]`).first()).toContainText('缺数据');
  }
  await expect(page.locator('[data-composition="KEY_METRIC"]').first()).toContainText('3,091');
  await expect(page.locator('[data-composition="KEY_METRIC"]').first()).toContainText('元');
  await expect(page.locator('[data-composition="SOURCE"]')).toContainText('引用依据');
  await expect(page.locator('[data-composition="SOURCE"]')).toContainText('合成分析依据.pdf');
  await expect(page.locator('ol[data-composition="STEPS"] > li')).toHaveCount(2);
  await expect(page.locator('[data-composition="COMPARISON"] .briefing-section')).toHaveCount(2);
  for (const width of [1280, 944, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.locator('.live-briefing-tile').evaluateAll(
          (tiles) =>
            tiles.filter((tile) => {
              const body = tile.querySelector('.live-briefing-body')!.getBoundingClientRect();
              const footer = tile.querySelector('.magazine-footer')!.getBoundingClientRect();
              const copy = tile.querySelector('.magazine-copy')!;
              return (
                [...copy.children].some((child) => child.getBoundingClientRect().bottom > footer.top + 1) ||
                footer.bottom > body.bottom + 1
              );
            }).length,
        ),
      )
      .toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/briefing-expressive-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: '阅读：合成内容组合 · COMPARISON', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('这段合成分析用于验证阅读详情完整保留正文。');
  await expect(dialog).toContainText('此处只检查展示，不执行业务或调用真实模型。');
  await expect(dialog.locator('[data-composition="COMPARISON"] .briefing-section')).toHaveCount(2);
});
