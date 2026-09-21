import { test, expect, type Page } from '@playwright/test';

// Position the next card by its visible geometry, independent of scroll anchors.
async function cover(page: Page, id: string, ratio: number) {
  await page.locator('.deck-scroller').evaluate(
    async (element, { id, ratio }) => {
      const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const card = element.querySelector<HTMLElement>(`[data-deck-id="${id}"]`)!;
      const next = card.nextElementSibling!;
      element.scrollTo({ left: 0, behavior: 'instant' });
      await frame();
      const nextLeft = next.getBoundingClientRect().left;
      const width = card.getBoundingClientRect().width;
      const spine = Number.parseFloat(card.style.getPropertyValue('--spine-width'));
      element.scrollTo({ left: element.scrollWidth, behavior: 'instant' });
      await frame();
      const parkedLeft = card.getBoundingClientRect().left;
      element.scrollTo({
        left: nextLeft - parkedLeft - width + ratio * (width - spine),
        behavior: 'instant',
      });
      await frame();
      await frame();
    },
    { id, ratio },
  );
  return page.locator(`[data-deck-id="${id}"]`).evaluate((card) => {
    const content = card.querySelector('.deck-card-content')!;
    const style = getComputedStyle(content);
    return {
      opacity: Number(style.opacity),
      blur: Number(style.filter.match(/blur\(([\d.]+)px\)/)?.[1] || 0),
      background: getComputedStyle(card).backgroundColor,
      visibility: style.visibility,
    };
  });
}

test('列表、来源和文件在覆盖后半程逐渐模糊淡出，逆向与移除覆盖恢复清晰', async ({ page }) => {
  await page.setViewportSize({ width: 1418, height: 852 });
  await page.goto('/#/briefing');
  await page.locator('[data-card-id="deliverable:proposal"] .briefing-card-main').click();
  await expect(page.locator('.conversation-overlay')).toHaveAttribute('data-phase', 'open');
  const proposal = page.locator('[data-deck-id="proposal"]');
  await proposal.getByRole('button', { name: /服务价格表/ }).click();
  await expect(page.locator('[data-deck-id="price"]')).toBeInViewport();
  const saved = await page.evaluate(() => localStorage.getItem('enterprise-ai-demo-v1'));

  for (const id of ['list', 'source', 'proposal']) {
    const first = await cover(page, id, 0.35);
    expect(first.opacity).toBe(1);
    expect(first.blur).toBe(0);
    const half = await cover(page, id, 0.5);
    expect(half.opacity).toBeGreaterThan(0.99);
    expect(half.blur).toBeLessThan(0.01);
    const middle = await cover(page, id, 0.75);
    expect(middle.opacity).toBeGreaterThan(0.2);
    expect(middle.opacity).toBeLessThan(0.8);
    expect(middle.blur).toBeGreaterThan(1);
    const later = await cover(page, id, 0.9);
    expect(later.opacity).toBeLessThan(middle.opacity);
    expect(later.blur).toBeGreaterThan(middle.blur);
    const end = await cover(page, id, 1);
    expect(end.opacity).toBeLessThan(0.01);
    expect(end.blur).toBeGreaterThan(later.blur);
    expect(end.visibility).toBe('visible');
    expect(end.background).toBe(first.background);
    const reverse = await cover(page, id, 0.75);
    expect(reverse.opacity).toBeCloseTo(middle.opacity, 2);
    expect(reverse.blur).toBeCloseTo(middle.blur, 2);
    const restored = await cover(page, id, 0);
    expect(restored.opacity).toBe(1);
    expect(restored.blur).toBe(0);
    await expect(page.locator(`[data-deck-id="${id}"] .deck-card-content`)).not.toHaveAttribute('inert', '');
  }

  await cover(page, 'proposal', 1);
  await page.locator('[data-deck-id="price"]').getByRole('button', { name: '关闭成果预览' }).click();
  await expect(proposal.locator('.deck-card-content')).toHaveCSS('opacity', '1');
  await expect(proposal.locator('.deck-card-content')).toHaveCSS('filter', 'none');
  await expect(proposal).not.toHaveAttribute('data-folded', 'true');
  await cover(page, 'source', 0.9);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('会话卡片切换').getByRole('button', { name: '画报卡片', exact: true }).click();
  await expect(page.locator('.deck-source .deck-card-content')).toHaveCSS('opacity', '1');
  await expect(page.locator('.deck-source .deck-card-content')).toHaveCSS('filter', 'none');
  expect(await page.evaluate(() => localStorage.getItem('enterprise-ai-demo-v1'))).toBe(saved);
});
