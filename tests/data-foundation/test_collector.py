import contextlib
import copy
import decimal
import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import os
import sys
import tempfile
import unittest
import uuid
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[2] / 'scripts/data-foundation/collector.py'
spec = importlib.util.spec_from_file_location('collector', MODULE)
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


class CollectorTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.file = self.root / 'source.sqlite'
        with contextlib.closing(sqlite3.connect(self.file)) as conn:
            conn.execute('CREATE TABLE sales(id TEXT, amount TEXT, note TEXT, secret TEXT)')
            conn.execute('INSERT INTO sales VALUES (?,?,?,?)', ('0001', '9007199254740993.01', None, 'excluded'))
            conn.execute('CREATE VIEW authorized_sales AS SELECT id,amount,note FROM sales')
            conn.commit()
        self.config = dict(kind='sqlite', file=str(self.file), tenantId=str(uuid.uuid4()), connectionId=str(uuid.uuid4()),
                           datasets=[dict(id=str(uuid.uuid4()), key='sales', table='authorized_sales', columns=[
                               dict(source='id', name='编号'), dict(source='amount', name='金额'), dict(source='note', name='备注')])])
        self.request = dict(contractVersion='1.0', tenantId=self.config['tenantId'], connectionId=self.config['connectionId'],
                            runId=str(uuid.uuid4()), datasets=[dict(id=self.config['datasets'][0]['id'], key='sales', columns=['编号','金额','备注'])])

    def test_readonly_view_preserves_identifiers_precision_null_and_unknown_coverage(self):
        result = collector.collect(self.request, self.config)
        self.assertEqual(result['snapshots'][0]['rows'], [['0001', '9007199254740993.01', None]])
        self.assertIsNone(result['snapshots'][0]['coverageThrough'])
        self.assertNotIn('excluded', json.dumps(result))
        with collector.connect(self.config) as conn:
            with self.assertRaises(sqlite3.OperationalError):
                conn.execute("DELETE FROM sales")
        self.assertEqual(collector.cell(decimal.Decimal('9007199254740993.01')), '9007199254740993.01')

    def test_foreign_scope_and_altered_projection_rejected_before_connect(self):
        for key in ('tenantId', 'connectionId', 'runId', 'datasets'):
            request = copy.deepcopy(self.request)
            request[key] = [] if key == 'datasets' else 'foreign'
            with patch.object(collector, 'connect') as connect:
                with self.assertRaises((ValueError, KeyError)):
                    collector.collect(request, self.config)
                connect.assert_not_called()
        request = copy.deepcopy(self.request)
        request['datasets'][0]['columns'][0] = 'secret'
        with self.assertRaises(ValueError):
            collector.collect(request, self.config)

    def test_full_refresh_reflects_changes_deletions_and_does_not_write_source(self):
        first = collector.collect(self.request, self.config)
        with contextlib.closing(sqlite3.connect(self.file)) as conn:
            conn.execute('DELETE FROM sales')
            conn.execute('INSERT INTO sales VALUES (?,?,?,?)', ('0002', '12.00', 'new', 'secret'))
            conn.commit()
        second = collector.collect(self.request, self.config)
        self.assertEqual(first['snapshots'][0]['rows'][0][0], '0001')
        self.assertEqual(second['snapshots'][0]['rows'][0][0], '0002')

    def test_limits_fail_instead_of_publishing_partial_data(self):
        for name, value in [('MAX_ROWS',0), ('MAX_CELLS',2), ('MAX_BYTES',20)]:
            with patch.object(collector, name, value):
                with self.assertRaises(ValueError):
                    collector.collect(self.request, self.config)
        with self.assertRaises(ValueError):
            collector.cell('x'*8193)
        with self.assertRaises(ValueError):
            collector.cell(b'file')

    def test_private_config_and_cli_generic_failure(self):
        config = self.root / 'config.json'
        config.write_text(json.dumps(self.config))
        config.chmod(0o644)
        with self.assertRaises(ValueError):
            collector.load_config(str(config))
        config.chmod(0o600)
        response = subprocess.run([sys.executable, str(MODULE)], input=json.dumps(self.request), text=True,
                                  capture_output=True, env={**os.environ, 'DATA_FOUNDATION_CONFIG':str(config)})
        self.assertEqual(response.returncode,0,response.stderr)
        self.assertEqual(json.loads(response.stdout)['snapshots'][0]['rows'][0][0], '0001')
        self.request['tenantId']='secret-tenant'
        response = subprocess.run([sys.executable, str(MODULE)], input=json.dumps(self.request), text=True,
                                  capture_output=True, env={**os.environ, 'DATA_FOUNDATION_CONFIG':str(config)})
        self.assertEqual(response.returncode,1)
        self.assertEqual(response.stdout,'')
        self.assertEqual(response.stderr,'DATA_FOUNDATION_READ_FAILED\n')

    def test_identifiers_are_quoted_and_source_schema_failure_is_atomic(self):
        self.assertEqual(collector.identifier('a"; DROP TABLE sales;--'), '"a""; DROP TABLE sales;--"')
        config = copy.deepcopy(self.config)
        config['datasets'][0]['columns'][0]['source'] = 'id"; DELETE FROM sales;--'
        # SQLite treats unknown double-quoted names as literals; prevent that below via metadata validation.
        with self.assertRaises(ValueError):
            collector.collect(self.request, config)

    def test_registry_dispatch_is_bound_to_enterprise_and_connection(self):
        other = copy.deepcopy(self.config)
        other['tenantId'] = str(uuid.uuid4())
        registry = {'sources': [other, self.config]}
        self.assertEqual(collector.select_source(registry, self.request), self.config)
        with self.assertRaises(ValueError):
            collector.select_source({'sources': [self.config, self.config]}, self.request)
        with self.assertRaises(ValueError):
            collector.select_source(registry, {**self.request, 'tenantId': str(uuid.uuid4())})

    def test_installed_store_scope_excludes_other_store_and_cannot_be_overridden(self):
        with sqlite3.connect(self.file) as conn:
            conn.execute('ALTER TABLE sales ADD COLUMN store_id TEXT')
            conn.execute("UPDATE sales SET store_id='store-a'")
            conn.execute("INSERT INTO sales VALUES ('0002','55',NULL,'secret','store-b')")
            conn.execute("INSERT INTO sales VALUES ('0003','66',NULL,'secret',NULL)")
        d=self.config['datasets'][0];d['table']='sales';d['rowScope']={'column':'store_id','values':['store-a']}
        result=collector.collect(self.request,self.config)
        self.assertEqual([r[0] for r in result['snapshots'][0]['rows']],['0001'])
        altered=copy.deepcopy(self.request);altered['datasets'][0]['rowScope']={'column':'store_id','values':['store-b']}
        with self.assertRaises(ValueError):collector.collect(altered,self.config)
        d['rowScope']['values']=["store-a') OR 1=1 --"]
        self.assertEqual(collector.collect(self.request,self.config)['snapshots'][0]['rows'],[])
        d['rowScope']['values']=[]
        with self.assertRaises(ValueError):collector.collect(self.request,self.config)
