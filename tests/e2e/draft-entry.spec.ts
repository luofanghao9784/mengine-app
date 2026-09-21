import { test, expect } from '@playwright/test';

const saved = () => JSON.parse(localStorage.getItem('enterprise-ai-demo-v1')!);

test('悬浮输入自动展开新会话，连续输入与资料归属保持，发送前不建档', async ({ page }) => {
  await page.goto('/#/briefing');
  const before = await page.evaluate(saved);
  const input = page.getByLabel('描述你的工作需求');
  await input.focus();
  await expect(page.locator('.conversation-overlay')).toHaveCount(0);
  const frame = page.locator('.draft-composer');
  const appearance = await frame.evaluate((el) => {
    const style = getComputedStyle(el);
    const text = getComputedStyle(el.querySelector('textarea')!);
    return [style.borderRadius, style.backgroundColor, text.fontFamily, text.lineHeight, text.padding];
  });
  await expect(input).toHaveCSS('outline-style', 'none');
  await page.getByRole('button', { name: '添加资料', exact: true }).click();
  await page.getByRole('checkbox', { name: /客户 A 需求纪要/ }).check();
  await page.getByRole('button', { name: '完成选择' }).click();
  await page.getByRole('button', { name: '新会话归属' }).click();
  await page.getByRole('option', { name: '销售部门工作空间' }).click();
  await input.focus();
  await page.keyboard.type('Please review the client requirements', { delay: 10 });
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.locator('.conversation-overlay')).toHaveAttribute('data-phase', 'open');
  await expect(input).toHaveValue('Please review the client requirements');
  await expect(input).toBeFocused();
  await expect(page.getByLabel('已选参考资料')).toContainText('客户 A 需求纪要');
  await expect(page.getByLabel('新会话归属')).toHaveText('销售部门工作空间');
  await expect(page.getByText('演示回复', { exact: true })).toHaveCount(0);
  const currentAppearance = await page
    .locator('.new-conversation-composer .draft-composer')
    .evaluate((el) => {
      const style = getComputedStyle(el);
      const text = getComputedStyle(el.querySelector('textarea')!);
      return [style.borderRadius, style.backgroundColor, text.fontFamily, text.lineHeight, text.padding];
    });
  expect(currentAppearance).toEqual(appearance);
  expect((await page.evaluate(saved)).chats.length).toBe(before.chats.length);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const after = await page.evaluate(saved);
  expect(after.chats).toHaveLength(before.chats.length + 1);
  expect(after.chats[0].messages[0].text).toBe('Please review the client requirements');
  expect(after.chats[0].messages[0].refs).toContain('needs');
  expect(after.chats[0].space).toBe('sales');
});

test('中文输入法确认后才展开，关闭保留草稿，再次编辑自动接续', async ({ page }) => {
  await page.goto('/#/briefing');
  const input = page.getByLabel('描述你的工作需求');
  await input.focus();
  await input.dispatchEvent('compositionstart');
  await input.fill('财务');
  await expect(page).toHaveURL(/#\/briefing$/);
  await expect(page.locator('.conversation-overlay')).toHaveCount(0);
  await input.fill('财务分析');
  await input.dispatchEvent('compositionend', { data: '财务分析' });
  await expect(page).toHaveURL(/#\/home$/);
  await expect(input).toBeFocused();
  await page.keyboard.insertText('，先核对数据');
  await expect(input).toHaveValue('财务分析，先核对数据');
  await page.getByRole('button', { name: '关闭会话', exact: true }).click();
  await expect(page).toHaveURL(/#\/briefing$/);
  await expect(input).toHaveValue('财务分析，先核对数据');
  await input.focus();
  await input.press('Home');
  await page.keyboard.insertText('本周');
  await expect(page).toHaveURL(/#\/home$/);
  await expect(input).toBeFocused();
  await page.keyboard.insertText('的');
  await expect(input).toHaveValue('本周的财务分析，先核对数据');
});

test('手机粘贴自动展开，减少动态效果且焦点、发送位置和页面边界正确', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/briefing');
  const before = await page.evaluate(saved);
  const input = page.getByLabel('描述你的工作需求');
  await input.focus();
  await page.keyboard.insertText('帮我整理今天的工作重点');
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.locator('.conversation-overlay')).toHaveAttribute('data-phase', 'open');
  await expect(input).toHaveValue('帮我整理今天的工作重点');
  await expect(input).toBeFocused();
  await expect(input).toBeInViewport();
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeInViewport();
  expect((await page.evaluate(saved)).chats.length).toBe(before.chats.length);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
