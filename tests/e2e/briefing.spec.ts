import { test, expect, type Page } from '@playwright/test';
const state = (p: Page) => p.evaluate(() => JSON.parse(localStorage.getItem('enterprise-ai-demo-v1')!));
const card = (p: Page, id: string) => p.locator(`.briefing-card[data-card-id="${id}"]`);
const main = (p: Page, id: string) => card(p, id).locator('.briefing-card-main');
const openMenu = async (p: Page, id: string) => {
  await card(p, id).hover();
  await card(p, id)
    .getByRole('button', { name: /^卡片操作 / })
    .click();
};
const go = (p: Page) => p.goto('/#/briefing');
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await go(page);
});

test('默认最新、跨日分隔与类型空间筛选，卡片无多余业务按钮', async ({ page }) => {
  await expect(page.getByRole('tab', { name: '最新', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(await page.locator('.briefing-date-divider').count()).toBeGreaterThanOrEqual(3);
  await expect(page.locator('.briefing-page')).not.toContainText('查看明细');
  await expect(page.locator('.briefing-page')).not.toContainText('继续讨论');
  const data = await state(page);
  const cards = data.briefing.cards.filter((c: any) => c.active);
  expect(new Set(cards.map((c: any) => c.data.type)).size).toBe(8);
  await page.getByRole('tab', { name: '类型', exact: true }).click();
  await page.getByRole('button', { name: '维护优化', exact: true }).click();
  await expect(page.locator('.briefing-grid .briefing-card')).toHaveCount(3);
  await expect(card(page, 'dream')).toBeVisible();
  await page.getByRole('tab', { name: '空间', exact: true }).click();
  await page.getByLabel('画报工作空间').selectOption('project-delivery');
  await expect(page.locator('.briefing-grid .briefing-card')).toHaveCount(9);
  await expect(card(page, 'project:project-delivery')).toBeVisible();
});

test('固定保留最新，关闭不删除事项和会话，可恢复并持续复用内容会话', async ({ page }) => {
  const before = (await state(page)).briefing.cards.find((c: any) => c.id === 'dream').updatedAt;
  await card(page, 'dream').hover();
  await card(page, 'dream')
    .getByRole('button', { name: /^固定到关注 / })
    .click();
  await expect(main(page, 'dream')).toBeVisible();
  expect((await state(page)).briefing.cards.find((c: any) => c.id === 'dream').chatId).toBeUndefined();
  await page.getByRole('tab', { name: '关注', exact: true }).click();
  await expect(page.locator('.briefing-grid .briefing-card')).toHaveCount(1);
  await main(page, 'dream').click();
  const url = page.url();
  await expect(page.getByRole('button', { name: '按当前方案处理', exact: true })).toBeVisible();
  await go(page);
  await expect(page.getByRole('tab', { name: '关注', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: '最新', exact: true }).click();
  await expect(card(page, 'dream').getByRole('img', { name: '已有会话', exact: true })).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-briefing-slide');
  expect(await card(page, 'dream').evaluate((c) => getComputedStyle(c).borderColor)).toBe(
    await card(page, 'followup-todo').evaluate((c) => getComputedStyle(c).borderColor),
  );
  await openMenu(page, 'dream');
  await page.getByRole('button', { name: '隐藏卡片', exact: true }).click();
  await expect(card(page, 'dream')).toHaveCount(0);
  let s = await state(page);
  expect(s.dream.status).toBe('pending');
  expect(s.briefing.cards.find((c: any) => c.id === 'dream').updatedAt).toBe(before);
  await page.getByRole('button', { name: /查看 .* 已隐藏卡片/ }).click();
  await page.getByRole('button', { name: '恢复 本周资料整理', exact: true }).click();
  await page.getByRole('tab', { name: '最新', exact: true }).click();
  await main(page, 'dream').click();
  await expect(page).toHaveURL(url);
  await page.reload();
  s = await state(page);
  expect(s.briefing.cards.find((c: any) => c.id === 'dream').pinned).toBe(true);
  expect(s.chats.filter((c: any) => c.kind === 'dream')).toHaveLength(1);
});

test('独立优化会话解析草案、预览保存与刷新恢复，不制造内容已读状态', async ({ page }) => {
  const old = (await state(page)).briefing.cards.find((c: any) => c.id === 'followup:personal');
  await openMenu(page, 'followup:personal');
  await page.getByRole('button', { name: '让 AI 优化卡片', exact: true }).click();
  const url = page.url();
  await page.getByLabel('继续对话').fill('改成 1×2，精简一点，标题改为我的进展');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByLabel('卡片标题', { exact: true })).toHaveValue('我的进展');
  await expect(page.getByLabel('卡片尺寸', { exact: true })).toHaveValue('1×2');
  expect((await state(page)).briefing.cards.find((c: any) => c.id === old.id).config).toBeUndefined();
  await page.getByRole('button', { name: '保存卡片样式', exact: true }).click();
  await page.getByRole('button', { name: '返回智能画报', exact: true }).click();
  await expect(card(page, old.id)).toHaveAttribute('data-size', '1×2');
  await expect(card(page, old.id).getByRole('img', { name: '已有会话', exact: true })).toHaveCount(0);
  await expect(card(page, old.id).getByRole('heading')).toHaveText('我的进展');
  await page.reload();
  expect((await state(page)).briefing.cards.find((c: any) => c.id === old.id).updatedAt).toBe(old.updatedAt);
  await openMenu(page, old.id);
  await page.getByRole('button', { name: '让 AI 优化卡片', exact: true }).click();
  await expect(page).toHaveURL(url);
});

test('留存快照与最新结果区分，回看不恢复旧任务状态', async ({ page }) => {
  // Simulate a previously observed day; do not invent unobserved snapshots in product code.
  await page.evaluate(() => {
    const key = 'enterprise-ai-demo-v1';
    const s = JSON.parse(localStorage.getItem(key)!);
    const c = s.briefing.cards.find((x: any) => x.id === 'dream');
    c.updatedAt = '2026-09-18T01:00:00.000Z';
    c.history[0].at = c.updatedAt;
    localStorage.setItem(key, JSON.stringify(s));
  });
  await page.reload();
  await main(page, 'dream').click();
  await page.getByRole('button', { name: '按当前方案处理', exact: true }).click();
  await go(page);
  await expect(card(page, 'dream')).toContainText('已按月份归类');
  await page.getByRole('tab', { name: '日期', exact: true }).click();
  await page.getByLabel('回看日期', { exact: true }).fill('2026-09-18');
  await expect(card(page, 'dream')).toContainText('等待确认');
  await main(page, 'dream').click();
  await expect(
    page.getByText('来源已有更新，上方讨论仍保留当时内容。下方事项操作使用当前状态。', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('已完成当前批次', { exact: true })).toBeVisible();
  expect((await state(page)).dream.status).toBe('done');
});

test('卡片键盘与触屏操作可达，四种规格及窄屏没有正文溢出', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await main(page, 'dream').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/chat\//);
  await go(page);
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await expect
      .poll(() =>
        page
          .locator('.briefing-card-main')
          .evaluateAll((cs) =>
            cs
              .filter((c) => c.scrollHeight > c.clientHeight + 2)
              .map((c) => c.parentElement!.getAttribute('data-card-id')),
          ),
      )
      .toEqual([]);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  for (const size of ['1×1', '2×1', '1×2', '2×2']) {
    const handle = card(page, 'followup:personal').locator('.briefing-resize-handle');
    await handle.focus();
    await handle.press(size[0] === '1' ? 'ArrowLeft' : 'ArrowRight');
    await handle.press(size[2] === '1' ? 'ArrowUp' : 'ArrowDown');
    await expect(card(page, 'followup:personal')).toHaveAttribute('data-size', size);
    await expect
      .poll(() => main(page, 'followup:personal').evaluate((c) => c.scrollHeight <= c.clientHeight + 2))
      .toBe(true);
  }
  expect(errors).toEqual([]);
});

test('资讯真实配图加载与失败回退，项目成员叠放且操作不遮挡头像', async ({ page }) => {
  const news = card(page, 'news:direction');
  const photo = news.locator('.briefing-news-photo img');
  await photo.scrollIntoViewIfNeeded();
  await expect.poll(() => photo.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(news).toContainText('合成资讯样例');
  await expect(news).toContainText('Brooke Cagle / Unsplash');
  const project = card(page, 'project:project-delivery');
  await expect(project.getByRole('group', { name: '当前项目成员' })).toBeVisible();
  await expect(project.getByRole('img', { name: '许然', exact: true })).toBeVisible();
  await expect(project.getByRole('img', { name: '另有 1 人：周宁', exact: true })).toBeVisible();
  await expect(card(page, 'finance:demo-receipts').locator('.briefing-people')).toHaveCount(0);
  const restingPeople = (await project.locator('.briefing-people-trigger').boundingBox())!;
  await project.hover();
  await expect
    .poll(async () => {
      const people = (await project.locator('.briefing-people-trigger').boundingBox())!;
      const tools = (await project.locator('.briefing-card-tools').boundingBox())!;
      return tools.x - people.x - people.width;
    })
    .toBeGreaterThanOrEqual(6);
  const peopleBounds = (await project.locator('.briefing-people-trigger').boundingBox())!;
  const toolsBounds = await project.locator('.briefing-card-tools').boundingBox();
  expect(peopleBounds.x).toBeLessThan(restingPeople.x - 20);
  expect(toolsBounds!.y - (await project.boundingBox())!.y).toBeLessThan(22);
  await project.getByRole('button', { name: /^卡片操作 / }).click();
  await expect(page.getByRole('button', { name: '让 AI 优化卡片', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await project.locator('.briefing-card-main').click();
  await expect(page).toHaveURL(/#\/chat\//);
  await page.route('**/images/briefing/team-collaboration.jpg', (route) => route.abort());
  await go(page);
  await page.reload(); // Force a new image request even when the background page stays mounted.
  await news.scrollIntoViewIfNeeded();
  await expect(news.getByRole('img', { name: '资讯配图暂不可用' })).toBeVisible();
  await expect(news.getByRole('heading')).toHaveText('从回答问题，到持续参与工作');
  await news.locator('.briefing-card-main').click();
  await expect(page).toHaveURL(/#\/chat\//);
});

test('文档封面覆盖来源和关联资料，多份叠放且会话继续展示同一组文档', async ({ page }) => {
  // Enlarge the risk summary so there is room for its linked document covers.
  const riskHandle = card(page, 'risk:expired').getByRole('button', { name: /^调整 .* 大小/ });
  await riskHandle.focus();
  await page.keyboard.press('ArrowRight');
  await card(page, 'insight:guide')
    .getByRole('button', { name: /^调整 .* 大小/ })
    .focus();
  await page.keyboard.press('ArrowRight');
  const proposal = card(page, 'deliverable:proposal');
  await expect(proposal.locator('.briefing-document-cover')).toHaveCount(3);
  await expect(proposal.getByRole('img', { name: '文档封面：客户 A 合作方案', exact: true })).toBeVisible();
  await expect(proposal.locator('.briefing-document-count')).toHaveText('3 份');
  await expect(
    card(page, 'risk:expired').getByRole('img', { name: '文档封面：历史报价说明', exact: true }),
  ).toBeVisible();
  await expect(card(page, 'insight:guide').getByRole('img', { name: /文档封面/ })).toBeVisible();
  await expect(card(page, 'insight:guide').locator('.briefing-document-cover')).toHaveCount(1);
  await expect(card(page, 'insight:guide').locator('.briefing-document-cover')).toHaveCSS(
    'transform',
    'none',
  );
  await expect(proposal.locator('.briefing-document-cover').first()).not.toHaveCSS('transform', 'none');
  await expect(card(page, 'news:direction').locator('.briefing-document-cover')).toHaveCount(0);
  await main(page, 'deliverable:proposal').click();
  await expect(
    page.getByRole('region', { name: '会话中的画报原卡片' }).locator('.briefing-document-cover'),
  ).toHaveCount(3);
});

test('人员悬浮展开完整姓名，键盘可查看和收起，查看人员不打开会话', async ({ page }) => {
  const project = card(page, 'project:project-delivery');
  const trigger = project.getByRole('button', { name: '查看项目成员，共 4 人' });
  const list = project.getByRole('region', { name: '项目成员姓名' });
  const before = (await state(page)).chats.length;
  await project.hover();
  await project.getByRole('img', { name: '许然', exact: true }).hover();
  await expect(list).toBeVisible();
  await expect(list.locator('li > span:last-child')).toHaveText(['许然', '曹鸿健', '陈言', '周宁']);
  await list.getByText('周宁', { exact: true }).hover();
  await expect(list).toBeVisible();
  await list.getByText('周宁', { exact: true }).click();
  await expect(page).toHaveURL(/#\/briefing$/);
  expect((await state(page)).chats.length).toBe(before);
  await page.mouse.move(100, 40);
  await expect(list).toHaveCount(0);
  await trigger.focus();
  await page.keyboard.press('Enter');
  // Focus itself may already open the list; Enter toggles it.
  if ((await trigger.getAttribute('aria-expanded')) === 'false') await page.keyboard.press('Enter');
  await expect(list).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await main(page, 'project:project-delivery').click();
  await expect(page).toHaveURL(/#\/chat\//);
});

test('触屏点击人员可查看姓名，窄屏文档叠放与浮层不溢出', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 320, height: 844 } });
  const page = await context.newPage();
  await page.goto('/#/briefing');
  const project = card(page, 'project:project-delivery');
  const trigger = project.getByRole('button', { name: '查看项目成员，共 4 人' });
  await trigger.tap();
  const list = project.getByRole('region', { name: '项目成员姓名' });
  await expect(list).toBeVisible();
  const people = (await trigger.boundingBox())!;
  const tools = (await project.locator('.briefing-card-tools').boundingBox())!;
  expect(tools.x).toBeGreaterThanOrEqual(people.x + people.width + 6);
  expect(tools.y - (await project.boundingBox())!.y).toBeLessThan(22);
  const bounds = (await list.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  await expect(page).toHaveURL(/#\/briefing$/);
  await trigger.tap();
  await expect(list).toHaveCount(0);
  const proposal = card(page, 'deliverable:proposal');
  await proposal.scrollIntoViewIfNeeded();
  await expect.poll(() => proposal.evaluate((el) => el.scrollWidth <= el.clientWidth + 2)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.close();
});
