/** Built browser entries against the real M2-A1 API and a disposable PostgreSQL cluster. */
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, request, expect, type APIRequestContext, type Page } from '@playwright/test';

const root = new URL('../', import.meta.url);
const spec = JSON.parse(
  await readFile(new URL('../contracts/public-api/identity.openapi.json', import.meta.url), 'utf8'),
);
const ajv = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } });
const detailContract = ajv.compile({ ...spec.components.schemas.TenantDetail, components: spec.components });
const recordContract = ajv.compile({
  ...spec.components.schemas.ManagementRecord,
  components: spec.components,
});
const overviewContract = ajv.compile({
  ...spec.components.schemas.PlatformOverview,
  components: spec.components,
});
const temp = await mkdtemp(join(tmpdir(), 'dreamcore-b2-'));
const artifacts = new URL('../.local/m2-b2/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const children: ChildProcess[] = [];
const password = `synthetic-${randomUUID()}`;
const secrets: string[] = [password];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let logs = '';
async function port() {
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const address = listener.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  return address.port;
}
function start(command: string, args: string[], env: Record<string, string> = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  for (const stream of [child.stdout, child.stderr])
    stream?.on('data', (chunk) => {
      logs = (logs + chunk.toString()).slice(-20000);
    });
  child.on('error', () => {
    logs += '\nOwned process failed to start.';
  });
  return child;
}
async function complete(child: ChildProcess) {
  return await new Promise<number | null>((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await delay(50);
  }
  child.kill('SIGKILL');
  await complete(child);
}
async function ready(url: string, child: ChildProcess) {
  for (let i = 0; i < 150; i++) {
    assert.equal(child.exitCode, null, 'Owned service exited during startup');
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return;
    } catch {
      /* startup */
    }
    await delay(200);
  }
  throw new Error('Owned service readiness timeout');
}
async function post(api: APIRequestContext, path: string, body: unknown, expected = 200) {
  const csrf = await (await api.get('/api/v1/auth/csrf')).json();
  const response = await api.post(path, { data: body, headers: { [csrf.headerName]: csrf.token } });
  assert.equal(response.status(), expected, `Unexpected status for ${path}`);
  return response.json();
}
async function invitation(id: string) {
  const value = JSON.parse(await readFile(join(process.env.INVITATION_OUTBOX!, `${id}.json`), 'utf8'))
    .token as string;
  secrets.push(value);
  return value;
}
async function login(page: Page, email: string) {
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByLabel('密码', { exact: true }).press('Enter');
  await expect(page.locator('.access-shell')).toBeVisible();
}
async function activate(page: Page, name: string) {
  await page.getByLabel('你的姓名', { exact: true }).fill(name);
  await page.getByLabel(/^设置密码/).fill(password);
  await page.getByLabel('确认密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '创建账号并加入', exact: true }).click();
  await expect(page.getByRole('heading', { name: '登录梦核工作空间', exact: true })).toBeVisible();
}
async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: fileURLToPath(new URL(name, artifacts)), fullPage: true });
}

try {
  const secretFile = join(temp, 'password');
  await writeFile(secretFile, password, { mode: 0o600 });
  assert.equal(
    await complete(
      start('java', ['-jar', 'apps/api/target/workspace-api-0.1.0-SNAPSHOT.jar', '--bootstrap-admin'], {
        BOOTSTRAP_EMAIL: 'platform-b2@example.test',
        BOOTSTRAP_PASSWORD_FILE: secretFile,
      }),
    ),
    0,
  );
  const apiPort = await port();
  let webPort = await port();
  while (webPort === apiPort) webPort = await port();
  const apiUrl = `http://127.0.0.1:${apiPort}`,
    webUrl = `http://127.0.0.1:${webPort}`;
  const api = start('java', ['-jar', 'apps/api/target/workspace-api-0.1.0-SNAPSHOT.jar'], {
    API_HOST: '127.0.0.1',
    API_PORT: String(apiPort),
  });
  await ready(apiUrl + '/actuator/health', api);
  const web = start(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      String(webPort),
      '--strictPort',
    ],
    { DREAMCORE_DEV_API_URL: apiUrl },
  );
  await ready(webUrl, web);
  browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: webUrl, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.name));
  await page.goto('/platform-admin/');
  await login(page, 'platform-b2@example.test');
  await expect(page.getByRole('heading', { name: '还没有企业', exact: true })).toBeVisible();
  await expect(page.getByText('平台服务与数据库已连接')).toBeVisible();
  await page.getByRole('button', { name: '开通企业', exact: true }).click();
  await page.getByLabel('企业名称', { exact: true }).fill('合成总台企业 A');
  await page.getByLabel('初始管理员邮箱', { exact: true }).fill('admin-a-b2@example.test');
  // Switching away and back to the window revalidates auth without discarding a valid form draft.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('企业名称', { exact: true })).toHaveValue('合成总台企业 A');
  const submissions: Record<string, string>[] = [];
  let releaseCreate!: () => void;
  const holdCreate = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });
  let created: { tenant: { id: string }; invitation: { id: string } } | undefined;
  await page.route('**/api/platform-admin/v1/tenants', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    submissions.push(route.request().postDataJSON());
    const response = await route.fetch();
    if (submissions.length === 1) {
      created = await response.json();
      await holdCreate;
      await route.abort();
    } else await route.fulfill({ response });
  });
  await page.getByRole('button', { name: '确认开通', exact: true }).click();
  await expect.poll(() => !!created).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  releaseCreate();
  await expect(page.getByRole('alert')).toContainText('操作结果尚未确认');
  await expect(page.getByLabel('企业名称', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重试本次开通', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('admin-a-b2@example.test');
  assert.ok(created);
  assert.equal(submissions.length, 2);
  assert.equal(submissions[0].requestId, submissions[1].requestId);
  assert.equal((await (await context.request.get('/api/platform-admin/v1/tenants')).json()).length, 1);
  await page.unrouteAll();
  const a = created.tenant.id,
    originalToken = await invitation(created.invitation.id);
  await page.getByRole('button', { name: '重新生成邀请', exact: true }).click();
  await page.getByLabel('初始管理员邮箱', { exact: true }).fill('admin-a-new-b2@example.test');
  await page.getByRole('button', { name: '确认重新生成邀请', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('admin-a-new-b2@example.test');
  const detailA = await (await context.request.get(`/api/platform-admin/v1/tenants/${a}`)).json();
  assert.equal(detailA.version, 1);
  assert.ok(detailContract(detailA), 'Tenant detail differs from the metadata-only contract');
  assert.ok(overviewContract(await (await context.request.get('/api/platform-admin/v1/overview')).json()));
  const newToken = await invitation(detailA.initialAdminInvitation.id);
  const anonymous = await request.newContext({ baseURL: apiUrl });
  await post(
    anonymous,
    '/api/v1/auth/invitations/accept',
    { token: originalToken, displayName: '无效旧邀请', password },
    409,
  );
  const adminContext = await browser.newContext({ baseURL: webUrl, viewport: { width: 1440, height: 1000 } });
  const admin = await adminContext.newPage();
  admin.on('pageerror', (e) => errors.push(e.name));
  await admin.goto('/tenant-admin/#invite=' + newToken);
  await activate(admin, '合成总台管理员 A');
  await login(admin, 'admin-a-new-b2@example.test');
  await expect(admin.locator('.access-welcome h2')).toHaveText('合成总台企业 A');
  assert.equal((await adminContext.request.get(`/api/platform-admin/v1/tenants/${a}`)).status(), 403);
  await post(
    adminContext.request,
    `/api/platform-admin/v1/tenants/${a}/status`,
    { requestId: randomUUID(), expectedVersion: 1, status: 'SUSPENDED' },
    403,
  );
  await page.getByRole('button', { name: '刷新详情', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('已加入');
  await expect(page.getByRole('button', { name: '重新生成邀请', exact: true })).toHaveCount(0);
  await screenshot(page, 'tenant-detail-desktop.png');

  // A competing real operation must make the existing confirmation stale, not silently overwrite it.
  await page.getByRole('button', { name: '停用企业', exact: true }).click();
  await post(context.request, `/api/platform-admin/v1/tenants/${a}/status`, {
    requestId: randomUUID(),
    expectedVersion: 1,
    status: 'SUSPENDED',
  });
  await page.getByRole('button', { name: '确认停用企业', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('企业状态已被其他操作更新');
  await page.getByRole('button', { name: '返回并刷新详情', exact: true }).click();
  await expect(page.getByRole('button', { name: '恢复使用', exact: true })).toBeVisible();
  assert.equal((await adminContext.request.get(`/api/v1/tenants/${a}/context`)).status(), 403);
  await admin.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(admin.getByRole('heading', { name: '没有访问权限', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '恢复使用', exact: true }).click();
  await page.getByRole('button', { name: '确认恢复使用', exact: true }).click();
  await expect(page.getByRole('button', { name: '停用企业', exact: true })).toBeVisible();
  assert.equal((await adminContext.request.get(`/api/v1/tenants/${a}/context`)).status(), 200);
  await admin.reload();
  await expect(admin.locator('.access-welcome h2')).toHaveText('合成总台企业 A');
  await page.route(`**/api/platform-admin/v1/tenants/${a}`, (route) => route.abort());
  await page.getByRole('button', { name: '刷新详情', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: '暂时无法读取' })).toBeVisible();
  await expect(page.getByRole('button', { name: '停用企业', exact: true })).toHaveCount(0);
  await page.unrouteAll();
  await page.getByRole('dialog').getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('button', { name: '停用企业', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByLabel('搜索企业').fill('不存在');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.getByRole('heading', { name: '没有符合条件的企业', exact: true })).toBeVisible();
  await page.getByLabel('搜索企业').fill('合成总台企业 A');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByRole('button', { name: '查看企业 合成总台企业 A', exact: true }).click();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await expect(page.getByLabel('搜索企业')).toHaveValue('合成总台企业 A');
  await page.getByLabel('企业状态').selectOption('SUSPENDED');
  await expect(page.getByRole('heading', { name: '没有符合条件的企业', exact: true })).toBeVisible();
  await page.getByLabel('企业状态').selectOption('');
  await page.getByLabel('搜索企业').fill('');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  // Synthetic metadata creates enough rows to exercise server-side bounds and actual paging.
  for (let i = 0; i < 20; i++)
    await post(
      context.request,
      '/api/platform-admin/v1/tenants',
      {
        requestId: randomUUID(),
        name: `合成分页企业 ${String(i + 1).padStart(2, '0')}`,
        adminEmail: `page-${i}-b2@example.test`,
      },
      201,
    );
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.locator('.platform-tenant-row')).toHaveCount(20);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.platform-tenant-row')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '查看企业 合成总台企业 A', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await expect(page.locator('.platform-tenant-row')).toHaveCount(20);
  await screenshot(page, 'platform-list-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await screenshot(page, 'platform-list-mobile.png');
  await page.locator('.platform-tenant-row').first().click();
  await expect(page.getByRole('dialog')).toContainText('初始管理员');
  assert.ok(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth));
  await screenshot(page, 'tenant-detail-mobile.png');
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '开通企业', exact: true }).click();
  await screenshot(page, 'create-mobile.png');
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.route('**/api/platform-admin/v1/tenants?*', (route) => route.abort());
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(
    page.getByRole('region', { name: '企业列表' }).getByRole('heading', { name: '暂时无法读取' }),
  ).toBeVisible();
  await expect(page.locator('.platform-tenant-row,.briefing-grid')).toHaveCount(0);
  await page.unrouteAll();
  await page
    .getByRole('region', { name: '企业列表' })
    .getByRole('button', { name: '重试', exact: true })
    .click();
  await expect(page.locator('.platform-tenant-row')).toHaveCount(20);
  // Operational projections and browser storage must not expose invitation secrets or customer content.
  assert.equal((await context.request.get(`/api/v1/tenants/${a}/context`)).status(), 403);
  const records = await (await context.request.get(`/api/platform-admin/v1/tenants/${a}/records`)).json();
  assert.ok(
    records.every((item: unknown) => recordContract(item)),
    'Management record differs from the metadata-only contract',
  );
  assert.deepEqual(
    records.map((r: { action: string }) => r.action),
    ['TENANT_RESUME', 'TENANT_SUSPEND', 'INITIAL_ADMIN_INVITATION_REPLACE', 'TENANT_CREATE'],
  );
  for (const p of [page, admin]) {
    const storage = await p.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    assert.ok(!storage.includes('@example.test') && secrets.every((s) => !storage.includes(s)));
  }
  assert.deepEqual(errors, []);
  assert.ok(secrets.every((s) => !logs.includes(s)));
  await anonymous.dispose();
  console.log(
    'PASS: M2-B2 built UI + real API/DB; uncertain-create retry, initial invitation replacement/activation, stale update, suspend/resume authorization, metadata-only records, filters/paging, recovery and mobile layouts.',
  );
} catch (error) {
  let safe = String(error);
  for (const secret of secrets) safe = safe.replaceAll(secret, '[redacted test secret]');
  console.error(safe);
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const child of [...children].reverse()) await stop(child);
  await rm(temp, { recursive: true, force: true });
}
