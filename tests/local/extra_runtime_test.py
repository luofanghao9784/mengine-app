import sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/local'))
import trial
class ExtraRuntimeTest(unittest.TestCase):
 def test_opt_in_validation_and_restore(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder)
   self.assertEqual(trial.instance_extra_environment(root),({'DOCLING_ENABLED':'false'},{'AGENT_LANGFUSE_ENABLED':'false'}))
   value={'enabled':True,'baseUrl':'http://127.0.0.1:54640','publicKey':'synthetic','secretKey':'synthetic'}
   trial.private_write(root/'langfuse-runtime.json',value)
   self.assertEqual(trial.instance_extra_environment(root)[1]['AGENT_LANGFUSE_ENABLED'],'true')
   for url in ['http://example.test','https://user:pass@example.test','https://example.test/path']:
    trial.private_write(root/'langfuse-runtime.json',dict(value,baseUrl=url))
    with self.assertRaises(trial.TrialError):trial.instance_extra_environment(root)
   (root/'restore.json').write_text('{}')
   self.assertEqual(trial.instance_extra_environment(root)[1],{'AGENT_LANGFUSE_ENABLED':'false'})
if __name__=='__main__':unittest.main()
