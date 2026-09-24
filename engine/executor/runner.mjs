// Trusted image entrypoint, not model supplied. Task code runs in a separate constrained process.
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
const send = (value) => process.stdout.write(JSON.stringify({ version: '1.0', ...value }) + '\n');
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
const number = async (path) => Number((await fs.readFile(path, 'utf8')).trim());
const oom = async () =>
  Number((await fs.readFile('/sys/fs/cgroup/memory.events', 'utf8')).match(/^oom_kill (\d+)$/m)?.[1] ?? 0);
try {
  const limits = JSON.parse(await fs.readFile('/job/limits.json', 'utf8'));
  const status = await fs.readFile('/proc/self/status', 'utf8');
  const cpu = (await fs.readFile('/sys/fs/cgroup/cpu.max', 'utf8')).trim().split(' ').map(Number);
  const outputFs = await fs.statfs('/job/outputs'),
    tmpFs = await fs.statfs('/tmp');
  if (
    process.getuid() !== 65532 ||
    (await number('/sys/fs/cgroup/memory.max')) !== limits.memory ||
    (await number('/sys/fs/cgroup/memory.swap.max')) !== 0 ||
    (await number('/sys/fs/cgroup/pids.max')) !== limits.pids ||
    cpu[0] / cpu[1] !== limits.nanoCpus / 1e9 ||
    !/^NoNewPrivs:\s+1$/m.test(status) ||
    !/^Seccomp:\s+2$/m.test(status) ||
    !/^CapEff:\s+0+$/m.test(status) ||
    outputFs.type !== 0x01021994 ||
    tmpFs.type !== 0x01021994 ||
    outputFs.blocks * outputFs.bsize > limits.outputs ||
    tmpFs.blocks * tmpFs.bsize > limits.tmp
  )
    fail('EXECUTOR_POLICY_UNAVAILABLE');
  if (
    !Number.isInteger(limits.timeoutMs) ||
    limits.timeoutMs < 100 ||
    limits.timeoutMs > 15000 ||
    !Number.isSafeInteger(limits.expires) ||
    Date.now() >= limits.expires
  )
    fail('TIME_LIMIT');
  const before = await oom();
  const child = spawn(
    process.execPath,
    [
      '--max-old-space-size=64',
      '--permission',
      '--allow-fs-read=/job',
      '--allow-fs-write=/job/outputs',
      '--allow-fs-write=/tmp',
      '--disable-proto=throw',
      '/job/script.mjs',
    ],
    {
      cwd: '/job/outputs',
      env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp', TMPDIR: '/tmp', LANG: 'C.UTF-8' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    },
  );
  const kill = () => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
  };
  let failure = '',
    size = 0;
  const stdout = [];
  const stop = (code) => {
    failure ||= code;
    kill();
  };
  const timer = setTimeout(() => stop('TIME_LIMIT'), Math.min(limits.timeoutMs, limits.expires - Date.now()));
  for (const [stream, keep] of [
    [child.stdout, true],
    [child.stderr, false],
  ])
    stream.on('data', (bytes) => {
      size += bytes.length;
      if (size > 65536) stop('OUTPUT_LIMIT');
      else if (keep) stdout.push(bytes);
    });
  let exit;
  try {
    exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
  } finally {
    clearTimeout(timer);
    kill();
  }
  if ((await oom()) > before) fail('MEMORY_LIMIT');
  if (failure) fail(failure);
  if (exit !== 0) fail('SCRIPT_FAILED');
  const names = await fs.readdir('/job/outputs');
  if (names.length > 8) fail('OUTPUT_LIMIT');
  const artifacts = [];
  let total = 0;
  for (const name of names.sort()) {
    const path = '/job/outputs/' + name,
      stat = await fs.lstat(path);
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(name) ||
      !stat.isFile() ||
      stat.nlink !== 1 ||
      (await fs.realpath(path)) !== path
    )
      fail('INVALID_ARTIFACT');
    total += stat.size;
    if (total > 65536) fail('OUTPUT_LIMIT');
    const bytes = await fs.readFile(path);
    artifacts.push({
      name,
      contentBase64: bytes.toString('base64'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  send({ ok: true, stdout: Buffer.concat(stdout).toString('utf8'), artifacts });
} catch (error) {
  send({
    ok: false,
    code: [
      'TIME_LIMIT',
      'SCRIPT_FAILED',
      'OUTPUT_LIMIT',
      'INVALID_ARTIFACT',
      'MEMORY_LIMIT',
      'EXECUTOR_POLICY_UNAVAILABLE',
    ].includes(error?.code)
      ? error.code
      : 'EXECUTOR_POLICY_UNAVAILABLE',
  });
}
