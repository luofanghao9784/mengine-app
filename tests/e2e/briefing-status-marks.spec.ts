import { test, expect, type Page } from '@playwright/test';

const card = (page: Page, id = 'C01') => page.locator(`.briefing-grid [data-card-id="konggu:${id}"]`);
const detail = (page: Page) =>
  page.locator('dialog').filter({ has: page.locator('.briefing-feedback-actions') });
const open = async (page: Page, id = 'C01') => {
  await card(page, id).locator('.briefing-card-main').click();
  await expect(detail(page)).toBeVisible();
};
const close = (page: Page) => page.getByRole('button', { name: '关闭卡片详情' }).click();

test('卡面同步反馈与关注：互斥、取消原因、刷新保留和撤销', async ({ page }) => {
  await page.goto('/#/briefing');
  await expect(card(page).getByRole('img', { name: '已标记有用' })).toHaveCount(0);
  await open(page);
  await detail(page).getByRole('button', { name: '有用', exact: true }).click();
  await detail(page).getByRole('button', { name: '关注', exact: true }).click();
  await close(page);
  await expect(card(page).getByRole('img', { name: '已标记有用' })).toBeVisible();
  await expect(card(page).getByRole('img', { name: '已关注' })).toBeVisible();
  await page.reload();
  await expect(card(page).getByRole('img', { name: '已标记有用' })).toBeVisible();
  await expect(card(page).getByRole('img', { name: '已关注' })).toBeVisible();

  await open(page);
  await detail(page).getByRole('button', { name: '没用', exact: true }).click();
  await page.getByRole('button', { name: '取消选择原因' }).click();
  await close(page);
  await expect(card(page).getByRole('img', { name: '已标记有用' })).toBeVisible();
  await expect(card(page).getByRole('img', { name: '已标记没用' })).toHaveCount(0);

  await open(page);
  await detail(page).getByRole('button', { name: '没用', exact: true }).click();
  await page.getByRole('button', { name: '分析或建议没帮助', exact: true }).click();
  await close(page);
  await expect(card(page).getByRole('img', { name: '已标记有用' })).toHaveCount(0);
  await expect(card(page).getByRole('img', { name: '已标记没用' })).toBeVisible();
  await page.reload();
  await expect(card(page).getByRole('img', { name: '已标记没用' })).toBeVisible();
  await open(page);
  await detail(page).getByRole('button', { name: '撤销', exact: true }).click();
  await detail(page).getByRole('button', { name: '关注', exact: true }).click();
  await close(page);
  await expect(card(page).locator('.briefing-status-mark')).toHaveCount(0);
});

test('情境标签移除而真实来源保留，图片卡的反馈、关注和会话角标不重叠', async ({ page, browserName }) => {
  await page.goto('/#/briefing');
  await expect(card(page).locator('.briefing-source')).toHaveCount(0);
  await expect(card(page, 'C30').locator('.briefing-source')).toContainText('贵州网');
  await expect(card(page, 'C30').locator('.briefing-source')).toContainText('发布于2026年9月14日');
  await expect(page.locator('.briefing-grid .briefing-source')).not.toContainText(['情境']);

  await open(page, 'C15');
  await detail(page).getByRole('button', { name: '有用', exact: true }).click();
  await detail(page).getByRole('button', { name: '关注', exact: true }).click();
  await detail(page).getByRole('button', { name: '发起会话', exact: true }).click();
  await expect(page.getByLabel('继续对话', { exact: true })).toBeVisible();
  await expect(page.locator('.conversation-overlay')).toHaveAttribute('data-phase', 'open');
  await page.getByRole('button', { name: '关闭会话', exact: true }).click();
  await expect(page.locator('.conversation-overlay')).toHaveCount(0);
  for (const label of ['已标记有用', '已关注', '已有会话'])
    await expect(card(page, 'C15').getByRole('img', { name: label })).toBeVisible();
  for (const width of [1440, 977, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await card(page, 'C15').scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        card(page, 'C15').evaluate((el) => {
          const bounds = el.getBoundingClientRect();
          const marks = el.querySelector('.briefing-card-marks')!.getBoundingClientRect();
          const icons = [...el.querySelectorAll('.briefing-card-marks > span')].map((icon) =>
            icon.getBoundingClientRect(),
          );
          const content = [...el.querySelectorAll('.magazine-copy, .briefing-source, .briefing-photo-credit')]
            .filter((node) => node.getBoundingClientRect().height > 0)
            .map((node) => node.getBoundingClientRect());
          return (
            marks.left >= bounds.left &&
            marks.right <= bounds.right &&
            marks.bottom <= bounds.bottom &&
            icons.every((icon, i) => i === 0 || icon.left >= icons[i - 1].right) &&
            content.every(
              (rect) => rect.bottom <= marks.top || rect.right <= marks.left || rect.left >= marks.right,
            )
          );
        }),
      )
      .toBe(true);
    if (width === 1440 || width === 390)
      await card(page, 'C15').screenshot({
        path: `.local/briefing-status/marks-${browserName}-${width}.png`,
      });
  }
});
