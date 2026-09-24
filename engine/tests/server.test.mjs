import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { ENGINE_VERSION } from '../dist/release.js';
import { createEngineServer } from '../dist/server.js';

test('engine advertises only implemented capability and rejects task execution', async (t) => {
  const server = createEngineServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const url = `http://127.0.0.1:${server.address().port}`;
  const capabilities = await fetch(url + '/internal/v1/capabilities');
  assert.equal(capabilities.headers.get('cache-control'), 'no-store');
  const data = await capabilities.json();
  assert.equal(data.runtimeMode, 'contract-only');
  assert.deepEqual(data.capabilities, []);
  assert.equal(data.contractVersion, '1.0');
  assert.equal((await fetch(url + '/internal/v1/tasks', { method: 'POST' })).status, 405);
  assert.equal((await fetch(url + '/unknown')).status, 404);
  assert.deepEqual(await (await fetch(url + '/healthz')).json(), { status: 'UP' });
});

test('authorized local lookup returns only supplied source IDs and advertises no model capability', async (t) => {
  const token = 'synthetic-'.repeat(5),
    server = createEngineServer({ token }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  const input = {
    contractVersion: '1.0',
    taskId: '00000000-0000-4000-8000-000000000001',
    attemptId: '00000000-0000-4000-8000-000000000002',
    sourceIds: ['00000000-0000-4000-8000-000000000003'],
  };
  const post = (data = input, auth = token) =>
    fetch(base + '/internal/v1/source-results', {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  assert.equal((await post(input, 'wrong')).status, 401);
  assert.deepEqual((await (await fetch(base + '/internal/v1/capabilities')).json()).capabilities, [
    'source-lookup',
  ]);
  const response = await post();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.sourceIds, input.sourceIds);
  assert.equal(result.taskId, input.taskId);
  assert.equal(result.attemptId, input.attemptId);
  assert.equal(result.summaryCode, 'SOURCES_FOUND');
  assert.equal(result.mode, 'SOURCE_LOOKUP');
  assert.equal('text' in result, false);
  assert.equal((await (await post({ ...input, sourceIds: [] })).json()).summaryCode, 'NO_SOURCES');
  for (const invalid of [
    null,
    {},
    { ...input, contractVersion: '2.0' },
    { ...input, sourceIds: [...input.sourceIds, ...input.sourceIds] },
    { ...input, taskId: 'bad' },
    { ...input, sourceIds: ['not-a-uuid'] },
    { ...input, command: 'sh' },
  ])
    assert.equal((await post(invalid)).status, 400);
  assert.equal((await post({ ...input, extra: 'x'.repeat(9000) })).status, 413);
});

test('runtime protocol manifest is authenticated and pins the artifact before any agent work', async (t) => {
  let calls = 0;
  const token = 'synthetic-runtime-token-'.repeat(3);
  const server = createEngineServer({
    token,
    agent: {
      config: { executionClass: 'verification' },
      run: () => {
        calls++;
        throw Error('must not run');
      },
    },
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/internal/v1/runtime')).status, 401);
  const response = await fetch(base + '/internal/v1/runtime', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const manifest = await response.json();
  assert.equal(manifest.engineVersion, ENGINE_VERSION);
  assert.equal(manifest.runtimeMode, 'agent-verification');
  assert.deepEqual(manifest.protocols, { sourceLookup: '1.0', agentTask: '1.4', platformCallbacks: '1.3' });
  for (const path of ['/internal/v1/source-results', '/internal/v1/agent-results']) {
    const stale = await fetch(base + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-Dreamcore-Engine-Version': '0.9.0' },
      body: '{}',
    });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, 'TASK_RUNTIME_INCOMPATIBLE');
  }
  assert.equal(calls, 0);
  const pkg = JSON.parse(
    await (await import('node:fs/promises')).readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.equal(manifest.engineVersion, pkg.version);
});
