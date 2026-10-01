import { test, expect, type Page } from '@playwright/test';

const key = 'enterprise-ai-demo-konggu-v1';
const id = 'konggu:C29';
const card = (page: Page) => page.locator(`.briefing-grid [data-card-id="${id}"]`);
const settled = (page: Page) =>
  expect
    .poll(() =>
      card(page).evaluate((el) => el.getAnimations().filter((a) => a.playState === 'running').length),
    )
    .toBe(0);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 977, height: 1000 });
  await page.goto('/#/briefing');
  await expect(page.locator('.briefing-grid .briefing-card')).toHaveCount(40);
  await page.evaluate(
    ({ key, id }) => {
      const s = JSON.parse(localStorage.getItem(key)!);
      for (const c of s.briefing.cards) c.pinned = c.id === id;
      localStorage.setItem(key, JSON.stringify(s));
    },
    { key, id },
  );
  await page.reload();
  await page.getByRole('tab', { name: '关注', exact: true }).click();
  await expect(page.getByRole('tab', { name: '关注', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.briefing-grid .briefing-card')).toHaveCount(1);
  await expect(card(page)).toBeVisible();
});

test('批注中的洞察卡能通过拖动连续切换全部四种规格，缩小不反弹，刷新仍保留', async ({ page }) => {
  const before = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).briefing.cards, key);
  for (const target of ['2×1', '2×2', '1×2', '1×1', '2×2', '1×1']) {
    await settled(page);
    await card(page).scrollIntoViewIfNeeded();
    await card(page).hover();
    const current = (await card(page).getAttribute('data-size'))!;
    const pitch = await page
      .locator('.briefing-page')
      .evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--briefing-unit')) + 10);
    const handle = (await card(page).locator('.briefing-resize-handle').boundingBox())!;
    const x = handle.x + handle.width - 7,
      y = handle.y + handle.height - 7;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(
      x + (Number(target[0]) - Number(current[0])) * pitch * 0.8,
      y + (Number(target[2]) - Number(current[2])) * pitch * 0.8,
      { steps: 8 },
    );
    await expect(page.locator('.briefing-resize-hint')).toHaveText(target);
    await page.mouse.up();
    await settled(page);
    await expect(card(page)).toHaveAttribute('data-size', target);
    expect(
      await page.evaluate(
        ({ key, id }) => {
          const s = JSON.parse(localStorage.getItem(key)!);
          return s.briefing.followLayouts[s.profile.name].sizes[id];
        },
        { key, id },
      ),
    ).toBe(target);
    expect(
      await card(page)
        .locator('h3')
        .evaluate(
          (el) =>
            el.scrollHeight <= el.clientHeight + 1 &&
            el.getBoundingClientRect().bottom <=
              el.closest('article')!.querySelector('.magazine-footer')!.getBoundingClientRect().top,
        ),
    ).toBe(true);
    await card(page).screenshot({
      path: `.local/resize-four/${test.info().project.name || 'chromium'}-${target}.png`,
    });
  }
  await page.reload();
  await page.getByRole('tab', { name: '关注', exact: true }).click();
  await expect(card(page)).toHaveAttribute('data-size', '1×1');
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).briefing.cards, key)).toEqual(
    before,
  );
});

test('自动加宽过的卡片仍能改成竖卡，旧的最小宽度不锁住手动尺寸', async ({ page }) => {
  await page.setViewportSize({ width: 540, height: 900 });
  // A modest custom title makes the automatic width requirement unambiguous
  // across font fallback; a tall card has ample room for the same full title.
  await page.evaluate(
    ({ key, id }) => {
      const s = JSON.parse(localStorage.getItem(key)!);
      s.briefing.cards.find((c: any) => c.id === id).config = {
        title: '一次活动留下什么，下次才能少问：需求、执行与复盘',
        size: '1×1',
        compact: false,
      };
      localStorage.setItem(key, JSON.stringify(s));
    },
    { key, id },
  );
  await page.reload();
  await page.getByRole('tab', { name: '关注', exact: true }).click();
  await expect(card(page)).toHaveAttribute('data-size', '2×1');
  const handle = card(page).locator('.briefing-resize-handle');
  await handle.focus();
  await page.keyboard.press('ArrowDown');
  await settled(page);
  await page.keyboard.press('ArrowLeft');
  await settled(page);
  await expect(card(page)).toHaveAttribute('data-size', '1×2');
  expect(
    await card(page)
      .locator('h3')
      .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
  ).toBe(true);
});

test('较窄的两列中，手动小卡收起次要摘要，仍保留完整标题', async ({ page }) => {
  await page.setViewportSize({ width: 540, height: 900 });
  await card(page).locator('.briefing-resize-handle').focus();
  await page.keyboard.press('ArrowDown');
  await settled(page);
  await page.keyboard.press('ArrowLeft');
  await settled(page);
  await page.keyboard.press('ArrowUp');
  await settled(page);
  await expect(card(page)).toHaveAttribute('data-size', '1×1');
  expect(
    await card(page)
      .locator('h3')
      .evaluate(
        (el) =>
          el.scrollHeight <= el.clientHeight + 1 &&
          el.getBoundingClientRect().bottom <
            el.closest('article')!.querySelector('.magazine-footer')!.getBoundingClientRect().top,
      ),
  ).toBe(true);
});

test('最右列仍可加宽为横卡，只向左让出所需列，不改变内容', async ({ page }) => {
  await card(page).locator('.briefing-card-main').focus();
  await page.keyboard.press('Alt+Enter');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await settled(page);
  expect(await card(page).evaluate((el) => (el as HTMLElement).style.gridColumnStart)).toBe('3');
  await card(page).locator('.briefing-resize-handle').focus();
  await page.keyboard.press('ArrowRight');
  await settled(page);
  await expect(card(page)).toHaveAttribute('data-size', '2×1');
  expect(await card(page).evaluate((el) => (el as HTMLElement).style.gridColumnStart)).toBe('2');
});

test('最右列的尺寸把手在窗口内即可拖大，缩回后仍可继续调节', async ({ page }) => {
  await card(page).locator('.briefing-card-main').focus();
  await page.keyboard.press('Alt+Enter');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await settled(page);
  await expect(card(page)).toHaveCSS('grid-column-start', '3');
  await expect(card(page)).toHaveAttribute('data-size', '1×1');
  await card(page).hover();
  const bounds = (await card(page).locator('.briefing-resize-handle').boundingBox())!;
  const x = bounds.x + bounds.width - 7,
    y = bounds.y + bounds.height - 7;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(Math.min(976, x + 34), y, { steps: 8 });
  await expect(page.locator('.briefing-resize-hint')).toHaveText('2×1');
  await page.mouse.up();
  await settled(page);
  await expect(card(page)).toHaveAttribute('data-size', '2×1');
  expect(await card(page).evaluate((el) => el.getBoundingClientRect().right <= innerWidth)).toBe(true);
  await card(page).locator('.briefing-resize-handle').focus();
  await page.keyboard.press('ArrowLeft');
  await settled(page);
  await expect(card(page)).toHaveAttribute('data-size', '1×1');
});
