import { test, expect, type Page } from '@playwright/test';
const key = 'enterprise-ai-demo-konggu-v1';
const state = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
const card = (page: Page, id = 'C01') => page.locator(`.briefing-grid [data-card-id="konggu:${id}"]`);
const positions = (page: Page) =>
  page.locator('.briefing-grid .briefing-card').evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: (node as HTMLElement).dataset.cardId,
      column: (node as HTMLElement).style.gridColumn,
      row: (node as HTMLElement).style.gridRow,
      size: (node as HTMLElement).dataset.size,
    })),
  );
const detail = (page: Page) =>
  page.getByRole('dialog', { name: /./ }).filter({ has: page.locator('.briefing-feedback-actions') });
const open = async (page: Page, id = 'C01') => {
  await card(page, id).locator('.briefing-card-main').click();
  await expect(detail(page)).toBeVisible();
  await detail(page).evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
};
const feedback = async (page: Page, id = 'C01') => {
  const s = await state(page);
  return s.briefing.interactions?.[s.profile.name]?.[`konggu:${id}`]?.feedbacks?.at(-1);
};

test.beforeEach(async ({ page }) => {
  await page.goto('/#/briefing');
  await expect(page.locator('.briefing-grid .briefing-card')).toHaveCount(40);
});

test('先读详情，四个反馈与主会话入口；读后灰显且不立即换位，刷新后仍在原位，数据从类型查找', async ({
  page,
}) => {
  await expect(page.getByRole('tab', { name: '推荐', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.briefing-resize-handle')).toHaveCount(0);
  const chats = (await state(page)).chats.length;
  const before = await positions(page);
  await open(page);
  for (const name of ['有用', '没用', '关注', '转发', '发起会话'])
    await expect(detail(page).getByRole('button', { name, exact: true })).toBeVisible();
  expect((await state(page)).chats.length).toBe(chats);
  await page.getByRole('button', { name: '关闭卡片详情' }).click();
  await expect(card(page)).toHaveAttribute('data-read', 'true');
  await expect.poll(() => positions(page)).toEqual(before);
  await expect(
    page.locator('[data-recommendation-group="recommended"] [data-card-id="konggu:C01"]'),
  ).toHaveCount(1);
  await page.getByRole('button', { name: '刷新智能画报（演示）', exact: true }).click();
  await expect(
    page.locator('[data-recommendation-group="recommended"] [data-card-id="konggu:C01"]'),
  ).toHaveCount(1);
  await expect(page.locator('.briefing-page')).toHaveAttribute('data-refresh-phase', 'idle');
  await expect.poll(() => positions(page)).toEqual(before);
  await page.getByRole('tab', { name: '日期', exact: true }).click();
  await expect(card(page)).toHaveCount(0);
  await page.getByRole('tab', { name: '类型', exact: true }).click();
  await page.getByLabel('内容类型').getByRole('button', { name: '数据', exact: true }).click();
  await expect(card(page)).toHaveCount(1);
});

test('没用原因必选，取消无反馈，预设反馈互斥、修改撤销且刷新保留', async ({ page }) => {
  await open(page);
  await detail(page).getByRole('button', { name: '有用', exact: true }).click();
  await detail(page).getByRole('button', { name: '没用', exact: true }).click();
  await expect(page.getByLabel('选择没用的原因').locator('.briefing-reasons > button')).toHaveCount(5);
  await page.getByRole('button', { name: '取消选择原因' }).click();
  expect((await feedback(page)).value).toBe('useful');
  await detail(page).getByRole('button', { name: '没用', exact: true }).click();
  await page.getByRole('button', { name: '分析或建议没帮助', exact: true }).click();
  await expect(detail(page).getByRole('button', { name: '有用', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect((await feedback(page)).reason).toBe('shallow');
  expect((await state(page)).briefing.cards.find((c: any) => c.id === 'konggu:C01').hidden).toBe(false);
  await page.reload();
  await open(page);
  await expect(detail(page)).toContainText('没用 · 分析或建议没帮助');
  await detail(page).getByRole('button', { name: '修改', exact: true }).click();
  await page.getByRole('button', { name: '与当前工作无关', exact: true }).click();
  expect((await feedback(page)).reason).toBe('irrelevant');
  await detail(page).getByRole('button', { name: '撤销', exact: true }).click();
  expect(await feedback(page)).toBeUndefined();
});

test('自填直接进入准备好上下文的会话，未发送不反馈，发送后退出回到画报', async ({ page }) => {
  await open(page);
  await detail(page).getByRole('button', { name: '没用', exact: true }).click();
  await page.getByRole('button', { name: '告诉 AI 如何优化', exact: true }).click();
  const input = page.getByRole('textbox', { name: '说明没用的原因' });
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('');
  await expect(page.getByLabel('卡片调整上下文')).toBeVisible();
  expect(await feedback(page)).toBeUndefined();
  const context = (await state(page)).chats.find((c: any) => c.briefingContext?.feedback);
  expect(context.briefingContext.snapshot.id).toBe('konggu:C01');
  expect(context.messages.some((m: any) => m.role === 'user')).toBe(false);
  await input.fill('希望按工作日和周末分别分析，只有总额没法判断原因');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  expect((await feedback(page)).reason).toBe('custom');
  await page.getByRole('button', { name: '返回画报', exact: true }).click();
  await expect(page.locator('.conversation-overlay')).toHaveCount(0);
  await expect(detail(page)).toHaveCount(0);
  await open(page);
  await expect(detail(page)).toContainText('希望按工作日和周末分别分析');
  await page.screenshot({ path: '.local/feedback/custom-receipt.png' });
});

test('普通会话按需打开，来源卡片仍保留', async ({ page }) => {
  await open(page);
  await detail(page).getByRole('button', { name: '发起会话', exact: true }).click();
  await expect(page.getByLabel('继续对话', { exact: true })).toBeVisible();
  const s = await state(page);
  const id = s.briefing.cards.find((c: any) => c.id === 'konggu:C01').chatId;
  expect(s.chats.find((c: any) => c.id === id).briefingContext.purpose).toBe('content');
  expect(s.briefing.cards.filter((c: any) => c.id === 'konggu:C01')).toHaveLength(1);
});

test('会话中的画报标题栏与外部卡片同步显示有用、没用、关注及会话状态', async ({ page }) => {
  for (const value of ['useful', 'useless']) {
    await open(page);
    if (value === 'useful') {
      await detail(page).getByRole('button', { name: '有用', exact: true }).click();
      await detail(page).getByRole('button', { name: '关注', exact: true }).click();
    } else {
      await detail(page).getByRole('button', { name: '没用', exact: true }).click();
      await page.getByRole('button', { name: '分析或建议没帮助', exact: true }).click();
    }
    await detail(page).getByRole('button', { name: '发起会话', exact: true }).click();
    const header = page.locator('.deck-source .deck-card-header');
    const kinds = (selector: string) =>
      page.locator(selector).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-mark')));
    await expect
      .poll(() => kinds('.deck-source .deck-card-header [data-mark]'))
      .toEqual([value, 'following', 'conversation']);
    await expect(
      header.getByRole('img', { name: value === 'useful' ? '已标记有用' : '已标记没用' }),
    ).toBeVisible();
    const marks = await kinds('.deck-source .deck-card-header [data-mark]');
    await page.getByRole('button', { name: '关闭会话', exact: true }).click();
    await expect(page.locator('.conversation-overlay')).toHaveCount(0);
    expect(
      await card(page)
        .locator('[data-mark]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-mark'))),
    ).toEqual(marks);
  }
});

test('读过五张卡片后刷新与重载仍保留原位，全部卡片持续展示，已读和关注保留', async ({ page }) => {
  const before = await positions(page);
  for (const id of ['C01', 'C02', 'C03', 'C04', 'C05']) {
    await open(page, id);
    if (id === 'C05') await detail(page).getByRole('button', { name: '关注', exact: true }).click();
    await page.getByRole('button', { name: '关闭卡片详情' }).click();
  }
  await page.getByRole('button', { name: '刷新智能画报（演示）', exact: true }).click();
  await expect(page.locator('.briefing-page')).toHaveAttribute('data-refresh-phase', 'idle');
  await expect.poll(() => positions(page)).toEqual(before);
  await page.reload();
  await expect.poll(() => positions(page)).toEqual(before);
  await expect(page.locator('.briefing-grid .briefing-card')).toHaveCount(40);
  await expect(page.locator('[data-recommendation-group="read"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /展开其余.*已读卡片/ })).toHaveCount(0);
  for (const id of ['C01', 'C02', 'C03', 'C04', 'C05'])
    await expect(card(page, id)).toHaveAttribute('data-read', 'true');
  expect((await state(page)).briefing.cards.find((c: any) => c.id === 'konggu:C05').pinned).toBe(true);
});

test('转发选择有权限同事并演示提交，取消不留记录', async ({ page }) => {
  await open(page);
  await detail(page).getByRole('button', { name: '转发', exact: true }).click();
  await expect(page.getByLabel('转发给同事')).toContainText('不会向同事发送消息');
  await expect(page.getByRole('button', { name: '模拟转发', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '取消转发' }).click();
  expect((await state(page)).briefing.shares || []).toHaveLength(0);
  await detail(page).getByRole('button', { name: '转发', exact: true }).click();
  await page.locator('.briefing-recipients > button:enabled').first().click();
  await page.getByRole('textbox', { name: '转发说明' }).fill('请看看工作日客流');
  await page.getByRole('button', { name: '模拟转发', exact: true }).click();
  await expect(page.getByText('已保存演示转发记录', { exact: true })).toBeVisible();
  expect((await state(page)).briefing.shares).toHaveLength(1);
});

test('桌面和手机详情、原因、转发可操作且无横向溢出', async ({ page }) => {
  await open(page);
  await page.screenshot({ path: '.local/feedback/detail-desktop.png', animations: 'disabled' });
  await detail(page).getByRole('button', { name: '没用', exact: true }).click();
  await page.screenshot({ path: '.local/feedback/reasons-desktop.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '告诉 AI 如何优化', exact: true })).toBeVisible();
  const overflows = await detail(page).evaluate(
    (el) =>
      [...el.querySelectorAll<HTMLElement>('button, textarea')].filter(
        (c) => c.getBoundingClientRect().right > innerWidth + 1,
      ).length,
  );
  expect(overflows).toBe(0);
  await page.screenshot({ path: '.local/feedback/reasons-mobile.png' });
  await page.getByRole('button', { name: '内容不准确或已过时', exact: true }).click();
  await expect(detail(page)).toContainText('没用 · 内容不准确或已过时');
});

test('外侧四个反馈复用导航样式，内部悬浮胶囊保持流光；全文随同一快照进入会话画报卡片', async ({ page }) => {
  await open(page);
  await detail(page).evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
  const article = detail(page).locator('.briefing-detail-article');
  const feedbackRail = detail(page).locator('.briefing-feedback-actions');
  const cta = detail(page).getByRole('button', { name: '发起会话', exact: true });
  const actions = feedbackRail.locator(':scope > .nav-item > button');
  await expect(actions).toHaveCount(4);
  expect(
    await actions.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))),
  ).toEqual(['有用', '没用', '关注', '转发']);
  const bodyBox = (await article.boundingBox())!;
  const railBox = (await feedbackRail.boundingBox())!;
  const ctaBox = (await cta.boundingBox())!;
  expect(railBox.x).toBeGreaterThanOrEqual(bodyBox.x + bodyBox.width - 1);
  await expect(cta).toHaveText('发起会话');
  expect(ctaBox.x).toBeGreaterThan(bodyBox.x);
  expect(ctaBox.x + ctaBox.width).toBeLessThan(bodyBox.x + bodyBox.width);
  expect(ctaBox.width).toBeGreaterThan(120);
  const useful = feedbackRail.getByRole('button', { name: '有用', exact: true });
  const navStyle = await page
    .locator('.sidebar .nav-link')
    .first()
    .evaluate((el) => {
      const style = getComputedStyle(el);
      return { radius: style.borderRadius, shadow: style.boxShadow, background: style.backgroundColor };
    });
  await expect(useful).toHaveCSS('border-radius', navStyle.radius);
  await expect(useful).toHaveCSS('box-shadow', navStyle.shadow);
  await expect(useful).toHaveCSS('background-color', navStyle.background);
  await expect(useful.locator('svg')).toHaveAttribute('stroke-width', '1.65');
  await useful.hover();
  await expect(useful.locator('.nav-label')).toHaveCSS('opacity', '1');
  const navInk = await page.locator('.sidebar .nav-link.active').evaluate((el) => getComputedStyle(el).color);
  await expect(useful).toHaveCSS('color', navInk);
  const blurLayers = await useful.locator('.nav-label').evaluate((el) => {
    const source = document.querySelector('.sidebar .nav-label')!;
    return ['::before', '::after'].map((pseudo) => ({
      actual: getComputedStyle(el, pseudo).backdropFilter,
      expected: getComputedStyle(source, pseudo).backdropFilter,
    }));
  });
  for (const layer of blurLayers) expect(layer.actual).toBe(layer.expected);
  await page.screenshot({ path: '.local/feedback/detail-navigation-hover.png', animations: 'disabled' });
  await useful.focus();
  for (let index = 0; index < 3; index++) await page.keyboard.press('Tab');
  await expect(
    feedbackRail.getByRole('button', { name: '转发', exact: true }).locator('.nav-label'),
  ).toHaveCSS('opacity', '1');
  await expect(useful.locator('.nav-label')).toHaveCSS('opacity', '0');
  // Verify the visible background at two animation phases, not just the presence of a CSS rule.
  const gradients = await cta.evaluate((el) => {
    const animations = el
      .getAnimations({ subtree: true })
      .filter((a) => a instanceof CSSAnimation && a.animationName.startsWith('briefing-conversation-'));
    return animations.map((animation) => {
      const result = {
        running: animation.playState,
        iterations: animation.effect!.getTiming().iterations,
        duration: animation.effect!.getTiming().duration,
      };
      animation.pause();
      animation.currentTime = 1000;
      return result;
    });
  });
  expect(gradients).toHaveLength(2);
  for (const gradient of gradients) {
    expect(gradient.running).toBe('running');
    expect(gradient.iterations).toBe(Infinity);
    expect(gradient.duration).toBe(10000);
  }
  const firstFrame = await cta.screenshot({ path: '.local/feedback/conversation-flow-start.png' });
  const iconBox = await cta.locator('svg').boundingBox();
  await cta.evaluate((el) =>
    el.getAnimations({ subtree: true }).forEach((animation) => {
      animation.currentTime = 5500;
    }),
  );
  const secondFrame = await cta.screenshot({ path: '.local/feedback/conversation-flow-light.png' });
  expect(firstFrame.equals(secondFrame)).toBe(false);
  expect(await cta.locator('svg').boundingBox()).toEqual(iconBox);
  const transforms = await cta.evaluate((el) => {
    const light = new DOMMatrixReadOnly(getComputedStyle(el, '::after').transform);
    return {
      base: getComputedStyle(el, '::before').transform,
      a: light.a,
      b: light.b,
      c: light.c,
      d: light.d,
    };
  });
  expect(transforms).toEqual({ base: 'none', a: 1, b: 0, c: 0, d: 1 });
  await cta.evaluate((el) => el.getAnimations({ subtree: true }).forEach((animation) => animation.play()));
  const cardBox = (await detail(page).locator('.briefing-detail-card').boundingBox())!;
  expect(railBox.x).toBeGreaterThan(cardBox.x + cardBox.width + 8);
  expect(ctaBox.y + ctaBox.height).toBeLessThan(cardBox.y + cardBox.height);
  expect(railBox.y + railBox.height).toBeCloseTo(cardBox.y + cardBox.height, 0);
  expect(ctaBox.width).toBeLessThan(180);
  expect(ctaBox.height).toBeLessThanOrEqual(48);
  await expect(article).toContainText('这次增长，可以怎样理解');
  const fullText = await article.innerText();
  await article.getByRole('heading', { name: '下一步，先补一张分时对照表' }).scrollIntoViewIfNeeded();
  await expect(cta).toBeInViewport();
  await expect(feedbackRail).toBeInViewport();
  await page.screenshot({ path: '.local/feedback/detail-extended-desktop.png', animations: 'disabled' });
  await cta.click();
  const retained = page.locator('.briefing-reference .briefing-card');
  await expect(page.locator('.conversation-overlay')).toHaveAttribute('data-phase', 'open');
  await expect(retained).toHaveCount(1);
  await expect(retained).toContainText('过去7天，零售向上。');
  await expect(retained).toContainText('1,307单 · 较上期增长12.6%');
  await expect(retained).not.toContainText('每单36.86元');
  await expect(retained).not.toContainText('这次增长，可以怎样理解');
  await expect(page.locator('.briefing-reference .briefing-detail-article')).toHaveCount(0);
  const source = page.locator('.deck-source-scroll .briefing-detail-article');
  await expect(source).toHaveCount(1);
  expect(await source.innerText()).toBe(fullText);
  await source.getByRole('heading', { name: '下一步，先补一张分时对照表' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.local/feedback/conversation-full-article.png', animations: 'disabled' });
  const saved = (await state(page)).chats.find((c: any) => c.briefingContext?.cardId === 'konggu:C01');
  expect(saved.briefingContext.article.sections).toHaveLength(2);
  await page.reload();
  await expect(page.locator('.briefing-reference .briefing-card')).toHaveCount(1);
  await expect(page.locator('.briefing-reference .briefing-detail-article')).toHaveCount(0);
  await expect(page.locator('.deck-source-scroll .briefing-article-extension')).toContainText(
    '下一步，先补一张分时对照表',
  );
});

test('手机右侧反馈与内部悬浮会话保持可见，新闻详情全文可读', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'C21');
  const cta = detail(page).getByRole('button', { name: '发起会话', exact: true });
  const extension = detail(page).locator('.briefing-article-extension');
  await expect(extension).toContainText('将地方风味作为探索方向');
  await extension.scrollIntoViewIfNeeded();
  await expect(cta).toBeInViewport();
  await expect(detail(page).getByRole('button', { name: '转发', exact: true })).toBeInViewport();
  const cardBounds = (await detail(page).locator('.briefing-detail-card').boundingBox())!;
  const buttonBounds = (await detail(page).getByRole('button', { name: '转发', exact: true }).boundingBox())!;
  expect(buttonBounds.y + buttonBounds.height).toBeCloseTo(cardBounds.y + cardBounds.height, 0);
  const ctaBounds = (await cta.boundingBox())!;
  expect(ctaBounds.width).toBeGreaterThan(120);
  expect(ctaBounds.x).toBeGreaterThan(cardBounds.x);
  expect(ctaBounds.x + ctaBounds.width).toBeLessThan(cardBounds.x + cardBounds.width);
  expect(await detail(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: '.local/feedback/detail-extended-mobile.png', animations: 'disabled' });
  await cta.click();
  await expect(page.locator('.conversation-overlay')).toHaveAttribute('data-phase', 'open');
  await expect(page.locator('.briefing-reference .briefing-card')).toHaveCount(1);
  await expect(page.locator('.briefing-reference .briefing-article-extension')).toHaveCount(0);
  await page.screenshot({ path: '.local/feedback/conversation-summary-mobile.png', animations: 'disabled' });
  await page.getByRole('button', { name: '画报卡片', exact: true }).first().click();
  await expect(page.locator('.deck-source-scroll .briefing-article-extension')).toContainText(
    '将地方风味作为探索方向',
  );
});

test('悬浮会话不随正文滚动，末尾来源在窄屏、调宽和反馈回执下均可完全露出', async ({ page }) => {
  await open(page);
  const reading = detail(page).locator('.briefing-detail-scroll');
  const cta = detail(page).getByRole('button', { name: '发起会话', exact: true });
  const lastSource = detail(page).locator('.briefing-detail-sources > button').last();
  const checkClearance = async () => {
    // Finish the viewport resize frame before comparing positions across scroll.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    await reading.evaluate((el) => (el.scrollTop = 0));
    const before = (await cta.boundingBox())!;
    await reading.evaluate((el) => (el.scrollTop = el.scrollHeight));
    const after = (await cta.boundingBox())!;
    expect(after).toEqual(before);
    await expect(lastSource).toBeInViewport({ ratio: 1 });
    const source = (await lastSource.boundingBox())!;
    expect(source.y + source.height).toBeLessThanOrEqual(after.y - 12);
    // The actual link, not an overlapping floating layer, receives a click at its center.
    expect(
      await lastSource.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }),
    ).toBe(true);
  };
  await checkClearance();
  await page.setViewportSize({ width: 848, height: 757 });
  await checkClearance();
  await page.screenshot({ path: '.local/feedback/capsule-bottom-848.png', animations: 'disabled' });
  const edge = detail(page).getByRole('separator', { name: '调整画报详情宽度（右侧）' });
  await edge.press('Home');
  await checkClearance();
  await edge.press('End');
  await checkClearance();
  await detail(page).getByRole('button', { name: '没用', exact: true }).click();
  await page.getByRole('button', { name: '分析或建议没帮助', exact: true }).click();
  await checkClearance();
  await page.setViewportSize({ width: 320, height: 640 });
  await checkClearance();
  const header = (await detail(page).locator('.briefing-detail-top').boundingBox())!;
  const receipt = (await detail(page).locator('.briefing-feedback-receipt').boundingBox())!;
  const body = (await reading.boundingBox())!;
  expect(receipt.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
  expect(receipt.y + receipt.height).toBeLessThanOrEqual(body.y);
  await expect(detail(page).getByRole('button', { name: '修改', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(detail(page).getByRole('button', { name: '撤销', exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: '.local/feedback/capsule-bottom-320-receipt.png', animations: 'disabled' });
});

async function holdDetailMotion(page: Page) {
  await page.evaluate(() => {
    const animate = Element.prototype.animate;
    const motions: Animation[] = [];
    Object.assign(window, { detailMotions: motions, nativeDetailAnimate: animate });
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      if (
        animation.effect?.getTiming().duration === 420 &&
        this.closest('.phase-entering') &&
        (this.matches('.conversation-morph, .deck-source') || this.closest('.conversation-morph'))
      ) {
        animation.pause();
        animation.currentTime = 0;
        motions.push(animation);
      }
      return animation;
    };
  });
}
async function seekDetailMotion(page: Page, time?: number) {
  await page.evaluate((time) => {
    const motions = (window as unknown as { detailMotions: Animation[] }).detailMotions;
    motions.forEach((animation) =>
      time === undefined ? animation.finish() : (animation.currentTime = time),
    );
  }, time);
}

test('详情本体过渡到会话来源卡片，保持全文与滚动位置；关闭、Escape、浏览器返回均不恢复弹窗', async ({
  page,
}) => {
  for (const exit of ['close', 'escape', 'back']) {
    await open(page);
    if (exit === 'close') {
      await detail(page)
        .locator('.briefing-detail-scroll')
        .evaluate((el) => (el.scrollTop = 280));
      await detail(page).evaluate((el) =>
        Promise.all(el.getAnimations().map((animation) => animation.finished)),
      );
      const beforeScroll = await detail(page)
        .locator('.briefing-detail-scroll')
        .evaluate((el) => el.scrollTop);
      const before = (await detail(page).locator('.briefing-detail-card').boundingBox())!;
      await holdDetailMotion(page);
      await detail(page).getByRole('button', { name: '发起会话', exact: true }).click();
      const surface = page.locator('.conversation-morph');
      await expect(surface).toHaveAttribute('data-destination', 'source');
      await expect(surface.locator('.briefing-conversation-cta')).toHaveCount(0);
      const start = (await surface.boundingBox())!;
      for (const key of ['x', 'y', 'width', 'height'] as const)
        expect(start[key]).toBeCloseTo(before[key], 0);
      expect(await surface.locator('.briefing-detail-scroll').evaluate((el) => el.scrollTop)).toBe(
        beforeScroll,
      );
      await expect(detail(page)).toHaveCount(0);
      await seekDetailMotion(page, 190);
      const middle = (await surface.boundingBox())!;
      expect(middle.x).toBeGreaterThan(start.x);
      expect(middle.width).toBeLessThan(start.width);
      await expect(surface).toHaveCSS('opacity', '1');
      await expect(page.locator('.deck-source')).toHaveCSS('opacity', '0');
      await page.screenshot({ path: '.local/feedback/detail-to-source-midpoint.png' });
      await seekDetailMotion(page, 355);
      const arrived = (await surface.boundingBox())!;
      const target = (await page.locator('.deck-source').boundingBox())!;
      for (const key of ['x', 'y', 'width', 'height'] as const)
        expect(arrived[key]).toBeCloseTo(target[key], 0);
      await seekDetailMotion(page);
      await expect(surface).toBeHidden();
    } else await detail(page).getByRole('button', { name: '发起会话', exact: true }).click();
    // Restore native animation after the first held transition.
    if (exit === 'close')
      await page.evaluate(() => {
        const motions = (window as unknown as { detailMotions: Animation[] }).detailMotions;
        motions.length = 0;
        Element.prototype.animate = (
          window as unknown as { nativeDetailAnimate: typeof Element.prototype.animate }
        ).nativeDetailAnimate;
      });
    await expect(page.locator('.conversation-overlay')).toHaveAttribute('data-phase', 'open');
    if (exit === 'close') await page.getByRole('button', { name: '关闭会话', exact: true }).click();
    if (exit === 'escape') await page.keyboard.press('Escape');
    if (exit === 'back') await page.goBack();
    await expect(page.locator('.conversation-overlay')).toHaveCount(0);
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page).toHaveURL(/#\/briefing$/);
    await expect(card(page)).toHaveAttribute('data-read', 'true');
    // A fresh page removes the animation interception; stored feedback and read state remain.
    await page.reload();
  }
});

test('入场途中关闭不回弹到详情，减少动态效果时可直接进入和退出', async ({ page }) => {
  await open(page);
  await holdDetailMotion(page);
  await detail(page).getByRole('button', { name: '发起会话', exact: true }).click();
  await seekDetailMotion(page, 100);
  await page.getByRole('button', { name: '关闭会话', exact: true }).click();
  await expect(page.locator('.conversation-overlay')).toHaveCount(0);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.reload();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 640 });
  await open(page);
  await expect(detail(page).getByRole('button', { name: '转发', exact: true })).toBeInViewport();
  await expect(detail(page).getByRole('button', { name: '发起会话', exact: true })).toBeInViewport();
  expect(
    await detail(page)
      .locator('.briefing-conversation-cta')
      .evaluate((el) => ['::before', '::after'].map((pseudo) => getComputedStyle(el, pseudo).animationName)),
  ).toEqual(['none', 'none']);
  await page.screenshot({ path: '.local/feedback/detail-floating-320.png' });
  await detail(page).getByRole('button', { name: '发起会话', exact: true }).click();
  await expect(page.locator('.conversation-overlay')).toHaveAttribute('data-phase', 'open');
  await expect(page.getByRole('textbox', { name: '继续对话', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭会话', exact: true }).click();
  await expect(page.locator('.conversation-overlay')).toHaveCount(0);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('有用提示复用悬浮标题并显示在右侧，关注使用星形；窄屏提示避让', async ({ page }) => {
  await open(page);
  const useful = detail(page).getByRole('button', { name: '有用', exact: true });
  const reading = detail(page).locator('.briefing-detail-reading');
  const before = await reading.boundingBox();
  await useful.click();
  const notice = useful.getByRole('status');
  await expect(notice).toHaveText('已记下，对你有帮助');
  await expect(notice).toHaveCSS('opacity', '1');
  const buttonBox = (await useful.boundingBox())!;
  const noticeBox = (await notice.boundingBox())!;
  expect(noticeBox.x).toBeGreaterThan(buttonBox.x + buttonBox.width);
  expect(await reading.boundingBox()).toEqual(before);
  await page.screenshot({ path: '.local/feedback/useful-right-notice.png' });
  await useful.click();
  await expect(useful.getByRole('status')).toHaveText('已撤销有用');
  const follow = detail(page).getByRole('button', { name: '关注', exact: true });
  await expect(follow.locator('svg.lucide-star')).toBeVisible();
  await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  await useful.click();
  await expect(notice).toHaveCSS('opacity', '1');
  const narrow = (await notice.boundingBox())!;
  expect(narrow.x).toBeGreaterThanOrEqual(0);
  expect(narrow.x + narrow.width).toBeLessThanOrEqual(390);
  await page.mouse.move(60, 160);
  await expect(useful.locator('.nav-label')).toHaveCSS('opacity', '0');
});

test('五项原因在按钮原位展开，关闭或点外部不提交，转发独立弹窗取消回详情', async ({ page }) => {
  await open(page);
  const useless = detail(page).getByRole('button', { name: '没用', exact: true });
  const trigger = (await useless.boundingBox())!;
  const reading = detail(page).locator('.briefing-detail-reading');
  const before = await reading.boundingBox();
  const reasons = page.getByRole('dialog', { name: '选择没用的原因', exact: true });
  await useless.click();
  await expect(reasons.locator('.briefing-reasons > button')).toHaveCount(5);
  await expect(reasons).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  const panel = (await reasons.boundingBox())!;
  expect(panel.x + panel.width).toBeCloseTo(trigger.x + trigger.width, 0);
  expect(panel.y + panel.height).toBeCloseTo(trigger.y + trigger.height, 0);
  expect(await reading.boundingBox()).toEqual(before);
  await page.screenshot({ path: '.local/feedback/reasons-at-button.png' });
  await page.keyboard.press('Escape');
  await expect(reasons).toHaveCount(0);
  await expect(detail(page)).toBeVisible();
  await expect(useless).toBeFocused();
  expect(await feedback(page)).toBeUndefined();
  await useless.click();
  await page.locator('#briefing-detail-title').click();
  await expect(reasons).toHaveCount(0);
  expect(await feedback(page)).toBeUndefined();
  const shareButton = detail(page).getByRole('button', { name: '转发', exact: true });
  await shareButton.click();
  const share = page.getByRole('dialog', { name: '转发给同事', exact: true });
  await expect(share).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(2);
  await expect(share).toContainText('过去7天零售48,178元');
  await share.getByRole('textbox', { name: '转发说明' }).fill('取消时丢弃这次转发草稿');
  await page.screenshot({ path: '.local/feedback/share-independent.png' });
  await page.keyboard.press('Escape');
  await expect(share).toHaveCount(0);
  await expect(detail(page)).toBeVisible();
  await expect(shareButton).toBeFocused();
  expect((await state(page)).briefing.shares || []).toHaveLength(0);
  await shareButton.click();
  await expect(share.getByRole('textbox', { name: '转发说明' })).toHaveValue('');
  await share.getByRole('button', { name: '取消转发', exact: true }).click();
});

test('详情左右无把手边缘拖拽调宽、记忆、键盘与恢复默认；窄屏限宽后仍可进入会话', async ({ page }) => {
  await open(page);
  const grip = detail(page).getByRole('separator', { name: '调整画报详情宽度（右侧）' });
  const readingCard = detail(page).locator('.briefing-detail-card');
  const original = (await readingCard.boundingBox())!;
  const handle = (await grip.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 100, handle.y + handle.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(grip).toHaveAttribute('aria-valuenow', String(original.width + 200));
  const left = detail(page).getByRole('separator', { name: '调整画报详情宽度（左侧）' });
  const leftEdge = (await left.boundingBox())!;
  const cardEdge = (await readingCard.boundingBox())!;
  expect(leftEdge.x + leftEdge.width / 2).toBeCloseTo(cardEdge.x, 0);
  for (const delta of [-20, 70]) {
    const edge = (await left.boundingBox())!;
    const beforeWidth = (await readingCard.boundingBox())!.width;
    await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
    await expect(left).toHaveCSS('cursor', 'ew-resize');
    await page.mouse.down();
    await page.mouse.move(edge.x + edge.width / 2 + delta, edge.y + edge.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(left).toHaveAttribute('aria-valuenow', String(beforeWidth - delta * 2));
  }
  // Hovering either invisible edge shows only a resize cursor, not a painted grip.
  for (const edge of [left, grip]) {
    await edge.hover();
    await expect(edge.locator('*')).toHaveCount(0);
    await expect(edge).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(edge).toHaveCSS('outline-style', 'none');
  }
  const width = (await readingCard.boundingBox())!.width;
  await page.screenshot({ path: '.local/feedback/detail-resized.png' });
  await page.getByRole('button', { name: '关闭卡片详情' }).click();
  await open(page);
  expect((await readingCard.boundingBox())!.width).toBe(width);
  await page.reload();
  await open(page);
  expect((await readingCard.boundingBox())!.width).toBe(width);
  await grip.press('End');
  await expect(grip).toHaveAttribute('aria-valuenow', '1120');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(grip).toHaveAttribute('aria-valuenow', '310');
  await expect(detail(page).getByRole('button', { name: '发起会话', exact: true })).toBeInViewport();
  expect(await detail(page).evaluate((el) => el.getBoundingClientRect().right <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(grip).toHaveAttribute('aria-valuenow', '1120');
  await grip.dblclick();
  await expect(grip).toHaveAttribute('aria-valuenow', '800');
  await grip.press('ArrowRight');
  await expect(grip).toHaveAttribute('aria-valuenow', '824');
  await detail(page).getByRole('button', { name: '发起会话', exact: true }).click();
  await expect(page.locator('.conversation-overlay')).toHaveAttribute('data-phase', 'open');
  await expect(page.locator('.deck-source-scroll .briefing-article-extension')).toContainText(
    '这次增长，可以怎样理解',
  );
  await page.getByRole('button', { name: '关闭会话', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('反馈选中实心、撤销空心，没用取消不提交；转发提交后标记保留', async ({ page }) => {
  await open(page);
  const useful = detail(page).getByRole('button', { name: '有用', exact: true });
  const useless = detail(page).getByRole('button', { name: '没用', exact: true });
  const follow = detail(page).getByRole('button', { name: '关注', exact: true });
  const share = detail(page).getByRole('button', { name: '转发', exact: true });
  const expectFill = async (button: ReturnType<typeof detail>, selected: boolean) => {
    if (selected)
      await expect
        .poll(() =>
          button.locator('svg').evaluate((el) => {
            const style = getComputedStyle(el);
            return style.fill !== 'none' && style.fill === style.color;
          }),
        )
        .toBe(true);
    else await expect(button.locator('svg')).toHaveCSS('fill', 'none');
  };
  for (const button of [useful, useless, follow, share]) await expectFill(button, false);
  await useful.click();
  await expectFill(useful, true);
  await page.screenshot({ path: '.local/feedback/useful-filled.png' });
  await useful.click();
  await expectFill(useful, false);
  await useless.click();
  await page.getByRole('button', { name: '取消选择原因' }).click();
  await expectFill(useless, false);
  expect(await feedback(page)).toBeUndefined();
  await useless.click();
  await page.getByRole('button', { name: '分析或建议没帮助', exact: true }).click();
  await expectFill(useless, true);
  await expectFill(useful, false);
  await follow.click();
  await expectFill(follow, true);
  await page.screenshot({ path: '.local/feedback/useless-follow-filled.png' });
  await page.reload();
  await open(page);
  await expectFill(useless, true);
  await expectFill(follow, true);
  await detail(page).getByRole('button', { name: '撤销', exact: true }).click();
  await expectFill(useless, false);
  await follow.click();
  await expectFill(follow, false);
  await share.click();
  await page.getByRole('button', { name: '取消转发', exact: true }).click();
  await expectFill(share, false);
  await share.click();
  await page.locator('.briefing-recipients > button:enabled').first().click();
  await page.getByRole('button', { name: '模拟转发', exact: true }).click();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expectFill(share, true);
  await page.screenshot({ path: '.local/feedback/share-filled.png' });
  await page.reload();
  await open(page);
  await expectFill(share, true);
  await expect(share).toHaveAttribute('aria-description', '已转发，可再次转发');
});

test('整列统一悬浮文字方向：右侧优先，窗口缩窄或详情调宽时一起向左避让', async ({ page }) => {
  await open(page);
  const rail = detail(page).locator('.briefing-feedback-actions');
  const labels = ['有用', '没用', '关注', '转发'];
  const checkDirection = async (side: 'left' | 'right') => {
    await expect(rail).toHaveAttribute('data-label-side', side);
    for (const name of labels) {
      const button = rail.getByRole('button', { name, exact: true });
      await button.hover();
      const label = button.locator('.nav-label');
      await expect(label).toHaveCSS('opacity', '1');
      const box = (await button.boundingBox())!;
      const text = (await label.boundingBox())!;
      if (side === 'right') expect(text.x).toBeGreaterThan(box.x + box.width);
      else expect(text.x + text.width).toBeLessThan(box.x);
      expect(text.x).toBeGreaterThanOrEqual(0);
      expect(text.x + text.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
  };
  await checkDirection('right');
  await page.screenshot({ path: '.local/feedback/labels-right.png' });
  await page.setViewportSize({ width: 692, height: 757 });
  await checkDirection('left');
  const edge = detail(page).getByRole('separator', { name: '调整画报详情宽度（右侧）' });
  await edge.press('Home');
  await checkDirection('right');
  for (let i = 0; i < 4; i++) await edge.press('ArrowRight');
  await checkDirection('right');
  // A longer action receipt must also move the entire rail to the same side.
  await rail.getByRole('button', { name: '有用', exact: true }).click();
  await expect(rail).toHaveAttribute('data-label-side', 'left');
  const notice = rail.getByRole('status');
  await expect(notice).toHaveText('已记下，对你有帮助');
  await expect(notice).toHaveCSS('opacity', '1');
  const noticeBounds = (await notice.boundingBox())!;
  const usefulBounds = (await rail.getByRole('button', { name: '有用', exact: true }).boundingBox())!;
  expect(noticeBounds.x + noticeBounds.width).toBeLessThan(usefulBounds.x);
  await edge.press('End');
  await checkDirection('left');
  await page.setViewportSize({ width: 390, height: 844 });
  await checkDirection('left');
  await page.screenshot({ path: '.local/feedback/labels-left-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await checkDirection('right');
});
