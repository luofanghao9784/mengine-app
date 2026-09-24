import { test, expect } from '@playwright/test';

const key = 'enterprise-ai-demo-konggu-v1';
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/briefing');
  await expect(page.locator('.briefing-grid .briefing-card')).toHaveCount(43);
});

test('六类筛选一致，照片和关键数字可见，打开原卡保留完整事实', async ({ page }) => {
  const first = page.locator('[data-card-id="conversation:kg-review"]');
  await expect(first.locator('.magazine-value')).toContainText('59,578');
  const photo = page.locator('[data-card-id="conversation:kg-development"] .magazine-photo img');
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  await expect(
    page.locator('[data-card-id="conversation:kg-development"] .briefing-photo-credit'),
  ).toContainText('AI 示意配图');
  await page.getByRole('tab', { name: '类型', exact: true }).click();
  const filters = page.getByLabel('内容类型');
  await expect(filters.getByRole('button')).toHaveText([
    '全部',
    '资讯',
    '数据',
    '洞察',
    '建议',
    '成果',
    '会话',
  ]);
  for (const type of ['资讯', '数据', '洞察', '建议', '成果', '会话']) {
    await filters.getByRole('button', { name: type, exact: true }).click();
    const badges = await page.locator('.briefing-grid .magazine-type').allTextContents();
    expect(badges.length).toBeGreaterThan(0);
    expect(new Set(badges)).toEqual(new Set([type]));
  }
  await filters.getByRole('button', { name: '全部', exact: true }).click();
  const facts = await page.evaluate(
    (key) =>
      JSON.parse(localStorage.getItem(key)!).briefing.cards.find((c: any) => c.id === 'konggu:C17').data,
    key,
  );
  await page.locator('[data-card-id="konggu:C17"] .briefing-card-main').click();
  const detail = page.locator('.briefing-detail');
  await expect(detail).toContainText(facts.fact);
  await expect(detail).toContainText(facts.advice);
  await detail.getByRole('button', { name: '发起会话', exact: true }).click();
  await expect(page.locator('.deck-source')).toContainText(facts.fact);
  await expect(page.locator('.deck-source')).toContainText(facts.advice);
  await expect(
    page.getByLabel('会话中的画报原卡片').locator('.magazine-full-content, .briefing-article'),
  ).toHaveCount(0);
});

test('四种卡片规格及窄屏保留类型和完整文本行，来源不与正文相撞', async ({ page }) => {
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        page.locator('.briefing-grid .briefing-card').evaluateAll((cards) =>
          cards.flatMap((c) => {
            const errors: string[] = [];
            const footer = c.querySelector('.magazine-footer')!.getBoundingClientRect();
            for (const e of c.querySelectorAll<HTMLElement>(
              '.magazine-summary,.magazine-note,.magazine-value,.magazine-steps,.magazine-dots',
            )) {
              if (getComputedStyle(e).display === 'none') continue;
              const r = e.getBoundingClientRect(),
                label = `${c.getAttribute('data-card-id')}:${e.className}`;
              if (r.bottom > footer.top + 1) errors.push(`${label}:footer overlap`);
              if (e.matches('p') && r.height < Number.parseFloat(getComputedStyle(e).lineHeight) - 1)
                errors.push(`${label}:partial line`);
            }
            return errors;
          }),
        ),
      )
      .toEqual([]);
    expect(await page.locator('.briefing-grid .magazine-type').count()).toBe(43);
    if (width === 1440 || width === 390)
      await page.screenshot({ path: `.local/briefing-magazine/briefing-${width}.png` });
    if (width === 1440) {
      const sizes = await page
        .locator('.briefing-grid .briefing-card')
        .evaluateAll((cs) => [...new Set(cs.map((c) => c.getAttribute('data-size')))]);
      expect(sizes.sort()).toEqual(['1×1', '1×2', '2×1', '2×2']);
    }
  }
});
