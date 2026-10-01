/** Real app and HTTP on a caller-owned synthetic tenant. No cloud model or external delivery. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { expect, type Page, type APIRequestContext } from '@playwright/test';
export async function recommendationJourney(
  page: Page,
  request: APIRequestContext,
  tenant: string,
  conversation: string,
  task: string,
  artifacts: string,
) {
  const root = `/api/v1/tenants/${tenant}/recommendations`,
    pattern = '**' + root + '/settings';
  const capture: { armed: boolean; keys: string[]; status: number | null; receipt: any } = {
    armed: true,
    keys: [],
    status: null,
    receipt: null,
  };
  await page.route(pattern, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    capture.keys.push(route.request().postDataJSON().requestId);
    const response = await route.fetch();
    if (capture.armed) {
      capture.armed = false;
      capture.status = response.status();
      capture.receipt = await response.json();
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  try {
    await page.goto(`/workspace/#tenant=${tenant}&view=briefing`);
    await expect(page.getByRole('tab', { name: '推荐', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const section = page.getByRole('region', { name: '工作推荐', exact: true });
    await expect(section.locator('.recommendation-card')).toHaveCount(1);
    await expect(page.getByLabel('查看日期', { exact: true })).toHaveCount(0);
    const listed = await (await request.get(root)).json(),
      item = listed.items.find((i: any) => i.content.id === task);
    assert.ok(item);
    assert.equal(item.feedbackTarget.presentationVersion, 'recommendation-v1');
    await section.locator('.recommendation-card .live-briefing-body').click();
    const reader = page.locator('.live-reading-dialog');
    await expect(reader).toContainText('2000 分');
    await reader.getByRole('button', { name: '评价 / 建议', exact: true }).click();
    const feedback = reader.locator('.feedback-panel');
    await feedback.getByRole('button', { name: '评价 / 建议', exact: true }).click();
    await feedback.getByRole('button', { name: '有用', exact: true }).click();
    await expect(feedback.locator('.feedback-notice')).toContainText('评价已保存');
    const lookup = new URLSearchParams(
      Object.fromEntries(Object.entries(item.feedbackTarget).map(([k, v]) => [k, String(v)])),
    );
    const saved = await (await request.get(`/api/v1/tenants/${tenant}/feedback?` + lookup)).json();
    assert.deepEqual(saved.feedback.target, item.feedbackTarget);
    await reader.getByRole('button', { name: '关闭卡片详情', exact: true }).click();
    await section.locator('.recommendation-options > summary').click();
    await section.getByRole('button', { name: '关闭一般推荐', exact: true }).click();
    await expect(section.getByRole('alert')).toContainText('同一次请求');
    await expect(page.getByRole('tab', { name: '关注', exact: true })).toBeDisabled();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(section.getByRole('button', { name: '重试本次设置', exact: true })).toBeEnabled();
    await section.getByRole('button', { name: '重试本次设置', exact: true }).click();
    await expect(section).toContainText('一般推荐已关闭');
    assert.equal(capture.keys.length, 2);
    assert.equal(capture.keys[0], capture.keys[1]);
    assert.equal(capture.status, 200);
    await expect(page.getByRole('tab', { name: '关注', exact: true })).toBeEnabled();
    await expect(section.getByRole('button', { name: '开启一般推荐', exact: true })).toBeEnabled();
    await section.getByRole('button', { name: '开启一般推荐', exact: true }).click();
    await expect(section.locator('.recommendation-card')).toHaveCount(1);
    assert.equal((await (await request.get(root + '/settings')).json()).enabled, true);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.screenshot({ path: join(artifacts, 'recommendations-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    );
    await page.screenshot({ path: join(artifacts, 'recommendations-mobile.png'), fullPage: true });
    await section.locator('.recommendation-card .live-briefing-body').click();
    await expect(reader).toContainText('2000 分');
    await reader.getByRole('link', { name: '继续会话', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`conversation=${conversation}.*briefingTask=${task}`));
    await expect(page.locator('.conversation-reply')).toContainText('2000 分');
    await expect(page.getByLabel('工作要求', { exact: true })).toBeVisible();
    const current = await (await request.get(root)).json();
    assert.ok(current.items[0].content.openedAt);
    assert.equal(current.businessOutcome, 'NOT_ASSESSED');
    await page.setViewportSize({ width: 1440, height: 960 });
    return {
      settingsRetries: 'same-key',
      feedbackTarget: item.feedbackTarget,
      opened: current.items[0].content.openedAt,
      businessOutcome: current.businessOutcome,
    };
  } catch (e) {
    await page.screenshot({ path: join(artifacts, 'recommendations-failure.png'), fullPage: true });
    await writeFile(join(artifacts, 'recommendations-failure.txt'), await page.locator('body').innerText());
    throw e;
  } finally {
    await page.unroute(pattern);
  }
}
