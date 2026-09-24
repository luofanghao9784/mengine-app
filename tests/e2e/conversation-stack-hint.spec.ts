import { test, expect, type Page } from '@playwright/test';

const rail = (page: Page) => page.locator('.deck-scroller');
async function openCards(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1546, height: 1253 });
  await page.goto('/#/chat/kg-review');
  await expect(page.locator('.conversation-overlay')).toHaveAttribute('data-phase', 'open');
}
async function foldCards(page: Page) {
  await rail(page).evaluate((node) => node.scrollTo({ left: node.scrollWidth, behavior: 'instant' }));
  await expect(page.locator('.deck-file').first()).toHaveAttribute('data-folded', 'true');
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

test('阴影留白与紧凑间隙兼容，折叠卡片整面浅蓝色高亮，标题位于卡片外部上方', async ({ page }) => {
  await openCards(page);
  const initial = await rail(page).evaluate((node) => {
    const box = node.getBoundingClientRect();
    const cards = Array.from(node.querySelectorAll<HTMLElement>('[data-deck-id]'));
    const bounds = cards.map((card) => card.getBoundingClientRect());
    return {
      left: bounds[0].left - box.left,
      top: bounds[0].top - box.top,
      gaps: bounds.slice(1).map((card, index) => card.left - bounds[index].right),
      shadows: cards.map((card) => getComputedStyle(card).boxShadow),
    };
  });
  expect(initial.left).toBeGreaterThanOrEqual(14);
  expect(initial.top).toBeGreaterThanOrEqual(14);
  expect(initial.gaps.every((gap) => Math.abs(gap - 8) < 1)).toBe(true);
  expect(new Set(initial.shadows).size).toBe(1);
  await page.screenshot({ path: '.local/conversation-deck/shadow-soft-page.png' });
  await foldCards(page);
  const files = page.locator('.deck-file');
  const first = files.first();
  const firstBox = (await first.boundingBox())!;
  const before = await first.evaluate((node) => ({
    z: getComputedStyle(node).zIndex,
    scroll: node.parentElement!.scrollLeft,
  }));
  await page.mouse.move(firstBox.x + 6, firstBox.y + firstBox.height / 2);
  await expect(page.getByRole('tooltip')).toHaveText('空谷本周经营复盘 · 个人草稿');
  await expect(first).toHaveAttribute('data-stack-highlight', '');
  const highlighted = await first.evaluate((node) => ({
    surface: getComputedStyle(node, '::before').opacity,
    fill: getComputedStyle(node, '::before').backgroundColor,
    shadow: getComputedStyle(node, '::before').boxShadow,
    inset: getComputedStyle(node, '::before').inset,
    radius: getComputedStyle(node, '::before').borderRadius,
    tabBackground: getComputedStyle(node.querySelector('.deck-fold-tab')!).backgroundColor,
    tabOutline: getComputedStyle(node.querySelector('.deck-fold-tab')!).outlineStyle,
    z: getComputedStyle(node).zIndex,
    scroll: node.parentElement!.scrollLeft,
  }));
  expect(highlighted.surface).toBe('0.12');
  expect(highlighted.fill).toBe('rgb(23, 105, 224)');
  expect(highlighted.shadow).toBe('none');
  expect(highlighted.inset).toBe('-1px');
  expect(parseFloat(highlighted.radius)).toBeGreaterThan(10);
  expect(highlighted.tabBackground).toBe('rgba(0, 0, 0, 0)');
  expect(highlighted.tabOutline).toBe('none');
  expect(highlighted.z).toBe(before.z);
  expect(highlighted.scroll).toBe(before.scroll);
  expect(await first.boundingBox()).toEqual(firstBox);
  const hintBox = (await page.getByRole('tooltip').boundingBox())!;
  expect(hintBox.y).toBeGreaterThanOrEqual(8);
  expect(hintBox.y + hintBox.height).toBeCloseTo(firstBox.y - 8, 0);
  await page.screenshot({ path: '.local/conversation-deck/stack-title-hover.png' });

  const second = files.nth(1);
  const secondBox = (await second.boundingBox())!;
  await page.mouse.move(secondBox.x + 6, secondBox.y + 200);
  await expect(page.getByRole('tooltip')).toHaveText('9月零售日销售摘要');
  await expect(first).not.toHaveAttribute('data-stack-highlight');
  await expect(second).toHaveAttribute('data-stack-highlight', '');
  await page.mouse.click(secondBox.x + 6, secondBox.y + 200);
  await expect(second).not.toHaveAttribute('data-needs-reveal');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(page.locator('[data-stack-highlight]')).toHaveCount(0);
});

test('叠放标题支持键盘和长文本，移开、滚动及切换手机布局时清理', async ({ page }) => {
  await openCards(page);
  const title =
    '会员购买与三十天复购的统计口径、资料来源和观察窗口 · ' + 'MembershipRetentionEvidence'.repeat(3);
  await page.evaluate((title) => {
    const key = 'enterprise-ai-demo-konggu-v1';
    const state = JSON.parse(localStorage.getItem(key)!);
    state.materials.find((file: { id: string }) => file.id === 'kg-personal-review').title = title;
    localStorage.setItem(key, JSON.stringify(state));
  }, title);
  await page.reload();
  await expect(page.locator('.conversation-overlay')).toHaveAttribute('data-phase', 'open');
  await foldCards(page);
  const first = page.locator('.deck-file').first();
  const box = (await first.boundingBox())!;
  await page.keyboard.press('Tab');
  await first.locator('.deck-fold-tab').focus();
  await expect(page.getByRole('tooltip')).toHaveText(title);
  await expect(first).toHaveAttribute('data-stack-highlight', '');
  const hintBox = (await page.getByRole('tooltip').boundingBox())!;
  expect(hintBox.x).toBeGreaterThanOrEqual(16);
  expect(hintBox.x + hintBox.width).toBeLessThanOrEqual(1546 - 16);
  expect(hintBox.y).toBeGreaterThanOrEqual(8);
  expect(hintBox.y + hintBox.height).toBeCloseTo(box.y - 8, 0);
  await first.locator('.deck-fold-tab').press('Enter');
  await expect(first).not.toHaveAttribute('data-needs-reveal');
  await expect(page.getByRole('tooltip')).toHaveCount(0);

  await foldCards(page);
  await page.mouse.move(box.x + 6, box.y + 200);
  await expect(page.getByRole('tooltip')).toHaveText(title);
  await page.mouse.move(1000, 35);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.mouse.move(box.x + 6, box.y + 200);
  await expect(page.getByRole('tooltip')).toBeVisible();
  await rail(page).evaluate((node) => node.scrollBy({ left: -20, behavior: 'instant' }));
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await foldCards(page);
  await page.mouse.move(box.x + 6, box.y + 210);
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(page.locator('[data-stack-highlight]')).toHaveCount(0);
  await expect(first).toBeInViewport({ ratio: 1 });
  await page.locator('.deck-mobile-tabs').getByRole('button', { name: '对话', exact: true }).click();
  await expect(page.getByLabel('继续对话', { exact: true })).toBeInViewport({ ratio: 1 });
});
