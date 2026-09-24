"""Local macOS prototype. Fixed launcher, clean environment, no unsandboxed fallback.

No cloud isolation claim: macOS Seatbelt plus Node restrictions is for local validation.
Only bounded candidate packages are staged for local tests. No production admission or Linux/container deployment.
"""
import json
import os
from pathlib import Path
import resource
import subprocess
import sys


def runtime_files(node):
    """Resolve the actual Node dylib closure, never grant all of Homebrew."""
    node = Path(node).resolve(strict=True)
    files, pending = set(), [node]
    while pending:
        path = pending.pop()
        if path in files:
            continue
        files.add(path)
        text = subprocess.check_output(['/usr/bin/otool', '-L', str(path)], text=True)
        for line in text.splitlines()[1:]:
            dep = line.strip().split(' (', 1)[0]
            if dep.startswith(('/usr/lib/', '/System/Library/')):
                continue
            if dep.startswith('@rpath/'):
                relative = dep.removeprefix('@rpath/')
                dep = str(next(candidate for candidate in [path.parent / relative, node.parent.parent / 'lib' / relative] if candidate.is_file()))
            elif dep.startswith('@loader_path/'):
                dep = str(path.parent / dep.removeprefix('@loader_path/'))
            target = Path(dep).resolve(strict=True)
            if target not in files:
                pending.append(target)
    return files


def main():
    if sys.platform != 'darwin' or not Path('/usr/bin/sandbox-exec').is_file():
        raise RuntimeError('SANDBOX_UNAVAILABLE')
    node, job = Path(sys.argv[1]).resolve(strict=True), Path(sys.argv[2]).resolve(strict=True)
    quote = lambda p: json.dumps(str(p), ensure_ascii=False)
    # Job root is readable; only output and tmp can be written. All networking is denied.
    profile = '(version 1) (deny default) (allow sysctl-read) (allow mach-lookup) (allow file-read-metadata) (allow file-read* (literal "/")) '
    profile += '(allow process-exec (literal ' + quote(node) + ')) '
    profile += '(allow file-read* (subpath "/System/Library") (subpath "/usr/lib") (subpath ' + quote(job) + ')) '
    profile += '(allow file-read* ' + ' '.join('(literal ' + quote(p) + ')' for p in runtime_files(node)) + ') '
    profile += '(allow file-read* (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random")) '
    profile += '(allow file-write* (literal "/dev/null") (subpath ' + quote(job / 'outputs') + ') (subpath ' + quote(job / 'tmp') + '))'
    resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
    resource.setrlimit(resource.RLIMIT_FSIZE, (65536, 65536))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    # Node permissions are an extra guard (children/workers/native addons), not the OS boundary.
    args = ['/usr/bin/sandbox-exec', '-p', profile, str(node), '--max-old-space-size=64',
            '--permission', '--allow-fs-read=*', '--allow-fs-write=*', '--disable-proto=throw',
            str(job / 'script.mjs')]
    os.chdir(job / 'outputs')
    os.execve(args[0], args, {'PATH': '/usr/bin:/bin', 'LANG': 'en_US.UTF-8', 'OPENSSL_CONF': '/dev/null',
                             'HOME': str(job / 'tmp'), 'TMPDIR': str(job / 'tmp')})


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('SANDBOX_UNAVAILABLE', file=sys.stderr)
        sys.exit(70)
