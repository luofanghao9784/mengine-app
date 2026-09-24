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
    prefixes = ('SPRING_', 'DATABASE_', 'INVITATION_', 'BOOTSTRAP_', 'API_', 'ENGINE_', 'SERVER_', 'MANAGEMENT_', 'DREAMCORE_', 'MATERIAL_', 'KNOWLEDGE_', 'TASK_', 'AGENT_', 'PG')
    return {k: v for k, v in os.environ.items() if not k.startswith(prefixes) and k not in ('JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS')}


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


def start(root):
    os.umask(0o077)
    root = directory(root, True)
    # Never initialize into a directory containing unrelated files.
    if not (root / 'config.json').exists() and any(root.iterdir()):
        raise TrialError('目标目录不是空目录，也没有有效试用配置；拒绝初始化。')
    jar = WORKSPACE / 'apps/api/target/workspace-api-0.1.0-SNAPSHOT.jar'
    if not jar.is_file() or not (WORKSPACE / 'dist/tenant-admin/index.html').is_file() or not (WORKSPACE / 'engine/dist/main.js').is_file():
        raise TrialError('缺少构建产物；先运行 npm run trial:build。')
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
    settings = None
    try:
        if not (root / 'config.json').exists():
            ports = set()
            while len(ports) < 3:
                ports.add(free_port())
            database_port, api_port, web_port = sorted(ports)
            settings = {'format': FORMAT, 'workspace': str(WORKSPACE), 'ports': {'database': database_port, 'api': api_port, 'web': web_port}}
            private_write(root / 'config.json', settings)
            private_write(root / 'database.json', {'password': secrets.token_urlsafe(32)})
            private_write(root / 'accounts.json', {'platform': {'email': 'platform@trial.example.test', 'password': secrets.token_urlsafe(24)}})
        settings = config(root)
        for port in settings['ports'].values():
            available(port)
        for file in ('service.log', 'postgres.log'):
            if (root / file).is_symlink():
                raise TrialError('私有日志路径异常。')
        log = (root / 'service.log').open('a')
        data = root / 'postgres'
        secret = private_read(root / 'database.json')['password']
        if data.is_symlink():
            raise TrialError('数据库目录不能是符号链接。')
        engine_port=free_port()
        engine_token=secrets.token_urlsafe(48)
        env = {**clean_environment(), 'TASK_ENABLED':'true', 'TASK_ENGINE_TOKEN':engine_token, 'ENGINE_BASE_URL':f'http://127.0.0.1:{engine_port}', 'DATABASE_URL': f"jdbc:postgresql://127.0.0.1:{settings['ports']['database']}/dreamcore_trial", 'DATABASE_USER': 'dreamcore_trial', 'DATABASE_PASSWORD': secret,
               'KNOWLEDGE_ENABLED': str((WORKSPACE / 'workers/parser/.venv/bin/python').exists()).lower(), 'KNOWLEDGE_PARSER_ROOT': str(WORKSPACE / 'workers/parser'), 'MATERIAL_STORAGE_ROOT': str(root / 'objects'), 'SPRING_PROFILES_ACTIVE': 'local', 'INVITATION_DELIVERY': 'local', 'INVITATION_OUTBOX': str(root / 'invitations'), 'API_HOST': '127.0.0.1', 'API_PORT': str(settings['ports']['api']), 'SERVER_SERVLET_SESSION_COOKIE_NAME': 'DREAMCORE_TRIAL_' + hashlib.sha256(str(root).encode()).hexdigest()[:12]}
        private_write(root / 'runtime.json', {'runId': run_id, 'state': 'starting', 'webUrl': f"http://127.0.0.1:{settings['ports']['web']}", 'revision': subprocess.check_output(['git', 'rev-parse', '--short', 'HEAD'], cwd=WORKSPACE, text=True).strip(), 'apiSha256': hashlib.sha256(jar.read_bytes()).hexdigest()})
        if not data.exists():
            secret_path = root / 'init-password'
            secret_path.write_text(secret); secret_path.chmod(0o600)
            try:
                run([executables['initdb'], '-D', str(data), '-U', 'dreamcore_trial', '--pwfile', str(secret_path), '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C'], env, log)
            finally:
                secret_path.unlink(missing_ok=True)
        def stopping():
            request = root / 'stop-request.json'
            return stopped or (request.is_file() and private_read(request).get('runId') == run_id)
        # Keep the Unix socket path short on macOS, independent of the workspace path length.
        with tempfile.TemporaryDirectory(prefix='dreamcore-trial-socket-') as sockets:
            run([executables['pg_ctl'], '-D', str(data), '-l', str(root / 'postgres.log'), '-o', f"-h 127.0.0.1 -p {settings['ports']['database']} -k {sockets}", '-w', 'start'], env, log)
            pg_started = True
            if psql(root, settings, "SELECT count(*) FROM pg_database WHERE datname='dreamcore_trial'", log) == '0':
                psql(root, settings, 'CREATE DATABASE dreamcore_trial', log)
            # Flyway runs before bootstrap. Bootstrap only once; subsequent starts preserve accounts.
            table = run([executables['psql'], '-h', '127.0.0.1', '-p', str(settings['ports']['database']), '-U', 'dreamcore_trial', '-d', 'dreamcore_trial', '-At', '-c', "SELECT to_regclass('public.platform_roles')"], {**env, 'PGPASSWORD': secret}, log, True)
            if table:
                count = run([executables['psql'], '-h', '127.0.0.1', '-p', str(settings['ports']['database']), '-U', 'dreamcore_trial', '-d', 'dreamcore_trial', '-At', '-c', 'SELECT count(*) FROM platform_roles'], {**env, 'PGPASSWORD': secret}, log, True)
            else:
                count = '0'
            if count == '0':
                account = private_read(root / 'accounts.json')['platform']
                password_file = root / 'bootstrap-password'
                password_file.write_text(account['password']); password_file.chmod(0o600)
                try:
                    run([executables['java'], '-jar', str(jar), '--bootstrap-admin'], {**env, 'BOOTSTRAP_EMAIL': account['email'], 'BOOTSTRAP_NAME': '本地试用平台管理员', 'BOOTSTRAP_PASSWORD_FILE': str(password_file)}, log)
                finally:
                    password_file.unlink(missing_ok=True)
            engine = subprocess.Popen([executables['node'], 'engine/dist/main.js'], cwd=WORKSPACE, env={'PATH':os.environ.get('PATH','/usr/bin:/bin'),'ENGINE_HOST':'127.0.0.1','ENGINE_PORT':str(engine_port),'TASK_ENGINE_TOKEN':engine_token}, stdout=log, stderr=log)
            children.append(engine)
            ready(f'http://127.0.0.1:{engine_port}/healthz',engine,stopping)
            api = subprocess.Popen([executables['java'], '-jar', str(jar)], cwd=WORKSPACE, env=env, stdout=log, stderr=log)
            children.append(api)
            ready(f"http://127.0.0.1:{settings['ports']['api']}/actuator/health", api, stopping)
            web_env = {**clean_environment(), 'DREAMCORE_DEV_API_URL': f"http://127.0.0.1:{settings['ports']['api']}"}
            web = subprocess.Popen([executables['node'], 'node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', str(settings['ports']['web']), '--strictPort'], cwd=WORKSPACE, env=web_env, stdout=log, stderr=log)
            children.append(web)
            url = f"http://127.0.0.1:{settings['ports']['web']}"
            ready(url + '/tenant-admin/', web, stopping)
            runtime = private_read(root / 'runtime.json'); runtime['state'] = 'ready'; private_write(root / 'runtime.json', runtime)
            print(f'本地三端试用已就绪：{url}/platform-admin/\n私有账号配置：{root / "accounts.json"}\n邀请只写入本地私有目录，不发送邮件。Ctrl+C 或 npm run trial:stop 停止服务；数据保留。', flush=True)
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
        if settings:
            private_write(root / 'runtime.json', {'runId': run_id, 'state': 'stopped', 'webUrl': f"http://127.0.0.1:{settings['ports']['web']}"})
        if log:
            log.close()
        lock.close()


def status(root):
    root = directory(root); config(root)
    running = live(root)
    state = private_read(root / 'runtime.json') if (root / 'runtime.json').exists() else {'state': 'not-started'}
    print(json.dumps({'running': running, 'state': state['state'] if running else 'stopped', 'webUrl': state.get('webUrl'), 'accountsFile': str(root / 'accounts.json')}, ensure_ascii=False))


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
        rows.append({'invitationId': value['invitationId'], 'email': value['email']})
    print(json.dumps(rows, ensure_ascii=False, indent=2))
    print('以上仅为最近 100 条本地投递记录；是否已接受、过期或撤销，请以管理页面为准。')


def invitation(root, supplied_id):
    root = directory(root); config(root)
    invitation_id = str(uuid.UUID(supplied_id))
    # Operator-only local delivery. The app and HTTP server never expose this file.
    value = private_read(root / 'invitations' / (invitation_id + '.json'))
    print(f'本地邀请文件：{root / "invitations" / (invitation_id + ".json")}\n请在文件中复制 token，进入客户端的“我有邀请码”。有效状态仍由服务端校验。')
    if value.get('invitationId') != invitation_id:
        raise TrialError('邀请文件标识不匹配。')


def main():
    parser = argparse.ArgumentParser(description='本机三端联调：仅绑定 127.0.0.1；停止保留数据。')
    parser.add_argument('command', choices=['start', 'stop', 'status', 'invitations', 'invitation'])
    parser.add_argument('invitation_id', nargs='?')
    parser.add_argument('--directory', type=Path, default=DEFAULT_DIRECTORY)
    args = parser.parse_args()
    root = args.directory.absolute()
    if args.command == 'invitation':
        if not args.invitation_id:
            raise TrialError('请提供邀请 ID；可在本地 invitations 目录按邮箱查找对应 JSON 文件。')
        invitation(root, args.invitation_id)
    else:
        {'start': start, 'stop': stop, 'status': status, 'invitations': invitations}[args.command](root)


if __name__ == '__main__':
    try:
        main()
    except (TrialError, OSError, ValueError, subprocess.SubprocessError):
        # Never print exception payloads or inherited commands containing sensitive settings.
        error = sys.exc_info()[1]
        print(str(error) if isinstance(error, TrialError) else '本地试用操作失败；检查依赖、目录权限和私有日志。', file=sys.stderr)
        sys.exit(1)
