/** Built browser entries against the real M2-B3 API and a disposable PostgreSQL cluster. */
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
const validate = (name: string, value: unknown) => {
  const check = ajv.compile({ ...spec.components.schemas[name], components: spec.components });
  assert.ok(check(value), `${name} response differs from contract`);
};
const temp = await mkdtemp(join(tmpdir(), 'dreamcore-b3-'));
const artifacts = new URL('../.local/m2-b3/', import.meta.url);
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
  await page.screenshot({
    path: fileURLToPath(new URL(name, artifacts)),
    fullPage: true,
    animations: 'disabled',
  });
}

try {
  const secretFile = join(temp, 'password');
  await writeFile(secretFile, password, { mode: 0o600 });
  assert.equal(
    await complete(
      start('java', ['-jar', 'apps/api/target/workspace-api-0.1.0-SNAPSHOT.jar', '--bootstrap-admin'], {
        BOOTSTRAP_EMAIL: 'platform-b3@example.test',
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
  const platform = await request.newContext({ baseURL: apiUrl });
  await post(platform, '/api/v1/auth/login', { email: 'platform-b3@example.test', password });
  const a = await post(
    platform,
    '/api/platform-admin/v1/tenants',
    { requestId: randomUUID(), name: '合成梦核企业', adminEmail: 'admin-b3@example.test' },
    201,
  );
  const tenant = a.tenant.id,
    path = `/api/tenant-admin/v1/tenants/${tenant}`;
  await page.goto('/tenant-admin/#invite=' + (await invitation(a.invitation.id)));
  await activate(page, '合成企业管理员');
  await login(page, 'admin-b3@example.test');
  await expect(page.locator('.access-welcome h2')).toHaveText('合成梦核企业');
  await expect(page.locator('.tenant-rows > li')).toHaveCount(1);
  validate('TenantOverview', await (await context.request.get(path + '/overview')).json());
  validate('TenantMember', (await (await context.request.get(path + '/members')).json())[0]);
  await page.getByRole('button', { name: '停用', exact: true }).click();
  await page.getByRole('button', { name: '确认停用', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('至少一名有效');
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '邀请成员', exact: true }).click();
  await page.getByLabel('受邀邮箱').fill('member-b3@example.test');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('受邀邮箱')).toHaveValue('member-b3@example.test');
  await page.getByRole('button', { name: '生成邀请', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '成员邀请', exact: true }).click();
  const invites = await (await context.request.get(path + '/invitations')).json();
  const invite = invites.find((v: { email: string }) => v.email === 'member-b3@example.test');
  validate('Invitation', invite);
  await expect(page.locator('.tenant-rows')).toContainText('等待接受');
  const memberContext = await browser.newContext({ baseURL: webUrl, viewport: { width: 1280, height: 900 } });
  const member = await memberContext.newPage();
  member.on('pageerror', (e) => errors.push(e.name));
  await member.goto('/workspace/#invite=' + (await invitation(invite.id)));
  await activate(member, '合成测试成员');
  await login(member, 'member-b3@example.test');
  await expect(member.locator('.access-spaces > li')).toHaveCount(1);
  const memberId = (await (await memberContext.request.get('/api/v1/me')).json()).account.id;
  assert.equal((await memberContext.request.get(path + '/members')).status(), 403);
  assert.equal((await platform.get(path + '/overview')).status(), 403);
  await page.getByRole('button', { name: '共享空间', exact: true }).click();
  await page.getByRole('button', { name: '创建空间', exact: true }).click();
  await page.getByLabel('空间名称', { exact: true }).fill('梦核开发资料');
  const submitted: Record<string, string>[] = [];
  await page.route('**/api/tenant-admin/v1/tenants/*/workspaces', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    submitted.push(route.request().postDataJSON());
    const response = await route.fetch();
    if (submitted.length === 1) await route.abort();
    else await route.fulfill({ response });
  });
  await page.getByRole('dialog').getByRole('button', { name: '创建空间', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('操作结果尚未确认');
  await expect(page.getByLabel('空间名称', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '按原内容重试', exact: true }).click();
  await expect(page.getByRole('heading', { name: '还没有授权成员', exact: true })).toBeVisible();
  assert.equal(submitted.length, 2);
  assert.equal(submitted[0].requestId, submitted[1].requestId);
  await page.unrouteAll();
  const spaces = await (await context.request.get(path + '/workspaces')).json();
  assert.equal(spaces.length, 1);
  const space = spaces[0];
  validate('SharedWorkspace', space);
  assert.equal(
    (await (await context.request.get(`/api/v1/tenants/${tenant}/context`)).json()).workspaces.length,
    1,
  );
  await page.getByRole('button', { name: '添加成员', exact: true }).click();
  await expect(
    page
      .locator('.tenant-grants li')
      .filter({ hasText: 'admin-b3@example.test' })
      .getByRole('button', { name: '选择' }),
  ).toBeDisabled();
  await page.getByLabel('搜索授权成员').fill('member-b3');
  await page.getByRole('dialog').getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.locator('.tenant-grants > li')).toHaveCount(1);
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await page.getByRole('button', { name: '确认添加', exact: true }).click();
  await expect(page.locator('.tenant-grants')).toContainText('member-b3@example.test');
  validate(
    'WorkspaceGrant',
    (await (await context.request.get(path + `/workspaces/${space.id}/members`)).json())[0],
  );
  await member.reload();
  await expect(member.locator('.access-spaces > li')).toHaveCount(2);
  await screenshot(page, 'workspace-grants-desktop.png');
  // A stale confirmation must not undo another manager's newer decision.
  await page.getByRole('button', { name: '撤销授权', exact: true }).click();
  await post(context.request, path + `/workspaces/${space.id}/settings`, {
    requestId: randomUUID(),
    expectedVersion: 1,
    name: '梦核项目资料',
  });
  await page.getByRole('button', { name: '确认撤销授权', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('信息已被其他操作更新');
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByRole('button', { name: '管理空间 梦核项目资料', exact: true }).click();
  await page.getByRole('button', { name: '撤销授权', exact: true }).click();
  await page.getByRole('button', { name: '确认撤销授权', exact: true }).click();
  await expect(page.getByRole('heading', { name: '还没有授权成员', exact: true })).toBeVisible();
  await member.reload();
  await expect(member.locator('.access-spaces > li')).toHaveCount(1);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '企业成员', exact: true }).click();
  const row = page.locator('.tenant-rows > li').filter({ hasText: 'member-b3@example.test' });
  await row.getByRole('button', { name: '停用', exact: true }).click();
  await page.getByRole('button', { name: '确认停用', exact: true }).click();
  await expect(row).toContainText('已停用');
  assert.equal((await memberContext.request.get(`/api/v1/tenants/${tenant}/context`)).status(), 403);
  await member.reload();
  await expect(member.getByRole('heading', { name: '尚未加入企业', exact: true })).toBeVisible();
  await row.getByRole('button', { name: '恢复', exact: true }).click();
  await page.getByRole('button', { name: '恢复成员', exact: true }).click();
  await expect(row).toContainText('已启用');
  await member.reload();
  await expect(member.locator('.access-spaces > li')).toHaveCount(1);
  await page.getByLabel('搜索姓名或邮箱').fill('不存在');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.getByRole('heading', { name: '没有找到成员' })).toBeVisible();
  await page.getByLabel('搜索姓名或邮箱').fill('');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.locator('.tenant-rows > li')).toHaveCount(2);
  await screenshot(page, 'tenant-members-desktop.png');
  await page.getByRole('button', { name: '企业设置', exact: true }).click();
  await page.getByRole('button', { name: '修改名称', exact: true }).click();
  await page.getByLabel('企业名称', { exact: true }).fill('合成梦核工作空间');
  await page.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(page.locator('.access-welcome h2')).toHaveText('合成梦核工作空间');
  await expect(page.getByLabel('当前企业').locator('option:checked')).toHaveText('合成梦核工作空间');
  await page.getByRole('button', { name: '管理记录', exact: true }).click();
  await expect(page.locator('.tenant-records')).toContainText('撤销空间授权');
  for (const value of await (await context.request.get(path + '/records')).json())
    validate('TenantRecord', value);
  await screenshot(page, 'tenant-records-desktop.png');
  // Real invitation paging and revocation, without external delivery.
  for (let i = 0; i < 20; i++)
    await post(
      context.request,
      path + '/invitations',
      { requestId: randomUUID(), email: `paging-b3-${i}@example.test` },
      201,
    );
  await page.getByRole('button', { name: '成员邀请', exact: true }).click();
  await expect(page.locator('.tenant-rows > li')).toHaveCount(20);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.tenant-rows > li')).toHaveCount(2);
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await page
    .locator('.tenant-rows > li')
    .first()
    .getByRole('button', { name: '撤销邀请', exact: true })
    .click();
  await page.getByRole('button', { name: '确认撤销', exact: true }).click();
  await expect(page.locator('.tenant-rows > li').first()).toContainText('已撤销');
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot(page, 'tenant-invitations-mobile.png');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByRole('button', { name: '企业成员', exact: true }).click();
  await expect(page.locator('.tenant-rows > li')).toHaveCount(2);
  await screenshot(page, 'tenant-members-mobile.png');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByRole('button', { name: '共享空间', exact: true }).click();
  await page.getByRole('button', { name: '管理空间 梦核项目资料', exact: true }).click();
  await expect(page.getByRole('heading', { name: '还没有授权成员', exact: true })).toBeVisible();
  await screenshot(page, 'workspace-grants-mobile.png');
  assert.ok(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth));
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '企业成员', exact: true }).click();
  await page.route('**/api/tenant-admin/v1/tenants/*/members?*', (route) => route.abort());
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByRole('heading', { name: '暂时无法读取', exact: true })).toBeVisible();
  await expect(page.locator('.tenant-rows > li')).toHaveCount(0);
  await page.unrouteAll();
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('.tenant-rows > li')).toHaveCount(2);
  const b = await post(
    platform,
    '/api/platform-admin/v1/tenants',
    { requestId: randomUUID(), name: '另一合成企业', adminEmail: 'admin-b3@example.test' },
    201,
  );
  await post(context.request, '/api/v1/auth/invitations/accept', {
    token: await invitation(b.invitation.id),
  });
  await page.reload();
  await page.getByLabel('当前企业').selectOption(b.tenant.id);
  await expect(page.locator('.access-welcome h2')).toHaveText('另一合成企业');
  await expect(page.locator('.tenant-rows > li')).toHaveCount(1);
  await expect(page.locator('.tenant-rows')).not.toContainText('member-b3@example.test');
  await post(
    context.request,
    `/api/tenant-admin/v1/tenants/${b.tenant.id}/members/${memberId}/status`,
    { requestId: randomUUID(), expectedVersion: 2, status: 'DISABLED' },
    404,
  );
  for (const p of [page, member]) {
    const storage = await p.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    assert.ok(!storage.includes('@example.test') && secrets.every((secret) => !storage.includes(secret)));
  }
  assert.deepEqual(errors, []);
  assert.ok(secrets.every((secret) => !logs.includes(secret)));
  await platform.dispose();
  console.log(
    'PASS: M2-B3 real UI/API/PostgreSQL; invitation activation/paging/revoke, last-admin guard, uncertain retry, shared grants/revocation/stale updates, existing-session disable/restore, tenant switch isolation, contracts, failure recovery and desktop/mobile layouts.',
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
