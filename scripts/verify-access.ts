/** Built browser entries against the real M2-A1 API and a disposable PostgreSQL cluster. */
import assert from 'node:assert/strict';
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
const temp = await mkdtemp(join(tmpdir(), 'dreamcore-b1-'));
const artifacts = new URL('../.local/m2-b1/', import.meta.url);
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
  await expect(page.getByRole('heading', { name: '登录梦擎工作空间', exact: true })).toBeVisible();
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
        BOOTSTRAP_EMAIL: 'platform-b1@example.test',
        BOOTSTRAP_PASSWORD_FILE: secretFile,
      }),
    ),
    0,
  );
  const apiPort = await port();
  let webPort = await port();
  while (webPort === apiPort) webPort = await port();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  const apiProcess = start('java', ['-jar', 'apps/api/target/workspace-api-0.1.0-SNAPSHOT.jar'], {
    API_HOST: '127.0.0.1',
    API_PORT: String(apiPort),
  });
  await ready(apiUrl + '/actuator/health', apiProcess);
  const webProcess = start(
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
  await ready(webUrl, webProcess);
  const platform = await request.newContext({ baseURL: apiUrl });
  await post(platform, '/api/v1/auth/login', { email: 'platform-b1@example.test', password });
  const a = await post(
    platform,
    '/api/platform-admin/v1/tenants',
    { requestId: randomUUID(), name: '合成企业 A', adminEmail: 'admin-a-b1@example.test' },
    201,
  );
  const b = await post(
    platform,
    '/api/platform-admin/v1/tenants',
    { requestId: randomUUID(), name: '合成企业 B', adminEmail: 'admin-b-b1@example.test' },
    201,
  );
  browser = await chromium.launch();
  const adminContext = await browser.newContext({ baseURL: webUrl, viewport: { width: 1440, height: 1000 } });
  const admin = await adminContext.newPage();
  const errors: string[] = [];
  admin.on('pageerror', (error) => errors.push(error.name));
  await admin.goto('/tenant-admin/');
  await expect(admin.getByRole('heading', { name: '登录梦擎工作空间' })).toBeVisible();
  await screenshot(admin, 'login-desktop.png');
  await admin.getByLabel('邮箱', { exact: true }).fill('unknown-b1@example.test');
  await admin.getByLabel('密码', { exact: true }).fill('wrong-password');
  await admin.getByRole('button', { name: '登录', exact: true }).click();
  await expect(admin.getByRole('alert')).toContainText('邮箱或密码不正确');
  const tokenA = await invitation(a.invitation.id);
  await admin.goto('/tenant-admin/#invite=' + tokenA);
  await expect
    .poll(async () => (await admin.getByLabel('邀请码', { exact: true }).inputValue()) === tokenA)
    .toBe(true);
  assert.ok(!admin.url().includes(tokenA), 'Invitation secret remained in URL');
  await activate(admin, '合成管理员 A');
  await login(admin, 'admin-a-b1@example.test');
  await expect(admin.locator('.access-welcome h2')).toHaveText('合成企业 A');
  await expect(admin.getByRole('link', { name: '系统管理', exact: true })).toHaveCount(0);
  await admin.reload();
  await expect(admin.locator('.access-welcome h2')).toHaveText('合成企业 A');
  await screenshot(admin, 'tenant-admin-desktop.png');
  await admin.setViewportSize({ width: 390, height: 844 });
  assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await screenshot(admin, 'tenant-admin-mobile.png');
  await admin.setViewportSize({ width: 1440, height: 1000 });
  await admin.getByRole('link', { name: '工作台', exact: true }).click();
  await expect(admin.locator('.access-spaces li')).toHaveCount(1);
  await expect(admin.locator('.access-spaces')).toContainText('个人空间');
  await admin.goBack();
  await expect(admin.locator('.access-welcome h2')).toHaveText('合成企业 A');
  await admin.goto('/platform-admin/');
  await expect(admin.getByRole('heading', { name: '没有访问权限' })).toBeVisible();
  assert.equal((await adminContext.request.get(webUrl + '/api/platform-admin/v1/tenants')).status(), 403);
  await admin.goto('/tenant-admin/#tenant=' + b.tenant.id);
  await expect(admin.getByRole('heading', { name: '没有访问权限' })).toBeVisible();
  assert.equal(
    (
      await adminContext.request.get(webUrl + `/api/tenant-admin/v1/tenants/${b.tenant.id}/invitations`)
    ).status(),
    403,
  );

  const adminApi = await request.newContext({ baseURL: apiUrl });
  await post(adminApi, '/api/v1/auth/login', { email: 'admin-a-b1@example.test', password });
  const invite = await post(
    adminApi,
    `/api/tenant-admin/v1/tenants/${a.tenant.id}/invitations`,
    { requestId: randomUUID(), email: 'member-b1@example.test' },
    201,
  );
  const memberContext = await browser.newContext({
    baseURL: webUrl,
    viewport: { width: 1440, height: 1000 },
  });
  const member = await memberContext.newPage();
  member.on('pageerror', (error) => errors.push(error.name));
  const memberToken = await invitation(invite.id);
  await member.goto('/workspace/#invite=' + memberToken);
  await activate(member, '合成员工');
  await login(member, 'member-b1@example.test');
  await expect(member.locator('.access-welcome h2')).toHaveText('合成企业 A');
  await expect(member.locator('.access-sidebar nav a')).toHaveCount(3);
  await member.getByRole('button', { name: '更多工作与管理', exact: true }).click();
  await expect(member.getByRole('link', { name: '资料库', exact: true })).toBeVisible();
  await expect(member.getByRole('link', { name: '企业管理', exact: true })).toHaveCount(0);
  await expect(member.getByRole('link', { name: '系统管理', exact: true })).toHaveCount(0);
  await member.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await screenshot(member, 'workspace-desktop.png');
  await member.goto('/tenant-admin/');
  await expect(member.getByRole('heading', { name: '没有访问权限' })).toBeVisible();
  assert.equal(
    (
      await memberContext.request.get(webUrl + `/api/tenant-admin/v1/tenants/${a.tenant.id}/invitations`)
    ).status(),
    403,
  );
  await member.goto('/workspace/');

  const adminB = await request.newContext({ baseURL: apiUrl });
  await post(adminB, '/api/v1/auth/invitations/accept', {
    token: await invitation(b.invitation.id),
    displayName: '合成管理员 B',
    password,
  });
  await post(adminB, '/api/v1/auth/login', { email: 'admin-b-b1@example.test', password });
  const secondInvite = await post(
    adminB,
    `/api/tenant-admin/v1/tenants/${b.tenant.id}/invitations`,
    { requestId: randomUUID(), email: 'member-b1@example.test' },
    201,
  );
  const secondToken = await invitation(secondInvite.id);
  await member.getByRole('button', { name: '账号与退出' }).click();
  await member.getByRole('button', { name: '接受另一企业邀请' }).click();
  await member.getByLabel('邀请码', { exact: true }).fill(secondToken);
  await expect(member.getByLabel('设置密码', { exact: true })).toHaveCount(0);
  await member.getByRole('button', { name: '确认加入企业' }).click();
  await expect(member.getByLabel('当前企业').locator('option')).toHaveCount(2);
  await member.getByLabel('当前企业').selectOption(b.tenant.id);
  await expect(member.locator('.access-welcome h2')).toHaveText('合成企业 B');

  let release!: () => void;
  let started!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  await member.route(`**/api/v1/tenants/${a.tenant.id}/context`, async (route) => {
    const response = await route.fetch();
    started();
    await held;
    await route.fulfill({ response }).catch(() => {});
  });
  await member.getByLabel('当前企业').selectOption(a.tenant.id);
  await Promise.race([
    pending,
    delay(5000).then(() => {
      throw new Error('Delayed tenant request did not start');
    }),
  ]);
  await member.getByLabel('当前企业').selectOption(b.tenant.id);
  await expect(member.locator('.access-welcome h2')).toHaveText('合成企业 B');
  release();
  await delay(150);
  await expect(member.locator('.access-welcome h2')).toHaveText('合成企业 B');
  await member.unrouteAll();
  await member.reload();
  await expect(member.locator('.access-welcome h2')).toHaveText('合成企业 B');
  await member.setViewportSize({ width: 390, height: 844 });
  assert.ok(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await screenshot(member, 'workspace-mobile.png');
  await member.getByRole('button', { name: '账号与退出' }).click();
  await expect(member.getByRole('dialog')).toBeVisible();
  await member.keyboard.press('Escape');
  await expect(member.getByRole('dialog')).toHaveCount(0);

  // Network failure must hide stale identity and never mount the Demo application.
  await member.route('**/api/v1/me', (route) => route.abort());
  await member.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(member.getByRole('heading', { name: '暂时无法连接服务' })).toBeVisible();
  await expect(member.locator('.access-shell,.briefing-grid')).toHaveCount(0);
  await member.unrouteAll();
  await member.getByRole('button', { name: '重新连接' }).click();
  await expect(member.locator('.access-welcome h2')).toHaveText('合成企业 B');
  const peer = await memberContext.newPage();
  await peer.goto('/workspace/');
  await expect(peer.locator('.access-shell')).toBeVisible();
  await member.getByRole('button', { name: '账号与退出' }).click();
  await member.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(member.getByRole('heading', { name: '登录梦擎工作空间' })).toBeVisible();
  await expect(peer.getByRole('heading', { name: '登录梦擎工作空间' })).toBeVisible();
  await screenshot(member, 'login-mobile.png');
  await login(member, 'member-b1@example.test');
  await memberContext.clearCookies();
  await member.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(member.getByRole('heading', { name: '登录梦擎工作空间' })).toBeVisible();

  const platformContext = await browser.newContext({
    baseURL: webUrl,
    viewport: { width: 1440, height: 1000 },
  });
  const platformPage = await platformContext.newPage();
  await platformPage.goto('/platform-admin/');
  await login(platformPage, 'platform-b1@example.test');
  await expect(platformPage.getByRole('heading', { name: '企业', exact: true })).toBeVisible();
  await expect(platformPage.getByRole('link', { name: '企业管理', exact: true })).toHaveCount(0);
  await screenshot(platformPage, 'platform-admin-desktop.png');
  await platformPage.setViewportSize({ width: 390, height: 844 });
  assert.ok(await platformPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await screenshot(platformPage, 'platform-admin-mobile.png');
  await platformPage.goto('/workspace/');
  await expect(platformPage.getByRole('heading', { name: '尚未加入企业' })).toBeVisible();
  assert.equal(
    (await platformContext.request.get(webUrl + `/api/v1/tenants/${a.tenant.id}/context`)).status(),
    403,
  );
  for (const page of [admin, member, platformPage]) {
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    assert.ok(
      !storage.includes('@example.test') && secrets.every((secret) => !storage.includes(secret)),
      'Sensitive identity data persisted in browser storage',
    );
  }
  assert.deepEqual(errors, [], 'Uncaught browser errors');
  assert.ok(
    secrets.every((secret) => !logs.includes(secret)),
    'Secret appeared in service logs',
  );
  await platform.dispose();
  await adminApi.dispose();
  await adminB.dispose();
  console.log(
    'PASS: built three-entry UI + real identity API; invitation/login, role and tenant denial, reload, late-response isolation, network failure, multi-tab logout, session expiry, mobile layout and secret handling.',
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
