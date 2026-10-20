import importlib.util, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('scope',Path(__file__).resolve().parents[2]/'scripts/ninepop/history_scope.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class HistoryScope(unittest.TestCase):
 def setUp(self):
  self.rows={'payslips':[{'id':'a','store_id':'A'},{'id':'b','store_id':'B'},{'id':'h','store_id':'HQ'}], 'adjustments':[{'id':'x','parent':'a'},{'id':'y','parent':'b'},{'id':'orphan','parent':'missing'}]}
  self.p={'payslips':{'kind':'direct','column':'store_id','stores':['A','B','HQ']},'adjustments':{'kind':'relation','reviewed':True,'parent':'payslips','parentColumn':'id','column':'parent'}}
  self.g={'manager':{'salary':['A']},'finance':{'salary':['A','B','HQ'],'dividend':['A','B','HQ']}}
 def test_store_and_topic_permission(self):
  self.assertEqual([r['id'] for r in m.project('adjustments',self.rows,self.p,'A','salary','manager',self.g)],['x'])
  for store,topic in [('B','salary'),('HQ','salary'),('A','dividend')]:
   with self.assertRaises(PermissionError):m.project('adjustments',self.rows,self.p,store,topic,'manager',self.g)
  self.assertEqual(len(m.project('payslips',self.rows,self.p,'HQ','dividend','finance',self.g)),1)
 def test_orphan_unknown_and_unreviewed_fail_closed(self):
  self.assertEqual(m.resolve('adjustments',self.rows,self.p)['orphan'],set())
  self.p['adjustments']['reviewed']=False
  self.assertTrue(all(not s for s in m.resolve('adjustments',self.rows,self.p).values()))
 def test_duplicate_keys_rejected(self):
  self.rows['payslips'].append(dict(self.rows['payslips'][0]))
  with self.assertRaises(ValueError):m.resolve('adjustments',self.rows,self.p)
 def test_historical_effective_interval_not_current_store(self):
  rows={'assignments':[{'id':'old','staff':'s','store_id':'A','start':'2025-01-01','end':'2026-01-01'},{'id':'new','staff':'s','store_id':'B','start':'2026-01-01','end':None}], 'events':[{'id':'e','staff':'s','date':'2025-06-01'}]}
  policies={'assignments':{'kind':'direct','column':'store_id','stores':['A','B']},'events':{'kind':'relation','reviewed':True,'parent':'assignments','column':'staff','parentColumn':'staff','at':'date','from':'start','to':'end'}}
  self.assertEqual(m.resolve('events',rows,policies)['e'],{'A'})
  rows['assignments'][0]['end']=None
  rows['events'][0]['date']='2026-02-01'
  self.assertEqual(m.resolve('events',rows,policies)['e'],set())
 def test_revocation_and_unknown_store(self):
  self.g['manager']['salary']=[]
  with self.assertRaises(PermissionError):m.project('payslips',self.rows,self.p,'A','salary','manager',self.g)
  self.rows['payslips'][0]['store_id']='unknown'
  self.assertFalse(m.resolve('payslips',self.rows,self.p)['a'])
