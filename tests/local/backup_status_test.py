import contextlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from uuid import uuid4
from datetime import datetime, timedelta, timezone
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/local'))
import backup_status as status
import trial

class BackupObservationTest(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name);self.path=self.root/'status.json'
 def read(self):return json.loads(self.path.read_text())
 def test_no_monitoring_leaves_original_operation_unchanged(self):
  result={'status':'created','files':10}
  self.assertIs(result,status.observe(None,'create',lambda:result,lambda:self.fail('not requested')))
 def test_projection_never_includes_paths_credentials_or_table_contents(self):
  now=datetime.now(timezone.utc);source={'snapshotId':str(uuid4()),'createdAt':now.isoformat(),'expiresAt':(now+timedelta(days=30)).isoformat(),'files':{'private-path':{'bytes':123,'sha256':'private-hash'}},'tables':{'private-name':{'private-value':'private-value'}},'credentials':'secret'}
  calls=[]
  result=status.observe(self.path,'create',lambda:(calls.append(1) or {'status':'created'}),lambda:source)
  self.assertEqual([1],calls);self.assertEqual('created',result['status']);self.assertEqual('SUCCEEDED',self.read()['events'][0]['state']);self.assertEqual(123,self.read()['events'][0]['snapshot']['bytes'])
  for secret in ('private-path','private-hash','private-name','private-value','credentials','secret'):self.assertNotIn(secret,self.path.read_text())
  self.assertEqual(0o600,self.path.stat().st_mode & 0o777)
 def test_failed_restore_cannot_become_success_from_an_early_marker(self):
  with self.assertRaisesRegex(trial.TrialError,'secret-detail'):
   status.observe(self.path,'restore',lambda:(_ for _ in ()).throw(trial.TrialError('secret-detail')),lambda:self.fail('failed command must not read marker'))
  self.assertEqual('FAILED',self.read()['events'][0]['state']);self.assertIsNone(self.read()['events'][0]['snapshot']);self.assertNotIn('secret-detail',self.path.read_text())
 def test_observation_failure_and_metadata_failure_do_not_replay_or_reverse_success(self):
  calls=[]
  with patch.object(status,'write',side_effect=OSError('secret')),contextlib.redirect_stderr(io.StringIO()) as err:
   result=status.observe(self.path,'restore',lambda:(calls.append(1) or {'status':'restored_quarantined'}),lambda:(_ for _ in ()).throw(trial.TrialError('private metadata')))
  self.assertEqual([1],calls);self.assertEqual('restored_quarantined',result['status']);self.assertNotIn('secret',err.getvalue());self.assertNotIn('private metadata',err.getvalue())
 def test_partial_rotation_is_not_success(self):
  result=status.observe(self.path,'rotate',lambda:{'status':'rotated','rejected':['private-path']},lambda:None)
  self.assertEqual('rotated',result['status']);self.assertEqual('UNKNOWN',self.read()['events'][0]['state']);self.assertNotIn('private-path',self.path.read_text())
 def test_concurrent_observations_and_bounded_retention(self):
  def run(_):return status.observe(self.path,'verify',lambda:{'status':'verified'},lambda:None)
  with ThreadPoolExecutor(max_workers=6) as pool:list(pool.map(run,range(12)))
  events=self.read()['events'];self.assertEqual(12,len(events));self.assertTrue(all(e['state']=='SUCCEEDED' for e in events))
  for i in range(35):run(i)
  events=self.read()['events'];self.assertEqual(40,len(events));self.assertEqual(40,len({e['id'] for e in events}));self.assertLess(self.path.stat().st_size,65536)
 def test_unrelated_file_symlink_shared_file_and_oversize_are_not_overwritten(self):
  event={'id':str(uuid4()),'startedAt':status.timestamp()}
  for payload in ('{"business":"private"}', 'x'*65537):
   self.path.write_text(payload);self.path.chmod(0o600)
   with self.assertRaises(ValueError):status.write(self.path,event)
   self.assertEqual(payload,self.path.read_text());self.path.unlink()
  target=self.root/'private';target.write_text('keep');target.chmod(0o600);self.path.symlink_to(target)
  with self.assertRaises(ValueError):status.write(self.path,event)
  self.assertEqual('keep',target.read_text());self.path.unlink()
  os.link(target,self.path)
  with self.assertRaises(ValueError):status.write(self.path,event)
  self.path.unlink();self.path.write_text('keep');self.path.chmod(0o644)
  with self.assertRaises(ValueError):status.write(self.path,event)
  self.assertEqual('keep',self.path.read_text())
