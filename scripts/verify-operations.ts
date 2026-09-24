import { browserName, browserType, browserArtifacts } from './browser-target.ts';
/** Disposable operational fixtures only; no cloud model, customer data or external invitations. */
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, type APIRequestContext } from '@playwright/test';
import Ajv2020 from 'ajv/dist/2020.js';
import type { OperationsOverview } from '../contracts/public-api/operations';
const root = new URL('../', import.meta.url),
  temp = await mkdtemp(join(tmpdir(), 'dreamcore-operations-'));
const artifacts = new URL(
  '../' + browserArtifacts('operations', '.local/m7-operations') + '/',
  import.meta.url,
);
await mkdir(artifacts, { recursive: true });
await rm(new URL('result.json', artifacts), { force: true });
const children: ChildProcess[] = [],
  password = 'synthetic-' + randomUUID();
let browser: Awaited<ReturnType<typeof browserType.launch>> | undefined;
const dbUrl = new URL(process.env.DATABASE_URL!.replace(/^jdbc:/, ''));
assert.equal(dbUrl.hostname, '127.0.0.1');
assert.equal(process.env.DATABASE_USER, 'dreamcore_test');
assert.ok(process.env.MATERIAL_STORAGE_ROOT?.includes('dreamcore-test-pg-'));
const clean = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) =>
      !/^(AGENT_|ENGINE_|TASK_|SPRING_|BOOTSTRAP_|SERVER_|API_|DREAMCORE_|KNOWLEDGE_)/.test(k) &&
      !['JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS'].includes(k),
  ),
);
function sql(text: string) {
  execFileSync(
    process.env.POSTGRES_BIN ? join(process.env.POSTGRES_BIN, 'psql') : 'psql',
    [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      '127.0.0.1',
      '-p',
      dbUrl.port,
      '-U',
      'dreamcore_test',
      '-d',
      'dreamcore_test',
    ],
    {
      input: text,
      env: { ...clean, PGPASSWORD: process.env.DATABASE_PASSWORD },
      stdio: ['pipe', 'ignore', 'pipe'],
    },
  );
}
async function port() {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const a = s.address();
  assert.ok(a && typeof a !== 'string');
  await new Promise<void>((r) => s.close(() => r()));
  return String(a.port);
}
function start(command: string, args: string[], env: Record<string, string> = {}) {
  const p = spawn(command, args, {
    cwd: root,
    env: {
      ...clean,
      SPRING_PROFILES_ACTIVE: 'local',
      TASK_ENABLED: 'false',
      KNOWLEDGE_ENABLED: 'false',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(p);
  p.stdout?.resume();
  p.stderr?.resume();
  return p;
}
async function exited(p: ChildProcess) {
  if (p.exitCode !== null) return p.exitCode;
  return new Promise<number | null>((resolve, reject) => {
    p.once('exit', resolve);
    p.once('error', reject);
  });
}
async function stop(p: ChildProcess) {
  if (p.exitCode !== null || p.signalCode !== null) return;
  p.kill('SIGTERM');
  for (let n = 0; n < 100; n++) {
    if (p.exitCode !== null || p.signalCode !== null) return;
    await delay(50);
  }
  p.kill('SIGKILL');
  await exited(p);
}
async function ready(url: string, p: ChildProcess) {
  await expect
    .poll(
      async () => {
        assert.equal(p.exitCode, null);
        try {
          return (await fetch(url, { signal: AbortSignal.timeout(500) })).status;
        } catch {
          return 0;
        }
      },
      { timeout: 45000 },
    )
    .toBe(200);
}
async function post(api: APIRequestContext, path: string, data: unknown, status = 200) {
  const csrf = await (await api.get('/api/v1/auth/csrf')).json();
  const r = await api.post(path, { data, headers: { [csrf.headerName]: csrf.token } });
  assert.equal(r.status(), status, path);
  return r.json();
}
const uuid = (id: string) => {
  assert.match(id, /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  return id;
};
try {
  const secret = join(temp, 'password');
  await writeFile(secret, password, { mode: 0o600 });
  const jar = 'apps/api/target/workspace-api-0.1.0-SNAPSHOT.jar';
  assert.equal(
    await exited(
      start('java', ['-jar', jar, '--bootstrap-admin'], {
        BOOTSTRAP_EMAIL: 'operations-platform@example.test',
        BOOTSTRAP_PASSWORD_FILE: secret,
      }),
    ),
    0,
  );
  const apiPort = await port(),
    webPort = await port(),
    apiUrl = `http://127.0.0.1:${apiPort}`,
    webUrl = `http://127.0.0.1:${webPort}`;
  const api = start('java', ['-jar', jar], { API_HOST: '127.0.0.1', API_PORT: apiPort });
  await ready(apiUrl + '/actuator/health', api);
  const web = start(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', webPort, '--strictPort'],
    { DREAMCORE_DEV_API_URL: apiUrl },
  );
  await ready(webUrl, web);
  browser = await browserType.launch();
  const platform = await browser.newContext({ baseURL: webUrl, viewport: { width: 1440, height: 1100 } }),
    user = await browser.newContext({ baseURL: webUrl, viewport: { width: 1440, height: 1100 } }),
    member = await browser.newContext({ baseURL: webUrl });
  await post(platform.request, '/api/v1/auth/login', { email: 'operations-platform@example.test', password });
  async function create(name: string) {
    return post(
      platform.request,
      '/api/platform-admin/v1/tenants',
      { requestId: randomUUID(), name, adminEmail: 'operations-admin@example.test' },
      201,
    );
  }
  async function token(id: string) {
    return JSON.parse(await readFile(join(process.env.INVITATION_OUTBOX!, id + '.json'), 'utf8')).token;
  }
  const aCreated = await create('合成运行企业 A'),
    a = uuid(aCreated.tenant.id);
  await post(user.request, '/api/v1/auth/invitations/accept', {
    token: await token(aCreated.invitation.id),
    displayName: '合成运行管理员',
    password,
  });
  await post(user.request, '/api/v1/auth/login', { email: 'operations-admin@example.test', password });
  const bCreated = await create('合成运行企业 B'),
    b = uuid(bCreated.tenant.id);
  await post(user.request, '/api/v1/auth/invitations/accept', { token: await token(bCreated.invitation.id) });
  const invite = await post(
    user.request,
    `/api/tenant-admin/v1/tenants/${a}/invitations`,
    { requestId: randomUUID(), email: 'operations-member@example.test' },
    201,
  );
  await post(member.request, '/api/v1/auth/invitations/accept', {
    token: await token(invite.id),
    displayName: '合成运行成员',
    password,
  });
  await post(member.request, '/api/v1/auth/login', { email: 'operations-member@example.test', password });
  const account = uuid((await (await user.request.get('/api/v1/me')).json()).account.id);
  const aContext = await (await user.request.get(`/api/v1/tenants/${a}/context`)).json(),
    bContext = await (await user.request.get(`/api/v1/tenants/${b}/context`)).json();
  const spaceA = uuid(aContext.workspaces.find((w: { kind: string }) => w.kind === 'PERSONAL').id),
    spaceB = uuid(bContext.workspaces.find((w: { kind: string }) => w.kind === 'PERSONAL').id);
  async function upload(t: string, space: string, text: string, material?: { id: string }) {
    const csrf = await (await user.request.get('/api/v1/auth/csrf')).json();
    const r = await user.request.post(
      `/api/v1/tenants/${t}/workspaces/${space}/materials${material ? `/${material.id}/versions` : ''}`,
      {
        headers: { [csrf.headerName]: csrf.token },
        multipart: {
          metadata: {
            name: 'metadata.json',
            mimeType: 'application/json',
            buffer: Buffer.from(
              JSON.stringify({ requestId: randomUUID(), ...(material ? { expectedVersion: 1 } : {}) }),
            ),
          },
          file: { name: 'private-operations-secret.txt', mimeType: 'text/plain', buffer: Buffer.from(text) },
        },
      },
    );
    assert.equal(r.status(), 201);
    return r.json();
  }
  const original = await upload(a, spaceA, '123456');
  await upload(a, spaceA, '123456789', original);
  await upload(b, spaceB, 'abc');
  function seed(
    t: string,
    s: string,
    status: string,
    mode: string,
    execution: string | null,
    error: string | null,
    age = 0,
    usage: string | null = null,
  ) {
    const c = randomUUID(),
      id = randomUUID();
    sql(`INSERT INTO conversations(id,tenant_id,workspace_id,owner_id,title) VALUES ('${c}','${t}','${s}','${account}','private-operations-secret');
    INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,execution_class,status,attempt,error_code,created_at,finished_at,reply,model_name,model_calls,token_usage)
    VALUES ('${id}','${t}','${s}','${c}','${account}','private-operations-secret','${mode}',${execution ? `'${execution}'` : 'NULL'},'${status}',1,${error ? `'${error}'` : 'NULL'},now()-make_interval(days=>${age}),now(),'private-operations-secret','private-model',3,${usage ? `'${usage}'::jsonb` : 'NULL'});`);
    return c;
  }
  const privateConversation = seed(a, spaceA, 'SUCCEEDED', 'SOURCE_LOOKUP', null, null);
  seed(a, spaceA, 'SUCCEEDED', 'AGENT', 'verification', null, 0, '{"inputTokens":30,"outputTokens":15}');
  seed(a, spaceA, 'SUCCEEDED', 'AGENT', 'live', null);
  seed(a, spaceA, 'FAILED', 'AGENT', 'live', 'TASK_MODEL_FAILED');
  seed(a, spaceA, 'INTERRUPTED', 'AGENT', 'verification', 'TASK_INTERRUPTED');
  seed(a, spaceA, 'SUCCEEDED', 'AGENT', 'live', null, 10, '{"inputTokens":900,"outputTokens":60}');
  seed(b, spaceB, 'SUCCEEDED', 'SOURCE_LOOKUP', null, null);
  sql(`INSERT INTO agent_attempt_usage(attempt_id,task_id,tenant_id,workspace_id,attempt_number,execution_class,status,metering_enabled)
    SELECT gen_random_uuid(),id,tenant_id,workspace_id,1,execution_class,status,true FROM conversation_tasks WHERE tenant_id='${a}' AND status='FAILED';
    INSERT INTO agent_model_requests(task_id,attempt_id,sequence,max_output_tokens,outcome,input_tokens,output_tokens)
    SELECT task_id,attempt_id,1,2048,'FAILED',40,5 FROM agent_attempt_usage WHERE tenant_id='${a}';
    INSERT INTO agent_model_requests(task_id,attempt_id,sequence,max_output_tokens)
    SELECT task_id,attempt_id,2,2048 FROM agent_attempt_usage WHERE tenant_id='${a}';`);
  const spec = JSON.parse(
    await readFile(new URL('../contracts/public-api/operations.openapi.json', import.meta.url), 'utf8'),
  );
  const check = new Ajv2020({
    strict: false,
    formats: { uuid: true, 'date-time': true },
  }).compile<OperationsOverview>({
    ...spec.components.schemas.Overview,
    components: spec.components,
  });
  const aPath = `/api/tenant-admin/v1/tenants/${a}/operations`,
    bPath = `/api/tenant-admin/v1/tenants/${b}/operations`;
  for (const [client, path, total] of [
    [user.request, aPath, 5],
    [user.request, bPath, 1],
    [platform.request, '/api/platform-admin/v1/operations', 6],
    [platform.request, `/api/platform-admin/v1/tenants/${a}/operations`, 5],
  ] as const) {
    const r = await client.get(path);
    assert.equal(r.status(), 200);
    const body = await r.json();
    assert.ok(check(body));
    assert.equal(body.tasks.total, total);
    assert.equal(r.headers()['cache-control'], 'private, no-store');
    assert.ok(!JSON.stringify(body).includes('private-'));
  }
  assert.equal((await member.request.get(aPath)).status(), 403);
  assert.equal((await platform.request.get(aPath)).status(), 403);
  assert.equal((await user.request.get('/api/platform-admin/v1/operations')).status(), 403);
  assert.equal(
    (await platform.request.get(`/api/v1/tenants/${a}/conversations/${privateConversation}`)).status(),
    403,
  );
  const pp = await platform.newPage(),
    tp = await user.newPage(),
    errors: string[] = [];
  for (const p of [pp, tp]) p.on('pageerror', (e) => errors.push(e.name));
  const metric = (p: typeof tp, label: string) =>
    p
      .locator('.operations-metrics > div')
      .filter({ has: p.getByText(label, { exact: true }) })
      .locator('dd');
  await pp.goto('/platform-admin/');
  await pp.getByRole('button', { name: '运行概览', exact: true }).click();
  await expect(metric(pp, '创建任务')).toHaveText('6');
  await expect(pp.getByRole('button', { name: '运行概览', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await pp.screenshot({ path: fileURLToPath(new URL('platform.png', artifacts)), fullPage: true });
  await pp.getByRole('button', { name: '企业管理', exact: true }).click();
  await pp.getByRole('button', { name: '查看企业 合成运行企业 A', exact: true }).click();
  await pp.getByRole('button', { name: '查看企业运行概览', exact: true }).click();
  await expect(metric(pp, '创建任务')).toHaveText('5');
  await pp.keyboard.press('Escape');
  await tp.goto(`/tenant-admin/#tenant=${a}`);
  await tp.getByRole('button', { name: '运行概览', exact: true }).click();
  await expect(metric(tp, '创建任务')).toHaveText('5');
  await tp.getByText('成功任务的历史回执（旧口径）', { exact: true }).click();
  await expect(
    tp.locator('details .operations-model').filter({ has: tp.getByText('正式模型调用', { exact: true }) }),
  ).toContainText('未上报');
  await expect(tp.getByText('1 次尝试 · 2 次登记请求', { exact: true })).toBeVisible();
  await expect(tp.getByText(/用量已知 1 \/ 2 次请求；未知 1 次/)).toBeVisible();
  await expect(tp.getByText('模型请求未完成', { exact: true })).toBeVisible();
  assert.ok(!(await tp.locator('.operations-panel').innerText()).includes('private-'));
  await tp.getByLabel('统计范围').selectOption('30');
  await expect(metric(tp, '创建任务')).toHaveText('6');
  await expect(
    tp.locator('details .operations-model').filter({ has: tp.getByText('正式模型调用', { exact: true }) }),
  ).toContainText('1 / 2');
  await tp.screenshot({ path: fileURLToPath(new URL('tenant.png', artifacts)), fullPage: true });
  await tp.setViewportSize({ width: 390, height: 844 });
  assert.ok(await tp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await tp.screenshot({ path: fileURLToPath(new URL('tenant-mobile.png', artifacts)), fullPage: true });
  await tp.getByRole('heading', { name: '各次尝试的模型用量', exact: true }).scrollIntoViewIfNeeded();
  await tp.screenshot({ path: fileURLToPath(new URL('tenant-usage-mobile.png', artifacts)), fullPage: true });
  assert.ok(await tp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await tp.locator('.operations-errors').scrollIntoViewIfNeeded();
  await tp.screenshot({
    path: fileURLToPath(new URL('tenant-mobile-errors.png', artifacts)),
    fullPage: true,
    animations: 'disabled',
  });
  await tp.setViewportSize({ width: 1440, height: 1100 });
  const pattern = `**${aPath}?*`;
  await tp.route(pattern, (r) =>
    r.fulfill({ status: 503, contentType: 'application/json', body: '{"code":"UNAVAILABLE"}' }),
  );
  await tp.getByRole('button', { name: '更新统计', exact: true }).click();
  await expect(tp.getByRole('heading', { name: '暂时无法读取', exact: true })).toBeVisible();
  assert.equal(await tp.locator('.operations-metrics').count(), 0);
  await tp.unroute(pattern);
  await tp.getByRole('button', { name: '重试', exact: true }).click();
  await expect(metric(tp, '创建任务')).toHaveText('6');
  // Release an old-tenant response only after the new tenant is already visible.
  let release!: () => void,
    held = false;
  const gate = new Promise<void>((r) => (release = r));
  await tp.route(pattern, async (route) => {
    const r = await route.fetch();
    held = true;
    await gate;
    await route.fulfill({ response: r }).catch(() => {});
  });
  await tp.getByRole('button', { name: '更新统计', exact: true }).click();
  await expect.poll(() => held).toBe(true);
  await tp.getByLabel('当前企业').selectOption(b);
  await expect(tp.locator('.access-welcome h2')).toHaveText('合成运行企业 B');
  await tp.getByRole('button', { name: '运行概览', exact: true }).click();
  await expect(metric(tp, '创建任务')).toHaveText('1');
  release();
  await tp.unroute(pattern);
  await expect(metric(tp, '创建任务')).toHaveText('1');
  // Unknown/missing data stays an unavailable view instead of invented zero metrics.
  await tp.getByText('成功任务的历史回执（旧口径）', { exact: true }).click();
  await expect(tp.getByText('该时段暂无成功 Agent 任务，模型用量不可得。', { exact: true })).toBeVisible();
  const bPattern = `**${bPath}?*`;
  await tp.route(bPattern, async (route) => {
    const r = await route.fetch(),
      body = await r.json();
    body.tenantId = a;
    await route.fulfill({ json: body });
  });
  await tp.getByRole('button', { name: '更新统计', exact: true }).click();
  await expect(tp.getByRole('heading', { name: '暂时无法读取', exact: true })).toBeVisible();
  await tp.unroute(bPattern);
  sql(`UPDATE tenant_memberships SET role='MEMBER' WHERE tenant_id='${b}' AND account_id='${account}';`);
  assert.equal((await user.request.get(bPath)).status(), 403);
  await tp.getByRole('button', { name: '更新统计', exact: true }).click();
  await expect(tp.getByRole('heading', { name: '没有访问权限', exact: true })).toBeVisible();
  assert.equal(await tp.locator('.operations-metrics').count(), 0);
  const detail = await (await platform.request.get(`/api/platform-admin/v1/tenants/${a}`)).json();
  await post(platform.request, `/api/platform-admin/v1/tenants/${a}/status`, {
    requestId: randomUUID(),
    expectedVersion: detail.version,
    status: 'SUSPENDED',
  });
  assert.equal((await user.request.get(aPath)).status(), 403);
  assert.equal((await platform.request.get(`/api/platform-admin/v1/tenants/${a}/operations`)).status(), 200);
  assert.deepEqual(errors, []);
  await writeFile(
    new URL('result.json', artifacts),
    JSON.stringify(
      {
        browser: browserName,
        browserVersion: browser!.version(),
        status: 'passed',
        synthetic: true,
        cloudModelCalls: 0,
        checks: [
          'aggregate-contract',
          'two-tenants',
          'all-roles',
          'private-content-denied',
          'unknown-usage',
          'attempt-ledger-known-and-pending',
          '7-and-30-days',
          'desktop-and-mobile',
          'failed-load-retry',
          'late-response-tenant-switch',
          'foreign-response-rejected',
          'role-revocation',
          'tenant-suspension',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'PASS M7-A1 operations: real admin APIs, metadata-only aggregates, browser states and tenant isolation; zero model calls.',
  );
} finally {
  await browser?.close();
  for (const p of [...children].reverse()) await stop(p);
  await rm(temp, { recursive: true, force: true });
}
