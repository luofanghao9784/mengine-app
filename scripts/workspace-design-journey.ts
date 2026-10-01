import assert from 'node:assert/strict';
import { join } from 'node:path';
import { expect, type BrowserContext } from '@playwright/test';

/** UI entry paths on a caller-owned synthetic account; never sends a task. */
export async function workspaceDesignJourney(context: BrowserContext, tenant: string, artifacts: string) {
  const page = await context.newPage();
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/conversations(?:\/|$)/.test(new URL(request.url()).pathname))
      writes.push(request.url());
  });
  try {
    await page.goto(`/workspace/#tenant=${tenant}&view=briefing`);
    await expect(page.getByRole('tab', { name: '推荐', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByLabel('新的工作需求', { exact: true }).fill('合成草稿：整理本周已获授权的资料');
    await page.getByRole('link', { name: '会话', exact: true }).click();
    await expect(page.getByLabel(/^(工作要求|资料关键词)$/)).toHaveValue('合成草稿：整理本周已获授权的资料');
    await page.getByRole('link', { name: '智能画报', exact: true }).click();
    await page.reload();
    await expect(page.getByLabel('新的工作需求', { exact: true })).toHaveValue(
      '合成草稿：整理本周已获授权的资料',
    );
    await page.screenshot({ path: join(artifacts, 'workspace-briefing-empty-desktop.png') });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await expect(page.getByRole('tab', { name: '空间', exact: true })).toBeVisible();
      await expect(page.getByLabel('新的工作需求', { exact: true })).toBeVisible();
      await page.screenshot({ path: join(artifacts, `workspace-briefing-empty-${width}.png`) });
    }
    await page.getByRole('button', { name: '进入会话，继续编辑', exact: true }).click();
    await expect(page.getByLabel(/^(工作要求|资料关键词)$/)).toHaveValue('合成草稿：整理本周已获授权的资料');
    assert.deepEqual(writes, [], 'Entering or restoring a draft must not create a conversation or task');
  } finally {
    await page.close();
  }
}
