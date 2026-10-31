#!/usr/bin/env python3
"""Read-only queue diagnostics around original tests, in a wrapper-owned DB.

Run from the source repository root, under scripts/with-test-postgres.py.
No production SQL mutations or fixture cleanup are performed here.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import xml.etree.ElementTree as ET


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-sha', required=True)
    parser.add_argument('--results', required=True, type=Path)
    parser.add_argument('--maven-settings', type=Path)
    parser.add_argument('selectors', nargs='+')
    args = parser.parse_args()
    cwd = Path.cwd().resolve()
    if not (cwd / 'apps/api/pom.xml').is_file():
        parser.error('Run from the repository root')
    sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    if not re.fullmatch(r'[0-9a-f]{40}', args.expected_sha) or sha != args.expected_sha:
        parser.error('Actual checkout differs from the required full SHA')
    if args.maven_settings:
        args.maven_settings = args.maven_settings.resolve(strict=True)
        if not args.maven_settings.is_file():
            parser.error('Maven settings must be a readable local file; contents are never exported')
    for selector in args.selectors:
        if not re.fullmatch(r'[A-Za-z0-9_.]+(?:#[A-Za-z0-9_+]+)?', selector):
            parser.error('Only explicit class/method selectors are accepted')
    match = re.fullmatch(r'jdbc:postgresql://127\.0\.0\.1:([0-9]+)/dreamcore_test', os.environ.get('DATABASE_URL', ''))
    if not match or os.environ.get('DATABASE_USER') != 'dreamcore_test' or not os.environ.get('DATABASE_PASSWORD'):
        parser.error('Use the original disposable PostgreSQL wrapper; no live/shared database fallback')
    binary = str(Path(os.environ['POSTGRES_BIN']) / 'psql') if os.environ.get('POSTGRES_BIN') else shutil.which('psql')
    if not binary:
        parser.error('PostgreSQL18 psql is required')
    env = os.environ.copy()
    env['PGPASSWORD'] = env['DATABASE_PASSWORD']

    def query(database, sql):
        command = [binary, '-X', '-h', '127.0.0.1', '-p', match[1], '-U', 'dreamcore_test', '-d', database, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql]
        output = subprocess.run(command, env=env, check=True, capture_output=True, text=True)
        return output.stdout.strip()

    if query('dreamcore_test', 'SELECT current_database()||\'/\'||current_user') != 'dreamcore_test/dreamcore_test':
        parser.error('Disposable cluster identity did not match')
    dest = args.results.resolve()
    dest.mkdir(parents=True, exist_ok=False)  # Never overwrite earlier evidence.
    (dest / 'checkout.json').write_text(json.dumps({'actualSha': sha, 'selectors': args.selectors}, indent=2))
    sql = """SELECT coalesce(json_agg(q),'[]') FROM (
      SELECT r.id,r.tenant_id,r.workspace_id,r.material_id,r.version_id,r.requested_by,
      r.status,r.attempts,r.lease_until,r.created_at,
      EXISTS(SELECT 1 FROM active_materials m WHERE m.id=r.material_id AND m.tenant_id=r.tenant_id AND m.workspace_id=r.workspace_id) AS material_active,
      EXISTS(SELECT 1 FROM material_versions v WHERE v.id=r.version_id AND v.tenant_id=r.tenant_id AND v.workspace_id=r.workspace_id AND v.material_id=r.material_id) AS version_exists,
      library_mask(r.requested_by,r.tenant_id,'MATERIAL',r.material_id) AS actor_material_mask
      FROM knowledge_runs r WHERE r.status IN ('QUEUED','RUNNING') ORDER BY r.created_at,r.id) q"""

    def snapshot(place, name):
        # Include test-owned isolated databases, so a fixture-isolation fix remains observable.
        databases = query('dreamcore_test', "SELECT datname FROM pg_database WHERE datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user) ORDER BY datname").splitlines()
        snapshot_data = {}
        for database in databases:
            if database != 'dreamcore_test' and not re.fullmatch(r'dreamcore_isolated_test_[0-9a-f]{32}', database):
                continue
            if query(database, "SELECT to_regclass('public.knowledge_runs') IS NOT NULL") != 't':
                snapshot_data[database] = {'schemaNotMigrated': True, 'queue': []}
            else:
                snapshot_data[database] = {'queue': json.loads(query(database, sql))}
        (place / (name + '.json')).write_text(json.dumps(snapshot_data, indent=2))

    results = []
    failed = False
    for index, selector in enumerate(args.selectors, 1):
        place = dest / (str(index) + '-' + selector.split('#')[0])
        place.mkdir()
        snapshot(place, 'before')
        reports = cwd / 'apps/api/target/surefire-reports'
        if reports.exists():
            shutil.rmtree(reports)  # Generated output only; the previous step was archived.
        command = ['./apps/api/mvnw']
        if args.maven_settings:
            command += ['-s', str(args.maven_settings)]
        command += ['-B', '-f', 'apps/api/pom.xml', '-Dtest=' + selector, 'test']
        (place / 'argv.json').write_text(json.dumps(command, indent=2))
        started = time.time()
        code = 130
        interrupted = False
        try:
            with (place / 'output.log').open('w') as log:
                code = subprocess.run(command, cwd=cwd, stdout=log, stderr=subprocess.STDOUT).returncode
        except KeyboardInterrupt:
            interrupted = True
        finally:
            (place / 'exit-code.txt').write_text(str(code) + '\n')
            if reports.exists():
                shutil.copytree(reports, place / 'surefire')
            summary = []
            if reports.exists():
                for file in sorted(reports.glob('TEST-*.xml')):
                    suite = ET.parse(file).getroot()
                    row = {key: suite.get(key) for key in ('name', 'tests', 'failures', 'errors', 'skipped', 'time')}
                    row['issues'] = [issue.get('message', '') for case in suite.findall('testcase') for issue in case if issue.tag in ('failure', 'error')]
                    summary.append(row)
            result = {'selector': selector, 'actualSha': sha, 'argv': command, 'exit': code, 'started': started, 'completed': time.time(), 'summary': summary}
            (place / 'result.json').write_text(json.dumps(result, indent=2))
            results.append(result)
            (dest / 'sequence.json').write_text(json.dumps(results, indent=2))
        if interrupted:
            return 130
        snapshot(place, 'after')
        failed |= code != 0
        print(json.dumps(result), flush=True)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
