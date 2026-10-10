#!/usr/bin/env python3
"""Copy private object files with SHA-256 verification; never copies credentials.

An online file snapshot is rehearsal input, not an atomic database/files cutover.
Reject links and changes observed during copying. Print only aggregate results.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil


def manifest(root):
    result = []
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise RuntimeError('Object symlinks are not supported')
        if path.is_dir():
            continue
        if not path.is_file():
            raise RuntimeError('Unexpected object file type')
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(block)
        result.append({'path': path.relative_to(root).as_posix(), 'bytes': path.stat().st_size,
                       'sha256': digest.hexdigest()})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['create', 'verify'])
    parser.add_argument('--source', type=Path)
    parser.add_argument('--snapshot', required=True, type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    if args.command == 'create':
        if not args.source:
            parser.error('--source required for create')
        source = args.source.resolve(strict=True)
        target = args.snapshot.absolute()
        if target == source or source in target.parents:
            raise RuntimeError('Snapshot must be outside source')
        before = manifest(source)
        target.mkdir(mode=0o700, exist_ok=False)
        shutil.copytree(source, target/'objects', symlinks=True)
        if before != manifest(target/'objects') or before != manifest(source):
            raise RuntimeError('Objects changed while copying; snapshot is not verified')
        (target/'objects-manifest.json').write_text(json.dumps(before, ensure_ascii=False, indent=2))
    else:
        target = args.snapshot.resolve(strict=True)
        before = json.loads((target/'objects-manifest.json').read_text())
        if before != manifest(target/'objects'):
            raise RuntimeError('Object inventory or digest mismatch')
    print(json.dumps({'status': 'OBJECT_FILES_VERIFIED', 'files': len(before),
                      'bytes': sum(row['bytes'] for row in before),
                      'manifestSha256': hashlib.sha256((target/'objects-manifest.json').read_bytes()).hexdigest(),
                      'scope': 'file snapshot only; not transactionally coupled to database'}))


if __name__ == '__main__':
    main()
