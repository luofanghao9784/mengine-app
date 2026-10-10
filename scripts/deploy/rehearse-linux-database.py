#!/usr/bin/env python3
"""Restore an already verified rehearsal dump in a new offline PG18 container.

Run as the server administrator. Requires an explicitly verified local image ID.
No host port, application, model or scheduler starts. Stops the container on exit.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import time
import uuid

FINGERPRINTS = r"""
SET TIME ZONE 'UTC';
SELECT format('SELECT json_build_object(''table'', %L, ''rows'', count(*), ''digest'', md5(coalesce(string_agg(h, '''' ORDER BY h COLLATE "C"), ''''))) FROM (SELECT md5(to_jsonb(t)::text) h FROM %I.%I t) x;',
 schemaname || '.' || tablename, schemaname, tablename)
FROM pg_tables WHERE schemaname='public' ORDER BY tablename
\gexec
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--root', type=Path, required=True, help='Must not exist')
    parser.add_argument('--image-id', required=True)
    args = parser.parse_args()
    if os.getuid() != 0:
        raise RuntimeError('Administrator required for private bind mount ownership')
    if not args.image_id.startswith('sha256:') or len(args.image_id) != 71:
        raise RuntimeError('An exact image ID is required')
    inspected = json.loads(subprocess.check_output(['docker', 'image', 'inspect', args.image_id]))[0]
    if inspected['Architecture'] != 'amd64' or inspected['Os'] != 'linux':
        raise RuntimeError('Unexpected image platform')
    incoming = args.input.resolve(strict=True)
    verification = json.loads((incoming / 'verification.json').read_text())
    dump = incoming / 'database.dump'
    if hashlib.sha256(dump.read_bytes()).hexdigest() != verification['dumpSha256']:
        raise RuntimeError('Source dump digest mismatch')
    before = json.loads((incoming / 'source-tables.json').read_text())
    os.umask(0o077)
    root = args.root.absolute()
    root.mkdir(mode=0o700, parents=False, exist_ok=False)
    for name in ['postgres', 'secrets', 'input']:
        (root / name).mkdir(mode=0o700)
        os.chown(root / name, 999, 999)
    shutil.copyfile(dump, root / 'input/database.dump')
    os.chown(root / 'input/database.dump', 999, 999)
    password = secrets.token_urlsafe(32)
    for name, value in [('password', password), ('pgpass', '*:*:*:dreamcore_migration_check:' + password + '\n')]:
        path = root / 'secrets' / name
        path.write_text(value)
        os.chown(path, 999, 999)
        path.chmod(0o600)
    name = 'dreamcore-pg-check-' + uuid.uuid4().hex[:12]
    log = (root / 'diagnostics.log').open('w')
    created = False

    def run(command, **kwargs):
        return subprocess.run(command, check=True, stdout=log, stderr=log, timeout=240, **kwargs)

    try:
        run(['docker', 'create', '--name', name, '--network', 'none', '--user', '999:999',
             '--memory', '512m', '--memory-swap', '512m', '--cpus', '0.4', '--pids-limit', '128',
             '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
             '--restart', 'no', '--log-driver', 'local', '--log-opt', 'max-size=5m', '--log-opt', 'max-file=2',
             '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m',
             '--tmpfs', '/var/run/postgresql:rw,nosuid,nodev,size=1m,uid=999,gid=999,mode=0770',
             '-v', str(root/'postgres') + ':/var/lib/postgresql',
             '-v', str(root/'secrets') + ':/run/secrets:ro',
             '-v', str(root/'input') + ':/input:ro',
             '-e', 'PGDATA=/var/lib/postgresql/data', '-e', 'POSTGRES_USER=dreamcore_migration_check',
             '-e', 'POSTGRES_DB=dreamcore_trial', '-e', 'POSTGRES_PASSWORD_FILE=/run/secrets/password',
             '-e', 'PGPASSFILE=/run/secrets/pgpass',
             '-e', 'POSTGRES_INITDB_ARGS=--auth=scram-sha-256 --encoding=UTF8 --locale=C',
             args.image_id, 'postgres', '-c', 'listen_addresses=', '-c', 'shared_buffers=32MB',
             '-c', 'max_connections=10'])
        created = True
        run(['docker', 'start', name])
        base = ['docker', 'exec', '--user', '999:999', name]
        connection = ['-h', '/var/run/postgresql', '-U', 'dreamcore_migration_check', '-d', 'dreamcore_trial']
        for _ in range(60):
            ready = subprocess.run(base + ['pg_isready', *connection], stdout=log, stderr=log, timeout=5)
            if ready.returncode == 0:
                # initdb temporarily starts a server too; wait for entrypoint to exec postgres.
                pid1 = subprocess.check_output(base + ['cat', '/proc/1/comm'], text=True).strip()
                if pid1 == 'postgres':
                    break
            time.sleep(1)
        else:
            raise RuntimeError('Isolated PG18 did not become ready')
        run(base + ['pg_restore', *connection, '--no-owner', '--no-acl', '--single-transaction',
                    '--exit-on-error', '/input/database.dump'])
        result = subprocess.run(['docker', 'exec', '-i', '--user', '999:999', name, 'psql',
                                 '-XqAt', '-v', 'ON_ERROR_STOP=1', *connection],
                                input=FINGERPRINTS, text=True, stdout=subprocess.PIPE, stderr=log,
                                check=True, timeout=240)
        after = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
        (root / 'restored-tables.json').write_text(json.dumps(after, indent=2))
        if before != after:
            raise RuntimeError('Linux restored table counts or contents differ')
        report = {'status': 'LINUX_DATABASE_RESTORE_VERIFIED', 'tables': len(after),
                  'rows': sum(t['rows'] for t in after), 'dumpSha256': verification['dumpSha256'],
                  'imageId': args.image_id, 'container': name, 'evidence': str(root),
                  'scope': 'historical rehearsal snapshot public tables only; no application activation'}
        (root/'verification.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report))
    finally:
        if created:
            subprocess.run(['docker', 'logs', name], stdout=log, stderr=log, timeout=15)
            stopped = subprocess.run(['docker', 'stop', '-t', '20', name], stdout=log, stderr=log, timeout=30)
            if stopped.returncode:
                subprocess.run(['docker', 'kill', name], stdout=log, stderr=log, timeout=15, check=True)
        log.close()


if __name__ == '__main__':
    main()
