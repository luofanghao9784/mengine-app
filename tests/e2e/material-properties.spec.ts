import { test, expect, type Page } from '@playwright/test';
const key = 'enterprise-ai-demo-konggu-v1';
const id = 'kg-personal-review';
const path = `/#/library/personal/${id}`;
const file = (page: Page) => page.locator(`[data-deck-id="${id}"]`);

async function openPreview(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path);
  await page.getByRole('button', { name: '基于资料提问', exact: true }).click();
  await expect(page.locator('.conversation-overlay')).toHaveAttribute('data-phase', 'open');
  return file(page);
}
async function twoVersions(page: Page) {
  await page.goto(path);
  await page.evaluate(
    ({ key, id }) => {
      const state = JSON.parse(localStorage.getItem(key)!);
      const doc = state.materials.find((d: any) => d.id === id);
      doc.versions[0].content = '历史依据，仅用于当时的讨论。';
      doc.versions.push({
        ...doc.versions[0],
        id: id + '-v2',
        number: 2,
        content: '最新维护内容，用于编辑与共享。',
        note: '补充依据',
      });
      localStorage.setItem(key, JSON.stringify(state));
    },
    { key, id },
  );
  await page.reload();
}

test('属性扩宽同一卡片并保留正文、阅读位置，关闭恢复原宽度', async ({ page }) => {
  await page.setViewportSize({ width: 1277, height: 853 });
  const preview = await openPreview(page);
  await expect(preview.locator('.reader-header h2')).toHaveText('空谷本周经营复盘 · 个人草稿');
  await expect(preview.locator('.reader-document').getByLabel('查看资料版本')).toHaveCount(0);
  await expect(preview.locator('.reader-version-bar')).toHaveCount(0);
  const width = (await preview.boundingBox())!.width;
  const scroll = preview.locator('.reader-scroll');
  await scroll.evaluate((node) => (node.scrollTop = 130));
  const position = await scroll.evaluate((node) => node.scrollTop);
  await preview.getByRole('button', { name: '资料属性', exact: true }).click();
  await expect.poll(async () => (await preview.boundingBox())!.width).toBeGreaterThan(width + 250);
  await expect(preview.locator('.reader-paper')).toBeVisible();
  await expect(preview.getByRole('complementary', { name: '资料属性侧栏' })).toBeVisible();
  await expect(preview.locator('.reader-support').getByLabel('查看资料版本')).toHaveValue(id + '-v1');
  await expect(preview.locator('.reader-support').getByLabel('资料使用状态')).toHaveValue('使用中');
  await expect(preview).toBeInViewport({ ratio: 0.99 });
  await expect(preview.locator('.reader-main > .reader-workspace > .reader-support')).toHaveCount(1);
  await expect(preview.locator('.reader-header').getByRole('button', { name: '编辑资料' })).toHaveCount(0);
  await expect(preview.getByRole('button', { name: '版本记录', exact: true })).toHaveCount(0);
  expect(await scroll.evaluate((node) => node.scrollTop)).toBe(position);
  await preview.getByRole('tab', { name: '基本信息' }).press('ArrowRight');
  await expect(preview.getByRole('tab', { name: '版本记录' })).toBeFocused();
  await preview.getByRole('tab', { name: '版本记录' }).press('ArrowRight');
  await expect(preview.getByRole('tab', { name: '共享与权限' })).toHaveAttribute('aria-selected', 'true');
  await expect(preview.getByLabel('目标工作空间')).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.screenshot({ path: '.local/material-properties/desktop-sharing.png' });
  await preview.getByRole('tab', { name: '共享与权限' }).press('Escape');
  await expect(preview.locator('.reader-support')).toHaveCount(0);
  await expect.poll(async () => (await preview.boundingBox())!.width).toBe(width);
  await expect(preview.getByRole('button', { name: '资料属性', exact: true })).toBeFocused();
  expect(await scroll.evaluate((node) => node.scrollTop)).toBe(position);
});

test('资料滚动后标题渐变生效，全屏复用原阅读节点，关闭恢复会话和位置', async ({ page }) => {
  await page.setViewportSize({ width: 1277, height: 853 });
  const preview = await openPreview(page);
  const url = page.url();
  const reader = preview.locator('.material-reader');
  const scroll = reader.locator('.reader-scroll');
  const header = reader.locator('.reader-header');
  const opacity = () => header.evaluate((node) => getComputedStyle(node, '::before').opacity);
  await expect.poll(opacity).toBe('0');
  await scroll.evaluate((node) => (node.scrollTop = 130));
  await expect.poll(opacity).toBe('1');
  const position = await scroll.evaluate((node) => node.scrollTop);
  const original = await reader.elementHandle();
  const readerCount = await page.locator('.material-reader').count();
  const deckScroll = await page.locator('.deck-scroller').evaluate((node) => node.scrollLeft);
  await preview.getByRole('button', { name: '展开资料详情' }).click();
  const full = page.getByRole('dialog', { name: '资料全屏阅读', exact: true });
  await expect(full).toBeVisible();
  expect(await original!.evaluate((node) => node.closest('dialog')?.open)).toBe(true);
  expect(await page.locator('.material-reader').count()).toBe(readerCount);
  const box = (await full.boundingBox())!;
  expect(box).toEqual({ x: 0, y: 0, width: 1277, height: 853 });
  await expect(full.locator('.reader-header')).not.toHaveAttribute('data-deck-draggable');
  await expect(full.getByRole('button', { name: '编辑资料', exact: true })).toBeVisible();
  await full.getByRole('button', { name: '编辑资料', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑资料', exact: true });
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  await expect(full).toBeVisible();
  await full.locator('.reader-scroll').evaluate((node) => (node.scrollTop = node.scrollHeight));
  await full.getByRole('button', { name: '关闭资料视窗' }).click();
  await expect(full).toHaveCount(0);
  await expect(page).toHaveURL(url);
  expect(await original!.evaluate((node) => !!node.closest('.deck-file'))).toBe(true);
  expect(await scroll.evaluate((node) => node.scrollTop)).toBe(position);
  expect(await page.locator('.deck-scroller').evaluate((node) => node.scrollLeft)).toBe(deckScroll);
  await expect(preview.getByRole('button', { name: '展开资料详情' })).toBeFocused();
  await expect(preview.getByRole('button', { name: '编辑资料' })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('会话卡片切换').getByRole('button', { name: '空谷本周经营复盘 · 个人草稿' }).click();
  await preview.getByRole('button', { name: '展开资料详情' }).click();
  expect(await full.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  await expect(full.getByRole('button', { name: '编辑资料' })).toBeInViewport({ ratio: 1 });
  await full.getByRole('button', { name: '关闭资料视窗' }).press('Escape');
  await expect(full).toHaveCount(0);
  await expect(preview.getByRole('button', { name: '展开资料详情' })).toBeInViewport({ ratio: 1 });
  await expect(page).toHaveURL(url);
});

test('全屏沿用历史版本与属性页，Esc 先收属性再返回原卡片', async ({ page }) => {
  await twoVersions(page);
  await page.getByRole('button', { name: '基于资料提问', exact: true }).click();
  const preview = file(page);
  await preview.getByRole('button', { name: '资料属性', exact: true }).click();
  await preview.getByRole('tab', { name: '版本记录' }).click();
  await preview.locator('.reader-version-list button').filter({ hasText: 'v1' }).click();
  await preview.getByRole('button', { name: '展开资料详情' }).click();
  const full = page.getByRole('dialog', { name: '资料全屏阅读', exact: true });
  await expect(full.locator('.reader-paper')).toContainText('历史依据');
  await expect(full.getByRole('tab', { name: '版本记录' })).toHaveAttribute('aria-selected', 'true');
  await full.getByRole('button', { name: '关闭资料视窗' }).press('Escape');
  await expect(full).toBeVisible();
  await expect(full.locator('.reader-support')).toHaveCount(0);
  await full.getByRole('button', { name: '关闭资料视窗' }).press('Escape');
  await expect(full).toHaveCount(0);
  await expect(preview.locator('.reader-paper')).toContainText('历史依据');
  await expect(preview.locator('.reader-support')).toHaveCount(0);
});

test('悬浮胶囊无动画，正文末尾可滚动至按钮上方，跨断点侧栏可收起', async ({ page }) => {
  const preview = await openPreview(page);
  for (const width of [977, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 853 });
    await page
      .getByLabel('会话卡片切换')
      .getByRole('button', { name: '空谷本周经营复盘 · 个人草稿', exact: true })
      .click();
    const pill = preview.getByRole('button', { name: '基于资料提问', exact: true });
    await expect(pill).toBeInViewport({ ratio: 1 });
    const appearance = await pill.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        radius: style.borderRadius,
        animation: style.animationName,
        before: getComputedStyle(node, '::before').animationName,
        after: getComputedStyle(node, '::after').animationName,
        width: node.getBoundingClientRect().width,
        parentWidth: node.closest('.reader-document')!.getBoundingClientRect().width,
      };
    });
    expect(appearance.radius).toBe('999px');
    expect([appearance.animation, appearance.before, appearance.after]).toEqual(['none', 'none', 'none']);
    expect(appearance.width).toBeLessThan(appearance.parentWidth - 60);
    await preview.locator('.reader-scroll').evaluate((node) => (node.scrollTop = node.scrollHeight));
    const last = (await preview.locator('.reader-paper .document-text p').last().boundingBox())!;
    expect(last.y + last.height).toBeLessThan((await pill.boundingBox())!.y);
    const position = await preview.locator('.reader-scroll').evaluate((node) => node.scrollTop);
    await preview.getByRole('button', { name: '资料属性', exact: true }).click();
    await preview.getByRole('tab', { name: '共享与权限' }).click();
    await expect(preview.getByRole('button', { name: '收起资料属性' })).toBeInViewport({ ratio: 1 });
    expect(
      await preview.locator('.reader-support').evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    if (width === 390) await page.screenshot({ path: '.local/material-properties/mobile-sharing.png' });
    await preview.getByRole('button', { name: '收起资料属性' }).click();
    await expect(preview.locator('.reader-paper')).toBeVisible();
    expect(await preview.locator('.reader-scroll').evaluate((node) => node.scrollTop)).toBe(position);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('历史正文与侧栏同时显示，顶部编辑最新内容，提问引用当前历史版本', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await twoVersions(page);
  const reader = page.locator('.material-reader');
  await reader.getByRole('button', { name: '资料属性', exact: true }).click();
  await reader.getByRole('tab', { name: '版本记录' }).click();
  await reader.locator('.reader-version-list button').filter({ hasText: 'v1' }).click();
  await expect(reader.locator('.reader-paper')).toContainText('历史依据');
  await expect(reader.locator('.reader-action-note')).toContainText('最新版本 v2');
  await reader.getByRole('button', { name: '编辑资料', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '编辑资料', exact: true }).getByLabel('正文')).toHaveValue(
    '最新维护内容，用于编辑与共享。',
  );
  await page
    .getByRole('dialog', { name: '编辑资料', exact: true })
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await reader.getByRole('button', { name: '基于资料提问', exact: true }).click();
  await expect(file(page).locator('.reader-paper')).toContainText('历史依据');
  await expect(page.getByLabel('已选参考资料')).toContainText('v1');
});

test('共享在侧栏内提交，使用最新版本并保留原稿和历史阅读状态', async ({ page }) => {
  await twoVersions(page);
  const reader = page.locator('.material-reader');
  await reader.getByRole('button', { name: '资料属性', exact: true }).click();
  await reader.getByLabel('查看资料版本').selectOption(id + '-v1');
  await reader.getByRole('tab', { name: '共享与权限' }).click();
  await reader.getByLabel('目标工作空间').selectOption('operations');
  await reader.getByRole('button', { name: '确认发布当前版本' }).click();
  await expect(reader.locator('.reader-support')).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(reader.locator('.reader-paper')).toContainText('历史依据');
  await reader.getByRole('tab', { name: '基本信息' }).click();
  await expect(reader.getByLabel('查看资料版本')).toHaveValue(id + '-v1');
  const result = await page.evaluate(
    ({ key, id }) => {
      const state = JSON.parse(localStorage.getItem(key)!);
      return {
        source: state.materials.find((d: any) => d.id === id),
        shared: state.materials.find((d: any) => d.sourceId === id && d.space === 'operations'),
      };
    },
    { key, id },
  );
  expect(result.source.versions).toHaveLength(2);
  expect(result.source.space).toBe('personal');
  expect(result.shared.versions.at(-1).content).toBe('最新维护内容，用于编辑与共享。');
});

test('无目标空间维护权限时沿用申请流程，重复申请不生成共享副本', async ({ page }) => {
  await page.goto(path);
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key)!);
    state.spaces.find((s: any) => s.id === 'operations').canEdit = false;
    localStorage.setItem(key, JSON.stringify(state));
  }, key);
  await page.reload();
  const reader = page.locator('.material-reader');
  await reader.getByRole('button', { name: '资料属性', exact: true }).click();
  await reader.getByRole('tab', { name: '共享与权限' }).click();
  await reader.getByLabel('目标工作空间').selectOption('operations');
  for (let attempt = 0; attempt < 2; attempt++)
    await reader.getByRole('button', { name: '确认申请入库权限' }).click();
  const result = await page.evaluate(
    ({ key, id }) => {
      const state = JSON.parse(localStorage.getItem(key)!);
      return {
        requests: state.requests.filter((r: any) => r.sourceId === id && r.target === 'operations'),
        copies: state.materials.filter((d: any) => d.sourceId === id && d.space === 'operations'),
      };
    },
    { key, id },
  );
  expect(result.requests).toHaveLength(1);
  expect(result.requests[0].status).toBe('pending');
  expect(result.copies).toHaveLength(0);
});
