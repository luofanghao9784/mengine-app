// Explicit integration suite: requires a real, dedicated rootless Linux daemon and built immutable image.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFile, mkdir } from 'node:fs/promises';
import { DockerSandbox, executorLimits } from '../../dist/runtime/docker-sandbox.js';
import { DockerApi, dockerStdout } from '../../dist/runtime/docker-api.js';
import { CandidateSession } from '../../dist/runtime/candidate-tools.js';
import { registryFixture } from '../fixtures/candidates.mjs';
const config = {
  socketPath: process.env.DREAMCORE_EXECUTOR_SOCKET ?? '',
  image: process.env.DREAMCORE_EXECUTOR_IMAGE ?? '',
  scope: 'dc-real-' + randomUUID(),
};
const api = new DockerApi(config.socketPath),
  sandbox = new DockerSandbox(config);
const signal = () => AbortSignal.timeout(25000);
const filters = encodeURIComponent(
  JSON.stringify({ label: ['io.dreamcore.executor.scope=' + config.scope] }),
);
const containers = () => api.json('GET', '/containers/json?all=1&filters=' + filters);
const volumes = async () => (await api.json('GET', '/volumes?filters=' + filters)).Volumes ?? [];
async function clean() {
  assert.deepEqual(await containers(), []);
  assert.deepEqual(await volumes(), []);
}
async function started() {
  for (let i = 0; i < 100; i++) {
    for (const item of await containers())
      if (item.State === 'running')
        try {
          const exec = await api.json('POST', '/containers/' + item.Id + '/exec', {
            AttachStdout: true,
            AttachStderr: false,
            Cmd: ['/bin/cat', '/job/outputs/ready.txt'],
          });
          const bytes = await api.call('POST', '/exec/' + exec.Id + '/start', { Detach: false, Tty: false });
          if (bytes.includes(Buffer.from('READY'))) return item;
        } catch {}
    await delay(50);
  }
  throw Error('Actual script never wrote READY');
}
await sandbox.check();
test.after(async () => {
  await sandbox.reapExpired(Date.now() + executorLimits.ttlMs);
});

test('actual Linux executor computes results and reuses admitted candidate bytes with the same tool port', async () => {
  const result = await sandbox.run(
    "import fs from 'node:fs';const rows=fs.readFileSync('../inputs/data.txt','utf8').split(',');fs.writeFileSync('sum.json',JSON.stringify({total:rows.reduce((n,v)=>n+Number(v),0)}));",
    [{ handle: 'data.txt', bytes: Buffer.from('1001,999') }],
    signal(),
  );
  assert.deepEqual(JSON.parse(result.artifacts[0].bytes), { total: 2000 });
  const session = new CandidateSession('ini', registryFixture().registry, sandbox),
    id = (await session.execute({ action: 'discover' }, [], signal())).items[0].id;
  assert.equal((await session.execute({ action: 'trial', id }, [], signal())).status, 'READY');
  const run = await session.execute(
    { action: 'run', id, inputHandle: 'source.txt' },
    [{ handle: 'source.txt', bytes: Buffer.from('amount=1001') }],
    signal(),
  );
  assert.deepEqual(JSON.parse(Buffer.from(run.artifacts[0].contentBase64, 'base64')), { amount: '1001' });
  assert.equal(
    JSON.parse(Buffer.from(session.report().contentBase64, 'base64')).isolation,
    'linux-rootless-oci-prototype',
  );
  session.close();
  await clean();
});
test('actual readonly grants, unavailable host paths, clean environment, denied subprocess and no external network', async () => {
  const previous = process.env.DREAMCORE_PRIVATE_CANARY;
  process.env.DREAMCORE_PRIVATE_CANARY = 'must-not-enter';
  try {
    const result = await sandbox.run(
      `import fs from 'node:fs';import cp from 'node:child_process';import net from 'node:net';const denied={};for(const [key,action] of Object.entries({host:()=>fs.readFileSync('/host-private/other-tenant.txt'),socket:()=>fs.readFileSync('/var/run/docker.sock'),input:()=>fs.writeFileSync('../inputs/granted.txt','overwrite'),root:()=>fs.writeFileSync('/etc/forbidden','x'),child:()=>cp.execFileSync('/bin/true')})){try{action();denied[key]=false;}catch(e){denied[key]=e.code;}}denied.secret=process.env.DREAMCORE_PRIVATE_CANARY??null;denied.inputText=fs.readFileSync('../inputs/granted.txt','utf8');denied.network=await new Promise(r=>{const s=net.connect(443,'1.1.1.1');s.on('error',e=>r(e.code));s.on('connect',()=>{s.destroy();r(false);});s.setTimeout(500,()=>{s.destroy();r('TIMEOUT');});});fs.writeFileSync('proof.json',JSON.stringify(denied));`,
      [{ handle: 'granted.txt', bytes: Buffer.from('synthetic') }],
      signal(),
    );
    const proof = JSON.parse(result.artifacts[0].bytes);
    for (const key of ['host', 'socket', 'input', 'root', 'child'])
      assert.equal(proof[key], 'ERR_ACCESS_DENIED', key);
    assert.equal(proof.secret, null);
    assert.equal(proof.inputText, 'synthetic');
    assert.ok(['ENETUNREACH', 'EHOSTUNREACH'].includes(proof.network), proof.network);
  } finally {
    if (previous === undefined) delete process.env.DREAMCORE_PRIVATE_CANARY;
    else process.env.DREAMCORE_PRIVATE_CANARY = previous;
  }
  await clean();
});
test('memory exhaustion is killed by cgroup, and writable temporary storage enforces actual ENOSPC', async () => {
  await assert.rejects(
    sandbox.run('const buffers=[];while(true)buffers.push(Buffer.alloc(16*1024*1024,1));', [], signal()),
    { code: 'MEMORY_LIMIT' },
  );
  await clean();
  const result = await sandbox.run(
    `import fs from 'node:fs';const bytes=Buffer.alloc(1024*1024,1);const proof={};for(const [name,path] of [['tmp','/tmp/fill'],['output','fill']]){let n=0;const fd=fs.openSync(path,'w');try{while(n<32){fs.writeSync(fd,bytes);n++;}}catch(e){proof[name]={bytes:n*bytes.length,error:e.code};}finally{fs.closeSync(fd);fs.unlinkSync(path);}}fs.writeFileSync('proof.json',JSON.stringify(proof));`,
    [],
    signal(),
  );
  const proof = JSON.parse(result.artifacts[0].bytes);
  assert.deepEqual(proof, {
    tmp: { bytes: executorLimits.tmp, error: 'ENOSPC' },
    output: { bytes: executorLimits.outputs, error: 'ENOSPC' },
  });
  await clean();
});
test('wall timeout and explicit cancellation stop actual executing code and remove its input volume', async () => {
  const limited = new DockerSandbox({ ...config, timeoutMs: 400 });
  await assert.rejects(limited.run('while(true){}', [], signal()), { code: 'TIME_LIMIT' });
  await clean();
  const controller = new AbortController();
  const rejected = assert.rejects(
    sandbox.run(
      "import fs from 'node:fs';fs.writeFileSync('ready.txt','READY');while(true){}",
      [],
      controller.signal,
    ),
    { code: 'CANCELLED' },
  );
  try {
    await started();
  } finally {
    controller.abort();
    await rejected;
  }
  await clean();
});
test('two simultaneous tasks cannot share file bytes; third concurrent job is refused', async () => {
  const script =
    "import fs from 'node:fs';await new Promise(r=>setTimeout(r,300));fs.writeFileSync('result.txt',fs.readFileSync('../inputs/one.txt'));";
  const one = sandbox.run(script, [{ handle: 'one.txt', bytes: Buffer.from('tenant A') }], signal());
  const two = sandbox.run(script, [{ handle: 'one.txt', bytes: Buffer.from('tenant B') }], signal());
  await assert.rejects(sandbox.run('1', [], signal()), { code: 'EXECUTOR_BUSY' });
  const results = await Promise.all([one, two]);
  assert.deepEqual(
    results.map((r) => Buffer.from(r.artifacts[0].bytes).toString()),
    ['tenant A', 'tenant B'],
  );
  await clean();
});
test('unsafe artifacts, excessive stdout and script errors never deliver successful partial files', async () => {
  for (const [script, code] of [
    ["import fs from 'node:fs';fs.mkdirSync('nested');", 'INVALID_ARTIFACT'],
    ["import fs from 'node:fs';fs.symlinkSync('../inputs/one.txt','link.txt');", 'SCRIPT_FAILED'],
    ["console.log('x'.repeat(100000));", 'OUTPUT_LIMIT'],
    [
      "import fs from 'node:fs';fs.writeFileSync('partial.txt','partial');throw Error('private');",
      'SCRIPT_FAILED',
    ],
  ]) {
    await assert.rejects(
      sandbox.run(script, [{ handle: 'one.txt', bytes: Buffer.from('synthetic') }], signal()),
      { code },
    );
    await clean();
  }
});
test('SIGKILL of coordinator cannot leave running code; separate reaper removes expired containers and volumes', async (t) => {
  const crash = new DockerSandbox({ ...config, timeoutMs: 1500 });
  const caller = spawn(process.execPath, ['tests/fixtures/docker-crash-client.mjs'], {
    cwd: new URL('../../', import.meta.url),
    env: { PATH: process.env.PATH, DREAMCORE_EXECUTOR_TEST_CONFIG: JSON.stringify(crash.config) },
    stdio: 'ignore',
  });
  t.after(() => caller.kill('SIGKILL'));
  const running = await started();
  const died = once(caller, 'exit');
  caller.kill('SIGKILL');
  await died;
  let state;
  for (let i = 0; i < 80; i++) {
    state = await api.json('GET', '/containers/' + running.Id + '/json');
    if (!state.State.Running) break;
    await delay(100);
  }
  assert.equal(state.State.Running, false, 'worker watchdog survives coordinator death');
  const receipt = JSON.parse(
    dockerStdout(await api.call('GET', '/containers/' + running.Id + '/logs?stdout=1&stderr=1')),
  );
  assert.equal(receipt.code, 'TIME_LIMIT');
  assert.ok((await volumes()).length === 1);
  const reaper = spawn(process.execPath, ['scripts/reap-executions.mjs', '--watch'], {
    cwd: new URL('../../', import.meta.url),
    env: {
      PATH: process.env.PATH,
      DREAMCORE_EXECUTOR_SOCKET: config.socketPath,
      DREAMCORE_EXECUTOR_IMAGE: config.image,
      DREAMCORE_EXECUTOR_SCOPE: config.scope,
    },
    stdio: 'ignore',
  });
  t.after(() => reaper.kill('SIGTERM'));
  const deadline = Date.now() + 70000;
  while (Date.now() < deadline && (await containers()).length) await delay(1000);
  await clean();
  const exited = once(reaper, 'exit');
  reaper.kill('SIGTERM');
  await exited;
  const folder = new URL('../../../.local/m4-linux/', import.meta.url);
  await mkdir(folder, { recursive: true });
  const info = await api.json('GET', '/info');
  await writeFile(
    new URL('result.json', folder),
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        image: config.image,
        daemonVersion: info.ServerVersion,
        cgroup: info.CgroupVersion,
        rootless: true,
        limits: executorLimits,
        cloudModelCalled: false,
        coordinatorSigkill: true,
        externalReaper: true,
        containersRemaining: 0,
        volumesRemaining: 0,
      },
      null,
      2,
    ) + '\n',
  );
});
