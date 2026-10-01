import { verifyClientAll } from './client-all-journey.ts';
import { verifyClientB1 } from './client-b1-journey.ts';
/** Real browser + HTTP + disposable database; local SMS only, no model or external provider. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect, type Page, type APIRequestContext } from '@playwright/test';

const legacyMode = process.argv.includes('--legacy-login');
const temp = await mkdtemp(join(tmpdir(), 'dreamcore-phone-'));
const artifacts = new URL('../.local/phone-flow/', import.meta.url);
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
  const response = await api.get('/api/v1/auth/phone/local-invitation/' + id);
  assert.equal(response.status(), 200);
  return (await response.json()).path as string;
}
try {
  const secret = join(temp, 'bootstrap');
  await writeFile(secret, password, { mode: 0o600 });
  const jar = 'apps/api/target/workspace-api-0.1.0-SNAPSHOT.jar';
  assert.equal(
    await exit(
      start('java', ['-jar', jar, '--bootstrap-admin'], {
        BOOTSTRAP_EMAIL: 'phone-platform@example.test',
        BOOTSTRAP_PASSWORD_FILE: secret,
      }),
    ),
    0,
  );
  const apiPort = await port();
  let webPort = await port();
  while (webPort === apiPort) webPort = await port();
  const apiUrl = `http://127.0.0.1:${apiPort}`,
    webUrl = `http://127.0.0.1:${webPort}`;
  const api = start('java', ['-jar', jar], {
    API_HOST: '127.0.0.1',
    API_PORT: String(apiPort),
    PHONE_DELIVERY: legacyMode ? 'disabled' : 'local',
    PHONE_LOCAL_PREVIEW: legacyMode ? 'false' : 'true',
    PHONE_OUTBOX: join(temp, 'sms'),
    TASK_ENABLED: process.argv.includes('--client-all') ? 'true' : 'false',
    AGENT_TASK_MODE: 'off',
    DREAMCORE_TASKS_INITIAL_DELAY_MS: '3600000',
    KNOWLEDGE_ENABLED: 'false',
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
  async function page(width = 1366) {
    const context = await browser!.newContext({ baseURL: webUrl, viewport: { width, height: 900 } });
    const p = await context.newPage();
    p.on('pageerror', (e) => pageErrors.push(e.name + ': ' + e.message));
    return p;
  }
  const platform = await page();
  await platform.goto('/platform-admin/');
  await screenshot(platform, 'login-desktop');
  if (legacyMode) {
    await expect(
      platform.getByText('短信验证暂未启用，原账号可继续使用邮箱和密码登录。手机号绑定将在短信开通后完成。'),
    ).toBeVisible();
    await platform.getByRole('button', { name: '原邮箱账号登录', exact: true }).click();
    await platform.getByLabel('原账号邮箱', { exact: true }).fill('phone-platform@example.test');
    await platform.getByLabel('密码', { exact: true }).fill(password);
    await platform.getByRole('button', { name: '登录原账号', exact: true }).click();
    await expect(platform.locator('.access-shell')).toBeVisible();
    const original = await (await platform.request.get('/api/v1/me')).json();
    assert.equal(original.account.phone, null);
    await platform.reload();
    await expect(platform.locator('.access-shell')).toBeVisible();
    const current = await (await platform.request.get('/api/v1/me')).json();
    assert.equal(current.account.id, original.account.id);
    assert.equal(current.account.phone, null);
    await post(
      platform.request,
      '/api/v1/auth/phone/challenges',
      { purpose: 'BIND', phone: '19900009009' },
      503,
    );
    const config = await (await platform.request.get('/api/v1/auth/phone/configuration')).json();
    assert.equal(config.delivery, 'DISABLED');
    assert.equal(config.localPreview, false);
    await screenshot(platform, 'legacy-compatible-login');
    assert.deepEqual(pageErrors, []);
    console.log('Legacy login survives refresh with unchanged account, no phone and SMS disabled.');
  } else {
    await platform.getByRole('button', { name: '原邮箱账号迁移' }).click();
    await platform.getByLabel('原账号邮箱', { exact: true }).fill('phone-platform@example.test');
    await platform.getByLabel('密码', { exact: true }).fill(password);
    await platform.getByRole('button', { name: '验证原账号', exact: true }).click();
    await expect(platform.getByRole('heading', { name: '绑定手机号', exact: true })).toBeVisible();
    await platform.getByLabel('手机号', { exact: true }).fill(fixturePhones.platform);
    await localCode(platform);
    const platformCodeSent = Date.now();
    await platform.getByLabel('原账号密码', { exact: true }).fill(password);
    await platform.getByRole('button', { name: '绑定并继续' }).click();
    await expect(platform.locator('.access-shell')).toBeVisible();
    // Create and nominate the first administrator using only a phone number.
    await platform.getByRole('button', { name: '开通企业', exact: true }).click();
    await platform.getByLabel('企业名称', { exact: true }).fill('合成手机号体验企业');
    await platform.getByLabel('初始管理员手机号', { exact: true }).fill(fixturePhones.owner);
    await platform.getByLabel('明确指定此初始管理员为企业授权负责人候选人').check();
    const createdResponse = platform.waitForResponse(
      (r) => r.url().endsWith('/api/platform-admin/v1/tenants') && r.request().method() === 'POST',
    );
    await platform.getByRole('button', { name: '确认开通', exact: true }).click();
    const created = await (await createdResponse).json();
    assert.ok(created.tenant.id);
    await platform.getByRole('button', { name: '查看本地邀请链接', exact: true }).click();
    const path = await platform.getByLabel('本地邀请链接', { exact: true }).inputValue();
    const owner = await page();
    await owner.goto(path);
    await expect(owner.getByRole('heading', { name: '加入合成手机号体验企业', exact: true })).toBeVisible();
    assert.equal(owner.url().endsWith('#invite'), true);
    await owner.reload();
    await expect(owner.getByRole('heading', { name: '加入合成手机号体验企业', exact: true })).toBeVisible();
    await screenshot(owner, 'join-desktop');
    await owner.getByLabel('你的姓名', { exact: true }).fill('合成负责人');
    await localCode(owner);
    await owner.getByLabel('设置密码', { exact: true }).fill(password);
    await owner.getByLabel(/我接受企业授权负责人职责/).check();
    await owner.getByRole('button', { name: '加入并开始使用', exact: true }).click();
    await expect(owner.locator('.access-shell')).toBeVisible();
    await expect(owner.getByRole('heading', { name: '智能画报', exact: true })).toBeVisible();
    assert.ok((await owner.request.get('/api/v1/me')).ok());
    await owner.goto(`/tenant-admin/#tenant=${created.tenant.id}`);
    await owner.getByRole('button', { name: '邀请成员', exact: true }).click();
    await owner.getByLabel('受邀手机号', { exact: true }).fill(fixturePhones.member);
    const inviteResponse = owner.waitForResponse(
      (r) => r.url().endsWith('/invitations') && r.request().method() === 'POST',
    );
    await owner.getByRole('button', { name: '生成邀请', exact: true }).click();
    const invited = await (await inviteResponse).json();
    const link = await invitationPath(owner.request, invited.id);
    const member = await page(390);
    await member.goto(link);
    await expect(member.getByLabel('你的姓名', { exact: true })).toBeVisible();
    await screenshot(member, 'join-mobile');
    await member.getByLabel('你的姓名', { exact: true }).fill('合成员工');
    await localCode(member);
    await member.getByLabel('设置密码', { exact: true }).fill(password);
    // The server succeeds but the first client response is lost; retry must not create another account.
    let lost = false;
    await member.route('**/api/v1/auth/phone/accept', async (route) => {
      if (!lost) {
        lost = true;
        await route.fetch();
        await route.abort('failed');
      } else await route.continue();
    });
    await member.getByRole('button', { name: '加入并开始使用', exact: true }).click();
    await expect(member.getByRole('alert')).toContainText('操作结果尚未确认');
    await member.getByRole('button', { name: '加入并开始使用', exact: true }).click();
    await expect(member.locator('.access-shell')).toBeVisible();
    await member.unroute('**/api/v1/auth/phone/accept');
    await screenshot(member, 'joined-mobile');
    // Deep-link login returns to the requested library instead of the homepage.
    const other = await page();
    await other.goto(`/workspace/#tenant=${created.tenant.id}&view=library`);
    await login(other, fixturePhones.member);
    assert.ok(other.url().includes('view=library'));
    await expect(other.getByRole('heading', { name: '资料库', exact: true })).toBeVisible();
    // Same account joining a second enterprise: password only, no extra code or new account.
    const second = await post(
      platform.request,
      '/api/platform-admin/v1/tenants',
      { requestId: randomUUID(), name: '合成第二企业', adminPhone: fixturePhones.member },
      201,
    );
    const secondPath = await invitationPath(platform.request, second.invitation.id);
    const existing = await page();
    await existing.goto(secondPath);
    await expect(existing.getByRole('button', { name: '登录并加入', exact: true })).toBeVisible();
    await expect(existing.getByLabel('短信验证码', { exact: true })).toHaveCount(0);
    await existing.getByLabel('密码', { exact: true }).fill(password);
    await existing.getByRole('button', { name: '登录并加入', exact: true }).click();
    await expect(existing.locator('.access-shell')).toBeVisible();
    const identity = await (await existing.request.get('/api/v1/me')).json();
    assert.equal(identity.memberships.length, 2);
    await existing.goto('/workspace/');
    await expect(existing.getByLabel('当前企业')).toHaveValue(second.tenant.id);
    if (process.argv.includes('--client-b1') || process.argv.includes('--client-all'))
      await verifyClientB1(owner, existing, created.tenant.id, second.tenant.id);
    if (process.argv.includes('--client-all')) await verifyClientAll(owner, existing, created.tenant.id);
    // Wrong signed-in account can switch while preserving a refreshed invitation intent.
    const wrong = await page();
    await wrong.goto('/workspace/');
    await login(wrong, fixturePhones.owner);
    await wrong.goto(secondPath);
    await expect(wrong.getByRole('button', { name: '切换到受邀账号' })).toBeVisible();
    await wrong.reload();
    await wrong.getByRole('button', { name: '切换到受邀账号' }).click();
    await expect(wrong.getByRole('button', { name: '登录并加入', exact: true })).toBeVisible();
    // Password reset uses local test delivery, then returns to normal login.
    const recovery = await page(390);
    await recovery.goto('/workspace/');
    await recovery.getByRole('button', { name: '忘记密码', exact: true }).click();
    await recovery.getByLabel('手机号', { exact: true }).fill(fixturePhones.platform);
    await delay(Math.max(0, 61_000 - (Date.now() - platformCodeSent)));
    await localCode(recovery);
    await recovery.getByLabel('设置密码', { exact: true }).fill('654321');
    await recovery.getByRole('button', { name: '重置密码', exact: true }).click();
    await expect(recovery.getByText('密码已更新，请使用手机号和新密码登录。')).toBeVisible();
    assert.equal((await platform.request.get('/api/v1/me')).status(), 401);
    await recovery.getByLabel('手机号', { exact: true }).fill(fixturePhones.platform);
    await recovery.getByLabel('密码', { exact: true }).fill('654321');
    await recovery.getByRole('button', { name: '登录', exact: true }).click();
    await expect(recovery.locator('.access-shell')).toBeVisible();
    await screenshot(recovery, 'recovery-mobile');
    assert.equal(await member.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(pageErrors, []);
    await writeFile(
      new URL('result.json', artifacts),
      JSON.stringify(
        {
          status: 'passed',
          sms: 'LOCAL_ONLY',
          realSmsSent: false,
          modelCalls: false,
          journeys: [
            'legacy binding',
            'phone tenant creation',
            'invitation refresh',
            'new account auto login',
            'responsibility acceptance',
            'phone member invitation',
            'lost response retry',
            'deep link login',
            'existing account joins second tenant',
            'remembered enterprise',
            'wrong account switch',
            'password recovery and session revocation',
          ],
          screenshots: 5,
        },
        null,
        2,
      ),
    );
    console.log('Phone onboarding browser journeys passed. Only synthetic data and local SMS were used.');
  }
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
