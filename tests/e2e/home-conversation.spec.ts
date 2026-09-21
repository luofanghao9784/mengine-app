import { test, expect, type Page } from '@playwright/test';
const state = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('enterprise-ai-demo-v1')!));
const input = (page: Page) => page.getByLabel('描述你的工作需求');
const card = (page: Page, id: string) => page.locator(`[data-card-id="${id}"] .briefing-card-main`);

test('首页收起与恢复输入，草稿及引用保留，发送才创建会话', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/#\/briefing$/);
  const before = (await state(page)).chats.length;
  await page.locator('.page-main').evaluate((el) => {
    el.scrollTop = 650;
  });
  await expect(page.getByRole('button', { name: '新建会话', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await input(page).fill('先核对客户需求');
  await page.getByRole('button', { name: '添加资料', exact: true }).click();
  await page.getByRole('checkbox', { name: /客户 A 需求纪要/ }).check();
  await page.getByRole('button', { name: '完成选择' }).click();
  await expect(page).toHaveURL(/#\/home$/);
  await page.getByRole('button', { name: '关闭会话', exact: true }).click();
  await page.getByRole('heading', { name: '智能画报', exact: true }).click();
  await page.locator('.page-main').evaluate((el) => {
    el.scrollTop += 650;
  });
  await expect(input(page)).toHaveValue('先核对客户需求');
  await expect(page.getByLabel('已选参考资料')).toContainText('客户 A 需求纪要');
  expect((await state(page)).chats.length).toBe(before);
  await page.getByRole('navigation').getByRole('button', { name: '资料库', exact: true }).click();
  await page.getByRole('button', { name: '会话', exact: true }).click();
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await expect(page.locator('.chat-main')).toBeVisible();
  await expect(input(page)).toHaveValue('先核对客户需求');
  expect((await state(page)).chats.length).toBe(before);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const after = await state(page);
  expect(after.chats.length).toBe(before + 1);
  expect(after.chats[0].messages[0].refs).toContain('needs');
  expect(after.chats[0].space).toBe('none');
});

test('画报筛选不改变会话归属，从空间发起会话才预选空间', async ({ page }) => {
  await page.goto('/#/briefing');
  await page.getByRole('tab', { name: '空间', exact: true }).click();
  await page.getByLabel('画报工作空间').selectOption('finance');
  await input(page).fill('分析本周变化');
  await expect(page.getByLabel('新会话归属')).toHaveText('未归入空间');
  await page.getByRole('button', { name: '发送消息' }).click();
  expect((await state(page)).chats[0].space).toBe('none');
  await page.goto('/#/space/project-delivery');
  await page.getByRole('button', { name: '发起工作', exact: true }).click();
  await expect(page.getByLabel('新会话归属')).toHaveText('客户 A 交付项目');
});

test('原卡片进入消息流，发送后滚动至新回复，关闭恢复画报阅读位置', async ({ page }) => {
  await page.goto('/#/briefing');
  await page.getByRole('tab', { name: '日期', exact: true }).click();
  const day = await page.getByLabel('回看日期').inputValue();
  const source = card(page, 'news:direction');
  await source.scrollIntoViewIfNeeded();
  const top = await page.locator('.page-main').evaluate((el) => el.scrollTop);
  await source.click();
  const url = page.url();
  const original = page.getByRole('region', { name: '会话中的画报原卡片' });
  await expect(original).toContainText('从回答问题，到持续参与工作');
  await expect(original.locator('img')).toBeVisible();
  await expect(original.getByRole('heading')).toBeInViewport();
  expect((await state(page)).chats[0].messages.filter((m: any) => m.briefing)).toHaveLength(1);
  await page.getByLabel('继续对话').fill('请分析对我们当前工作的影响');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.locator('.message-text').last()).toBeInViewport();
  await page.locator('.conversation-scroll').evaluate((el) => el.scrollTo({ top: 0, behavior: 'instant' }));
  await expect(original.getByRole('heading')).toBeInViewport();
  await page.getByRole('button', { name: '关闭会话', exact: true }).click();
  await expect(page.getByRole('tab', { name: '日期', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('回看日期')).toHaveValue(day);
  await expect
    .poll(async () => Math.abs((await page.locator('.page-main').evaluate((el) => el.scrollTop)) - top))
    .toBeLessThan(5);
  await source.click();
  await expect(page).toHaveURL(url);
  await expect(original.getByRole('heading')).toBeInViewport();
  expect((await state(page)).chats[0].messages.filter((m: any) => m.briefing)).toHaveLength(1);
});

test('空间画报返回同一路径及筛选，窄屏输入与最后卡片均可达', async ({ page }) => {
  await page.goto('/#/briefing/finance');
  await card(page, 'finance:demo-receipts').click();
  await page.getByRole('button', { name: '关闭会话', exact: true }).click();
  await expect(page).toHaveURL(/#\/briefing\/finance$/);
  await expect(page.getByLabel('画报工作空间')).toHaveValue('finance');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('tab', { name: '最新', exact: true }).click();
    await page.locator('.page-main').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const last = await page.locator('.briefing-grid .briefing-card').last().boundingBox();
    const dock = await page.locator('.briefing-compose-dock').boundingBox();
    expect(last!.y + last!.height).toBeLessThan(dock!.y);
    await page.getByRole('button', { name: '新建会话', exact: true }).click();
    await input(page).fill('窄屏输入测试');
    await expect(page.getByRole('button', { name: '发送消息' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await input(page).fill('');
    await page.getByRole('button', { name: '关闭会话', exact: true }).click();
    await expect(page.locator('.conversation-overlay')).toHaveCount(0);
    await page.getByRole('heading', { level: 1 }).click();
    await page.locator('.page-main').evaluate((el) => {
      el.scrollTop = 0;
    });
  }
});

test('已有成果的画报会话在窄屏先展示原卡片，用户仍可主动打开成果', async ({ page }) => {
  await page.goto('/#/briefing');
  await card(page, 'finance:demo-receipts').click();
  await page.evaluate(() => {
    const key = 'enterprise-ai-demo-v1';
    const saved = JSON.parse(localStorage.getItem(key)!);
    saved.chats[0].messages.push({
      id: 'existing-artifact',
      role: 'assistant',
      text: '此前已保存的成果',
      doc: 'proposal',
    });
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('.preview-pane')).toBeHidden();
  await expect(
    page.getByRole('region', { name: '会话中的画报原卡片' }).getByRole('heading'),
  ).toBeInViewport();
  await page.getByLabel('会话卡片切换').getByRole('button', { name: '客户 A 合作方案', exact: true }).click();
  await expect(page.locator('.preview-pane')).toBeVisible();
});
