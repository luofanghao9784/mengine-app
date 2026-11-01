// Same-host recovery drill. Never restores over the source DB or imports tasks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const [runtimeRootArg, privateBackupDirArg, backupEngine = 'pg_dump'] = process.argv.slice(2);
assert(runtimeRootArg && privateBackupDirArg, 'Pass runtime root and new private backup directory');
assert(process.env.PAPERCLIP_PILOT_DB_PASSWORD, 'Local pilot DB password must be supplied privately');
assert(['pg_dump', 'javascript'].includes(backupEngine));
if (backupEngine === 'pg_dump') {
  assert(path.isAbsolute(process.env.PAPERCLIP_PG_DUMP_PATH || ''), 'Explicit native pg_dump path required');
  assert(path.isAbsolute(process.env.PAPERCLIP_PSQL_PATH || ''), 'Explicit native psql path required');
}
const runtimeRoot = path.resolve(runtimeRootArg);
const backupDir = path.resolve(privateBackupDirArg);
assert(!fs.existsSync(backupDir), 'Backup directory must be new');
const require = createRequire(path.join(runtimeRoot, 'node_modules/paperclipai/package.json'));
assert.equal(require('./package.json').version, '2026.1023.0');
const postgres = require('postgres');
const { runDatabaseBackup, runDatabaseRestore } = await import(pathToFileURL(
  path.join(runtimeRoot, 'node_modules/@paperclipai/db/dist/backup-lib.js')).href);
const options = { host: '127.0.0.1', port: 54329, username: 'paperclip',
  password: process.env.PAPERCLIP_PILOT_DB_PASSWORD, max: 1 };
const source = postgres({ ...options, database: 'paperclip' });
let target;
const targetName = 'mengine_recovery_' + crypto.randomBytes(8).toString('hex');
const connectionString = database => {
  const value = new URL('postgres://127.0.0.1:54329/');
  value.username = options.username;
  value.password = options.password;
  value.pathname = '/' + database;
  return value.toString();
};
const quote = name => '"' + name.replaceAll('"', '""') + '"';

async function fingerprint(sql) {
  return sql.begin('isolation level repeatable read read only', async tx => {
    const tables = await tx`select table_schema, table_name from information_schema.tables
      where table_type='BASE TABLE' and table_schema not in ('pg_catalog','information_schema')
      and table_schema not like 'pg_%' order by table_schema, table_name`;
    const rows = [];
    for (const { table_schema: schema, table_name: name } of tables) {
      const [row] = await tx.unsafe(`select count(*)::int as count,
        md5(coalesce(string_agg(payload, E'\\n' order by payload),'')) as hash
        from (select to_jsonb(t)::text as payload from ${quote(schema)}.${quote(name)} t) r`);
      rows.push({ schema, name, ...row });
    }
    return rows;
  });
}

try {
  const companies = await source`select id,name,status from companies`;
  assert.equal(companies.length, 1);
  assert.equal(companies[0].id, '5923bae1-b181-40f6-b060-e772fef05b8e');
  assert.equal(companies[0].name, 'MENGINE Paperclip 隔离试点 100');
  assert.equal(companies[0].status, 'paused');
  const [guard] = await source`select count(*)::int as count, bool_and(status='paused') as paused from agents`;
  assert.equal(guard.count, 19);
  assert.equal(guard.paused, true);
  fs.mkdirSync(backupDir, { mode: 0o700, recursive: false });
  const before = await fingerprint(source);
  const backup = await runDatabaseBackup({ connectionString: connectionString('paperclip'),
    backupDir, filenamePrefix: 'mengine-paused-pilot', backupEngine,
    retention: { dailyDays: 30, weeklyWeeks: 4, monthlyMonths: 1 } });
  fs.chmodSync(backup.backupFile, 0o600);
  const afterBackup = await fingerprint(source);
  assert.deepEqual(afterBackup, before, 'Source changed during backup; do not accept this recovery point');
  await source.unsafe('CREATE DATABASE ' + quote(targetName));
  const started = performance.now();
  await runDatabaseRestore({ connectionString: connectionString(targetName), backupFile: backup.backupFile });
  target = postgres({ ...options, database: targetName });
  const restored = await fingerprint(target);
  const differences = restored.filter((row, i) => JSON.stringify(row) !== JSON.stringify(before[i]))
    .map(row => ({ schema: row.schema, table: row.name }));
  assert.deepEqual(await fingerprint(source), before, 'Source changed during restore drill');
  const sha = value => crypto.createHash('sha256').update(value).digest('hex');
  console.log(JSON.stringify({ status: differences.length ? 'FAIL' : 'PASS', observedAt: new Date().toISOString(),
    scope: 'SAME_HOST_NEW_DATABASE_LOGICAL_RESTORE_ONLY',
    backupEngine, tablesCompared: before.length,
    sourceUnchanged: true, allRowsMatch: differences.length === 0, differences, restoredCompanyPaused: true,
    backupSha256: sha(fs.readFileSync(backup.backupFile)), backupBytes: backup.sizeBytes,
    datasetFingerprintSha256: sha(JSON.stringify(before)),
    restoreAndCompareMs: Math.round(performance.now() - started),
    sourceDatabase: 'paperclip', isolatedRestoreDatabase: targetName,
    backupArchivePublished: false, credentialsRestoredToLiveService: false,
    crossHostRecovery: 'NOT_TESTED', crashDuringActiveModelRun: 'NOT_TESTED', rpo: 'NOT_ESTABLISHED' }, null, 2));
  if (differences.length) process.exitCode = 1;
} finally {
  if (target) await target.end();
  await source.end();
}
