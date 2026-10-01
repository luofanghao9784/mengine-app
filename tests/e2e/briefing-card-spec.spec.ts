import { test, expect } from '@playwright/test';

const key = 'enterprise-ai-demo-konggu-v1';
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/briefing');
  await expect(page.locator('.briefing-grid .briefing-card')).toHaveCount(40);
});

test('所有卡片标题完整换行，按内容扩容，宽窄屏不裁切、不重叠', async ({ page }) => {
  await page.getByRole('tab', { name: '类型', exact: true }).click();
  for (const width of [1440, 977, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        page.locator('.briefing-grid .briefing-card').evaluateAll((cards) =>
          cards.flatMap((card) => {
            const h = card.querySelector<HTMLElement>('h3')!,
              r = h.getBoundingClientRect();
            const bounds = card.getBoundingClientRect(),
              footer = card.querySelector('.magazine-footer')!.getBoundingClientRect();
            const style = getComputedStyle(h),
              errors: string[] = [];
            if (style.whiteSpace === 'nowrap' || !['none', 'unset'].includes(style.webkitLineClamp))
              errors.push('标题被限行');
            if (
              h.scrollWidth > h.clientWidth + 1 ||
              h.scrollHeight > h.clientHeight + 1 ||
              r.right > bounds.right - 10 ||
              r.bottom > footer.top + 1
            )
              errors.push(`${card.getAttribute('data-card-id')}:标题溢出`);
            for (const e of card.querySelectorAll<HTMLElement>(
              '.magazine-summary,.magazine-note,.magazine-value,.briefing-chart-period',
            )) {
              if (getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().bottom > footer.top + 1)
                errors.push(`${card.getAttribute('data-card-id')}:正文与底部重叠`);
            }
            return errors;
          }),
        ),
      )
      .toEqual([]);
    const cards = await page.locator('.briefing-grid .briefing-card').evaluateAll((cards) =>
      cards.map((c) => ({
        id: c.getAttribute('data-card-id'),
        grid: c.parentElement!.getAttribute('data-group-id'),
        r: c.getBoundingClientRect().toJSON(),
      })),
    );
    for (const [i, a] of cards.entries())
      for (const b of cards.slice(i + 1).filter((b) => b.grid === a.grid))
        expect(
          a.r.right <= b.r.left + 1 ||
            b.r.right <= a.r.left + 1 ||
            a.r.bottom <= b.r.top + 1 ||
            b.r.bottom <= a.r.top + 1,
          `${a.id}/${b.id}`,
        ).toBe(true);
    if (width === 977 || width === 390)
      await page.screenshot({
        path: `.local/card-spec/titles-${test.info().project.name || 'chromium'}-${width}.png`,
      });
  }
});

test('超长自定标题仍完整，自动扩容不覆盖关注布局偏好', async ({ page }) => {
  const title =
    '十一条合成商机分别处在哪个阶段，以及需要补齐哪些资料和跟进行动。'.repeat(6) +
    'LongUnbrokenIdentifier0123456789'.repeat(3);
  await page.evaluate(
    ({ key, title }) => {
      const s = JSON.parse(localStorage.getItem(key)!);
      const card = s.briefing.cards.find((c: any) => c.id === 'konggu:C01');
      card.pinned = true;
      card.config = { size: '1×1', title, compact: false };
      localStorage.setItem(key, JSON.stringify(s));
    },
    { key, title },
  );
  await page.reload();
  await page.getByRole('tab', { name: '关注', exact: true }).click();
  for (const width of [977, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const card = page.locator('[data-card-id="konggu:C01"]');
    await expect(card.locator('h3')).toHaveText(title);
    await expect
      .poll(() =>
        card.evaluate((card) => {
          const title = card.querySelector<HTMLElement>('h3')!,
            footer = card.querySelector('.magazine-footer')!;
          return (
            title.getBoundingClientRect().bottom <= footer.getBoundingClientRect().top &&
            title.scrollWidth <= title.clientWidth + 1
          );
        }),
      )
      .toBe(true);
  }
  expect(
    await page.evaluate(
      (key) =>
        JSON.parse(localStorage.getItem(key)!).briefing.cards.find((c: any) => c.id === 'konggu:C01').config
          .size,
      key,
    ),
  ).toBe('1×1');
});

test('日期只找当天产生的内容，数据卡持续在类型中展示，旧版本不再回看', async ({ page }) => {
  const dates = await page.evaluate(
    (key) =>
      JSON.parse(localStorage.getItem(key)!)
        .briefing.cards.filter((c: any) => !['经营数据', '项目进展', '活跃会话'].includes(c.data.type))
        .map((c: any) => ({ id: c.id, day: new Date(c.createdAt).toLocaleDateString('sv-SE') })),
    key,
  );
  await page.getByRole('tab', { name: '日期', exact: true }).click();
  await expect(page.locator('.briefing-grid .magazine-数据')).toHaveCount(0);
  await page.getByLabel('产生日期', { exact: true }).fill('2026-09-19');
  const actual = await page
    .locator('.briefing-grid .briefing-card')
    .evaluateAll((cards) => cards.map((c) => c.getAttribute('data-card-id')).sort());
  expect(actual).toEqual(
    dates
      .filter((c: any) => c.day === '2026-09-19')
      .map((c: any) => c.id)
      .sort(),
  );
  await page.getByLabel('产生日期', { exact: true }).fill('2026-09-24');
  await expect(page.locator('.briefing-grid .briefing-card')).toHaveCount(0);
  await page.getByRole('tab', { name: '类型', exact: true }).click();
  await page.getByLabel('内容类型').getByRole('button', { name: '数据', exact: true }).click();
  await expect(page.locator('[data-card-id="konggu:C01"] time')).toContainText('更新');
  const histories = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).briefing.cards.map((c: any) => c.history.length),
    key,
  );
  expect(histories.every((n: number) => n === 0)).toBe(true);
});

test('有用的数据卡可在间隔后重新推荐，同一张卡保留已读与状态标记，连续刷新不重复推荐', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-24T04:00:00.000Z'));
  const card = page.locator('.briefing-grid [data-card-id="konggu:C01"]');
  const before = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).briefing.cards, key);
  await card.locator('.briefing-card-main').click();
  await page.locator('.briefing-detail').getByRole('button', { name: '有用', exact: true }).click();
  await page.getByRole('button', { name: '关闭卡片详情', exact: true }).click();
  const refresh = async () => {
    await page.getByRole('button', { name: '刷新智能画报（演示）', exact: true }).click();
    await expect(page.locator('.briefing-page')).toHaveAttribute('data-refresh-phase', 'idle');
  };
  await refresh();
  await expect(
    page.locator('[data-recommendation-group="recommended"] [data-card-id="konggu:C01"]'),
  ).toHaveCount(1);
  await page.clock.setFixedTime(new Date('2026-09-26T04:00:00.000Z'));
  await refresh();
  await expect(
    page.locator('[data-recommendation-group="recommended"] [data-card-id="konggu:C01"]'),
  ).toHaveCount(1);
  await expect(card).toHaveAttribute('data-read', 'true');
  await expect(card.getByRole('img', { name: '已标记有用', exact: true })).toHaveCount(1);
  await expect(card).toHaveCount(1);
  await refresh();
  await expect(
    page.locator('[data-recommendation-group="recommended"] [data-card-id="konggu:C01"]'),
  ).toHaveCount(1);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).briefing.cards, key)).toEqual(
    before,
  );
});
