import importlib.util,json,tempfile,hashlib,unittest
from pathlib import Path
s=importlib.util.spec_from_file_location('staged',Path(__file__).resolve().parents[2]/'scripts/ninepop/check_staged.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Staged(unittest.TestCase):
 def test_integrity_and_no_activation(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);(p/'runtime').mkdir();(p/'runtime'/'a.py').write_text('pass\n')
   r={'status':'STAGED_DISABLED_NOT_REGISTERED','networkExecuted':False,'realCollectionExecuted':False,'existingInstallationChanged':False,'stagedCodeHashes':{'a.py':hashlib.sha256(b'pass\n').hexdigest()}}
   (p/'readiness.json').write_text(json.dumps(r));x={k:False for k in ['enabled','cloudApplied','realCollectionAllowed','addReaders','originalDownloadAllowed']};(p/'approved-extension.json').write_text(json.dumps(x))
   self.assertFalse(m.check(d)['activationReady'])
   x['enabled']=True;(p/'approved-extension.json').write_text(json.dumps(x))
   with self.assertRaises(ValueError):m.check(d)
   x['enabled']=False;(p/'approved-extension.json').write_text(json.dumps(x));(p/'runtime'/'a.py').write_text('changed')
   with self.assertRaises(ValueError):m.check(d)
