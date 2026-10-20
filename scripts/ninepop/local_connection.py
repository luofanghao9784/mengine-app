#!/usr/bin/env python3
"""Installed but disabled 9POP connection. No network operation in this preparation slice."""
import argparse, importlib.util, json
from pathlib import Path


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


def check(path):
    m = module('full_collector'); c = m.private(path)
    if c.get('format') != 'ninepop-local-prepared-v1' or c.get('enabled') is not False:
        raise ValueError('Only disabled preparation connections are supported')
    if c.get('automaticRefresh') is not False or c.get('destinationHost') != '127.0.0.1':
        raise ValueError('Local/manual boundary required')
    import uuid
    uuid.UUID(c['tenantId'])
    projections = c['projections']
    if not projections: raise ValueError('Projection manifest required')
    names = set()
    for batch in projections:
        for t in m.projections(batch, c['tenantId']):
            if t['name'] in names: raise ValueError('Duplicate dataset across batches')
            names.add(t['name'])
    return {'status': 'INSTALLED_DISABLED', 'datasetCount': len(names), 'networkExecuted': False,
            'automaticRefresh': False, 'tenantId': c['tenantId']}


def main():
    p=argparse.ArgumentParser();p.add_argument('--config',required=True);p.add_argument('--check',action='store_true');a=p.parse_args()
    result=check(a.config)
    if not a.check: raise SystemExit('REAL_COLLECTION_NOT_ENABLED: no network operation performed')
    print(json.dumps(result))

if __name__ == '__main__': main()
