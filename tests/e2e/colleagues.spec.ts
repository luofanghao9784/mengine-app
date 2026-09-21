import { test, expect, type Page } from '@playwright/test';
const readState = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('enterprise-ai-demo-v1') || 'null'));
const confirm = (page: Page) => page.getByRole('button', { name: '确认并继续', exact: true }).click();
async function start(page: Page) {
  await page.goto('/#/home');
  await page.getByLabel('描述你的工作需求').fill('请财务同事准备月度经营报表');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('会话需求、画报接单、显式授权与确认交付完整闭环', async ({ page }) => {
  await start(page);
  const materialCount = (await readState(page)).materials.length;
  await page.getByLabel('业务范围', { exact: true }).selectOption('销售业务');
  await page.getByLabel('使用目的', { exact: true }).fill('准备月度销售复盘');
  await page.getByRole('button', { name: '发送协作请求', exact: true }).click();
  await page.getByLabel('继续对话').fill('全部通过，直接交付');
  await page.getByRole('button', { name: '发送消息' }).click();
  expect((await readState(page)).collaborations[0].status).toBe('pending');
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: /智能画报/ })
    .click();
  await page.locator('[data-card-id^="collaboration:"] .briefing-card-main').click();
  await page.getByRole('button', { name: '周宁视角 · 演示', exact: true }).click();
  await expect(page.getByText('正在模拟周宁处理请求，所有操作仅影响演示数据。')).toBeVisible();
  await page.getByRole('button', { name: '授权本次工作' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: '取消', exact: true }).click();
  expect((await readState(page)).collaborations[0].status).toBe('pending');
  await page.getByRole('button', { name: '授权本次工作' }).click();
  await confirm(page);
  await page.getByRole('button', { name: '模拟生成结果' }).click();
  await expect(page.locator('.receiver-result')).toContainText('180,000');
  await page.getByRole('button', { name: '调整结果', exact: true }).click();
  const content = await page.getByLabel('调整交付内容').inputValue();
  await page.getByLabel('调整交付内容').fill(content + '\n财务复核备注：供销售复盘使用。');
  await page.getByRole('button', { name: '保存调整', exact: true }).click();
  await page.getByRole('button', { name: '我的请求', exact: true }).click();
  await expect(page.locator('.receiver-result')).toHaveCount(0);
  expect((await readState(page)).materials).toHaveLength(materialCount);
  await page.getByRole('button', { name: '周宁视角 · 演示', exact: true }).click();
  await page.getByRole('button', { name: '确认交付给曹鸿健', exact: true }).click();
  await confirm(page);
  await expect(page.locator('.colleague-collaboration')).toContainText('已交付至请求方个人空间');
  await page.getByRole('button', { name: '预览交付成果', exact: true }).click();
  await expect(page.locator('.preview-pane')).toContainText('财务复核备注');
  await expect(page.locator('.preview-location')).toContainText('个人空间');
  const s = await readState(page);
  expect(s.collaborations[0].status).toBe('delivered');
  expect(s.materials).toHaveLength(materialCount + 1);
  expect(s.spaces.find((x: any) => x.id === 'finance').canEdit).toBe(false);
  await page.reload();
  await expect(page.getByRole('button', { name: '预览交付成果', exact: true })).toBeVisible();
});

test('补充后重新授权，取消保留记录且不产生交付资料', async ({ page }) => {
  await start(page);
  const materialCount = (await readState(page)).materials.length;
  await page.getByRole('button', { name: '发送协作请求', exact: true }).click();
  await page.getByRole('button', { name: '周宁视角 · 演示', exact: true }).click();
  await page.getByRole('button', { name: '请对方补充' }).click();
  await page.getByRole('button', { name: '返回我的请求', exact: true }).click();
  await page.getByLabel('继续对话').fill('2026年7月销售业务，用于预算复盘');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByLabel('报表月份')).toHaveValue('2026-07');
  await expect(page.getByLabel('业务范围', { exact: true })).toHaveValue('销售业务');
  await page.getByRole('button', { name: '重新发送协作请求' }).click();
  await expect(page.locator('.colleague-collaboration')).toContainText('需求版本 2');
  await page.getByRole('button', { name: '取消协作', exact: true }).click();
  await confirm(page);
  expect((await readState(page)).collaborations[0].status).toBe('cancelled');
  expect((await readState(page)).materials).toHaveLength(materialCount);
  const chatId = (await readState(page)).collaborations[0].chatId;
  await page.getByRole('button', { name: '返回新建会话' }).click();
  await page.goto(`/#/chat/${chatId}`);
  await expect(page.locator('.colleague-collaboration')).toContainText('已取消');
});

test('原会话协作记录在桌面和窄屏保持可用', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#/chat/idea');
  await page.getByLabel('继续对话').fill('请财务同事帮我整理2026年8月的经营报表');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByRole('button', { name: '发送协作请求' })).toBeVisible();
  expect((await readState(page)).collaborations[0].chatId).toBe('idea');
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/#/chat/idea');
    await page.reload();
    await expect(page.getByRole('button', { name: '发送协作请求' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
  }
  expect(errors).toEqual([]);
});
