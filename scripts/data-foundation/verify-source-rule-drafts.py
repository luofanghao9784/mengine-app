#!/usr/bin/env python3
"""Read-only verification of collector rule drafts against this deployment's bindings.

This verifies provenance/identity and snapshot alignment, not business approval.
No draft is installed as a Dreamcore source contract by this command.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import uuid


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def read(path, maximum=2 * 1024 * 1024):
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077 or path.stat().st_uid != os.getuid() or path.stat().st_size > maximum:
        raise ValueError('PRIVATE_ARTIFACT_REQUIRED')
    return json.loads(path.read_text())


def verify(binding):
    uuid.UUID(binding['tenantId'])
    uuid.UUID(binding['connectionId'])
    root = Path(binding['home'])
    if not root.is_absolute() or root.is_symlink():
        raise ValueError('COLLECTOR_HOME_INVALID')
    result = []
    db = sqlite3.connect((root / 'state.sqlite').as_uri() + '?mode=ro', uri=True)
    db.execute('PRAGMA query_only=ON')
    db.execute('BEGIN')
    try:
        for item in binding['datasets']:
            identifier = str(uuid.UUID(item['localDatasetId']))
            uuid.UUID(item['id'])
            row = db.execute('SELECT definition,snapshot,last_error FROM datasets WHERE id=?', (identifier,)).fetchone()
            if not row or not row[1] or row[2]:
                raise ValueError('SOURCE_SNAPSHOT_UNAVAILABLE')
            definition = json.loads(row[0])
            if definition['source'] != item['source'] or definition['scope'] != item['scope'] or [c['name'] for c in definition['columns']] != item['columns']:
                raise ValueError('SOURCE_BINDING_MISMATCH')
            directory = root / 'source-research' / identifier
            if directory.is_symlink() or directory.parent.is_symlink():
                raise ValueError('PRIVATE_ARTIFACT_REQUIRED')
            receipt = read(directory / 'latest.json')
            fingerprint = receipt.get('draftId', '')
            if not isinstance(fingerprint, str) or not re.fullmatch('[0-9a-f]{64}', fingerprint):
                raise ValueError('DRAFT_ID_INVALID')
            draft = read(directory / (fingerprint + '.json'))
            package = read(root / 'packages' / (str(uuid.UUID(row[1])) + '.json'), 32 * 1024 * 1024)
            schema = {key: definition[key] for key in ('name', 'source', 'scope', 'columns', 'primaryKey', 'headerRow', 'sheet')}
            if 'sourceHeaders' in definition:
                schema['sourceHeaders'] = definition['sourceHeaders']
            indices = [item['columns'].index(key) for key in definition['primaryKey']]
            canonical = lambda v: json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
            index = {canonical([record[i] for i in indices]): digest(record) for record in package['rows']}
            if len(index) != len(package['rows']) or digest({'schema': schema, 'index': index}) != package.get('contentHash'):
                raise ValueError('SOURCE_PACKAGE_HASH_MISMATCH')
            if (digest(draft) != fingerprint or draft.get('format') != 'source-rule-draft-v1'
                    or draft.get('datasetId') != identifier or draft.get('source') != item['source']
                    or draft.get('scopeHash') != digest(item['scope']) or draft.get('columns') != item['columns']
                    or package.get('datasetId') != identifier or package.get('columns') != item['columns']
                    or receipt.get('snapshotHash') != package.get('contentHash')
                    or receipt.get('rowCount') != len(package['rows'])):
                raise ValueError('DRAFT_SNAPSHOT_MISMATCH')
            if draft.get('approved') is not False or receipt.get('approved') is not False or receipt.get('publishedToDreamcore') is not False:
                raise ValueError('DRAFT_CANNOT_GRANT_APPROVAL')
            checks, rules = receipt.get('checks', []), draft.get('rules', [])
            if (len(checks) != len(rules) or receipt.get('rulesChecked') != len(rules)
                    or [c.get('ruleId') for c in checks] != [digest(r) for r in rules]
                    or any(c.get('rowsChecked') != len(package['rows']) for c in checks)):
                raise ValueError('DRAFT_CHECKS_MISMATCH')
            result.append({'datasetId': item['id'], 'table': definition['name'],
                           'draftId': fingerprint, 'state': receipt['state'], 'rowsChecked': receipt['rowCount'],
                           'documentedFields': receipt['documentedFields'], 'unknownFields': receipt['unknownFields'],
                           'sourceLabelFields': sum(bool(f.get('sourceLabels')) for f in draft['fields']),
                           'candidateEnumFields': sum(any(x.get('candidateEnum') for x in f.get('sourceLabels', [])) for f in draft['fields']),
                           'rulesChecked': len(checks), 'failedRules': receipt['failedRules'],
                           'draftBindingVerified': True, 'businessApproved': False})
    finally:
        db.close()
    return {'tenantId': binding['tenantId'], 'connectionId': binding['connectionId'], 'tables': result}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binding', required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(verify(read(Path(args.binding))), ensure_ascii=False, indent=2))
    except (ValueError, KeyError, OSError, sqlite3.Error):
        raise SystemExit('SOURCE_RULE_DRAFT_VERIFICATION_FAILED') from None
