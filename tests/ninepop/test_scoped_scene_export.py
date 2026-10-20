import unittest,uuid
from scene_fixture import fixture
from scoped_scene_export import export

class ExportTest(unittest.TestCase):
 def setUp(self): self.ids=[str(uuid.uuid4()) for _ in range(3)]
 def test_source_scope_and_history_quarantine(self):
  e=fixture(*self.ids);a={a['id']:a for a in e['assets']}
  self.assertEqual(a['salary-a']['rows'],[['a','100']])
  self.assertEqual(a['salary-b']['governance']['allowedActors'],[self.ids[1]])
  self.assertEqual(a['dividend-a']['governance']['allowedActors'],[self.ids[1]])
  self.assertEqual(e['isolated'],[{'sourceId':'history-unknown','reason':'NO_PROVEN_ROWS'}])
 def test_version_and_acl_changes_invalidate_export(self):
  a,b,c=[fixture(*self.ids,v) for v in ['1','2','revoked']]
  self.assertEqual(a,fixture(*self.ids))
  self.assertEqual(len({x['revision'] for x in [a,b,c]}),3)
  self.assertEqual(c['assets'][0]['governance']['allowedActors'],[self.ids[1]])
  self.assertEqual(b['assets'][0]['governance']['sourceVersion'],2)
 def test_wrong_tenant_missing_version_and_unknown_scope_fail_closed(self):
  with self.assertRaises(PermissionError):export({'tenantId':self.ids[1]}, {},{},[],self.ids[0])
  with self.assertRaises(ValueError):export({'tenantId':self.ids[0]}, {},{},[],self.ids[0])
  e=export({'tenantId':self.ids[0],'snapshot':{'version':1}}, {},{},[{'id':'x','purpose':'unknown','store':'A'}],self.ids[0])
  self.assertEqual(e['assets'],[])
