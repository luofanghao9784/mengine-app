#!/usr/bin/env python3
"""Online read-only source dump + disposable local PG18 restore. NOT production activation.

Keeps private evidence and a stopped, isolated copy. Does not start the application,
copy files, reset identities, reconcile revocations or certify Linux compatibility.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile


FINGERPRINTS = r"""
SELECT format('SELECT json_build_object(''table'', %L, ''rows'', count(*), ''digest'', md5(coalesce(string_agg(h, '''' ORDER BY h COLLATE "C"), ''''))) FROM (SELECT md5(to_jsonb(t)::text) h FROM %I.%I t) x;',
 schemaname || '.' || tablename, schemaname, tablename)
FROM pg_tables WHERE schemaname='public' ORDER BY tablename
\gexec
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--instance', required=True, type=Path)
    parser.add_argument('--output-parent', required=True, type=Path)
    parser.add_argument('--pg-bin', default='/opt/homebrew/bin', type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    root = args.instance.resolve(strict=True)
    config = json.loads((root / 'config.json').read_text())
    tools = {name: str(args.pg_bin / name) for name in
             ['psql', 'pg_dump', 'pg_restore', 'pg_ctl', 'initdb', 'createdb']}
    clean = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    for tool in tools.values():
        if ' 18.' not in subprocess.check_output([tool, '--version'], text=True, env=clean):
            raise RuntimeError('Requires PostgreSQL 18 tools')
    args.output_parent.mkdir(parents=True, exist_ok=True)
    out = Path(tempfile.mkdtemp(prefix='database-', dir=args.output_parent)).resolve()
    source_env = dict(clean, PGPASSWORD=json.loads((root / 'database.json').read_text())['password'],
                      PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=120000',
                      PGCONNECT_TIMEOUT='5')
    source_args = ['-h', '127.0.0.1', '-p', str(config['ports']['database']),
                   '-U', 'dreamcore_trial', '-d', 'dreamcore_trial']
    log = (out / 'diagnostics.log').open('w')
    source = None
    started = False
    data = out / 'postgres'

    def run(command, env):
        subprocess.run(command, env=env, stdout=log, stderr=log, check=True, timeout=180)

    try:
        source = subprocess.Popen([tools['psql'], '-XqAt', '-v', 'ON_ERROR_STOP=1', *source_args],
                                  env=source_env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=log, text=True)
        source.stdin.write("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TIME ZONE 'UTC'; SELECT pg_export_snapshot();\n")
        source.stdin.flush()
        snapshot = source.stdout.readline().strip()
        if not snapshot or not all(c in '0123456789ABCDEFabcdef-' for c in snapshot):
            raise RuntimeError('Source snapshot not established')
        dump = out / 'database.dump'
        run([tools['pg_dump'], *source_args, '--format=custom', '--no-owner', '--no-acl',
             '--snapshot=' + snapshot, '--file=' + str(dump)], source_env)
        rows, _ = source.communicate(FINGERPRINTS + '\nCOMMIT;\n', timeout=180)
        if source.returncode:
            raise RuntimeError('Source fingerprint query failed')
        before = [json.loads(line) for line in rows.splitlines() if line.strip()]
        if not before:
            raise RuntimeError('Source contains no public tables')
        (out / 'source-tables.json').write_text(json.dumps(before, indent=2))

        password = secrets.token_urlsafe(32)
        pwfile = out / 'init-password'
        pwfile.write_text(password)
        target_env = dict(clean, PGPASSWORD=password, PGCONNECT_TIMEOUT='5')
        try:
            run([tools['initdb'], '-D', str(data), '-U', 'dreamcore_migration_check',
                 '--pwfile=' + str(pwfile), '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C'], target_env)
        finally:
            pwfile.unlink(missing_ok=True)
        with tempfile.TemporaryDirectory(prefix='dreamcore-check-', dir='/tmp') as sockets:
            # No TCP listener. Unique private Unix socket directory, no shared DB or existing path.
            run([tools['pg_ctl'], '-D', str(data), '-l', str(out / 'postgres.log'),
                 '-o', f"-h '' -k {sockets} -p 15432 -c shared_buffers=32MB -c max_connections=10",
                 '-w', 'start'], target_env)
            started = True
            target = ['-h', sockets, '-p', '15432', '-U', 'dreamcore_migration_check']
            run([tools['createdb'], *target, 'dreamcore_trial'], target_env)
            run([tools['pg_restore'], *target, '-d', 'dreamcore_trial', '--no-owner', '--no-acl',
                 '--exit-on-error', '--single-transaction', str(dump)], target_env)
            after_query = subprocess.run([tools['psql'], '-XqAt', *target, '-d', 'dreamcore_trial',
                                          '-v', 'ON_ERROR_STOP=1'], input="SET TIME ZONE 'UTC';\n" + FINGERPRINTS,
                                         env=dict(target_env, PGOPTIONS='-c default_transaction_read_only=on'),
                                         text=True, stdout=subprocess.PIPE, stderr=log, check=True, timeout=180)
            after = [json.loads(line) for line in after_query.stdout.splitlines() if line.strip()]
            (out / 'restored-tables.json').write_text(json.dumps(after, indent=2))
            if before != after:
                raise RuntimeError('Restored tables differ; preserve private evidence')
            run([tools['pg_ctl'], '-D', str(data), '-m', 'fast', '-w', 'stop'], target_env)
            started = False
        # Keep dump, manifest and stopped cluster private. Password not persisted; no service runs.
        result = {'status': 'LOCAL_DATABASE_RESTORE_VERIFIED', 'tables': len(before),
                  'rows': sum(t['rows'] for t in before), 'dumpBytes': dump.stat().st_size,
                  'dumpSha256': hashlib.sha256(dump.read_bytes()).hexdigest(),
                  'evidence': str(out), 'scope': 'same snapshot table counts and logical row digests; local PG18 only; no activation'}
        (out / 'verification.json').write_text(json.dumps(result, indent=2))
        print(json.dumps(result))
    finally:
        if source is not None and source.poll() is None:
            source.terminate()
            source.wait(timeout=10)
        if started:
            subprocess.run([tools['pg_ctl'], '-D', str(data), '-m', 'fast', '-w', 'stop'],
                           env=clean, stdout=log, stderr=log, timeout=30)
        log.close()


if __name__ == '__main__':
    main()
