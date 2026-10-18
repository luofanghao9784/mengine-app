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

assert.match(process.env.DATABASE_URL || '', /^jdbc:postgresql:\/\/127\.0\.0\.1:\d+\/dreamcore_test$/);
assert.equal(process.env.DATABASE_USER, 'dreamcore_test');
assert.equal(process.env.SPRING_PROFILES_ACTIVE, 'local');
const temp = await mkdtemp(join(tmpdir(), 'dreamcore-phone-'));
const artifacts = new URL('../.local/onboarding-stage2/', import.meta.url);
await mkdir(artifacts, { recursive: true });
await rm(new URL('result.json', artifacts), { force: true });
const children: ChildProcess[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const pageErrors: string[] = [];
const password = '123456';
const fixturePhones = {
  platform: '19900009001',
  owner: '19900009002',
  member: '19900009003',
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
  const csrf = await (
    await api.get(
      path.startsWith('/api/platform-admin/') ? '/api/platform-admin/v1/auth/csrf' : '/api/v1/auth/csrf',
    )
  ).json();
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

  assert.equal((await page.request.get('/api/v1/me')).status(), 401);
  assert.equal((await page.request.get('/api/platform-admin/v1/auth/me')).status(), 200);
  await page.goto('/platform-admin/#admin=tenants');
  await page.getByRole('button', { name: '开通企业', exact: true }).click();
  await page.getByLabel('企业名称', { exact: true }).fill('合成二阶段企业');
  await page.getByLabel('初始负责人手机号', { exact: true }).fill(fixturePhones.owner);
  const openingResponse = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/api/platform-admin/v1/tenants'),
  );
  await page.getByRole('button', { name: '开通并邀请负责人', exact: true }).click();
  const response = await openingResponse;
  assert.equal(response.status(), 201);
  const opening = await response.json();
  const tenant = opening.tenant.id;
  assert.equal(opening.tenant.status, 'PENDING');
  const openingBody = response.request().postDataJSON();
  const replay = await post(page.request, '/api/platform-admin/v1/tenants', openingBody, 201);
  assert.equal(replay.tenant.id, tenant, 'Opening retry must not create another enterprise');

  const ownerContext = await browser.newContext({ baseURL: webUrl });
  const owner = await ownerContext.newPage();
  owner.on('pageerror', (e) => pageErrors.push(e.message));
  await owner.goto(await invitationPath(page.request, opening.invitation.id));
  await owner.getByLabel('你的姓名', { exact: true }).fill('合成负责人');
  await owner.getByLabel('设置密码', { exact: true }).fill(password);
  await localCode(owner);
  await owner.getByRole('button', { name: '接受并开通企业', exact: true }).click();
  await expect(owner).toHaveURL(new RegExp('/tenant-admin/.*' + tenant));
  await owner.getByRole('link', { name: '全部管理功能', exact: true }).click();
  await expect(owner.locator('.admin-shell')).toBeVisible();
  const ownerIdentity = await (await owner.request.get('/api/v1/me')).json();
  const governance = await (await owner.request.get('/api/v1/tenants/' + tenant + '/governance')).json();
  assert.equal(governance.owner, true);
  assert.equal(governance.ownerId, ownerIdentity.account.id);
  const activated = await (await page.request.get('/api/platform-admin/v1/tenants/' + tenant)).json();
  assert.equal(activated.tenant.status, 'ACTIVE');
  const manage = '/api/tenant-admin/v1/tenants/' + tenant;
  const base = '/api/v1/tenants/' + tenant;
  const allowed = await post(
    owner.request,
    manage + '/workspaces',
    {
      requestId: randomUUID(),
      name: '已确认范围空间',
      ownerId: ownerIdentity.account.id,
      description: '合成授权样例',
    },
    201,
  );
  const denied = await post(
    owner.request,
    manage + '/workspaces',
    {
      requestId: randomUUID(),
      name: '未授权空间',
      ownerId: ownerIdentity.account.id,
      description: '合成权限边界',
    },
    201,
  );
  await owner.goto('/tenant-admin/?view=business#tenant=' + tenant + '&admin=members');
  await owner.getByRole('button', { name: '邀请成员', exact: true }).click();
  await owner.getByLabel('受邀手机号', { exact: true }).fill(fixturePhones.member);
  await expect(owner.getByText(/授权范围尚未确认时/)).toBeVisible();
  const inviteResponse = owner.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith(manage + '/invitations'),
  );
  await owner.getByRole('button', { name: '生成邀请', exact: true }).click();
  const invited = await inviteResponse;
  assert.equal(invited.status(), 201);
  assert.deepEqual(invited.request().postDataJSON().workspaceIds, []);
  const invitation = await invited.json();
  const link = await (
    await owner.request.get(manage + '/invitations/' + invitation.id + '/local-link')
  ).json();
  const memberContext = await browser.newContext({ baseURL: webUrl });
  const member = await memberContext.newPage();
  member.on('pageerror', (e) => pageErrors.push(e.message));
  await member.goto(link.path);
  await member.getByLabel('你的姓名', { exact: true }).fill('合成员工');
  await member.getByLabel('设置密码', { exact: true }).fill(password);
  await localCode(member);
  const joinedResponse = member.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/api/v1/auth/phone/accept'),
  );
  await member.getByRole('button', { name: '加入并开始使用', exact: true }).click();
  assert.equal((await joinedResponse).status(), 200);
  const memberId = (await (await member.request.get('/api/v1/me')).json()).account.id;
  async function visibleSpaces() {
    const response = await member.request.get(base + '/context');
    assert.equal(response.status(), 200);
    return (await response.json()).workspaces as { id: string; kind: string }[];
  }
  assert.equal((await visibleSpaces()).length, 1, 'Joining without scope must only expose personal space');
  assert.equal((await member.request.get(manage + '/members')).status(), 403);
  assert.equal((await member.request.get('/api/platform-admin/v1/tenants')).status(), 401);
  const library = (id: string) => base + '/workspaces/' + id + '/library';
  assert.equal((await member.request.get(library(allowed.id))).status(), 404);
  assert.equal((await member.request.get(library(denied.id))).status(), 404);
  // Business authorization is confirmed outside the system; now configure only that scope.
  await owner.getByRole('link', { name: '共享空间', exact: true }).click();
  await owner.getByRole('button', { name: '管理空间 已确认范围空间', exact: true }).click();
  await owner.getByRole('button', { name: '添加成员', exact: true }).click();
  await owner
    .locator('li')
    .filter({ hasText: '合成员工' })
    .getByRole('button', { name: '选择', exact: true })
    .click();
  await owner.getByRole('button', { name: '确认添加', exact: true }).click();
  await expect.poll(async () => (await visibleSpaces()).some((s) => s.id === allowed.id)).toBe(true);
  assert.equal((await member.request.get(library(allowed.id))).status(), 200);
  assert.equal((await member.request.get(library(denied.id))).status(), 404);
  assert.equal((await member.request.get('/api/v1/tenants/' + randomUUID() + '/context')).status(), 403);
  const space = await (await owner.request.get(manage + '/workspaces/' + allowed.id)).json();
  const grants = await (await owner.request.get(manage + '/workspaces/' + allowed.id + '/members')).json();
  assert.equal(grants.find((v: { accountId: string }) => v.accountId === memberId).canMaintain, false);
  await screenshot(owner, 'authorized-space');
  await post(owner.request, manage + '/workspaces/' + allowed.id + '/members/' + memberId, {
    requestId: randomUUID(),
    expectedVersion: space.version,
    enabled: false,
  });
  assert.equal((await member.request.get(library(allowed.id))).status(), 404);
  await post(member.request, '/api/v1/auth/phone/accept', {
    token: new URLSearchParams(link.path.split('#')[1]).get('invite'),
    requestId: randomUUID(),
    acceptResponsibility: false,
  });
  assert.equal((await visibleSpaces()).length, 1, 'Replaying acceptance must not restore revoked access');
  assert.equal((await member.request.get(library(allowed.id))).status(), 404);
  assert.deepEqual(pageErrors, []);
  await writeFile(
    new URL('result.json', artifacts),
    JSON.stringify(
      {
        passed: true,
        synthetic: true,
        realSms: false,
        checks: [
          'platform UI opening and idempotency',
          'new owner local-code acceptance and management redirect',
          'enterprise activation and ownership',
          'new employee UI invitation and local-code acceptance',
          'no automatic business-space access',
          'confirmed scope UI grant',
          'read-only grant',
          'unapproved space and foreign enterprise denied',
          'immediate revoke and acceptance replay safety',
          'independent platform/customer sessions',
        ],
      },
      null,
      2,
    ),
  );
  console.log('PASS: stage 2 real browser + API + disposable PostgreSQL, local simulated codes only.');
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
