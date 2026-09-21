import { test, expect, type Page } from '@playwright/test';

const popover = (page: Page, name: string) => page.getByRole('dialog', { name, exact: true });
const readState = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('enterprise-ai-demo-v1') || 'null'));

test('会话选项贴近入口，重命名和归档确认保持小面板，关闭后接续原会话和草稿', async ({ page }) => {
  await page.goto('/#/briefing');
  await page.locator('[data-card-id="finance:demo-receipts"] .briefing-card-main').click();
  await expect(page.locator('.conversation-overlay')).toHaveAttribute('data-phase', 'open');
  const draft = page.getByLabel('继续对话');
  await draft.fill('保留待核对的草稿');
  const trigger = page.getByRole('button', { name: '会话选项', exact: true });
  await trigger.click();
  const menu = popover(page, '会话选项');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: '重命名会话' })).toBeFocused();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  const anchor = (await trigger.boundingBox())!;
  const box = (await menu.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(320);
  expect(box.height).toBeLessThan(240);
  expect(Math.abs(box.x + box.width - anchor.x - anchor.width)).toBeLessThan(2);
  expect(Math.abs(box.y - anchor.y - anchor.height - 8)).toBeLessThan(2);

  await menu.getByRole('button', { name: '重命名会话' }).click();
  const rename = popover(page, '重命名会话');
  await expect(rename.getByLabel('会话名称')).toBeFocused();
  await rename.getByLabel('会话名称').fill('回款核对进展');
  await rename.getByRole('button', { name: '保存名称' }).click();
  await expect(page.locator('.conversation-card-header')).toContainText('回款核对进展');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await popover(page, '会话选项').getByRole('button', { name: '归档会话' }).click();
  await expect(popover(page, '归档这段会话')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-anchored-popover]')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('dialog', { name: '会话工作区' })).toBeVisible();
  await trigger.click();
  await draft.click();
  await expect(page.locator('[data-anchored-popover]')).toHaveCount(0);
  await expect(draft).toBeFocused();
  await expect(draft).toHaveValue('保留待核对的草稿');
});

test('空间选择在输入工具上方展开，滚动不带动卡片，取消与确认保留原有移动规则', async ({ page }) => {
  await page.goto('/#/chat/client');
  await expect(page.locator('.conversation-overlay')).toHaveAttribute('data-phase', 'open');
  const before = await readState(page);
  const trigger = page.getByRole('button', { name: '选择工作空间', exact: true });
  await trigger.click();
  const menu = popover(page, '选择工作空间');
  await expect(menu).toBeVisible();
  const anchor = (await trigger.boundingBox())!;
  const box = (await menu.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(anchor.y - 7);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  const scroll = await page.locator('.deck-scroller').evaluate((el) => el.scrollLeft);
  await menu.locator('.choice-list').hover();
  await page.mouse.wheel(360, 0);
  await expect.poll(() => page.locator('.deck-scroller').evaluate((el) => el.scrollLeft)).toBe(scroll);
  await menu.getByRole('button', { name: /财务部门工作空间/ }).click();
  await menu.getByRole('button', { name: '取消', exact: true }).click();
  expect((await readState(page)).chats.find((c: any) => c.id === 'client').space).toBe(
    before.chats.find((c: any) => c.id === 'client').space,
  );

  await page.getByRole('button', { name: '会话选项', exact: true }).click();
  await popover(page, '会话选项').getByRole('button', { name: '移动到工作空间' }).click();
  await menu.getByRole('button', { name: /财务部门工作空间/ }).click();
  await menu.getByRole('button', { name: '确认移动', exact: true }).click();
  const after = await readState(page);
  expect(after.chats.find((c: any) => c.id === 'client').space).toBe('finance');
  expect(after.materials).toEqual(before.materials);
  await expect(trigger).toContainText('财务部门工作空间');
});

test('窄屏操作面板留在视口内，选项可滚动，键盘和关闭仅作用于当前面板', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 580 });
  await page.goto('/#/chat/client');
  await expect(page.locator('.conversation-overlay')).toHaveAttribute('data-phase', 'open');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 580 });
    await page.getByRole('button', { name: '选择工作空间', exact: true }).click();
    const menu = popover(page, '选择工作空间');
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(12);
    expect(box.x + box.width).toBeLessThanOrEqual(width - 12);
    expect(box.y).toBeGreaterThanOrEqual(12);
    expect(box.y + box.height).toBeLessThanOrEqual(568);
    await menu.getByRole('button', { name: /财务部门工作空间/ }).click();
    const confirm = menu.getByRole('button', { name: '确认移动' });
    await expect(confirm).toBeInViewport({ ratio: 1 });
    await confirm.focus();
    await page.keyboard.press('Tab');
    await expect(menu.getByRole('button', { name: '关闭操作面板' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(page.locator('.conversation-overlay')).toHaveAttribute('data-phase', 'open');
    await page.getByRole('button', { name: '会话选项', exact: true }).click();
    await popover(page, '会话选项').getByRole('button', { name: '移动到工作空间' }).click();
    await expect(menu.getByRole('button', { name: '确认移动' })).toBeInViewport({ ratio: 1 });
    await menu.getByRole('button', { name: '关闭操作面板' }).click();
  }
});
