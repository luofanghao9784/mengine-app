import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { LocalNodeSandbox } from '../dist/runtime/sandbox.js';
import { runHarness } from '../dist/runtime/harness.js';
import { createTaskTools } from '../dist/runtime/task-tools.js';

const local = process.platform === 'darwin';
const python = process.env.DREAMCORE_TEST_PYTHON || '/opt/homebrew/bin/python3';
const sandbox = new LocalNodeSandbox({ python });
const run = (script, files = [], signal = new AbortController().signal) => sandbox.run(script, files, signal);

test(
  'real Harness tool computes a synthetic CSV and returns a verified file artifact without a model/network call',
  { skip: !local },
  async () => {
    const script = `import fs from 'node:fs';
const rows=fs.readFileSync('../inputs/amounts.csv','utf8').trim().split('\\n').slice(1);
const sum=rows.reduce((n,line)=>n+BigInt(line.split(',')[1]),0n);
fs.writeFileSync('summary.json',JSON.stringify({rows:rows.length,totalCents:sum.toString()}));`;
    let step = 0,
      verified = false;
    const result = await runHarness({
      prompt: 'sum synthetic amounts',
      tools: createTaskTools({
        sandbox,
        allowJavaScript: true,
        files: [{ handle: 'amounts.csv', bytes: Buffer.from('label,cents\na,1001\nb,-250\nc,999\n') }],
      }),
      model: {
        async *generate(request) {
          if (step++ === 0) {
            yield {
              type: 'tool_call',
              id: 'sum',
              name: 'run_javascript',
              arguments: JSON.stringify({ script }),
            };
            yield { type: 'finish', reason: 'tool_calls' };
          } else {
            const block = request.messages.flatMap((m) => m.content).find((b) => b.type === 'tool_result');
            assert.equal(block.isError, false, block.content);
            const output = JSON.parse(JSON.parse(block.content)[0].text);
            const artifact = output.artifacts[0],
              data = Buffer.from(artifact.contentBase64, 'base64');
            assert.equal(artifact.name, 'summary.json');
            assert.equal(artifact.sha256, createHash('sha256').update(data).digest('hex'));
            assert.deepEqual(JSON.parse(data), { rows: 3, totalCents: '1750' });
            verified = true;
            yield { type: 'text', text: 'Scripted fixture: verified 1750 cents.' };
            yield { type: 'finish', reason: 'stop' };
          }
        },
      },
    });
    assert.equal(verified, true);
    assert.equal(result.status, 'completed');
    assert.equal(result.tools[0].callId, 'sum');
    assert.equal(result.tools[0].status, 'succeeded');
    const artifact = result.tools[0].output.artifacts[0];
    const bytes = Buffer.from(artifact.contentBase64, 'base64');
    assert.equal(artifact.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(JSON.parse(bytes), { rows: 3, totalCents: '1750' });
  },
);

test(
  'OS sandbox denies host/other task reads, input overwrite and outbound/loopback network; environment has no parent secrets',
  { skip: !local },
  async (t) => {
    const host = await mkdtemp(join(tmpdir(), 'dreamcore-host-test-'));
    t.after(() => rm(host, { recursive: true, force: true }));
    const forbidden = join(await realpath(host), 'other-tenant.txt');
    await writeFile(forbidden, 'other-tenant-synthetic-secret');
    assert.equal(await readFile(forbidden, 'utf8'), 'other-tenant-synthetic-secret');
    let accepted = 0;
    const server = createServer((socket) => {
      accepted++;
      socket.destroy();
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    process.env.DREAMCORE_SYNTHETIC_SECRET = 'must-not-inherit';
    t.after(() => {
      delete process.env.DREAMCORE_SYNTHETIC_SECRET;
    });
    const script = `import fs from 'node:fs'; import net from 'node:net'; import cp from 'node:child_process';
const denied = {};
for (const [name,fn] of Object.entries({
  hostRead:()=>fs.readFileSync(${JSON.stringify(forbidden)}),
  hostWrite:()=>fs.writeFileSync(${JSON.stringify(forbidden)},'attack'),
  traversal:()=>fs.readFileSync('../../${host.split('/').at(-1)}/other-tenant.txt'),
  inputWrite:()=>fs.writeFileSync('../inputs/allowed.txt','attack'),
  child:()=>cp.spawnSync(process.execPath,['-e','console.log(1)']),
})) { try { fn(); denied[name]=false; } catch(e) { denied[name]=e.code; } }
denied.secret=process.env.DREAMCORE_SYNTHETIC_SECRET ?? null;
denied.nodeOptions=process.env.NODE_OPTIONS ?? null;
denied.allowed=fs.readFileSync('../inputs/allowed.txt','utf8');
denied.network=await new Promise(resolve=>{const s=net.connect(${server.address().port},'127.0.0.1');s.on('error',e=>resolve(e.code));s.on('connect',()=>{s.destroy();resolve(false)});});
console.log(JSON.stringify(denied));`;
    const result = JSON.parse(
      (await run(script, [{ handle: 'allowed.txt', bytes: Buffer.from('allowed') }])).stdout,
    );
    assert.ok(['EPERM', 'EACCES'].includes(result.hostRead));
    assert.ok(['EPERM', 'EACCES'].includes(result.hostWrite));
    assert.ok(['EPERM', 'EACCES'].includes(result.traversal));
    assert.ok(['EPERM', 'EACCES'].includes(result.inputWrite));
    assert.equal(result.child, 'ERR_ACCESS_DENIED');
    assert.ok(['EPERM', 'EACCES'].includes(result.network));
    assert.equal(result.secret, null);
    assert.equal(result.nodeOptions, null);
    assert.equal(result.allowed, 'allowed');
    assert.equal(accepted, 0);
    assert.equal(await readFile(forbidden, 'utf8'), 'other-tenant-synthetic-secret');
  },
);

test(
  'parallel jobs have separate copies and output files; job directories are removed',
  { skip: !local },
  async () => {
    const script = `import fs from 'node:fs'; fs.writeFileSync('result.txt',fs.readFileSync('../inputs/source.txt'));console.log(process.cwd());`;
    const results = await Promise.all(
      ['tenant-A', 'tenant-B'].map((text) =>
        run(script, [{ handle: 'source.txt', bytes: Buffer.from(text) }]),
      ),
    );
    assert.deepEqual(
      results.map((r) => Buffer.from(r.artifacts[0].bytes).toString()),
      ['tenant-A', 'tenant-B'],
    );
    assert.notEqual(results[0].stdout, results[1].stdout);
    for (const result of results) await assert.rejects(readdir(result.stdout.trim()), { code: 'ENOENT' });
  },
);

test('unsafe output types, too many files and excess stdout are rejected', { skip: !local }, async () => {
  await assert.rejects(
    run("import fs from 'node:fs'; fs.symlinkSync('../inputs/source.txt','leak.txt');", [
      { handle: 'source.txt', bytes: Buffer.from('ok') },
    ]),
    { code: 'INVALID_ARTIFACT' },
  );
  await assert.rejects(run("import fs from 'node:fs'; for(let i=0;i<9;i++)fs.writeFileSync('file'+i,'x');"), {
    code: 'OUTPUT_LIMIT',
  });
  await assert.rejects(run("console.log('x'.repeat(100000));"), { code: 'OUTPUT_LIMIT' });
  await assert.rejects(run("import fs from 'node:fs';fs.mkdirSync('folder');"), { code: 'INVALID_ARTIFACT' });
});

test(
  'wall timeout and cancellation kill the running process and clean its directory',
  { skip: !local },
  async () => {
    const limited = new LocalNodeSandbox({ python, timeoutMs: 400 });
    await assert.rejects(limited.run('while(true){}', [], new AbortController().signal), {
      code: 'TIME_LIMIT',
    });
    const controller = new AbortController();
    const script = "import fs from 'node:fs';fs.writeFileSync('ready.txt',String(process.pid));while(true){}";
    const task = runHarness({
      prompt: 'cancellation fixture',
      signal: controller.signal,
      tools: createTaskTools({ files: [], allowJavaScript: true, sandbox }),
      model: {
        async *generate() {
          yield {
            type: 'tool_call',
            id: 'slow-code',
            name: 'run_javascript',
            arguments: JSON.stringify({ script }),
          };
          yield { type: 'finish', reason: 'tool_calls' };
        },
      },
    });
    // Find only this test's generated job, prove the actual script began before cancelling.
    let directory, pid;
    for (let i = 0; i < 100 && !pid; i++) {
      await delay(20);
      for (const name of (await readdir(tmpdir())).filter((n) => n.startsWith('dreamcore-task-'))) {
        const dir = join(tmpdir(), name);
        try {
          if ((await readFile(join(dir, 'script.mjs'), 'utf8')) !== script) continue;
          pid = Number(await readFile(join(dir, 'outputs/ready.txt'), 'utf8'));
          directory = dir;
        } catch {
          /* Other test jobs may have finished. */
        }
      }
    }
    assert.ok(pid, 'actual sandbox process started');
    controller.abort();
    const result = await task;
    assert.equal(result.status, 'cancelled');
    assert.equal(result.modelCalls, 1);
    assert.equal(result.text, '');
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    await assert.rejects(readdir(directory), { code: 'ENOENT' });
  },
);

test('invalid grants, pre-cancelled work and absent sandbox fail closed', async () => {
  await assert.rejects(run('console.log(1)', [], AbortSignal.abort()), { code: 'CANCELLED' });
  if (!local) {
    await assert.rejects(run('console.log(1)'), { code: 'SANDBOX_UNAVAILABLE' });
    return;
  }
  await assert.rejects(run('console.log(1)', [{ handle: '../other', bytes: Buffer.from('test') }]), {
    code: 'INVALID_SANDBOX_INPUT',
  });
  await assert.rejects(
    new LocalNodeSandbox({ python: '/nonexistent/python3' }).run(
      'console.log(1)',
      [],
      new AbortController().signal,
    ),
    { code: 'SANDBOX_UNAVAILABLE' },
  );
});
