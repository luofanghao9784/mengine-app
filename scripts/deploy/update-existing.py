#!/usr/bin/env python3
"""Update the existing ai.9pop.top rehearsal, from a verified release manifest.
Run as root on the deployment host with an uploaded stage directory argument.
On failure keeps public API gated; never automatically discards database writes.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

stage = Path(sys.argv[1]).resolve(strict=True)
manifest = json.loads((stage / 'manifest.json').read_text())
sha = manifest['commit']
assert len(sha) == 40 and all(c in '0123456789abcdef' for c in sha)
assert os.getuid() == 0
root = Path('/var/lib/dreamcore/app-check-20261010')
web = Path('/var/www/dreamcore-app-check-20261010')
site = Path('/var/www/dreamcore-site-public-fixed-20261010')
parser = Path('/var/lib/dreamcore-runtime/linux-check-20261009/workers/parser')
conf = Path('/etc/nginx/sites-available/ai.9pop.top.conf')
unit = 'dreamcore-app-rehearsal.service'
container = 'dreamcore-app-check-20261010'
evidence = Path('/var/lib/dreamcore/deploy-evidence') / ('unified-' + sha[:12])
def run(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE).strip()
def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()
def psql(query):
    return run('docker', 'exec', container, 'psql', '-U', 'dreamcore_migration_check', '-d', 'dreamcore_trial', '-Atc', query)
for rel, expected in manifest['files'].items():
    file = (stage / rel).resolve(strict=True)
    assert stage in file.parents and digest(file) == expected
assert psql('select max(version::int) from flyway_schema_history where success') == '98'
assert 'location /api/ {' in conf.read_text()
# Verify task/delivery configuration without printing credentials.
env = dict(line.split('=', 1) for line in (root/'api.env').read_text().splitlines() if '=' in line)
for key in ['TASK_ENABLED', 'KNOWLEDGE_ENABLED', 'DREAMCORE_COLLECTION_ENABLED', 'BRIEFING_DAILY_ENABLED']:
    assert env[key] == 'false', key
assert env['PHONE_DELIVERY'] == 'disabled' and env['INVITATION_DELIVERY'] == 'disabled'
os.umask(0o077)
evidence.mkdir(mode=0o700)
shutil.copy2(stage/'manifest.json', evidence/'manifest.json')
shutil.copy2(conf, evidence/'nginx-before.conf')
shutil.copy2(root/'release/api.jar', evidence/'api-before.jar')
shutil.copytree(web, evidence/'web-before')
shutil.copytree(site, evidence/'site-before')
(evidence/'parser-before').mkdir()
for rel in manifest['files']:
    if rel.startswith('parser/') and (parser/Path(rel).name).exists():
        shutil.copy2(parser/Path(rel).name, evidence/'parser-before'/Path(rel).name)
nginx_before = {str(p): digest(p) for p in Path('/etc/nginx/sites-available').glob('*') if p.is_file()}
conf.write_text(conf.read_text().replace('location /api/ {', 'location /api/ {\n  return 503; # release gate', 1))
run('nginx', '-t'); run('systemctl', 'reload', 'nginx')
try:
    run('systemctl', 'stop', unit)
    with (evidence/'database-before.dump').open('wb') as out:
        subprocess.run(['docker','exec',container,'pg_dump','-U','dreamcore_migration_check','-d','dreamcore_trial','-Fc'], stdout=out, check=True)
    assert (evidence/'database-before.dump').stat().st_size > 1000
    with (evidence/'database-before.dump').open('rb') as saved:
        subprocess.run(['docker','exec','-i',container,'pg_restore','--list'],stdin=saved,stdout=subprocess.DEVNULL,check=True)
    before = psql("select (select count(*) from accounts)||','||(select count(*) from tenant_memberships)||','||(select count(*) from tenants)")
    shutil.copyfile(stage/'api.jar', root/'release/api.jar')
    (root/'release/api.jar').chmod(0o440)
    for rel in sorted(manifest['files'], key=lambda r: r.endswith('.html')):
        if rel == 'api.jar': continue
        prefix, rest = rel.split('/', 1)
        target = {'web':web,'site':site,'parser':parser}[prefix]/rest
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(target.name+'.release-tmp')
        shutil.copyfile(stage/rel,tmp); tmp.chmod(0o644); os.replace(tmp,target)
    run('systemctl','start',unit)
    for _ in range(90):
        try:
            run('curl','-fsS','http://127.0.0.1:18481/api/v1/auth/csrf')
            break
        except subprocess.CalledProcessError: time.sleep(2)
    else: raise RuntimeError('API readiness failed; public API remains gated')
    assert psql('select max(version::int) from flyway_schema_history where success') == '108'
    assert psql('select count(*) from flyway_schema_history where not success') == '0'
    assert psql("select (select count(*) from accounts)||','||(select count(*) from tenant_memberships)||','||(select count(*) from tenants)") == before
    for rel, expected in manifest['files'].items():
        if rel == 'api.jar': target = root/'release/api.jar'
        else:
            prefix, rest = rel.split('/',1); target={'web':web,'site':site,'parser':parser}[prefix]/rest
        assert digest(target) == expected
    shutil.copy2(evidence/'nginx-before.conf',conf)
    run('nginx','-t'); run('systemctl','reload','nginx')
    assert nginx_before == {str(p):digest(p) for p in Path('/etc/nginx/sites-available').glob('*') if p.is_file()}
    report={'commit':sha,'migration':108,'files':len(manifest['files']),'identityCountsPreserved':True,'nginxUnchanged':True,'backup':str(evidence),'databaseBackupSha256':digest(evidence/'database-before.dump')}
    (evidence/'verification.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report))
except BaseException:
    print('Release incomplete; inspect protected evidence at '+str(evidence), file=sys.stderr)
    raise
