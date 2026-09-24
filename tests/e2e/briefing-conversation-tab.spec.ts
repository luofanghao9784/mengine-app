import { test, expect, type Page } from '@playwright/test';
const key = 'enterprise-ai-demo-konggu-v1';
const state = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
const cards = (page: Page) => page.locator('.briefing-grid .briefing-card');
const card = (page: Page, id: string) => page.locator(`.briefing-grid [data-card-id="${id}"]`);
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
async function closeChat(page: Page) {
  await page.getByRole('button', { name: '关闭会话', exact: true }).click();
  await expect(page.locator('.conversation-overlay')).toHaveCount(0);
}
async function reply(page: Page, text: string) {
  await page.getByLabel('继续对话', { exact: true }).fill(text);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
}

test('日期替换为会话，原卡和独立会话汇总，最新回复前移且返回保留分栏', async ({ page }) => {
  await page.goto('/#/briefing');
  await expect(page.getByRole('tab')).toHaveText(['最新', '关注', '会话', '类型', '空间']);
  await tab(page, '会话').click();
  await expect(cards(page)).toHaveCount(3);
  await expect(page.getByLabel('回看日期', { exact: true })).toHaveCount(0);
  const initial = await state(page);
  await tab(page, '最新').click();
  await card(page, 'konggu:C01').locator('.briefing-card-main').click();
  await closeChat(page);
  await tab(page, '会话').click();
  await expect(cards(page)).toHaveCount(4);
  await expect(cards(page).last()).toHaveAttribute('data-card-id', 'konggu:C01');
  await card(page, 'konggu:C01').locator('.briefing-card-main').click();
  await reply(page, '请核对最新销售金额');
  await closeChat(page);
  await expect(tab(page, '会话')).toHaveAttribute('aria-selected', 'true');
  await expect(cards(page).first()).toHaveAttribute('data-card-id', 'konggu:C01');
  await card(page, 'conversation:kg-review').locator('.briefing-card-main').click();
  await closeChat(page);
  await expect(cards(page).first()).toHaveAttribute('data-card-id', 'konggu:C01');
  await card(page, 'conversation:kg-review').locator('.briefing-card-main').click();
  await reply(page, '进一步核对库存');
  await closeChat(page);
  await expect(cards(page).first()).toHaveAttribute('data-card-id', 'conversation:kg-review');
  const after = await state(page);
  const original = initial.briefing.cards.find((c: any) => c.id === 'konggu:C01');
  const updated = after.briefing.cards.find((c: any) => c.id === 'konggu:C01');
  expect(updated.updatedAt).toBe(original.updatedAt);
  expect(updated.history).toEqual(original.history);
  expect(after.briefing.cards).toHaveLength(initial.briefing.cards.length);
  expect(after.chats).toHaveLength(initial.chats.length + 1);
  await page.reload();
  await tab(page, '会话').click();
  await expect(cards(page).first()).toHaveAttribute('data-card-id', 'conversation:kg-review');
  await expect(page.locator('html')).not.toHaveAttribute('data-briefing-slide');
  await page.mouse.move(60, 120);
  await expect
    .poll(() =>
      cards(page).evaluateAll(
        (es) => es.flatMap((e) => e.getAnimations()).filter((a) => a.playState === 'running').length,
      ),
    )
    .toBe(0);
  await page.screenshot({ path: '.local/briefing-conversation-tab/desktop.png' });
});

test('有手动布局时最新回复仍提前，隐藏不归档，优化不混入，全部归档显示空状态', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/briefing');
  const c = card(page, 'konggu:C01');
  await c.hover();
  await c.getByRole('button', { name: /^卡片操作 / }).click();
  await page.getByRole('button', { name: '让 AI 优化卡片', exact: true }).click();
  await closeChat(page);
  await tab(page, '会话').click();
  await expect(c).toHaveCount(0);
  const original = card(page, 'conversation:kg-review');
  await original.hover();
  await original.getByRole('button', { name: /^卡片操作 / }).click();
  await original.getByRole('button', { name: '用方向键调整位置', exact: true }).click();
  await expect(original).toHaveClass(/is-keyboard-moving/);
  await original.locator('.briefing-card-main').press('ArrowDown');
  await original.locator('.briefing-card-main').press('Enter');
  expect(Object.keys((await state(page)).briefing.layouts)).toContain('["会话","","conversations"]');
  await original.locator('.briefing-card-main').click();
  await reply(page, '核对下一轮活动安排');
  await closeChat(page);
  await expect(cards(page).first()).toHaveAttribute('data-card-id', 'conversation:kg-review');
  await original.hover();
  await original.getByRole('button', { name: /^卡片操作 / }).click();
  await original.getByRole('button', { name: '隐藏卡片', exact: true }).click();
  await expect(cards(page)).toHaveCount(2);
  expect((await state(page)).chats.find((c: any) => c.id === 'kg-review').archived).toBe(false);
  await page.evaluate((key) => {
    const s = JSON.parse(localStorage.getItem(key)!);
    s.chats.forEach((c: any) => {
      c.archived = true;
    });
    localStorage.setItem(key, JSON.stringify(s));
  }, key);
  await page.reload();
  await tab(page, '会话').click();
  await expect(page.getByText('还没有关联会话的卡片', { exact: true })).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
});

test('手机会话分栏有序显示，左右滑动衔接关注和类型', async ({ browser }) => {
  const context = await browser.newContext({
    isMobile: true,
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto('/#/briefing');
  await tab(page, '会话').tap();
  await expect(cards(page)).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('html')).not.toHaveAttribute('data-briefing-slide');
  await page.screenshot({ path: '.local/briefing-conversation-tab/mobile.png' });
  const client = await context.newCDPSession(page);
  const swipe = async (left: boolean) => {
    const start = left ? 320 : 60,
      end = left ? 60 : 320;
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: start, y: 300 }],
    });
    for (let i = 1; i <= 8; i++)
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: start + ((end - start) * i) / 8, y: 300 }],
      });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('html')).not.toHaveAttribute('data-briefing-slide');
  };
  await swipe(true);
  await expect(tab(page, '类型')).toHaveAttribute('aria-selected', 'true');
  await swipe(false);
  await expect(tab(page, '会话')).toHaveAttribute('aria-selected', 'true');
  await swipe(false);
  await expect(tab(page, '关注')).toHaveAttribute('aria-selected', 'true');
  await context.close();
});
