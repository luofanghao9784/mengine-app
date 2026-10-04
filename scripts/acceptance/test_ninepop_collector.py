import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import json
import sys
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'local'))
from trial import collection_environment, TrialError
import ninepop_collector as c

class ReaderTest(unittest.TestCase):
 def setUp(self):
  self.config={'tenantId':'00000000-0000-4000-8000-000000000001','connectionId':'00000000-0000-4000-8000-000000000002','datasetId':'00000000-0000-4000-8000-000000000003','sshTarget':'operator@example.test'}
  self.request={'contractVersion':'1.0',**{k:self.config[k] for k in ['tenantId','connectionId']},'runId':'00000000-0000-4000-8000-000000000004','datasets':[{'id':self.config['datasetId'],'key':c.KEY,'columns':c.COLUMNS}]}
 def test_rejects_foreign_scope_before_connecting(self):
  for key in ['tenantId','connectionId']:
   with patch.object(c.subprocess,'run') as run:
    with self.assertRaises(ValueError):c.collect({**self.request,key:'other'},self.config)
    run.assert_not_called()
 def test_rejects_extra_dataset_and_columns(self):
  for ds in [[],self.request['datasets']*2,[{**self.request['datasets'][0],'columns':['secret']}]]:
   with self.assertRaises(ValueError):c.validate({**self.request,'datasets':ds},self.config)
 def test_fixed_query_and_readonly_transaction(self):
  program=c.remote_program();compile(program,'remote','exec')
  self.assertIn('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY',c.SQL)
  self.assertIn('ROLLBACK',c.SQL)
  self.assertNotIn('SELECT *',c.SQL)
  self.assertIn("meta['readonly']!=1",program)
 def test_fail_closed_no_fallback(self):
  with patch.object(c.subprocess,'run',return_value=SimpleNamespace(returncode=1,stdout='private error',stderr='private')):
   with self.assertRaises(ValueError):c.collect(self.request,self.config)
 def test_valid_response_contract_and_ssh_options(self):
  data={'coverageThrough':'2026-10-04T00:00:00Z','rows':[['2026-10-03','合成门店','2','100','1','50']]}
  with patch.object(c.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=json.dumps(data))) as run:
   result=c.collect(self.request,self.config)
   self.assertEqual(result['snapshots'][0]['rows'],data['rows'])
   args=run.call_args.args[0];self.assertIn('StrictHostKeyChecking=yes',args)
 def test_bad_shape_rejected(self):
  with patch.object(c.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=json.dumps({'coverageThrough':'2026-10-04T00:00:00Z','rows':[['private']]}))):
   with self.assertRaises(ValueError):c.collect(self.request,self.config)
 def test_deployment_config_rejects_arbitrary_environment(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'config.json';p.write_text(json.dumps({'executable':'/bin/true','DATABASE_URL':'bad'}));p.chmod(0o600)
   with self.assertRaises(TrialError):collection_environment(p)
 def test_private_executable_only(self):
  with tempfile.TemporaryDirectory() as d:
   executable=Path(d)/'reader';executable.write_text('#!/bin/sh\nexit 1\n');executable.chmod(0o700)
   p=Path(d)/'config.json';p.write_text(json.dumps({'executable':str(executable)}));p.chmod(0o600)
   self.assertEqual(collection_environment(p),{'DREAMCORE_COLLECTION_EXECUTABLE':str(executable)})
   executable.chmod(0o777)
   with self.assertRaises(TrialError):collection_environment(p)

if __name__=='__main__':unittest.main()
