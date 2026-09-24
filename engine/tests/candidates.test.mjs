import { usageFixture } from './fixtures/usage.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unpackCandidate, packagePolicy } from '../dist/runtime/candidate-archive.js';
import { CandidateSession, NpmCandidates } from '../dist/runtime/candidate-tools.js';
import { LocalNodeSandbox } from '../dist/runtime/sandbox.js';
import { PublicReader } from '../dist/runtime/public-web.js';
import { packageFixture, registryFixture, tarball, parserCode } from './fixtures/candidates.mjs';
const signal = () => new AbortController().signal;
const sandbox = new LocalNodeSandbox({
  python: process.env.DREAMCORE_TEST_PYTHON || '/opt/homebrew/bin/python3',
});
const local = { skip: process.platform !== 'darwin' };
const hash = (bytes) => 'sha512-' + createHash('sha512').update(bytes).digest('base64');
const unpack = (bytes) => unpackCandidate(bytes, hash(bytes), 'synthetic-ini', '1.0.0', 'MIT');

test('candidate archives verify integrity, paths, link types, native code and bounded expansion before staging', () => {
  const pkg = packageFixture();
  assert.equal(unpack(pkg.archive).main, 'index.js');
  assert.throws(
    () => unpackCandidate(pkg.archive, 'sha512-' + 'A'.repeat(86) + '==', 'synthetic-ini', '1.0.0', 'MIT'),
    { code: 'CANDIDATE_INTEGRITY_FAILED' },
  );
  for (const path of [
    'package/../escape.js',
    '/etc/escape.js',
    'package/a/../../escape.js',
    'package/C:\\x.js',
    'package/native.node',
  ])
    assert.throws(() => unpack(tarball([{ path, bytes: 'x' }])));
  for (const type of ['1', '2', '3', '6', 'x'])
    assert.throws(() => unpack(tarball([{ path: 'package/index.js', bytes: 'x', type }])));
  assert.throws(() => unpack(tarball([{ path: 'package/big.js', bytes: 'x'.repeat(1100000) }])));
  assert.throws(() =>
    unpack(
      tarball([
        { path: 'package/x.js', bytes: 'x' },
        { path: 'package/X.js', bytes: 'y' },
      ]),
    ),
  );
  assert.throws(() => unpack(pkg.archive.subarray(0, -2)));
});
test('candidate admission rejects dependencies, lifecycle scripts, unapproved licenses, bins and mutable versions', () => {
  for (const metadata of [
    { dependencies: { x: 'latest' } },
    { optionalDependencies: { x: '1.0.0' } },
    { scripts: { install: 'touch /tmp/bad' } },
    { scripts: { prepare: 'execute' } },
    { license: 'UNKNOWN' },
    { bin: 'index.js' },
    { main: '../escape.js' },
  ]) {
    const pkg = packageFixture({ metadata });
    assert.throws(() =>
      unpackCandidate(pkg.archive, pkg.metadata.dist.integrity, 'synthetic-ini', '1.0.0', 'MIT'),
    );
  }
  assert.throws(() => packagePolicy({ name: 'x', version: '2.0.0', license: 'MIT' }, 'x', '1.0.0', 'MIT'));
});
test('candidate registry denies external archives and every redirect and keeps outbound search immutable', async () => {
  const fixed = registryFixture();
  await fixed.registry.discover('public topic', signal());
  assert.equal(new URL(fixed.requests[0]).searchParams.get('text'), 'public topic');
  let wire = 0;
  const redirect = new NpmCandidates(
    new PublicReader(
      async () => [{ address: '104.16.25.34', family: 4 }],
      async () => {
        wire++;
        return { status: 302, headers: { location: 'https://evil.example/' }, bytes: Buffer.alloc(0) };
      },
    ),
  );
  await assert.rejects(redirect.discover('ini', signal()), { code: 'PUBLIC_REDIRECT_DENIED' });
  assert.equal(wire, 1);
  const pkg = packageFixture();
  pkg.metadata.dist.tarball = 'https://evil.example/pkg.tgz';
  const reader = new PublicReader(
    async () => [{ address: '104.16.25.34', family: 4 }],
    async () => ({ status: 200, headers: {}, bytes: Buffer.from(JSON.stringify(pkg.metadata)) }),
  );
  await assert.rejects(
    new NpmCandidates(reader).prepare({ name: 'synthetic-ini', version: '1.0.0' }, signal()),
    { code: 'CANDIDATE_ORIGIN_REJECTED' },
  );
});
test(
  'real sandbox stages package offline, checks synthetic sample and reuses identical bytes on granted excerpt',
  local,
  async () => {
    const fixture = registryFixture(),
      session = new CandidateSession('ini', fixture.registry, sandbox);
    const found = await session.execute({ action: 'discover' }, [], signal()),
      id = found.items[0].id;
    await assert.rejects(
      session.execute(
        { action: 'run', id, inputHandle: 'source.txt' },
        [{ handle: 'source.txt', bytes: Buffer.from('amount=1001') }],
        signal(),
      ),
      { code: 'CANDIDATE_NOT_READY' },
    );
    assert.equal((await session.execute({ action: 'trial', id }, [], signal())).status, 'READY');
    const result = await session.execute(
      { action: 'run', id, inputHandle: 'source.txt' },
      [{ handle: 'source.txt', bytes: Buffer.from('amount=1001') }],
      signal(),
    );
    assert.deepEqual(JSON.parse(Buffer.from(result.artifacts[0].contentBase64, 'base64')), {
      amount: '1001',
    });
    assert.equal(result.candidate.status, 'USED');
    await session.execute(
      { action: 'run', id, inputHandle: 'source.txt' },
      [{ handle: 'source.txt', bytes: Buffer.from('amount=999') }],
      signal(),
    );
    assert.equal(fixture.requests.length, 3);
    const report = JSON.parse(Buffer.from(session.report().contentBase64, 'base64'));
    assert.equal(report.globallyTrusted, false);
    assert.equal(report.items[0].integrity, fixture.pkg.metadata.dist.integrity);
    assert.ok(report.licenses[0].text.includes('Synthetic'));
    await assert.rejects(
      new CandidateSession('ini', fixture.registry, sandbox).execute(
        { action: 'run', id, inputHandle: 'source.txt' },
        [],
        signal(),
      ),
      { code: 'CANDIDATE_NOT_GRANTED' },
    );
    session.close();
  },
);
test(
  'invalid candidates are reported and never granted business inputs or reinstalled automatically',
  local,
  async () => {
    let executions = 0;
    for (const options of [
      { metadata: { scripts: { install: 'forbidden' } } },
      { code: 'exports.parse=()=>({wrong:true})' },
    ]) {
      const fixture = registryFixture(options);
      const wrapped = {
        runInstalled: async (...args) => {
          executions++;
          assert.deepEqual(
            args[1].map((f) => f.handle),
            ['synthetic.ini'],
          );
          return sandbox.runInstalled(...args);
        },
      };
      const session = new CandidateSession('ini', fixture.registry, wrapped),
        id = (await session.execute({ action: 'discover' }, [], signal())).items[0].id;
      const trial = await session.execute(
        { action: 'trial', id },
        [{ handle: 'PRIVATE.txt', bytes: Buffer.from('PRIVATE') }],
        signal(),
      );
      assert.equal(trial.status, 'REJECTED');
      const requests = fixture.requests.length;
      assert.equal((await session.execute({ action: 'trial', id }, [], signal())).status, 'REJECTED');
      assert.equal(fixture.requests.length, requests);
      await assert.rejects(session.execute({ action: 'run', id, inputHandle: 'PRIVATE.txt' }, [], signal()), {
        code: 'CANDIDATE_NOT_READY',
      });
    }
    assert.equal(executions, 1);
  },
);
test(
  'installed code cannot read host, mutate package/input, spawn a process or reach network; directories are removed',
  local,
  async (t) => {
    const { createServer } = await import('node:http');
    const { listen, close } = await import('./fixtures/agent.mjs');
    let requests = 0;
    const server = createServer((req, res) => {
      requests++;
      res.end('reachable');
    });
    const networkUrl = await listen(server);
    t.after(() => close(server));
    const previousSecret = process.env.CANDIDATE_HOST_SECRET;
    process.env.CANDIDATE_HOST_SECRET = 'PRIVATE_CANARY';
    t.after(() => {
      if (previousSecret === undefined) delete process.env.CANDIDATE_HOST_SECRET;
      else process.env.CANDIDATE_HOST_SECRET = previousSecret;
    });
    const folder = await mkdtemp(join(tmpdir(), 'candidate-host-'));
    t.after(() => rm(folder, { recursive: true, force: true }));
    const secret = join(await realpath(folder), 'secret');
    await writeFile(secret, 'HOST_PRIVATE');
    const installed = [
      {
        handle: 'index.js',
        bytes: Buffer.from(
          `const fs=require('node:fs');exports.probe=()=>{const denied=[];for(const [name,fn] of Object.entries({host:()=>fs.readFileSync(${JSON.stringify(secret)}),input:()=>fs.writeFileSync('../inputs/input.txt','bad'),package:()=>fs.writeFileSync('../modules/candidate/index.js','bad'),child:()=>require('node:child_process').execFileSync('/bin/sh',['-c','true'])})){try{fn();}catch{denied.push(name);}}return denied;};`,
        ),
      },
    ];
    const result = await sandbox.runInstalled(
      `import fs from 'node:fs';import p from './modules/candidate/index.js';let network=false;try{await fetch(${JSON.stringify(networkUrl)},{signal:AbortSignal.timeout(300)});}catch{network=true;}fs.writeFileSync('proof.json',JSON.stringify({denied:p.probe(),network,job:process.cwd(),secret:process.env.CANDIDATE_HOST_SECRET??null}));`,
      [{ handle: 'input.txt', bytes: Buffer.from('only-this') }],
      installed,
      signal(),
    );
    const proof = JSON.parse(Buffer.from(result.artifacts[0].bytes));
    assert.deepEqual(proof.denied, ['host', 'input', 'package', 'child']);
    assert.equal(proof.network, true);
    assert.equal(requests, 0);
    assert.equal(proof.secret, null);
    await assert.rejects(readdir(proof.job));
    assert.equal(await readFile(secret, 'utf8'), 'HOST_PRIVATE');
  },
);
test(
  'cancel kills an installed module during synthetic trial and leaves no reusable READY candidate',
  local,
  async () => {
    const fixture = registryFixture({ code: 'while(true){}' }),
      session = new CandidateSession('ini', fixture.registry, sandbox),
      id = (await session.execute({ action: 'discover' }, [], signal())).items[0].id;
    const controller = new AbortController();
    const running = session.execute({ action: 'trial', id }, [], controller.signal);
    setTimeout(() => controller.abort(), 150);
    await assert.rejects(running, { code: 'CANCELLED' });
    assert.notEqual(session.snapshot()[0].status, 'READY');
    session.close();
  },
);

test('Harness candidate gates deny absent grant, absent adapter, inactive guide and arbitrary query injection', async (t) => {
  const { createServer } = await import('node:http');
  const { AgentTasks } = await import('../dist/runtime/agent-task.js');
  const { listen, close, json } = await import('./fixtures/agent.mjs');
  let grant = true;
  const server = createServer(
    (req, res) =>
      usageFixture(req, res) ||
      json(res, {
        allowed: true,
        executionClass: 'verification',
        publicQuery: 'public-only',
        candidateTrialsAllowed: grant,
      }),
  );
  const url = await listen(server);
  t.after(() => close(server));
  const fixture = registryFixture();
  for (const scenario of ['no-grant', 'no-adapter', 'no-activation', 'query-injection']) {
    grant = scenario !== 'no-grant';
    let calls = 0;
    const agent = new AgentTasks({
      platformBaseUrl: url,
      executionClass: 'verification',
      modelName: 'fixture',
      publicWeb: { reader: new PublicReader() },
      ...(scenario === 'no-adapter' ? {} : { candidates: { registry: fixture.registry, sandbox } }),
      createModel: () => ({
        async *generate(req) {
          calls++;
          if (calls === 1) assert.ok(!req.tools.some((t) => t.name === 'candidate_tool'));
          const activate = calls === 1 && scenario === 'query-injection';
          yield {
            type: 'tool_call',
            id: 'call' + calls,
            name: activate ? 'activate_skill' : 'candidate_tool',
            arguments: JSON.stringify(
              activate
                ? { id: 'candidate-trials', version: '1.0.0' }
                : { action: 'discover', ...(scenario === 'query-injection' ? { query: 'PRIVATE' } : {}) },
            ),
          };
          yield { type: 'finish', reason: 'tool_calls' };
        },
      }),
    });
    await assert.rejects(
      agent.run(
        { contractVersion: '1.4', taskId: randomUUID(), attemptId: randomUUID(), prompt: 'PRIVATE' },
        signal(),
      ),
    );
    assert.ok(calls >= 1, scenario);
    agent.stop();
  }
  assert.equal(fixture.requests.length, 0);
  assert.throws(
    () =>
      new AgentTasks({
        platformBaseUrl: url,
        executionClass: 'live',
        modelName: 'fixture',
        publicWeb: { reader: new PublicReader() },
        createModel: () => ({}),
        candidates: { registry: fixture.registry, sandbox },
      }),
    { code: 'LIVE_CODE_NOT_AVAILABLE' },
  );
});

test('platform revocation interrupts candidate trial and publishes no late artifact', local, async (t) => {
  const { createServer } = await import('node:http');
  const { setTimeout: delay } = await import('node:timers/promises');
  const { AgentTasks } = await import('../dist/runtime/agent-task.js');
  const { listen, close, json } = await import('./fixtures/agent.mjs');
  let grant = true,
    calls = 0,
    started,
    closed = false;
  const began = new Promise((resolve) => (started = resolve));
  const server = createServer(
    (req, res) =>
      usageFixture(req, res) ||
      json(res, {
        allowed: true,
        executionClass: 'verification',
        publicQuery: 'ini',
        candidateTrialsAllowed: grant,
      }),
  );
  const url = await listen(server);
  t.after(() => close(server));
  const fixture = registryFixture({ code: 'while(true){}' });
  const wrapped = {
    async runInstalled(...args) {
      started();
      try {
        return await sandbox.runInstalled(...args);
      } finally {
        closed = true;
      }
    },
  };
  const agent = new AgentTasks({
    platformBaseUrl: url,
    executionClass: 'verification',
    modelName: 'fixture',
    publicWeb: { reader: new PublicReader() },
    candidates: { registry: fixture.registry, sandbox: wrapped },
    createModel: () => ({
      async *generate(req) {
        calls++;
        const last = req.messages
          .flatMap((m) => m.content)
          .filter((b) => b.type === 'tool_result')
          .at(-1);
        const result = last ? JSON.parse(JSON.parse(last.content)[0].text) : undefined;
        yield {
          type: 'tool_call',
          id: 'call' + calls,
          name: calls === 1 ? 'activate_skill' : 'candidate_tool',
          arguments: JSON.stringify(
            calls === 1
              ? { id: 'candidate-trials', version: '1.0.0' }
              : calls === 2
                ? { action: 'discover' }
                : { action: 'trial', id: result.items[0].id },
          ),
        };
        yield { type: 'finish', reason: 'tool_calls' };
      },
    }),
  });
  t.after(() => agent.stop());
  const rejected = assert.rejects(
    agent.run(
      { contractVersion: '1.4', taskId: randomUUID(), attemptId: randomUUID(), prompt: 'synthetic' },
      signal(),
    ),
  );
  await Promise.race([
    began,
    delay(3000).then(() => {
      throw Error('trial did not start');
    }),
  ]);
  await delay(500);
  grant = false;
  await rejected;
  assert.equal(closed, true);
  assert.equal(calls, 3);
});
