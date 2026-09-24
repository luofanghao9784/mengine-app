import { test, expect, type Page } from '@playwright/test';
const key = 'enterprise-ai-demo-konggu-v1';
const workspace = (page: Page) => page.locator('.conversation-overlay');
async function openConversation(page: Page) {
  await page.goto('/#/briefing');
  await page.locator('[data-card-id="konggu:C09"] .briefing-card-main').click();
  await page.locator('.briefing-detail').getByRole('button', { name: '发起会话', exact: true }).click();
  await expect(workspace(page)).toHaveAttribute('data-phase', 'open');
  await expect(page.locator('.deck-file')).toHaveCount(2);
}
const bounds = async (page: Page, selector: string) =>
  page.locator(selector).evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  });

test('宽屏会话顶栏与卡片工作区对齐，关闭和翻页控件靠右且可达', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openConversation(page);
  for (const width of [1440, 1920, 2366, 2560, 3200]) {
    await page.setViewportSize({ width, height: 1361 });
    const title = await bounds(page, '.deck-toolbar h1');
    const deck = await bounds(page, '.deck-scroller');
    const controls = await bounds(page, '.deck-controls');
    const gutter = await page
      .locator('.deck-scroller')
      .evaluate((node) => parseFloat(getComputedStyle(node).paddingLeft));
    expect(Math.abs(title.left - deck.left - gutter), `${width}: title alignment`).toBeLessThanOrEqual(1);
    await expect
      .poll(
        async () =>
          page.locator('.deck-scroller [data-deck-id]').evaluateAll((nodes) => {
            const boxes = nodes.map((node) => node.getBoundingClientRect());
            return boxes.slice(1).every((box, index) => Math.abs(box.left - boxes[index].right - 8) <= 1);
          }),
        { message: `${width}: list and work cards share the same compact gap` },
      )
      .toBe(true);
    const shadows = await page
      .locator('.deck-scroller [data-deck-id]')
      .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).boxShadow));
    expect(new Set(shadows).size).toBe(1);
    expect(width - controls.right, `${width}: controls right gutter`).toBeLessThanOrEqual(32);
    await expect(page.getByRole('button', { name: '关闭会话', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByLabel('继续对话', { exact: true })).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('宽屏中的窄卡片也能显示长会话标题和长资料引用，不挤出操作按钮', async ({ page }) => {
  await page.setViewportSize({ width: 2366, height: 1361 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openConversation(page);
  const title = '核对会员购买与三十天复购的统计口径，补齐资料来源与观察窗口，整理下一轮回访核查计划';
  const fileTitle = '会员来源-' + 'MembershipRetentionEvidence'.repeat(6);
  await page.evaluate(
    ({ key, title, fileTitle }) => {
      const state = JSON.parse(localStorage.getItem(key)!);
      state.chats.find((c: any) => c.id === location.hash.split('/').at(-1)).title = title;
      state.materials.find((d: any) => d.id === 'kg-D06').title = fileTitle;
      localStorage.setItem(key, JSON.stringify(state));
    },
    { key, title, fileTitle },
  );
  await page.reload();
  await expect(workspace(page)).toHaveAttribute('data-phase', 'open');
  await page.getByRole('separator', { name: '调整当前会话宽度', exact: true }).press('Home');
  const heading = page.locator('.conversation-card-header h1');
  await expect(heading).toHaveText(title);
  expect((await heading.boundingBox())!.height).toBeGreaterThan(30);
  await expect(heading).toHaveAttribute('title', title);
  const options = await bounds(page, '.conversation-card-header .icon-button');
  const header = await bounds(page, '.conversation-card-header');
  expect(options.right).toBeLessThanOrEqual(header.right);
  expect(options.width).toBeGreaterThanOrEqual(30);
  const source = page.locator('.deck-source-scroll');
  expect(await source.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  const chips = source.locator('.briefing-detail-sources > button');
  expect(await chips.evaluateAll((es) => es.every((e) => e.scrollWidth <= e.clientWidth + 1))).toBe(true);
  await chips.filter({ hasText: fileTitle }).click();
  await expect(page.locator('[data-deck-id="kg-D06"] .reader-paper h1')).toHaveText(fileTitle);
  await expect(page.locator('[data-deck-id="kg-D06"] .reader-header-tools button').last()).toBeInViewport({
    ratio: 1,
  });
  await page.screenshot({ path: '.local/conversation-responsive/long-titles.png' });
});

test('大屏多列预览收放和跨断点后，标题、版本及底部操作保持在各自面板内', async ({ page }) => {
  await page.setViewportSize({ width: 2366, height: 1361 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openConversation(page);
  for (const width of [1920, 2366, 2560, 3200]) {
    await page.setViewportSize({ width, height: 1361 });
    await page
      .locator('.deck-scroller')
      .evaluate((e) => e.scrollTo({ left: e.scrollWidth, behavior: 'instant' }));
    const file = page.locator('.deck-file').last();
    await expect(file).toBeInViewport({ ratio: 0.99 });
    for (const selector of ['.reader-header', '.reader-version-bar', '.reader-paper h1', '.reader-footer']) {
      const inside = await file.locator(selector).evaluate((e) => {
        const r = e.getBoundingClientRect(),
          p = e.closest('.deck-file')!.getBoundingClientRect();
        return (
          r.width > 0 && r.left >= p.left && r.right <= p.right && r.top >= p.top && r.bottom <= p.bottom
        );
      });
      expect(inside, `${width}: ${selector}`).toBe(true);
    }
    await expect(page.getByLabel('继续对话', { exact: true })).toBeInViewport({ ratio: 1 });
  }
  await page.setViewportSize({ width: 2366, height: 1361 });
  await page.locator('.deck-scroller').evaluate((e) => e.scrollTo({ left: 0, behavior: 'instant' }));
  await page.screenshot({ path: '.local/conversation-responsive/desktop.png' });
  for (const width of [1000, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const tabs = page.getByLabel('会话卡片切换');
    await tabs.getByRole('button', { name: '指标口径与可比窗口', exact: true }).click();
    await expect(page.locator('[data-deck-id="kg-D02"] .reader-footer')).toBeInViewport({ ratio: 1 });
    await tabs.getByRole('button', { name: '对话', exact: true }).click();
    await expect(page.getByLabel('继续对话', { exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: '关闭会话', exact: true })).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: '.local/conversation-responsive/mobile.png' });
});

test('大屏主页面标题与分类操作完整，新会话列表贴近居中会话框且顶栏保留画布对齐', async ({ page }) => {
  await page.setViewportSize({ width: 2366, height: 1361 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/briefing');
  for (const name of ['智能画报', '资料库', '应用']) {
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true }).click();
    const topbar = page.locator('.main-shell > .topbar');
    await expect(topbar.locator('h1')).toBeInViewport({ ratio: 1 });
    expect(await topbar.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '会话', exact: true })
    .click();
  await expect(workspace(page)).toHaveAttribute('data-presentation', 'page');
  const title = await bounds(page, '.deck-toolbar h1');
  const list = await bounds(page, '.deck-list');
  const rail = await bounds(page, '.deck-scroller');
  const conversation = await bounds(page, '.deck-conversation');
  const gutter = await page
    .locator('.deck-scroller')
    .evaluate((node) => parseFloat(getComputedStyle(node).paddingLeft));
  expect(Math.abs(title.left - rail.left - gutter)).toBeLessThanOrEqual(1);
  expect(Math.abs(conversation.left - list.right - 8)).toBeLessThanOrEqual(1);
});
