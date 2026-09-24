import { test, expect, type Page } from '@playwright/test';

const rail = (page: Page) => page.locator('.deck-scroller');
const card = (page: Page, id: string) => page.locator(`.deck-scroller [data-deck-id="${id}"]`);
async function openCards(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 852 });
  await page.goto('/#/briefing');
  await page.locator('[data-card-id="konggu:C09"] .briefing-card-main').click();
  await page.locator('.briefing-detail').getByRole('button', { name: '发起会话', exact: true }).click();
  await expect(page.locator('.conversation-overlay')).toHaveAttribute('data-phase', 'open');
  await expect(page.locator('.deck-file')).toHaveCount(2);
}
async function geometry(page: Page, id: string) {
  return card(page, id).evaluate((node) => {
    const deck = node.closest('.deck-scroller')!;
    const cards = Array.from(deck.querySelectorAll<HTMLElement>('[data-deck-id]'));
    const box = node.getBoundingClientRect();
    const viewport = deck.getBoundingClientRect();
    const next = cards[cards.indexOf(node as HTMLElement) + 1]?.getBoundingClientRect();
    const left = Math.max(box.left, viewport.left);
    const right = Math.min(box.right, viewport.right, next?.left ?? Infinity);
    return {
      x: left + (right - left) / 2,
      y: box.y + box.height / 2,
      top: box.y,
      visible: right - left,
      width: box.width,
      full:
        box.left >= viewport.left - 1 &&
        box.right <= viewport.right + 1 &&
        (!next || next.left >= box.right - 1),
      order: cards.map((card) => card.dataset.deckId),
      scroll: deck.scrollLeft,
    };
  });
}
async function expectFull(page: Page, id: string) {
  await expect.poll(async () => (await geometry(page, id)).full).toBe(true);
  await expect(card(page, id)).not.toHaveAttribute('data-needs-reveal');
  await expect(card(page, id).locator('.deck-card-content')).not.toHaveAttribute('inert');
}

test('点击视窗边缘局部卡片完整展现，第一次不误触版本按钮，草稿及顺序保留', async ({ page }) => {
  await openCards(page);
  const file = await page.locator('.deck-file').first().getAttribute('data-deck-id');
  const id = file!;
  await page.getByLabel('继续对话', { exact: true }).fill('保持这段草稿');
  const before = await geometry(page, id);
  await expect(card(page, id)).toHaveAttribute('data-clipped', 'true');
  expect(before.visible).toBeGreaterThan(30);
  await page.mouse.click(before.x, before.y);
  await expectFull(page, id);
  const revealed = await geometry(page, id);
  expect(revealed.width).toBe(before.width);
  expect(revealed.order).toEqual(before.order);
  expect(revealed.scroll).toBeGreaterThan(before.scroll);
  await expect(page.getByLabel('继续对话', { exact: true })).toHaveValue('保持这段草稿');

  // Leave only 30px clipped, so a real version button is visible. Its first tap
  // reveals the card; a second tap performs the normal action.
  await rail(page).evaluate((node) => node.scrollBy({ left: -30, behavior: 'instant' }));
  await expect(card(page, id)).toHaveAttribute('data-clipped', 'true');
  const versions = card(page, id).getByRole('button', { name: '版本记录', exact: true });
  const button = (await versions.boundingBox())!;
  expect(button.x + button.width).toBeLessThan(1440);
  await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
  await expectFull(page, id);
  await expect(versions).toHaveAttribute('aria-expanded', 'false');
  await versions.click();
  await expect(versions).toHaveAttribute('aria-expanded', 'true');
  await rail(page).evaluate((node) => node.scrollTo({ left: 0, behavior: 'instant' }));
  await expect(card(page, id)).toHaveAttribute('data-clipped', 'true');
  const headerTap = await geometry(page, id);
  await page.mouse.click(headerTap.x, headerTap.top + 30);
  await expectFull(page, id);
  await expect(versions).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.deck-file')).toHaveCount(2);
  await page.screenshot({ path: '.local/conversation-deck/revealed-file.png' });
});

test('部分被遮挡的正文区域、完全折叠的顶部和列表露出的任意位置都能展开', async ({ page }) => {
  await openCards(page);
  await rail(page).evaluate((node) => node.scrollTo({ left: 400, behavior: 'instant' }));
  const source = card(page, 'source');
  await expect(source.locator('.deck-card-content')).toHaveAttribute('inert');
  await expect(source).not.toHaveAttribute('data-folded');
  const partial = await geometry(page, 'source');
  expect(partial.visible).toBeGreaterThan(80);
  await page.mouse.click(partial.x, partial.y);
  await expectFull(page, 'source');
  expect((await geometry(page, 'source')).order).toEqual(partial.order);

  await rail(page).evaluate((node) => node.scrollTo({ left: node.scrollWidth, behavior: 'instant' }));
  await expect(source).toHaveAttribute('data-folded', 'true');
  const folded = await geometry(page, 'source');
  // The old expand button starts 20px below the top; this spot is outside it.
  await page.mouse.click(folded.x, folded.top + 12);
  await expectFull(page, 'source');

  await rail(page).evaluate((node) => node.scrollTo({ left: 70, behavior: 'instant' }));
  await expect(card(page, 'list').locator('.deck-card-content')).toHaveAttribute('inert');
  const list = await geometry(page, 'list');
  await page.mouse.click(list.x, list.y);
  await expectFull(page, 'list');
  expect((await geometry(page, 'list')).scroll).toBe(0);
  await expect(page.locator('.conversation-overlay')).toBeVisible();
});

test('宽会话被视窗裁切时点击标题也能完整显示，键盘可再次展开列表', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1100, height: 852 });
  await page.goto('/#/home');
  await page.getByRole('separator', { name: '调整当前会话宽度', exact: true }).press('End');
  await expect(card(page, 'conversation')).toHaveAttribute('data-clipped', 'true');
  const before = await geometry(page, 'conversation');
  await page.mouse.click(before.x, before.top + 32);
  await expectFull(page, 'conversation');
  const after = await geometry(page, 'conversation');
  expect(after.scroll).toBeGreaterThan(200);
  expect(after.width).toBe(before.width);
  await expect(page.locator('.draft-composer textarea')).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: '展开会话列表', exact: true }).press('Enter');
  await expectFull(page, 'list');
  await expect(page.locator('.conversation-overlay')).toBeVisible();
});

test('触摸局部卡片时平滑展现，移动或取消手势不会被当成点击', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true });
  const page = await context.newPage();
  await openCards(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const client = await context.newCDPSession(page);
  const id = (await page.locator('.deck-file').first().getAttribute('data-deck-id'))!;
  const partial = await geometry(page, id);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: partial.x, y: partial.y }],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  expect((await geometry(page, id)).scroll).toBe(partial.scroll);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: partial.x, y: partial.y }],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const frames = await rail(page).evaluate(async (node) => {
    const values: number[] = [];
    for (let i = 0; i < 12; i++) {
      await new Promise(requestAnimationFrame);
      values.push(node.scrollLeft);
    }
    return values;
  });
  expect(new Set(frames).size).toBeGreaterThan(2);
  await expectFull(page, id);
  expect((await geometry(page, id)).order).toEqual(partial.order);
  await page.screenshot({ path: '.local/conversation-deck/revealed-touch.png' });

  await rail(page).evaluate((node) => node.scrollTo({ left: 0, behavior: 'instant' }));
  await expect(card(page, id)).toHaveAttribute('data-clipped', 'true');
  const again = await geometry(page, id);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: again.x, y: again.y }],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: again.x, y: again.y - 100 }],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect((await geometry(page, id)).scroll).toBe(0);
  await expect(card(page, id)).toHaveAttribute('data-clipped', 'true');
  await context.close();
});
