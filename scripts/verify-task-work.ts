import { browserType, browserArtifacts } from './browser-target.ts';
import { taskWorkJourney } from './task-work-journey.ts';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { request, expect, type APIRequestContext, type Page } from '@playwright/test';
const root = new URL('../', import.meta.url);
const temp = await mkdtemp(join(tmpdir(), 'dreamcore-task-work-'));
const artifacts = new URL('../' + browserArtifacts('task-work', '.local/task-work') + '/', import.meta.url);
await mkdir(artifacts, { recursive: true });
await rm(new URL('result.json', artifacts), { force: true });
const children: ChildProcess[] = [];
const password = `synthetic-${randomUUID()}`;
const secrets: string[] = [password];
let browser: Awaited<ReturnType<typeof browserType.launch>> | undefined;
let logs = '';
const clean = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) =>
      !/^(AGENT_|ENGINE_|TASK_|SPRING_|BOOTSTRAP_|SERVER_|API_|DREAMCORE_|KNOWLEDGE_)/.test(k) &&
      !['JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS'].includes(k),
  ),
);
clean.SPRING_PROFILES_ACTIVE = 'local';
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
    env: { ...clean, ...env },
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
        BOOTSTRAP_EMAIL: 'platform-agent@example.test',
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
  const token = 'synthetic-engine-' + randomUUID();
  secrets.push(token);
  const engineProcess = start(process.execPath, [
    'engine/tests/fixtures/task-work-server.mjs',
    apiUrl,
    token,
  ]);
  const engineUrl = await new Promise<string>((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(Error('Owned synthetic engine did not start')), 15000);
    engineProcess.stdout!.on('data', (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    });
    engineProcess.once('exit', () => {
      clearTimeout(timeout);
      reject(Error('Owned synthetic engine exited'));
    });
  });
  const apiProcess = start('java', ['-jar', 'apps/api/target/workspace-api-0.1.0-SNAPSHOT.jar'], {
    API_HOST: '127.0.0.1',
    API_PORT: String(apiPort),
    ENGINE_BASE_URL: engineUrl,
    TASK_ENABLED: 'true',
    TASK_ENGINE_TOKEN: token,
    AGENT_TASK_MODE: 'verification',
    AGENT_PUBLIC_WEB_ENABLED: 'false',
    AGENT_CANDIDATE_TRIALS_ENABLED: 'false',
    KNOWLEDGE_ENABLED: 'true',
    KNOWLEDGE_PARSER_ROOT: fileURLToPath(new URL('../workers/parser', import.meta.url)),
  });
  await ready(apiUrl + '/actuator/health', apiProcess);
  const info = await (await fetch(apiUrl + '/api/v1/system/info')).json();
  assert.equal(info.integrations.harness, 'verification');
  assert.equal(info.engine.runtimeMode, 'agent-verification');
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
  await post(platform, '/api/v1/auth/login', { email: 'platform-agent@example.test', password });
  const created = await post(
    platform,
    '/api/platform-admin/v1/tenants',
    {
      requestId: randomUUID(),
      name: 'Agent 合成验证企业',
      adminEmail: 'agent-owner@example.test',
      ...(process.argv.includes('--output-only') ? { designateAuthorizationOwner: true } : {}),
    },
    201,
  );
  const tenant = created.tenant.id;
  browser = await browserType.launch();
  const context = await browser.newContext({ baseURL: webUrl, viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.name));
  await post(context.request, '/api/v1/auth/invitations/accept', {
    token: await invitation(created.invitation.id),
    displayName: '合成使用者',
    password,
  });
  await page.goto('/workspace/');
  await login(page, 'agent-owner@example.test');
  const scope = await (await context.request.get(`/api/v1/tenants/${tenant}/context`)).json();
  const space = scope.workspaces.find((w: { kind: string }) => w.kind === 'PERSONAL').id;
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations`);
  await page.getByLabel('任务方式', { exact: true }).selectOption('AGENT');
  await page.getByLabel('工作要求', { exact: true }).fill('请记住，以后回答简洁一些');
  await page.getByRole('button', { name: '开始任务', exact: true }).click();
  await expect(page.locator('.conversation-reply')).toContainText('已保存个人表达偏好', { timeout: 30000 });
  const conversation = new URLSearchParams(new URL(page.url()).hash.slice(1)).get('conversation')!;
  const detail = await (
    await context.request.get(`/api/v1/tenants/${tenant}/conversations/${conversation}`)
  ).json();
  const task = detail.tasks.at(-1);
  assert.equal(task.status, 'SUCCEEDED');
  assert.equal(task.executionClass, 'verification');
  await taskWorkJourney(page, context.request, tenant, task.id, conversation, fileURLToPath(artifacts));
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      task: task.id,
      realHarness: true,
      realApi: true,
      realPreferenceVersion: true,
      sameKeyUndo: true,
      model: 'synthetic local transport only',
    }),
  );
  await platform.dispose();
  await context.close();
} catch (error) {
  let safe = logs;
  for (const secret of secrets) safe = safe.replaceAll(secret, '[redacted]');
  console.error(safe);
  throw error;
} finally {
  await browser?.close();
  for (const child of children.reverse()) await stop(child);
  await rm(temp, { recursive: true, force: true });
}
