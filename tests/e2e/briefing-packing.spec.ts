import { test, expect } from '@playwright/test';

test('默认画报在各断点补齐中间空位，DOM 顺序与视觉一致且不改写保存数据', async ({ page }) => {
  await page.goto('/#/briefing');
  await expect(page.locator('.briefing-grid .briefing-card').first()).toBeVisible();
  const before = await page.evaluate(() => localStorage.getItem('enterprise-ai-demo-v1'));
  for (const width of [1418, 1280, 1024, 768, 540, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.locator('.briefing-page').evaluate((el) => {
          const width = el.getBoundingClientRect().width;
          const expected = width >= 1210 ? 5 : width >= 966 ? 4 : width >= 722 ? 3 : width >= 478 ? 2 : 1;
          return Number(getComputedStyle(el).getPropertyValue('--briefing-columns')) === expected;
        }),
      )
      .toBe(true);
    const errors = await page.locator('.briefing-grid').evaluateAll((grids) =>
      grids.flatMap((grid) => {
        const errors: string[] = [];
        const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
        const occupied = new Set<number>();
        let previous = -1;
        for (const card of grid.querySelectorAll<HTMLElement>(':scope > .briefing-card')) {
          const style = getComputedStyle(card);
          const row = Number(style.gridRowStart) - 1,
            col = Number(style.gridColumnStart) - 1;
          const [width, height] = card.dataset.size!.split('×').map(Number);
          const start = row * columns + col;
          if (start <= previous) errors.push('DOM order differs from visual order');
          previous = start;
          if (col + width > columns) errors.push('card exceeds columns');
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
              const cell = (row + y) * columns + col + x;
              if (occupied.has(cell)) errors.push('overlapping cards');
              occupied.add(cell);
            }
        }
        for (let cell = 0; cell < previous; cell++)
          if (!occupied.has(cell)) errors.push(`empty middle cell ${cell}`);
        return errors;
      }),
    );
    expect(errors, `${width}px`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(await page.evaluate(() => localStorage.getItem('enterprise-ai-demo-v1'))).toBe(before);
});
