import { test, expect } from '@playwright/test';

const labels = ['会话', '智能画报', '资料库', '应用'];
test.beforeEach(async ({ page }) => {
  await page.goto('/#/briefing');
});

test('会话优先的圆形入口，悬浮文字渐变虚化且按钮与正文不位移', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: '主导航' });
  await expect(nav.locator(':scope > .nav-item > button')).toHaveCount(4);
  expect(
    await nav
      .locator(':scope > .nav-item > button')
      .evaluateAll((buttons) => buttons.map((b) => b.getAttribute('aria-label'))),
  ).toEqual(labels);
  const main = await page.locator('.main-shell').boundingBox();
  for (const label of labels) {
    const button = nav.getByRole('button', { name: label, exact: true });
    await page.mouse.move(700, 70);
    await expect(button).toHaveCSS('width', '48px');
    await expect(button).toHaveCSS('height', '48px');
    await button.hover();
    await expect(button).toHaveCSS('width', '48px');
    await expect(button.locator('.nav-label')).toHaveCSS('opacity', '1');
    await expect(nav.locator('.is-expanded')).toHaveCount(1);
    expect(await page.locator('.main-shell').boundingBox()).toEqual(main);
  }
  await page.mouse.move(700, 70);
  await expect(page.getByRole('region', { name: '会话列表卡片', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: '会话', exact: true })).toHaveCSS('width', '48px');
  await page.goto('/#/colleagues');
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.getByRole('button', { name: /同事智能体/ })).toHaveCount(0);
});

test('点击会话打开列表和新会话启动区，悬浮不打开或展开列表，已有会话草稿保留', async ({ page }) => {
  const trigger = page.getByRole('navigation').getByRole('button', { name: '会话', exact: true });
  const list = page.getByRole('region', { name: '会话列表卡片', exact: true });
  const originalState = await page.evaluate(() => localStorage.getItem('enterprise-ai-demo-v1'));
  await trigger.hover();
  await expect(trigger.locator('.nav-label')).toHaveCSS('opacity', '1');
  await expect(list).toHaveCount(0);
  await expect(page.locator('.conversation-overlay')).toHaveCount(0);
  await trigger.click();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(list).toBeVisible();
  await expect(page.getByRole('heading', { name: '新会话', exact: true })).toBeVisible();
  await expect(page.getByLabel('描述你的工作需求')).toHaveValue('');
  await expect(page.getByRole('region', { name: '新会话启动建议' })).toBeVisible();
  await expect(page.locator('.deck-source, .deck-file')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('enterprise-ai-demo-v1'))).toBe(originalState);
  await expect(list.locator('.space-group')).toHaveCount(5);
  await list.getByRole('button', { name: '折叠秋季新品发布项目', exact: true }).click();
  await list.getByRole('separator').press('ArrowRight');
  await expect(list.getByRole('separator')).toHaveAttribute('aria-valuenow', '264');
  await list.getByRole('button', { name: '客户 A 培训与交付计划', exact: true }).click();
  await expect(page.locator('.composer .context-button')).toContainText('客户 A 交付项目');
  await expect(trigger).toHaveClass(/active/);
  await expect(trigger).toHaveAttribute('aria-current', 'page');
  await page.getByLabel('继续对话').fill('保留正在输入的草稿');
  await page
    .locator('.deck-scroller')
    .evaluate((el) => el.scrollTo({ left: el.scrollWidth, behavior: 'instant' }));
  await expect(list).toHaveAttribute('data-folded', 'true');
  await trigger.hover();
  await expect(trigger.locator('.nav-label')).toHaveCSS('opacity', '1');
  await expect(list).toHaveAttribute('data-folded', 'true');
  await expect(page.getByLabel('继续对话')).toBeFocused();
  await trigger.click();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.locator('.deck-list')).toHaveCount(1);
  await expect(list).not.toHaveAttribute('data-folded', 'true');
  await expect(page.locator('.deck-source, .deck-file')).toHaveCount(0);
  await expect(page.getByLabel('描述你的工作需求')).toHaveValue('');
  await expect(list.getByRole('separator')).toHaveAttribute('aria-valuenow', '264');
  await expect(list.getByRole('button', { name: '展开秋季新品发布项目', exact: true })).toBeVisible();
  await list.getByRole('button', { name: '客户 A 培训与交付计划', exact: true }).click();
  await expect(page.getByLabel('继续对话')).toHaveValue('保留正在输入的草稿');
  await trigger.click();
  await list.getByRole('button', { name: '搜索会话和资料', exact: true }).click();
  await expect(page.locator('dialog[open]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: '会话页面', exact: true })).toBeVisible();
});

test('键盘聚焦只显示名称，Enter 打开新会话，Escape 关闭并返回入口', async ({ page }) => {
  const trigger = page.getByRole('navigation').getByRole('button', { name: '会话', exact: true });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(trigger).toBeFocused();
  await expect(trigger).not.toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.deck-list')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveAttribute('aria-current', 'page');
  await expect(trigger).not.toHaveAttribute('aria-haspopup');
  await expect(page.getByLabel('描述你的工作需求')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.conversation-overlay')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).not.toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '新会话', exact: true })).toBeVisible();
});

test('触屏点击进入新会话，窄屏可切换列表，矮屏卡片均在可用视口内', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('/#/briefing');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 700 });
    await page.getByRole('button', { name: '会话', exact: true }).tap();
    await expect(page).toHaveURL(/#\/home$/);
    await expect(page.getByLabel('描述你的工作需求')).toBeInViewport();
    await page.getByLabel('会话卡片切换').getByRole('button', { name: '列表', exact: true }).tap();
    await page.getByRole('button', { name: '会话', exact: true }).tap();
    await expect(page.getByLabel('描述你的工作需求')).toBeInViewport();
    await page.getByLabel('会话卡片切换').getByRole('button', { name: '列表', exact: true }).tap();
    const list = page.getByRole('region', { name: '会话列表卡片', exact: true });
    await expect(list).toBeVisible();
    const box = (await list.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(700);
    await list.getByRole('button', { name: '整理本周工作思路', exact: true }).tap();
    await expect(page).toHaveURL(/#\/chat\/idea$/);
    await expect(list).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1024, height: 480 });
  await page.getByRole('button', { name: '会话', exact: true }).tap();
  const box = (await page.getByRole('region', { name: '会话列表卡片', exact: true }).boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(480);
  expect(box.height).toBeGreaterThan(300);
  await context.close();
});
