import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { DockerSandbox, executorLimits } from '../dist/runtime/docker-sandbox.js';
import { jobArchive, dockerStdout } from '../dist/runtime/docker-api.js';
const image = 'sha256:' + 'a'.repeat(64),
  scope = 'dc-control-tests';
const record = {
  'io.dreamcore.executor.scope': scope,
  'io.dreamcore.executor.managed': '1',
  'io.dreamcore.executor.expires': '100',
};
const info = {
  OSType: 'linux',
  CgroupVersion: '2',
  CgroupDriver: 'systemd',
  SecurityOptions: ['name=rootless', 'name=seccomp,profile=builtin'],
};
const artifact = {
  name: 'result.txt',
  contentBase64: Buffer.from('actual').toString('base64'),
  sha256: createHash('sha256').update('actual').digest('hex'),
};
const wire = (value) => {
  const bytes = Buffer.from(JSON.stringify(value) + '\n'),
    header = Buffer.alloc(8);
  header[0] = 1;
  header.writeUInt32BE(bytes.length, 4);
  return Buffer.concat([header, bytes]);
};
async function fixture(t, options = {}) {
  const directory = await mkdtemp('/tmp/dc-docker-'),
    socketPath = directory + '/s';
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const b of req) chunks.push(b);
    const bytes = Buffer.concat(chunks),
      path = req.url.replace('/v1.47', '');
    const body =
      req.headers['content-type'] === 'application/json' && bytes.length ? JSON.parse(bytes) : bytes;
    calls.push({ method: req.method, path, body });
    const json = (value, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (options.handle?.({ req, res, path, body, json, calls })) return;
    if (path === '/info') return json(options.info ?? info);
    if (path.startsWith('/images/')) return json({ Id: image });
    if (path.startsWith('/containers/json')) return json(options.containers ?? []);
    if (path.startsWith('/volumes?')) return json({ Volumes: options.volumes ?? [] });
    if (path === '/volumes/create') return json({ Name: body.Name }, 201);
    if (path.startsWith('/containers/create')) return json({ Id: 'b'.repeat(64) }, 201);
    if (path.endsWith('/json')) return json({ State: { ExitCode: 0, OOMKilled: false } });
    if (path.includes('/logs?'))
      return res.end(wire(options.result ?? { version: '1.0', ok: true, stdout: '', artifacts: [artifact] }));
    if (path.includes('/wait?')) return json({ StatusCode: 0 });
    res.writeHead(204);
    res.end();
  }).listen(socketPath);
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await rm(directory, { recursive: true, force: true });
  });
  return { sandbox: new DockerSandbox({ socketPath, image, scope }), calls, socketPath };
}
test('OCI job has immutable image, read-only input volume, no network/mounts/secrets, hard resource policy and cleanup', async (t) => {
  const { sandbox, calls } = await fixture(t);
  const result = await sandbox.run(
    "console.log('synthetic')",
    [{ handle: 'allowed.txt', bytes: Buffer.from('allowed') }],
    new AbortController().signal,
  );
  assert.equal(Buffer.from(result.artifacts[0].bytes).toString(), 'actual');
  const creates = calls.filter((c) => c.path.startsWith('/containers/create'));
  assert.equal(creates.length, 2);
  const task = creates[1].body,
    stage = creates[0].body;
  assert.equal(task.Image, image);
  assert.equal(task.User, '65532:65532');
  assert.equal(task.HostConfig.NetworkMode, 'none');
  assert.equal(task.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(task.HostConfig.CapDrop, ['ALL']);
  assert.deepEqual(task.HostConfig.SecurityOpt, ['no-new-privileges:true']);
  assert.equal(task.HostConfig.Memory, executorLimits.memory);
  assert.equal(task.HostConfig.MemorySwap, executorLimits.memory);
  assert.equal(task.HostConfig.PidsLimit, 32);
  assert.equal(task.HostConfig.NanoCpus, 500000000);
  assert.equal(task.HostConfig.Mounts[0].Type, 'volume');
  assert.equal(task.HostConfig.Mounts[0].ReadOnly, true);
  assert.equal(stage.HostConfig.Mounts[0].ReadOnly, false);
  assert.deepEqual(stage.Entrypoint, ['/bin/false']);
  assert.ok(!calls.some((c) => c.path.includes('-stage/start')));
  assert.equal(task.HostConfig.Binds, undefined);
  assert.ok(!task.Env.some((v) => /KEY|TOKEN|PASSWORD|PROXY/.test(v)));
  assert.match(task.HostConfig.Tmpfs['/tmp'], /size=8388608/);
  assert.ok(calls.find((c) => c.method === 'DELETE' && c.path.startsWith('/volumes/')));
});
test('missing rootless/cgroup enforcement fails before allocating any resources; invalid task/config never connects', async (t) => {
  for (const changed of [
    { CgroupVersion: '1' },
    { CgroupDriver: 'cgroupfs' },
    { SecurityOptions: ['name=seccomp,profile=builtin'] },
    { SecurityOptions: ['name=rootless'] },
  ]) {
    const { sandbox, calls } = await fixture(t, { info: { ...info, ...changed } });
    await assert.rejects(sandbox.run('1', [], new AbortController().signal), {
      code: 'EXECUTOR_POLICY_UNAVAILABLE',
    });
    assert.ok(!calls.some((c) => c.method === 'POST'));
  }
  assert.throws(() => new DockerSandbox({ socketPath: '/tmp/s', image: 'node:latest', scope }), {
    code: 'INVALID_EXECUTOR_CONFIG',
  });
  const { sandbox, calls } = await fixture(t);
  await assert.rejects(
    sandbox.run('1', [{ handle: '../private', bytes: Buffer.from('x') }], new AbortController().signal),
  );
  await assert.rejects(sandbox.run('1', [], AbortSignal.abort()), { code: 'CANCELLED' });
  assert.equal(calls.length, 0);
});
test('reaper deletes only expired resources in its exact scope and preserves active/foreign jobs and volumes', async (t) => {
  const own = 'a'.repeat(64),
    other = 'b'.repeat(64),
    future = 'c'.repeat(64),
    volume = 'dc-input-00000000-0000-4000-8000-000000000001';
  const { sandbox, calls } = await fixture(t, {
    containers: [
      { Id: own, Labels: record },
      { Id: other, Labels: { ...record, 'io.dreamcore.executor.scope': 'dc-other-tests' } },
      { Id: future, Labels: { ...record, 'io.dreamcore.executor.expires': '9999' } },
    ],
    volumes: [
      { Name: volume, Labels: record },
      {
        Name: 'dc-input-00000000-0000-4000-8000-000000000002',
        Labels: { ...record, 'io.dreamcore.executor.scope': 'dc-other-tests' },
      },
    ],
  });
  assert.equal(await sandbox.reapExpired(101), 2);
  assert.deepEqual(
    calls.filter((c) => c.method === 'DELETE').map((c) => c.path),
    ['/containers/' + own + '?force=1&v=1', '/volumes/' + volume],
  );
});
test('uncertain staging failure still cleans owned resources and cleanup failure cannot return successful output', async (t) => {
  for (const failure of ['archive', 'delete']) {
    const { sandbox, calls } = await fixture(t, {
      handle({ req, path, json }) {
        if (
          (failure === 'archive' && path.includes('/archive?')) ||
          (failure === 'delete' && req.method === 'DELETE')
        ) {
          json({ error: 'private must not leak' }, 500);
          return true;
        }
      },
    });
    await assert.rejects(sandbox.run('1', [], new AbortController().signal), {
      code: failure === 'delete' ? 'EXECUTOR_CLEANUP_FAILED' : 'EXECUTOR_REQUEST_FAILED',
    });
    assert.ok(calls.some((c) => c.method === 'DELETE' && c.path.startsWith('/volumes/')));
  }
});
test('cancellation closes wait and independently removes container and input volume', async (t) => {
  let started;
  const waiting = new Promise((r) => (started = r));
  const { sandbox, calls } = await fixture(t, {
    handle({ path }) {
      if (path.includes('/wait?')) {
        started();
        return true;
      }
    },
  });
  const c = new AbortController();
  const rejected = assert.rejects(sandbox.run('while(true){}', [], c.signal), { code: 'CANCELLED' });
  await waiting;
  c.abort();
  await rejected;
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.path.startsWith('/volumes/')));
});
test('malformed multiplexed logs and artifact bytes fail closed; input archive contains no source host paths', async (t) => {
  assert.throws(() => dockerStdout(Buffer.from('not multiplexed')));
  for (const changed of [{ sha256: 'f'.repeat(64) }, { name: '../leak' }, { contentBase64: '@@@@' }]) {
    const { sandbox } = await fixture(t, {
      result: { version: '1.0', ok: true, stdout: '', artifacts: [{ ...artifact, ...changed }] },
    });
    await assert.rejects(sandbox.run('1', [], new AbortController().signal), { code: 'INVALID_ARTIFACT' });
  }
  const archive = jobArchive([{ handle: 'inputs/a.txt', bytes: Buffer.from('synthetic') }]);
  assert.ok(archive.includes(Buffer.from('inputs/a.txt')));
  assert.ok(!archive.includes(Buffer.from('/Users/')));
});

test('cancellation during final inspection still stops the request and cleans the task', async (t) => {
  let inspect;
  const waiting = new Promise((resolve) => {
    inspect = resolve;
  });
  const { sandbox, calls } = await fixture(t, {
    handle({ path }) {
      if (path.startsWith('/containers/dc-job-') && path.endsWith('/json')) {
        inspect();
        return true;
      }
    },
  });
  const controller = new AbortController();
  const rejected = assert.rejects(sandbox.run('1', [], controller.signal), { code: 'CANCELLED' });
  await waiting;
  controller.abort();
  await rejected;
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.path.startsWith('/volumes/')));
  assert.ok(!calls.some((c) => c.path.includes('/logs?')));
});
