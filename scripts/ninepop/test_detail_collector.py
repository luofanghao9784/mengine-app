import copy
import json
import unittest
from unittest.mock import patch
import uuid
import detail_collector as c

class DetailCollectorTest(unittest.TestCase):
 def setUp(self):
  self.cfg={'tenantId':str(uuid.uuid4()),'connectionId':str(uuid.uuid4()),'sshTarget':'ubuntu@139.155.42.35','datasetIds':{key:str(uuid.uuid4()) for key in c.DEFINITIONS}}
  self.req={'contractVersion':'1.0','tenantId':self.cfg['tenantId'],'connectionId':self.cfg['connectionId'],'runId':str(uuid.uuid4()),'datasets':[{'id':self.cfg['datasetIds'][k],'key':k,'columns':v[2]} for k,v in c.DEFINITIONS.items()]}
  self.data={'coverageThrough':'2026-10-05T00:00:00Z','datasets':{k:[['']*len(v[2])] for k,v in c.DEFINITIONS.items()}}
 def test_fixed_readonly_snapshot(self):
  sql=c.sql();self.assertIn('WITH CONSISTENT SNAPSHOT, READ ONLY',sql);self.assertTrue(sql.endswith('ROLLBACK;\n'))
  for token in ('UPDATE ','DELETE ','INSERT ','LIMIT ','phone','face_file','voucher','password'):
   self.assertNotIn(token,sql)
 def test_scope_rejected_before_ssh(self):
  for key in ('tenantId','connectionId'):
   req=copy.deepcopy(self.req);req[key]=str(uuid.uuid4())
   with patch.object(c.subprocess,'run') as run:
    with self.assertRaises(ValueError): c.collect(req,self.cfg)
    run.assert_not_called()
 def test_columns_id_and_host_immutable(self):
  for change in ('columns','id','host'):
   req=copy.deepcopy(self.req);cfg=copy.deepcopy(self.cfg)
   if change=='host':cfg['sshTarget']='ubuntu@other.example'
   else:req['datasets'][0][change]=[] if change=='columns' else str(uuid.uuid4())
   with self.assertRaises(ValueError):c.validate(req,cfg)
 def test_no_duplicate_or_missing_datasets(self):
  for datasets in (self.req['datasets'][:-1],[self.req['datasets'][0]]*4):
   req={**self.req,'datasets':datasets}
   with self.assertRaises(ValueError):c.validate(req,self.cfg)
 def test_request_order_is_irrelevant(self):
  req={**self.req,'datasets':list(reversed(self.req['datasets']))};c.validate(req,self.cfg)
  self.assertEqual(c.result(req,self.cfg,self.data)['snapshots'][0]['datasetId'],req['datasets'][0]['id'])
 def test_private_protocol_success(self):
  process=type('Result',(),{'returncode':0,'stdout':json.dumps(self.data)})()
  with patch.object(c.subprocess,'run',return_value=process) as run:
   output=c.collect(self.req,self.cfg)
   self.assertEqual(4,len(output['snapshots']));self.assertIn('StrictHostKeyChecking=yes',run.call_args.args[0])
 def test_shape_type_and_result_scope_rejected(self):
  for mode in ('missing','width','type','long'):
   data=copy.deepcopy(self.data);key=next(iter(c.DEFINITIONS))
   if mode=='missing':del data['datasets'][key]
   if mode=='width':data['datasets'][key][0].pop()
   if mode=='type':data['datasets'][key][0][0]=1
   if mode=='long':data['datasets'][key][0][0]='x'*501
   with self.assertRaises(ValueError):c.result(self.req,self.cfg,data)
 def test_overflow_fails_without_truncation(self):
  with patch.object(c,'MAX_CELLS',1):
   with self.assertRaises(ValueError):c.result(self.req,self.cfg,self.data)
 def test_source_failure_returns_no_snapshots(self):
  with patch.object(c.subprocess,'run',return_value=type('Result',(),{'returncode':1,'stdout':'private failure'})()):
   with self.assertRaises(ValueError):c.collect(self.req,self.cfg)
if __name__=='__main__':unittest.main()
