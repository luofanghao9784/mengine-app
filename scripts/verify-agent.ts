import { browserName, browserType, browserArtifacts } from './browser-target.ts';
import { ENGINE_VERSION } from '../engine/dist/release.js';
import { inspectWorkbook } from '../engine/tests/helpers/workbook.mjs';
import { publicationJourney } from './publication-journey.ts';
/** Built browser entries against the real M2-A1 API and a disposable PostgreSQL cluster. */
import { documentJourney } from './document-journey.ts';
import { briefingJourney } from './briefing-journey.ts';
import { DockerSandbox } from '../engine/dist/runtime/docker-sandbox.js';
import { fixtureEngine } from '../engine/tests/fixtures/agent.mjs';
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

const modelProvider = process.env.DREAMCORE_TEST_MODEL_PROVIDER ?? 'deepseek';
assert.ok(['deepseek', 'bailian'].includes(modelProvider), 'Unknown test model provider');
const root = new URL('../', import.meta.url);
const temp = await mkdtemp(join(tmpdir(), 'dreamcore-agent-'));
const artifacts = new URL('../' + browserArtifacts('agent', '.local/m4-agent') + '/', import.meta.url);
await mkdir(artifacts, { recursive: true });
await rm(new URL('result.json', artifacts), { force: true });
const children: ChildProcess[] = [];
const password = `synthetic-${randomUUID()}`;
const secrets: string[] = [password];
let browser: Awaited<ReturnType<typeof browserType.launch>> | undefined;
let logs = '';
let engine: Awaited<ReturnType<typeof fixtureEngine>> | undefined;
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
  await expect(page.getByRole('heading', { name: '登录梦核工作空间', exact: true })).toBeVisible();
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
  const executor = process.env.DREAMCORE_EXECUTOR_SOCKET
    ? new DockerSandbox({
        socketPath: process.env.DREAMCORE_EXECUTOR_SOCKET,
        image: process.env.DREAMCORE_EXECUTOR_IMAGE!,
        scope: process.env.DREAMCORE_EXECUTOR_SCOPE!,
      })
    : undefined;
  engine = await fixtureEngine(apiUrl, token, true, true, executor, modelProvider);
  const apiProcess = start('java', ['-jar', 'apps/api/target/workspace-api-0.1.0-SNAPSHOT.jar'], {
    API_HOST: '127.0.0.1',
    API_PORT: String(apiPort),
    ENGINE_BASE_URL: engine.url,
    TASK_ENABLED: 'true',
    TASK_ENGINE_TOKEN: token,
    AGENT_TASK_MODE: 'verification',
    AGENT_PUBLIC_WEB_ENABLED: 'true',
    AGENT_CANDIDATE_TRIALS_ENABLED: 'true',
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
    { requestId: randomUUID(), name: 'Agent 合成验证企业', adminEmail: 'agent-owner@example.test' },
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
  const materialRoot = `/api/v1/tenants/${tenant}/workspaces/${space}`;
  const csrf = await (await context.request.get('/api/v1/auth/csrf')).json();
  const upload = await context.request.post(materialRoot + '/materials', {
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
        buffer: Buffer.from('合成数据 amount=1001\namount=999'),
      },
    },
  });
  assert.equal(upload.status(), 201);
  const file = await upload.json();
  const material = await (await context.request.get(materialRoot + `/materials/${file.id}`)).json();
  const analysis = materialRoot + `/materials/${file.id}/versions/${material.versions[0].id}/analysis`;
  await expect
    .poll(async () => (await (await context.request.get(analysis)).json()).status, { timeout: 30000 })
    .toBe('READY');
  const href = `/workspace/#tenant=${tenant}&view=conversations`;
  await page.goto(href);
  await page.getByLabel('任务方式', { exact: true }).selectOption('AGENT');
  await page.getByLabel('工作要求', { exact: true }).fill('请计算 amount 合计并提供结果文件');
  await page.reload();
  await expect(page.getByLabel('工作要求', { exact: true })).toHaveValue('请计算 amount 合计并提供结果文件');
  await page.getByRole('button', { name: '开始任务', exact: true }).click();
  await expect(page.locator('.conversation-reply')).toContainText('2000 分', { timeout: 20000 });
  await expect(page.locator('.conversation-result')).toContainText('未调用真实模型');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 summary.json', exact: true }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'summary.json');
  assert.equal(JSON.parse(await readFile((await download.path())!, 'utf8')).totalCents, '2000');
  const conversation = new URLSearchParams(new URL(page.url()).hash.slice(1)).get('conversation')!;
  const conversationRoot = `/api/v1/tenants/${tenant}/conversations/${conversation}`;
  const result = await (await context.request.get(conversationRoot)).json();
  const task = result.tasks[0];
  assert.equal(task.status, 'SUCCEEDED');
  assert.equal(task.sources.length, 2);
  assert.equal(task.executionClass, 'verification');
  assert.ok(!JSON.stringify(result).includes('lease_token'));
  const artifactPath = conversationRoot + `/tasks/${task.id}/artifacts/${task.artifacts[0].id}`;
  assert.equal((await platform.get(artifactPath)).status(), 403);
  await page.reload();
  await expect(page.locator('.conversation-reply')).toContainText('2000 分');
  await screenshot(page, 'agent-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot(page, 'agent-mobile.png');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  // A stalled provider has sent headers but not its body; UI cancellation must close it.
  await page.getByLabel('任务方式', { exact: true }).selectOption('AGENT');
  await page.getByLabel('工作要求', { exact: true }).fill('等待取消');
  await page.getByRole('button', { name: '开始任务', exact: true }).click();
  await expect.poll(() => engine!.stats.calls).toBe(4);
  await expect(page.locator('.conversation-result').last()).toContainText('正在执行任务');
  const cancelResponse = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/tasks\/[^/]+$/.test(new URL(r.url()).pathname),
  );
  await page.getByRole('button', { name: '取消任务', exact: true }).click();
  assert.equal((await cancelResponse).status(), 200);
  await expect.poll(() => engine!.stats.aborted, { timeout: 5000 }).toBe(1);
  await expect(page.locator('.conversation-result').last()).toContainText('已取消');
  const cancelled = await (await context.request.get(conversationRoot)).json();
  assert.equal(cancelled.tasks.at(-1).status, 'CANCELLED');
  assert.equal(cancelled.tasks.at(-1).reply, null);
  assert.deepEqual(cancelled.tasks.at(-1).artifacts, []);
  await page.getByLabel('任务方式', { exact: true }).selectOption('AGENT');
  await page
    .getByLabel('工作要求', { exact: true })
    .fill('PUBLIC_RESEARCH 合成私密备注 PRIVATE_MARKER_DO_NOT_SEND');
  const longUrl = 'HTTPS://example.com/' + 'a'.repeat(300);
  await page.getByLabel('公开检索内容（可选）', { exact: true }).fill(longUrl);
  await expect(page.getByLabel('公开检索内容（可选）', { exact: true })).toHaveValue(longUrl);
  await page.getByLabel('公开检索内容（可选）', { exact: true }).fill('项目发布前检查');
  await page.reload();
  await expect(page.getByLabel('公开检索内容（可选）', { exact: true })).toHaveValue('项目发布前检查');
  await page.getByRole('button', { name: '开始任务', exact: true }).click();
  await expect(page.locator('.conversation-reply').last()).toContainText('已查找公开资料并读取页面', {
    timeout: 20000,
  });
  await page.getByText('公开研究样本 · 已读取页面', { exact: true }).click();
  await expect(page.getByRole('link', { name: '打开公开来源', exact: true })).toHaveAttribute(
    'rel',
    'noopener noreferrer',
  );
  assert.equal(engine.stats.webRequests.length, 2);
  assert.equal(new URL(engine.stats.webRequests[0]).searchParams.get('q'), '项目发布前检查');
  assert.ok(!JSON.stringify(engine.stats.webRequests).includes('PRIVATE_MARKER'));
  const research = (await (await context.request.get(conversationRoot)).json()).tasks.at(-1);
  assert.equal(research.status, 'SUCCEEDED');
  assert.equal(research.webSources[0].kind, 'PAGE');
  assert.equal(research.skills[0].id, 'public-research');
  assert.equal(research.publicQuery, '项目发布前检查');
  await page.reload();
  await expect(page.getByText('公开研究样本 · 已读取页面', { exact: true })).toBeVisible();
  await page.getByText('公开研究样本 · 已读取页面', { exact: true }).click();
  await screenshot(page, 'research-mobile.png');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 1440, height: 960 });
  await screenshot(page, 'research-desktop.png');
  await page.getByLabel('任务方式', { exact: true }).selectOption('AGENT');
  await page.getByLabel('工作要求', { exact: true }).fill('CANDIDATE_TRIAL PRIVATE_MARKER_DO_NOT_SEND');
  await page.getByLabel('公开检索内容（可选）', { exact: true }).fill('INI parser');
  await page.getByRole('button', { name: '开始任务', exact: true }).click();
  await expect(page.locator('.conversation-reply').last()).toContainText('候选工具已通过样例试验', {
    timeout: 20000,
  });
  const candidateTask = (await (await context.request.get(conversationRoot)).json()).tasks.at(-1);
  assert.equal(candidateTask.status, 'SUCCEEDED');
  assert.equal(candidateTask.skills[0].id, 'candidate-trials');
  assert.equal(candidateTask.artifacts.length, 2);
  assert.equal(engine.stats.candidateRequests.length, 3);
  assert.equal(new URL(engine.stats.candidateRequests[0]).searchParams.get('text'), 'INI parser');
  assert.ok(!JSON.stringify(engine.stats.candidateRequests).includes('PRIVATE_MARKER'));
  for (const name of ['converted-1.json', 'candidate-report.json']) {
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载 ' + name, exact: true }).click();
    const content = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
    if (name === 'converted-1.json') assert.deepEqual(content, { amount: '999' });
    else {
      assert.equal(content.items[0].status, 'USED');
      assert.equal(content.globallyTrusted, false);
      assert.ok(content.licenses[0].text);
    }
    const file = candidateTask.artifacts.find((f: { filename: string }) => f.filename === name);
    assert.equal(
      (await platform.get(conversationRoot + `/tasks/${candidateTask.id}/artifacts/${file.id}`)).status(),
      403,
    );
  }
  await page.reload();
  await expect(page.getByRole('button', { name: '下载 candidate-report.json', exact: true })).toBeVisible();
  await page.locator('.conversation-result').last().scrollIntoViewIfNeeded();
  await screenshot(page, 'candidate-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.conversation-result').last().scrollIntoViewIfNeeded();
  await screenshot(page, 'candidate-mobile.png');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.equal(engine.stats.calls, 15);
  // Select v1, persist the draft, then upload v2 before submission. The task must still read all of v1.
  const originalBytes = Buffer.from(
    'RAW_ONLY_MARKER,value\n' + Array.from({ length: 4000 }, (_, i) => `${i},1`).join('\n'),
  );
  const originalUpload = await context.request.post(materialRoot + '/materials', {
    headers: { [csrf.headerName]: csrf.token },
    multipart: {
      metadata: {
        name: 'metadata.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ requestId: randomUUID() })),
      },
      file: { name: 'whole-original.csv', mimeType: 'text/csv', buffer: originalBytes },
    },
  });
  assert.equal(originalUpload.status(), 201);
  const originalFile = await originalUpload.json();
  const originalDetail = await (
    await context.request.get(materialRoot + `/materials/${originalFile.id}`)
  ).json();
  const version = originalDetail.versions[0];
  await page.getByLabel('任务方式', { exact: true }).selectOption('AGENT');
  await page.getByLabel('工作要求', { exact: true }).fill('ORIGINAL_FILE 处理本次指定的文件');
  await page.getByRole('button', { name: '选择原件版本', exact: true }).click();
  await page.getByRole('dialog').getByLabel('查找文件', { exact: true }).fill('whole-original');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'whole-original.csv · v1', exact: true })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: '选择 v1', exact: true }).click();
  await page.reload();
  await expect(page.locator('.original-selection')).toContainText('whole-original.csv · v1');
  const revised = await context.request.post(materialRoot + `/materials/${originalFile.id}/versions`, {
    headers: { [csrf.headerName]: csrf.token },
    multipart: {
      metadata: {
        name: 'metadata.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ requestId: randomUUID(), expectedVersion: 1 })),
      },
      file: { name: 'whole-original.csv', mimeType: 'text/csv', buffer: Buffer.from('row,value\n0,999999') },
    },
  });
  assert.equal(revised.status(), 201);
  await page.getByRole('button', { name: '开始任务', exact: true }).click();
  await expect(page.locator('.conversation-reply').last()).toContainText('完整原件 4000 行，合计 4000', {
    timeout: 20000,
  });
  const originalTask = (await (await context.request.get(conversationRoot)).json()).tasks.at(-1);
  assert.equal(originalTask.originals[0].versionId, version.id);
  assert.equal(originalTask.originals[0].version, 1);
  assert.equal(originalTask.originals[0].read, true);
  assert.equal(originalTask.originals[0].sha256, version.sha256);
  assert.deepEqual(originalTask.sources, []);
  const originalDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 original-summary.json', exact: true }).click();
  assert.deepEqual(JSON.parse(await readFile((await (await originalDownload).path())!, 'utf8')), {
    rows: 4000,
    total: '4000',
  });
  assert.equal(
    (
      await platform.get(
        conversationRoot + `/tasks/${originalTask.id}/artifacts/${originalTask.artifacts[0].id}`,
      )
    ).status(),
    403,
  );
  await page.reload();
  await expect(page.locator('.conversation-originals').last()).toContainText('whole-original.csv · v1');
  await expect(page.locator('.conversation-originals').last()).toContainText('已读取原件');
  await page.locator('.conversation-result').last().scrollIntoViewIfNeeded();
  await screenshot(page, 'original-mobile.png');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 1440, height: 960 });
  await screenshot(page, 'original-desktop.png');
  assert.equal(engine.stats.calls, 19);

  let excelArtifactPath: string | undefined;
  // Trusted recipes use complete selected versions; malformed/unsupported files remain failed.
  for (const spec of [
    {
      name: 'recipe-table.csv',
      prompt: 'FILE_RECIPE CSV',
      content: 'team,amount,note\n"A,B",0.1,"first\nsecond"\n"A,B",0.2,"a""b"\nC,10,done\n',
      expected: '完整表格 3 行，精确合计 10.3',
      output: 'table-summary-1.json',
    },
    {
      name: 'recipe-note.md',
      prompt: 'FILE_RECIPE TEXT',
      content: '标题\r\n<script>literal</script>\r\n第三行\r\n',
      expected: '已提取第 2—3 行',
      output: 'extracted-1.txt',
    },
    {
      name: 'recipe-unsupported.xlsx',
      prompt: 'FILE_RECIPE BAD',
      content: 'synthetic unsupported file',
      expected: '当前处理工具不支持这个文件格式',
      output: '',
    },
  ]) {
    const upload = await context.request.post(materialRoot + '/materials', {
      headers: { [csrf.headerName]: csrf.token },
      multipart: {
        metadata: {
          name: 'metadata.json',
          mimeType: 'application/json',
          buffer: Buffer.from(JSON.stringify({ requestId: randomUUID() })),
        },
        file: { name: spec.name, mimeType: 'application/octet-stream', buffer: Buffer.from(spec.content) },
      },
    });
    assert.equal(upload.status(), 201);
    const file = await upload.json();
    const fileDetail = await (await context.request.get(materialRoot + `/materials/${file.id}`)).json();
    await page.getByLabel('工作要求', { exact: true }).fill(spec.prompt);
    await page.getByRole('button', { name: '选择原件版本', exact: true }).click();
    await page.getByRole('dialog').getByLabel('查找文件', { exact: true }).fill(spec.name);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: spec.name + ' · v1', exact: true })
      .click();
    await page.getByRole('dialog').getByRole('button', { name: '选择 v1', exact: true }).click();
    if (spec.output === 'table-summary-1.json') {
      const updated = await context.request.post(materialRoot + `/materials/${file.id}/versions`, {
        headers: { [csrf.headerName]: csrf.token },
        multipart: {
          metadata: {
            name: 'metadata.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify({ requestId: randomUUID(), expectedVersion: 1 })),
          },
          file: { name: spec.name, mimeType: 'text/csv', buffer: Buffer.from('team,amount\nNEW,999999\n') },
        },
      });
      assert.equal(updated.status(), 201);
    }
    await page.getByRole('button', { name: '开始任务', exact: true }).click();
    const turn = page.locator('.conversation-turn').last();
    await expect(turn).toContainText(spec.expected, { timeout: 20000 });
    const saved = (await (await context.request.get(conversationRoot)).json()).tasks.at(-1);
    assert.equal(saved.originals[0].versionId, fileDetail.versions[0].id);
    if (!spec.output) {
      assert.equal(saved.status, 'FAILED');
      assert.equal(saved.errorCode, 'TASK_FILE_UNSUPPORTED');
      assert.deepEqual(saved.artifacts, []);
      await page.reload();
      await expect(page.locator('.conversation-turn').last()).toContainText(spec.expected);
      continue;
    }
    assert.equal(saved.status, 'SUCCEEDED');
    assert.equal(saved.skills[0].id, 'file-processing');
    const transfer = page.waitForEvent('download');
    await turn.getByRole('button', { name: '下载 ' + spec.output, exact: true }).click();
    const output = await readFile((await (await transfer).path())!, 'utf8');
    if (spec.output === 'table-summary-1.json') {
      assert.equal(JSON.parse(output).total, '10.3');
      assert.equal(JSON.parse(output).groups[0].total, '0.3');
    } else assert.equal(output, '<script>literal</script>\n第三行');
    const provenance = page.waitForEvent('download');
    await turn.getByRole('button', { name: '下载 processing-report-1.json', exact: true }).click();
    const report = JSON.parse(await readFile((await (await provenance).path())!, 'utf8'));
    assert.equal(report.versionId, fileDetail.versions[0].id);
    assert.equal(report.inputSha256, fileDetail.versions[0].sha256);
    assert.equal(report.recipeVersion, '1.1.0');
    if (spec.output === 'table-summary-1.json') {
      const transfer = page.waitForEvent('download');
      await turn.getByRole('button', { name: '下载 table-summary-1.xlsx', exact: true }).click();
      const download = await transfer;
      assert.equal(download.suggestedFilename(), 'table-summary-1.xlsx');
      const bytes = await readFile((await download.path())!);
      const parsed = inspectWorkbook(bytes);
      assert.equal(parsed.sheets[0].B8.value, '10.3');
      assert.equal(parsed.sheets[0].E11.value, '0.3');
      assert.equal(parsed.sheets[1].B4.value, '1');
      assert.equal(parsed.sheets[1].B5.value, fileDetail.versions[0].id);
      const excel = saved.artifacts.find((a: { filename: string }) => a.filename === 'table-summary-1.xlsx');
      assert.equal(report.workbook.sha256, excel.sha256);
      assert.equal(report.workbook.bytes, bytes.length);
      assert.equal(saved.engineVersion, ENGINE_VERSION);
      excelArtifactPath = conversationRoot + `/tasks/${saved.id}/artifacts/${excel.id}`;
      assert.equal((await platform.get(excelArtifactPath)).status(), 403);
      await writeFile(new URL('table-summary.xlsx', artifacts), bytes);
      await screenshot(page, 'excel-result-desktop.png');
      await page.setViewportSize({ width: 390, height: 844 });
      await turn
        .getByRole('button', { name: '下载 table-summary-1.xlsx', exact: true })
        .scrollIntoViewIfNeeded();
      await screenshot(page, 'excel-result-mobile.png');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.reload();
      await expect(page.locator('.conversation-turn').last()).toContainText(spec.expected);
      assert.deepEqual(await (await context.request.get(excelArtifactPath)).body(), bytes);
    }
  }
  assert.equal(engine.stats.calls, 34);
  await screenshot(page, 'file-recipes-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.conversation-turn').last().scrollIntoViewIfNeeded();
  await screenshot(page, 'file-recipes-mobile.png');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  try {
    await briefingJourney(page, context.request, platform, tenant, conversation, screenshot);
  } catch (error) {
    await screenshot(page, 'briefing-failure.png');
    throw error;
  }
  try {
    await documentJourney(page, context.request, platform, tenant, conversation, screenshot, (id) =>
      publicationJourney(page, context.request, platform, tenant, id, password, invitation, screenshot),
    );
  } catch (error) {
    await screenshot(page, 'documents-failure.png');
    throw error;
  }
  assert.equal(engine.stats.calls, 34);
  assert.ok(excelArtifactPath);
  assert.equal((await context.request.get(excelArtifactPath)).status(), 403);
  assert.deepEqual(errors, []);
  await writeFile(
    new URL('result.json', artifacts),
    JSON.stringify(
      {
        browser: browserName,
        browserVersion: browser!.version(),
        modelProvider,
        verified: [
          'real PostgreSQL V14',
          'shared material activity without private lineage, exact version download, workspace filter and focus revocation',
          'real XLSX result snapshot, exact decimals and pinned v1 after v2 upload, source metadata and hash, reload download and suspension refusal',
          'independent shared publication, real recipient reads and parsing, explicit target versions, uncertain retries and target revocation',
          'private source-linked documents, drafts, immutable versions, conflict preservation, verified DOCX/PDF downloads and revocation clearing',
          'real local parser',
          'private briefing deduplicates latest successful reply, durable focus/hide/resize, historical task anchors and CSRF isolation',
          `${modelProvider} Chat Completions HTTP fixture`,
          'actual Harness and sandbox computation',
          'private artifact and SHA download',
          'draft restore and history reload',
          'cancel aborts provider body',
          'desktop and mobile',
          'trusted catalog and exact-version activation',
          'SearXNG HTTP fixture and public page snapshot',
          'immutable public query excludes private prompt',
          'candidate archive admission, offline staging, synthetic trial and task-local reuse',
          'converted JSON and provenance report remain private after reload',
          'explicit original v1 remains pinned after v2 upload; all 4000 rows computed; raw bytes excluded from model messages',
          'trusted CSV exact decimals and quoted multiline fields; TXT/Markdown literal line extraction; private provenance and unsupported-format failure',
        ],
        cloudModelCalled: false,
        sandbox: executor?.isolation ?? 'local-macos-prototype',
        modelRequests: engine.stats.calls,
        taskStatus: task.status,
        cancelStatus: cancelled.tasks.at(-1).status,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'PASS: Agent browser → platform → model HTTP fixture → real Harness/tool artifact; cancellation propagated; no cloud model call.',
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
  await engine?.stop();
  await rm(temp, { recursive: true, force: true });
}
