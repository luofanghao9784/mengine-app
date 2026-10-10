#!/usr/bin/env python3
"""Prepare a private host API rehearsal from stopped, verified Linux data copies.

Does not change the public ai.9pop.top site, start models or enable boot startup.
Requires a dedicated dreamcore user and a verified stopped PG18 rehearsal.
"""
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import pwd
import shutil
import socket
import subprocess

ROOT = Path('/var/lib/dreamcore/app-check-20261010')
PG = Path('/var/lib/dreamcore/db-check-20261009')
INPUT = Path('/home/ubuntu/dreamcore-app-input-20261010')
OBJECTS = Path('/home/ubuntu/dreamcore-objects-check-20261010')
NAME = 'dreamcore-app-check-20261010'
IMAGE = 'sha256:885953109528ad3dfc90362b1a6f50a78620b5315be19f187753d267e484dc5b'
UNIT = Path('/etc/systemd/system/dreamcore-app-rehearsal.service')
SITE = Path('/etc/nginx/conf.d/dreamcore-app-rehearsal.conf')


def call(args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, timeout=120)


def main():
    if os.getuid() != 0 or ROOT.exists() or UNIT.exists() or SITE.exists():
        raise RuntimeError('Requires root and entirely new rehearsal paths')
    owner = pwd.getpwnam('dreamcore')
    previous = json.loads((PG/'verification.json').read_text())
    state = json.loads(subprocess.check_output(['docker', 'inspect', previous['container']]))[0]
    if state['State']['Running'] or previous['status'] != 'LINUX_DATABASE_RESTORE_VERIFIED':
        raise RuntimeError('Verified source database must be stopped')
    for port in [18481, 18443]:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', port))
    subprocess.run(['python3', str(OBJECTS/'snapshot-objects.py'), 'verify', '--snapshot', str(OBJECTS)], check=True)
    release = json.loads((INPUT/'release-manifest.json').read_text())
    for row in release['files']:
        path = (INPUT/row['path']).resolve(strict=True)
        if INPUT not in path.parents or hashlib.sha256(path.read_bytes()).hexdigest() != row['sha256']:
            raise RuntimeError('Release digest mismatch')
    os.umask(0o077)
    ROOT.mkdir(mode=0o750)
    os.chown(ROOT, 0, owner.pw_gid)
    ROOT.chmod(0o750)
    shutil.copytree(PG/'postgres', ROOT/'postgres')
    shutil.copytree(PG/'secrets', ROOT/'secrets')
    call(['chown', '-R', '999:999', str(ROOT/'postgres'), str(ROOT/'secrets')])
    shutil.copytree(OBJECTS/'objects', ROOT/'objects')
    call(['chown', '-R', 'dreamcore:dreamcore', str(ROOT/'objects')])
    (ROOT/'objects').chmod(0o700)
    shutil.copytree(INPUT/'release', ROOT/'release')
    call(['chown', '-R', 'root:dreamcore', str(ROOT/'release')])
    for path in [ROOT/'release', *(ROOT/'release').rglob('*')]:
        path.chmod(0o550 if path.is_dir() else 0o440)
    # Nginx's worker only reads the public frontend bundle, not the object store.
    web = Path('/var/www/dreamcore-app-check-20261010')
    if web.exists():
        raise RuntimeError('Web rehearsal path already exists')
    shutil.copytree(INPUT/'release/web', web)
    for path in [web, *web.rglob('*')]:
        path.chmod(0o755 if path.is_dir() else 0o644)
    tmp = ROOT/'tmp'; tmp.mkdir(mode=0o700); os.chown(tmp, owner.pw_uid, owner.pw_gid)
    env = {
        'API_HOST': '127.0.0.1', 'API_PORT': '18481',
        'DATABASE_URL': 'jdbc:postgresql://127.0.0.1:18432/dreamcore_trial',
        'DATABASE_USER': 'dreamcore_migration_check',
        'DATABASE_PASSWORD': (PG/'secrets/password').read_text().strip(),
        'MATERIAL_STORAGE_ROOT': str(ROOT/'objects'), 'TASK_ENABLED': 'false',
        'AGENT_TASK_MODE': 'off', 'KNOWLEDGE_ENABLED': 'false',
        'KNOWLEDGE_PARSER_ROOT': '/var/lib/dreamcore-runtime/linux-check-20261009/workers/parser',
        'DREAMCORE_COLLECTION_ENABLED': 'false', 'DREAMCORE_BRIEFING_ENABLED': 'false',
        'BRIEFING_DAILY_ENABLED': 'false', 'BRIEFING_AUTOMATIC_ENABLED': 'false',
        'ONGOING_PLANS_ENABLED': 'false', 'COMPANY_INFORMATION_ENABLED': 'false',
        'EXPERIENCE_INTAKE_ENABLED': 'false', 'EXPERIENCE_ANALYSIS_ENABLED': 'false',
        'EXPERIENCE_GENERALIZATION_ENABLED': 'false', 'INVITATION_DELIVERY': 'disabled',
        'PHONE_DELIVERY': 'disabled', 'PHONE_LOCAL_PREVIEW': 'false',
        'ENGINE_BASE_URL': 'http://127.0.0.1:18482',
        'SERVER_SERVLET_SESSION_COOKIE_NAME': 'DREAMCORE_AI_REHEARSAL',
        'PLATFORM_COOKIE_NAME': 'DREAMCORE_AI_PLATFORM_REHEARSAL',
        # Only the loopback Nginx proxy can supply the trusted HTTPS metadata.
        'SERVER_FORWARD_HEADERS_STRATEGY': 'native',
        'SERVER_TOMCAT_REMOTEIP_INTERNAL_PROXIES': '127[.]0[.]0[.]1|::1',
        'SERVER_TOMCAT_REMOTEIP_PROTOCOL_HEADER': 'x-forwarded-proto',
    }
    (ROOT/'api.env').write_text(''.join(k+'='+v+'\n' for k,v in env.items()))
    call(['docker', 'network', 'create', '--internal', NAME])
    network = json.loads(subprocess.check_output(['docker', 'network', 'inspect', NAME]))[0]
    subnet = ipaddress.ip_network(network['IPAM']['Config'][0]['Subnet'])
    database_ip = str(subnet.network_address + 10)
    env['DATABASE_URL'] = f'jdbc:postgresql://{database_ip}:5432/dreamcore_trial'
    (ROOT/'api.env').write_text(''.join(k+'='+v+'\n' for k,v in env.items()))
    call(['docker', 'create', '--name', NAME, '--network', NAME, '--ip', database_ip, '--user', '999:999',
          '--memory', '512m', '--memory-swap', '512m', '--cpus', '0.4', '--pids-limit', '128',
          '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
          '--restart', 'no', '--log-driver', 'local', '--log-opt', 'max-size=5m', '--log-opt', 'max-file=2',
          '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m',
          '--tmpfs', '/var/run/postgresql:rw,nosuid,nodev,size=1m,uid=999,gid=999,mode=0770',
          '-v', str(ROOT/'postgres')+':/var/lib/postgresql',
          '-v', str(ROOT/'secrets')+':/run/secrets:ro',
          '-e', 'PGDATA=/var/lib/postgresql/data', '-e', 'PGPASSFILE=/run/secrets/pgpass',
          IMAGE, 'postgres', '-c', 'listen_addresses=*', '-c', 'shared_buffers=32MB', '-c', 'max_connections=20'])
    disabled = ['lifecycle.enabled', 'object-lifecycle.enabled', 'operation-retention.enabled',
                'departure.worker-enabled', 'departure.archive-worker-enabled', 'exports.worker-enabled']
    flags = ' '.join('--dreamcore.'+key+'=false' for key in disabled)
    UNIT.write_text(f'''[Unit]
Description=Dreamcore private application rehearsal
After=network.target user@{owner.pw_uid}.service
Requires=user@{owner.pw_uid}.service
[Service]
Type=exec
User=dreamcore
Group=dreamcore
WorkingDirectory={ROOT}
EnvironmentFile={ROOT}/api.env
ExecStart=/usr/bin/java -Xms128m -Xmx768m -XX:ActiveProcessorCount=2 -Djava.io.tmpdir={tmp} -jar {ROOT}/release/api.jar {flags}
Restart=no
SuccessExitStatus=143
UMask=0077
MemoryMax=1280M
MemorySwapMax=0
CPUQuota=75%
TasksMax=192
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths={ROOT}/objects {tmp}
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
IPAddressDeny=any
IPAddressAllow=localhost {database_ip}
''')
    SITE.write_text(f'''# Private rehearsal only. Public ai.9pop.top remains a maintenance page.
server {{
 listen 127.0.0.1:18443 ssl;
 server_name ai.9pop.top;
 ssl_certificate /etc/letsencrypt/live/ai.9pop.top/fullchain.pem;
 ssl_certificate_key /etc/letsencrypt/live/ai.9pop.top/privkey.pem;
 root {web};
 client_max_body_size 65m;
 location = / {{ return 503; }}
 location /internal/ {{ return 404; }}
 location /actuator/ {{ return 404; }}
 location /api/ {{
  proxy_pass http://127.0.0.1:18481;
  proxy_set_header Host ai.9pop.top;
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_buffering off;
 }}
 location /workspace/ {{ try_files $uri $uri/ /workspace/index.html; }}
 location /tenant-admin/ {{ try_files $uri $uri/ /tenant-admin/index.html; }}
 location /platform-admin/ {{ try_files $uri $uri/ /platform-admin/index.html; }}
 location /assets/ {{ try_files $uri =404; }}
 location / {{ try_files $uri =404; }}
}}
''')
    UNIT.chmod(0o644); SITE.chmod(0o644)
    call(['nginx', '-t'])
    call(['systemctl', 'daemon-reload'])
    shutil.copyfile(INPUT/'release-manifest.json', ROOT/'release-manifest.json')
    print(json.dumps({'status': 'PRIVATE_REHEARSAL_PREPARED', 'root': str(ROOT),
                      'database': NAME, 'unit': UNIT.name, 'servicesStarted': False}))


if __name__ == '__main__':
    main()
