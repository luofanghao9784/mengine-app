import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import Ajv2020 from 'ajv/dist/2020.js';
const schema = JSON.parse(
  await readFile(new URL('../../contracts/engine-api/runtime.schema.json', import.meta.url), 'utf8'),
);
const valid = new Ajv2020().compile(schema);
const descriptor = {
  contractVersion: '1.0',
  engineVersion: '0.9.1',
  runtimeMode: 'agent-verification',
  protocols: { sourceLookup: '1.0', agentTask: '1.4', platformCallbacks: '1.3' },
};
test('runtime contract describes protocol versions independently of engine release', () => {
  assert.ok(valid(descriptor));
  assert.ok(valid({ ...descriptor, engineVersion: '0.10.0' }));
  for (const value of [
    { ...descriptor, contractVersion: '2.0' },
    { ...descriptor, protocols: { sourceLookup: '1.0' } },
    { ...descriptor, engineVersion: '0.9.1 secret' },
    { ...descriptor, token: 'never-advertise' },
  ])
    assert.equal(valid(value), false);
});
test('operator preflight rejects incompatible versions, modes and oversized replies without POST', async (t) => {
  let body = descriptor,
    oversized = false,
    posts = 0;
  const token = 'synthetic-preflight-token-'.repeat(2);
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    if (req.method === 'POST') posts++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(oversized ? 'x'.repeat(20000) : JSON.stringify(body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  async function check(mode = 'agent-verification', version = '0.9.1') {
    const child = spawn(
      process.execPath,
      [
        'scripts/check-engine.mjs',
        '--url',
        `http://127.0.0.1:${server.address().port}`,
        '--expected-version',
        version,
        '--mode',
        mode,
      ],
      {
        cwd: new URL('../../', import.meta.url),
        env: { ...process.env, TASK_ENGINE_TOKEN: token },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (c) => (output += c));
    child.stderr.on('data', (c) => (output += c));
    const [status] = await once(child, 'exit');
    assert.ok(!output.includes(token));
    return status;
  }
  assert.equal(await check(), 0);
  body = { ...descriptor, protocols: { ...descriptor.protocols, platformCallbacks: '1.4' } };
  assert.equal(await check(), 0);
  body = { ...descriptor, protocols: { ...descriptor.protocols, platformCallbacks: '1.5' } };
  assert.equal(await check(), 1);
  body = { ...descriptor, protocols: { ...descriptor.protocols, agentTask: '1.5' } };
  assert.equal(await check(), 0);
  body = descriptor;
  assert.equal(await check('agent-live'), 1);
  assert.equal(await check('agent-verification', '0.9.0'), 1);
  body = { ...descriptor, protocols: { ...descriptor.protocols, agentTask: '2.0' } };
  assert.equal(await check(), 1);
  assert.equal(await check('source-lookup'), 0);
  oversized = true;
  assert.equal(await check(), 1);
  assert.equal(posts, 0);
});
