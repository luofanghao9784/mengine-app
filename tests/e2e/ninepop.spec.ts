import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.env.NINEPOP_DEMO_DATA_DIR;
const bundle = dir ? JSON.parse(readFileSync(join(dir, '03-36张卡片数据.json'), 'utf8')) : null;
test.skip(!bundle, 'Internal data stays outside CI; set NINEPOP_DEMO_DATA_DIR for the local trial.');
const key = 'dreamcore-ninepop-private-snapshot-v1';
test('9POP已读卡片在关闭详情、刷新和重载后保留原位，桌面与窄屏不折叠', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const positions = () =>
    page.locator('.briefing-grid .briefing-card').evaluateAll((nodes) =>
      nodes.map((node) => ({
        id: (node as HTMLElement).dataset.cardId,
        column: (node as HTMLElement).style.gridColumn,
        row: (node as HTMLElement).style.gridRow,
        size: (node as HTMLElement).dataset.size,
      })),
    );
  for (const width of [977, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/?scenario=ninepop#/briefing');
    await expect(page.locator('.briefing-grid .briefing-card')).toHaveCount(bundle.cards.length);
    const before = await positions();
    for (const { id } of bundle.cards.slice(0, 5)) {
      await page.locator(`[data-card-id="${id}"] .briefing-card-main`).click();
      await page.getByRole('button', { name: '关闭卡片详情', exact: true }).click();
      await expect(page.locator(`[data-card-id="${id}"]`)).toHaveAttribute('data-read', 'true');
      await expect.poll(positions).toEqual(before);
    }
    await page.getByRole('button', { name: '刷新智能画报', exact: true }).click();
    await expect(page.locator('.briefing-page')).toHaveAttribute('data-refresh-phase', 'idle');
    await expect.poll(positions).toEqual(before);
    await page.reload();
    await expect.poll(positions).toEqual(before);
    await expect(page.locator('[data-recommendation-group="read"], .briefing-read-more')).toHaveCount(0);
    await expect(page.locator('.briefing-grid .briefing-card[data-read="true"]')).toHaveCount(5);
  }
});

test('真实资料导入、来源阅读、应用链接和场景隔离', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('enterprise-ai-demo-v1', '{"keep":"legacy"}'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?scenario=ninepop#/briefing');
  await expect(page).toHaveTitle('9POP · 梦擎工作空间 · Mengine');
  await expect(page.locator('.briefing-grid .briefing-card')).toHaveCount(bundle.cards.length);
  const state = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!), key);
  expect(state.scenario).toBe('ninepop');
  expect(state.materials.length).toBeGreaterThan(90);
  expect(state.records).toHaveLength(0);
  expect(await page.evaluate(() => localStorage.getItem('dreamcore-ninepop-private-snapshot-v1'))).toBeNull();
  const first = bundle.cards[0];
  await page.locator(`[data-card-id="${first.id}"] .briefing-card-main`).click();
  await expect(page.locator('.briefing-detail')).toContainText(first.ai_analysis);
  await expect(page.locator('.briefing-detail')).toContainText(first.editorial.period);
  await expect(page.locator('.briefing-detail')).toContainText('经营分析');
  await expect(page.locator('.briefing-detail')).toContainText(first.boundaries[0]);
  await page.screenshot({ path: '.local/ninepop/card-detail.png', animations: 'disabled' });
  await page.getByRole('button', { name: '关注', exact: true }).click();
  await page.getByRole('button', { name: '关闭卡片详情' }).click();
  await page.reload();
  await expect(page.locator('.briefing-grid .briefing-card')).toHaveCount(bundle.cards.length);
  await page.screenshot({ path: '.local/ninepop/briefing.png', animations: 'disabled' });
  await page.goto('/?scenario=ninepop#/apps/all');
  const link = page.getByRole('link', { name: '打开9POP后台' });
  await expect(link).toHaveAttribute('href', 'https://boss.9pop.top/');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.getByRole('button', { name: '配置9POP健身管理系统' })).toHaveCount(0);
  await page.screenshot({ path: '.local/ninepop/applications.png', animations: 'disabled' });
  const source = state.materials.find((m: any) => m.id === 'ninepop-source-D14');
  await page.goto(`/?scenario=ninepop#/library/${source.space}/${source.id}`);
  await expect(page.locator('.reader-paper')).toContainText('消费券');
  await expect(page.locator('.reader-paper table').first()).toBeVisible();
  await page.screenshot({ path: '.local/ninepop/library.png', animations: 'disabled' });
  await page.goto('/#/briefing');
  await expect(page).toHaveTitle(/空谷无界/);
  await expect(page.locator('.briefing-grid .briefing-card')).toHaveCount(40);
  expect(await page.evaluate(() => localStorage.getItem('enterprise-ai-demo-v1'))).toBe('{"keep":"legacy"}');
  expect((await request.get('/__private-demo/ninepop')).status()).toBe(403);
  expect(
    (
      await request.get('/__private-demo/ninepop', {
        headers: { 'X-Dreamcore-Local-Demo': '1', Origin: 'https://example.com' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (await request.get('/customer-data/9pop-demo-2026-09-24/03-36张卡片数据.json')).status(),
  ).toBeGreaterThanOrEqual(400);
});

test('五店图表在桌面和窄屏完整可读，全部正文无横向溢出', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?scenario=ninepop#/briefing');
  await expect(page.locator('.briefing-grid .briefing-card')).toHaveCount(bundle.cards.length);
  for (const width of [1440, 977, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        page.locator('.briefing-grid .briefing-visual-chart').evaluateAll((charts) =>
          charts.every((chart) => {
            const svg = chart.querySelector('svg')!;
            const box = svg.getBoundingClientRect();
            const footer = chart
              .closest('.briefing-card')!
              .querySelector('.magazine-footer')!
              .getBoundingClientRect();
            return (
              box.bottom <= footer.top + 1 &&
              [...svg.querySelectorAll('text')].every((text) => {
                const r = text.getBoundingClientRect();
                return (
                  r.top >= box.top - 1 &&
                  r.bottom <= box.bottom + 1 &&
                  r.left >= box.left - 1 &&
                  r.right <= box.right + 1
                );
              })
            );
          }),
        ),
      )
      .toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.local/ninepop/overview-${width}.png`, animations: 'disabled' });
  }
  expect(errors).toEqual([]);
});

test('从真实卡片追问只检索有权来源，刷新保留讨论且不生成业务成功状态', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?scenario=ninepop#/briefing');
  const first = bundle.cards[0];
  await page.locator(`[data-card-id="${first.id}"] .briefing-card-main`).click();
  await page.locator('.briefing-detail').getByRole('button', { name: '发起会话', exact: true }).click();
  await page.getByLabel('继续对话', { exact: true }).fill('请解释这张卡的事实依据与判断');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.chat-main')).toContainText('固定快照资料检索 · 未调用实时模型或9POP接口。');
  await expect(page.locator('.chat-main')).toContainText(first.facts[0]);
  const before = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!), key);
  expect(before.records).toHaveLength(0);
  expect(before.requests).toHaveLength(0);
  expect(before.chats).toHaveLength(1);
  await page.reload();
  await expect(page.locator('.chat-main')).toContainText('固定快照资料检索');
  const after = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!), key);
  expect(after.chats).toEqual(before.chats);
  await page.screenshot({ path: '.local/ninepop/conversation.png', animations: 'disabled' });
});

test('经营简报无技术提示，资讯穿插展示且六张真实配图可加载', async ({ page }) => {
  test.setTimeout(60000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?scenario=ninepop#/briefing');
  const cards = page.locator('.briefing-grid .briefing-card');
  await expect(cards).toHaveCount(bundle.cards.length);
  await expect(page.locator('.storage-error[role="note"]')).toHaveCount(0);
  const text = await page.locator('.briefing-grid').innerText();
  expect(text).not.toMatch(/demo|快照|SLA|end_date|raw active|成熟体验队列|贡献了大部分收款降幅/i);
  const ids = await cards.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-card-id')));
  const news = bundle.cards.filter((c: any) => c.type === '资讯');
  const positions = news.map((c: any) => ids.indexOf(c.id)).sort((a: number, b: number) => a - b);
  expect(positions[0]).toBeLessThan(8);
  expect(positions.at(-1) - positions[0]).toBeGreaterThan(20);
  for (const item of news) {
    const card = page.locator(`[data-card-id="${item.id}"]`);
    await card.scrollIntoViewIfNeeded();
    const img = card.locator('img');
    await expect(img).toHaveAttribute('src', item.editorial.photo.src);
    await expect
      .poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), { timeout: 15000 })
      .toBe(true);
    await expect(card.locator('time')).toHaveText(item.editorial.display_date);
    await expect(card.locator('.briefing-source')).toHaveText(item.editorial.source_label);
  }
  await page
    .locator(`[data-card-id="${news[0].id}"]`)
    .screenshot({ path: '.local/ninepop/news-card.png', animations: 'disabled' });
  await page.reload();
  await expect(cards).toHaveCount(bundle.cards.length);
  await expect(page.locator(`[data-card-id="${news[0].id}"] h3`)).toHaveText(news[0].title);
});

test('七种图形保留真实读数，小屏标签不重叠，详情沿用同一张图', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?scenario=ninepop#/briefing');
  const charts = page.locator('.briefing-grid .briefing-visual-chart');
  await expect(charts).toHaveCount(7);
  expect(
    (await charts.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-chart-kind')))).sort(),
  ).toEqual(['columns', 'diverging', 'bars', 'donut', 'funnel', 'unit-grid', 'progress'].sort());
  const orders = bundle.cards.find((c: any) => c.id.endsWith('C18')).data[0];
  const grid = page.locator('[data-chart-kind="unit-grid"]');
  // Each cell is one order; legends have no title, and are excluded from this count.
  await expect(grid.locator('rect:has(title)')).toHaveCount(Number(orders.paid_formal_orders));
  await expect(grid.locator('rect[fill="#356cd4"]:has(title)')).toHaveCount(
    Number(orders.orders_with_prior_paid_order),
  );
  for (const width of [1440, 977, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        charts.evaluateAll((nodes) =>
          nodes.flatMap((node) => {
            const labels = [...node.querySelectorAll('svg text')].map((el) => ({
              text: el.textContent,
              box: el.getBoundingClientRect(),
            }));
            return labels.flatMap((a, i) =>
              labels
                .slice(i + 1)
                .flatMap((b) =>
                  Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left) > 1 &&
                  Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top) > 1
                    ? [`${node.getAttribute('data-chart-kind')}: ${a.text} / ${b.text}`]
                    : [],
                ),
            );
          }),
        ),
      )
      .toEqual([]);
    if (width !== 1440) {
      for (const chart of await charts.all()) {
        const kind = await chart.getAttribute('data-chart-kind');
        await chart
          .locator('..')
          .locator('..')
          .locator('..')
          .locator('..')
          .screenshot({
            path: `.local/ninepop/chart-${kind}-${width}.png`,
            animations: 'disabled',
          });
      }
    }
  }
  const conversion = bundle.cards.find((c: any) => c.id.endsWith('C16'));
  await page.locator(`[data-card-id="${conversion.id}"] .briefing-card-main`).click();
  await expect(page.locator('.briefing-detail [data-chart-kind="funnel"]')).toHaveCount(1);
  for (const store of conversion.data) {
    await expect(page.locator('.briefing-detail .briefing-visual-chart svg')).toContainText(store.name);
  }
  await page.screenshot({ path: '.local/ninepop/chart-detail-mobile.png', animations: 'disabled' });
});
