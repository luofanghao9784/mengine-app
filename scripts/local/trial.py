#!/usr/bin/env python3
"""Owned loopback-only trial supervisor. Persistent data; no production environment or reset command."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid

# Helpers import this module too; keep one exception/config identity when launched as a script.
if __name__ == '__main__':
    sys.modules.setdefault('trial', sys.modules[__name__])

WORKSPACE = Path(__file__).resolve().parents[2]
DEFAULT_DIRECTORY = WORKSPACE / '.local' / 'trial'
FORMAT = 'dreamcore-local-trial-v1'


class TrialError(Exception):
    pass


def private_read(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o077:
        raise TrialError('本地配置必须是本人所有的普通私有文件（0600）。')
    return json.loads(path.read_text())


def private_write(path, value):
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex)
    try:
        fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'w') as file:
            json.dump(value, file, ensure_ascii=False, indent=2)
            file.write('\n')
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def directory(path, create=False):
    if path.is_symlink():
        raise TrialError('试用目录不能是符号链接。')
    if not path.exists():
        if not create:
            raise TrialError('试用环境尚未创建，请先运行 npm run trial:start。')
        path.mkdir(parents=True, mode=0o700)
    if not path.is_dir() or path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o077:
        raise TrialError('试用目录必须由本人所有，权限为 0700。')
    return path.resolve()


def binary(name):
    pg = os.environ.get('POSTGRES_BIN')
    found = str(Path(pg) / name) if pg and name in ('initdb', 'pg_ctl', 'psql') else shutil.which(name)
    if not found or not Path(found).is_file():
        raise TrialError(f'缺少 {name}；需要 Node、Java 21、PostgreSQL 18（可设置 POSTGRES_BIN）。')
    return found


def free_port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


def available(port):
    try:
        with socket.socket() as listener:
            # A recently stopped owned service may leave TIME_WAIT sockets; active listeners still conflict.
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(('127.0.0.1', port))
    except OSError:
        raise TrialError(f'端口 {port} 已被占用；没有复用或关闭已有服务。停止占用程序或使用其他试用目录。') from None


def clean_environment():
    prefixes = ('SPRING_', 'DATABASE_', 'INVITATION_', 'PHONE_', 'BOOTSTRAP_', 'API_', 'ENGINE_', 'SERVER_', 'MANAGEMENT_', 'DREAMCORE_', 'MATERIAL_', 'BACKUP_', 'OPERATIONS_', 'KNOWLEDGE_', 'TASK_', 'AGENT_', 'PLATFORM_', 'COMPANY_', 'COLLECTION_', 'EXPERIENCE_', 'GENERAL_EXPERIENCE_', 'PG')
    return {k: v for k, v in os.environ.items() if not k.startswith(prefixes) and k not in ('JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS')}


def platform_login(account):
    # Existing private trial files used email. This is a login-name compatibility read only:
    # bootstrap still creates an independent platform principal, never upgrades the customer.
    login = account.get('loginName') or account.get('email')
    if not isinstance(login, str) or not login.strip() or not isinstance(account.get('password'), str) or not account['password']:
        raise TrialError('本地总台账号配置不完整；需要独立管理账号和密码。')
    return login


def platform_initialized(query):
    return bool(query("SELECT to_regclass('public.platform_accounts')")) and int(query('SELECT count(*) FROM platform_accounts')) > 0


def config(root):
    result = private_read(root / 'config.json')
    if result.get('format') != FORMAT or result.get('workspace') != str(WORKSPACE):
        raise TrialError('目录不属于本工作树的试用环境，拒绝复用。')
    ports = result.get('ports', {})
    if set(ports) != {'database', 'api', 'web'} or any(type(v) is not int or not 1024 <= v <= 65535 for v in ports.values()) or len(set(ports.values())) != 3:
        raise TrialError('本地端口配置无效，拒绝启动。')
    return result


def live(root):
    lock_path = root / 'supervisor.lock'
    if lock_path.is_symlink():
        raise TrialError('试用锁文件异常。')
    with lock_path.open('a') as file:
        try:
            fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return False
        except BlockingIOError:
            return True


def run(command, env, log, capture=False):
    result = subprocess.run(command, cwd=WORKSPACE, env=env, stdout=subprocess.PIPE if capture else log, stderr=log, timeout=60)
    if result.returncode:
        raise TrialError('本地服务操作未完成；私有日志保存在试用目录，未输出凭据。')
    return result.stdout.decode().strip() if capture else None


def psql(root, settings, sql, log):
    secret = private_read(root / 'database.json')['password']
    return run([binary('psql'), '-h', '127.0.0.1', '-p', str(settings['ports']['database']), '-U', 'dreamcore_trial', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], {**clean_environment(), 'PGPASSWORD': secret}, log, True)


def stop_child(child):
    if child.poll() is not None:
        return
    child.terminate()
    try:
        child.wait(timeout=10)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait(timeout=5)


def ready(url, child, stopping):
    for _ in range(160):
        if stopping() or child.poll() is not None:
            raise TrialError('本地服务启动被停止或启动失败。')
        try:
            with urllib.request.urlopen(url, timeout=0.5) as response:
                if response.status == 200:
                    return
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(0.2)
    raise TrialError('本地服务启动超时；请查看私有日志。')


def verify_api_migrations(jar):
    """A stale runtime must not open a newer recovered schema without its access guards."""
    import zipfile
    directory=WORKSPACE/'apps/api/src/main/resources/db/migration'
    expected={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in directory.glob('V*__*.sql')}
    try:
        with zipfile.ZipFile(jar) as archive:
            entries=[x for x in archive.namelist() if x.startswith('BOOT-INF/classes/db/migration/') and x.endswith('.sql')]
            actual={name.rsplit('/',1)[-1]:hashlib.sha256(archive.read(name)).hexdigest() for name in entries}
        if not expected or actual!=expected or len(actual)!=len(entries):raise ValueError()
    except (OSError,ValueError,zipfile.BadZipFile):
        raise TrialError('API 构建中的迁移与当前已核验版本不一致；先运行 npm run trial:build，禁止用旧运行时开放恢复数据。') from None


def verify_engine(engine_port, engine_token, mode):
    """Authenticated preflight; checking a configured runtime never calls a model."""
    release = json.loads((WORKSPACE / 'engine/package.json').read_text())['version']
    result = subprocess.run([binary('node'), 'scripts/check-engine.mjs', '--url', f'http://127.0.0.1:{engine_port}',
                             '--expected-version', release, '--mode', 'agent-live' if mode == 'live' else 'source-lookup'],
                            cwd=WORKSPACE, env={'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'TASK_ENGINE_TOKEN': engine_token},
                            capture_output=True, timeout=15)
    if result.returncode:
        raise TrialError('引擎身份、版本或运行模式核验失败；API 尚未启动，未发送模型请求。')


def model_environments(model, engine_port, engine_token, api_port):
    engine_env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'ENGINE_HOST': '127.0.0.1',
                  'ENGINE_PORT': str(engine_port), 'TASK_ENGINE_TOKEN': engine_token}
    api_env = {'AGENT_TASK_MODE': 'off'}
    if model:
        import live_model
        engine_env.update(live_model.engine_environment(model))
        engine_env['AGENT_PLATFORM_URL'] = f'http://127.0.0.1:{api_port}'
        api_env['AGENT_TASK_MODE'] = 'live'
    return api_env, engine_env


def validate_instance_mode(settings, mode, restored=False, reconnect_live=False):
    previous = settings.get('agentMode', 'off')
    if reconnect_live and (not restored or mode != 'live'):
        raise TrialError('重新接入仅适用于已完成显式 activate 的恢复实例，并需同时指定 --live。')
    if previous not in ('off', 'live') or (previous != mode and not (previous == 'off' and restored and reconnect_live and mode == 'live')):
        raise TrialError('该数据目录的模型模式与本次启动不一致；使用原启动命令，真实验收请使用独立新目录。已开放恢复实例可显式 --reconnect-live。')


def start(root, model_config=None, reconnect_live=False, phone_local=False):
    os.umask(0o077)
    model = None
    if model_config is not None:
        import live_model
        model = live_model.load(model_config)
        live_model.check(model)
    mode = 'live' if model else 'off'
    # Keep the credential file outside the persistent instance and all instance backups.
    private_root = (WORKSPACE / '.local/model-private').resolve()
    if root.resolve() == private_root or private_root in root.resolve().parents or root.resolve() in private_root.parents:
        raise TrialError('试用数据目录不能包含模型私有配置目录，或位于其中。')
    root = directory(root, True)
    # Restore verification never authorizes reopening accounts, content or workers.
    restored = (root / 'restore.json').exists() or (root / 'restore.json').is_symlink()
    if restored:
        import backup_recovery
        backup_recovery.require_activation(root)
    if reconnect_live and (not restored or mode != 'live'):
        raise TrialError('重新接入仅适用于已完成显式 activate 的恢复实例，并需同时指定 --live。')
    # Never initialize into a directory containing unrelated files.
    if not (root / 'config.json').exists() and any(root.iterdir()):
        raise TrialError('目标目录不是空目录，也没有有效试用配置；拒绝初始化。')
    if (root / 'config.json').exists():
        validate_instance_mode(config(root), mode, restored, reconnect_live)
    jar = WORKSPACE / 'apps/api/target/workspace-api-0.1.0-SNAPSHOT.jar'
    if not jar.is_file() or not (WORKSPACE / 'dist/tenant-admin/index.html').is_file() or not (WORKSPACE / 'engine/dist/main.js').is_file():
        raise TrialError('缺少构建产物；先运行 npm run trial:build。')
    verify_api_migrations(jar)
    executables = {name: binary(name) for name in ('initdb', 'pg_ctl', 'psql', 'java', 'node')}
    lock_path = root / 'supervisor.lock'
    if lock_path.is_symlink():
        raise TrialError('试用锁文件异常。')
    lock = lock_path.open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close()
        raise TrialError('该试用环境已在运行；请使用 trial:status 或 trial:stop。') from None
    children, pg_started = [], False
    stopped = False
    def signal_stop(signum, frame):
        nonlocal stopped
        stopped = True
    signal.signal(signal.SIGTERM, signal_stop)
    signal.signal(signal.SIGINT, signal_stop)
    run_id = uuid.uuid4().hex
    log = None
    logs = None
    settings = None
    runtime_started = False
    try:
        if not (root / 'config.json').exists():
            ports = set()
            while len(ports) < 3:
                ports.add(free_port())
            database_port, api_port, web_port = sorted(ports)
            settings = {'format': FORMAT, 'workspace': str(WORKSPACE), 'agentMode': mode, 'ports': {'database': database_port, 'api': api_port, 'web': web_port}}
            private_write(root / 'config.json', settings)
            private_write(root / 'database.json', {'password': secrets.token_urlsafe(32)})
            private_write(root / 'accounts.json', {'platform': {'loginName': 'platform@trial.example.test', 'realm': 'platform', 'password': secrets.token_urlsafe(24)}})
        settings = config(root)
        # Recheck after locking: a concurrent first start can have created the configuration.
        if restored:
            backup_recovery.require_activation(root)
        validate_instance_mode(settings, mode, restored, reconnect_live)
        if settings.get('agentMode', 'off') != mode:
            settings['agentMode'] = mode
            private_write(root / 'config.json', settings)
        for port in settings['ports'].values():
            available(port)
        from log_retention import Logs
        logs = Logs(root)
        log, pg_log = logs.pipe('service'), logs.pipe('postgres')
        data = root / 'postgres'
        secret = private_read(root / 'database.json')['password']
        if data.is_symlink():
            raise TrialError('数据库目录不能是符号链接。')
        engine_port=free_port()
        engine_token=secrets.token_urlsafe(48)
        model_api_env, engine_env = model_environments(model, engine_port, engine_token, settings['ports']['api'])
        env = {**clean_environment(), 'TASK_ENABLED':'true', 'TASK_ENGINE_TOKEN':engine_token, 'ENGINE_BASE_URL':f'http://127.0.0.1:{engine_port}', 'DATABASE_URL': f"jdbc:postgresql://127.0.0.1:{settings['ports']['database']}/dreamcore_trial", 'DATABASE_USER': 'dreamcore_trial', 'DATABASE_PASSWORD': secret,
               'KNOWLEDGE_ENABLED': str((WORKSPACE / 'workers/parser/.venv/bin/python').exists()).lower(), 'KNOWLEDGE_PARSER_ROOT': str(WORKSPACE / 'workers/parser'), 'MATERIAL_STORAGE_ROOT': str(root / 'objects'), 'SPRING_PROFILES_ACTIVE': 'local', 'INVITATION_DELIVERY': 'local', 'INVITATION_OUTBOX': str(root / 'invitations'), 'API_HOST': '127.0.0.1', 'API_PORT': str(settings['ports']['api']), 'SERVER_SERVLET_SESSION_COOKIE_NAME': 'DREAMCORE_TRIAL_' + hashlib.sha256(str(root).encode()).hexdigest()[:12]}
        env.update({'PHONE_DELIVERY': 'local' if phone_local else 'disabled', 'PHONE_LOCAL_PREVIEW': str(phone_local).lower(), 'PHONE_OUTBOX': str(root / 'phone-sms')})
        env['PLATFORM_COOKIE_NAME'] = 'DREAMCORE_PLATFORM_TRIAL_' + hashlib.sha256(str(root).encode()).hexdigest()[:12]
        env.update(model_api_env)
        model_status = {'agentMode': mode, 'model': model['model'] if model else None, 'cloudVerifiedByStartup': False}
        private_write(root / 'runtime.json', {'runId': run_id, 'state': 'starting', 'webUrl': f"http://127.0.0.1:{settings['ports']['web']}", **model_status, 'revision': subprocess.check_output(['git', 'rev-parse', '--short', 'HEAD'], cwd=WORKSPACE, text=True).strip(), 'apiSha256': hashlib.sha256(jar.read_bytes()).hexdigest()})
        runtime_started = True
        if not data.exists():
            secret_path = root / 'init-password'
            secret_path.write_text(secret); secret_path.chmod(0o600)
            try:
                run([executables['initdb'], '-D', str(data), '-U', 'dreamcore_trial', '--pwfile', str(secret_path), '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C'], env, log)
            finally:
                secret_path.unlink(missing_ok=True)
        def stopping():
            logs.tick()
            request = root / 'stop-request.json'
            return stopped or (request.is_file() and private_read(request).get('runId') == run_id)
        # Keep the Unix socket path short on macOS, independent of the workspace path length.
        with tempfile.TemporaryDirectory(prefix='dreamcore-trial-socket-') as sockets:
            # pg_ctl's inherited stderr goes through the owned collector; no process holds a rotating file.
            run([executables['pg_ctl'], '-D', str(data), '-o', f"-h 127.0.0.1 -p {settings['ports']['database']} -k {sockets} -c logging_collector=off -c log_destination=stderr", '-w', 'start'], env, pg_log)
            pg_started = True
            if psql(root, settings, "SELECT count(*) FROM pg_database WHERE datname='dreamcore_trial'", log) == '0':
                psql(root, settings, 'CREATE DATABASE dreamcore_trial', log)
            # Flyway runs before bootstrap. Bootstrap only once; subsequent starts preserve accounts.
            def identity_query(statement):
                return run([executables['psql'], '-h', '127.0.0.1', '-p', str(settings['ports']['database']), '-U', 'dreamcore_trial', '-d', 'dreamcore_trial', '-At', '-c', statement], {**env, 'PGPASSWORD': secret}, log, True).strip()
            if not platform_initialized(identity_query):
                account = private_read(root / 'accounts.json')['platform']
                login_name = platform_login(account)
                password_file = root / 'bootstrap-password'
                password_file.write_text(account['password']); password_file.chmod(0o600)
                try:
                    run([executables['java'], '-jar', str(jar), '--bootstrap-admin'], {**env, 'BOOTSTRAP_EMAIL': login_name, 'BOOTSTRAP_NAME': '本地试用平台管理员', 'BOOTSTRAP_PASSWORD_FILE': str(password_file)}, log)
                finally:
                    password_file.unlink(missing_ok=True)
            engine = subprocess.Popen([executables['node'], 'engine/dist/main.js'], cwd=WORKSPACE, env=engine_env, stdout=log, stderr=log)
            children.append(engine)
            ready(f'http://127.0.0.1:{engine_port}/healthz',engine,stopping)
            verify_engine(engine_port, engine_token, mode)
            api = subprocess.Popen([executables['java'], '-jar', str(jar)], cwd=WORKSPACE, env=env, stdout=log, stderr=log)
            children.append(api)
            ready(f"http://127.0.0.1:{settings['ports']['api']}/actuator/health", api, stopping)
            web_env = {**clean_environment(), 'DREAMCORE_DEV_API_URL': f"http://127.0.0.1:{settings['ports']['api']}"}
            web = subprocess.Popen([executables['node'], 'node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', str(settings['ports']['web']), '--strictPort'], cwd=WORKSPACE, env=web_env, stdout=log, stderr=log)
            children.append(web)
            url = f"http://127.0.0.1:{settings['ports']['web']}"
            ready(url + '/tenant-admin/', web, stopping)
            runtime = private_read(root / 'runtime.json'); runtime['state'] = 'ready'; private_write(root / 'runtime.json', runtime)
            print(f'本地三端试用已就绪：{url}/platform-admin/\n模型模式：{mode}；启动检查不代表云端连接已验证。\n私有账号配置：{root / "accounts.json"}\n邀请只写入本地私有目录，不发送邮件。Ctrl+C 停止服务；数据保留。其他终端停止时须使用同一实例目录。', flush=True)
            while not stopping():
                if any(child.poll() is not None for child in children):
                    raise TrialError('所属服务意外退出；试用已停止，数据保留。')
                time.sleep(0.25)
    finally:
        for child in reversed(children):
            stop_child(child)
        if pg_started:
            # pg_ctl targets only this directory; never identifies a database by a shared port.
            result = subprocess.run([binary('pg_ctl'), '-D', str(root / 'postgres'), '-m', 'fast', '-w', 'stop'], env=clean_environment(), stdout=log, stderr=log, timeout=30)
            if result.returncode:
                print('所属数据库未能正常停止，请检查本地私有日志。', file=sys.stderr)
        if runtime_started:
            private_write(root / 'runtime.json', {'runId': run_id, 'state': 'stopped', 'agentMode': mode, 'model': model['model'] if model else None, 'cloudVerifiedByStartup': False, 'webUrl': f"http://127.0.0.1:{settings['ports']['web']}"})
        try:
            if logs:
                logs.close()
        finally:
            lock.close()


def status(root):
    root = directory(root); config(root)
    running = live(root)
    state = private_read(root / 'runtime.json') if (root / 'runtime.json').exists() else {'state': 'not-started'}
    print(json.dumps({'running': running, 'state': state['state'] if running else 'stopped', 'webUrl': state.get('webUrl'), 'agentMode': state.get('agentMode', 'off'), 'model': state.get('model'), 'cloudVerifiedByStartup': False, 'accountsFile': str(root / 'accounts.json')}, ensure_ascii=False))


def stop(root):
    root = directory(root); config(root)
    if not live(root):
        print('试用监督进程未运行；未按 PID 或端口关闭任何其他程序。'); return
    runtime = private_read(root / 'runtime.json')
    private_write(root / 'stop-request.json', {'runId': runtime['runId']})
    for _ in range(160):
        if not live(root):
            print('本地试用已停止，账号、企业、授权和邀请数据保留。'); return
        time.sleep(0.25)
    raise TrialError('停止请求已记录，监督进程尚未完成退出；请检查原启动终端。')


def invitations(root):
    root = directory(root); config(root)
    outbox = root / 'invitations'
    if not outbox.exists():
        print('还没有本地邀请投递记录。'); return
    directory(outbox)
    rows = []
    for file in sorted(outbox.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True)[:100]:
        value = private_read(file)
        rows.append({'invitationId': value['invitationId'], 'contact': value.get('phone') or value.get('email')})
    print(json.dumps(rows, ensure_ascii=False, indent=2))
    print('以上仅为最近 100 条本地投递记录；是否已接受、过期或撤销，请以管理页面为准。')


def invitation(root, supplied_id):
    root = directory(root); config(root)
    invitation_id = str(uuid.UUID(supplied_id))
    # Local delivery file; HTTP preview requires the explicit phone-local switch and scoped management rights.
    value = private_read(root / 'invitations' / (invitation_id + '.json'))
    print(f'本地邀请文件：{root / "invitations" / (invitation_id + ".json")}\n请使用文件中的 path 打开完整邀请链接。有效状态仍由服务端校验。')
    if value.get('invitationId') != invitation_id:
        raise TrialError('邀请文件标识不匹配。')


def main():
    parser = argparse.ArgumentParser(description='本机三端联调：仅绑定 127.0.0.1；停止保留数据。')
    parser.add_argument('command', choices=['start', 'stop', 'status', 'invitations', 'invitation'])
    parser.add_argument('invitation_id', nargs='?')
    parser.add_argument('--directory', type=Path, default=DEFAULT_DIRECTORY)
    parser.add_argument('--phone-local', action='store_true', help='在隔离的非 live 实例启用本地测试短信与邀请预览，不发送真实短信。')
    parser.add_argument('--live', action='store_true', help='显式开启真实模型；只适用于 start。')
    parser.add_argument('--model-config', type=Path, help='本工作树 .local/model-private 内的私有模型配置。')
    parser.add_argument('--reconnect-live', action='store_true', help='已 activate 的恢复实例显式重新接入真实模型；旧任务/计划不自动恢复。')
    args = parser.parse_args()
    if (args.live or args.model_config) and (args.command != 'start' or not args.live):
        raise TrialError('模型参数仅适用于 start --live。')
    if args.reconnect_live and (args.command != 'start' or not args.live):
        raise TrialError('--reconnect-live 仅适用于 start --live。')
    if args.phone_local and (args.command != 'start' or args.live):
        raise TrialError('--phone-local 仅适用于非 live 的 start。')
    root = args.directory.absolute()
    if args.command == 'start':
        if args.live:
            from live_model import DEFAULT_CONFIG
            start(root, args.model_config or DEFAULT_CONFIG, args.reconnect_live)
        else:
            start(root, phone_local=args.phone_local)
    elif args.command == 'invitation':
        if not args.invitation_id:
            raise TrialError('请提供邀请 ID；可在本地 invitations 目录按手机号或旧邮箱查找对应 JSON 文件。')
        invitation(root, args.invitation_id)
    else:
        {'stop': stop, 'status': status, 'invitations': invitations}[args.command](root)


if __name__ == '__main__':
    try:
        main()
    except (TrialError, OSError, ValueError, subprocess.SubprocessError):
        # Never print exception payloads or inherited commands containing sensitive settings.
        error = sys.exc_info()[1]
        print(str(error) if isinstance(error, TrialError) else '本地试用操作失败；检查依赖、目录权限和私有日志。', file=sys.stderr)
        sys.exit(1)
