import { test, expect } from '@playwright/test';

test('正式画报混合长标题和图表在不同列数下自动补空位且不重叠', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/tests/fixtures/live-magazine/');
  await expect(page.locator('.live-briefing-tile')).toHaveCount(7);
  for (const width of [1280, 952, 760, 540, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const geometry = () =>
      page.locator('.live-magazine-grid').evaluate((grid) => {
        const columns = Number(getComputedStyle(grid).getPropertyValue('--briefing-columns'));
        const occupied = new Set<number>();
        let overlaps = 0,
          lastStart = 0;
        for (const tile of grid.children) {
          const style = getComputedStyle(tile);
          const row = Number(style.gridRowStart) - 1,
            col = Number(style.gridColumnStart) - 1;
          const height = Number(style.gridRowEnd.replace('span ', ''));
          const width = Number(style.gridColumnEnd.replace('span ', ''));
          lastStart = Math.max(lastStart, row * columns + col);
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
              const cell = (row + y) * columns + col + x;
              if (occupied.has(cell)) overlaps++;
              occupied.add(cell);
            }
        }
        return {
          prematureTruncation: [...grid.querySelectorAll<HTMLElement>('.live-magazine:not(.magazine-with-chart) .magazine-summary')].filter((summary) => {
            const remaining = summary.parentElement!.getBoundingClientRect().bottom - summary.getBoundingClientRect().bottom;
            return summary.scrollHeight > summary.clientHeight + 1 && remaining >= parseFloat(getComputedStyle(summary).lineHeight);
          }).length,
          overlaps,
          holes: Array.from({ length: lastStart + 1 }, (_, i) => i).filter((i) => !occupied.has(i)),
          clippedTitles: [...grid.querySelectorAll('.magazine-copy h3')].filter((title) => {
            const body = title.closest('.live-briefing-body')!;
            return title.getBoundingClientRect().bottom > body.getBoundingClientRect().bottom - 10;
          }).length,
        };
      });
    await expect.poll(geometry).toEqual({ overlaps: 0, holes: [], clippedTitles: 0, prematureTruncation: 0 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width === 952 || width === 390)
      await page.screenshot({ path: `test-results/live-layout-${width}.png`, fullPage: true });
  }
});


test('分区预览仅裁整行，展开后保留方案和行动的结构与全文', async ({ page }) => {
  await page.goto('/tests/fixtures/live-magazine/?section-lines');
  for (const width of [1348, 952, 760, 540, 390, 1348]) {
    await page.setViewportSize({ width, height: 852 });
    await expect.poll(() => page.locator('.briefing-sections.is-compact .briefing-section').evaluateAll(sections => sections.filter(section => {
      if (getComputedStyle(section).visibility === 'hidden') return false;
      const p = section.querySelector('p')!;
      const rect = p.getBoundingClientRect();
      const line = parseFloat(getComputedStyle(p).lineHeight);
      const bottom = section.closest('.magazine-main')!.getBoundingClientRect().bottom;
      return rect.bottom > bottom + 1 || Math.abs(rect.height / line - Math.round(rect.height / line)) > 0.02;
    }).length)).toBe(0);
  }
  for (const layout of ['COMPARISON', 'STEPS']) {
    const card = page.getByRole('button', { name: `阅读：合成长标题用于验证卡片分区完整显示与详情对应 · ${layout}` });
    const preview = await card.locator('.briefing-section p').allTextContents();
    expect(preview).toHaveLength(2);
    await card.click();
    const details = page.locator('dialog .briefing-sections');
    await expect(details).toHaveAttribute('data-composition', layout);
    expect(await details.locator('p').allTextContents()).toEqual(preview);
    if (layout === 'COMPARISON') expect(await details.locator('.briefing-section-label').allTextContents()).toEqual(['方案 1', '方案 2']);
    for (const paragraph of await details.locator('p').all()) {
      expect(await paragraph.evaluate(p => p.scrollHeight <= p.clientHeight + 1)).toBe(true);
    }
    await page.keyboard.press('Escape');
  }
});
