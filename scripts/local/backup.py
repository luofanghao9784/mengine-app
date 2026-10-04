#!/usr/bin/env python3
"""Offline logical backup of an owned local trial. Restore only to a new private directory."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from functools import lru_cache
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import uuid
import trial

FORMAT = 'dreamcore-local-backup-v2'
KEY_FORMATS = {FORMAT, 'dreamcore-local-backup-v1'}
RETENTION_DAYS = 30
KEY_FILE = trial.WORKSPACE / '.local' / 'backup-private' / 'signing.json'
MAX_BYTES = 2 * 1024**3
MAX_FILES = 10001
TRANSIENT = {'spring_session', 'spring_session_attributes', 'phone_challenges', 'platform_sessions'}


def fail(message):
    raise trial.TrialError(message)


@lru_cache(maxsize=5)
def pg(name):
    path = str(Path(os.environ['POSTGRES_BIN']) / name) if os.environ.get('POSTGRES_BIN') else shutil.which(name)
    if not path or not Path(path).is_file():
        fail('缺少 PostgreSQL 18 工具。')
    version = subprocess.check_output([path, '--version'], env=trial.clean_environment(), text=True)
    if not re.search(r'\b18\.\d+', version):
        fail('本批备份/还原只支持 PostgreSQL 18。')
    return path


def regular(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o077:
        fail('备份输入必须是本人所有的普通私有文件。')


def digest(path):
    regular(path)
    if path.stat().st_size > MAX_BYTES:
        fail('备份文件超过 2 GiB 上限。')
    value = hashlib.sha256()
    with path.open('rb') as source:
        while chunk := source.read(1024 * 1024):
            value.update(chunk)
    return {'bytes': path.stat().st_size, 'sha256': value.hexdigest()}


def signing_key(path, create=False):
    path = path.absolute()
    if create and not path.exists() and not path.is_symlink():
        trial.directory(path.parent, True)
        # Never overwrite a concurrently-created key.
        with os.fdopen(os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), 'w') as file:
            json.dump({'format': FORMAT, 'key': secrets.token_hex(32)}, file)
    value = trial.private_read(path)
    if value.get('format') not in KEY_FORMATS or not re.fullmatch('[0-9a-f]{64}', str(value.get('key', ''))):
        fail('备份校验密钥格式不正确。')
    return bytes.fromhex(value['key'])


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def schema_hash():
    result = hashlib.sha256()
    for file in sorted((trial.WORKSPACE / 'apps/api/src/main/resources/db/migration').glob('V*__*.sql')):
        result.update(file.name.encode() + b'\0' + file.read_bytes() + b'\0')
    return result.hexdigest()


def now():
    return datetime.now(timezone.utc)


def migrations():
    files = (trial.WORKSPACE / 'apps/api/src/main/resources/db/migration').glob('V*__*.sql')
    return [{'version': re.match(r'V(\d+)__', file.name)[1], 'script': file.name,
             'sha256': hashlib.sha256(file.read_bytes()).hexdigest()}
            for file in sorted(files, key=lambda p: int(re.match(r'V(\d+)__', p.name)[1]))]


def check_migrations(sql):
    actual = json.loads(sql("SELECT coalesce(json_agg(x ORDER BY x.installed_rank),'[]'::json)::text FROM (SELECT installed_rank,version,script,success FROM flyway_schema_history) x"))
    expected = [{'version': m['version'], 'script': m['script']} for m in migrations()]
    if any(row.get('success') is not True for row in actual) or [
            {'version': row.get('version'), 'script': row.get('script')} for row in actual] != expected:
        fail('数据库迁移与当前工作树不完全一致，不能声明完整备份或恢复。')


def signed_write(path, value, key):
    trial.private_write(path, {'manifest': value, 'signature': hmac.new(key, canonical(value), hashlib.sha256).hexdigest()})


def signed_read(path, key):
    value = trial.private_read(path)
    body, signature = value.get('manifest'), value.get('signature')
    if not isinstance(body, dict) or not isinstance(signature, str) or not hmac.compare_digest(
            hmac.new(key, canonical(body), hashlib.sha256).hexdigest(), signature):
        fail('独立状态证据校验失败；保持隔离。')
    return body


def source_identity(root, key_path, sql, enroll=False):
    """Bind authority to the original cluster and path, outside any backup bundle."""
    if (root / 'restore.json').exists() or (root / 'restore.json').is_symlink():
        # An explicitly activated, current-reconciled instance becomes a new operational lineage.
        # A pending restore can never refresh its old snapshot's retention by being dumped again.
        import backup_recovery
        backup_recovery.require_activation(root)
    key = signing_key(key_path)
    identity_path = root / 'backup-origin.json'
    cluster = sql('SELECT system_identifier::text FROM pg_control_system()')
    if not identity_path.exists():
        if not enroll:
            fail('缺少原实例独立登记；保持隔离。')
        identity = {'instanceId': str(uuid.uuid4()), 'directory': str(root.resolve()), 'cluster': cluster}
        signed_write(identity_path, identity, key)
    identity = signed_read(identity_path, key)
    uuid.UUID(identity['instanceId'])
    registry = key_path.parent / ('source-' + identity['instanceId'] + '.json')
    if not registry.exists() and enroll:
        signed_write(registry, identity, key)
    registered = signed_read(registry, key)
    if identity != registered or identity.get('directory') != str(root.resolve()) or identity.get('cluster') != cluster:
        fail('当前状态来源不是已登记的原数据库实例；保持隔离。')
    return identity


@contextmanager
def owned_lock(root):
    root = trial.directory(root)
    trial.config(root)
    path = root / 'supervisor.lock'
    if path.is_symlink():
        fail('试用锁文件异常。')
    with path.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            fail('请先正常停止此试用环境，再备份；没有关闭现有服务。')
        yield


@contextmanager
def offline_database(root, initialize=False):
    """Only an owned cluster, private Unix socket, no TCP listener or application workers."""
    data = root / 'postgres'
    if data.is_symlink() or (data / 'postmaster.pid').exists():
        fail('数据库可能仍在运行，或目录异常；没有接管或删除 PID 文件。')
    secret = trial.private_read(root / 'database.json')['password']
    env = {**trial.clean_environment(), 'PGPASSWORD': secret, 'PGCONNECT_TIMEOUT': '5', 'PGTZ': 'UTC'}
    with tempfile.TemporaryDirectory(prefix='dreamcore-backup-pg-') as temp:
        log_path = Path(temp) / 'private.log'
        with log_path.open('w') as log:
            def run(args, capture=False):
                result = subprocess.run(args, cwd=trial.WORKSPACE, env=env, stdout=subprocess.PIPE if capture else log,
                                        stderr=log, timeout=120)
                if result.returncode:
                    fail(f'{Path(args[0]).name} 操作失败；未输出数据库内容或凭据。')
                return result.stdout if capture else None
            if initialize:
                secret_file = Path(temp) / 'password'
                secret_file.write_text(secret)
                secret_file.chmod(0o600)
                run([pg('initdb'), '-D', str(data), '-U', 'dreamcore_trial', '--pwfile', str(secret_file),
                     '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C'])
                secret_file.unlink()
            else:
                trial.directory(data)
                regular(data / 'PG_VERSION')
                if (data / 'PG_VERSION').read_text().strip() != '18':
                    fail('没有可备份的 PostgreSQL 18 试用数据库。')
            port = trial.free_port()
            attempted = False
            try:
                attempted = True
                run([pg('pg_ctl'), '-D', str(data), '-l', str(log_path), '-o', f"-h '' -p {port} -k {temp}", '-w', 'start'])
                args = ['-h', temp, '-p', str(port), '-U', 'dreamcore_trial', '-d', 'dreamcore_trial']
                if initialize:
                    run([pg('psql'), '-X', '-h', temp, '-p', str(port), '-U', 'dreamcore_trial', '-d', 'postgres',
                         '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE dreamcore_trial'])
                def sql(query, fingerprint=False):
                    command = [pg('psql'), '-X', *args, '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', query]
                    if not fingerprint:
                        return run(command, True).decode().strip()
                    # Stream large bytea tables through a private temporary file, not process memory.
                    with tempfile.TemporaryFile() as output:
                        result = subprocess.run(command, env=env, stdout=output, stderr=log, timeout=120)
                        if result.returncode:
                            fail('读取数据库摘要失败。')
                        output.seek(0)
                        checksum = hashlib.sha256()
                        while chunk := output.read(1024 * 1024):
                            checksum.update(chunk)
                        return checksum.hexdigest()
                yield run, args, sql
            finally:
                if attempted and (data / 'postmaster.pid').exists():
                    try:
                        run([pg('pg_ctl'), '-D', str(data), '-m', 'fast', '-w', 'stop'])
                    except BaseException:
                        fail('临时数据库未能正常停止；已保留数据库目录，请检查此本地环境后再重试。')


def facts(sql):
    check_migrations(sql)
    tables = sql("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").splitlines()
    result = {}
    for table in tables:
        if table in TRANSIENT:
            continue
        if not re.fullmatch('[a-z_][a-z0-9_]*', table):
            fail('数据库包含不支持的表标识。')
        checksum = sql(f'COPY (SELECT to_jsonb(t)::text FROM public.{table} t ORDER BY to_jsonb(t)::text) TO STDOUT', True)
        result[table] = {'rows': int(sql(f'SELECT count(*) FROM public.{table}')), 'sha256': checksum}
    return result


def objects(sql):
    raw = sql("""SELECT coalesce(json_agg(x ORDER BY x.object_id),'[]'::json)::text FROM (
        SELECT v.object_id::text,v.size_bytes,v.sha256 FROM material_versions v
        WHERE NOT EXISTS(SELECT 1 FROM content_lifecycle l WHERE l.object_kind='MATERIAL' AND l.object_id=v.material_id AND l.state='PURGED')
        AND NOT EXISTS(SELECT 1 FROM content_cleanup_blobs b WHERE b.object_id=v.object_id AND b.deleted_at IS NOT NULL)) x""")
    result = {}
    for row in json.loads(raw):
        if str(uuid.UUID(row['object_id'])) != row['object_id']:
            fail('资料对象标识不正确。')
        result['objects/' + row['object_id'] + '.blob'] = {'bytes': row['size_bytes'], 'sha256': row['sha256']}
    return result


def reserve(path):
    path = path.absolute()
    trial.directory(path.parent, True)
    try:
        path.mkdir(mode=0o700)
    except FileExistsError:
        fail('目标已经存在，拒绝覆盖；请选择新的目录名。')
    return path


def verify(bundle, key_path, allow_expired=False):
    bundle = trial.directory(bundle)
    if key_path.resolve().is_relative_to(bundle):
        fail('校验密钥必须与备份分开保管。')
    regular(bundle / 'manifest.json')
    if (bundle / 'manifest.json').stat().st_size > 8 * 1024**2:
        fail('备份清单超过当前上限。')
    signed = trial.private_read(bundle / 'manifest.json')
    manifest = signed.get('manifest')
    if not isinstance(manifest, dict) or not isinstance(signed.get('signature'), str):
        fail('备份清单不完整。')
    expected = hmac.new(signing_key(key_path), canonical(manifest), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signed['signature']):
        fail('备份来源或清单校验失败。')
    if manifest.get('format') != FORMAT or manifest.get('postgresMajor') != 18:
        fail('备份格式不兼容。')
    if (not re.fullmatch('[0-9a-f]{64}', str(manifest.get('schemaHash', '')))
            or not isinstance(manifest.get('tables'), dict)
            or not isinstance(manifest.get('migrations'), list)
            or type(manifest.get('sourceTransaction')) is not int or manifest['sourceTransaction'] < 0):
        fail('备份结构与状态证据清单无效。')
    for table, metadata in manifest['tables'].items():
        if (not re.fullmatch('[a-z_][a-z0-9_]*', table) or not isinstance(metadata, dict)
                or type(metadata.get('rows')) is not int or metadata['rows'] < 0
                or not re.fullmatch('[0-9a-f]{64}', str(metadata.get('sha256', '')))):
            fail('备份数据表摘要无效。')
    try:
        uuid.UUID(manifest['snapshotId'])
        uuid.UUID(manifest['sourceInstanceId'])
        created, expires = (datetime.fromisoformat(manifest[field]) for field in ('createdAt', 'expiresAt'))
        if created.tzinfo is None or expires.tzinfo is None or expires != created + timedelta(days=RETENTION_DAYS) or created > now():
            raise ValueError()
    except (ValueError, KeyError, TypeError):
        fail('备份原始生成时间或有效期无效。')
    if not allow_expired and now() >= expires:
        fail('备份已超过原始快照生成起 30 日；不得重新打包延长有效期。')
    files = manifest.get('files', {})
    if not isinstance(files, dict) or 'database.dump' not in files or len(files) > MAX_FILES:
        fail('备份文件清单无效。')
    trial.directory(bundle / 'objects')
    names = {'manifest.json', 'objects', *files}
    actual = {str(p.relative_to(bundle)) for p in bundle.iterdir()} | {str(p.relative_to(bundle)) for p in (bundle / 'objects').iterdir()}
    if actual != names:
        fail('备份包含缺失或额外文件。')
    total = 0
    for name, metadata in files.items():
        if name != 'database.dump' and not re.fullmatch(r'objects/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.blob', name):
            fail('备份路径无效。')
        if not isinstance(metadata, dict) or type(metadata.get('bytes')) is not int or not 0 <= metadata['bytes'] <= MAX_BYTES:
            fail('备份文件大小无效。')
        total += metadata['bytes']
        if total > MAX_BYTES or digest(bundle / name) != metadata:
            fail('备份文件内容或大小校验失败。')
    return manifest


def create(root, output, key_path):
    root = trial.directory(root)
    if output.resolve().is_relative_to(root) or key_path.resolve().is_relative_to(output.resolve()):
        fail('备份输出须在试用目录以外，密钥须在备份以外。')
    key = signing_key(key_path, True)
    with owned_lock(root):
        destination = reserve(output)
        try:
            (destination / 'objects').mkdir(mode=0o700)
            with offline_database(root) as (run, args, sql):
                identity = source_identity(root, key_path, sql, True)
                created = now()
                snapshot = facts(sql)
                referenced = objects(sql)
                if len(referenced) + 1 > MAX_FILES or sum(x['bytes'] for x in referenced.values()) > MAX_BYTES:
                    fail('备份超过当前 10000 份原件 / 2 GiB 上限。')
                if referenced:
                    trial.directory(root / 'objects')
                for name, metadata in referenced.items():
                    if digest(root / name) != metadata:
                        fail('原件缺失或摘要不匹配，未生成完整备份。')
                    shutil.copyfile(root / name, destination / name)
                    (destination / name).chmod(0o600)
                run([pg('pg_dump'), *args, '--format=custom', '--no-owner', '--no-acl',
                     *(f'--exclude-table-data=public.{table}' for table in sorted(TRANSIENT)),
                     '--file', str(destination / 'database.dump')])
                (destination / 'database.dump').chmod(0o600)
                manifest = {'format': FORMAT, 'snapshotId': str(uuid.uuid4()), 'sourceInstanceId': identity['instanceId'],
                            'createdAt': created.isoformat(), 'expiresAt': (created + timedelta(days=RETENTION_DAYS)).isoformat(), 'postgresMajor': 18,
                            'migrations': migrations(), 'sourceTransaction': int(sql('SELECT txid_current()')),
                            'schemaHash': schema_hash(), 'tables': snapshot, 'files': {'database.dump': digest(destination / 'database.dump'), **referenced},
                            'sourceRevision': subprocess.check_output(['git','rev-parse','HEAD'], cwd=trial.WORKSPACE, text=True).strip()}
            signed_write(destination / 'manifest.json', manifest, key)
            verify(destination, key_path)
        except BaseException:
            shutil.rmtree(destination)
            raise
    return {'status':'created', 'files':len(manifest['files']), 'tables':len(manifest['tables'])}


def restore(bundle, output, key_path):
    import backup_recovery
    manifest = verify(bundle, key_path)
    if output.resolve().is_relative_to(bundle.resolve()):
        fail('还原目录必须位于备份之外。')
    if manifest['schemaHash'] != schema_hash():
        fail('迁移文件与备份不匹配；请使用对应版本工作树还原。')
    destination = reserve(output)
    try:
        signed_write(destination / 'restore.json', {'format': FORMAT, 'state': 'QUARANTINED', 'snapshot': manifest, 'recoveryDirectory':str(destination.resolve()),
                    'restoredAt': now().isoformat(), 'reopeningSupported': False}, signing_key(key_path))
        secret = secrets.token_urlsafe(32)
        trial.private_write(destination / 'database.json', {'password':secret})
        (destination / 'objects').mkdir(mode=0o700)
        for name, metadata in manifest['files'].items():
            # Consume only a verified private snapshot, even if the source bundle changes later.
            shutil.copyfile(bundle / name, destination / name)
            (destination / name).chmod(0o600)
            if digest(destination / name) != metadata:
                fail('备份在读取期间发生变化，还原已停止。')
        with offline_database(destination, True) as (run, args, sql):
            run([pg('pg_restore'), *args, '--no-owner', '--no-acl', '--single-transaction', '--exit-on-error', str(destination / 'database.dump')])
            if facts(sql) != manifest['tables']:
                fail('数据库还原后逐表摘要不一致。')
            backup_recovery.coverage(sql)
            for name, metadata in objects(sql).items():
                if name not in manifest['files'] or digest(destination / name) != metadata:
                    fail('还原后的数据库与原件不一致。')
            if sql('SELECT count(*) FROM spring_session') != '0' or sql('SELECT count(*) FROM spring_session_attributes') != '0':
                fail('还原包含旧登录会话。')
            if sql("SELECT to_regclass('public.phone_challenges') IS NOT NULL") == 't' and sql('SELECT count(*) FROM phone_challenges') != '0':
                fail('还原包含旧手机验证码。')
            if backup_recovery.has_table(sql, 'platform_sessions') and sql('SELECT count(*) FROM platform_sessions') != '0':
                fail('还原包含旧总台登录会话。')
            pending = int(sql("SELECT count(*) FROM invitations WHERE status='PENDING'"))
            backup_recovery.quarantine(sql)
        (destination / 'database.dump').unlink()
        ports = set()
        while len(ports) < 3:
            ports.add(trial.free_port())
        database_port, api_port, web_port = sorted(ports)
        trial.private_write(destination / 'accounts.json', {'restored':True,'note':'隔离恢复：旧凭据、会话和执行均已停用；此工具不提供重新开放入口。'})
        # Publish the trial configuration last; partial restores can never start as a trial.
        trial.private_write(destination / 'config.json', {'format':trial.FORMAT,'workspace':str(trial.WORKSPACE),'ports':{'database':database_port,'api':api_port,'web':web_port}})
    except BaseException:
        # A failed pg_ctl stop must never turn into deletion of a live data directory.
        if not (destination / 'postgres' / 'postmaster.pid').exists():
            shutil.rmtree(destination)
        raise
    return {'status':'restored_quarantined','files':len(manifest['files']),'tables':len(manifest['tables']),'pendingInvitationsRevoked':pending,'reopeningSupported':False}


def repack(bundle, output, key_path):
    manifest = verify(bundle, key_path)
    if output.resolve().is_relative_to(bundle.resolve()):
        fail('副本必须位于原备份之外。')
    destination = reserve(output)
    try:
        (destination / 'objects').mkdir(mode=0o700)
        for name in ['manifest.json', *manifest['files']]:
            shutil.copyfile(bundle / name, destination / name)
            (destination / name).chmod(0o600)
        if verify(destination, key_path) != manifest:
            fail('复制期间备份发生变化。')
    except BaseException:
        shutil.rmtree(destination)
        raise
    return {'status': 'copied', 'snapshotId': manifest['snapshotId'], 'expiresAt': manifest['expiresAt']}


def rotate(directory, key_path):
    root = trial.directory(directory)
    if key_path.resolve().is_relative_to(root):
        fail('密钥必须与轮转目录分开保存。')
    removed, retained, rejected = [], [], []
    for path in sorted(root.iterdir()):
        try:
            if (path / 'restore.json').exists():
                import backup_recovery
                if backup_recovery.rotate_pending(path, key_path):
                    removed.append(path.name)
                else:
                    retained.append(path.name)
                continue
            manifest = verify(path, key_path, allow_expired=True)
            if now() >= datetime.fromisoformat(manifest['expiresAt']):
                shutil.rmtree(path)
                removed.append(path.name)
            else:
                retained.append(path.name)
        except (trial.TrialError, OSError, ValueError, KeyError, TypeError):
            rejected.append(path.name)
    return {'status': 'rotated', 'removed': removed, 'retained': retained, 'rejected': rejected}


def execute(args):
    if args.command == 'create' and args.output:
        result = create(args.directory.absolute(), args.output.absolute(), args.key_file.absolute())
    elif args.command == 'verify' and args.bundle:
        manifest = verify(args.bundle.absolute(), args.key_file.absolute())
        result = {'status': 'verified', 'files': len(manifest['files']), 'tables': len(manifest['tables'])}
    elif args.command == 'restore' and args.bundle and args.output:
        result = restore(args.bundle.absolute(), args.output.absolute(), args.key_file.absolute())
    elif args.command == 'repack' and args.bundle and args.output:
        result = repack(args.bundle.absolute(), args.output.absolute(), args.key_file.absolute())
    elif args.command == 'rotate':
        result = rotate(args.directory.absolute(), args.key_file.absolute())
    elif args.command == 'activate' and args.current_directory:
        import backup_recovery
        result = backup_recovery.activate(args.directory.absolute(), args.current_directory.absolute(), args.key_file.absolute())
    elif args.command == 'reconcile' and args.current_directory:
        import backup_recovery
        result = backup_recovery.reconcile(args.directory.absolute(), args.current_directory.absolute(), args.key_file.absolute())
    else:
        fail('create 需要 --output；verify 需要 --bundle；restore/repack 需要 --bundle 与 --output；reconcile/activate 需要 --directory 与 --current-directory；rotate 使用 --directory。')
    return result


def observation_snapshot(args):
    # Read only the signed artifact of an already successful command. Never expose its private paths or table data.
    if args.command in ('create','repack'):
        return signed_read(args.output.absolute() / 'manifest.json', signing_key(args.key_file.absolute()))
    if args.command in ('verify','restore'):
        return signed_read(args.bundle.absolute() / 'manifest.json', signing_key(args.key_file.absolute()))
    if args.command in ('reconcile','activate'):
        return signed_read(args.directory.absolute() / 'restore.json', signing_key(args.key_file.absolute()))['snapshot']
    return None


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description='已停止的本地试用：备份、校验、还原到新目录。备份含业务内容及密码散列，密钥须单独保存。')
    parser.add_argument('command', choices=['create', 'verify', 'restore', 'repack', 'rotate', 'reconcile', 'activate'])
    parser.add_argument('--directory', type=Path, default=trial.DEFAULT_DIRECTORY)
    parser.add_argument('--bundle', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--current-directory', type=Path)
    parser.add_argument('--key-file', type=Path, default=KEY_FILE)
    parser.add_argument('--status-file', type=Path, help='将有限运行事实写入部署侧私有监测文件；不含备份位置、原文或凭据。')
    args = parser.parse_args()
    import backup_status
    result = backup_status.observe(args.status_file, args.command, lambda: execute(args), lambda: observation_snapshot(args))
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (trial.TrialError, OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(str(error) if isinstance(error, trial.TrialError) else '备份操作失败；检查私有目录、依赖和备份完整性。', file=sys.stderr)
        sys.exit(1)
