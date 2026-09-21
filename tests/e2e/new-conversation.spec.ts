import { test, expect } from '@playwright/test';

test('启动卡片和提示词只填入草稿，自定义归属支持键盘且保留参考资料，发送才建立会话', async ({ page }) => {
  await page.goto('/#/home');
  const count = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('enterprise-ai-demo-v1')!).chats.length);
  const before = await count();
  const start = page.getByRole('region', { name: '新会话启动建议' });
  await expect(start.locator('.conversation-starter-grid button')).toHaveCount(4);
  await expect(page.locator('.thread-link[title] svg')).toHaveCount(0);
  await page.getByRole('button', { name: '添加资料', exact: true }).click();
  await page.getByRole('checkbox', { name: /客户 A 需求纪要/ }).check();
  await page.getByRole('button', { name: '完成选择' }).click();
  await start.getByRole('button', { name: /起草方案/ }).click();
  const input = page.getByLabel('描述你的工作需求');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(/合作目标、客户需求和交付范围/);
  await expect(page.getByLabel('已选参考资料')).toContainText('客户 A 需求纪要');
  const picker = page.getByRole('button', { name: '新会话归属' });
  await picker.press('ArrowDown');
  const menu = page.getByRole('listbox', { name: '选择工作空间' });
  await expect(menu).toBeFocused();
  await menu.press('End');
  await menu.press('ArrowUp');
  await menu.press('Enter');
  await expect(picker).toHaveText('销售部门工作空间');
  await expect(picker).toBeFocused();
  await picker.click();
  await expect(menu.getByRole('option', { name: '销售部门工作空间' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await menu.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('region', { name: '会话页面', exact: true })).toBeVisible();
  await start.getByRole('button', { name: '准备一份周报', exact: true }).click();
  await expect(input).toHaveValue(/本周进展、遇到的问题和下周计划/);
  await expect(input).toBeFocused();
  expect(await count()).toBe(before);
  await expect(page.locator('.draft-composer')).not.toContainText('演示回复');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page).toHaveURL(/#\/chat\//);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('enterprise-ai-demo-v1')!));
  expect(saved.chats).toHaveLength(before + 1);
  expect(saved.chats[0].space).toBe('sales');
  expect(saved.chats[0].messages[0].refs).toContain('needs');
});

test('窄屏建议和归属菜单可触控，发送固定在输入框右下角，菜单不溢出也不移动卡片', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 700 } });
  try {
    const page = await context.newPage();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 700 });
      await page.goto('/#/home');
      await page
        .getByRole('region', { name: '新会话启动建议' })
        .getByRole('button', { name: /梳理思路/ })
        .tap();
      await expect(page.getByLabel('描述你的工作需求')).toHaveValue(/拆解优先级和行动步骤/);
      const send = (await page.getByRole('button', { name: '发送消息', exact: true }).boundingBox())!;
      const composer = (await page.locator('.draft-composer').boundingBox())!;
      expect(composer.x + composer.width - send.x - send.width).toBeCloseTo(15, 0);
      expect(composer.y + composer.height - send.y - send.height).toBeCloseTo(11, 0);
      const card = page.locator('.deck-conversation');
      const cardBounds = await card.boundingBox();
      const picker = page.getByRole('button', { name: '新会话归属' });
      await picker.tap();
      const menu = page.getByRole('listbox', { name: '选择工作空间' });
      await expect(menu).toBeVisible();
      const bounds = (await menu.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(700);
      expect(await card.boundingBox()).toEqual(cardBounds);
      await menu.getByRole('option', { name: '财务部门工作空间' }).tap();
      await expect(picker).toHaveText('财务部门工作空间');
      await picker.tap();
      await page.getByRole('heading', { name: '新会话', exact: true }).tap();
      await expect(menu).toHaveCount(0);
      await expect(page.getByLabel('描述你的工作需求')).toHaveValue(/拆解优先级和行动步骤/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  } finally {
    await context.close();
  }
});
