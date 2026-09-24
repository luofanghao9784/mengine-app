import assert from 'node:assert/strict';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

export async function briefingJourney(
  page: Page,
  user: APIRequestContext,
  platform: APIRequestContext,
  tenant: string,
  conversation: string,
  screenshot: (page: Page, name: string) => Promise<void>,
) {
  const root = `/api/v1/tenants/${tenant}/briefing`;
  const route = `/workspace/#tenant=${tenant}&view=briefing`;
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(route);
  const cards = page.locator('.live-briefing-card');
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('已提取第 2—3 行');
  await expect(cards).toContainText('未调用真实模型');
  await expect(cards).not.toContainText('当前处理工具不支持');
  const response = await user.get(root);
  assert.equal(response.status(), 200);
  assert.match(response.headers()['cache-control'], /no-store/);
  const card = (await response.json()).items[0];
  assert.equal(card.conversationId, conversation);
  assert.equal(card.preference.revision, 0);
  assert.equal((await platform.get(root)).status(), 403);
  const invalidDate = await user.get(root + '?date=2026-02-30');
  assert.equal(invalidDate.status(), 400);
  assert.equal((await invalidDate.json()).code, 'INVALID_REQUEST');
  assert.equal(
    (
      await user.post(root + '/' + conversation, {
        data: { requestId: randomUUID(), expectedRevision: 0, pinned: true, hidden: false, size: 'WIDE' },
      })
    ).status(),
    403,
  );
  await cards.hover();
  await cards.getByRole('button', { name: '关注', exact: true }).click();
  await page.getByLabel('画报视图', { exact: true }).selectOption('FOCUSED');
  await expect(cards).toHaveCount(1);
  await cards.hover();
  await cards.getByRole('button', { name: '加宽卡片', exact: true }).click();
  await expect(cards).toHaveClass(/wide/);
  await page.reload();
  await expect(cards).toHaveClass(/wide/);
  const csrf = await (await user.get('/api/v1/auth/csrf')).json();
  const write = {
    requestId: randomUUID(),
    expectedRevision: 0,
    pinned: false,
    hidden: false,
    size: 'STANDARD',
  };
  const stale = await user.post(root + '/' + conversation, {
    data: write,
    headers: { [csrf.headerName]: csrf.token },
  });
  assert.equal(stale.status(), 409);
  assert.equal((await stale.json()).code, 'BRIEFING_REVISION_CONFLICT');
  const injectedOwner = await user.post(root + '/' + conversation, {
    data: { ...write, ownerId: randomUUID() },
    headers: { [csrf.headerName]: csrf.token },
  });
  assert.equal(injectedOwner.status(), 400);
  await expect(cards.getByRole('button', { name: '取消关注', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await cards.hover();
  await cards.getByRole('button', { name: '隐藏', exact: true }).click();
  await expect(cards).toHaveCount(0);
  await page.getByLabel('画报视图', { exact: true }).selectOption('HIDDEN');
  await expect(cards).toHaveCount(1);
  await cards.hover();
  await cards.getByRole('button', { name: '恢复显示', exact: true }).click();
  await expect(cards).toHaveCount(0);
  await page.getByLabel('画报视图', { exact: true }).selectOption('LATEST');
  await expect(cards).toHaveCount(1);
  const date = await page.evaluate((instant) => {
    const d = new Date(instant);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, card.completedAt);
  await page.getByLabel('查看日期', { exact: true }).fill(date);
  await expect(cards.locator('a')).toHaveAttribute('href', new RegExp('&task=' + card.taskId + '$'));
  await cards.locator('a').click();
  await expect(page.locator('.conversation-turn')).toHaveCount(1);
  await expect(page.locator('.conversation-reply')).toContainText('已提取第 2—3 行');
  await expect(page.getByLabel('工作要求', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.conversation-turn')).toHaveCount(1);
  await page.getByRole('button', { name: '返回最新对话并继续', exact: true }).click();
  await expect(page.getByLabel('工作要求', { exact: true })).toBeVisible();
  await expect(page.locator('.conversation-turn').last()).toContainText('当前处理工具不支持');
  await page.goto(route);
  await expect(cards).toHaveCount(1);
  await screenshot(page, 'briefing-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(cards).toBeVisible();
  await screenshot(page, 'briefing-mobile.png');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
}
