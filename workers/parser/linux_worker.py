"""Trusted pre-exec gate inside the per-job cgroup. Never runs untrusted input on host."""
import fcntl
import os
from pathlib import Path
import resource
import subprocess
import sys

ROOT = Path(__file__).resolve().parent


def command(job, extension, script):
    if os.getuid() == 0:
        raise RuntimeError('PARSER_ROOT_FORBIDDEN')
    group = next(line[3:] for line in Path('/proc/self/cgroup').read_text().splitlines() if line.startswith('0::'))
    cgroup = Path('/sys/fs/cgroup') / group.lstrip('/')
    if not cgroup.name.startswith('dreamcore-parser-') or not cgroup.name.endswith('.service'):
        raise RuntimeError('PARSER_CGROUP_REQUIRED')
    for name, maximum in [('memory.max', 536870912), ('memory.swap.max', 0), ('pids.max', 32)]:
        if int((cgroup / name).read_text().strip()) > maximum:
            raise RuntimeError('PARSER_CGROUP_LIMIT')
    quota, period = (cgroup / 'cpu.max').read_text().split()
    if int(quota) / int(period) > 0.5:
        raise RuntimeError('PARSER_CPU_LIMIT')
    script = Path(script).resolve(strict=True)
    if ROOT not in script.parents:
        raise RuntimeError('PARSER_SCRIPT_OUTSIDE_RUNTIME')
    job = Path(job).resolve(strict=True)
    args = ['/usr/bin/bwrap', '--unshare-all', '--unshare-user', '--unshare-cgroup', '--die-with-parent', '--new-session',
            '--cap-drop', 'ALL', '--clearenv']
    for directory in ['/usr', '/lib', '/lib64']:
        if Path(directory).exists():
            args += ['--ro-bind', directory, directory]
    # No host /home, /run, /etc credentials, API storage, Docker socket or sibling jobs.
    for path in [ROOT / '.venv', ROOT / '.local/tessdata', script, *([ROOT / 'structured_table.py'] if script.name == 'parse.py' else [])]:
        args += ['--ro-bind', str(path), str(path)]
    if Path('/etc/ld.so.cache').exists():
        args += ['--ro-bind', '/etc/ld.so.cache', '/etc/ld.so.cache']
    args += ['--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/job']
    for name in ['input', 'request.json']:
        path = job / name
        if path.is_symlink():
            raise RuntimeError('PARSER_INPUT_SYMLINK')
        if path.is_file():
            args += ['--ro-bind', str(path), '/job/' + name]
    args += ['--chdir', '/job', '--setenv', 'PATH', '/usr/bin:/bin',
             '--setenv', 'LANG', 'C.UTF-8', '--setenv', 'TMPDIR', '/tmp',
             '--setenv', 'TESSDATA_PREFIX', str(ROOT / '.local/tessdata'),
             '--setenv', 'OMP_THREAD_LIMIT', '1', '--setenv', 'PYTHONDONTWRITEBYTECODE', '1',
             str(ROOT / '.venv/bin/python'), '-I', '-B', str(script), '/job/input', extension]
    resource.setrlimit(resource.RLIMIT_FSIZE, (8_388_608, 8_388_608))
    resource.setrlimit(resource.RLIMIT_CPU, (5, 5) if extension == 'table-compare' else (50, 50))
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
    return args


if __name__ == '__main__':
    try:
        args = command(*sys.argv[1:])
        # The cgroup worker owns admission until all sandbox children end, even if
        # the API launcher is killed. No lock descriptor is exposed to the sandbox.
        lock = Path('/run/user') / str(os.getuid()) / 'dreamcore-parser.lock'
        fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = subprocess.run(args, env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'}, close_fds=True)
            sys.exit(result.returncode if result.returncode >= 0 else 1)
        finally:
            os.close(fd)
    except Exception:
        print('PARSER_LINUX_ISOLATION_UNAVAILABLE', file=sys.stderr)
        sys.exit(1)
