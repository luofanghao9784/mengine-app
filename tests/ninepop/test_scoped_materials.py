import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('s',Path(__file__).resolve().parents[2]/'scripts/ninepop/scoped_materials.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ScopedMaterials(unittest.TestCase):
 def history(self,table):
  topic,at,cols=m.HISTORICAL[table];r={c:None for c in cols};r.update(id='x',status='effective');r[at]='2025-06-01'
  b={'tenantId':'T','rows':{table:[r]}};proof={'tenantId':'T','table':table,'id':'x','fingerprint':m.fingerprint(r),'reviewed':True,'evidence':'synthetic historical record','from':'2025-01-01','to':'2026-01-01','store':'A'}
  if table in m.SNAPSHOT_TABLES:
   b['snapshot']={'id':'snapshot-one','asOf':'2025-06-01T12:00:00+08:00'}
   proof.update(snapshotId=b['snapshot']['id'],snapshotAt=b['snapshot']['asOf'])
  return b,r,proof,{table:list(set(cols+[at]))},{'u':{t:['A','B'] for t in ['service','salary','finance']}}
 def test_all_twelve_history_tables(self):
  for table in m.HISTORICAL:
   with self.subTest(table=table):
    b,r,p,c,g=self.history(table)
    self.assertEqual(len(m.historical(table,b,'T','u','A',g,c,[p])),1)
    self.assertEqual(m.historical(table,b,'T','u','B',g,c,[p]),[])
    self.assertEqual(m.historical(table,b,'T','u','A',g,c,[]),[])
    self.assertEqual(m.historical(table,b,'T','u','A',g,c,[p,p]),[])
    p['to']='2025-06-01';self.assertEqual(m.historical(table,b,'T','u','A',g,c,[p]),[])
 def test_proof_stale_revoked_cross_tenant(self):
  t='coach_level_history';b,r,p,c,g=self.history(t)
  r['level']='changed';self.assertEqual(m.historical(t,b,'T','u','A',g,c,[p]),[])
  with self.assertRaises(PermissionError):m.historical(t,b,'T','u','A',{'u':{'finance':['A']}},c,[p])
  with self.assertRaises(PermissionError):m.historical(t,b,'other','u','A',g,c,[p])
 def test_all_eleven_references_require_exact_row_and_columns(self):
  for table,(key,topic) in m.REFERENCES.items():
   with self.subTest(table=table):
    row={key:'one','value':3};b={'tenantId':'T','rows':{table:[row]}};c={table:[key,'value']}
    grant={'reviewed':True,'fingerprint':m.fingerprint(row),'columns':[key,'value'],'topics':['finance','salary','dividend'] if topic=='finance_sensitive' else [topic]}
    g={('T','u',table,'one'):grant}
    self.assertEqual(m.reference(table,b,'T','u',[key],c,g),[{key:'one'}])
    self.assertEqual(m.reference(table,b,'T','other',[key],c,g),[])
    grant['columns']=[key]
    if table in m.MINIMAL_METADATA:
     with self.assertRaises(PermissionError):m.reference(table,b,'T','u',['value'],c,g)
    else:self.assertEqual(m.reference(table,b,'T','u',['value'],c,g),[])
    grant['fingerprint']='old';self.assertEqual(m.reference(table,b,'T','u',[key],c,g),[])
 def test_global_finance_not_ordinary_finance_or_store_scope(self):
  t='finance_reconciliation_historical_summaries';r={'id':'x'};b={'tenantId':'T','rows':{t:[r]}};g={('T','u',t,'x'):{'reviewed':True,'fingerprint':m.fingerprint(r),'columns':['id'],'topics':['finance']}}
  self.assertEqual(m.reference(t,b,'T','u',['id'],{t:['id']},g),[])
 def test_history_service_excludes_finance(self):
  t='member_courses';b,r,p,c,g=self.history(t);r['paid_amount_cents']=99;p['fingerprint']=m.fingerprint(r)
  self.assertNotIn('paid_amount_cents',m.historical(t,b,'T','u','A',g,c,[p])[0])
 def test_channel_exact_match_and_missing_grant(self):
  t='payment_channel_bill_items';gw='payment_gateway_transactions'
  r={'id':'i','bill_batch_id':'b','provider_transaction_no':'tx'}
  b={'tenantId':'T','rows':{t:[r],gw:[{'id':'g','provider_transaction_no':'tx','provider':'p','merchant_id':'m','store_id':'A'}],
   'payment_channel_bill_batches':[{'id':'b','provider':'p','merchant_id':'m','store_id':'A'}]}}
  c={t:list(r),gw:['provider_transaction_no']};g={'u':{'finance':['A']}}
  self.assertEqual(m.channel_items(b,'T','u','A',g,c),[r])
  with self.assertRaises(PermissionError):m.channel_items(b,'T','u','A',g,{t:['id'],gw:[]})
  b['rows'][gw][0]['merchant_id']='other';self.assertEqual(m.channel_items(b,'T','u','A',g,c),[])
  b['rows'][gw][0]['merchant_id']='m';b['rows'][gw].append({**b['rows'][gw][0],'id':'duplicate'})
  self.assertEqual(m.channel_items(b,'T','u','A',g,c),[])
 def test_snapshot_balance_moves_at_snapshot_not_creation_or_grant(self):
  for table in m.SNAPSHOT_TABLES:
   b,r,p,c,g=self.history(table)
   b['snapshot']={'id':'new','asOf':'2026-01-01T00:00:00+08:00'}
   p.update(snapshotId='new',snapshotAt=b['snapshot']['asOf'],store='B',**{'from':'2026-01-01','to':None})
   # Original created/granted date is still in old store's period.
   self.assertEqual(len(m.historical(table,b,'T','u','B',g,c,[p])),1)
   self.assertEqual(m.historical(table,b,'T','u','A',g,c,[p]),[])
   p['to']='2026-01-01';self.assertEqual(m.historical(table,b,'T','u','B',g,c,[p]),[])
 def test_snapshot_proof_cannot_be_replayed_for_identical_new_snapshot(self):
  for t in m.SNAPSHOT_TABLES:
   b,r,p,c,g=self.history(t);b['snapshot']['id']='another'
   self.assertEqual(m.historical(t,b,'T','u','A',g,c,[p]),[])
   del b['snapshot']
   with self.assertRaises(ValueError):m.historical(t,b,'T','u','A',g,c,[p])
 def test_snapshot_time_zone_and_no_historical_date_fallback(self):
  t='member_courses';b,r,p,c,g=self.history(t)
  b['snapshot']['asOf']='2025-06-01T00:00:00Z';p['snapshotAt']=b['snapshot']['asOf'];p['from']='2025-06-01T08:00:00+08:00'
  del r['created_at'];p['fingerprint']=m.fingerprint(r)
  self.assertEqual(len(m.historical(t,b,'T','u','A',g,c,[p])),1)
  p['from']='2025-06-01T08:00:01+08:00';self.assertEqual(m.historical(t,b,'T','u','A',g,c,[p]),[])
