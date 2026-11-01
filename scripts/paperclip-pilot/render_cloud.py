"""Render reviewable scripts for one explicitly approved new Linux host; no SSH or purchase."""
import argparse
import ipaddress
import re
from pathlib import Path

TEMPLATES = Path(__file__).resolve().parents[2] / 'config/paperclip-pilot/cloud/templates'


def render(address, hostname, output):
    ip = ipaddress.ip_address(address)
    if ip.version != 4 or ip.is_loopback or ip.is_unspecified or ip.is_multicast:
        raise ValueError('Expected a non-loopback IPv4 address')
    if not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9.-]{0,61}[A-Za-z0-9])?', hostname):
        raise ValueError('Invalid hostname')
    destination = Path(output)
    if destination.is_symlink() or (destination.exists() and any(destination.iterdir())):
        raise ValueError('Refusing an existing nonempty or symlink destination')
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    for source in sorted(TEMPLATES.glob('*.template')):
        content = source.read_text().replace('@PAPERCLIP_IPV4@', str(ip)).replace('@PAPERCLIP_HOSTNAME@', hostname)
        if '@PAPERCLIP_' in content:
            raise ValueError('Unresolved template binding')
        (destination / source.name.removesuffix('.template')).write_text(content)
    package = TEMPLATES.parent.parent / 'runtime'
    for name in ('package.json', 'package-lock.json'):
        (destination / name).write_bytes((package / name).read_bytes())
    patches = TEMPLATES.parent.parent / 'patches'
    (destination / 'patches').mkdir()
    for name in ('manifest.json', 'runtime.patch'):
        (destination / 'patches' / name).write_bytes((patches / name).read_bytes())
    (destination / 'patch_runtime.py').write_bytes(Path(__file__).with_name('patch_runtime.py').read_bytes())
    plan = TEMPLATES.parent / 'role-plan.json'
    (destination / 'role-plan.json').write_bytes(plan.read_bytes())
    return destination


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ipv4', required=True)
    parser.add_argument('--hostname', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    print('Rendered locally:', render(args.ipv4, args.hostname, args.output))
