import { test, expect } from '@playwright/test';

const key = 'enterprise-ai-demo-v1';

test('画报分类居中进入顶栏并保持可见，筛选与会话返回接续，标题和 Logo 中线对齐', async ({ page }) => {
  await page.goto('/#/briefing');
  const header = page.locator('.briefing-topbar');
  const tabs = header.getByRole('tablist', { name: '画报分类' });
  await expect(tabs.getByRole('tab')).toHaveCount(5);
  await expect(page.getByRole('button', { name: '曹鸿健 个人设置与记忆' })).toBeVisible();
  for (const width of [1418, 1050, 900, 801, 768, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 852 });
    await expect(tabs).toBeInViewport({ ratio: 1 });
    const bounds = (await tabs.boundingBox())!;
    const position = await header.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        center: (b.left + parseFloat(style.paddingLeft) + b.right - parseFloat(style.paddingRight)) / 2,
      };
    });
    expect(Math.abs(bounds.x + bounds.width / 2 - position.center)).toBeLessThan(1);
    const title = (await header.getByRole('heading').boundingBox())!;
    if (width > 800) {
      const logo = (await page.locator('.brand-mark').boundingBox())!;
      expect(Math.abs(title.y + title.height / 2 - logo.y - logo.height / 2)).toBeLessThan(1);
      expect(title.x + title.width).toBeLessThan(bounds.x);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1418, height: 852 });
  await page.locator('.page-main').evaluate((el) => {
    el.scrollTop = 900;
  });
  await expect(tabs).toBeInViewport({ ratio: 1 });
  await tabs.getByRole('tab', { name: '空间', exact: true }).click();
  await expect(page.getByLabel('画报工作空间')).toBeInViewport({ ratio: 1 });
  await page.getByLabel('画报工作空间').selectOption('finance');
  await page.locator('[data-card-id="finance:demo-receipts"] .briefing-card-main').click();
  await expect(page.locator('.conversation-overlay')).toHaveAttribute('data-phase', 'open');
  await page.getByRole('button', { name: '关闭会话', exact: true }).click();
  await expect(tabs.getByRole('tab', { name: '空间', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('画报工作空间')).toHaveValue('finance');
  await page.getByRole('navigation').getByRole('button', { name: '资料库', exact: true }).click();
  await expect(page.getByRole('tablist', { name: '画报分类' })).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button', { name: '智能画报', exact: true }).click();
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole('tab', { name: '空间', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('加载旧默认身份时升级姓名与归属，保留卡片和会话；自定义姓名刷新后保留', async ({ page }) => {
  await page.goto('/#/briefing');
  const titles = await page.locator('.briefing-grid .briefing-card h3').allTextContents();
  await page.evaluate((key) => {
    const s = JSON.parse(localStorage.getItem(key)!);
    s.profile.name = '林知';
    delete s.demoProfileVersion;
    for (const item of [...s.records, ...s.materials]) if (item.owner === '曹鸿健') item.owner = '林知';
    for (const space of s.spaces) {
      space.members = space.members.map((name: string) => (name === '曹鸿健' ? '林知' : name));
      if (space.owner === '曹鸿健') space.owner = '林知';
    }
    s.chats[0].title = '我已有的工作会话';
    s.briefing.cards.find((card: any) => card.id === 'finance:demo-receipts').pinned = true;
    localStorage.setItem(key, JSON.stringify(s));
  }, key);
  await page.reload();
  await expect(page.getByRole('button', { name: '曹鸿健 个人设置与记忆' })).toBeVisible();
  expect(await page.locator('.briefing-grid .briefing-card h3').allTextContents()).toEqual(titles);
  const s = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
  expect(s.chats[0].title).toBe('我已有的工作会话');
  expect(s.briefing.cards.find((card: any) => card.id === 'finance:demo-receipts').pinned).toBe(true);
  expect(s.materials.find((doc: any) => doc.id === 'proposal').owner).toBe('曹鸿健');
  await page.getByRole('button', { name: '曹鸿健 个人设置与记忆' }).click();
  await page.getByLabel('如何称呼你').fill('我的称呼');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: '我的称呼 个人设置与记忆' })).toBeVisible();
  await expect(page.locator('.briefing-grid .briefing-card')).toHaveCount(titles.length);
});
