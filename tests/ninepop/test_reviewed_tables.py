import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('adapters',Path(__file__).resolve().parents[2]/'scripts/ninepop/reviewed_tables.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class TableAdapters(unittest.TestCase):
 def fixture(self):
  rows={}; base={}
  for table,(_,links) in m.ADAPTERS.items():
   rows[table]=[{'id':table+'-A',m.KEYS.get(table,'id'):table+'-A',**{col:parent+'-A' for col,parent in links},'secret':'excluded'}]
   for _,parent in links:
    if parent not in m.ADAPTERS:
     rows[parent]=[{'id':parent+'-A','store_id':'A'}]
     base[parent]={'kind':'direct','column':'store_id','stores':['A','B']}
  return {'tenantId':'synthetic','rows':rows},base
 def test_six_concrete_adapters_and_topics(self):
  b,p=self.fixture()
  for t,(topic,_) in m.ADAPTERS.items():
   with self.subTest(table=t):
    g={'reader':{t:['A','B'] for t in ([topic] if topic!='finance_sensitive' else ['finance','salary','dividend'])}}
    self.assertEqual(m.project(t,b,p,{t:['id']},'reader','A',g,'synthetic'),[{'id':t+'-A'}])
    self.assertEqual(m.project(t,b,p,{t:['id']},'reader','B',g,'synthetic'),[])
    with self.assertRaises(PermissionError):m.project(t,b,p,{t:['id']},'reader','A',{'reader':{}},'synthetic')
 def test_parent_conflict_and_missing_parent(self):
  for t,(_,links) in m.ADAPTERS.items():
   b,p=self.fixture();parent=links[-1][1]
   if parent in p:b['rows'][parent][0]['store_id']='B'
   else:b['rows'][parent]=[]
   if len(links)>1:
    self.assertEqual(m.project(t,b,p,{t:['id']},'r','A',{'r':{topic:['A'] for topic in ([m.ADAPTERS[t][0]] if m.ADAPTERS[t][0]!='finance_sensitive' else ['finance','salary','dividend'])}},'synthetic'),[])
   b['rows'][parent]=[]
   self.assertEqual(m.project(t,b,p,{t:['id']},'r','A',{'r':{topic:['A'] for topic in ([m.ADAPTERS[t][0]] if m.ADAPTERS[t][0]!='finance_sensitive' else ['finance','salary','dividend'])}},'synthetic'),[])
 def test_metadata_only_and_tenant(self):
  b,p=self.fixture();t='trial_course_vouchers';g={'r':{'service':['A']}}
  with self.assertRaises(ValueError):m.project(t,b,p,{t:['primary_file_id']},'r','A',g,'synthetic')
  with self.assertRaises(PermissionError):m.project(t,b,p,{t:['id']},'r','A',g,'other')
 def test_multihop_disagreement_blocks_allocations(self):
  b,p=self.fixture();b['rows']['dividend_participants'][0]['store_id']='B';t='dividend_payout_allocations'
  self.assertEqual(m.project(t,b,p,{t:['id']},'r','A',{'r':{'dividend':['A']}},'synthetic'),[])

 def test_real_store_key_and_attribution_not_member_current_store(self):
  b={'tenantId':'synthetic','rows':{'stores':[{'id':'A'},{'id':'B'}],
      'members':[{'id':'member','store_id':'B'}],
      'trial_course_conversions':[{'id':'old','member_id':'member','attribution_store_id':'A','converted_at':'2025-01-01'}]}}
  base={'stores':{'kind':'direct','column':'id','stores':['A','B']}}
  t='trial_course_conversions';cols={t:['id','converted_at']};g={'r':{'service':['A','B']}}
  self.assertEqual(m.project(t,b,base,cols,'r','A',g,'synthetic'),[{'id':'old','converted_at':'2025-01-01'}])
  self.assertEqual(m.project(t,b,base,cols,'r','B',g,'synthetic'),[])
 def test_internal_fee_payer_is_not_headquarters_income(self):
  t='finance_internal_management_fee_claims'
  b={'tenantId':'synthetic','rows':{'stores':[{'id':'A'},{'id':'HQ'}],t:[{'id':'fee','payer_store_id':'A','accounting_period':'2025-12','released_at':None}]}}
  p={'stores':{'kind':'direct','column':'id','stores':['A','HQ']}};g={'r':{'finance':['A','HQ']}}
  self.assertEqual(m.project(t,b,p,{t:['id','released_at']},'r','A',g,'synthetic'),[{'id':'fee','released_at':None}])
  self.assertEqual(m.project(t,b,p,{t:['id']},'r','HQ',g,'synthetic'),[])
 def test_pending_reversal_retains_status_not_claimed_success(self):
  b,p=self.fixture();t='dividend_payout_reversal_requests';b['rows'][t][0].update(status='pending',completed_at=None)
  g={'r':{'dividend':['A']}};out=m.project(t,b,p,{t:['id','status','completed_at']},'r','A',g,'synthetic')
  self.assertEqual(out[0]['status'],'pending');self.assertIsNone(out[0]['completed_at'])
  with self.assertRaises(PermissionError):m.project(t,b,p,{t:['id']},'r','A',{'r':{'finance':['A']}},'synthetic')
 def test_composite_finance_account_store_consistency(self):
  t='finance_positions';b={'tenantId':'synthetic','rows':{'stores':[{'id':'A'},{'id':'B'}],
    'finance_accounts':[{'id':'account','store_id':'B'}],t:[{'id':'pos','business_store_id':'A','finance_account_id':'account'}]}}
  p={'stores':{'kind':'direct','column':'id','stores':['A','B']},'finance_accounts':{'kind':'direct','column':'store_id','stores':['A','B']}}
  self.assertEqual(m.project(t,b,p,{t:['id']},'r','A',{'r':{'finance':['A']}},'synthetic'),[])

 def test_mixed_financial_indirect_salary_dividend_isolation(self):
  for t,(topic,_) in m.ADAPTERS.items():
   if topic!='finance_sensitive':continue
   b,p=self.fixture()
   for granted in [('finance',),('finance','salary'),('finance','dividend')]:
    with self.subTest(table=t,grants=granted):
     with self.assertRaises(PermissionError):m.project(t,b,p,{t:['id']},'r','A',{'r':{k:['A'] for k in granted}},'synthetic')
   g={'r':{'finance':['A'],'salary':['A'],'dividend':['B']}}
   with self.assertRaises(PermissionError):m.project(t,b,p,{t:['id']},'r','A',g,'synthetic')
 def test_account_holder_current_identity_does_not_set_store(self):
  b,p=self.fixture();t='finance_payment_account_holder_events'
  b['rows'][t][0]['new_holder_account_id']='person-at-B'
  g={'r':{'finance':['A','B']}}
  self.assertEqual(len(m.project(t,b,p,{t:['id']},'r','A',g,'synthetic')),1)
  self.assertEqual(m.project(t,b,p,{t:['id']},'r','B',g,'synthetic'),[])
 def test_missing_account_and_null_global_subject_stay_isolated(self):
  b,p=self.fixture();t='finance_reconciliation_subject_snapshots';b['rows'][t][0]['finance_account_id']=None
  g={'r':{k:['A'] for k in ('finance','salary','dividend')}}
  self.assertEqual(m.project(t,b,p,{t:['id']},'r','A',g,'synthetic'),[])
 def test_actual_non_id_primary_key_and_null_reversal(self):
  t='finance_income_approval_cancellations';b,p=self.fixture();row=b['rows'][t][0];del row['id']
  g={'r':{k:['A'] for k in ('finance','salary','dividend')}}
  self.assertEqual(m.project(t,b,p,{t:['approval_request_id']},'r','A',g,'synthetic'),[{'approval_request_id':t+'-A'}])
  row['reversal_ledger_entry_id']=None
  self.assertEqual(m.project(t,b,p,{t:['approval_request_id']},'r','A',g,'synthetic'),[])

 def test_order_event_nullable_paths_are_consistent_not_union(self):
  b,p=self.fixture();t='order_events';r=b['rows'][t][0];r['pending_order_id']=None;r['payment_order_id']=None
  g={'r':{'finance':['A']}}
  self.assertEqual(len(m.project(t,b,p,{t:['id']},'r','A',g,'synthetic')),1)
  r['payment_order_id']='missing'
  self.assertEqual(m.project(t,b,p,{t:['id']},'r','A',g,'synthetic'),[])
  r['payment_order_id']='payment_orders-A';b['rows']['payment_orders'][0]['store_id']='B'
  self.assertEqual(m.project(t,b,p,{t:['id']},'r','A',g,'synthetic'),[])
  r['order_id']=None;r['payment_order_id']=None
  self.assertEqual(m.project(t,b,p,{t:['id']},'r','A',g,'synthetic'),[])

 def test_real_session_purposes_do_not_leak_salary(self):
  cols=set()
  for k in ['session_service','session_pay']:
   _,_,scope,fields=m.PURPOSES[k];cols.update(fields+[scope])
  row={c:0 for c in cols};row.update(id='s',teaching_store_id='B',fee_payer_store_id='A',coach_id='c',coach_session_fee_cents=999)
  b={'tenantId':'synthetic','rows':{'session_records':[row]}};approved={'session_records':list(cols)}
  out=m.project_purpose('session_service',b,approved,'r','B',{'r':{'service':['B']}},'synthetic')
  self.assertNotIn('coach_session_fee_cents',out[0])
  with self.assertRaises(PermissionError):m.project_purpose('session_pay',b,approved,'r','A',{'r':{'service':['A']}},'synthetic')
  self.assertEqual(m.project_purpose('session_pay',b,approved,'r','A',{'r':{'salary':['A']}},'synthetic')[0]['coach_session_fee_cents'],999)
 def test_transfer_minimal_target_excludes_values_and_pending(self):
  fields=m.PURPOSES['transfer_target'][3];row={c:None for c in fields};row.update(id='t',source_store_id='A',target_store_id='B',member_id='m',status='effective',effective_at='2026-01-01',net_transfer_cents=999)
  b={'tenantId':'synthetic','asOf':'2026-02-01','rows':{'member_store_transfers':[row]}};a={'member_store_transfers':fields};g={'r':{'service':['B']}}
  self.assertNotIn('net_transfer_cents',m.project_purpose('transfer_target',b,a,'r','B',g,'synthetic')[0])
  for state in ['pending','reversed','waiting_effective']:
   row['status']=state;self.assertEqual(m.project_purpose('transfer_target',b,a,'r','B',g,'synthetic'),[])
 def test_commission_reserve_requires_salary_and_effective_transfer(self):
  t,topic,scope,fields=m.PURPOSES['transfer_commission_source'];r={c:0 for c in fields};r.update(id='r',transfer_id='t',source_store_id='A')
  b={'tenantId':'synthetic','rows':{t:[r],'member_store_transfers':[{'id':'t','status':'effective','source_store_id':'A'}]}};a={t:fields+[scope]}
  with self.assertRaises(PermissionError):m.project_purpose('transfer_commission_source',b,a,'u','A',{'u':{'finance':['A']}},'synthetic')
  g={'u':{'salary':['A']}};self.assertEqual(len(m.project_purpose('transfer_commission_source',b,a,'u','A',g,'synthetic')),1)
  b['rows']['member_store_transfers'][0]['status']='reversed'
  self.assertEqual(m.project_purpose('transfer_commission_source',b,a,'u','A',g,'synthetic'),[])

 def test_every_blocked_table_rejects_even_all_topic_reader(self):
  for table in m.BLOCKERS:
   with self.subTest(table=table):
    with self.assertRaisesRegex(PermissionError,'SOURCE_NOT_READY'):
     m.project(table,{'tenantId':'synthetic','rows':{table:[{'id':'x'}]}},{},{table:['id']},'admin','A',{'admin':{k:['A'] for k in ['finance','salary','dividend','service']}},'synthetic')
 def test_catalog_disjoint_and_purpose_columns_are_approved(self):
  self.assertFalse(set(m.BLOCKERS)&set(m.ADAPTERS))
  self.assertFalse(set(m.BLOCKERS)&{x[0] for x in m.PURPOSES.values()})
  for purpose,(table,topic,scope,fields) in m.PURPOSES.items():
   self.assertEqual(len(fields),len(set(fields)))
   self.assertNotIn('password_hash',fields)
