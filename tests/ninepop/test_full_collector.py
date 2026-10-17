import importlib.util,json,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('collector',Path(__file__).resolve().parents[2]/'scripts/ninepop/full_collector.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
T=[{'name':'facts','columns':['id','amount']}]
def items(n):
 return [{'kind':'snapshot','readOnly':1,'readAt':'synthetic'}, {'kind':'count','table':'facts','rows':n}]+[{'kind':'schema','table':'facts','column':c,'type':'text','nullable':'YES','comment':'','key':'PRI' if c=='id' else '', 'engine':'InnoDB'} for c in T[0]['columns']]+[{'kind':'row','table':'facts','page':i//1000,'values':[str(i).zfill(6),None if i==0 else '123456789012345678.123456']} for i in range(n)]
class CompleteSource(unittest.TestCase):
 def test_complete_pages_null_and_exact_decimal(self):
  d=m.assemble({'tenantId':'synthetic'},T,items(12001));self.assertEqual(len(d['rows']['facts']),12001);self.assertEqual(d['proofs']['facts']['pageCounts'],[1000]*12+[1]);self.assertIsNone(d['rows']['facts'][0]['amount']);self.assertEqual(d['rows']['facts'][1]['amount'],'123456789012345678.123456')
 def test_missing_duplicate_out_of_order_and_count_reject(self):
  for change in [lambda x:x.pop(),lambda x:x[-1].update(values=x[-2]['values']),lambda x:x[-1].update(page=0),lambda x:x[1].update(rows=1000000)]:
   x=items(1001);change(x)
   with self.assertRaises(ValueError):m.assemble({'tenantId':'synthetic'},T,x)
 def test_plan_is_not_snapshot_and_shrink_is_complete(self):
  p=m.inspect(items(2500),T);q=m.export_sql(T,p);self.assertEqual(sum('START TRANSACTION' in x for x in q),1);self.assertEqual(q[-1],'ROLLBACK');self.assertIn('OFFSET 3000',q[-2]);self.assertEqual(len(m.assemble({'tenantId':'s'},T,items(3))['rows']['facts']),3)
 def test_projection_tenant_and_sql_rejection(self):
  for x in [{'tenantId':'other','contractVersion':'1.0','tables':T},{'tenantId':'s','contractVersion':'1.0','tables':[{'name':'x;DROP','columns':['id']}]}]:
   with self.assertRaises(ValueError):m.projections(x,'s')
 def test_explicit_empty_policy_preserves_null_and_schema(self):
  t=[{**T[0],'allowEmptyColumns':['amount']}];d=m.assemble({'tenantId':'s'},t,items(1));self.assertTrue(d['tables'][0]['columns'][1]['allowEmpty']);self.assertIsNone(d['rows']['facts'][0]['amount'])
  with self.assertRaises(ValueError):m.projections({'tenantId':'s','contractVersion':'1.0','tables':[{**T[0],'allowEmptyColumns':['outside']}]},'s')
 def test_empty_and_readonly(self):
  self.assertEqual(m.assemble({'tenantId':'s'},T,items(0))['proofs']['facts']['pageCounts'],[])
  x=items(1);x[0]['readOnly']=0
  with self.assertRaises(ValueError):m.assemble({'tenantId':'s'},T,x)
if __name__=='__main__':unittest.main()
