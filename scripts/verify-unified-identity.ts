/** Real browser + HTTP + disposable database; local SMS only, no model or external provider. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect, type Page, type APIRequestContext } from '@playwright/test';

const temp = await mkdtemp(join(tmpdir(), 'dreamcore-phone-'));
const artifacts = new URL('../.local/unified-identity/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const children: ChildProcess[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const pageErrors: string[] = [];
const password = '123456';
const fixturePhones = {
  platform: '19900009001',
  owner: '19900009002',
  member: '19900009003',
  legacy: '19900009004',
};
async function port() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
function start(cmd: string, args: string[], env: Record<string, string> = {}) {
  const child = spawn(cmd, args, {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  children.push(child);
  return child;
}
async function exit(child: ChildProcess) {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise<number | null>((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
}
async function ready(url: string, child: ChildProcess) {
  for (let i = 0; i < 150; i++) {
    assert.equal(child.exitCode, null, 'Owned service stopped');
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return;
    } catch {}
    await delay(200);
  }
  throw new Error('Owned service startup timed out');
}
async function post(api: APIRequestContext, path: string, body: unknown, expected = 200) {
  const csrf = await (await api.get('/api/v1/auth/csrf')).json();
  const response = await api.post(path, { data: body, headers: { [csrf.headerName]: csrf.token } });
  assert.equal(response.status(), expected, `Unexpected status for ${path}`);
  return expected === 204 ? null : response.json();
}
async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: fileURLToPath(new URL(name + '.png', artifacts)), fullPage: true });
}
async function localCode(page: Page) {
  await page.getByRole('button', { name: '获取验证码', exact: true }).click();
  await page.getByRole('button', { name: '查看本地测试短信', exact: true }).click();
  const code = await page.locator('.phone-local-note strong').textContent();
  assert.ok(code && /^\d{6}$/.test(code));
  await page.getByLabel('短信验证码', { exact: true }).fill(code);
}
async function login(page: Page, phone: string) {
  await page.getByLabel('手机号', { exact: true }).fill(phone);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('.access-shell')).toBeVisible();
}
async function invitationPath(api: APIRequestContext, id: string) {
  const response = await api.get('/api/platform-admin/v1/local-invitations/' + id);
  assert.equal(response.status(), 200);
  return (await response.json()).path as string;
}
try {
  const token = randomBytes(32).toString('base64url');
  const secret = join(temp, 'activation');
  await writeFile(secret, token, { mode: 0o600 });
  const jar = 'apps/api/target/workspace-api-0.1.0-SNAPSHOT.jar';
  const initialize = () =>
    exit(
      start('java', ['-jar', jar, '--bootstrap-admin'], {
        BOOTSTRAP_PHONE: fixturePhones.platform,
        BOOTSTRAP_ACTIVATION_FILE: secret,
      }),
    );
  assert.equal(await initialize(), 0);
  assert.notEqual(await initialize(), 0, 'Initialization must not be repeated');
  const apiPort = await port();
  const webPort = await port();
  const apiUrl = `http://127.0.0.1:${apiPort}`,
    webUrl = `http://127.0.0.1:${webPort}`;
  const apiEnv = {
    API_HOST: '127.0.0.1',
    API_PORT: String(apiPort),
    PHONE_DELIVERY: 'local',
    PHONE_LOCAL_PREVIEW: 'true',
    PHONE_OUTBOX: join(temp, 'sms'),
    TASK_ENABLED: 'false',
    AGENT_TASK_MODE: 'off',
    KNOWLEDGE_ENABLED: 'false',
  };
  let api = start('java', ['-jar', jar], apiEnv);
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
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/platform-admin/#invite=' + token);
  await page.getByLabel('姓名', { exact: true }).fill('合成统一管理员');
  await page.getByLabel('设置账号密码', { exact: true }).fill(password);
  await localCode(page);
  await page.getByRole('button', { name: '创建账号并接受邀请', exact: true }).click();
  await expect(page.locator('.admin-shell')).toBeVisible();
  const first = await (await page.request.get('/api/v1/me')).json();
  assert.equal(first.platformAdmin, true);
  assert.equal(first.account.phone, '+86' + fixturePhones.platform);
  assert.equal(
    (await page.request.get('/api/platform-admin/v1/auth/credentials').then((r) => r.json())).configured,
    false,
  );
  assert.notEqual(await initialize(), 0, 'Completed initialization remains closed');
  const tenants: string[] = [];
  for (const name of ['合成企业甲', '合成企业乙']) {
    const opening = await post(
      page.request,
      '/api/platform-admin/v1/tenants',
      { requestId: randomUUID(), name, adminPhone: fixturePhones.platform },
      201,
    );
    assert.equal(opening.tenant.status, 'PENDING');
    tenants.push(opening.tenant.id);
    const link = await invitationPath(page.request, opening.invitation.id);
    await page.goto(link);
    await expect(page.getByRole('button', { name: '接受并开通企业', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await page.getByRole('button', { name: '接受并开通企业', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('/tenant-admin/.*' + opening.tenant.id));
    await expect(page.locator('.admin-shell')).toBeVisible();
    const owner = await (
      await page.request.get('/api/v1/tenants/' + opening.tenant.id + '/governance')
    ).json();
    assert.equal(owner.owner, true);
  }
  const me = await (await page.request.get('/api/v1/me')).json();
  assert.equal(me.account.id, first.account.id);
  assert.equal(me.memberships.length, 2);
  await post(page.request, '/api/v1/auth/logout', null, 204);
  await page.goto('/workspace/');
  await page.getByLabel('手机号', { exact: true }).fill(fixturePhones.platform);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '选择进入哪一端' })).toBeVisible();
  for (const name of ['总台端', '企业管理端', '客户端'])
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await screenshot(page, 'surface-choice');
  await page.getByRole('button', { name: '客户端', exact: true }).click();
  await expect(page.getByRole('heading', { name: '选择企业', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '合成企业甲', exact: true }).click();
  await expect(page.getByRole('link', { name: '梦擎工作空间', exact: true })).toHaveAttribute(
    'href',
    new RegExp(tenants[0]),
  );
  const second = await context.newPage();
  await second.goto('/workspace/');
  await expect(second.getByRole('link', { name: '梦擎工作空间', exact: true })).toHaveAttribute(
    'href',
    new RegExp(tenants[0]),
  );
  await second.getByRole('button', { name: '个人设置与账号', exact: true }).click();
  await second.getByRole('button', { name: '当前企业 合成企业甲', exact: true }).click();
  await second.getByRole('button', { name: '合成企业乙', exact: true }).click();
  await expect(second.getByRole('link', { name: '梦擎工作空间', exact: true })).toHaveAttribute(
    'href',
    new RegExp(tenants[1]),
  );
  await page.bringToFront();
  await expect(page.getByRole('link', { name: '梦擎工作空间', exact: true })).toHaveAttribute(
    'href',
    new RegExp(tenants[0]),
  );
  const third = await context.newPage();
  await third.goto('/workspace/');
  await expect(third.getByRole('link', { name: '梦擎工作空间', exact: true })).toHaveAttribute(
    'href',
    new RegExp(tenants[1]),
  );
  const admin = await context.newPage();
  await admin.goto('/tenant-admin/#tenant=' + tenants[0]);
  await expect(admin.locator('.admin-shell')).toBeVisible();
  await admin.getByLabel('切换企业', { exact: true }).selectOption(tenants[1]);
  await expect(admin).toHaveURL(new RegExp(tenants[1]));
  await admin.getByRole('link', { name: '客户端', exact: true }).click();
  await expect(admin).toHaveURL(new RegExp('/workspace/.*' + tenants[1]));
  await expect(admin.locator('.access-shell')).toBeVisible();
  api.kill('SIGTERM');
  await exit(api);
  api = start('java', ['-jar', jar], apiEnv);
  await ready(apiUrl + '/actuator/health', api);
  assert.equal((await (await page.request.get('/api/v1/me')).json()).account.id, first.account.id);
  await post(
    page.request,
    '/api/platform-admin/v1/auth/credentials',
    { username: 'synthetic-operator', currentPassword: password, password: 'dedicated-password' },
    204,
  );
  assert.equal((await page.request.get('/api/v1/me')).status(), 401);
  await page.goto('/platform-admin/');
  await page.getByLabel('管理账号', { exact: true }).fill('synthetic-operator');
  await page.getByLabel('密码', { exact: true }).fill('dedicated-password');
  await page.getByRole('button', { name: '登录总台', exact: true }).click();
  await expect(page.locator('.admin-shell')).toBeVisible();
  assert.equal((await (await page.request.get('/api/v1/me')).json()).account.id, first.account.id);
  await screenshot(page, 'unified-platform');
  await page.getByRole('button', { name: '退出总台', exact: true }).click();
  await expect(third.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  assert.equal((await context.request.get('/api/platform-admin/v1/auth/me')).status(), 401);
  assert.deepEqual(pageErrors, []);
  await writeFile(
    new URL('result.json', artifacts),
    JSON.stringify(
      {
        passed: true,
        synthetic: true,
        checks: [
          'one-time initialization',
          'verified phone activation',
          'mandatory initial owner',
          'same principal across three surfaces',
          'per-surface remembered enterprise',
          'independent tabs',
          'same-enterprise navigation',
          'optional dedicated credentials',
          'global logout',
          'session identity survives service restart',
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: real browser, HTTP and PostgreSQL unified identity journey; local synthetic verification only.',
  );
} catch (error) {
  if (browser) {
    const pages = browser.contexts().flatMap((c) => c.pages());
    const last = pages.at(-1);
    if (last) await screenshot(last, 'failure').catch(() => {});
  }
  if (pageErrors.length) console.error('Browser errors:', pageErrors);
  throw error;
} finally {
  await browser?.close();
  for (const child of children.reverse()) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    child.kill('SIGTERM');
    for (let i = 0; i < 50 && child.exitCode === null && child.signalCode === null; i++) await delay(100);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exit(child);
    }
  }
  await rm(temp, { recursive: true, force: true });
}
