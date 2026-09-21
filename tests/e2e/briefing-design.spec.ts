import { test, expect } from '@playwright/test';

test('十二类图表与文字版式完整呈现，每日一条资讯，来源和人员关系可核对', async ({ page }, testInfo) => {
  await page.goto('/#/briefing');
  const kinds = await page
    .locator('.briefing-grid [data-chart-kind]')
    .evaluateAll((nodes) => [...new Set(nodes.map((n) => n.getAttribute('data-chart-kind')))].sort());
  expect(kinds).toEqual([
    'area',
    'bullet',
    'dumbbell',
    'heatmap',
    'line',
    'lollipop',
    'multiples',
    'ring',
    'stacked',
    'timeline',
    'waffle',
    'waterfall',
  ]);
  const newsIds = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('enterprise-ai-demo-v1')!)
      .briefing.cards.filter((c: any) => c.data.type === '资讯')
      .map((c: any) => c.id),
  );
  for (const group of await page.locator('.briefing-date-group').all()) {
    const ids = await group
      .locator('.briefing-card')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-card-id')));
    expect(ids.filter((id) => newsIds.includes(id))).toHaveLength(1);
  }
  const brief = page.locator('[data-card-id="demo:daily-reading"]');
  await expect(brief.locator('[data-format="brief"]')).toContainText('保留原始来源与发布时间');
  await expect(
    brief.locator('svg[role="img"], .briefing-document-cover, .briefing-primary-advice'),
  ).toHaveCount(0);
  await expect(page.locator('[data-format="digest"] .briefing-reasoning > div')).toHaveCount(3);
  const recommendation = page.locator('[data-card-id="demo:roster-next-step"]');
  await recommendation.getByRole('button', { name: '查看相关人员，共 2 人' }).focus();
  const people = recommendation.getByRole('region', { name: '相关人员姓名' });
  await expect(people).toContainText('陈言');
  await expect(people).toContainText('名单补齐');
  await expect(people).toContainText('培训时段协调');
  await expect(page.locator('.conversation-overlay')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('[data-card-id="demo:cash-bridge"] .briefing-card-main').click();
  await expect(page.getByRole('region', { name: '会话中的画报原卡片' })).toContainText(
    '不能据此视为可用现金',
  );
  await expect(page.locator('.deck-file')).toContainText('10+6-3-2=11');
  await page.getByRole('button', { name: '关闭会话', exact: true }).click();
  await expect(page.locator('.conversation-overlay')).toHaveCount(0);
  await page.locator('.page-main').evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({ path: testInfo.outputPath('desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('mobile.png') });
});

test('所有图表在桌面和单列保留可读数值，关键建议在四种规格内完整显示', async ({ page }) => {
  await page.goto('/#/briefing');
  for (const width of [1418, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.locator('.briefing-grid .briefing-visual-chart svg').evaluateAll((charts) =>
          charts.flatMap((svg) => {
            const bounds = svg.getBoundingClientRect();
            return Array.from(svg.querySelectorAll('text'))
              .filter((t) => {
                const b = t.getBoundingClientRect();
                return (
                  b.left < bounds.left - 1 ||
                  b.right > bounds.right + 1 ||
                  b.bottom > bounds.bottom + 1 ||
                  b.top < bounds.top - 1
                );
              })
              .map((t) => `${svg.parentElement!.getAttribute('data-chart-kind')}: ${t.textContent}`);
          }),
        ),
      )
      .toEqual([]);
  }
  await page.setViewportSize({ width: 1418, height: 900 });
  const card = page.locator('[data-card-id="demo:roster-next-step"]');
  const handle = card.getByRole('button', { name: /^调整 .* 大小/ });
  for (const key of ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp']) {
    await handle.focus();
    await page.keyboard.press(key);
    await expect(card.locator('.briefing-primary-advice')).toHaveText('先补齐试用名单，再协调培训时段。');
    await expect
      .poll(() =>
        card.evaluate((el) => {
          const advice = el.querySelector('.briefing-primary-advice')!;
          const bottom = el.querySelector('.briefing-source')!.getBoundingClientRect().top;
          return (
            advice.scrollHeight <= advice.clientHeight + 1 && advice.getBoundingClientRect().bottom <= bottom
          );
        }),
      )
      .toBe(true);
    await expect(card.locator('.briefing-evidence')).toContainText('试用名单尚缺 2 位');
  }
});
