import { test, expect } from '@playwright/test';

const key = 'enterprise-ai-demo-konggu-v1';
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/briefing');
  await expect(page.locator('.briefing-grid .briefing-card')).toHaveCount(40);
});

test('五类筛选一致，照片和关键数字可见，打开原卡保留完整事实', async ({ page }) => {
  const first = page.locator('[data-card-id="konggu:C01"]');
  await expect(first.locator('.magazine-value')).toContainText('48,178');
  const photo = page.locator('[data-card-id="konggu:C15"] .magazine-photo img');
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  await expect(page.locator('[data-card-id="konggu:C15"] .briefing-photo-credit')).toContainText(
    'AI 示意配图',
  );
  await page.getByRole('tab', { name: '类型', exact: true }).click();
  const filters = page.getByLabel('内容类型');
  await expect(filters.getByRole('button')).toHaveText(['全部', '资讯', '数据', '洞察', '建议', '成果']);
  for (const type of ['资讯', '数据', '洞察', '建议', '成果']) {
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
  const headline = await page.locator('[data-card-id="konggu:C17"] h3').innerText();
  await page.locator('[data-card-id="konggu:C17"] .briefing-card-main').click();
  const detail = page.locator('.briefing-detail');
  await expect(detail.locator('h2')).toHaveText(headline);
  await expect(detail).toContainText(facts.fact);
  await expect(detail).toContainText(facts.advice);
  await detail.getByRole('button', { name: '发起会话', exact: true }).click();
  await expect(page.locator('.deck-source')).toContainText(facts.fact);
  await expect(page.locator('.deck-source')).toContainText(facts.advice);
  await expect(page.locator('.deck-source h2')).toHaveText(headline);
  await expect(page.getByLabel('会话中的画报原卡片').locator('h3')).toHaveText(headline);
  await expect(
    page.getByLabel('会话中的画报原卡片').locator('.magazine-full-content, .briefing-article'),
  ).toHaveCount(0);
});

test('推荐保留完整卡片日期、统计周期与原文日期，阅读和刷新不改时间', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-24T12:00:00+08:00'));
  await page.reload();
  const old = page.locator('[data-card-id="konggu:C01"]');
  const at = await old.locator('time').getAttribute('datetime');
  await expect(old.locator('time')).toContainText('9月20日');
  await expect(old.locator('.briefing-chart-period')).toContainText('统计期：9月13日—9月19日');
  await expect(page.locator('[data-card-id="konggu:C30"] .briefing-source')).toContainText(
    '发布于2026年9月14日',
  );
  await old.locator('.briefing-card-main').click();
  await expect(page.locator('.briefing-detail-article > time')).toContainText('内容截至 2026年9月20日');
  await page.getByRole('button', { name: '关闭卡片详情' }).click();
  await page.getByRole('button', { name: '刷新智能画报（演示）', exact: true }).click();
  await expect(old.locator('time')).toHaveAttribute('datetime', at!);
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
              if (r.bottom > footer.top + 1)
                errors.push(
                  `${label}:footer overlap ${Math.round(r.bottom - footer.top)}px; card ${Math.round(c.getBoundingClientRect().width)}×${Math.round(c.getBoundingClientRect().height)}`,
                );
              if (e.matches('p') && r.height < Number.parseFloat(getComputedStyle(e).lineHeight) - 1)
                errors.push(`${label}:partial line`);
            }
            return errors;
          }),
        ),
      )
      .toEqual([]);
    expect(await page.locator('.briefing-grid .magazine-type').count()).toBe(40);
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
