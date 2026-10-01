import { test, expect, type Page } from '@playwright/test';
const key = 'enterprise-ai-demo-konggu-v1';
const state = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
const card = (page: Page, id: string) =>
  page.locator(`.briefing-grid .briefing-card[data-card-id="konggu:${id}"]`);
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('enterprise-ai-demo-v1', '{"legacy":"keep me"}'));
  await page.goto('/#/briefing');
});

test('默认空谷40张内容卡，原文配图、独立存储与四期内容分组', async ({ page }) => {
  await expect(page).toHaveTitle('空谷无界 · 梦擎工作空间 · Mengine');
  await expect(page.locator('.briefing-grid .briefing-card')).toHaveCount(40);
  await expect(page.locator('.briefing-grid .template-conversation')).toHaveCount(0);
  expect((await state(page)).materials).toHaveLength(45);
  await expect(page.getByRole('tab', { name: '推荐', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: '日期', exact: true }).click();
  await expect(page.locator('.briefing-date-divider')).toHaveCount(4);
  await page.getByRole('tab', { name: '推荐', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: '推荐画报', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('enterprise-ai-demo-v1'))).toBe(
    '{"legacy":"keep me"}',
  );
  for (const id of ['C30', 'C21', 'C23']) {
    const image = card(page, id).locator('img').first();
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), {
        timeout: 15000,
      })
      .toBe(true);
  }
  await page.locator('.page-main').evaluate((el) => el.scrollTo(0, 0));
  await page.screenshot({ path: '.local/konggu/briefing-desktop.png' });
  await card(page, 'C30').locator('.briefing-card-main').click();
  const link = page.getByLabel('公开资讯原文').getByRole('link').first();
  await expect(link).toHaveAttribute('href', 'https://news.gzw.net/guiyang/26/0914/69057149.shtml');
  await expect(page.getByLabel('公开资讯原文').first()).toContainText('2026-09-14');
});

test('资料库表格、新闻原图与原文入口均可阅读', async ({ page }) => {
  await page.goto('/#/library/operations/kg-D01');
  await expect(page.locator('.reader-paper table')).toHaveCount(1);
  await expect(page.locator('.reader-paper')).toContainText('10,108.00');
  await expect(page.locator('.reader-paper table tbody tr')).toHaveCount(19);
  await page.screenshot({ path: '.local/konggu/library-sales.png' });
  await page.goto('/#/library/brand/kg-S04');
  await expect(page.locator('.reader-paper .source-links a')).toHaveAttribute(
    'href',
    'https://www.gywb.cn/pages/2026/05/07/4f49e1fcfccc443f8094d25965618e7e.html',
  );
  await expect(page.locator('.reader-paper')).toContainText('2026-04-28');
  await expect(page.locator('.source-photo img')).toHaveAttribute('src', /gywb\.cn/);
});

test('从研发会话生成有资料依据的个人草稿，并保留版本修改', async ({ page }) => {
  await page.goto('/#/chat/kg-development');
  await page.getByLabel('继续对话', { exact: true }).fill('整理下一轮新品试饮计划');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.chat-main')).toContainText('9人偏好V2');
  const s = await state(page);
  const answer = s.chats.find((c: any) => c.id === 'kg-development').messages.at(-1);
  expect(answer.refVersions['kg-D09']).toBe('kg-D09-v1');
  expect(s.materials.find((d: any) => d.id === answer.doc).space).toBe('personal');
  await page.screenshot({ path: '.local/konggu/development-conversation.png' });
  await page.goto('/#/library/operations/kg-D01');
  await page.getByRole('button', { name: '编辑资料', exact: true }).click();
  await page.getByRole('textbox', { name: '正文', exact: true }).fill('主理人修改后的销售资料');
  await page.getByRole('button', { name: '保存新版本', exact: true }).click();
  await page.reload();
  await expect(page.locator('.reader-paper')).toContainText('主理人修改后的销售资料');
  await page.goto('/#/chat/kg-review');
  await page.getByLabel('继续对话', { exact: true }).fill('核对本周经营');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.chat-main')).toContainText('关联资料已有新版本');
});

test('详情关注与调整反馈保留原始日期，旧版标题配置和隐藏记录继续生效', async ({ page }) => {
  const before = (await state(page)).briefing.cards.find((c: any) => c.id === 'konggu:C01').updatedAt;
  // Seed saved preferences from the previous interface; there is no grid action menu now.
  await page.evaluate((key) => {
    const s = JSON.parse(localStorage.getItem(key)!);
    const c = s.briefing.cards.find((c: any) => c.id === 'konggu:C01');
    c.config = { ...c.config, title: '空谷本周零售' };
    s.briefing.cards.find((c: any) => c.id === 'konggu:C02').hidden = true;
    localStorage.setItem(key, JSON.stringify(s));
  }, key);
  await page.reload();
  await card(page, 'C01').hover();
  await expect(page.locator('.briefing-card-tools, .briefing-card-menu')).toHaveCount(0);
  await card(page, 'C01').locator('.briefing-card-main').click();
  const detail = page.locator('.briefing-detail');
  await detail.getByRole('button', { name: '关注', exact: true }).click();
  await expect(detail.getByRole('button', { name: '关注', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await detail.getByRole('button', { name: '没用', exact: true }).click();
  await page.getByRole('button', { name: '告诉 AI 如何优化', exact: true }).click();
  await page.getByLabel('说明没用的原因').fill('希望补充工作日与周末的对比');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByRole('button', { name: '返回画报', exact: true }).click();
  await expect(page.locator('.conversation-overlay')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/briefing$/);
  await page.reload();
  await expect(card(page, 'C01').getByRole('heading')).toHaveText('空谷本周零售');
  await expect(card(page, 'C02')).toHaveCount(0);
  const after = (await state(page)).briefing.cards.find((c: any) => c.id === 'konggu:C01');
  expect(after.updatedAt).toBe(before);
  expect(after.pinned).toBe(true);
});

test('企业活动应用、手机布局与所有卡片正文无溢出', async ({ page }) => {
  await page.goto('/#/apps/events/kg-followup');
  await expect(page.locator('body')).toContainText('合成企业D');
  await page.goto('/#/briefing');
  // 54/180 members = 30%, represented by 18 of 60 cells plus one legend swatch.
  await expect(card(page, 'C10').locator('svg rect[fill="#356cd4"]')).toHaveCount(19);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await expect
      .poll(() =>
        page
          .locator('.briefing-grid .briefing-card-main')
          .evaluateAll((cards) =>
            cards
              .filter((c) => c.scrollHeight > c.clientHeight + 2)
              .map((c) => c.parentElement!.getAttribute('data-card-id')),
          ),
      )
      .toEqual([]);
  }
  await page.screenshot({ path: '.local/konggu/briefing-mobile.png' });
});

test('第三方配图失败时保留资讯文字和原文入口', async ({ page }) => {
  await page.route('https://gzw-img.sjw.net/**', (route) => route.abort());
  await page.reload();
  await expect(card(page, 'C30').locator('.briefing-news-photo')).toHaveCount(0);
  await expect(card(page, 'C30')).toContainText('贵阳咖啡博览会');
  await card(page, 'C30').locator('.briefing-card-main').click();
  await expect(page.getByLabel('公开资讯原文').getByRole('link').first()).toHaveAttribute('href', /gzw\.net/);
});
