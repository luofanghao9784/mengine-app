/** Real independent realms and shared customer tabs, using an owned disposable supervisor. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, type APIRequestContext } from '@playwright/test';
import { browserType, browserName, browserArtifacts } from './browser-target.ts';

const directory = await mkdtemp(join(tmpdir(), 'dreamcore-admin-realms-'));
const artifacts = browserArtifacts('admin-realms', '.local/admin-realms');
await mkdir(artifacts, { recursive: true });
await rm(join(artifacts, 'result.json'), { force: true });
let supervisor: ChildProcess | undefined;
let browser: Awaited<ReturnType<typeof browserType.launch>> | undefined;
const errors: string[] = [];
async function read(name: string) { return JSON.parse(await readFile(join(directory, name), 'utf8')); }
async function exited(child: ChildProcess) {
  if (child.exitCode !== null) return child.exitCode;
  if (child.signalCode !== null) return -1;
  return new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
}
async function start() {
  supervisor = spawn('python3', ['scripts/local/trial.py', 'start', '--directory', directory], {
    env: { ...process.env, PLATFORM_COOKIE_NAME: 'MUST_NOT_INHERIT', COMPANY_INFORMATION_ENABLED: 'false' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  let launchFailed = false;
  supervisor.once('error', () => { launchFailed = true; });
  for (let n = 0; n < 300; n++) {
    assert.ok(!launchFailed && supervisor.exitCode === null && supervisor.signalCode === null, 'Owned supervisor failed');
    try { const runtime = await read('runtime.json'); if (runtime.state === 'ready') return runtime.webUrl as string; } catch { /* startup */ }
    await delay(200);
  }
  throw Error('Owned supervisor readiness timeout');
}
async function stop() {
  if (!supervisor || supervisor.exitCode !== null || supervisor.signalCode !== null) return;
  const stopper = spawn('python3', ['scripts/local/trial.py', 'stop', '--directory', directory], { stdio: 'ignore' });
  assert.equal(await exited(stopper), 0, 'Owned supervisor stop failed');
  assert.equal(await exited(supervisor), 0, 'Owned supervisor exited abnormally');
}
async function post(api: APIRequestContext, path: string, data: unknown, expected = 200) {
  const realm = path.startsWith('/api/platform-admin/') ? '/api/platform-admin/v1/auth' : '/api/v1/auth';
  const tokenResponse = await api.get(realm + '/csrf');
  assert.equal(tokenResponse.status(), 200);
  const csrf = await tokenResponse.json();
  const response = await api.post(path, { data, headers: { [csrf.headerName]: csrf.token } });
  assert.equal(response.status(), expected, 'Unexpected status for ' + path);
  return expected === 204 ? null : response.json();
}
try {
  let origin = await start();
  const credentials = (await read('accounts.json')).platform;
  assert.equal(credentials.realm, 'platform');
  assert.equal(typeof credentials.loginName, 'string');
  browser = await browserType.launch();
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
  const platform = await context.newPage();
  platform.on('pageerror', e => errors.push(e.name));
  await platform.goto('/platform-admin/');
  await platform.getByLabel('管理账号').fill(credentials.loginName);
  await platform.getByLabel('密码', { exact: true }).fill(credentials.password);
  await platform.getByRole('button', { name: '登录总台', exact: true }).click();
  await expect(platform.getByRole('button', { name: '退出总台', exact: true })).toBeVisible();
  await expect(platform.locator('a[href*="/workspace/"],a[href*="/tenant-admin/"]')).toHaveCount(0);
  const platformMe = await (await context.request.get('/api/platform-admin/v1/auth/me')).json();
  assert.equal(platformMe.memberships.length, 0);
  assert.equal((await context.request.get('/api/v1/me')).status(), 401);
  const cookies = await context.cookies();
  const platformCookie = cookies.find(c => c.name.startsWith('DREAMCORE_PLATFORM_TRIAL_'));
  assert.ok(platformCookie?.httpOnly);
  assert.equal(platformCookie.path, '/api/platform-admin/');
  assert.equal(platformCookie.sameSite, 'Strict');
  assert.ok(!cookies.some(c => c.name === 'MUST_NOT_INHERIT'));
  // Synthetic customer may have the same visible identifier, but must have another identity/password.
  const password = 'synthetic-' + randomUUID();
  const created = await post(context.request, '/api/platform-admin/v1/tenants', {
    requestId: randomUUID(), name: '独立三端验收企业', adminEmail: credentials.loginName, designateAuthorizationOwner: true,
  }, 201);
  const invitation = await read('invitations/' + created.invitation.id + '.json');
  await post(context.request, '/api/v1/auth/invitations/accept', { token: invitation.token, displayName: '合成企业负责人', password });
  await post(context.request, '/api/v1/auth/login', { email: credentials.loginName, password });
  const customerMe = await (await context.request.get('/api/v1/me')).json();
  assert.notEqual(customerMe.account.id, platformMe.account.id);
  await post(context.request, '/api/platform-admin/v1/auth/login', { username: credentials.loginName, password }, 401);
  await post(context.request, '/api/v1/auth/login', { email: credentials.loginName, password: credentials.password }, 401);
  // Failed cross-realm logins must not displace either valid session.
  assert.equal((await context.request.get('/api/v1/me')).status(), 200);
  assert.equal((await context.request.get('/api/platform-admin/v1/auth/me')).status(), 200);
  const client = await context.newPage();
  client.on('pageerror', e => errors.push(e.name));
  const clientPath = '/workspace/#tenant=' + created.tenant.id + '&view=conversations';
  await client.goto(clientPath);
  await expect(client.locator('.access-shell')).toBeVisible();
  const clientUrl = client.url();
  await client.getByRole('button', { name: '个人设置与账号', exact: true }).click();
  const popup = context.waitForEvent('page');
  await client.getByRole('link', { name: '在新标签页打开企业管理端', exact: true }).click();
  const admin = await popup;
  admin.on('pageerror', e => errors.push(e.name));
  await expect(admin.locator('.admin-shell')).toBeVisible();
  await client.keyboard.press('Escape');
  await admin.getByRole('link', { name: '企业信息', exact: true }).click();
  await admin.reload();
  await expect(admin.locator('.admin-shell')).toBeVisible();
  assert.equal(client.url(), clientUrl);
  await expect(client.locator('a[href*="/platform-admin/"]')).toHaveCount(0);
  await expect(admin.locator('a[href*="/platform-admin/"]')).toHaveCount(0);
  const returnPopup = context.waitForEvent('page');
  await admin.getByRole('link', { name: '新标签页打开客户端', exact: true }).click();
  const returned = await returnPopup;
  await expect(returned.locator('.access-shell')).toBeVisible();
  assert.equal(new URL(returned.url()).pathname, '/workspace/');
  await returned.close();
  await client.screenshot({ path: join(artifacts, 'client.png'), fullPage: true });
  await admin.screenshot({ path: join(artifacts, 'tenant.png'), fullPage: true });
  await platform.getByRole('button', { name: '退出总台', exact: true }).click();
  await expect(platform.getByRole('button', { name: '登录总台', exact: true })).toBeVisible();
  assert.equal((await context.request.get('/api/v1/me')).status(), 200);
  await admin.reload();
  await expect(admin.locator('.admin-shell')).toBeVisible();
  await post(context.request, '/api/platform-admin/v1/auth/login', { username: credentials.loginName, password: credentials.password });
  await post(context.request, '/api/v1/auth/logout', null, 204);
  assert.equal((await context.request.get('/api/v1/me')).status(), 401);
  assert.equal((await context.request.get('/api/platform-admin/v1/auth/me')).status(), 200);
  await platform.reload();
  await platform.screenshot({ path: join(artifacts, 'platform.png'), fullPage: true });
  await context.close();
  await stop();
  // Persistent restart must preserve the independent identity, not bootstrap another operator.
  origin = await start();
  const again = await browser.newContext({ baseURL: origin });
  const after = await post(again.request, '/api/platform-admin/v1/auth/login', { username: credentials.loginName, password: credentials.password });
  assert.equal(after.account.id, platformMe.account.id);
  await post(again.request, '/api/v1/auth/login', { email: credentials.loginName, password });
  const customerAfter = await (await again.request.get('/api/v1/me')).json();
  assert.equal(customerAfter.account.id, customerMe.account.id);
  assert.equal(errors.length, 0, 'Browser page errors');
  await again.close();
  await writeFile(join(artifacts, 'result.json'), JSON.stringify({ passed: true, browser: browserName,
    independentCredentials: true, isolatedCookies: true, sharedCustomerTabs: true, separateLogout: true,
    persistentRestart: true, syntheticDataOnly: true, modelMode: 'off' }, null, 2));
  console.log('Independent platform and shared customer realms verified against the real disposable application.');
} finally {
  await browser?.close();
  await stop();
  await rm(directory, { recursive: true, force: true });
}
