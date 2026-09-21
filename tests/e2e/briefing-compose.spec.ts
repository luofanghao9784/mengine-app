import { test, expect } from '@playwright/test';

test('底部输入框平滑收成无文字圆形加号，反向滚动与点击连续恢复', async ({ page }) => {
  await page.goto('/#/briefing');
  const dock = page.locator('.briefing-compose-dock');
  const initial = (await dock.boundingBox())!;
  const sample = await page.evaluate(async () => {
    const scroll = document.querySelector('.page-main')!;
    const dock = document.querySelector('.briefing-compose-dock')!;
    scroll.scrollTop = 650;
    for (let n = 0; n < 7; n++) await new Promise(requestAnimationFrame);
    return {
      width: dock.getBoundingClientRect().width,
      running: dock.getAnimations().some((a) => a.playState === 'running'),
    };
  });
  expect(sample.width).toBeGreaterThan(48);
  expect(sample.width).toBeLessThan(initial.width);
  expect(sample.running).toBe(true);
  // Reverse before the closing transition finishes; CSS continues from the current width.
  await page.locator('.page-main').evaluate((el) => {
    el.scrollTop = 300;
  });
  await expect(dock).not.toHaveClass(/is-collapsed/);
  await expect.poll(async () => (await dock.boundingBox())!.width).toBe(initial.width);
  await page.locator('.page-main').evaluate((el) => {
    el.scrollTop = 750;
  });
  const trigger = dock.getByRole('button', { name: '新建会话', exact: true });
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveText('');
  await expect
    .poll(async () => {
      const b = (await dock.boundingBox())!;
      return [b.width, b.height];
    })
    .toEqual([48, 48]);
  await expect(dock.locator('.draft-composer-content')).toHaveAttribute('inert', '');
  await trigger.click();
  const input = page.getByLabel('描述你的工作需求');
  await expect(input).toBeFocused();
  await expect.poll(async () => (await dock.boundingBox())!.width).toBe(initial.width);
  await input.fill('保留当前输入');
  await expect(page).toHaveURL(/#\/home$/);
  await expect(input).toBeFocused();
  await page.getByRole('button', { name: '关闭会话', exact: true }).click();
  await page.getByRole('heading', { name: '智能画报', exact: true }).click();
  await page.locator('.page-main').evaluate((el) => {
    el.scrollTop += 500;
  });
  await expect(dock).not.toHaveClass(/is-collapsed/);
  await expect(input).toHaveValue('保留当前输入');
});

test('窄屏圆形入口可键盘恢复，减少动态效果时不执行伸缩动画', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/briefing');
  const dock = page.locator('.briefing-compose-dock');
  await page.locator('.page-main').evaluate((el) => {
    el.scrollTop = 800;
  });
  await expect(dock).toHaveClass(/is-collapsed/);
  const trigger = dock.getByRole('button', { name: '新建会话', exact: true });
  await expect(trigger).toBeInViewport();
  const b = (await dock.boundingBox())!;
  expect([b.width, b.height]).toEqual([48, 48]);
  expect(await dock.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  await trigger.focus();
  await trigger.press('Enter');
  await expect(page.getByLabel('描述你的工作需求')).toBeFocused();
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeInViewport();
  expect(await dock.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
