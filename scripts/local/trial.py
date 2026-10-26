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
import urllib.parse
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
    prefixes = ('SPRING_', 'DATABASE_', 'INVITATION_', 'PHONE_', 'BOOTSTRAP_', 'API_', 'ENGINE_', 'SERVER_', 'MANAGEMENT_', 'DREAMCORE_', 'MATERIAL_', 'BACKUP_', 'OPERATIONS_', 'KNOWLEDGE_', 'TASK_', 'AGENT_', 'PLATFORM_', 'COMPANY_', 'COLLECTION_', 'EXPERIENCE_', 'GENERAL_EXPERIENCE_', 'BRIEFING_', 'ONGOING_', 'ANALYSIS_', 'PG', 'MENGINE_', 'DASHSCOPE_', 'WEKNORA_')
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


def public_search_environments(value):
    """Explicit instance routing only; inherited proxy/search settings never enable product access."""
    if value is None:
        return {}, {}
    from urllib.parse import urlparse
    if not isinstance(value, dict) or set(value) - {'provider', 'proxy', 'dns', 'endpoint'}:
        raise TrialError('资讯搜索配置格式无效。')
    provider = value.get('provider', 'off')
    if provider not in ('off', 'bing-rss', 'searx') or value.get('dns', 'system') not in ('system', 'google'):
        raise TrialError('资讯搜索服务或 DNS 配置无效。')
    if provider == 'off':
        return {}, {}
    engine = {'AGENT_PUBLIC_WEB_ENABLED': 'true', 'AGENT_NEWS_SEARCH_PROVIDER': provider,
              'AGENT_PUBLIC_WEB_DNS': value.get('dns', 'system')}
    proxy = value.get('proxy')
    if proxy:
        try:
            u = urlparse(proxy)
            valid = u.scheme == 'http' and u.hostname in ('127.0.0.1', '::1') and u.port and not u.username and not u.password and u.path in ('', '/') and not u.query and not u.fragment
        except (TypeError, ValueError):
            valid = False
        if not valid:
            raise TrialError('仅允许显式配置本机回环代理，目标网站仍通过 HTTPS 和公网地址校验。')
        engine['AGENT_PUBLIC_WEB_PROXY'] = proxy
    if provider == 'searx':
        endpoint = value.get('endpoint', '')
        try:
            u = urlparse(endpoint)
            valid = u.scheme == 'https' and u.hostname and '.' in u.hostname and u.path == '/search' and not u.query and not u.fragment and not u.username and not u.password
        except (TypeError, ValueError):
            valid = False
        if not valid:
            raise TrialError('SearXNG 需要公开 HTTPS 搜索接口。')
        engine['AGENT_SEARCH_ENDPOINT'] = endpoint
    return {'AGENT_PUBLIC_WEB_ENABLED': 'true', 'AGENT_NEWS_SEARCH_PROVIDER': provider}, engine


def model_environments(model, engine_port, engine_token, api_port, manual_acceptance=False, public_search=None, automatic_work=False):
    engine_env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'ENGINE_HOST': '127.0.0.1',
                  'ENGINE_PORT': str(engine_port), 'TASK_ENGINE_TOKEN': engine_token}
    # No model means no automatic discovery/dispatch; manual external verification remains available.
    api_env = {'AGENT_TASK_MODE': 'off', 'DREAMCORE_BRIEFING_ENABLED': str(bool(model)).lower()}
    if model:
        import live_model
        engine_env.update(live_model.engine_environment(model))
        engine_env['AGENT_PLATFORM_URL'] = f'http://127.0.0.1:{api_port}'
        api_env['AGENT_TASK_MODE'] = 'live'
    if manual_acceptance:
        api_env.update({'COMPANY_INFORMATION_ENABLED': 'false', 'EXPERIENCE_INTAKE_ENABLED': 'false',
                        'EXPERIENCE_ANALYSIS_ENABLED': 'false', 'EXPERIENCE_GENERALIZATION_ENABLED': 'false',
                        'BRIEFING_AUTOMATIC_ENABLED': 'false', 'DREAMCORE_BRIEFING_ENABLED': 'false', 'ONGOING_PLANS_ENABLED': 'false'})
    if automatic_work:
        if not model:
            raise TrialError('自动业务流程需要真实模型配置。')
        api_env.update({k: 'true' for k in ('COMPANY_INFORMATION_ENABLED', 'EXPERIENCE_INTAKE_ENABLED',
            'EXPERIENCE_ANALYSIS_ENABLED', 'EXPERIENCE_GENERALIZATION_ENABLED',
            'BRIEFING_AUTOMATIC_ENABLED', 'DREAMCORE_BRIEFING_ENABLED', 'ONGOING_PLANS_ENABLED')})
    search_api, search_engine = public_search_environments(public_search)
    api_env.update(search_api)
    engine_env.update(search_engine)
    return api_env, engine_env


def validate_instance_mode(settings, mode, restored=False, reconnect_live=False, enable_live=False):
    previous = settings.get('agentMode', 'off')
    if enable_live and (restored or reconnect_live or mode != 'live' or settings.get('agentMode') not in ('off', 'live')):
        raise TrialError('--enable-live 仅适用于已初始化的非恢复实例和显式真实模型启动。')
    if reconnect_live and (not restored or mode != 'live'):
        raise TrialError('重新接入仅适用于已完成显式 activate 的恢复实例，并需同时指定 --live。')
    if previous not in ('off', 'live') or (previous != mode and not (previous == 'off' and mode == 'live' and (enable_live or (restored and reconnect_live)))):
        raise TrialError('该数据目录的模型模式与本次启动不一致；保留数据接入真实验收需显式 --enable-live。已开放恢复实例可显式 --reconnect-live。')


def collection_environment(path):
    if path is None:
        return {}
    value = private_read(path)
    if set(value) != {'executable'}:
        raise TrialError('采集部署配置仅接受 executable，不接受任意环境变量。')
    executable = Path(value['executable'])
    if not executable.is_absolute() or executable.is_symlink() or not executable.is_file() or executable.stat().st_uid != os.getuid() or executable.stat().st_mode & 0o022 or not os.access(executable, os.X_OK):
        raise TrialError('采集器必须是本人所有、不可被其他用户改写的绝对路径可执行文件。')
    return {'DREAMCORE_COLLECTION_EXECUTABLE': str(executable)}


def instance_collection_environment(root, explicit=None):
    """Retain explicitly installed collection on ordinary restarts, never on restore."""
    if explicit is not None:
        return collection_environment(explicit)
    saved = root / 'collection-runtime.json'
    if (root / 'restore.json').exists() or (root / 'restore.json').is_symlink():
        return {}
    if saved.exists() or saved.is_symlink():
        return collection_environment(saved)
    return {}



def instance_weknora_environment(root):
    """Opt-in private service config; restored trials never reconnect automatically."""
    disabled = {'WEKNORA_ENABLED': 'false'}
    saved = root / 'weknora-runtime.json'
    if (root / 'restore.json').exists() or (root / 'restore.json').is_symlink():
        return disabled
    if not saved.exists() and not saved.is_symlink():
        return disabled
    value = private_read(saved)
    if set(value) != {'enabled', 'url', 'apiKey', 'rerankModelId'} or type(value['enabled']) is not bool:
        raise TrialError('WeKnora 配置字段无效。')
    if not value['enabled']:
        return disabled
    if not all(isinstance(value[k], str) and value[k].strip() for k in ('url', 'apiKey', 'rerankModelId')):
        raise TrialError('WeKnora 服务配置不完整。')
    url = urllib.parse.urlsplit(value['url'])
    if (url.username or url.password or url.query or url.fragment or url.path not in ('', '/')
            or not url.hostname or not (url.scheme == 'https' or
                (url.scheme == 'http' and url.hostname in ('127.0.0.1', 'localhost', '::1')))):
        raise TrialError('WeKnora 必须使用 HTTPS 源站或本机回环地址。')
    return {'WEKNORA_ENABLED': 'true', 'WEKNORA_URL': value['url'],
            'WEKNORA_API_KEY': value['apiKey'], 'WEKNORA_RERANK_MODEL_ID': value['rerankModelId']}


def instance_analysis_environment(root):
    """Explicit per-instance acceptance API; never inherited or activated on restore."""
    disabled = {'ANALYSIS_MATERIAL_API_ENABLED': 'false'}
    saved = root / 'analysis-runtime.json'
    if (root / 'restore.json').exists() or (root / 'restore.json').is_symlink():
        return disabled
    if not saved.exists() and not saved.is_symlink():
        return disabled
    value = private_read(saved)
    if set(value) != {'materialApiEnabled'} or type(value['materialApiEnabled']) is not bool:
        raise TrialError('分析素材接口配置必须仅包含 materialApiEnabled 布尔值。')
    return {'ANALYSIS_MATERIAL_API_ENABLED': str(value['materialApiEnabled']).lower()}


def instance_experience_environment(root):
    """Explicit experience-only enablement, never activated on restore."""
    saved = root / 'experience-runtime.json'
    if (root / 'restore.json').exists() or (root / 'restore.json').is_symlink() or not saved.exists():
        return {}
    value = private_read(saved)
    fields = {'intakeEnabled': 'EXPERIENCE_INTAKE_ENABLED',
              'analysisEnabled': 'EXPERIENCE_ANALYSIS_ENABLED',
              'generalizationEnabled': 'EXPERIENCE_GENERALIZATION_ENABLED'}
    if set(value) != set(fields) or any(type(value[k]) is not bool for k in fields):
        raise TrialError('经验运行配置必须包含三项布尔开关。')
    return {env: str(value[key]).lower() for key, env in fields.items()}


def instance_briefing_environment(root):
    disabled = {'BRIEFING_DAILY_ENABLED': 'false'}
    saved = root / 'briefing-runtime.json'
    if (root / 'restore.json').exists() or (root / 'restore.json').is_symlink():
        return disabled
    if not saved.exists() and not saved.is_symlink():
        return disabled
    value = private_read(saved)
    if (set(value) not in ({'dailyEnabled'}, {'dailyEnabled', 'automaticEnabled'})
            or type(value.get('dailyEnabled')) is not bool
            or 'automaticEnabled' in value and type(value['automaticEnabled']) is not bool):
        raise TrialError('画报配置须包含 dailyEnabled，可选 automaticEnabled，均为布尔值。')
    result = {'BRIEFING_DAILY_ENABLED': str(value['dailyEnabled']).lower()}
    if 'automaticEnabled' in value:
        result['BRIEFING_AUTOMATIC_ENABLED'] = str(value['automaticEnabled']).lower()
    return result


def instance_extra_environment(root):
    """Explicit optional services, disabled for restores; never inherit credentials."""
    api = {'DOCLING_ENABLED': 'false'}
    engine = {'AGENT_LANGFUSE_ENABLED': 'false'}
    if (root / 'restore.json').exists() or (root / 'restore.json').is_symlink():
        return api, engine
    recipe = root / 'onboarding-recipe.json'
    if recipe.exists():
        private_read(recipe)  # Enforce local private-file permissions.
        api['ONBOARDING_RECIPE_FILE'] = str(recipe.resolve())
    evidence = root / 'governance-evidence.json'
    if evidence.exists() or evidence.is_symlink():
        value = private_read(evidence)
        if not isinstance(value, dict) or set(value) - {'tenantId', 'entries', 'schema'} or not isinstance(value.get('tenantId'), str) or not isinstance(value.get('entries'), list) or not isinstance(value.get('schema', []), list):
            raise TrialError('治理来源证据必须包含 tenantId、entries，可选 schema。')
        try:
            uuid.UUID(value['tenantId'])
        except (ValueError, TypeError, KeyError):
            raise TrialError('治理来源证据企业标识无效。') from None
        api['GOVERNANCE_SOURCE_EVIDENCE'] = str(evidence.resolve())
    docling = root / 'docling-runtime.json'
    if docling.exists():
        value = private_read(docling)
        if set(value) != {'enabled'} or type(value['enabled']) is not bool:
            raise TrialError('Docling 配置必须仅包含 enabled 布尔值。')
        if value['enabled'] and not (WORKSPACE / 'workers/parser/.local/docling-artifacts/manifest.json').is_file():
            raise TrialError('Docling 离线模型尚未准备。')
        api['DOCLING_ENABLED'] = str(value['enabled']).lower()
    tracing = root / 'langfuse-runtime.json'
    if tracing.exists():
        from urllib.parse import urlparse
        value = private_read(tracing)
        if set(value) != {'enabled','baseUrl','publicKey','secretKey'} or type(value['enabled']) is not bool:
            raise TrialError('Langfuse 配置字段无效。')
        if value['enabled']:
            u = urlparse(value['baseUrl'])
            if u.username or u.password or u.query or u.fragment or u.path not in ('','/') or not u.hostname or not (u.scheme == 'https' or u.scheme == 'http' and u.hostname in ('127.0.0.1','localhost','::1')) or not all(isinstance(value[k],str) and value[k].strip() for k in ('publicKey','secretKey')):
                raise TrialError('Langfuse 地址或项目凭据无效。')
            engine.update({'AGENT_LANGFUSE_ENABLED':'true','LANGFUSE_BASE_URL':value['baseUrl'],'LANGFUSE_PUBLIC_KEY':value['publicKey'],'LANGFUSE_SECRET_KEY':value['secretKey']})
    return api, engine


def instance_presentation_environment(root):
    """Trusted fixed PPT renderer only; restore never reactivates saved capabilities."""
    disabled = {'AGENT_PPT_RENDERER_ENABLED': 'false'}
    saved = root / 'presentation-runtime.json'
    if (root / 'restore.json').exists() or (root / 'restore.json').is_symlink():
        return disabled
    if not saved.exists() and not saved.is_symlink():
        return disabled
    value = private_read(saved)
    if set(value) != {'enabled'} or type(value['enabled']) is not bool:
        raise TrialError('PPT 生成配置必须仅包含 enabled 布尔值。')
    return {'AGENT_PPT_RENDERER_ENABLED': str(value['enabled']).lower()}


def instance_platform_capabilities(root):
    """Private local opt-in for implemented platform capabilities; never restored implicitly."""
    fields = {'presentationEnabled': ('DREAMCORE_TASKS_PPT_RENDERER_ENABLED',
                                      'DREAMCORE_TASKS_ARTIFACT_TRANSFER_ENABLED'),
              'governanceDispatchEnabled': ('DREAMCORE_GOVERNANCE_DISPATCH_ENABLED',)}
    disabled = {name: 'false' for names in fields.values() for name in names}
    saved = root / 'capabilities-runtime.json'
    if (root / 'restore.json').exists() or (root / 'restore.json').is_symlink() or not saved.exists():
        return disabled
    value = private_read(saved)
    if not isinstance(value, dict) or set(value) != set(fields) or any(type(v) is not bool for v in value.values()):
        raise TrialError('平台能力配置须包含 presentationEnabled 和 governanceDispatchEnabled 两项布尔值。')
    return {name: str(value[key]).lower() for key, names in fields.items() for name in names}


def start(root, model_config=None, reconnect_live=False, phone_local=False, collection_config=None, enable_live=False, automatic_work=False, scene_tenant=None):
    os.umask(0o077)
    collection_env = instance_collection_environment(root, collection_config)
    weknora_env = instance_weknora_environment(root)
    analysis_env = instance_analysis_environment(root)
    briefing_env = instance_briefing_environment(root)
    presentation_env = instance_presentation_environment(root)
    platform_capabilities = instance_platform_capabilities(root)
    extra_api_env, extra_engine_env = instance_extra_environment(root)
    model = None
    if model_config is not None:
        import live_model
        model = live_model.load(model_config)
        live_model.check(model)
    if automatic_work and model is None:
        raise TrialError('自动工作循环需要 start --live 和有效模型配置。')
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
        validate_instance_mode(config(root), mode, restored, reconnect_live, enable_live)
    elif enable_live:
        raise TrialError('--enable-live 需要已有实例，不创建或重新初始化验收数据。')
    jar = WORKSPACE / 'apps/api/target/workspace-api-0.1.0-SNAPSHOT.jar'
    if not jar.is_file() or not (WORKSPACE / 'dist/tenant-admin/index.html').is_file() or not (WORKSPACE / 'engine/dist/main.js').is_file():
        raise TrialError('缺少构建产物；先运行 npm run trial:build。')
    verify_api_migrations(jar)
    scene_path = root / 'scene-private.json'
    if scene_tenant or scene_path.exists():
        if not (WORKSPACE / 'integrations/mengine-wiki/dist/api/server.js').is_file():
            raise TrialError('先运行 npm --prefix integrations/mengine-wiki run build。')
        if scene_tenant:
            scene_tenant = str(uuid.UUID(scene_tenant))
        if scene_path.exists() and scene_tenant and private_read(scene_path)['tenant'] != scene_tenant:
            raise TrialError('已有数据服务绑定其他企业；拒绝覆盖。')
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
        if scene_tenant and not scene_path.exists():
            private_write(scene_path, {'tenant': scene_tenant, 'key': secrets.token_urlsafe(48)})
        # Recheck after locking: a concurrent first start can have created the configuration.
        if restored:
            backup_recovery.require_activation(root)
        validate_instance_mode(settings, mode, restored, reconnect_live, enable_live)
        if settings.get('agentMode', 'off') != mode or (enable_live and not settings.get('manualModelAcceptance')):
            settings['agentMode'] = mode
            if enable_live:
                settings['manualModelAcceptance'] = True
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
        if automatic_work:
            settings['automaticWorkEnabled'] = True
            private_write(root / 'config.json', settings)
        model_api_env, engine_env = model_environments(model, engine_port, engine_token, settings['ports']['api'], settings.get('manualModelAcceptance', False), settings.get('publicSearch'), settings.get('automaticWorkEnabled', False))
        engine_env.update(presentation_env)
        engine_env.update(extra_engine_env)
        env = {**clean_environment(), 'TASK_ENABLED':'true', 'TASK_ENGINE_TOKEN':engine_token, 'ENGINE_BASE_URL':f'http://127.0.0.1:{engine_port}', 'DATABASE_URL': f"jdbc:postgresql://127.0.0.1:{settings['ports']['database']}/dreamcore_trial", 'DATABASE_USER': 'dreamcore_trial', 'DATABASE_PASSWORD': secret,
               'KNOWLEDGE_ENABLED': str((WORKSPACE / 'workers/parser/.venv/bin/python').exists()).lower(), 'KNOWLEDGE_PARSER_ROOT': str(WORKSPACE / 'workers/parser'), 'MATERIAL_STORAGE_ROOT': str(root / 'objects'), 'SPRING_PROFILES_ACTIVE': 'local', 'INVITATION_DELIVERY': 'local', 'INVITATION_OUTBOX': str(root / 'invitations'), 'API_HOST': '127.0.0.1', 'API_PORT': str(settings['ports']['api']), 'SERVER_SERVLET_SESSION_COOKIE_NAME': 'DREAMCORE_TRIAL_' + hashlib.sha256(str(root).encode()).hexdigest()[:12]}
        env.update({'PHONE_DELIVERY': 'local' if phone_local else 'disabled', 'PHONE_LOCAL_PREVIEW': str(phone_local).lower(), 'PHONE_OUTBOX': str(root / 'phone-sms')})
        env['PLATFORM_COOKIE_NAME'] = 'DREAMCORE_PLATFORM_TRIAL_' + hashlib.sha256(str(root).encode()).hexdigest()[:12]
        env.update(collection_env)
        env.update(weknora_env)
        if collection_config is not None:
            private_write(root / 'collection-runtime.json', {'executable': collection_env['DREAMCORE_COLLECTION_EXECUTABLE']})
        env.update(model_api_env)
        env.update(instance_experience_environment(root))
        env.update(analysis_env)
        env.update(briefing_env)
        env.update(extra_api_env)
        env.update(platform_capabilities)
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
            if scene_path.exists():
                scene_config = private_read(scene_path)
                scene_id = str(uuid.UUID(scene_config['tenant']))
                raw = identity_query("SELECT json_build_object('tenant',t.id,'name',t.name,'owner',g.owner_id,'ownerName',a.display_name)::text FROM tenants t JOIN tenant_governance g ON g.tenant_id=t.id JOIN accounts a ON a.id=g.owner_id JOIN tenant_memberships m ON m.tenant_id=t.id AND m.account_id=a.id WHERE t.id='" + scene_id + "' AND t.status='ACTIVE' AND a.status='ACTIVE' AND m.status='ACTIVE'")
                if not raw:
                    raise TrialError('本地演示企业须先开通并由有效负责人接管；没有改动原数据。')
                private_write(root / 'scene-binding.json', json.loads(raw))
                scene_port = free_port()
                scene_env = {**clean_environment(), 'API_PORT':str(scene_port), 'MENGINE_PLATFORM_BRIDGE_KEY':scene_config['key']}
                if model:
                    scene_env.update(live_model.engine_environment(model))
                scene = subprocess.Popen([executables['node'], 'scripts/local/scene-trial.mjs', str(root)], cwd=WORKSPACE, env=scene_env, stdout=log, stderr=log)
                children.append(scene)
                ready(f'http://127.0.0.1:{scene_port}/api/health', scene, stopping)
                env.update({'MENGINE_PLATFORM_BRIDGE_KEY':scene_config['key'], 'MENGINE_PLATFORM_BRIDGE_URL':f'http://127.0.0.1:{scene_port}/api/internal/platform-scene'})
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
    parser.add_argument('--scene-tenant', help='为已接管的本地演示企业启动隔离新版数据服务；首次绑定后随本实例重启。')
    parser.add_argument('--phone-local', action='store_true', help='在隔离实例启用本地测试短信与邀请预览；真实模型验收同时要求 --enable-live，不发送真实短信。')
    parser.add_argument('--live', action='store_true', help='显式开启真实模型；只适用于 start。')
    parser.add_argument('--model-config', type=Path, help='本工作树 .local/model-private 内的私有模型配置。')
    parser.add_argument('--reconnect-live', action='store_true', help='已 activate 的恢复实例显式重新接入真实模型；旧任务/计划不自动恢复。')
    parser.add_argument('--enable-live', action='store_true', help='明确授权已有非恢复实例接入真实模型，保留数据；关闭自动分析/画报与定时计划，只供手动验收。')
    parser.add_argument('--automatic-work', action='store_true', help='显式启用并保存真实模型自动工作循环：企业分析、经验和已配置的计划。')
    parser.add_argument('--collection-config', type=Path, help='部署维护的 0600 采集器配置；不从继承环境读取。')
    args = parser.parse_args()
    if args.scene_tenant and args.command != 'start':
        raise TrialError('--scene-tenant 仅用于 start。')
    if args.automatic_work and (args.command != 'start' or not args.live):
        raise TrialError('--automatic-work 仅适用于 start --live。')
    if args.collection_config and args.command != 'start':
        raise TrialError('采集配置仅适用于 start。')
    if (args.live or args.model_config) and (args.command != 'start' or not args.live):
        raise TrialError('模型参数仅适用于 start --live。')
    if args.reconnect_live and (args.command != 'start' or not args.live):
        raise TrialError('--reconnect-live 仅适用于 start --live。')
    if args.enable_live and (args.command != 'start' or not args.live or args.reconnect_live):
        raise TrialError('--enable-live 仅适用于非恢复实例的 start --live。')
    if args.phone_local and (args.command != 'start' or (args.live and not args.enable_live)):
        raise TrialError('--phone-local 仅适用于非 live 启动或显式 --enable-live 的手动真实验收。')
    root = args.directory.absolute()
    if args.command == 'start':
        if args.live:
            from live_model import DEFAULT_CONFIG
            start(root, args.model_config or DEFAULT_CONFIG, args.reconnect_live, phone_local=args.phone_local, collection_config=args.collection_config, enable_live=args.enable_live, automatic_work=args.automatic_work, scene_tenant=args.scene_tenant)
        else:
            start(root, phone_local=args.phone_local, collection_config=args.collection_config, scene_tenant=args.scene_tenant)
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
