import { expect, test, type Page } from '@playwright/test';
import type { CardSize } from '../../src/briefing';

const storageKey = 'enterprise-ai-demo-v1';
const sizes: CardSize[] = ['1×1', '2×1', '1×2', '2×2'];

async function overlaps(page: Page, selector = '.briefing-grid .briefing-card') {
  return page.locator(selector).evaluateAll((cards) => {
    const errors: string[] = [];
    const box = (el: Element) => el.getBoundingClientRect();
    const intersects = (a: DOMRect, b: DOMRect) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    for (const card of cards) {
      const id = card.getAttribute('data-card-id') || card.querySelector('h3')?.textContent;
      const report = (message: string) =>
        errors.push(`${id} / ${card.getAttribute('data-size')}: ${message}`);
      const source = card.querySelector('.briefing-source')!;
      const blocks = Array.from(
        card.querySelectorAll(
          'h3, .briefing-fact, .briefing-advice, .briefing-value, .briefing-chart, .briefing-items, .briefing-trend, .briefing-document-stack, .briefing-project-state, .briefing-evidence, .briefing-primary-advice, .briefing-reasoning, .briefing-visual-chart, .briefing-takeaway, .briefing-designed-number',
        ),
      ).filter((el) => box(el).width > 0 && box(el).height > 0);
      for (const block of blocks) {
        if (box(block).bottom > box(source).top + 1)
          report(`${block.className || block.tagName} covers source`);
        if (box(block).left < box(card).left - 1 || box(block).right > box(card).right + 1)
          report(`${block.className || block.tagName} outside card`);
      }
      for (let i = 0; i < blocks.length; i++)
        for (let j = i + 1; j < blocks.length; j++)
          if (
            !blocks[i].contains(blocks[j]) &&
            !blocks[j].contains(blocks[i]) &&
            intersects(box(blocks[i]), box(blocks[j]))
          )
            report(
              `${blocks[i].className || blocks[i].tagName} overlaps ${blocks[j].className || blocks[j].tagName}`,
            );

      for (const svg of card.querySelectorAll<SVGSVGElement>('.briefing-visual-chart svg')) {
        const labels = [...svg.querySelectorAll('text')];
        const bounds = box(svg);
        for (const label of labels) {
          const b = box(label);
          if (
            b.left < bounds.left - 1 ||
            b.right > bounds.right + 1 ||
            b.top < bounds.top - 1 ||
            b.bottom > bounds.bottom + 1
          )
            report(`label outside plot: ${label.textContent}`);
        }
        for (let i = 0; i < labels.length; i++)
          for (let j = i + 1; j < labels.length; j++)
            if (
              intersects(
                new DOMRect(
                  box(labels[i]).x - 2,
                  box(labels[i]).y,
                  box(labels[i]).width + 4,
                  box(labels[i]).height,
                ),
                box(labels[j]),
              )
            )
              report(`labels overlap: ${labels[i].textContent} / ${labels[j].textContent}`);

        // A chart can fit its box while a bar/line still crosses the text.
        // Sample painted geometry rather than bounding boxes (a ring's center is empty).
        // Heatmap labels are intentionally centered inside their colored cells.
        if (svg.parentElement?.getAttribute('data-chart-kind') === 'heatmap') continue;
        for (const mark of svg.querySelectorAll<SVGGeometryElement>('rect, line, polyline, circle')) {
          const matrix = mark.getScreenCTM()!;
          const length = mark.getTotalLength();
          const points: DOMPoint[] = [];
          for (let distance = 0; distance <= length; distance += 2) {
            const point = mark.getPointAtLength(distance);
            points.push(new DOMPoint(point.x, point.y).matrixTransform(matrix));
          }
          for (const label of labels) {
            const b = box(label);
            if (
              points.some(
                (p) => p.x > b.left + 1 && p.x < b.right - 1 && p.y > b.top + 1 && p.y < b.bottom - 1,
              )
            )
              report(`mark crosses label: ${label.textContent} / ${mark.tagName}`);
          }
        }
      }
    }
    return errors;
  });
}

async function configure(page: Page, size: CardSize, compact: boolean, longTitle = false) {
  await page.evaluate(
    ({ storageKey, size, compact, longTitle }) => {
      const state = JSON.parse(localStorage.getItem(storageKey)!);
      for (const card of state.briefing.cards)
        card.config = {
          size,
          compact,
          title: longTitle
            ? `${card.data.title}，核对计划安排、资料完整性和后续行动`.slice(0, 28)
            : card.data.title,
        };
      localStorage.setItem(storageKey, JSON.stringify(state));
    },
    { storageKey, size, compact, longTitle },
  );
  await page.reload();
  await expect(page.locator('.briefing-card').first()).toBeVisible();
}

// Include the narrowest unit immediately after each desktop column breakpoint.
for (const width of [1418, 1348, 1280, 1104, 1024, 860, 768, 616, 540, 390, 320]) {
  test(`${width}px 下所有卡片四种尺寸及完整／精简模式无文字、图表或来源覆盖`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/briefing');
    await expect(page.locator('.briefing-card').first()).toBeVisible();
    const count = await page.locator('.briefing-grid .briefing-card').count();
    expect(count).toBeGreaterThan(30);
    await expect.poll(() => overlaps(page)).toEqual([]);
    for (const compact of [false, true])
      for (const size of sizes) {
        await configure(page, size, compact);
        await expect(page.locator('.briefing-grid .briefing-card')).toHaveCount(count);
        const saved = await page.evaluate((key) => localStorage.getItem(key), storageKey);
        await expect.poll(() => overlaps(page)).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(saved);
      }
  });
}

test('较长的自定义标题在最小单元下仍给图表、数值和来源留出位置', async ({ page }) => {
  await page.setViewportSize({ width: 1348, height: 900 });
  await page.goto('/#/briefing');
  await expect(page.locator('.briefing-card').first()).toBeVisible();
  for (const size of sizes) {
    await configure(page, size, false, true);
    await expect.poll(() => overlaps(page)).toEqual([]);
  }
});

for (const width of [1418, 390]) {
  test(`${width}px 会话中的完整原卡片仍保留图表事实且无覆盖`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/briefing');
    await expect(page.locator('.briefing-card').first()).toBeVisible();
    for (const size of ['1×1', '1×2'] as const) {
      await configure(page, size, false);
      for (const id of [
        'demo:receivables-aging',
        'demo:retrieval-comparison',
        'demo:inquiry-channels',
        'finance:demo-receipts',
      ]) {
        const card = page.locator(`.briefing-grid [data-card-id="${id}"]`);
        const description = await card.locator('svg[role="img"]').getAttribute('aria-label');
        await card.locator('.briefing-card-main').click();
        const original = page.getByRole('region', { name: '会话中的画报原卡片' });
        await expect(original.locator('svg[role="img"]').first()).toHaveAttribute('aria-label', description!);
        await expect(original.locator('.briefing-evidence').first()).toBeVisible();
        await expect.poll(() => overlaps(page, '.briefing-reference .briefing-card')).toEqual([]);
        await page.getByRole('button', { name: '关闭会话', exact: true }).click();
        await expect(page.locator('.conversation-overlay')).toHaveCount(0);
      }
    }
  });
}
