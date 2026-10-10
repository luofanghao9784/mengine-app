"""Trusted launcher. No shell, no inherited secrets, no unsandboxed fallback."""
import json, os, resource, signal, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent

def profile(job):
    def quote(p): return json.dumps(str(p), ensure_ascii=False)
    paths = ['/System/Library', '/usr/lib', '/usr/share/locale', '/opt/homebrew', str(Path(sys.base_prefix).resolve()), str(ROOT), str(job)]
    return '(version 1) (deny default) (allow process*) (allow sysctl-read) (allow mach-lookup) (allow file-read-metadata) (allow file-read-data (literal "/")) ' + ' '.join('(allow file-read* (subpath ' + quote(p) + '))' for p in paths) + ' (allow file-read* (literal "/dev/null") (literal "/dev/urandom")) (allow file-write* (literal "/dev/null") (subpath ' + quote(job) + '))'

def run(job, extension, script=None):
    if sys.platform == 'linux':
        # Java invokes Python with -I, so the script directory is not on sys.path.
        import importlib.util
        spec = importlib.util.spec_from_file_location('dreamcore_linux_sandbox', ROOT / 'linux_sandbox.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.run_linux(job, extension, script)
    if sys.platform != 'darwin' or not Path('/usr/bin/sandbox-exec').exists(): raise RuntimeError('SANDBOX_UNAVAILABLE')
    job = Path(job).resolve(strict=True)
    env = {'PATH': '/opt/homebrew/bin:/usr/bin:/bin', 'LANG': 'en_US.UTF-8', 'TMPDIR': str(job), 'TESSDATA_PREFIX': str(ROOT / '.local/tessdata'), 'OMP_THREAD_LIMIT': '1', 'PYTHONDONTWRITEBYTECODE': '1'}
    table = extension == 'table-compare'
    args = ['/usr/bin/sandbox-exec', '-p', profile(job), str(ROOT / '.venv/bin/python'), '-I', '-B', str(script or ROOT / ('table_compare.py' if table else 'parse.py')), str(job / 'input'), extension]
    def limits():
        resource.setrlimit(resource.RLIMIT_FSIZE, (8_388_608, 8_388_608))
        resource.setrlimit(resource.RLIMIT_CPU, (5, 5) if table else (50, 50))
    # Files avoid unbounded stdout/stderr buffers. Limits also apply to child processes.
    with (job / 'result').open('wb') as out, (job / 'errors').open('wb') as err:
        process = subprocess.Popen(args, cwd=job, env=env, stdout=out, stderr=err, start_new_session=True, preexec_fn=limits)
        try:
            process.wait(timeout=8 if table else 75)
            if process.returncode: raise RuntimeError('PARSER_EXIT')
        finally:
            try: os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError: pass
    if (job / 'result').stat().st_size > 4_000_000: raise RuntimeError('OUTPUT_LIMIT')
    return (job / 'result').read_text()

if __name__ == '__main__':
    try: print(run(sys.argv[1], sys.argv[2]))
    except Exception:
        print(json.dumps({'parserVersion': 'local-3', 'status': 'FAILED', 'warnings': ['PARSER_UNAVAILABLE_OR_LIMIT'], 'chunks': []}))
        sys.exit(0)
