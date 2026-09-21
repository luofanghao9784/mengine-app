import { test, expect, type Page } from '@playwright/test';

const workspace = (page: Page) => page.locator('.conversation-overlay');
const navigation = (page: Page) => page.getByRole('navigation', { name: '主导航' });
const expectPage = async (page: Page) => {
  await expect(page.getByRole('region', { name: '会话页面', exact: true })).toBeVisible();
  await expect(workspace(page)).toHaveAttribute('data-presentation', 'page');
  await expect(workspace(page)).toHaveCSS('background-color', 'rgb(245, 249, 255)');
  await expect(page.locator('.sidebar')).toHaveCSS('background-color', 'rgb(245, 249, 255)');
  await expect(page.locator('.conversation-background')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('.conversation-scrim')).toHaveCount(0);
};
const expectOverlay = async (page: Page) => {
  await expect(page.getByRole('dialog', { name: '会话工作区' })).toBeVisible();
  await expect(workspace(page)).toHaveAttribute('data-presentation', 'overlay');
  await expect(page.locator('.conversation-scrim')).toHaveCSS('backdrop-filter', 'blur(10px)');
  await expect(page.locator('.conversation-background')).toHaveCSS('visibility', 'visible');
};

test('导航进入淡蓝色会话页面，切换列表和发送保持页面模式，刷新与历史恢复对应背景', async ({ page }) => {
  await page.goto('/#/briefing');
  await navigation(page).getByRole('button', { name: '会话', exact: true }).click();
  await expectPage(page);
  await expect(page.getByRole('region', { name: '新会话启动建议' })).toBeVisible();
  await expect(workspace(page)).toHaveAttribute('data-phase', 'open');
  const deck = (await page.locator('.deck-scroller').boundingBox())!;
  await page.mouse.click(deck.x + deck.width - 5, deck.y + 30);
  await expectPage(page);
  await page.locator('.deck-list').getByRole('button', { name: '整理本周工作思路', exact: true }).click();
  await expectPage(page);
  await page.getByLabel('继续对话').fill('保留这段草稿');
  await page.locator('.deck-list').getByRole('button', { name: '新建会话', exact: true }).click();
  await page.getByLabel('描述你的工作需求').fill('整理明天的工作计划');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page).toHaveURL(/#\/chat\//);
  await expectPage(page);
  const url = page.url();
  await navigation(page).getByRole('button', { name: '智能画报', exact: true }).click();
  await expect(workspace(page)).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(url);
  await expectPage(page);
  await page.locator('.deck-list').getByRole('button', { name: '整理本周工作思路', exact: true }).click();
  await expect(page.getByLabel('继续对话')).toHaveValue('保留这段草稿');
  await page.reload();
  await expectPage(page);
});

test('画报与悬浮输入使用模糊背景，同一路由切换导航页面后前进后退仍能区分入口', async ({ page }) => {
  await page.goto('/#/briefing');
  const card = page.locator('[data-card-id="finance:demo-receipts"]');
  await card.locator('.briefing-card-main').click();
  await expectOverlay(page);
  await navigation(page).getByRole('button', { name: '会话', exact: true }).click();
  await expectPage(page);
  await expect(page.locator('.conversation-morph')).toHaveCount(0);
  await expect(card).not.toHaveClass(/conversation-origin-active/);
  await page.goBack();
  await expectOverlay(page);
  await page.reload();
  await expectOverlay(page);
  await expect(workspace(page)).toHaveAttribute('data-phase', 'open');
  await page.getByTestId('conversation-backdrop').click({ position: { x: 5, y: 5 } });
  await expect(page).toHaveURL(/#\/briefing$/);
  await page.getByLabel('描述你的工作需求').fill('从画报接续这段草稿');
  await expectOverlay(page);
  await expect(page).toHaveURL(/#\/home$/);
  await navigation(page).getByRole('button', { name: '会话', exact: true }).click();
  await expectPage(page);
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.getByLabel('描述你的工作需求')).toHaveValue('从画报接续这段草稿');
  await page.goBack();
  await expectOverlay(page);
  await expect(page).toHaveURL(/#\/home$/);
  await page.goForward();
  await expectPage(page);
  await expect(page.getByLabel('描述你的工作需求')).toHaveValue('从画报接续这段草稿');
});

test('直达会话默认淡蓝色页面，手机导航和页面内唤起同样区分背景', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/chat/client');
  await expectPage(page);
  await expect(page.getByLabel('继续对话')).toBeInViewport();
  await navigation(page).getByRole('button', { name: '智能画报', exact: true }).click();
  await page.getByLabel('描述你的工作需求').fill('整理本周进展');
  await expectOverlay(page);
  await navigation(page).getByRole('button', { name: '会话', exact: true }).click();
  await expectPage(page);
  await expect(page.getByLabel('描述你的工作需求')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
