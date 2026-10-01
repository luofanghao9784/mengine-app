/** Synthetic real-parser acceptance through HTTP and browser; no model or engine tasks. */
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect, type APIRequestContext } from '@playwright/test';
import type { KnowledgeAnalysis, KnowledgeResults } from '../contracts/public-api/knowledge';
const root = new URL('../', import.meta.url),
  temp = await mkdtemp(join(tmpdir(), 'dreamcore-formats-'));
const artifacts = new URL('../.local/m7-formats/', import.meta.url);
await mkdir(artifacts, { recursive: true });
await rm(new URL('result.json', artifacts), { force: true });
const children: ChildProcess[] = [],
  password = 'synthetic-' + randomUUID();
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
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
      KNOWLEDGE_ENABLED: 'true',
      KNOWLEDGE_PARSER_ROOT: fileURLToPath(new URL('../workers/parser/', import.meta.url)),
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
interface Fixture {
  name: string;
  sha256: string;
  status: KnowledgeAnalysis['status'];
  warnings: string[];
  query: string | null;
  locator: string | null;
  method: string | null;
}
const digest = (b: Buffer) => createHash('sha256').update(b).digest('hex');
try {
  const fixtureDir = fileURLToPath(new URL('fixtures/', artifacts));
  execFileSync('workers/parser/.venv/bin/python', ['scripts/knowledge/fixtures.py', fixtureDir], {
    cwd: root,
  });
  const fixtures: Fixture[] = JSON.parse(await readFile(join(fixtureDir, 'manifest.json'), 'utf8'));
  const secret = join(temp, 'password');
  await writeFile(secret, password, { mode: 0o600 });
  const jar = 'apps/api/target/workspace-api-0.1.0-SNAPSHOT.jar';
  assert.equal(
    await exited(
      start('java', ['-jar', jar, '--bootstrap-admin'], {
        BOOTSTRAP_EMAIL: 'formats-platform@example.test',
        BOOTSTRAP_PASSWORD_FILE: secret,
        KNOWLEDGE_ENABLED: 'false',
      }),
    ),
    0,
  );
  const apiPort = await port(),
    webPort = await port();
  const apiUrl = `http://127.0.0.1:${apiPort}`,
    webUrl = `http://127.0.0.1:${webPort}`;
  await ready(
    apiUrl + '/actuator/health',
    start('java', ['-jar', jar], { API_HOST: '127.0.0.1', API_PORT: apiPort }),
  );
  await ready(
    webUrl,
    start(
      process.execPath,
      ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', webPort, '--strictPort'],
      { DREAMCORE_DEV_API_URL: apiUrl },
    ),
  );
  browser = await chromium.launch();
  const platform = await browser.newContext({ baseURL: webUrl }),
    user = await browser.newContext({ baseURL: webUrl, viewport: { width: 1440, height: 1000 } }),
    outsider = await browser.newContext({ baseURL: webUrl });
  await post(platform.request, '/api/v1/auth/login', { email: 'formats-platform@example.test', password });
  async function enterprise(name: string, email: string, api: APIRequestContext) {
    const result = await post(
      platform.request,
      '/api/platform-admin/v1/tenants',
      {
        requestId: randomUUID(),
        name,
        adminEmail: email,
      },
      201,
    );
    const invitation = JSON.parse(
      await readFile(join(process.env.INVITATION_OUTBOX!, result.invitation.id + '.json'), 'utf8'),
    );
    await post(api, '/api/v1/auth/invitations/accept', {
      token: invitation.token,
      displayName: name + '管理员',
      password,
    });
    await post(api, '/api/v1/auth/login', { email, password });
    return uuid(result.tenant.id);
  }
  const tenant = await enterprise('合成格式企业 A', 'formats-a@example.test', user.request),
    other = await enterprise('合成格式企业 B', 'formats-b@example.test', outsider.request);
  const context = await (await user.request.get(`/api/v1/tenants/${tenant}/context`)).json();
  const space = uuid(context.workspaces.find((w: { kind: string }) => w.kind === 'PERSONAL').id);
  const base = `/api/v1/tenants/${tenant}/workspaces/${space}`;
  async function upload(name: string, bytes: Buffer, previous?: { id: string; version: number }) {
    const csrf = await (await user.request.get('/api/v1/auth/csrf')).json();
    const result = await user.request.post(
      base + '/materials' + (previous ? `/${previous.id}/versions` : ''),
      {
        headers: { [csrf.headerName]: csrf.token },
        multipart: {
          metadata: {
            name: 'metadata.json',
            mimeType: 'application/json',
            buffer: Buffer.from(
              JSON.stringify({
                requestId: randomUUID(),
                ...(previous ? { expectedVersion: previous.version } : {}),
              }),
            ),
          },
          file: { name, mimeType: 'application/octet-stream', buffer: bytes },
        },
      },
    );
    assert.equal(result.status(), 201, name);
    const entry = await result.json();
    const detail = await (await user.request.get(base + `/materials/${entry.id}`)).json();
    return { id: uuid(entry.id), version: entry.version as number, versionId: uuid(detail.versions[0].id) };
  }
  type Uploaded = Awaited<ReturnType<typeof upload>>;
  function versionPath(file: Uploaded) {
    return base + `/materials/${file.id}/versions/${file.versionId}`;
  }
  async function analysis(file: Uploaded, expected: string) {
    let value!: KnowledgeAnalysis;
    await expect
      .poll(
        async () => {
          const result = await user.request.get(versionPath(file) + '/analysis');
          assert.equal(result.status(), 200);
          assert.equal(result.headers()['cache-control'], 'private, no-store');
          value = await result.json();
          return value.status;
        },
        { timeout: 45000, message: `analysis ${expected}` },
      )
      .toBe(expected);
    assert.equal(value.parserVersion, 'local-3');
    return value;
  }
  async function search(query: string) {
    const result = await user.request.get(
      `/api/v1/tenants/${tenant}/knowledge/search?` +
        new URLSearchParams({ q: query, workspace: space, limit: '50' }),
    );
    assert.equal(result.status(), 200);
    return (await result.json()) as KnowledgeResults;
  }
  const files = new Map<string, Uploaded>(),
    results = [];
  for (const fixture of fixtures) {
    const file = await upload(fixture.name, await readFile(join(fixtureDir, fixture.name)));
    files.set(fixture.name, file);
    const value = await analysis(file, fixture.status);
    assert.deepEqual([...value.warnings].sort(), [...fixture.warnings].sort(), fixture.name);
    const downloaded = await user.request.get(versionPath(file) + '/download');
    assert.equal(downloaded.status(), 200);
    assert.equal(digest(await downloaded.body()), fixture.sha256);
    if (fixture.query) {
      const found = (await search(fixture.query)).items.find((c) => c.materialId === file.id);
      assert.ok(found, fixture.name);
      assert.equal(found.locator, fixture.locator);
      assert.equal(found.method, fixture.method);
      const path = `/api/v1/tenants/${tenant}/knowledge/chunks/${found.id}`;
      const citation = await user.request.get(path);
      assert.equal(citation.status(), 200);
      assert.deepEqual(await citation.json(), found);
      assert.equal((await platform.request.get(path)).status(), 403);
      assert.equal((await outsider.request.get(path)).status(), 403);
      assert.equal(
        (await outsider.request.get(`/api/v1/tenants/${other}/knowledge/chunks/${found.id}`)).status(),
        404,
      );
    } else {
      assert.deepEqual(value.chunks, []);
    }
    assert.equal((await outsider.request.get(versionPath(file) + '/analysis')).status(), 403);
    assert.equal((await platform.request.get(versionPath(file) + '/download')).status(), 403);
    results.push({
      name: fixture.name,
      sha256: fixture.sha256,
      status: value.status,
      warnings: value.warnings,
      parserVersion: value.parserVersion,
    });
    console.log(`PASS format ${fixture.name}: ${value.status}`);
  }
  // A failed new version must not silently fall back to old searchable content.
  const original = files.get('01-中文.TXT')!;
  const fixed = (await search('FORMATTXT')).items.find((c) => c.materialId === original.id)!;
  const broken = await upload('01-中文.TXT', Buffer.alloc(0), original);
  await analysis(broken, 'FAILED');
  assert.equal((await search('FORMATTXT')).items.length, 0);
  const recovered = await upload('01-中文.TXT', Buffer.from('FORMATRECOVERED 更正后版本'), broken);
  await analysis(recovered, 'READY');
  assert.equal((await search('FORMATRECOVERED')).items.length, 1);
  const citationPath = `/api/v1/tenants/${tenant}/knowledge/chunks/${fixed.id}`;
  assert.deepEqual(await (await user.request.get(citationPath)).json(), fixed);
  const reparsePath = versionPath(original) + '/analysis';
  const request = { requestId: randomUUID(), expectedGeneration: 1 };
  await post(user.request, reparsePath, request, 202);
  const reparsed = await analysis(original, 'READY');
  assert.equal(reparsed.generation, 2);
  assert.notEqual(reparsed.chunks[0].runId, fixed.runId);
  await post(user.request, reparsePath, request, 202);
  assert.equal((await analysis(original, 'READY')).generation, 2);
  assert.deepEqual(await (await user.request.get(citationPath)).json(), fixed);
  assert.equal((await search('FORMATTXT')).items.length, 0);

  const page = await user.newPage(),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.name));
  async function show(name: string) {
    await page.goto(`/workspace/#tenant=${tenant}&view=library&scope=personal`);
    await page.getByLabel('搜索资料名称').fill(name);
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await page.locator('.material-entry').filter({ hasText: name }).click();
    await page.getByRole('button', { name: '查看 v1 解析', exact: true }).click();
    return page.getByLabel('版本解析内容');
  }
  let panel = await show('07-公式无缓存.xlsx');
  await expect(panel).toContainText('部分公式没有缓存值');
  await expect(panel).toContainText('SUM(B1:B1)');
  await page.screenshot({
    path: fileURLToPath(new URL('formula-desktop.png', artifacts)),
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  panel = await show('15-全空表格.csv');
  await expect(panel).toContainText('未提取到可检索文字');
  await expect(panel).toContainText('原件已保留');
  await expect(panel.locator('.knowledge-fragment')).toHaveCount(0);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  panel = await show('16-损坏.pdf');
  await expect(panel).toContainText('请确认原件能够正常打开、未加密且扩展名正确');
  await page.screenshot({
    path: fileURLToPath(new URL('failed-desktop.png', artifacts)),
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  panel = await show('18-不支持.pptx');
  await expect(panel).toContainText('当前资料库不会自动安装工具或转换此格式');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: fileURLToPath(new URL('unsupported-mobile.png', artifacts)),
    fullPage: true,
    animations: 'disabled',
  });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  panel = await show('02-文稿.md');
  await expect(panel).toContainText('<script>window.__formatInjected=true</script>');
  assert.equal(
    await page.evaluate(() => Boolean((window as unknown as Record<string, unknown>).__formatInjected)),
    false,
  );
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  panel = await show('13-旋转手机照片.jpg');
  await expect(panel).toContainText('文字来自 OCR');
  await expect(panel).toContainText('123.45');
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '搜索内容', exact: true }).click();
  await page.getByLabel('内容关键词').fill('FORMATDIMENSION');
  await page.getByRole('button', { name: '检索', exact: true }).click();
  await page.locator('.knowledge-result').click();
  await expect(page.locator('.knowledge-fragment')).toContainText('B3="FORMATDIMENSION"');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: fileURLToPath(new URL('citation-mobile.png', artifacts)),
    fullPage: true,
    animations: 'disabled',
  });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  await writeFile(
    new URL('result.json', artifacts),
    JSON.stringify(
      {
        status: 'passed',
        synthetic: true,
        cloudModelCalls: 0,
        fixtures: results,
        checks: [
          'original-byte-integrity',
          'real-parser',
          'warnings',
          'search-locators',
          'fixed-citations',
          'two-tenants',
          'platform-content-denied',
          'failed-version-no-fallback',
          'corrected-version',
          'reparse-idempotency',
          'history-preserved',
          'failure-and-unsupported-ui',
          'literal-html',
          'desktop-and-mobile-viewport',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'PASS M7-A1 formats: 21 synthetic files, real parsing/search/citations, permissions and browser messages; zero model calls.',
  );
} finally {
  await browser?.close();
  for (const p of [...children].reverse()) await stop(p);
  await rm(temp, { recursive: true, force: true });
}
