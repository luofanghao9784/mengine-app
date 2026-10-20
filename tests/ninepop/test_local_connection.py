import importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
root=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('connection',root/'scripts/ninepop/local_connection.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class LocalConnection(unittest.TestCase):
 def test_disabled_install_no_network_and_reject_activation(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t)/'config.json'; tenant='00000000-0000-4000-8000-000000000001'
   c={'format':'ninepop-local-prepared-v1','tenantId':tenant,'enabled':False,'automaticRefresh':False,'destinationHost':'127.0.0.1','projections':[{'contractVersion':'1.0','tenantId':tenant,'tables':[{'name':'orders','columns':['id']}]}]}
   p.write_text(json.dumps(c));p.chmod(0o600)
   with patch('subprocess.run',side_effect=AssertionError('Network forbidden')):
    self.assertEqual(m.check(p)['status'],'INSTALLED_DISABLED')
    c['enabled']=True;p.write_text(json.dumps(c))
    with self.assertRaises(ValueError):m.check(p)
 def test_original_three_use_complete_paging(self):
  import ast
  tree=ast.parse((root/'scripts/ninepop/governance_collector.py').read_text());cols=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(x,ast.Name) and x.id=='COLUMNS' for x in n.targets))
  full=m.module('full_collector');tables=[{'name':n,'columns':c} for n,c in cols.items()];items=[{'kind':'snapshot','readOnly':1,'readAt':'synthetic'}]
  for t in tables:
   count=10001 if t['name']=='full_orders' else 0
   items.append({'kind':'count','table':t['name'],'rows':count})
   items.extend({'kind':'schema','table':t['name'],'column':c,'type':'text','nullable':'YES','comment':'','key':'PRI' if c=='id' else '', 'engine':'InnoDB'} for c in t['columns'])
   items.extend({'kind':'row','table':t['name'],'page':i//1000,'values':[str(i) if c=='id' else None for c in t['columns']]} for i in range(count))
  with patch.object(full,'query',return_value=items) as query:
   result=full.collect_config({'host':'127.0.0.1','database':'9pop_v2','tenantId':'synthetic'}, {'tenantId':'synthetic','contractVersion':'1.0','tables':tables})
  self.assertEqual(len(result['rows']['full_orders']),10001)
  self.assertEqual(result['proofs']['full_orders']['pageCounts'],[1000]*10+[1])
  self.assertEqual(query.call_count,2)
class TransportBoundary(unittest.TestCase):
 def test_disabled_connection_never_starts_ssh(self):
  transport=m.module('ssh_reader')
  with patch('subprocess.run',side_effect=AssertionError('SSH forbidden')):
   with self.assertRaises(PermissionError):transport.collect({'enabled':False,'automaticRefresh':False},'orders')
