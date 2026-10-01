import { test, expect } from '@playwright/test';

test('简短文字自动收紧，收款卡展示两种金额构成，大图利用卡片空间且不挤压标题来源', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/#/briefing');
  await expect(page.locator('.briefing-grid .briefing-card')).toHaveCount(40);
  const before = await page.evaluate(() => localStorage.getItem('enterprise-ai-demo-konggu-v1'));
  const receipt = page.locator('.briefing-grid [data-card-id="konggu:C35"]');
  const insight = page.locator('.briefing-grid [data-card-id="konggu:C40"]');
  for (const width of [1440, 977, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(receipt.locator('svg[role="img"]')).toHaveAccessibleName(
      /本期活动收款.*10500.*未来活动订金.*2400.*本期履约收入.*11400.*已履约未收.*3300.*不相加/,
    );
    await expect
      .poll(() =>
        receipt.evaluate((card) => {
          const svg = card.querySelector<SVGSVGElement>('.briefing-visual-chart svg')!;
          const area = svg.getBoundingClientRect();
          const footer = card.querySelector('.magazine-footer')!.getBoundingClientRect();
          const title = card.querySelector('h3')!.getBoundingClientRect();
          const labels = [...svg.querySelectorAll('text')].map((e) => e.getBoundingClientRect());
          const bars = [...svg.querySelectorAll('rect')].filter((e) => e.height.baseVal.value > 10);
          return (
            area.height >= Number(svg.getAttribute('data-min-height')) - 1 &&
            area.top > title.bottom &&
            area.bottom <= footer.top &&
            labels.every(
              (r) =>
                r.left >= area.left - 1 &&
                r.right <= area.right + 1 &&
                r.top >= area.top - 1 &&
                r.bottom <= area.bottom + 1,
            ) &&
            bars.length === 4
          );
        }),
      )
      .toBe(true);
    if (width >= 768) {
      await expect(insight).toHaveAttribute('data-size', /[12]×1/);
      // A two-bar comparison earns width, not an otherwise empty double-height panel.
      await expect(receipt).toHaveAttribute('data-size', '2×1');
      const utilization = await page
        .locator('.briefing-grid [data-card-id="konggu:C01"]')
        .evaluate((card) => {
          const svg = card.querySelector('.briefing-visual-chart svg')!.getBoundingClientRect();
          return svg.height / card.getBoundingClientRect().height;
        });
      expect(utilization).toBeGreaterThan(0.3);
    }
    if (width === 977 || width === 390) {
      await receipt.screenshot({
        path: `.local/card-density/receipts-${test.info().project.name || 'chromium'}-${width}.png`,
      });
      await insight.screenshot({
        path: `.local/card-density/insight-${test.info().project.name || 'chromium'}-${width}.png`,
      });
    }
  }
  expect(await page.evaluate(() => localStorage.getItem('enterprise-ai-demo-konggu-v1'))).toBe(before);
  expect(errors).toEqual([]);
});
