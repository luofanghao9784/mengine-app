import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export async function publicationJourney(
  page: Page,
  user: APIRequestContext,
  platform: APIRequestContext,
  tenant: string,
  document: string,
  password: string,
  invitation: (id: string) => Promise<string>,
  screenshot: (page: Page, name: string) => Promise<void>,
) {
  async function post(api: APIRequestContext, path: string, data: unknown, status = 200) {
    const csrf = await (await api.get('/api/v1/auth/csrf')).json();
    const result = await api.post(path, { data, headers: { [csrf.headerName]: csrf.token } });
    assert.equal(result.status(), status);
    return result.json();
  }
  const root = `/api/v1/tenants/${tenant}/documents/${document}`,
    adminRoot = `/api/tenant-admin/v1/tenants/${tenant}`;
  const owner = (await (await user.get('/api/v1/me')).json()).account.id;
  const space = await post(
    user,
    adminRoot + '/workspaces',
    { requestId: randomUUID(), name: '共享交付验证' },
    201,
  );
  // Fixture setup only: existing admin self-grant policy is deliberately not changed by this feature.
  // Guard against accidentally applying the fixture to any persistent or external database.
  const db = new URL(process.env.DATABASE_URL!.replace(/^jdbc:/, ''));
  assert.equal(db.hostname, '127.0.0.1');
  assert.equal(db.pathname, '/dreamcore_test');
  assert.equal(process.env.DATABASE_USER, 'dreamcore_test');
  assert.ok(process.env.MATERIAL_STORAGE_ROOT!.includes('dreamcore-test-pg-'));
  for (const id of [tenant, owner, space.id]) assert.match(id, /^[0-9a-f-]{36}$/);
  const seeded = spawnSync(
    process.env.POSTGRES_BIN ? join(process.env.POSTGRES_BIN, 'psql') : 'psql',
    [
      '-X',
      '-h',
      db.hostname,
      '-p',
      db.port,
      '-U',
      process.env.DATABASE_USER!,
      '-d',
      'dreamcore_test',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES ('${tenant}','${space.id}','${owner}',true)`,
    ],
    { env: { ...process.env, PGPASSWORD: process.env.DATABASE_PASSWORD }, encoding: 'utf8' },
  );
  assert.equal(seeded.status, 0, 'Isolated publication fixture setup failed');
  const targetRoot = `/api/v1/tenants/${tenant}/workspaces/${space.id}`;
  const folder = await post(
    user,
    targetRoot + '/folders',
    { requestId: randomUUID(), parentId: null, name: '正式交付' },
    201,
  );
  const invite = await post(
    user,
    adminRoot + '/invitations',
    { requestId: randomUUID(), email: 'publication-reader@example.test' },
    201,
  );
  const recipient = await page
    .context()
    .browser()!
    .newContext({ baseURL: new URL(page.url()).origin, viewport: { width: 1440, height: 960 } });
  try {
    await post(recipient.request, '/api/v1/auth/invitations/accept', {
      token: await invitation(invite.id),
      displayName: '成果阅读同事',
      password,
    });
    const identity = await post(recipient.request, '/api/v1/auth/login', {
      email: 'publication-reader@example.test',
      password,
    });
    let managed = await (await user.get(adminRoot + '/workspaces/' + space.id)).json();
    managed = await post(user, adminRoot + `/workspaces/${space.id}/members/${identity.account.id}`, {
      requestId: randomUUID(),
      expectedVersion: managed.version,
      enabled: true,
    });
    const documentRoute = `/workspace/#tenant=${tenant}&view=documents&document=${document}`;
    await page.goto(documentRoute);
    await page.setViewportSize({ width: 1440, height: 960 });
    const before = await (await user.get(root)).json(),
      sourceVersion = before.version.number,
      filename = before.version.title + '.docx';
    const endpoint = root + `/versions/${sourceVersion}/publications`;
    assert.equal((await platform.get(root + '/publications')).status(), 403);
    assert.equal(
      (
        await user.post(endpoint, {
          data: {
            requestId: randomUUID(),
            workspaceId: space.id,
            format: 'docx',
            acknowledgeIndependentCopy: true,
          },
        })
      ).status(),
      403,
    );
    await post(
      user,
      endpoint,
      { requestId: randomUUID(), workspaceId: space.id, format: 'docx', acknowledgeIndependentCopy: false },
      400,
    );
    await post(
      user,
      endpoint,
      {
        requestId: randomUUID(),
        workspaceId: space.id,
        format: 'docx',
        acknowledgeIndependentCopy: true,
        ownerId: identity.account.id,
      },
      400,
    );
    async function open(mode = 'new') {
      await page.getByRole('button', { name: '发布到企业资料库', exact: true }).click();
      await page.getByLabel('目标空间', { exact: true }).selectOption(space.id);
      await page.getByLabel('发布方式', { exact: true }).selectOption(mode);
      await page.getByRole('dialog').getByRole('button', { name: '正式交付', exact: true }).click();
    }
    await open();
    await expect(page.getByRole('button', { name: '确认发布', exact: true })).toBeDisabled();
    await page.getByRole('checkbox').check();
    await screenshot(page, 'publication-preview-desktop.png');
    const submissions: string[] = [];
    await page.route(
      '**' + endpoint,
      async (route) => {
        submissions.push(route.request().postDataJSON().requestId);
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        await route.abort('failed');
      },
      { times: 1 },
    );
    await page.getByRole('button', { name: '确认发布', exact: true }).click();
    await expect(page.getByRole('button', { name: '重试本次发布', exact: true })).toBeEnabled();
    await expect(page.getByLabel('目标空间', { exact: true })).toBeDisabled();
    page.on('request', (request) => {
      if (request.url().endsWith(endpoint) && request.method() === 'POST')
        submissions.push(request.postDataJSON().requestId);
    });
    await page.getByRole('button', { name: '重试本次发布', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    assert.equal(submissions.length, 2);
    assert.equal(submissions[0], submissions[1]);
    await expect(page.locator('.publication-history li')).toHaveCount(1);
    const first = (await (await user.get(root + '/publications')).json()).items[0];
    assert.equal(first.folderId, folder.id);
    assert.equal(first.materialVersion, 1);
    const materialRoot = targetRoot + '/materials/' + first.materialId,
      download = materialRoot + `/versions/${first.materialVersionId}/download`;
    const shared = await (await recipient.request.get(materialRoot)).json();
    assert.equal(shared.versions[0].origin, 'DOCUMENT_PUBLICATION');
    const serialized = JSON.stringify(shared);
    assert.ok(!serialized.includes(document));
    assert.ok(!serialized.includes(before.document.conversationId));
    assert.ok(!serialized.includes(before.document.sourceWorkspaceId));
    assert.equal((await recipient.request.get(root)).status(), 404);
    assert.equal((await recipient.request.get(root + '/publications')).status(), 404);
    const firstBytes = await (await recipient.request.get(download)).body();
    assert.equal(firstBytes.subarray(0, 2).toString(), 'PK');
    const analysis = materialRoot + `/versions/${first.materialVersionId}/analysis`;
    await expect
      .poll(async () => (await (await recipient.request.get(analysis)).json()).status, { timeout: 30000 })
      .toBe('READY');
    const reading = await recipient.newPage();
    await reading.goto(`/workspace/#tenant=${tenant}&view=library&scope=${space.id}&folder=${folder.id}`);
    await expect(reading.getByText(filename, { exact: true })).toBeVisible();
    await reading.getByText(filename, { exact: true }).click();
    await expect(reading.getByRole('dialog')).toContainText('文稿发布');
    await expect(reading.getByRole('button', { name: '上传新版本', exact: true })).toHaveCount(0);
    await screenshot(reading, 'publication-recipient.png');
    await page
      .getByLabel('文稿正文', { exact: true })
      .fill('个人修订已保存，只有明确再次发布才会更新企业资料。');
    await expect(page.getByRole('button', { name: '发布到企业资料库', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '保存新版本', exact: true }).click();
    await expect(page.locator('.document-version-bar')).toContainText('个人文稿 v' + (sourceVersion + 1));
    assert.equal((await (await recipient.request.get(materialRoot)).json()).document.version, 1);
    await open('update');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: filename + ' · 当前 v1', exact: true })
      .click();
    await page.getByRole('checkbox').check();
    // A regular material upload races the publication, proving both share the same optimistic version gate.
    const csrf = await (await user.get('/api/v1/auth/csrf')).json();
    const uploaded = await user.post(materialRoot + '/versions', {
      headers: { [csrf.headerName]: csrf.token },
      multipart: {
        metadata: {
          name: 'metadata.json',
          mimeType: 'application/json',
          buffer: Buffer.from(JSON.stringify({ requestId: randomUUID(), expectedVersion: 1 })),
        },
        file: {
          name: '同事临时更新.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('另一次明确的企业更新'),
        },
      },
    });
    assert.equal(uploaded.status(), 201);
    await page.getByRole('button', { name: '确认发布', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('版本');
    await expect(page.getByRole('dialog').locator('[role="alert"]')).toBeVisible();
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await open('update');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: filename + ' · 当前 v2', exact: true })
      .click();
    await page.getByRole('checkbox').check();
    await page.setViewportSize({ width: 390, height: 844 });
    await screenshot(page, 'publication-preview-mobile.png');
    await page.getByRole('button', { name: '确认发布', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.publication-history li')).toHaveCount(2);
    const latest = await (await recipient.request.get(materialRoot)).json();
    assert.equal(latest.document.version, 3);
    assert.deepEqual(
      latest.versions.map((v: { origin: string }) => v.origin),
      ['DOCUMENT_PUBLICATION', 'UPLOAD', 'DOCUMENT_PUBLICATION'],
    );
    assert.deepEqual(await (await recipient.request.get(download)).body(), firstBytes);
    assert.equal(
      (
        await post(user, root + `/versions/${sourceVersion + 1}/publications`, {
          requestId: randomUUID(),
          workspaceId: space.id,
          materialId: first.materialId,
          expectedMaterialVersion: 2,
          format: 'docx',
          acknowledgeIndependentCopy: true,
        })
      ).materialVersion,
      3,
    );
    await page.locator('.publication-history').scrollIntoViewIfNeeded();
    await screenshot(page, 'publication-history-mobile.png');
    assert.ok(await page.evaluate(() => window.document.documentElement.scrollWidth <= innerWidth));
    // Shared activity is based on committed target versions and never discloses private lineage.
    const activityPath = `/api/v1/tenants/${tenant}/activity`;
    assert.equal((await platform.get(activityPath)).status(), 403);
    const feedResponse = await recipient.request.get(activityPath);
    assert.equal(feedResponse.headers()['cache-control'], 'private, no-store');
    const feed = await feedResponse.json();
    assert.equal(feed.items.length, 3);
    assert.equal(feed.nextCursor, null);
    assert.deepEqual(
      feed.items.map((item: { kind: string }) => item.kind),
      ['DOCUMENT_UPDATED', 'MATERIAL_UPDATED', 'DOCUMENT_PUBLISHED'],
    );
    for (const privateId of [document, before.document.conversationId, before.document.sourceWorkspaceId])
      assert.ok(!JSON.stringify(feed).includes(privateId));
    assert.ok(!JSON.stringify(feed).includes('@example.test'));
    assert.equal(feed.items[2].id, first.materialVersionId);
    await reading.goto(`/workspace/#tenant=${tenant}`);
    const activity = reading.getByRole('region', { name: '企业动态', exact: true });
    await expect(activity.locator('.activity-list li')).toHaveCount(3);
    await reading.getByLabel('动态空间范围').selectOption(space.id);
    await expect(activity.locator('.activity-list li')).toHaveCount(3);
    await expect(activity.locator('.activity-list li').first()).toContainText('更新了已发布文稿');
    const transfer = reading.waitForEvent('download');
    await activity.getByRole('button', { name: '下载 v1', exact: true }).click();
    const transferFile = await transfer;
    const { readFile } = await import('node:fs/promises');
    assert.deepEqual(await readFile((await transferFile.path())!), firstBytes);
    await activity.getByRole('button', { name: '刷新动态', exact: true }).click();
    await expect(activity.locator('.activity-list li')).toHaveCount(3);
    await activity.scrollIntoViewIfNeeded();
    await screenshot(reading, 'activity-desktop.png');
    await reading.setViewportSize({ width: 390, height: 844 });
    await activity.scrollIntoViewIfNeeded();
    await screenshot(reading, 'activity-mobile.png');
    assert.ok(await reading.evaluate(() => window.document.documentElement.scrollWidth <= innerWidth));
    // Failed revalidation removes cached rows, then explicit retry restores them.
    await reading.route('**/activity?**', (route) => route.abort('failed'), { times: 1 });
    await activity.getByRole('button', { name: '刷新动态', exact: true }).click();
    await expect(activity.getByRole('button', { name: '重试', exact: true })).toBeVisible();
    await expect(activity.locator('.activity-list li')).toHaveCount(0);
    await activity.getByRole('button', { name: '重试', exact: true }).click();
    await expect(activity.locator('.activity-list li')).toHaveCount(3);
    // Exercise the actual cursor UI with more than one page; these remain synthetic shared uploads.
    for (let i = 0; i < 18; i++) {
      const added = await user.post(targetRoot + '/materials', {
        headers: { [csrf.headerName]: csrf.token },
        multipart: {
          metadata: {
            name: 'metadata.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify({ requestId: randomUUID(), folderId: folder.id })),
          },
          file: {
            name: `分页合成资料-${i}.txt`,
            mimeType: 'text/plain',
            buffer: Buffer.from('synthetic activity pagination'),
          },
        },
      });
      assert.equal(added.status(), 201);
    }
    await activity.getByRole('button', { name: '刷新动态', exact: true }).click();
    await expect(activity.locator('.activity-list li')).toHaveCount(20);
    await activity.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(activity.locator('.activity-list li')).toHaveCount(1);
    await expect(activity.getByRole('button', { name: '下载 v1', exact: true })).toBeVisible();
    await expect(activity.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
    await activity.getByRole('button', { name: '上一页', exact: true }).click();
    await expect(activity.locator('.activity-list li')).toHaveCount(20);
    await activity.getByRole('link', { name: '进入资料位置', exact: true }).first().click();
    await expect(reading.getByRole('heading', { name: '资料库', exact: true })).toBeVisible();
    await expect(reading.getByText(filename, { exact: true })).toBeVisible();
    await reading.goto(`/workspace/#tenant=${tenant}`);
    await expect(activity.locator('.activity-list li')).toHaveCount(20);
    managed = await (await user.get(adminRoot + '/workspaces/' + space.id)).json();
    await post(user, adminRoot + `/workspaces/${space.id}/members/${identity.account.id}`, {
      requestId: randomUUID(),
      expectedVersion: managed.version,
      enabled: false,
    });
    assert.equal((await recipient.request.get(download)).status(), 404);
    assert.deepEqual((await (await recipient.request.get(activityPath)).json()).items, []);
    assert.equal((await recipient.request.get(activityPath + '?workspace=' + space.id)).status(), 404);
    await reading.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(activity.locator('.activity-list li')).toHaveCount(0);
    await expect(activity.getByText('暂无可见动态', { exact: true })).toBeVisible();
    await screenshot(reading, 'activity-revoked.png');
    // Revoking the publisher's destination grant must remove both history and the cached success receipt.
    managed = await (await user.get(adminRoot + '/workspaces/' + space.id)).json();
    await post(user, adminRoot + `/workspaces/${space.id}/members/${owner}`, {
      requestId: randomUUID(),
      expectedVersion: managed.version,
      enabled: false,
    });
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(page.locator('.publication-history li')).toHaveCount(0);
    await expect(page.locator('.document-publications .access-success')).toHaveCount(0);
    await expect(page.getByLabel('文稿正文', { exact: true })).toBeVisible();
  } finally {
    await recipient.close();
  }
}
