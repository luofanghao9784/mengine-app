import { test, expect } from '@playwright/test';
const overlay = (page: any) => page.locator('.conversation-overlay');
const origin = (page: any) => page.locator('[data-card-id="finance:demo-receipts"]');
const openOrigin = async (page: any) => {
  await page.goto('/#/briefing');
  await origin(page).locator('.briefing-card-main').click();
  await expect(overlay(page)).toHaveAttribute('data-phase', 'open');
};

test('来源卡片放大为会话，背景保留并模糊，关闭回到原位且草稿不丢失', async ({ page }) => {
  await page.goto('/#/briefing');
  await page.getByRole('tab', { name: '日期', exact: true }).click();
  await expect(page.getByRole('tab', { name: '日期', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('html')).not.toHaveAttribute('data-briefing-slide');
  const clicked = origin(page);
  await clicked.scrollIntoViewIfNeeded();
  const sourceEvidence = await clicked.locator('.briefing-fact, .briefing-evidence').innerText();
  const box = await clicked.boundingBox();
  const readPosition = await page.locator('.page-main').evaluate((el) => el.scrollTop);
  await clicked.locator('.briefing-card-main').click();
  const url = page.url();
  await expect(overlay(page)).toHaveAttribute('data-phase', 'open');
  await expect(page.locator('.conversation-background')).toHaveAttribute('inert', '');
  await expect(page.locator('.conversation-scrim')).toHaveCSS('backdrop-filter', 'blur(10px)');
  await expect(clicked).toHaveClass(/conversation-origin-active/);
  await expect(page.getByRole('region', { name: '会话中的画报原卡片' })).toContainText(sourceEvidence);
  await expect(page.getByRole('region', { name: '画报卡片', exact: true })).toContainText(sourceEvidence);
  await expect(page.locator('.deck-file')).toHaveCount(0);
  await page.getByLabel('继续对话').fill('稍后继续核对');
  await page.getByRole('button', { name: '关闭会话', exact: true }).click();
  await expect(overlay(page)).toHaveAttribute('data-phase', 'closing');
  await expect(page.locator('.conversation-morph')).toBeVisible();
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '日期', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(await page.locator('.page-main').evaluate((el) => el.scrollTop)).toBe(readPosition);
  expect(await clicked.boundingBox()).toEqual(box);
  await clicked.locator('.briefing-card-main').click();
  await expect(page).toHaveURL(url);
  await expect(page.getByLabel('继续对话')).toHaveValue('稍后继续核对');
  await page.getByTestId('conversation-backdrop').click({ position: { x: 5, y: 5 } });
  await expect(overlay(page)).toHaveCount(0);
});

test('文件按身份横向追加、去重，列表与较早文件叠在后方，会话保持等宽且文件可重新打开', async ({ page }) => {
  await page.goto('/#/chat/client');
  await expect(overlay(page)).toHaveAttribute('data-phase', 'open');
  await expect(page.locator('.deck-file')).toHaveCount(1);
  await page.locator('.chat-main .source-chip').filter({ hasText: '服务价格表' }).click();
  await expect(page.locator('.deck-file')).toHaveCount(2);
  await expect.poll(() => page.locator('.deck-scroller').evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  const main = page.locator('.deck-conversation');
  const beforeWidth = (await main.boundingBox())!.width;
  await page
    .locator('.deck-scroller')
    .evaluate((el) => el.scrollTo({ left: el.scrollWidth, behavior: 'instant' }));
  await expect(page.locator('.deck-list')).toHaveAttribute('data-folded', 'true');
  await expect(page.locator('.deck-list .deck-card-content')).toHaveAttribute('inert', '');
  await expect(page.getByRole('button', { name: '展开会话列表', exact: true })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '会话', exact: true }),
  ).not.toHaveClass(/contains-conversation-list/);
  expect((await main.boundingBox())!.width).toBe(beforeWidth);
  expect(
    Math.abs((await main.boundingBox())!.x - (await page.locator('.deck-list').boundingBox())!.x - 24),
  ).toBeLessThan(4);
  await expect(page.getByLabel('继续对话')).toBeInViewport();
  await page.locator('.chat-main .source-chip').filter({ hasText: '服务价格表' }).click();
  await expect(page.locator('.deck-file')).toHaveCount(2);
  await page.locator('[data-deck-id="price"]').getByRole('button', { name: '关闭成果预览' }).click();
  await expect(page.locator('.deck-file')).toHaveCount(1);
  await page.locator('.chat-main .source-chip').filter({ hasText: '服务价格表' }).click();
  await expect(page.locator('[data-deck-id="price"]')).toBeVisible();
});

test('卡片支持拖动和键盘调整宽度，切换会话保留各自草稿与宽度', async ({ page }) => {
  await openOrigin(page);
  const handle = page.getByRole('separator', { name: '调整当前会话宽度' });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 5, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x + 65, box.y + 50, { steps: 8 });
  await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-valuenow', '620');
  await handle.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', '596');
  await page.getByLabel('继续对话').fill('画报未发送草稿');
  const sourceUrl = page.url();
  await page.locator('.deck-list').getByRole('button', { name: '整理本周工作思路', exact: true }).click();
  await page.getByLabel('继续对话').fill('另一段未发送草稿');
  await page.goto(sourceUrl);
  await expect(page.getByLabel('继续对话')).toHaveValue('画报未发送草稿');
  await expect(handle).toHaveAttribute('aria-valuenow', '596');
});

test('前台导航可切换页面，Esc 优先关闭内层弹窗，返回与刷新可恢复已存会话', async ({ page }) => {
  await openOrigin(page);
  await page.getByRole('button', { name: '添加资料', exact: true }).click();
  await expect(page.locator('dialog[open]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(overlay(page)).toBeVisible();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '应用', exact: true })
    .click();
  await expect(overlay(page)).toHaveCount(0);
  await expect(page).toHaveURL(/#\/apps\/all$/);
  await page.getByRole('button', { name: '会话', exact: true }).click();
  await page
    .getByRole('region', { name: '会话列表卡片', exact: true })
    .getByRole('button', { name: '近四周已到账回款', exact: true })
    .click();
  await expect(overlay(page)).toHaveAttribute('data-phase', 'open');
  await page.reload();
  await expect(overlay(page)).toHaveAttribute('data-phase', 'open');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/apps\/all$/);
});

test('浏览器前进后退与减少动态效果均可打开和关闭，无来源时不伪造缩放起点', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOrigin(page);
  const url = page.url();
  await page.goBack();
  await expect(overlay(page)).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(url);
  await expect(overlay(page)).toHaveAttribute('data-phase', 'open');
  await expect(page.locator('.conversation-morph')).toHaveCount(0);
  await page.getByRole('button', { name: '关闭会话', exact: true }).click();
  await expect(overlay(page)).toHaveCount(0);
});

test('窄屏切换列表、来源及自动文件，输入可达，无横向页面溢出', async ({ page }) => {
  await openOrigin(page);
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const tabs = page.getByLabel('会话卡片切换');
    await tabs.getByRole('button', { name: '画报卡片', exact: true }).click();
    await expect(page.getByRole('region', { name: '画报卡片', exact: true })).toBeInViewport();
    await tabs.getByRole('button', { name: '列表', exact: true }).click();
    await expect(page.getByRole('region', { name: '会话列表卡片', exact: true })).toBeInViewport();
    await tabs.getByRole('button', { name: '对话', exact: true }).click();
    await expect(page.getByLabel('继续对话')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('快速关闭与导航切换不会留下动画蒙层或隐藏来源', async ({ page }) => {
  await page.goto('/#/briefing');
  await origin(page).locator('.briefing-card-main').click();
  await page.keyboard.press('Escape');
  await expect(overlay(page)).toHaveCount(0);
  await expect(origin(page)).not.toHaveClass(/conversation-origin-active/);
  await origin(page).locator('.briefing-card-main').click();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '资料库', exact: true })
    .click();
  await expect(overlay(page)).toHaveCount(0);
  await expect(page).toHaveURL(/#\/library\/personal$/);
  await page.getByRole('button', { name: '会话', exact: true }).click();
  await page
    .getByRole('region', { name: '会话列表卡片', exact: true })
    .getByRole('button', { name: '近四周已到账回款', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '智能画报', exact: true })
    .click();
  await expect(page).toHaveURL(/#\/briefing$/);
  await expect(overlay(page)).toHaveCount(0);
});

test('手机从来源或文件视图关闭仍正确缩回卡片，动画没有无效尺寸', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/briefing');
  const source = page.locator('[data-card-id="deliverable:proposal"]');
  for (const label of ['画报卡片', '客户 A 合作方案']) {
    await source.locator('.briefing-card-main').click();
    await expect(overlay(page)).toHaveAttribute('data-phase', 'open');
    await page.getByLabel('会话卡片切换').getByRole('button', { name: label, exact: true }).click();
    await page.getByRole('button', { name: '关闭会话', exact: true }).click();
    await expect(overlay(page)).toHaveCount(0);
    await expect(source).not.toHaveClass(/conversation-origin-active/);
  }
  expect(errors).toEqual([]);
});

test('来源和多个文件逐层叠放，点击边缘可展开且调宽后层叠位置保持正确', async ({ page }) => {
  await page.setViewportSize({ width: 1418, height: 852 });
  await page.goto('/#/briefing');
  await page.locator('[data-card-id="deliverable:proposal"] .briefing-card-main').click();
  await expect(overlay(page)).toHaveAttribute('data-phase', 'open');
  const source = page.locator('.deck-source');
  const conversation = page.locator('.deck-conversation');
  const proposal = page.locator('[data-deck-id="proposal"]');
  await proposal.getByRole('button', { name: '资料信息与来源', exact: true }).click();
  await proposal.getByRole('tab', { name: '关联资料', exact: true }).click();
  await proposal.getByRole('button', { name: /服务价格表/ }).click();
  const price = page.locator('[data-deck-id="price"]');
  await expect(proposal).toHaveAttribute('data-folded', 'true');
  await expect(source).toHaveAttribute('data-folded', 'true');
  await expect(price).not.toHaveAttribute('data-folded', 'true');
  const originalWidth = (await conversation.boundingBox())!.width;
  const bounds = async () => ({
    source: (await source.boundingBox())!,
    proposal: (await proposal.boundingBox())!,
    price: (await price.boundingBox())!,
    conversation: (await conversation.boundingBox())!,
  });
  let boxes = await bounds();
  expect(boxes.source.x).toBeGreaterThanOrEqual(boxes.conversation.x + boxes.conversation.width + 15);
  expect(boxes.proposal.x - boxes.source.x).toBeCloseTo(24, 0);
  expect(boxes.price.x - boxes.proposal.x).toBeCloseTo(24, 0);
  expect(boxes.price.x).toBeLessThan(boxes.proposal.x + boxes.proposal.width);
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-deck-id]')?.getAttribute('data-deck-id'),
      { x: boxes.price.x + 70, y: boxes.price.y + 90 },
    ),
  ).toBe('price');
  await expect(source.locator('.deck-card-content')).toHaveAttribute('inert', '');
  await page.getByRole('button', { name: '展开画报卡片', exact: true }).click();
  await expect(source.locator('.deck-card-content')).not.toHaveAttribute('inert', '');
  await expect(source).not.toHaveAttribute('data-folded', 'true');
  await expect(source.getByRole('heading', { name: '客户 A 合作方案', exact: true })).toBeInViewport();
  const handle = source.getByRole('separator');
  await handle.press('ArrowRight');
  await expect(handle).toHaveAttribute('aria-valuenow', '384');
  await page
    .locator('.deck-scroller')
    .evaluate((el) => el.scrollTo({ left: el.scrollWidth, behavior: 'instant' }));
  await expect(source).toHaveAttribute('data-folded', 'true');
  boxes = await bounds();
  expect(boxes.source.width).toBe(384);
  expect(boxes.price.x - boxes.proposal.x).toBeCloseTo(24, 0);
  expect(boxes.conversation.width).toBe(originalWidth);
  for (const width of [1100, 1001]) {
    await page.setViewportSize({ width, height: 852 });
    await page
      .locator('.deck-scroller')
      .evaluate((el) => el.scrollTo({ left: el.scrollWidth, behavior: 'instant' }));
    await expect(price).toBeInViewport({ ratio: 0.99 });
    const frame = (await page.locator('.deck-scroller').boundingBox())!;
    boxes = await bounds();
    expect(boxes.price.x + boxes.price.width).toBeLessThanOrEqual(frame.x + frame.width);
    expect(boxes.price.x).toBeGreaterThanOrEqual(boxes.conversation.x + boxes.conversation.width);
  }
  await page.setViewportSize({ width: 1418, height: 852 });
  await price.getByRole('button', { name: '关闭成果预览' }).click();
  await expect(proposal).not.toHaveAttribute('data-folded', 'true');
  await page.getByRole('button', { name: '展开会话列表', exact: true }).click();
  await expect(page.locator('.deck-list .deck-card-content')).not.toHaveAttribute('inert', '');
  await expect(page.locator('.deck-list')).not.toHaveAttribute('data-folded', 'true');
  await expect.poll(() => page.locator('.deck-scroller').evaluate((el) => el.scrollLeft)).toBe(0);
  await page
    .locator('.deck-scroller')
    .evaluate((el) => el.scrollTo({ left: el.scrollWidth, behavior: 'instant' }));
  await expect(source).toHaveAttribute('data-folded', 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('会话卡片切换').getByRole('button', { name: '列表', exact: true }).click();
  await expect(
    page.locator('.deck-list').getByRole('button', { name: '新建会话', exact: true }),
  ).toBeVisible();
  await page.getByLabel('会话卡片切换').getByRole('button', { name: '画报卡片', exact: true }).click();
  await expect(source.getByRole('heading', { name: '客户 A 合作方案', exact: true })).toBeVisible();
});

test('会话只保留输入区工作空间入口，去除冗余提示，圆形发送按钮保留回车与换行', async ({ page }) => {
  await openOrigin(page);
  await expect(page.locator('.deck-list .deck-card-header')).toContainText('会话列表');
  await expect(
    page.locator('.conversation-source-bar, .composer-hint, .conversation-card-header .breadcrumb-space'),
  ).toHaveCount(0);
  await expect(page.locator('.conversation-card-header h1')).toHaveText('近四周已到账回款');
  await expect(page.locator('.composer .context-button')).toContainText('财务部门工作空间');
  const send = page.getByRole('button', { name: '发送消息', exact: true });
  await expect(send).toHaveCSS('border-radius', '50%');
  const size = (await send.boundingBox())!;
  expect(size.width).toBe(size.height);
  const input = page.getByLabel('继续对话');
  await input.fill('第一行');
  await input.press('Shift+Enter');
  await input.pressSequentially('第二行');
  await expect(input).toHaveValue('第一行\n第二行');
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(page.locator('.message.user').last()).toContainText('第一行');
  await expect(page.locator('.message.user').last()).toContainText('第二行');
});
