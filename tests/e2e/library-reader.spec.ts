import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/#/library/personal');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.evaluate(() => {
    const key = 'enterprise-ai-demo-konggu-v1';
    const state = JSON.parse(localStorage.getItem(key)!);
    const doc = state.materials.find((item: any) => item.id === 'kg-personal-review');
    doc.versions.push({ ...doc.versions[0], id: doc.id + '-v2', number: 2, content: '第二版合成内容' });
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
});

test('卡片与列表共用资料，关闭阅读保留搜索、排序、排版和滚动位置', async ({ page }) => {
  await page.goto('/#/library/enterprise?view=all');
  await page.getByLabel('搜索资料', { exact: true }).fill('客户');
  await page.getByLabel('资料排序', { exact: true }).selectOption('name');
  await page.getByRole('button', { name: '列表视图', exact: true }).click();
  const files = page.locator('.library-table tbody tr');
  const count = await files.count();
  expect(count).toBeGreaterThan(2);
  const selected = files.last().getByRole('button');
  await selected.scrollIntoViewIfNeeded();
  const position = await page.locator('.page-main').evaluate((element) => element.scrollTop);
  const before = await page.evaluate(
    () => JSON.parse(localStorage.getItem('enterprise-ai-demo-konggu-v1')!).materials,
  );
  await selected.click();
  await expect(page.getByRole('dialog', { name: '资料阅读视窗' })).toBeVisible();
  await page.getByRole('button', { name: '关闭资料视窗', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '资料阅读视窗' })).toHaveCount(0);
  await expect(page.getByLabel('搜索资料', { exact: true })).toHaveValue('客户');
  await expect(page.getByLabel('资料排序', { exact: true })).toHaveValue('name');
  await expect(page.getByRole('button', { name: '列表视图', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await page.locator('.page-main').evaluate((element) => element.scrollTop)).toBe(position);
  expect(await files.count()).toBe(count);
  await page.getByRole('button', { name: '卡片视图', exact: true }).click();
  await expect(page.locator('.library-material-card')).toHaveCount(count);
  await page.screenshot({ path: '.local/library-redesign/library-cards-desktop.png' });
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('enterprise-ai-demo-konggu-v1')!).materials),
  ).toEqual(before);
});

test('历史版本提问先保留草稿，发送后锁定来源版本，新版本不改变引用或归属', async ({ page }) => {
  await page.evaluate(() => {
    const key = 'enterprise-ai-demo-konggu-v1';
    const s = JSON.parse(localStorage.getItem(key)!);
    const doc = s.materials.find((d: any) => d.id === 'kg-personal-review');
    doc.versions[0].content = '历史版本独有的交付依据';
    doc.versions[1].content = '新版中增加的实施安排';
    localStorage.setItem(key, JSON.stringify(s));
  });
  await page.goto('/#/library/personal/kg-personal-review');
  await page.reload();
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('enterprise-ai-demo-konggu-v1')!));
  await page.getByRole('button', { name: '资料属性', exact: true }).click();
  await page.getByLabel('查看资料版本', { exact: true }).selectOption('kg-personal-review-v1');
  await page.getByRole('button', { name: '收起资料属性', exact: true }).click();
  await expect(page.locator('.reader-paper')).toContainText('历史版本独有的交付依据');
  await page.getByRole('button', { name: '基于资料提问', exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.getByLabel('已选参考资料')).toContainText('空谷本周经营复盘 · 个人草稿 · v1');
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('enterprise-ai-demo-konggu-v1')!).chats.length),
  ).toBe(before.chats.length);
  await expect(page.locator('[data-deck-id="kg-personal-review"] .reader-paper')).toContainText(
    '历史版本独有的交付依据',
  );
  await page.getByLabel('描述你的工作需求', { exact: true }).fill('这份资料有哪些待确认事项？');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.chat-main .source-chip')).toContainText([
    '空谷本周经营复盘 · 个人草稿 · v1',
    '空谷本周经营复盘 · 个人草稿 · v1',
  ]);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('enterprise-ai-demo-konggu-v1')!));
  // Read the created chat from its source reference without relying on list insertion order.
  const referenced = after.chats.find((item: any) =>
    item.messages.some((m: any) => m.refVersions?.['kg-personal-review'] === 'kg-personal-review-v1'),
  );
  expect(referenced.space).toBe('none');
  expect(after.materials.find((d: any) => d.id === 'kg-personal-review')).toEqual(
    before.materials.find((d: any) => d.id === 'kg-personal-review'),
  );
  await page.evaluate(() => {
    const key = 'enterprise-ai-demo-konggu-v1';
    const s = JSON.parse(localStorage.getItem(key)!);
    const doc = s.materials.find((d: any) => d.id === 'kg-personal-review');
    doc.versions.push({ ...doc.versions[1], id: 'kg-personal-review-v3', number: 3, content: '后来添加的内容' });
    localStorage.setItem(key, JSON.stringify(s));
  });
  await page.reload();
  await expect(page.locator('[data-deck-id="kg-personal-review"] .reader-paper')).toContainText(
    '历史版本独有的交付依据',
  );
  await expect(page.locator('[data-deck-id="kg-personal-review"] .reader-paper')).not.toContainText('后来添加的内容');
  const file = page.locator('[data-deck-id="kg-personal-review"]');
  await file.getByRole('button', { name: '资料属性', exact: true }).click();
  await file.getByLabel('查看资料版本').selectOption('kg-personal-review-v3');
  await expect(file.getByLabel('查看资料版本')).toHaveValue('kg-personal-review-v3');
  await page.locator('.chat-main .source-chip').first().click();
  await expect(file.getByLabel('查看资料版本')).toHaveValue('kg-personal-review-v1');
});

test('移除提问草稿的资料引用同步移除阅读卡片，关闭会话回到资料', async ({ page }) => {
  await page.goto('/#/library/personal/kg-personal-review');
  await page.getByRole('button', { name: '基于资料提问', exact: true }).click();
  await expect(page.locator('.deck-file')).toHaveCount(1);
  await page.getByRole('button', { name: '移除引用 空谷本周经营复盘 · 个人草稿' }).click();
  await expect(page.locator('.deck-file')).toHaveCount(0);
  await page.getByRole('button', { name: '关闭会话', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '资料阅读视窗' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '空谷本周经营复盘 · 个人草稿', exact: true, level: 2 })).toBeVisible();
  await page.screenshot({ path: '.local/library-redesign/reader-desktop.png' });
});

test('窄屏阅读、资料信息和编辑入口可达，失去权限的关联资料不展示', async ({ page }) => {
  await page.evaluate(() => {
    const key = 'enterprise-ai-demo-konggu-v1';
    const s = JSON.parse(localStorage.getItem(key)!);
    s.materials.find((d: any) => d.id === 'kg-D01').visibility = '仅空间负责人';
    s.spaces.find((space: any) => space.id === 'operations').owner = '另一位合成负责人';
    localStorage.setItem(key, JSON.stringify(s));
  });
  await page.goto('/#/library/personal/kg-personal-review');
  await page.reload();
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const reader = page.getByRole('dialog', { name: '资料阅读视窗' });
    await expect(reader.getByRole('button', { name: '基于资料提问', exact: true })).toBeInViewport();
    await reader.getByRole('button', { name: '资料属性', exact: true }).click();
    await expect(reader.getByLabel('查看资料版本')).toBeInViewport();
    await reader.getByRole('tab', { name: '关联资料', exact: true }).click();
    await expect(page.locator('.reader-support')).not.toContainText('9月零售日销售摘要');
    await expect(page.locator('.reader-support')).toContainText('指标口径与可比窗口');
    await page.getByRole('button', { name: '收起资料属性', exact: true }).click();
    await page.screenshot({ path: '.local/library-redesign/reader-' + width + '.png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
