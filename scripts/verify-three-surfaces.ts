import { browserName, browserType, browserArtifacts } from './browser-target.ts';
/** Full UI journey against the same persistent, owned trial supervisor users run locally. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, type BrowserContext, type Page, type APIRequestContext } from '@playwright/test';
const workspace = fileURLToPath(new URL('../', import.meta.url));
const retain = process.argv.includes('--retain');
const backup = process.argv.includes('--backup');
assert.ok(!(process.env.DREAMCORE_TEST_BROWSER && retain), 'Browser matrix requires disposable fixtures');
assert.ok(!(backup && retain), 'Backup verification requires disposable fixtures');
const knowledge = process.argv.includes('--knowledge') || backup;
const conversations = process.argv.includes('--conversations') || backup;
const revocation = process.argv.includes('--revocation');
const materials = process.argv.includes('--materials') || revocation || knowledge;
const directory = retain ? join(workspace, '.local/trial') : await mkdtemp(join(tmpdir(), 'dreamcore-b4-'));
const artifacts = join(
  workspace,
  browserArtifacts(
    'three-surfaces',
    backup
      ? '.local/m7-a1'
      : conversations
        ? '.local/m4-a1'
        : knowledge
          ? '.local/m3-a1'
          : revocation
            ? '.local/m2-d1'
            : materials
              ? '.local/m2-c1'
              : '.local/m2-b4',
  ),
);
await mkdir(artifacts, { recursive: true });
await rm(join(artifacts, 'result.json'), { force: true });
let processHandle: ChildProcess | undefined,
  browser: Awaited<ReturnType<typeof browserType.launch>> | undefined;
const secrets: string[] = [],
  errors: string[] = [];
let output = '';
function launch(command: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const child = spawn(command, args, { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', (chunk) => {
    output = (output + chunk).slice(-40000);
  });
  child.stderr?.on('data', (chunk) => {
    output = (output + chunk).slice(-40000);
  });
  return child;
}
async function exit(child: ChildProcess) {
  if (child.exitCode !== null) return child.exitCode;
  return await new Promise<number | null>((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
}
async function read(name: string) {
  return JSON.parse(await readFile(join(directory, name), 'utf8'));
}
async function start() {
  processHandle = launch('python3', ['scripts/local/trial.py', 'start', '--directory', directory], {
    ...process.env,
    SPRING_DATASOURCE_URL: 'jdbc:postgresql://127.0.0.1:1/do-not-use',
    DATABASE_URL: 'must-not-inherit',
    API_PORT: '1',
    SERVER_PORT: '1',
    BOOTSTRAP_EMAIL: 'must-not-use@example.test',
  });
  for (let i = 0; i < 240; i++) {
    assert.equal(processHandle.exitCode, null, 'Trial launcher exited during startup');
    try {
      const runtime = await read('runtime.json');
      if (runtime.state === 'ready' && (await fetch(runtime.webUrl + '/api/v1/auth/csrf')).ok)
        return runtime.webUrl as string;
    } catch {
      /* startup */
    }
    await delay(200);
  }
  throw Error('Trial readiness timeout');
}
async function stop() {
  if (!processHandle || processHandle.exitCode !== null) return;
  assert.equal(
    await exit(launch('python3', ['scripts/local/trial.py', 'stop', '--directory', directory])),
    0,
  );
  assert.equal(await exit(processHandle), 0);
  processHandle = undefined;
}
async function token(id: string) {
  const value = (await read('invitations/' + id + '.json')).token as string;
  secrets.push(value);
  return value;
}
async function post(api: APIRequestContext, path: string, body: unknown, expected = 200) {
  const csrf = await (await api.get('/api/v1/auth/csrf')).json();
  const response = await api.post(path, { data: body, headers: { [csrf.headerName]: csrf.token } });
  assert.equal(response.status(), expected, `Unexpected HTTP status for ${path}`);
  return response.json();
}
type Account = { email: string; password: string; displayName?: string };
async function login(page: Page, account: Account) {
  await page.getByLabel('邮箱', { exact: true }).fill(account.email);
  await page.getByLabel('密码', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('.access-shell')).toBeVisible();
}
async function activate(page: Page, secret: string, account: Account, surface = 'tenant-admin') {
  await page.goto(`/${surface}/#invite=${secret}`);
  await expect(page).toHaveURL(new RegExp(`/${surface}/#invite$`));
  await page.getByLabel('你的姓名', { exact: true }).fill(account.displayName!);
  await page.getByLabel(/^设置密码/).fill(account.password);
  await page.getByLabel('确认密码', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: '创建账号并加入', exact: true }).click();
  await expect(page.getByRole('heading', { name: '登录梦擎工作空间', exact: true })).toBeVisible();
  await login(page, account);
}
async function invite(page: Page, context: BrowserContext, tenant: string, email: string) {
  await page.getByRole('button', { name: '邀请成员', exact: true }).click();
  await page.getByLabel('受邀邮箱').fill(email);
  await page.getByRole('button', { name: '生成邀请', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const values = await (
    await context.request.get(`/api/tenant-admin/v1/tenants/${tenant}/invitations`)
  ).json();
  return values.find((v: { email: string; status: string }) => v.email === email && v.status === 'PENDING')
    .id as string;
}
async function shared(page: Page, context: BrowserContext, tenant: string, name: string, email: string) {
  await page.getByRole('button', { name: '共享空间', exact: true }).click();
  await page.getByRole('button', { name: '创建空间', exact: true }).click();
  await page.getByLabel('空间名称', { exact: true }).fill(name);
  await page.getByRole('dialog').getByRole('button', { name: '创建空间', exact: true }).click();
  await page.getByRole('button', { name: '添加成员', exact: true }).click();
  await page.getByLabel('搜索授权成员').fill(email);
  await page.getByRole('dialog').getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.locator('.tenant-grants > li')).toHaveCount(1);
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await page.getByRole('button', { name: '确认添加', exact: true }).click();
  await expect(page.locator('.tenant-grants')).toContainText(email);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  return (await (await context.request.get(`/api/tenant-admin/v1/tenants/${tenant}/workspaces`)).json()).find(
    (s: { name: string }) => s.name === name,
  ).id as string;
}
try {
  const webUrl = await start();
  const accounts = await read('accounts.json');
  secrets.push(accounts.platform.password, (await read('database.json')).password);
  // A second start cannot take over the owned cluster or stop the original process.
  assert.equal(
    await exit(launch('python3', ['scripts/local/trial.py', 'start', '--directory', directory])),
    1,
  );
  assert.equal((await fetch(webUrl + '/api/v1/auth/csrf')).status, 200);
  browser = await browserType.launch();
  const context = async () =>
    browser!.newContext({ baseURL: webUrl, viewport: { width: 1440, height: 1000 } });
  const pc = await context(),
    ac = await context(),
    bc = await context(),
    mc = await context();
  const platform = await pc.newPage(),
    adminA = await ac.newPage(),
    adminB = await bc.newPage(),
    member = await mc.newPage();
  for (const page of [platform, adminA, adminB, member])
    page.on('pageerror', (error) => errors.push(error.name));
  await platform.goto('/platform-admin/');
  await login(platform, accounts.platform);
  assert.equal(
    (await (await pc.request.get('/api/platform-admin/v1/tenants')).json()).length,
    0,
    'Full journey requires a fresh trial; use the default disposable run for repeat checks.',
  );
  for (const [key, displayName] of [
    ['adminA', '试用企业 A 管理员'],
    ['adminB', '试用企业 B 管理员'],
    ['member', '跨企业试用成员'],
  ]) {
    accounts[key] = {
      email: `${key.toLowerCase()}@trial.example.test`,
      password: `synthetic-${randomUUID()}`,
      displayName,
    };
    secrets.push(accounts[key].password);
  }
  await writeFile(join(directory, 'accounts.json'), JSON.stringify(accounts, null, 2) + '\n', {
    mode: 0o600,
  });
  const tenants: string[] = [],
    initial: string[] = [];
  for (const [name, account] of [
    ['合成试用企业 A', accounts.adminA],
    ['合成试用企业 B', accounts.adminB],
  ] as [string, Account][]) {
    await platform.getByRole('button', { name: '开通企业', exact: true }).click();
    await platform.getByLabel('企业名称', { exact: true }).fill(name);
    await platform.getByLabel('初始管理员邮箱', { exact: true }).fill(account.email);
    await platform.getByRole('button', { name: '确认开通', exact: true }).click();
    await expect(platform.getByRole('dialog')).toContainText(account.email);
    const list = await (await pc.request.get('/api/platform-admin/v1/tenants')).json();
    const id = list.find((t: { name: string }) => t.name === name).id;
    tenants.push(id);
    const detail = await (await pc.request.get('/api/platform-admin/v1/tenants/' + id)).json();
    initial.push(detail.initialAdminInvitation.id);
    await platform.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  }
  const [a, b] = tenants;
  await activate(adminA, await token(initial[0]), accounts.adminA);
  await expect(adminA.locator('.access-welcome h2')).toHaveText('合成试用企业 A');
  await activate(adminB, await token(initial[1]), accounts.adminB);
  await expect(adminB.locator('.access-welcome h2')).toHaveText('合成试用企业 B');
  const first = await invite(adminA, ac, a, accounts.member.email);
  await activate(member, await token(first), accounts.member, 'workspace');
  await member.goto('/workspace/#tenant=' + a + '&view=spaces');
  await expect(member.locator('.access-spaces > li')).toHaveCount(1);
  const second = await invite(adminB, bc, b, accounts.member.email);
  await member.goto('/workspace/#invite=' + (await token(second)));
  await member.getByRole('button', { name: '确认加入企业', exact: true }).click();
  await expect(member.getByLabel('当前企业')).toHaveValue(b);
  await expect(member.getByRole('tab', { name: '推荐', exact: true })).toBeVisible();
  await expect(member).toHaveURL(new RegExp(`tenant=${b}$`));
  // B's administrator also joins A as an ordinary member; an A URL must not grant A management rights.
  const peerInvite = await invite(adminA, ac, a, accounts.adminB.email);
  await adminB.goto('/workspace/#invite=' + (await token(peerInvite)));
  await adminB.getByRole('button', { name: '确认加入企业', exact: true }).click();
  await expect(adminB.getByLabel('当前企业')).toHaveValue(a);
  await adminB.getByRole('button', { name: '更多工作与管理', exact: true }).click();
  await adminB.getByRole('link', { name: '企业管理', exact: true }).click();
  await expect(adminB.locator('.access-welcome h2')).toHaveText('合成试用企业 B');
  await adminB.getByRole('link', { name: '工作空间', exact: true }).click();
  await expect(adminB.getByLabel('当前企业')).toHaveValue(b);
  await expect(adminB.getByRole('tab', { name: '推荐', exact: true })).toBeVisible();
  await expect(adminB).toHaveURL(new RegExp(`tenant=${b}$`));
  await adminB.getByRole('button', { name: '更多工作与管理', exact: true }).click();
  await adminB.getByRole('link', { name: '企业管理', exact: true }).click();
  const spaceA = await shared(adminA, ac, a, '企业 A 共享资料', accounts.member.email),
    spaceB = await shared(adminB, bc, b, '企业 B 共享资料', accounts.member.email);
  await member.goto('/workspace/#tenant=' + a + '&view=spaces');
  await member.getByLabel('当前企业').selectOption(a);
  await expect(member.locator('.access-spaces')).toContainText('企业 A 共享资料');
  await expect(member.locator('.access-spaces')).not.toContainText('企业 B 共享资料');
  await member.getByLabel('当前企业').selectOption(b);
  await expect(member.locator('.access-spaces')).toContainText('企业 B 共享资料');
  for (const tenant of tenants) {
    assert.equal((await pc.request.get(`/api/v1/tenants/${tenant}/context`)).status(), 403);
    assert.equal((await mc.request.get(`/api/tenant-admin/v1/tenants/${tenant}/members`)).status(), 403);
  }
  assert.equal((await bc.request.get(`/api/tenant-admin/v1/tenants/${a}/members`)).status(), 403);
  assert.equal((await ac.request.get(`/api/tenant-admin/v1/tenants/${b}/members`)).status(), 403);
  assert.equal(
    (await ac.request.get(`/api/tenant-admin/v1/tenants/${a}/workspaces/${spaceB}`)).status(),
    404,
  );
  assert.equal(
    (await bc.request.get(`/api/tenant-admin/v1/tenants/${b}/workspaces/${spaceA}`)).status(),
    404,
  );
  await post(
    mc.request,
    `/api/tenant-admin/v1/tenants/${a}/invitations`,
    { requestId: randomUUID(), email: 'forbidden@trial.example.test' },
    403,
  );
  assert.equal((await ac.request.get('/api/platform-admin/v1/tenants')).status(), 403);
  const privateA = (await (await ac.request.get(`/api/v1/tenants/${a}/context`)).json()).workspaces;
  const privateB = (await (await bc.request.get(`/api/v1/tenants/${a}/context`)).json()).workspaces;
  assert.equal(privateA.length, 1);
  assert.equal(privateB.length, 1);
  assert.notEqual(privateA[0].id, privateB[0].id);
  // Existing client tabs re-read their current tenant when they regain focus.
  await member.getByLabel('当前企业').selectOption(a);
  await expect(member.locator('.access-spaces > li')).toHaveCount(2);
  await adminA.getByRole('button', { name: '管理空间 企业 A 共享资料', exact: true }).click();
  await adminA.getByRole('button', { name: '撤销授权', exact: true }).click();
  await adminA.getByRole('button', { name: '确认撤销授权', exact: true }).click();
  await expect(adminA.getByRole('heading', { name: '还没有授权成员', exact: true })).toBeVisible();
  await adminA.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await member.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(member.locator('.access-spaces > li')).toHaveCount(1);
  await adminA.getByRole('button', { name: '企业成员', exact: true }).click();
  const row = adminA.locator('.tenant-rows > li').filter({ hasText: accounts.member.email });
  await row.getByRole('button', { name: '停用', exact: true }).click();
  await adminA.getByRole('button', { name: '确认停用', exact: true }).click();
  await expect(row).toContainText('已停用');
  await member.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(member.getByRole('heading', { name: '没有访问权限', exact: true })).toBeVisible();
  await expect(member.locator('.access-spaces')).toHaveCount(0);
  await member.getByLabel('当前企业').selectOption(b);
  await expect(member.locator('.access-spaces')).toContainText('企业 B 共享资料');
  await row.getByRole('button', { name: '恢复', exact: true }).click();
  await adminA.getByRole('button', { name: '恢复成员', exact: true }).click();
  await expect(row).toContainText('已启用');
  await member.goto('/workspace/#tenant=' + a + '&view=spaces');
  await member.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(member.locator('.access-spaces > li')).toHaveCount(1);
  // Platform suspension of B does not remove the same member's A access.
  await platform.getByRole('button', { name: '查看企业 合成试用企业 B', exact: true }).click();
  await platform.getByRole('button', { name: '停用企业', exact: true }).click();
  await platform.getByRole('button', { name: '确认停用企业', exact: true }).click();
  await expect(platform.getByRole('button', { name: '恢复使用', exact: true })).toBeVisible();
  assert.equal((await mc.request.get(`/api/v1/tenants/${b}/context`)).status(), 403);
  assert.equal((await mc.request.get(`/api/v1/tenants/${a}/context`)).status(), 200);
  await adminB.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(adminB.getByRole('heading', { name: '没有访问权限', exact: true })).toBeVisible();
  await platform.getByRole('button', { name: '恢复使用', exact: true }).click();
  await platform.getByRole('button', { name: '确认恢复使用', exact: true }).click();
  await expect(platform.getByRole('button', { name: '停用企业', exact: true })).toBeVisible();
  await platform.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await adminB.reload();
  await expect(adminB.locator('.access-welcome h2')).toHaveText('合成试用企业 B');
  const materialRestart = materials
    ? await (
        await import('./material-journey.ts')
      ).materialJourney({
        tenant: b,
        memberContext: mc,
        adminContext: bc,
        memberEmail: accounts.member.email,
        space: spaceB,
        artifacts,
      })
    : undefined;
  const knowledgeRestart = knowledge
    ? await (
        await import('./knowledge-journey.ts')
      ).knowledgeJourney({ tenant: b, space: spaceB, memberContext: mc, adminContext: bc, artifacts })
    : undefined;
  const revocationRestart = revocation
    ? await (
        await import('./revocation-journey.ts')
      ).revocationJourney({
        tenant: b,
        otherTenant: a,
        space: spaceB,
        memberContext: mc,
        adminContext: bc,
        platformContext: pc,
        memberAccount: accounts.member,
        artifacts,
      })
    : undefined;
  if (conversations) {
    const { workspaceDesignJourney } = await import('./workspace-design-journey.ts');
    await workspaceDesignJourney(mc, b, artifacts);
  }
  const conversationRestart = conversations
    ? await (
        await import('./conversation-journey.ts')
      ).conversationJourney({
        tenant: b,
        space: spaceB,
        memberContext: mc,
        adminContext: bc,
        platformContext: pc,
        artifacts,
      })
    : undefined;
  // Owned stop/restart keeps the same browser sessions, account data, grants and audit records.
  const before = await (await ac.request.get(`/api/tenant-admin/v1/tenants/${a}/records`)).json();
  await stop();
  assert.equal((await read('runtime.json')).state, 'stopped');
  // Browser pollers may connect while the port is deliberately occupied. Do not retain those sockets.
  const blocker = createServer((socket) => socket.destroy());
  const config = await read('config.json');
  await new Promise<void>((resolve) => blocker.listen(config.ports.web, '127.0.0.1', resolve));
  assert.equal(
    await exit(launch('python3', ['scripts/local/trial.py', 'start', '--directory', directory])),
    1,
  );
  assert.ok(blocker.listening);
  await new Promise<void>((resolve) => blocker.close(() => resolve()));
  assert.equal(await start(), webUrl);
  await revocationRestart?.();
  await materialRestart?.();
  await knowledgeRestart?.();
  await conversationRestart?.();
  assert.equal((await mc.request.get('/api/v1/me')).status(), 200);
  assert.deepEqual(await (await ac.request.get(`/api/tenant-admin/v1/tenants/${a}/records`)).json(), before);
  await member.reload();
  await expect(member.locator('.access-welcome h2')).toHaveText('合成试用企业 A');
  await expect(member.locator('.access-spaces > li')).toHaveCount(1);
  await member.getByLabel('当前企业').selectOption(b);
  await expect(member.locator('.access-spaces > li')).toHaveCount(2);
  const memberTab = await mc.newPage();
  await memberTab.goto('/workspace/#tenant=' + b);
  await expect(memberTab.locator('.access-shell')).toBeVisible();
  await member.getByRole('button', { name: '个人设置与账号', exact: true }).click();
  await member.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(memberTab.getByRole('heading', { name: '登录梦擎工作空间', exact: true })).toBeVisible();
  await login(member, accounts.member);
  await expect(member.locator('.access-welcome h2')).toHaveText('合成试用企业 B');
  await member.route('**/api/v1/tenants/*/context', (route) => route.abort());
  await member.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(member.getByRole('heading', { name: '暂时无法读取企业信息', exact: true })).toBeVisible();
  await expect(member.locator('.access-spaces')).toHaveCount(0);
  await member.unrouteAll();
  await member.getByRole('button', { name: '重试', exact: true }).click();
  await expect(member.locator('.access-spaces > li')).toHaveCount(2);
  for (const [label, page] of [
    ['platform', platform],
    ['tenant-admin', adminA],
    ['workspace', member],
  ] as [string, Page][]) {
    await page.screenshot({
      path: join(artifacts, label + '-desktop.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: join(artifacts, label + '-mobile.png'),
      fullPage: true,
      animations: 'disabled',
    });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    assert.ok(secrets.every((secret) => !storage.includes(secret)));
  }
  assert.deepEqual(errors, []);
  const logFiles = await readdir(join(directory, 'logs'));
  assert.ok(logFiles.some((name) => name.startsWith('service-')));
  assert.ok(logFiles.some((name) => name.startsWith('postgres-')));
  assert.ok(logFiles.every((name) => /^(service|postgres)-\d{8}T\d{12}Z-[a-f0-9]{12}\.log$/.test(name)));
  const logs = (
    await Promise.all(logFiles.map((name) => readFile(join(directory, 'logs', name), 'utf8')))
  ).join('');
  assert.ok(secrets.every((secret) => !logs.includes(secret) && !output.includes(secret)));
  for (const name of ['accounts.json', 'database.json', 'config.json'])
    assert.equal((await stat(join(directory, name))).mode & 0o777, 0o600);
  // Private local config and invitation files must never be served from Vite's dist root.
  for (const path of ['/.local/trial/accounts.json', '/accounts.json', '/invitations/' + first + '.json']) {
    const body = await (await fetch(webUrl + path)).text();
    assert.ok(secrets.every((secret) => !body.includes(secret)));
  }
  const cookies = await mc.cookies();
  assert.ok(cookies.some((cookie) => cookie.name.startsWith('DREAMCORE_TRIAL_') && cookie.httpOnly));
  if (backup)
    await (
      await import('./backup-journey.ts')
    ).backupJourney({
      directory,
      artifacts,
      tenant: b,
      otherTenant: a,
      space: spaceB,
      browser: browser!,
      memberContext: mc,
      adminContext: bc,
      accounts,
      stop,
    });
  await writeFile(
    join(artifacts, 'result.json'),
    JSON.stringify(
      {
        browser: browserName,
        browserVersion: browser!.version(),
        status: 'passed',
        synthetic: true,
        retained: retain,
        backup,
        materials,
        revocation,
        knowledge,
        conversations,
        tenants: { a, b },
        workspaceIds: { a: spaceA, b: spaceB },
        checks: [
          'three-surface-ui',
          'two-tenant-isolation',
          'current-tenant-navigation',
          'existing-account-invitation',
          'live-permission-refresh',
          'disable-restore',
          'persistent-restart',
          'port-conflict-no-takeover',
          'cross-tab-logout',
          'desktop-mobile',
          'secret-boundary',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    (conversations
      ? 'M4-A1 private conversations, local engine tasks, idempotent recovery and restart PASS. '
      : '') +
      (knowledge ? 'M3-A1 local parsing, search, fixed citations and restart PASS. ' : '') +
      (revocation
        ? 'M2-D1 revocation, live forms, late-response isolation and suspended restart PASS. '
        : '') +
      (materials ? 'M2-C1 material UI, bytes, versions, permission and restart PASS. ' : '') +
      'PASS: M2-B4 full three-surface UI journey; two enterprises, live authorization, tenant navigation, invitation activation, logout/relogin, owned persistent runtime restart, port isolation and desktop/mobile views.',
  );
} catch (error) {
  let safe =
    (error instanceof Error ? error.stack || String(error) : String(error)) +
    '\nLocal launcher output:\n' +
    output.slice(-5000);
  for (const secret of secrets) safe = safe.replaceAll(secret, '[redacted synthetic secret]');
  console.error(safe);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stop();
  if (!retain) await rm(directory, { recursive: true, force: true });
}
