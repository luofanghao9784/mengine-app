import { test, expect, type Page } from '@playwright/test';
const key = 'enterprise-ai-demo-konggu-v1';
const state = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
const settled = (page: Page) =>
  expect
    .poll(() =>
      page
        .locator('.briefing-grid .briefing-card')
        .evaluateAll(
          (elements) =>
            elements
              .flatMap((element) => element.getAnimations())
              .filter((animation) => animation.playState === 'running').length,
        ),
    )
    .toBe(0);
const cards = (page: Page) => page.locator('.briefing-grid .template-conversation');
const card = (page: Page, id: string) => page.locator(`.briefing-grid [data-card-id="conversation:${id}"]`);
async function toBriefing(page: Page) {
  await page.getByRole('navigation').getByRole('button', { name: '智能画报', exact: true }).click();
  await expect(page).toHaveURL(/#\/briefing$/);
  await expect(page.locator('.conversation-overlay')).toHaveCount(0);
  if (await page.getByRole('button', { name: '关闭卡片详情' }).count())
    await page.getByRole('button', { name: '关闭卡片详情' }).click();
  await page.getByRole('button', { name: '刷新智能画报（演示）', exact: true }).click();
  await expect(page.locator('.briefing-page')).toHaveAttribute('data-refresh-phase', 'idle');
}
async function newChat(page: Page, text: string) {
  await page.getByRole('navigation').getByRole('button', { name: '会话', exact: true }).click();
  const before = (await state(page)).chats.length;
  await page.getByLabel('描述你的工作需求').fill(text);
  expect((await state(page)).chats.length).toBe(before);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page).toHaveURL(/#\/chat\//);
  const chat = (await state(page)).chats[0];
  expect(chat.origin).toBe('conversation');
  await toBriefing(page);
  return chat;
}
test.beforeEach(async ({ page }) => {
  await page.goto('/#/briefing');
});

test('会话入口发送后显示最新回复卡片，点击复用原会话且持续更新一张卡', async ({ page }) => {
  const count = await cards(page).count();
  const chat = await newChat(page, '帮我核对新品甜度与试饮计划');
  const c = card(page, chat.id);
  await expect(cards(page)).toHaveCount(count + 1);
  await expect(page.locator('.briefing-grid .briefing-card').first()).toHaveAttribute(
    'data-card-id',
    `conversation:${chat.id}`,
  );
  const firstReply = chat.messages.at(-1).text;
  await expect(c.locator('.briefing-reply-preview')).toHaveText(firstReply);
  await expect(c).toContainText('AI 最新回复');
  await expect(c).not.toContainText('继续对话');
  await expect(c.getByRole('img', { name: '已有会话' })).toBeVisible();
  const before = await state(page);
  await c.locator('.briefing-card-main').click();
  await page.locator('.briefing-detail').getByRole('button', { name: '发起会话', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/chat/${chat.id}$`));
  const reopened = await state(page);
  expect(reopened.chats).toEqual(before.chats);
  await expect(page.locator('.briefing-origin-card')).toHaveCount(0);
  await page.getByLabel('继续对话', { exact: true }).fill('再核对经营销售金额');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await toBriefing(page);
  const updated = (await state(page)).chats.find((item: any) => item.id === chat.id);
  expect(updated.messages.at(-1).text).not.toBe(firstReply);
  expect(updated.briefingContext).toBeUndefined();
  await expect(c.locator('.briefing-reply-preview')).toHaveText(updated.messages.at(-1).text);
  await expect(cards(page)).toHaveCount(count + 1);
  await page.reload();
  await expect(c.locator('.briefing-reply-preview')).toHaveText(updated.messages.at(-1).text);
  await settled(page);
  await page.screenshot({ path: '.local/briefing-conversations/desktop.png' });
});

test('画报拓展和优化会话不重复生成，会话类型和归档退出可用', async ({ page }) => {
  const count = await cards(page).count();
  const original = page.locator('[data-card-id="konggu:C01"]');
  await original.locator('.briefing-card-main').click();
  await page.locator('.briefing-detail').getByRole('button', { name: '发起会话', exact: true }).click();
  await page.getByLabel('继续对话', { exact: true }).fill('请核对销售增长');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await toBriefing(page);
  await expect(cards(page)).toHaveCount(count);
  await original.locator('.briefing-card-main').click();
  await page.locator('.briefing-detail').getByRole('button', { name: '没用', exact: true }).click();
  await page.getByRole('button', { name: '告诉 AI 如何优化', exact: true }).click();
  await expect(page.getByLabel('卡片调整上下文')).toBeVisible();
  await toBriefing(page);
  await expect(cards(page)).toHaveCount(count);
  await page.getByRole('tab', { name: '类型', exact: true }).click();
  await page.getByLabel('内容类型').getByRole('button', { name: '会话', exact: true }).click();
  await expect(page.locator('.briefing-grid .briefing-card')).toHaveCount(count);
  await card(page, 'kg-review').locator('.briefing-card-main').click();
  await page.locator('.briefing-detail').getByRole('button', { name: '发起会话', exact: true }).click();
  await page.getByRole('button', { name: '会话选项', exact: true }).click();
  await page.getByRole('button', { name: '归档会话', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认并继续', exact: true }).click();
  await toBriefing(page);
  await expect(card(page, 'kg-review')).toHaveCount(0);
  expect((await state(page)).chats.find((c: any) => c.id === 'kg-review').archived).toBe(true);
});

test('自动排列下新会话和新回复在刷新后前移，隐藏和原会话分别保留', async ({ page }) => {
  const older = await newChat(page, '第一次核对销售金额');
  const newer = await newChat(page, '第二次核对采购库存');
  const c = card(page, older.id);
  await expect(page.locator('.briefing-resize-handle')).toHaveCount(0);
  await c.locator('.briefing-card-main').click();
  await page.locator('.briefing-detail').getByRole('button', { name: '发起会话', exact: true }).click();
  await page.getByLabel('继续对话', { exact: true }).fill('现在核对读书会活动');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await toBriefing(page);
  await expect(cards(page).first()).toHaveAttribute('data-card-id', `conversation:${older.id}`);
  const latest = await newChat(page, '第三次核对顾客回访');
  await expect(cards(page).first()).toHaveAttribute('data-card-id', `conversation:${latest.id}`);
  // Historical hidden records remain respected after the grid's old menu is removed.
  await page.evaluate(
    ({ key, id }) => {
      const s = JSON.parse(localStorage.getItem(key)!);
      s.briefing.cards.find((c: any) => c.id === `conversation:${id}`).hidden = true;
      localStorage.setItem(key, JSON.stringify(s));
    },
    { key, id: older.id },
  );
  await page.reload();
  await expect(c).toHaveCount(0);
  const snapshot = await state(page);
  expect(snapshot.chats.find((item: any) => item.id === older.id).archived).toBe(false);
  await page.reload();
  await expect(c).toHaveCount(0);
  await expect(card(page, newer.id)).toHaveCount(1);
});

test('手机会话卡片内容不溢出，详情进入会话可用', async ({ browser }) => {
  const context = await browser.newContext({
    isMobile: true,
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto('/#/briefing');
  const c = card(page, 'kg-review');
  await expect(c).toBeVisible();
  for (const width of [390, 320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => c.evaluate((el) => el.scrollWidth <= el.clientWidth + 2)).toBe(true);
    expect(await c.locator('.briefing-card-main').evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(
      true,
    );
  }
  await settled(page);
  await page.screenshot({ path: '.local/briefing-conversations/mobile.png' });
  await c.locator('.briefing-card-main').tap();
  await page.locator('.briefing-detail').getByRole('button', { name: '发起会话', exact: true }).tap();
  await expect(page).toHaveURL(/#\/chat\/kg-review$/);
  expect((await state(page)).chats).toHaveLength(3);
  await context.close();
});
