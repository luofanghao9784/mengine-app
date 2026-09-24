import { test, expect } from '@playwright/test';

const storageKey = 'enterprise-ai-demo-konggu-v1';

for (const savedColumns of [0, 5, 2]) {
  test(`${savedColumns ? `已有 ${savedColumns} 列保存布局` : '默认画报'}：缩窄与展开都补齐中间空位，DOM 同序且不改写偏好`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: savedColumns === 2 ? 540 : 1440, height: 900 });
    await page.goto('/#/briefing');
    await expect(page.locator('.briefing-grid .briefing-card').first()).toBeVisible();
    if (savedColumns) {
      await expect
        .poll(() =>
          page
            .locator('.briefing-page')
            .evaluate((node) => Number(getComputedStyle(node).getPropertyValue('--briefing-columns'))),
        )
        .toBe(savedColumns);
      // Recreate an existing browser's persisted display layout from its actual grid.
      await page.evaluate((key) => {
        const state = JSON.parse(localStorage.getItem(key)!);
        const columns = Number(
          getComputedStyle(document.querySelector('.briefing-page')!).getPropertyValue('--briefing-columns'),
        );
        state.briefing.layouts ||= {};
        for (const grid of document.querySelectorAll<HTMLElement>('.briefing-grid')) {
          const positions = Array.from(grid.querySelectorAll<HTMLElement>(':scope > .briefing-card')).map(
            (node) => {
              const card = state.briefing.cards.find(
                (card: { id: string }) => card.id === node.dataset.cardId,
              );
              return {
                id: card.id,
                row: Number(node.style.gridRowStart) - 1,
                col: Number(node.style.gridColumnStart) - 1,
                size: node.dataset.size,
                at: card.updatedAt,
              };
            },
          );
          state.briefing.layouts[JSON.stringify(['最新', '', grid.dataset.groupId])] = {
            columns,
            positions,
            order: positions.map((p) => p.id),
            manual: positions.slice(0, 1).map((p) => p.id),
          };
        }
        localStorage.setItem(key, JSON.stringify(state));
      }, storageKey);
      await page.reload();
      await expect(page.locator('.briefing-grid .briefing-card').first()).toBeVisible();
    }
    const before = await page.evaluate((key) => localStorage.getItem(key), storageKey);
    for (const width of [1418, 1280, 1024, 927, 768, 540, 390, 320, 768, 1024, 1280, 1440]) {
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
    expect(await page.evaluate(() => localStorage.getItem('enterprise-ai-demo-konggu-v1'))).toBe(before);
  });
}
