#!/usr/bin/env python3
"""Read-only size inventory for an existing local trial; never prints credentials/content."""
import argparse
import json
import os
from pathlib import Path
import subprocess


def inventory(root, psql):
    root = root.resolve(strict=True)
    config = json.loads((root / 'config.json').read_text())
    result = {'instance': str(root), 'allocatedBytes': {}}
    for name, path in [('instance', root), ('databaseCluster', root / 'postgres'),
                       ('objects', root / 'objects'), ('logs', root / 'logs'),
                       ('walIncludedInDatabaseCluster', root / 'postgres/pg_wal')]:
        if path.exists():
            size = subprocess.check_output(['du', '-sk', str(path)], text=True)
            result['allocatedBytes'][name] = int(size.split()[0]) * 1024
    result['objectFiles'] = sum(p.is_file() for p in (root / 'objects').rglob('*'))
    # Secret stays in child environment; never passed in command arguments or output.
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    env.update(PGPASSWORD=json.loads((root / 'database.json').read_text())['password'],
               PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=15000',
               PGCONNECT_TIMEOUT='5')
    sql = """SELECT json_build_object(
      'serverVersion', current_setting('server_version'),
      'databaseBytes', pg_database_size(current_database()),
      'migration', (SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank DESC LIMIT 1),
      'largestTables', (SELECT json_agg(t) FROM
        (SELECT relname AS name, pg_total_relation_size(relid) AS bytes
         FROM pg_catalog.pg_statio_user_tables ORDER BY bytes DESC LIMIT 8) t));"""
    command = [psql, '-X', '-h', '127.0.0.1', '-p', str(config['ports']['database']),
               '-U', 'dreamcore_trial', '-d', 'dreamcore_trial', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql]
    query = subprocess.run(command, env=env, text=True, capture_output=True, timeout=25)
    if query.returncode:
        raise RuntimeError('Database inventory failed; no credentials or server error text emitted')
    result['database'] = json.loads(query.stdout)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--instance', type=Path, required=True)
    parser.add_argument('--psql', default='psql')
    args = parser.parse_args()
    print(json.dumps(inventory(args.instance, args.psql), ensure_ascii=False, indent=2))
