import assert from 'node:assert/strict';
import { blockDraftWrites, restoreDraftWrites } from './draft-storage-fixture.ts';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function documentJourney(
  page: Page,
  user: APIRequestContext,
  platform: APIRequestContext,
  tenant: string,
  conversation: string,
  screenshot: (page: Page, name: string) => Promise<void>,
  publish?: (id: string) => Promise<void>,
) {
  const root = `/api/v1/tenants/${tenant}/documents`;
  async function post(api: APIRequestContext, path: string, data: unknown, status = 200) {
    const csrf = await (await api.get('/api/v1/auth/csrf')).json();
    const response = await api.post(path, { data, headers: { [csrf.headerName]: csrf.token } });
    assert.equal(response.status(), status);
    return response.json();
  }
  const conversationRoute = `/workspace/#tenant=${tenant}&view=conversations&conversation=${conversation}`;
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(conversationRoute);
  await page.getByRole('button', { name: '编辑 extracted-1.txt', exact: true }).click();
  const title = page.getByLabel('文稿标题', { exact: true }),
    body = page.getByLabel('文稿正文', { exact: true });
  await expect(title).toHaveValue('extracted-1');
  await expect(body).toHaveValue('<script>literal</script>\n第三行');
  const docId = new URLSearchParams(new URL(page.url()).hash.slice(1)).get('document')!;
  const docRoot = root + '/' + docId;
  const originalResponse = await user.get(docRoot),
    original = await originalResponse.json();
  assert.match(originalResponse.headers()['cache-control'], /no-store/);
  assert.equal(original.document.revision, 1);
  assert.equal((await platform.get(docRoot)).status(), 403);
  assert.equal(
    (
      await user.post(docRoot + '/versions', {
        data: { requestId: randomUUID(), expectedRevision: 1, title: '无 CSRF', body: '内容' },
      })
    ).status(),
    403,
  );
  await post(
    user,
    root,
    {
      requestId: randomUUID(),
      conversationId: conversation,
      taskId: original.document.taskId,
      ownerId: randomUUID(),
    },
    400,
  );
  await page.goto(conversationRoute);
  await page.getByRole('button', { name: '编辑 extracted-1.txt', exact: true }).click();
  await expect(body).toHaveValue(original.version.body);
  assert.equal((await (await user.get(root)).json()).items.length, 1);
  assert.ok(page.url().includes(docId));
  await body.fill('先前已存文稿草稿');
  await blockDraftWrites(page, 'dreamcore:document:');
  await body.fill('无法写入的最新文稿');
  await expect(page.getByRole('alert').filter({ hasText: '当前草稿尚未保存在浏览器中' })).toBeVisible();
  await expect(body).toHaveValue('无法写入的最新文稿');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('alert').filter({ hasText: '当前草稿尚未保存在浏览器中' }).scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await screenshot(page, 'documents-draft-unavailable-mobile.png');
  await page.setViewportSize({ width: 1440, height: 960 });
  assert.equal(
    await page.evaluate(
      () => Object.keys(sessionStorage).filter((k) => k.startsWith('dreamcore:document:')).length,
    ),
    0,
  );
  await restoreDraftWrites(page);
  await title.fill('个人进展报告');
  await expect(page.getByRole('alert').filter({ hasText: '当前草稿尚未保存在浏览器中' })).toHaveCount(0);
  const edited = '# 本周进展\n中文文稿已保存。\n<script>仍是文字</script>\n- 数字 0.3';
  await body.fill(edited);
  await expect(page.getByRole('button', { name: '导出 PDF', exact: true })).toBeDisabled();
  await page.reload();
  await expect(body).toHaveValue(edited);
  await expect(page.getByText('已恢复未保存草稿。', { exact: true })).toBeVisible();
  await page.context().setOffline(true);
  await page.getByRole('button', { name: '保存新版本', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试本次保存', exact: true })).toBeEnabled();
  await page.context().setOffline(false);
  assert.equal((await (await user.get(docRoot)).json()).document.revision, 1);
  // Persist the write, then deliberately drop the response. Reload must reuse its request key.
  await page.route(
    '**' + docRoot + '/versions',
    async (route) => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: '重试本次保存', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试本次保存', exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('button', { name: '重试本次保存', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '重试本次保存', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存新版本', exact: true })).toBeVisible();
  assert.equal((await (await user.get(docRoot)).json()).document.revision, 2);
  await expect(page.locator('.document-version-bar')).toContainText('个人文稿 v2');
  await expect(body).toHaveValue(edited);
  for (const format of ['Word', 'PDF']) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 ' + format, exact: true }).click();
    const download = await pending,
      bytes = await readFile((await download.path())!);
    assert.equal(download.suggestedFilename(), '个人进展报告-v2.' + (format === 'PDF' ? 'pdf' : 'docx'));
    assert.equal(bytes.subarray(0, format === 'PDF' ? 5 : 2).toString(), format === 'PDF' ? '%PDF-' : 'PK');
  }
  assert.equal((await (await user.get(docRoot + '?version=1')).json()).version.body, original.version.body);
  await page.getByRole('button', { name: '上一版本', exact: true }).click();
  await expect(body).toHaveValue(original.version.body);
  await expect(body).toBeDisabled();
  await page.reload();
  await expect(body).toBeDisabled();
  await page.getByRole('button', { name: '返回最新版本', exact: true }).click();
  await expect(body).toHaveValue(edited);
  await expect(body).toBeEnabled();
  await body.fill('另一个标签页同时编辑，保留这个草稿');
  await post(user, docRoot + '/versions', {
    requestId: randomUUID(),
    expectedRevision: 2,
    title: '其他窗口保存',
    body: '另一窗口已保存的版本',
  });
  await page.getByRole('button', { name: '保存新版本', exact: true }).click();
  await expect(page.locator('.document-editor')).toContainText('文稿已有新版本');
  await expect(body).toHaveValue('另一个标签页同时编辑，保留这个草稿');
  await page.getByRole('button', { name: '放弃草稿，载入最新', exact: true }).click();
  await expect(body).toHaveValue('另一窗口已保存的版本');
  await page.locator('.document-breadcrumb').getByRole('link', { name: '资料库', exact: true }).click();
  await page.getByRole('button', { name: '个人文稿', exact: true }).click();
  await expect(page.locator('.document-list a')).toHaveCount(1);
  await page.locator('.document-list a').click();
  await expect(body).toHaveValue('另一窗口已保存的版本');
  await screenshot(page, 'documents-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '导出 PDF', exact: true }).scrollIntoViewIfNeeded();
  await screenshot(page, 'documents-mobile.png');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  if (publish) await publish(docId);
  // Revocation must clear the open editor and its private tab draft; cached exports are also denied.
  await body.fill('停用后应清除的本地草稿');
  const tenantRoot = '/api/platform-admin/v1/tenants/' + tenant;
  const detail = await (await platform.get(tenantRoot)).json();
  await post(platform, tenantRoot + '/status', {
    requestId: randomUUID(),
    expectedVersion: detail.version,
    status: 'SUSPENDED',
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(body).toHaveCount(0);
  assert.equal((await user.get(docRoot + '/versions/2/exports/docx')).status(), 403);
  assert.equal(
    await page.evaluate(
      () => Object.keys(sessionStorage).filter((k) => k.startsWith('dreamcore:document:')).length,
    ),
    0,
  );
  await screenshot(page, 'documents-revoked.png');
}
