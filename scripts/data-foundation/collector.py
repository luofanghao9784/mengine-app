#!/usr/bin/env python3
"""Deployment-only database reader implementing CollectionAdapter 1.0. No model calls."""
import contextlib
import datetime
import decimal
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
import uuid

MAX_ROWS = 100000
MAX_CELLS = 1000000
MAX_BYTES = 20 * 1024 * 1024


def identifier(value, quote='"'):
    if not isinstance(value, str) or not value or len(value) > 160 or any(ord(c) < 32 for c in value):
        raise ValueError('identifier')
    return quote + value.replace(quote, quote * 2) + quote


def validate(config, request):
    if config.get('kind') not in ('sqlite', 'postgres', 'mysql'):
        raise ValueError('kind')
    if request.get('contractVersion') != '1.0':
        raise ValueError('protocol')
    for key in ('tenantId', 'connectionId'):
        uuid.UUID(config[key])
        if request.get(key) != config[key]:
            raise ValueError('scope')
    uuid.UUID(request['runId'])
    definitions = config['datasets']
    if not isinstance(definitions, list) or not 1 <= len(definitions) <= 100:
        raise ValueError('datasets')
    expected = []
    for d in definitions:
        uuid.UUID(d['id'])
        identifier(d['key'])
        identifier(d['table'])
        if d.get('schema'):
            identifier(d['schema'])
        columns = d['columns']
        if not isinstance(columns, list) or not 1 <= len(columns) <= 100:
            raise ValueError('columns')
        for c in columns:
            identifier(c['source'])
            identifier(c['name'])
        if len({c['name'] for c in columns}) != len(columns) or len({c['source'] for c in columns}) != len(columns):
            raise ValueError('duplicate columns')
        scope = d.get('rowScope')
        if scope is not None:
            if not isinstance(scope, dict) or set(scope) != {'column', 'values'}:
                raise ValueError('row scope')
            identifier(scope['column'])
            if not isinstance(scope['values'], list) or not 1 <= len(scope['values']) <= 100 or any(not isinstance(v, str) or not v or len(v) > 160 for v in scope['values']):
                raise ValueError('row scope values')
        expected.append({'id': d['id'], 'key': d['key'], 'columns': [c['name'] for c in columns]})
    if len({d['id'] for d in expected}) != len(expected) or len({d['key'] for d in expected}) != len(expected):
        raise ValueError('duplicate datasets')
    # A caller cannot change host, table, columns, order within a row, or the deployed set.
    supplied = request.get('datasets')
    if not isinstance(supplied, list) or sorted(supplied, key=lambda d: d['id']) != sorted(expected, key=lambda d: d['id']):
        raise ValueError('request scope')


def load_config(filename):
    p = Path(filename)
    if not p.is_absolute() or p.is_symlink() or not p.is_file() or p.stat().st_mode & 0o077 or p.stat().st_size > 131072:
        raise ValueError('private absolute configuration required')
    return json.loads(p.read_text())


def select_source(installed, request):
    if 'sources' not in installed:
        return installed
    sources = installed['sources']
    if not isinstance(sources, list) or not 1 <= len(sources) <= 100:
        raise ValueError('source registry')
    identities = [(s['tenantId'], s['connectionId']) for s in sources]
    if len(set(identities)) != len(identities):
        raise ValueError('duplicate source identity')
    matches = [s for s in sources if (s['tenantId'], s['connectionId']) == (request.get('tenantId'), request.get('connectionId'))]
    if len(matches) != 1:
        raise ValueError('source not deployed')
    return matches[0]


@contextlib.contextmanager
def connect(config):
    conn = None
    try:
        kind = config['kind']
        if kind == 'sqlite':
            source = Path(config['file'])
            if not source.is_absolute() or source.is_symlink() or not source.is_file():
                raise ValueError('deployed source file required')
            conn = sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True, timeout=8)
            deadline = time.monotonic() + 30
            conn.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
            conn.execute('PRAGMA query_only=ON')
            conn.execute('BEGIN')
        else:
            host = config['host']
            if not isinstance(host, str) or not re.fullmatch(r'[a-zA-Z0-9.:-]+', host):
                raise ValueError('host')
            # Host is installed by deployment, never taken from a browser or model.
            port = config['port']
            if type(port) is not int or not 1 <= port <= 65535:
                raise ValueError('port')
            secret = config['passwordEnv']
            if not re.fullmatch(r'[A-Z][A-Z0-9_]+', secret):
                raise ValueError('password environment')
            password = os.environ[secret]
            ca = Path(config['caFile'])
            if not ca.is_absolute() or not ca.is_file():
                raise ValueError('TLS CA required')
            if kind == 'postgres':
                import psycopg
                conn = psycopg.connect(host=host, port=port, dbname=config['database'], user=config['username'],
                                       password=password, sslmode='verify-full', sslrootcert=str(ca), connect_timeout=8,
                                       options='-c statement_timeout=15000 -c default_transaction_read_only=on')
                with conn.cursor() as cur:
                    cur.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
            else:
                import pymysql
                conn = pymysql.connect(host=host, port=port, database=config['database'], user=config['username'],
                                       password=password, ssl_ca=str(ca), ssl_verify_cert=True, ssl_verify_identity=True,
                                       connect_timeout=8, read_timeout=30, write_timeout=8, charset='utf8mb4')
                with conn.cursor() as cur:
                    cur.execute('SET SESSION MAX_EXECUTION_TIME=15000')
                    cur.execute('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ')
                    cur.execute('SET SESSION TRANSACTION READ ONLY')
                    cur.execute('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY')
        yield conn
    finally:
        if conn is not None:
            try:
                conn.rollback()
            finally:
                conn.close()


def cell(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, (bytes, bytearray, memoryview)):
        raise ValueError('binary columns require a deployment projection')
    if isinstance(value, float) and not math.isfinite(value) or isinstance(value, decimal.Decimal) and not value.is_finite():
        raise ValueError('non-finite value')
    if isinstance(value, (datetime.date, datetime.datetime, datetime.time)):
        result = value.isoformat()
    elif isinstance(value, (str, int, float, decimal.Decimal, uuid.UUID)):
        result = str(value)
    else:
        raise ValueError('unsupported value type')
    if len(result.encode('utf-16-le')) // 2 > 8192:
        raise ValueError('cell limit')
    return result


def collect(request, config):
    validate(config, request)
    snapshots, cells, byte_count = [], 0, 64
    with connect(config) as conn:
        for d in config['datasets']:
            quote = '`' if config['kind'] == 'mysql' else '"'
            q = lambda value: identifier(value, quote)
            table = (q(d['schema']) + '.' if d.get('schema') else '') + q(d['table'])
            # Scope is installed by deployment, never accepted from a task or model.
            scope = d.get('rowScope')
            values = scope['values'] if scope else []
            placeholder = '?' if config['kind'] == 'sqlite' else '%s'
            where = (' WHERE ' + q(scope['column']) + ' IN (' + ','.join([placeholder] * len(values)) + ')') if scope else ''
            sql = 'SELECT ' + ','.join(q(c['source']) for c in d['columns']) + ' FROM ' + table + where + f' LIMIT {MAX_ROWS + 1}'
            rows = []
            with contextlib.closing(conn.cursor()) as cur:
                cur.execute('SELECT * FROM ' + table + ' WHERE 1=0')
                available = {c[0] for c in cur.description}
                if any(c['source'] not in available for c in d['columns']) or scope and scope['column'] not in available:
                    raise ValueError('source schema changed')
                cur.execute(sql, values)
                while True:
                    batch = cur.fetchmany(256)
                    if not batch:
                        break
                    for record in batch:
                        if len(rows) >= MAX_ROWS:
                            raise ValueError('row limit')
                        row = [cell(v) for v in record]
                        cells += len(row)
                        byte_count += len(json.dumps(row, ensure_ascii=False).encode()) + 2
                        if cells > MAX_CELLS or byte_count > MAX_BYTES:
                            raise ValueError('response limit')
                        rows.append(row)
            # Read time is NOT business coverage time. Unknown coverage stays null.
            snapshots.append({'datasetId': d['id'], 'coverageThrough': None, 'rows': rows})
    result = {'contractVersion': '1.0', 'snapshots': snapshots}
    if len(json.dumps(result, ensure_ascii=False).encode()) > MAX_BYTES:
        raise ValueError('response limit')
    return result


def main():
    try:
        config = load_config(os.environ['DATA_FOUNDATION_CONFIG'])
        raw = sys.stdin.buffer.read(131073)
        if len(raw) > 131072:
            raise ValueError('request limit')
        request = json.loads(raw)
        result = collect(request, select_source(config, request))
        print(json.dumps(result, ensure_ascii=False))
    except Exception:
        # Do not leak a DSN, SQL, credentials or source rows into platform logs.
        print('DATA_FOUNDATION_READ_FAILED', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
