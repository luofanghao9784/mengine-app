import importlib.util,json,hashlib,tempfile,unittest
from pathlib import Path
s=importlib.util.spec_from_file_location('p',Path(__file__).resolve().parents[2]/'scripts/ninepop/local_preflight.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Preflight(unittest.TestCase):
 def test_offline_entry_and_rejection(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);(p/'runtime').mkdir();(p/'runtime'/'x.py').write_text('pass')
   def save(n,v):
    q=p/n;q.write_text(json.dumps(v));q.chmod(0o600)
   save('readiness.json',{'status':'STAGED_DISABLED_NOT_REGISTERED','networkExecuted':False,'realCollectionExecuted':False,'existingInstallationChanged':False,'stagedCodeHashes':{'x.py':hashlib.sha256(b'pass').hexdigest()}})
   save('approved-extension.json',{k:False for k in ['enabled','cloudApplied','realCollectionAllowed','addReaders','originalDownloadAllowed']})
   t='00000000-0000-4000-8000-000000000001';save('next-connection.json',{'format':'ninepop-local-prepared-v1','tenantId':t,'enabled':False,'automaticRefresh':False,'destinationHost':'127.0.0.1','projections':[{'contractVersion':'1.0','tenantId':t,'tables':[{'name':'example','columns':['id']}]}]})
   b={'tenantId':t,'enabled':False,'accounts':[{'id':'a'}],'records':[{'readerIds':['a'],'enabled':False,'sourceACLVerified':False,'fingerprint':'fixture','sourceSnapshot':{'id':'s'}}]};save('account-version-bindings.json',b)
   result=m.check(d);self.assertFalse(result['activationReady']);self.assertEqual(result['versionBindings'],1)
   b['records'][0]['readerIds']=['unknown'];save('account-version-bindings.json',b)
   with self.assertRaises(ValueError):m.check(d)
   b['records'][0]['readerIds']=['a'];b['enabled']=True;save('account-version-bindings.json',b)
   with self.assertRaises(ValueError):m.check(d)
