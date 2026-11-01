// Read-only verification of the dedicated embedded pilot; emits no env values.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const [runtimeRoot, expectedCodexHome, expectedIssuesRaw = '0', minimumRunsRaw = '0'] = process.argv.slice(2);
assert(runtimeRoot && expectedCodexHome, 'Pass runtime root and expected empty external Codex home');
const expectedIssues = Number(expectedIssuesRaw);
const minimumRuns = Number(minimumRunsRaw);
assert(Number.isInteger(expectedIssues) && expectedIssues >= 0);
assert(Number.isInteger(minimumRuns) && minimumRuns >= 0);
const require = createRequire(path.resolve(runtimeRoot, 'node_modules/paperclipai/package.json'));
assert.equal(require('./package.json').version, '2026.1023.0');
const postgres = require('postgres');
assert(process.env.PAPERCLIP_PILOT_DB_PASSWORD, 'Supply local pilot DB password through the environment');
const sql = postgres({ host: '127.0.0.1', port: 54329, username: 'paperclip', database: 'paperclip',
  password: process.env.PAPERCLIP_PILOT_DB_PASSWORD, max: 1 });
try {
  const evidence = await sql.begin('read only', async tx => {
    const [agents] = await tx`
      select count(*)::int as count,
        bool_and(status='paused') as all_paused,
        bool_and(adapter_config->'env'->'OPENAI_API_KEY'->>'value'='') as all_api_keys_empty,
        bool_and(adapter_config->'env'->'CODEX_HOME'->>'value'=${path.resolve(expectedCodexHome)}) as all_external_empty_homes
      from agents`;
    const [runs] = await tx`select count(*)::int as count,
      count(*) filter (where status in ('running','queued'))::int as active from heartbeat_runs`;
    const [issues] = await tx`select count(*)::int as count from issues`;
    return { agents, heartbeatRuns: runs.count, activeRuns: runs.active, issues: issues.count,
      externalAuthFileExists: fs.existsSync(path.resolve(expectedCodexHome, 'auth.json')) };
  });
  assert.deepEqual(evidence.agents,
    { count: 19, all_paused: true, all_api_keys_empty: true, all_external_empty_homes: true });
  assert.equal(evidence.issues, expectedIssues);
  assert(evidence.heartbeatRuns >= minimumRuns);
  assert.equal(evidence.activeRuns, 0);
  assert.equal(evidence.externalAuthFileExists, false);
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await sql.end();
}
