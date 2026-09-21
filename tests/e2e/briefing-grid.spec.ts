import { test, expect, type Page } from '@playwright/test';

const key = 'enterprise-ai-demo-v1';
const card = (page: Page, id: string) => page.locator(`.briefing-grid [data-card-id="${id}"]`);
const hide = async (page: Page, id: string) => {
  await card(page, id).hover();
  await card(page, id)
    .getByRole('button', { name: /^卡片操作 / })
    .click();
  await page.getByRole('button', { name: '隐藏卡片', exact: true }).click();
};

async function verifyGrid(page: Page) {
  await expect
    .poll(() =>
      page.locator('.briefing-grid').evaluateAll((grids) => {
        const errors: string[] = [];
        for (const grid of grids) {
          const style = getComputedStyle(grid);
          const columns = style.gridTemplateColumns.split(' ').map(Number.parseFloat);
          const unit = Number.parseFloat(style.gridAutoRows);
          const gap = Number.parseFloat(style.gap);
          if (Math.abs(columns[0] - unit) > 1) errors.push('cell is not square');
          for (const item of grid.children) {
            const [width, height] = item.getAttribute('data-size')!.split('×').map(Number);
            const bounds = item.getBoundingClientRect();
            const id = item.getAttribute('data-card-id') || 'hidden';
            if (
              Math.abs(bounds.width - (unit * width + gap * (width - 1))) > 1 ||
              Math.abs(bounds.height - (unit * height + gap * (height - 1))) > 1
            )
              errors.push(`${id}: nonstandard size`);
            const source = item.querySelector('.briefing-source');
            if (!source) continue;
            const bottom = source.getBoundingClientRect().top;
            const content = item.querySelector('.briefing-designed, .briefing-card-content')!;
            const leafBlocks = content.querySelectorAll(
              'h3, .briefing-fact, .briefing-advice, .briefing-chart, .briefing-items, .briefing-trend, .briefing-document-stack, .briefing-project-state, .briefing-evidence, .briefing-primary-advice, .briefing-reasoning, .briefing-visual-chart, .briefing-takeaway',
            );
            for (const block of leafBlocks) {
              if (
                getComputedStyle(block).display !== 'none' &&
                block.getBoundingClientRect().height > 0 &&
                block.getBoundingClientRect().bottom > bottom + 1
              )
                errors.push(
                  `${innerWidth}px / ${item.getAttribute('data-size')} / ${id}: ${block.className || block.tagName} collides with source by ${Math.ceil(block.getBoundingClientRect().bottom - bottom)}px`,
                );
            }
          }
        }
        return errors;
      }),
    )
    .toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/#/briefing');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('桌面五格，四种规格严格使用正方形单元，缩放不撑高行或改写保存设置', async ({ page }) => {
  await page.setViewportSize({ width: 1418, height: 852 });
  await expect
    .poll(() =>
      page
        .locator('.briefing-grid')
        .first()
        .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length),
    )
    .toBe(5);
  const original = await page.evaluate((key) => localStorage.getItem(key), key);
  for (const width of [1418, 1280, 1024, 768, 540, 390, 320]) {
    await page.setViewportSize({ width, height: 852 });
    await verifyGrid(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(original);
  await page.setViewportSize({ width: 1418, height: 852 });
  // Every template can be manually resized. Exercise all supported sizes, including photo and document cards.
  for (const size of ['1×1', '2×1', '1×2', '2×2']) {
    await page.evaluate(
      ({ key, size }) => {
        const state = JSON.parse(localStorage.getItem(key)!);
        for (const card of state.briefing.cards)
          card.config = { size, title: card.data.title, compact: false };
        localStorage.setItem(key, JSON.stringify(state));
      },
      { key, size },
    );
    await page.reload();
    await verifyGrid(page);
  }
});

test('隐藏按原日期收成末尾一格，支持整日隐藏、键盘查看与逐张恢复', async ({ page }) => {
  const before = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
  await hide(page, 'dream');
  await hide(page, 'followup-todo');
  await hide(page, 'news:direction');
  const oldest = before.briefing.cards.filter(
    (c: any) => c.id.startsWith('demo:') && c.updatedAt.startsWith('2026-09-17'),
  );
  for (const c of oldest) await hide(page, c.id);
  await expect(page.locator('.briefing-closed-toggle')).toHaveCount(0);
  await expect(page.locator('.briefing-hidden-pile')).toHaveCount(3);
  await expect(page.locator('.briefing-hidden-label')).toHaveText(['已隐藏', '已隐藏', '已隐藏']);
  await expect(page.locator('.briefing-hidden-pile[data-size="1×1"]')).toHaveCount(3);
  const groups = page.locator('.briefing-date-group');
  for (const group of await groups.filter({ has: page.locator('.briefing-hidden-pile') }).all())
    await expect(group.locator('.briefing-grid > :last-child')).toHaveClass('briefing-hidden-pile');
  await expect(groups.last().locator('.briefing-card')).toHaveCount(0);
  expect(
    await page
      .locator('.briefing-hidden-preview')
      .first()
      .evaluate((el) => getComputedStyle(el).filter),
  ).toMatch(/blur/);
  await verifyGrid(page);
  const pile = page.getByRole('button', { name: /查看 .* 已隐藏卡片，共 2 则/ });
  await pile.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pile).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '恢复 本周资料整理', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '恢复 下一次沟通，先排好', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(card(page, 'dream')).toBeVisible();
  await expect(page.locator('.briefing-hidden-pile')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('.briefing-hidden-pile')).toHaveCount(2);
  const after = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
  expect(after.dream).toEqual(before.dream);
  expect(after.chats).toEqual(before.chats);
  for (const old of before.briefing.cards) {
    const current = after.briefing.cards.find((c: any) => c.id === old.id);
    expect(current.history).toEqual(old.history);
    expect(current.updatedAt).toEqual(old.updatedAt);
  }
  await page.getByRole('tab', { name: '空间', exact: true }).click();
  await page.getByLabel('画报工作空间').selectOption('project-delivery');
  await expect(page.locator('.briefing-hidden-pile')).toHaveCount(0);
});

test('资讯照片铺满卡片，已有会话使用重点色描边气泡', async ({ page }) => {
  const news = card(page, 'news:direction');
  await news.scrollIntoViewIfNeeded();
  const photo = news.locator('.briefing-news-photo');
  const cardBounds = (await news.boundingBox())!;
  const photoBounds = (await photo.boundingBox())!;
  expect(Math.abs(photoBounds.x - cardBounds.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(photoBounds.y - cardBounds.y)).toBeLessThanOrEqual(1);
  expect(photoBounds.width).toBeGreaterThan(cardBounds.width - 3);
  expect(photoBounds.height).toBeGreaterThan(cardBounds.height - 3);
  await news.locator('.briefing-card-main').click();
  await page.getByRole('button', { name: '关闭会话', exact: true }).click();
  await expect(news.locator('.briefing-conversation-mark svg')).toHaveAttribute('fill', 'none');
  await expect(page.locator('.briefing-footer')).toHaveCount(0);
});
