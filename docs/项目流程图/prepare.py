#!/usr/bin/env python3
"""Prepare a pinned Mermaid renderer in the ignored local cache."""
import hashlib
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js'
SHA256 = 'a43bc1afd446f9c4cc66ac5dd45d02e8d65e26fc5344ec0ef787f88d6ddb6f9e'
TARGET = ROOT / '.local/diagram-tools/mermaid-11.4.1.min.js'


def main():
    if TARGET.is_file() and hashlib.sha256(TARGET.read_bytes()).hexdigest() == SHA256:
        print('Mermaid 11.4.1 cache verified.')
        return
    with urllib.request.urlopen(URL, timeout=60) as response:
        content = response.read(5_000_001)
    if len(content) > 5_000_000 or hashlib.sha256(content).hexdigest() != SHA256:
        raise SystemExit('Renderer checksum mismatch; cache not changed.')
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    temporary = TARGET.with_suffix('.tmp')
    temporary.write_bytes(content)
    temporary.replace(TARGET)
    print('Mermaid 11.4.1 downloaded and verified.')


if __name__ == '__main__':
    main()
