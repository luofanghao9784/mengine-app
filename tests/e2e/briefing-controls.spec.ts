import { test, expect } from '@playwright/test';

for (const width of [1418, 390]) {
  test(`${width}px 鼠标界面仅悬浮显示操作，固定后移出收起，头像同步让位`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/#/briefing');
    await page.mouse.move(0, 0);
    const allTools = page.locator('.briefing-grid .briefing-card-tools');
    await expect(allTools.first()).toHaveCSS('opacity', '0');
    expect(
      await allTools.evaluateAll((els) =>
        els.every((el) => {
          const style = getComputedStyle(el);
          return style.opacity === '0' && style.pointerEvents === 'none';
        }),
      ),
    ).toBe(true);
    const project = page.locator('.briefing-grid [data-card-id="project:project-delivery"]');
    const tools = project.locator('.briefing-card-tools');
    await project.scrollIntoViewIfNeeded();
    const people = project.locator('.briefing-people-trigger');
    const resting = (await people.boundingBox())!;
    await page.screenshot({ path: `.local/briefing-controls/rest-${width}.png` });
    await project.hover();
    await expect(tools).toHaveCSS('opacity', '1');
    await expect(tools).toHaveCSS('pointer-events', 'auto');
    await expect
      .poll(async () => {
        const p = (await people.boundingBox())!;
        return (await tools.boundingBox())!.x - p.x - p.width;
      })
      .toBeGreaterThanOrEqual(6);
    expect((await people.boundingBox())!.x).toBeLessThan(resting.x - 20);
    await page.screenshot({ path: `.local/briefing-controls/hover-${width}.png` });
    await tools.getByRole('button', { name: /^固定到关注 / }).click();
    await page.mouse.move(0, 0);
    await expect(tools).toHaveCSS('opacity', '0');
    await expect(tools).toHaveCSS('pointer-events', 'none');
    await expect.poll(async () => Math.abs((await people.boundingBox())!.x - resting.x)).toBeLessThan(1);
    await project.hover();
    await expect(tools.getByRole('button', { name: /^取消关注 / })).toBeVisible();
    await project.getByRole('button', { name: /^卡片操作 / }).click();
    await page.mouse.move(0, 0);
    await expect(tools).toHaveCSS('opacity', '1');
    await expect(project.locator('.briefing-card-menu')).toBeVisible();
  });
}

test('键盘焦点显示操作入口，移出卡片后收起', async ({ page }) => {
  await page.goto('/#/briefing');
  const c = page.locator('.briefing-grid [data-card-id="dream"]');
  await c.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await page.keyboard.press('Tab');
  await c.locator('.briefing-card-main').focus();
  await expect(c.locator('.briefing-card-tools')).toHaveCSS('opacity', '1');
  await c.getByRole('button', { name: /^卡片操作 / }).focus();
  await page.keyboard.press('Enter');
  await expect(c.locator('.briefing-card-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(c.locator('.briefing-card-tools')).toHaveCSS('opacity', '1');
  await page.getByRole('tab', { name: '最新', exact: true }).focus();
  await expect(c.locator('.briefing-card-tools')).toHaveCSS('opacity', '0');
});
