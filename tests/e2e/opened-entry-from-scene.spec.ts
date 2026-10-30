import { test, expect } from '@playwright/test';
import { fixture, tenant, openedItem } from './fixtures/ct036';

for (const width of [1440, 390]) {
  for (const items of [[], [openedItem]]) {
    test(`默认外壳进入已开通板块：${items.length ? '质量检查' : '空列表'}（${width}px）`, async ({
      page,
    }) => {
      const { requests, errors } = await fixture(page, 'member', { items });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tenant-admin/#tenant=${tenant}`);
      const shell = page.locator('.shell');
      const entry = shell
        .locator('nav.shell-switch')
        .getByRole('button', { name: '已开通的 AI 功能', exact: true });
      await entry.click();
      await expect(page).toHaveURL(new RegExp(`tenant=${tenant}&place=opened&admin=abilities$`));
      await expect(shell).toBeVisible();
      await expect(entry).toHaveAttribute('aria-current', 'page');
      const content = shell.getByRole('region', { name: '已开通的 AI 功能', exact: true });
      await expect(content.getByRole('heading', { name: '已开通', exact: true })).toBeVisible();
      if (items.length)
        await expect(content.getByRole('link', { name: '质量检查', exact: true })).toBeVisible();
      else
        await expect(
          content.getByRole('heading', { name: '还没有已开通的 AI 功能', exact: true }),
        ).toBeVisible();
      await expect(content.getByRole('heading', { name: '服务设置', exact: true })).toBeVisible();
      await page.screenshot({
        path: `test-results/opened-scene-${width}-${items.length}.png`,
        fullPage: true,
        animations: 'disabled',
      });
      await page.reload();
      await expect(content.getByRole('heading', { name: '已开通', exact: true })).toBeVisible();
      await expect(page).toHaveURL(/place=opened/);
      // The existing tenant console and its permission checks remain inside the shell.
      await expect(page.locator('.admin-sidebar')).toHaveCount(0);
      expect(requests.every((r) => r.method === 'GET' && !r.path.includes('/agent-admin/'))).toBe(true);
      expect(errors).toEqual([]);
    });
  }
}

test('搜索和概览卡片都能进入已开通板块，离开清理旧版页参数', async ({ page }) => {
  await fixture(page, 'member', { items: [] });
  await page.goto(`/tenant-admin/#tenant=${tenant}&place=home`);
  await page
    .locator('.cards.home')
    .getByRole('button', { name: /已开通的 AI 功能/ })
    .click();
  await expect(page).toHaveURL(/place=opened&admin=abilities/);
  await page.locator('nav.shell-switch').getByRole('button', { name: '企业信息', exact: true }).click();
  await expect(page).toHaveURL(/place=company$/);
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByRole('dialog', { name: '搜索' }).getByRole('textbox').fill('已开通');
  await page
    .getByRole('dialog', { name: '搜索' })
    .getByRole('button', { name: /已开通的 AI 功能/ })
    .click();
  await expect(page.getByRole('heading', { name: '还没有已开通的 AI 功能', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/place=opened/);
});
