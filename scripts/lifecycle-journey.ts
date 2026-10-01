/** Actual browser/API lifecycle on the disposable three-surface fixture. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect, type Page, type APIRequestContext } from '@playwright/test';
export async function lifecycleJourney(
  page: Page,
  request: APIRequestContext,
  tenant: string,
  workspace: string,
  artifacts: string,
) {
  const root = `/api/v1/tenants/${tenant}/workspaces/${workspace}`;
  const csrf = await (await request.get('/api/v1/auth/csrf')).json();
  const upload = await request.post(root + '/materials', {
    headers: { [csrf.headerName]: csrf.token },
    multipart: {
      metadata: {
        name: 'metadata.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ requestId: randomUUID() })),
      },
      file: {
        name: '生命周期合成资料.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('可回收及明确清理的合成文件'),
      },
    },
  });
  assert.equal(upload.status(), 201);
  const original = await upload.json();
  const download = root + `/materials/${original.id}/versions/${original.acceptedVersion.id}/download`;
  const state = async () => {
    const r = await request.get(root + `/lifecycle/MATERIAL/${original.id}`);
    assert.equal(r.status(), 200);
    return await r.json();
  };
  await page.goto(`/workspace/#tenant=${tenant}&view=library&scope=personal`);
  await page.getByRole('button', { name: '资料操作', exact: true }).click();
  await page.getByRole('button', { name: '维护与回收站', exact: true }).click();
  await page.getByRole('button', { name: '管理 生命周期合成资料.txt', exact: true }).click();
  await expect(page.locator('.lifecycle-object')).toContainText('正常使用');
  await page.getByRole('button', { name: '移入回收站', exact: true }).click();
  await page.getByRole('button', { name: '确认移入回收站', exact: true }).click();
  await expect(page.locator('.lifecycle-object')).toContainText('回收期内');
  assert.equal((await request.get(download)).status(), 404);
  const trashed = await state();
  assert.equal(trashed.item.revision, 1);
  await page.screenshot({ path: join(artifacts, 'lifecycle-recycle-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: '恢复资料', exact: true }).click();
  await page.getByRole('button', { name: '确认恢复资料', exact: true }).click();
  await expect(page.locator('.lifecycle-object')).toContainText('正常使用');
  assert.equal((await request.get(download)).status(), 200);
  await page.getByRole('button', { name: '移入回收站', exact: true }).click();
  await page.getByRole('button', { name: '确认移入回收站', exact: true }).click();
  await expect(page.locator('.lifecycle-object')).toContainText('回收期内');
  await page.getByRole('button', { name: '提前彻底清理', exact: true }).click();
  await expect(page.locator('.lifecycle-confirm')).toContainText('不能恢复');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(artifacts, 'lifecycle-purge-mobile.png'), fullPage: true });
  assert.ok(await page.getByRole('dialog').evaluate((e) => e.scrollWidth <= e.clientWidth));
  await page.getByRole('button', { name: '确认提前彻底清理', exact: true }).click();
  await expect(page.locator('.lifecycle-cleanup')).toBeVisible();
  const purging = await state();
  assert.ok(purging.item.cleanupJobId);
  assert.equal((await request.get(download)).status(), 404);
  await expect
    .poll(
      async () => {
        const r = await request.get(root + `/lifecycle/cleanup/${purging.item.cleanupJobId}`);
        assert.equal(r.status(), 200);
        return (await r.json()).state;
      },
      { timeout: 45000, intervals: [1000] },
    )
    .toBe('COMPLETE');
  await page.getByRole('button', { name: '刷新清理状态', exact: true }).click();
  await expect(page.locator('.lifecycle-object')).toContainText('在线内容已清理');
  await expect(page.locator('.lifecycle-cleanup')).toContainText('1/1');
  await expect(page.locator('.lifecycle-cleanup')).toContainText('不代表备份已清理');
  assert.equal((await request.get(download)).status(), 404);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  return original.id;
}
