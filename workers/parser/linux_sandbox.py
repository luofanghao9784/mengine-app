"""Rootless Linux launcher: per-job systemd cgroup + bubblewrap namespaces.

Fail closed when delegation, resource limits, user manager or namespaces are missing.
Only trusted fixed recipes run here; the script argument is for local verification.
"""
import os
from pathlib import Path
import subprocess
import uuid

ROOT = Path(__file__).resolve().parent


def run_linux(job, extension, script=None):
    if os.getuid() == 0:
        raise RuntimeError('PARSER_ROOT_FORBIDDEN')
    job = Path(job).resolve(strict=True)
    script = Path(script or ROOT / ('table_compare.py' if extension == 'table-compare' else 'parse.py')).resolve(strict=True)
    if ROOT not in script.parents or not script.is_file():
        raise RuntimeError('PARSER_SCRIPT_OUTSIDE_RUNTIME')
    runtime = Path('/run/user') / str(os.getuid())
    try:
        if not (runtime / 'bus').exists():
            raise RuntimeError('PARSER_USER_MANAGER_UNAVAILABLE')
    except PermissionError as error:
        raise RuntimeError('PARSER_USER_MANAGER_UNAVAILABLE') from error
    required = [ROOT / '.venv/bin/python', ROOT / '.local/tessdata', ROOT / 'linux_worker.py']
    if script.name == 'parse.py':
        required.append(ROOT / 'structured_table.py')
    if any(not path.exists() for path in required):
        raise RuntimeError('PARSER_RUNTIME_INCOMPLETE')
    unit = 'dreamcore-parser-' + uuid.uuid4().hex + '.service'
    env = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'XDG_RUNTIME_DIR': str(runtime),
           'DBUS_SESSION_BUS_ADDRESS': 'unix:path=' + str(runtime / 'bus')}
    timeout = 12 if extension == 'table-compare' else 80
    args = ['/usr/bin/systemd-run', '--user', '--quiet', '--wait', '--pipe', '--collect',
            '--service-type=exec', '--unit=' + unit,
            '-p', 'MemoryMax=536870912', '-p', 'MemorySwapMax=0', '-p', 'TasksMax=32',
            '-p', 'CPUQuota=50%', '-p', 'RuntimeMaxSec=' + str(timeout - 2),
            '-p', 'NoNewPrivileges=yes', '-p', 'KillMode=control-group',
            str(ROOT / '.venv/bin/python'), '-I', '-B', str(ROOT / 'linux_worker.py'),
            str(job), extension, str(script)]
    process = None
    try:
        with (job / 'result').open('wb') as out, (job / 'errors').open('wb') as err:
            process = subprocess.Popen(args, env=env, stdin=subprocess.DEVNULL, stdout=out, stderr=err)
            process.wait(timeout=timeout)
            if process.returncode:
                raise RuntimeError('PARSER_EXIT')
        if (job / 'result').stat().st_size > 4_000_000:
            raise RuntimeError('OUTPUT_LIMIT')
        return (job / 'result').read_text()
    finally:
        # Stops the whole cgroup, including descendants after launcher cancellation.
        subprocess.run(['/usr/bin/systemctl', '--user', 'stop', unit], env=env,
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        if process is not None and process.poll() is None:
            process.kill()
            process.wait(timeout=3)
