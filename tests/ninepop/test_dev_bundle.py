import importlib.util,pathlib,tempfile,unittest,tarfile,io
spec=importlib.util.spec_from_file_location('dev_bundle',pathlib.Path(__file__).parents[2]/'scripts/ninepop/dev_bundle.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class BundleTests(unittest.TestCase):
 def test_nested_credentials_removed_without_business_data_changes(self):
  self.assertEqual(m.scrub_connection({'secret':'private','enabled':True,'source':{'password':'private','table':'orders'},'rows':[{'amount':100}]}),{'secret':'','enabled':False,'source':{'password':'','table':'orders'},'rows':[{'amount':100}]})
 def test_existing_destination_never_overwritten(self):
  with tempfile.TemporaryDirectory() as t:
   with self.assertRaisesRegex(RuntimeError,'must not exist'):m.restore(pathlib.Path(t)/'missing',pathlib.Path(t),'x')
 def test_bad_hash_does_not_create_destination(self):
  with tempfile.TemporaryDirectory() as t:
   p=pathlib.Path(t);(p/'bundle').write_bytes(b'test')
   with self.assertRaisesRegex(RuntimeError,'checksum'):m.restore(p/'bundle',p/'new','wrong')
   self.assertFalse((p/'new').exists())
 def test_archive_escape_is_rejected(self):
  with tempfile.TemporaryDirectory() as t:
   p=pathlib.Path(t);b=p/'bundle'
   with tarfile.open(b,'w:gz') as tar:
    item=tarfile.TarInfo('../escape');item.size=1;tar.addfile(item,io.BytesIO(b'x'))
   with self.assertRaisesRegex(RuntimeError,'Unsafe'):m.restore(b,p/'new',m.digest(b))
   self.assertFalse((p/'escape').exists())
