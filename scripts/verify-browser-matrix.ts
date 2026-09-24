/** Repeat existing real-service journeys in isolated browser/runtime fixtures. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const artifacts = new URL('../.local/m7-browser/', import.meta.url);
const browsers = ['chromium', 'firefox', 'webkit'];
const journeys = {
  'three-surfaces': [
    process.execPath,
    '--experimental-strip-types',
    'scripts/verify-three-surfaces.ts',
    '--knowledge',
    '--conversations',
  ],
  operations: [
    'python3',
    'scripts/with-test-postgres.py',
    process.execPath,
    '--experimental-strip-types',
    'scripts/verify-operations.ts',
  ],
  agent: [
    'python3',
    'scripts/with-test-postgres.py',
    process.execPath,
    '--experimental-strip-types',
    'scripts/verify-agent.ts',
  ],
};
function selected(option: string, allowed: string[]) {
  const args = process.argv.slice(2).filter((x) => x.startsWith(option + '='));
  assert.ok(args.length <= 1, 'Specify each filter once');
  const value = args[0]?.slice(option.length + 1);
  assert.ok(!value || allowed.includes(value), 'Unknown filter: ' + option);
  return value ? [value] : allowed;
}
assert.ok(
  process.argv.slice(2).every((x) => /^--(browser|journey)=.+$/.test(x)),
  'Unknown matrix argument',
);
const planned = selected('--browser', browsers).flatMap((browser) =>
  selected('--journey', Object.keys(journeys)).map((journey) => ({ browser, journey })),
);
await mkdir(artifacts, { recursive: true });
const report: {
  status: string;
  startedAt: string;
  planned: typeof planned;
  passed: unknown[];
  failed?: unknown;
} = {
  status: 'running',
  startedAt: new Date().toISOString(),
  planned,
  passed: [],
};
const save = () => writeFile(new URL('matrix.json', artifacts), JSON.stringify(report, null, 2) + '\n');
await save();
for (const step of planned) {
  console.log(`START ${step.browser} / ${step.journey}`);
  const [command, ...args] = journeys[step.journey as keyof typeof journeys];
  const env: NodeJS.ProcessEnv = { ...process.env, DREAMCORE_TEST_BROWSER: step.browser };
  // This matrix validates the local macOS executor; it must not inherit another task's Docker target.
  for (const key of Object.keys(env)) if (key.startsWith('DREAMCORE_EXECUTOR_')) delete env[key];
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  if (code !== 0) {
    report.status = 'failed';
    report.failed = { ...step, exitCode: code };
    await save();
    throw new Error(`Browser journey failed: ${step.browser} / ${step.journey}`);
  }
  const result = JSON.parse(
    await readFile(new URL(`${step.browser}/${step.journey}/result.json`, artifacts), 'utf8'),
  );
  assert.equal(result.browser, step.browser);
  assert.equal(typeof result.browserVersion, 'string');
  report.passed.push({ ...step, browserVersion: result.browserVersion });
  await save();
  console.log(`PASS ${step.browser} / ${step.journey}`);
}
report.status = 'passed';
await save();
console.log(
  `PASS ${report.passed.length} browser journeys; report ${fileURLToPath(new URL('matrix.json', artifacts))}`,
);
