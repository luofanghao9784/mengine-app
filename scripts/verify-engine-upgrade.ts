import { ENGINE_VERSION } from '../engine/dist/release.js';
/** Exact legacy source + current build; one platform PID and DB throughout the cutovers. */
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer, request as forward } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect, type APIRequestContext } from '@playwright/test';
const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = '65443b35719be33b1a4e3d19214d0768a6b0daa5';
const temp = await mkdtemp(join(tmpdir(), 'dreamcore-engine-upgrade-'));
const artifacts = join(root, '.local/m7-engine');
await mkdir(artifacts, { recursive: true });
const children: ChildProcess[] = [];
const clean = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^(AGENT_|ENGINE_|TASK_|SPRING_|BOOTSTRAP_|SERVER_|API_|DREAMCORE_|KNOWLEDGE_|UPGRADE_)/.test(key) &&
      !/^npm_/i.test(key) &&
      !['JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS', 'INIT_CWD'].includes(key),
  ),
);
const password = 'synthetic-' + randomUUID(),
  token = 'synthetic-' + randomUUID();
let target: string | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const proxy = createServer((req, res) => {
  if (!target) {
    res.writeHead(503);
    res.end();
    return;
  }
  const upstream = forward(
    new URL(req.url!, target),
    { method: req.method, headers: req.headers },
    (reply) => {
      res.writeHead(reply.statusCode!, reply.headers);
      reply.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(503);
    res.end();
  });
  res.once('close', () => upstream.destroy());
  req.pipe(upstream);
});
let blockedPosts = 0;
const incompatible = createServer((req, res) => {
  if (req.method === 'POST') blockedPosts++;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      contractVersion: '1.0',
      engineVersion: '2.0.0',
      runtimeMode: 'agent-verification',
      protocols: { sourceLookup: '2.0', agentTask: '2.0', platformCallbacks: '2.0' },
    }),
  );
});
const close = (server: ReturnType<typeof createServer>) =>
  new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
async function listen(server: ReturnType<typeof createServer>) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}
async function port() {
  const server = createServer();
  const url = await listen(server);
  await close(server);
  return new URL(url).port;
}
function start(command: string, args: string[], env: Record<string, string> = {}, ipc = false) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...clean, SPRING_PROFILES_ACTIVE: 'local', ...env },
    stdio: ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.stdout?.resume();
  child.stderr?.resume();
  return child;
}
async function exited(child: ChildProcess) {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise<number | null>((resolve, reject) => {
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
  await exited(child);
}
async function ready(url: string, child: ChildProcess) {
  await expect
    .poll(
      async () => {
        assert.equal(child.exitCode, null, 'Owned service exited');
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
  const response = await api.post(path, { data, headers: { [csrf.headerName]: csrf.token } });
  assert.equal(response.status(), status, path);
  return response.json();
}
const releaseProcesses: { child: ChildProcess; url: string; calls: number }[] = [];
async function engine(engineRoot: string, platform: string, hold = false) {
  const child = start(
    process.execPath,
    ['scripts/fixtures/upgrade-engine.mjs'],
    {
      UPGRADE_ENGINE_ROOT: engineRoot,
      UPGRADE_PLATFORM_URL: platform,
      UPGRADE_HOLD_MODEL: String(hold),
      TASK_ENGINE_TOKEN: token,
    },
    true,
  );
  const entry = { child, url: '', calls: 0 };
  releaseProcesses.push(entry);
  child.on('message', (message: any) => {
    if (message.type === 'ready') entry.url = message.url;
    if (message.type === 'calls') entry.calls = message.count;
  });
  await expect
    .poll(
      () => {
        assert.equal(child.exitCode, null, 'Engine exited');
        return entry.url;
      },
      { timeout: 20000 },
    )
    .not.toBe('');
  return entry;
}
async function releaseHash(directory: string) {
  const checksum = createHash('sha256');
  async function scan(relative: string) {
    const entries = await readdir(join(directory, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const name = join(relative, entry.name);
      if (entry.isDirectory()) await scan(name);
      else {
        assert.ok(entry.isFile());
        checksum.update(name + '\0');
        checksum.update(await readFile(join(directory, name)));
      }
    }
  }
  for (const name of ['package.json', 'package-lock.json']) {
    checksum.update(name + '\0');
    checksum.update(await readFile(join(directory, name)));
  }
  await scan('dist');
  await scan('catalog');
  return checksum.digest('hex');
}
async function preflight(url: string, version: string, legacy = false, status = 0) {
  assert.equal(
    await exited(
      start(
        process.execPath,
        [
          'scripts/check-engine.mjs',
          '--url',
          url,
          '--expected-version',
          version,
          '--mode',
          'agent-verification',
          ...(legacy ? ['--allow-legacy-090'] : []),
        ],
        { TASK_ENGINE_TOKEN: token },
      ),
    ),
    status,
  );
}
try {
  assert.equal(new URL(process.env.DATABASE_URL!.replace(/^jdbc:/, '')).hostname, '127.0.0.1');
  assert.equal(process.env.DATABASE_USER, 'dreamcore_test');
  assert.ok(process.env.MATERIAL_STORAGE_ROOT!.includes('dreamcore-test-pg-'));
  // Build the actual archived 0.9.0 source; never relabel a new binary as the legacy version.
  const archive = join(temp, 'legacy.tar');
  await writeFile(
    archive,
    execFileSync('git', ['archive', '--format=tar', baseline, 'engine'], {
      cwd: root,
      maxBuffer: 32 * 1024 * 1024,
    }),
  );
  execFileSync('tar', ['-xf', archive, '-C', temp]);
  const oldRoot = await realpath(join(temp, 'engine')),
    newRoot = join(root, 'engine');
  assert.equal(await exited(start('npm', ['--prefix', oldRoot, 'ci', '--offline', '--ignore-scripts'])), 0);
  assert.equal(await exited(start('npm', ['--prefix', oldRoot, 'run', 'build'])), 0);
  const oldPackage = JSON.parse(await readFile(join(oldRoot, 'package.json'), 'utf8')),
    newPackage = JSON.parse(await readFile(join(newRoot, 'package.json'), 'utf8'));
  assert.equal(oldPackage.version, '0.9.0');
  assert.equal(newPackage.version, ENGINE_VERSION);
  const apiPort = await port(),
    webPort = await port(),
    apiUrl = `http://127.0.0.1:${apiPort}`,
    webUrl = `http://127.0.0.1:${webPort}`;
  const endpoint = await listen(proxy),
    badUrl = await listen(incompatible);
  const initial = await engine(oldRoot, apiUrl);
  target = initial.url;
  await preflight(initial.url, '0.9.0', false, 1);
  await preflight(initial.url, '0.9.0', true);
  const secret = join(temp, 'password');
  await writeFile(secret, password, { mode: 0o600 });
  const jar = 'apps/api/target/workspace-api-0.1.0-SNAPSHOT.jar';
  assert.equal(
    await exited(
      start('java', ['-jar', jar, '--bootstrap-admin'], {
        BOOTSTRAP_EMAIL: 'upgrade-platform@example.test',
        BOOTSTRAP_PASSWORD_FILE: secret,
      }),
    ),
    0,
  );
  const api = start('java', ['-jar', jar], {
    API_HOST: '127.0.0.1',
    API_PORT: apiPort,
    ENGINE_BASE_URL: endpoint,
    ENGINE_LEGACY_090_ENABLED: 'true',
    TASK_ENABLED: 'true',
    TASK_ENGINE_TOKEN: token,
    AGENT_TASK_MODE: 'verification',
    KNOWLEDGE_ENABLED: 'true',
    KNOWLEDGE_PARSER_ROOT: join(root, 'workers/parser'),
  });
  await ready(apiUrl + '/actuator/health', api);
  const apiPid = api.pid;
  const web = start(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', webPort, '--strictPort'],
    { DREAMCORE_DEV_API_URL: apiUrl },
  );
  await ready(webUrl, web);
  browser = await chromium.launch();
  const platform = await browser.newContext({ baseURL: webUrl }),
    user = await browser.newContext({ baseURL: webUrl, viewport: { width: 1440, height: 1000 } });
  await post(platform.request, '/api/v1/auth/login', { email: 'upgrade-platform@example.test', password });
  const created = await post(
    platform.request,
    '/api/platform-admin/v1/tenants',
    { requestId: randomUUID(), name: '引擎升级合成企业', adminEmail: 'upgrade-user@example.test' },
    201,
  );
  const other = await post(
    platform.request,
    '/api/platform-admin/v1/tenants',
    { requestId: randomUUID(), name: '另一隔离企业', adminEmail: 'other-upgrade@example.test' },
    201,
  );
  const invitation = JSON.parse(
    await readFile(join(process.env.INVITATION_OUTBOX!, created.invitation.id + '.json'), 'utf8'),
  );
  await post(user.request, '/api/v1/auth/invitations/accept', {
    token: invitation.token,
    displayName: '升级演练用户',
    password,
  });
  await post(user.request, '/api/v1/auth/login', { email: 'upgrade-user@example.test', password });
  const tenant = created.tenant.id,
    rootPath = `/api/v1/tenants/${tenant}`;
  const context = await (await user.request.get(rootPath + '/context')).json(),
    space = context.workspaces.find((s: any) => s.kind === 'PERSONAL').id;
  const csrf = await (await user.request.get('/api/v1/auth/csrf')).json();
  const uploaded = await user.request.post(`${rootPath}/workspaces/${space}/materials`, {
    headers: { [csrf.headerName]: csrf.token },
    multipart: {
      metadata: {
        name: 'metadata.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ requestId: randomUUID() })),
      },
      file: {
        name: 'amount.md',
        mimeType: 'text/plain',
        buffer: Buffer.from('合成来源 amount=1001\namount=999'),
      },
    },
  });
  assert.equal(uploaded.status(), 201);
  const material = await uploaded.json(),
    materialPath = `${rootPath}/workspaces/${space}/materials/${material.id}`;
  const original = await (await user.request.get(materialPath)).json();
  await expect
    .poll(
      async () =>
        (
          await (
            await user.request.get(materialPath + `/versions/${original.versions[0].id}/analysis`)
          ).json()
        ).status,
      { timeout: 30000 },
    )
    .toBe('READY');
  async function submit(prompt = '合成升级验证', mode = 'AGENT') {
    return post(
      user.request,
      rootPath + '/conversations',
      { requestId: randomUUID(), workspaceId: space, prompt, mode },
      202,
    );
  }
  async function result(id: string, status = 'SUCCEEDED') {
    let value: any;
    await expect
      .poll(
        async () => {
          value = await (await user.request.get(rootPath + '/conversations/' + id)).json();
          return value.tasks?.at(-1)?.status;
        },
        { timeout: 25000 },
      )
      .toBe(status);
    return value;
  }
  const before = await result((await submit()).conversation.id);
  assert.equal(before.tasks[0].engineVersion, '0.9.0');
  assert.ok(before.tasks[0].sources.length);
  const savedConversationPath = rootPath + '/conversations/' + before.conversation.id;
  const savedArtifactPath =
    savedConversationPath + `/tasks/${before.tasks[0].id}/artifacts/${before.tasks[0].artifacts[0].id}`;
  const savedArtifact = await (await user.request.get(savedArtifactPath)).body();
  assert.equal(JSON.parse(savedArtifact.toString()).totalCents, '2000');
  const doc = await post(user.request, rootPath + '/documents', {
    requestId: randomUUID(),
    conversationId: before.conversation.id,
    taskId: before.tasks[0].id,
  });
  const docPath = rootPath + '/documents/' + doc.document.id,
    exportPath = docPath + '/versions/1/exports/pdf';
  const exported = await (await user.request.get(exportPath)).body();
  assert.ok(exported.subarray(0, 5).equals(Buffer.from('%PDF-')));
  const brief = await (await user.request.get(rootPath + '/briefing')).json();
  const originalCard = brief.items.find((card: any) => card.conversationId === before.conversation.id);
  assert.ok(originalCard);
  const page = await user.newPage();
  async function unchanged() {
    assert.equal(api.pid, apiPid);
    assert.equal(api.exitCode, null);
    assert.equal((await user.request.get('/api/v1/me')).status(), 200);
    assert.deepEqual(await (await user.request.get(savedConversationPath)).json(), before);
    assert.deepEqual(await (await user.request.get(savedArtifactPath)).body(), savedArtifact);
    assert.deepEqual(await (await user.request.get(exportPath)).body(), exported);
    assert.equal((await platform.request.get(savedArtifactPath)).status(), 403);
    assert.equal(
      (await user.request.get(savedConversationPath.replace(tenant, other.tenant.id))).status(),
      403,
    );
    assert.deepEqual(await (await user.request.get(materialPath)).json(), original);
    assert.deepEqual(await (await user.request.get(docPath)).json(), doc);
    const cards = await (await user.request.get(rootPath + '/briefing')).json();
    assert.deepEqual(
      cards.items.find((card: any) => card.conversationId === before.conversation.id),
      originalCard,
    );
  }
  const next = await engine(newRoot, apiUrl);
  await preflight(next.url, ENGINE_VERSION);
  assert.equal(next.calls, 0);
  await preflight(badUrl, '2.0.0', false, 1);
  assert.equal(blockedPosts, 0);
  target = next.url;
  await stop(initial.child);
  await unchanged();
  const upgraded = await result((await submit()).conversation.id);
  assert.equal(upgraded.tasks[0].engineVersion, ENGINE_VERSION);
  const lookup = await result((await submit('amount', 'SOURCE_LOOKUP')).conversation.id);
  assert.equal(lookup.tasks[0].engineVersion, ENGINE_VERSION);
  assert.ok(lookup.tasks[0].sources.length);
  // Misconfigured routing cannot send a user's task to an incompatible engine.
  target = badUrl;
  const rejected = await result((await submit()).conversation.id, 'FAILED');
  assert.equal(rejected.tasks[0].errorCode, 'TASK_RUNTIME_INCOMPATIBLE');
  assert.equal(blockedPosts, 0);
  target = next.url;
  // Real in-flight model HTTP is interrupted; no automatic model retry or invented successful reply.
  const holding = await engine(newRoot, apiUrl, true);
  target = holding.url;
  const interrupted = await submit();
  await expect.poll(() => holding.calls).toBe(1);
  await stop(holding.child);
  const failed = await result(interrupted.conversation.id, 'FAILED');
  assert.equal(failed.tasks[0].reply, null);
  assert.deepEqual(failed.tasks[0].artifacts, []);
  const rollback = await engine(oldRoot, apiUrl);
  await preflight(rollback.url, '0.9.0', true);
  target = rollback.url;
  await stop(next.child);
  await unchanged();
  const actionPath = `${rootPath}/conversations/${failed.conversation.id}/tasks/${failed.tasks[0].id}`;
  const retry = { requestId: randomUUID(), expectedRevision: failed.tasks[0].revision, action: 'RETRY' };
  await post(user.request, actionPath, retry);
  const recovered = await result(failed.conversation.id);
  assert.equal(recovered.tasks[0].engineVersion, '0.9.0');
  assert.equal(recovered.tasks[0].attempt, 2);
  const callsBeforeDuplicate = rollback.calls;
  assert.deepEqual(await post(user.request, actionPath, retry), recovered);
  assert.equal(rollback.calls, callsBeforeDuplicate);
  assert.equal(recovered.tasks.length, 1);
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations&conversation=${before.conversation.id}`);
  await expect(page.locator('.conversation-reply')).toContainText('2000 分');
  await expect(page.getByRole('button', { name: '下载 summary.json', exact: true })).toBeVisible();
  await page.screenshot({ path: join(artifacts, 'rollback-history.png'), fullPage: true });
  await unchanged();
  const tenantRoot = '/api/platform-admin/v1/tenants/' + tenant;
  const status = await (await platform.request.get(tenantRoot)).json();
  await post(platform.request, tenantRoot + '/status', {
    requestId: randomUUID(),
    expectedVersion: status.version,
    status: 'SUSPENDED',
  });
  assert.equal((await user.request.get(savedArtifactPath)).status(), 403);
  assert.equal((await user.request.get(exportPath)).status(), 403);
  await writeFile(
    join(artifacts, 'result.json'),
    JSON.stringify(
      {
        status: 'passed',
        synthetic: true,
        cloudModelCalls: 0,
        baseline,
        platformPidUnchanged: true,
        versions: ['0.9.0', ENGINE_VERSION, '0.9.0'],
        legacyOptIn: true,
        syntheticModelCalls: releaseProcesses.reduce((sum, x) => sum + x.calls, 0),
        engineHashes: {
          old: await releaseHash(oldRoot),
          next: await releaseHash(newRoot),
        },
        checks: [
          'preflight-no-model',
          'incompatible-before-prompt',
          'live-cutover-platform-unchanged',
          'lookup-and-agent',
          'historical-citations-artifacts-documents',
          'inflight-failure-explicit-idempotent-retry',
          'rollback-original-release',
          'tenant-platform-suspension-boundaries',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `PASS M7-A1: real 0.9.0 → ${ENGINE_VERSION} → 0.9.0 with one platform PID; protocols, interruption, historical artifacts and permissions.`,
  );
} finally {
  await browser?.close();
  for (const child of [...children].reverse()) await stop(child);
  await close(proxy);
  await close(incompatible);
  await rm(temp, { recursive: true, force: true });
}
