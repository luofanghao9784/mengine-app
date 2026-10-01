/** M2-D1: use the owned C1 fixture, never modify an existing user trial. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { expect, type BrowserContext, type APIRequestContext } from '@playwright/test';
export async function revocationJourney({
  tenant,
  otherTenant,
  space,
  memberContext,
  adminContext,
  platformContext,
  memberAccount,
  artifacts,
}: {
  tenant: string;
  otherTenant: string;
  space: string;
  memberContext: BrowserContext;
  adminContext: BrowserContext;
  platformContext: BrowserContext;
  memberAccount: { email: string; password: string };
  artifacts: string;
}) {
  const page = await memberContext.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.name));
  const api = memberContext.request;
  const root = `/api/v1/tenants/${tenant}/workspaces/${space}`;
  const admin = `/api/tenant-admin/v1/tenants/${tenant}`;
  const actor = (await (await api.get('/api/v1/me')).json()).account.id;
  const location = (scope = space) =>
    '/workspace/#' + new URLSearchParams({ tenant, view: 'library', scope });
  const entry = (await (await api.get(root + '/library')).json()).items.find(
    (x: { kind: string }) => x.kind === 'DOCUMENT',
  );
  const detail = await (await api.get(root + '/materials/' + entry.id)).json();
  const download = root + `/materials/${entry.id}/versions/${detail.versions[0].id}/download`;
  async function post(context: APIRequestContext, path: string, body: unknown) {
    const csrf = await (await context.get('/api/v1/auth/csrf')).json();
    const r = await context.post(path, { data: body, headers: { [csrf.headerName]: csrf.token } });
    assert.equal(r.status(), 200, path);
    return r.json();
  }
  async function grant(enabled: boolean, maintenance = false) {
    const version = (await (await adminContext.request.get(admin + '/workspaces/' + space)).json()).version;
    await post(
      adminContext.request,
      admin + `/workspaces/${space}/members/${actor}` + (maintenance ? '/maintenance' : ''),
      { requestId: randomUUID(), expectedVersion: version, enabled },
    );
  }
  async function memberStatus(status: string) {
    const members = await (await adminContext.request.get(admin + '/members')).json();
    const version = members.find((m: { accountId: string }) => m.accountId === actor).version;
    await post(adminContext.request, admin + `/members/${actor}/status`, {
      requestId: randomUUID(),
      expectedVersion: version,
      status,
    });
  }
  async function tenantStatus(status: string) {
    const path = '/api/platform-admin/v1/tenants/' + tenant;
    const version = (await (await platformContext.request.get(path)).json()).version;
    await post(platformContext.request, path + '/status', {
      requestId: randomUUID(),
      expectedVersion: version,
      status,
    });
  }
  async function focus() {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  }
  async function navigate(scope = space) {
    await page.goto(location(scope));
    await page.reload();
  }
  async function openDocument(scope = space) {
    await navigate(scope);
    await page.locator('.material-entry').filter({ hasText: entry.name }).click();
    await expect(page.getByRole('button', { name: '下载 v1', exact: true })).toBeVisible();
  }
  const payload = {
    name: '撤权后不可保存.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('synthetic-revoked-write'),
  };
  // Downgrade closes an already-open version form, but the reader can still download.
  await openDocument();
  await page.getByRole('button', { name: '上传新版本', exact: true }).click();
  await page.getByLabel(/^选择文件/).setInputFiles(payload);
  await grant(false, true);
  await focus();
  await expect(page.getByLabel(/^选择文件/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '下载 v1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '上传新版本', exact: true })).toHaveCount(0);
  assert.equal((await api.get(download)).status(), 200);
  await page.screenshot({ path: join(artifacts, 'readonly-open-version.png'), fullPage: true });
  await grant(true, true);
  // New-upload and folder forms also lose editability after a positive read-only recheck.
  for (const label of ['上传资料', '新建文件夹']) {
    await navigate();
    await page.getByRole('button', { name: label, exact: true }).click();
    if (label === '上传资料') await page.getByLabel(/^选择文件/).setInputFiles(payload);
    else await page.getByLabel('文件夹名称').fill('不应创建');
    await grant(false, true);
    await focus();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.material-caption')).toContainText('只读');
    await grant(true, true);
  }
  // A denied download itself invalidates stale detail, without relying on a focus event.
  await openDocument('all');
  await grant(false);
  await page.getByRole('button', { name: '下载 v1', exact: true }).click();
  await expect(page.locator('.material-detail-heading')).toHaveCount(0);
  await expect(page.locator('.material-versions')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '暂时无法读取', exact: true })).toBeVisible();
  await page.screenshot({ path: join(artifacts, 'revoked-download.png'), fullPage: true });
  assert.equal((await api.get(download)).status(), 404);
  await grant(true);
  await grant(true, true);
  // Hold a previously authorized download; after revocation is known, its late response must not save.
  await openDocument('all');
  let release!: () => void, entered!: () => void, finished!: () => void;
  const arrived = new Promise<void>((r) => (entered = r)),
    hold = new Promise<void>((r) => (release = r)),
    done = new Promise<void>((r) => (finished = r));
  let saved = 0;
  const onDownload = () => saved++;
  page.on('download', onDownload);
  await page.route('**/download', async (route) => {
    try {
      const response = await route.fetch();
      entered();
      await hold;
      await route.fulfill({ response });
    } catch {
      /* The invalidated view aborts the pending browser request. */
    } finally {
      finished();
    }
  });
  await page.getByRole('button', { name: '下载 v1', exact: true }).click();
  await arrived;
  try {
    await grant(false);
    await focus();
    await expect(page.locator('.material-detail-heading')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '暂时无法读取', exact: true })).toBeVisible();
  } finally {
    release();
  }
  await done;
  await page.unrouteAll();
  // A new browser task ensures the released response has had an opportunity to dispatch.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(saved, 0);
  page.off('download', onDownload);
  await grant(true);
  await grant(true, true);
  // Existing member session: suspension clears the open detail and only blocks this enterprise.
  await openDocument();
  await memberStatus('DISABLED');
  await focus();
  await expect(page.getByRole('heading', { name: '没有访问权限', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.equal((await api.get(download)).status(), 403);
  assert.equal((await api.get(`/api/v1/tenants/${otherTenant}/library`)).status(), 200);
  await memberStatus('ACTIVE');
  // Old detail responses cannot cross an enterprise switch.
  await navigate();
  let releaseDetail!: () => void, detailEntered!: () => void;
  const detailHold = new Promise<void>((r) => (releaseDetail = r)),
    detailArrival = new Promise<void>((r) => (detailEntered = r));
  await page.route('**/materials/*?offset=*', async (route) => {
    const response = await route.fetch();
    detailEntered();
    await detailHold;
    try {
      await route.fulfill({ response });
    } catch {
      /* cancelled during tenant switch */
    }
  });
  await page.locator('.material-entry').filter({ hasText: entry.name }).click();
  await detailArrival;
  await page.getByLabel('当前企业').selectOption(otherTenant);
  releaseDetail();
  await page.unrouteAll({ behavior: 'wait' });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.material-entry').filter({ hasText: entry.name })).toHaveCount(0);
  // Pause the tenant with an open form; persist the stopped state across the full runtime restart.
  await navigate();
  await page.getByRole('button', { name: '上传资料', exact: true }).click();
  await page.getByLabel(/^选择文件/).setInputFiles(payload);
  await tenantStatus('SUSPENDED');
  await focus();
  await expect(page.getByRole('heading', { name: '没有访问权限', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.equal((await api.get(download)).status(), 403);
  return async () => {
    assert.equal(
      (await api.get(download)).status(),
      403,
      'Suspension must survive restart with the same cookies and URL',
    );
    assert.equal((await api.get(`/api/v1/tenants/${otherTenant}/library`)).status(), 200);
    await tenantStatus('ACTIVE');
    await openDocument();
    assert.equal((await api.get(download)).status(), 200);
    // Logout in another tab must also remove an open version view; copied links cannot download.
    const other = await memberContext.newPage();
    await other.goto(location());
    await other.getByRole('button', { name: '账号与退出', exact: true }).click();
    await other.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '登录梦擎工作空间', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    assert.equal((await api.get(download)).status(), 401);
    await page.getByLabel('邮箱', { exact: true }).fill(memberAccount.email);
    await page.getByLabel('密码', { exact: true }).fill(memberAccount.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.locator('.access-shell')).toBeVisible();
    assert.equal((await api.get(download)).status(), 200);
    assert.equal((await (await api.get(root + '/materials/' + entry.id)).json()).document.version, 1);
    assert.deepEqual(errors, []);
    await writeFile(
      join(artifacts, 'revocation-result.json'),
      JSON.stringify(
        {
          status: 'passed',
          synthetic: true,
          checks: [
            'open-form-downgrade',
            'download-denial-clears-detail',
            'late-download-discarded',
            'member-disable-other-tenant-available',
            'late-detail-tenant-switch',
            'suspended-runtime-restart',
            'cross-tab-logout',
          ],
        },
        null,
        2,
      ) + '\n',
    );
    await other.close();
    await page.close();
  };
}
