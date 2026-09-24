import { test, expect, type Page } from '@playwright/test';
const key = 'enterprise-ai-demo-konggu-v1';
const state = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
const conversationCards = (page: Page) => page.locator('.briefing-grid .template-conversation');
async function toBriefing(page: Page) {
  await page.getByRole('navigation').getByRole('button', { name: '智能画报', exact: true }).click();
  await expect(page).toHaveURL(/#\/briefing$/);
  await expect(page.locator('.conversation-overlay')).toHaveCount(0);
  await page.getByRole('button', { name: '刷新智能画报（演示）', exact: true }).click();
  await expect(page.locator('.briefing-page')).toHaveAttribute('data-refresh-phase', 'idle');
}
test.beforeEach(async ({ page }) => {
  await page.goto('/#/briefing');
});

test('各画报视图暂时隐藏会话类型与正在跟进栏，保留原会话、卡片与关注状态', async ({ page }) => {
  // Seed existing followed/hidden conversation records to exercise all previously reachable surfaces.
  await page.evaluate((key) => {
    const s = JSON.parse(localStorage.getItem(key)!);
    s.briefing.cards.find((c: any) => c.id === 'conversation:kg-review').pinned = true;
    s.briefing.cards.find((c: any) => c.id === 'conversation:kg-development').hidden = true;
    s.briefing.cards.find((c: any) => c.id === 'konggu:C01').pinned = true;
    localStorage.setItem(key, JSON.stringify(s));
  }, key);
  await page.reload();
  const before = await state(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of ['推荐', '关注', '日期', '类型', '空间']) {
      await page.getByRole('tab', { name, exact: true }).click();
      await expect(conversationCards(page)).toHaveCount(0);
      await expect(page.locator('.briefing-grid .magazine-会话')).toHaveCount(0);
      await expect(page.locator('[data-recommendation-group="priority"]')).toHaveCount(0);
      await expect(page.getByText('正在跟进', { exact: true })).toHaveCount(0);
      await expect(page.locator('[data-card-id="konggu:C01"]')).toHaveCount(1);
      if (name === '类型')
        await expect(page.getByLabel('内容类型').getByRole('button')).toHaveText([
          '全部',
          '资讯',
          '数据',
          '洞察',
          '建议',
          '成果',
        ]);
    }
  }
  const after = await state(page);
  expect(after.chats).toEqual(before.chats);
  expect(after.briefing.cards).toEqual(before.briefing.cards);
});

test('新建会话可继续使用，返回或刷新画报后不再显示会话卡片', async ({ page }) => {
  await page.getByRole('navigation').getByRole('button', { name: '会话', exact: true }).click();
  await page.getByLabel('描述你的工作需求').fill('帮我核对新品甜度与试饮计划');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page).toHaveURL(/#\/chat\//);
  const chat = (await state(page)).chats[0];
  expect(chat.origin).toBe('conversation');
  await toBriefing(page);
  await expect(conversationCards(page)).toHaveCount(0);
  await page.reload();
  await expect(conversationCards(page)).toHaveCount(0);
  // Hiding the magazine surface does not archive or delete the conversation.
  await page.goto(`/#/chat/${chat.id}`);
  await expect(page.getByLabel('继续对话', { exact: true })).toBeVisible();
  expect((await state(page)).chats.find((c: any) => c.id === chat.id)).toEqual(chat);
  await page.getByLabel('继续对话', { exact: true }).fill('再核对经营销售金额');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await toBriefing(page);
  await expect(conversationCards(page)).toHaveCount(0);
  expect((await state(page)).chats.find((c: any) => c.id === chat.id).messages.length).toBeGreaterThan(
    chat.messages.length,
  );
});

test('普通画报仍可发起及优化会话，已有会话入口保留且不丢失原卡', async ({ page }) => {
  const original = page.locator('[data-card-id="konggu:C01"]');
  await original.locator('.briefing-card-main').click();
  await page.locator('.briefing-detail').getByRole('button', { name: '发起会话', exact: true }).click();
  await page.getByLabel('继续对话', { exact: true }).fill('请核对销售增长');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await toBriefing(page);
  await expect(conversationCards(page)).toHaveCount(0);
  await expect(original.getByRole('img', { name: '已有会话' })).toBeVisible();
  await original.locator('.briefing-card-main').click();
  await page.locator('.briefing-detail').getByRole('button', { name: '没用', exact: true }).click();
  await page.getByRole('button', { name: '告诉 AI 如何优化', exact: true }).click();
  await expect(page.getByLabel('卡片调整上下文')).toBeVisible();
  await toBriefing(page);
  await expect(conversationCards(page)).toHaveCount(0);
  await expect(original).toHaveCount(1);
});
