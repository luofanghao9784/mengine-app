import { test, expect } from '@playwright/test';

const key = 'enterprise-ai-demo-v1';

test('四期内容可按日期与类型查看，图表保留自己的单位，进入会话可核对来源', async ({ page }) => {
  await page.goto('/#/briefing');
  await expect(page.locator('.briefing-grid .briefing-card')).toHaveCount(46);
  const examples = await page.locator('.briefing-grid [data-card-id^="demo:"]').count();
  expect(examples).toBe(34);
  expect(await page.locator('.briefing-date-divider').count()).toBeGreaterThanOrEqual(3);
  const trend = page.locator('[data-card-id="demo:qualified-inquiries"]');
  await expect(trend.locator('.briefing-visual-chart svg')).toHaveAttribute(
    'aria-label',
    /8\/27 8条.*9\/17 15条/,
  );
  await expect(trend).not.toContainText('万元');
  await page.getByRole('tab', { name: '日期', exact: true }).click();
  await page.getByLabel('回看日期', { exact: true }).fill('2026-09-18');
  await expect(page.locator('.briefing-grid [data-card-id^="demo:"]')).toHaveCount(16);
  await expect(page.locator('[data-card-id="demo:opportunity-funnel"]')).toHaveCount(0);
  await page.getByLabel('回看日期', { exact: true }).fill('2026-09-17');
  await expect(page.locator('.briefing-grid [data-card-id^="demo:"]')).toHaveCount(8);
  await page.getByLabel('回看日期', { exact: true }).fill('2026-09-16');
  await expect(page.locator('.briefing-grid [data-card-id^="demo:"]')).toHaveCount(0);
  await page.getByRole('tab', { name: '类型', exact: true }).click();
  await page.getByRole('button', { name: '成果交付', exact: true }).click();
  await expect(page.locator('.briefing-grid .briefing-card')).toHaveCount(5);
  await page.locator('[data-card-id="demo:sales-faq"] .briefing-card-main').click();
  await expect(page.locator('.conversation-overlay')).toHaveAttribute('data-phase', 'open');
  await expect(page.getByRole('region', { name: '会话中的画报原卡片' })).toContainText('销售问答已补齐 8 项');
  await expect(page.locator('.deck-file')).toContainText('合成演示材料');
  await expect(page.locator('.deck-file')).toContainText('当前尚未完成对外确认');
  await page.getByLabel('继续对话').fill('列出对外使用前的核对项');
  await page.getByLabel('继续对话').press('Enter');
  await expect(page.locator('.message.assistant').last()).toContainText('演示核对清单');
  await page.getByRole('button', { name: '关闭会话', exact: true }).click();
  await expect(page.getByRole('tab', { name: '类型', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('旧浏览器刷新增补样例，已隐藏和改名的卡片、资料与会话保持原样', async ({ page }) => {
  await page.goto('/#/briefing');
  const old = await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key)!);
    delete state.briefingExamplesVersion;
    state.briefing.cards = state.briefing.cards.filter((c: any) => !c.id.startsWith('demo:'));
    state.materials = state.materials.filter((d: any) => !d.id.startsWith('briefing-example-'));
    state.folders = state.folders.filter((f: any) => !f.id.startsWith('briefing-examples-'));
    const card = state.briefing.cards.find((c: any) => c.id === 'dream');
    card.pinned = true;
    card.hidden = true;
    card.config = { title: '我保存的整理卡片', size: '1×2', compact: true };
    state.chats[0].title = '我已经修改的会话';
    state.materials.find((d: any) => d.id === 'proposal').versions.at(-1).content = '我保存的方案正文';
    localStorage.setItem(key, JSON.stringify(state));
    return state;
  }, key);
  await page.reload();
  await expect(page.locator('.briefing-grid [data-card-id^="demo:"]')).toHaveCount(34);
  const upgraded = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
  expect(upgraded.briefingExamplesVersion).toBe(2);
  expect(upgraded.chats).toEqual(old.chats);
  expect(upgraded.spaces).toEqual(old.spaces);
  for (const card of old.briefing.cards)
    expect(upgraded.briefing.cards.find((c: any) => c.id === card.id)).toEqual(card);
  for (const material of old.materials)
    expect(upgraded.materials.find((d: any) => d.id === material.id)).toEqual(material);
  await page.reload();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key)).toEqual(upgraded);
});
