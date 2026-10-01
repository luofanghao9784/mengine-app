from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/local'))
import log_retention as retention
import trial


class LogRetentionTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='dreamcore-log-synthetic-')
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.clock=datetime(2026,10,1,12,0,tzinfo=timezone.utc)
        self.time_patch=patch.object(retention,'now',side_effect=lambda:self.clock)
        self.time_patch.start();self.addCleanup(self.time_patch.stop)
        self.logs=retention.Logs(self.root)

    def test_original_anchor_survives_copy_mtime_and_restart(self):
        self.logs.write('service',b'original')
        original=next((self.root/'logs').iterdir())
        name=original.name
        self.clock+=timedelta(days=29)
        content=original.read_bytes();original.unlink();original.write_bytes(content);original.chmod(0o600)
        os.utime(original,None)  # Recopying and touching cannot renew the timestamp in the immutable segment identity.
        self.logs=retention.Logs(self.root)
        self.assertTrue(original.exists())
        self.clock+=timedelta(days=1)
        self.logs.tick()
        self.assertFalse(original.exists())
        self.assertNotIn(name,[x.name for x in (self.root/'logs').iterdir()])

    def test_day_and_size_rotation_bounded_and_preserves_bytes(self):
        with patch.object(retention,'MAX_SEGMENT_BYTES',4),patch.object(retention,'MAX_TOTAL_BYTES',12),patch.object(retention,'MAX_SEGMENTS',3):
            self.logs.write('service',b'abcdefgh')
            self.assertEqual(len(self.logs.files()),2)
            self.clock+=timedelta(days=1)
            self.logs.write('service',b'ijklmnop')
            self.assertLessEqual(sum(x[2] for x in self.logs.files()),12)
            self.assertLessEqual(len(self.logs.files()),3)
            self.assertTrue(all(x[2]<=4 for x in self.logs.files()))
            self.assertEqual(b''.join(x[1].read_bytes() for x in self.logs.files()),b'efghijklmnop')

    def test_live_subprocess_pipe_crosses_day_without_copy_truncate(self):
        stream=self.logs.pipe('service')
        subprocess.run([sys.executable,'-c','import os; os.write(1,b"first-process\\n");os.write(2,b"stderr\\n")'],stdout=stream,stderr=stream,check=True)
        stream.close()
        before={p.name:p.read_bytes() for _,p,_ in self.logs.files()}
        self.clock+=timedelta(days=1)
        second=self.logs.pipe('postgres')
        subprocess.run([sys.executable,'-c','print("postgres-like-process",flush=True)'],stdout=second,stderr=second,check=True)
        self.logs.close()
        self.assertTrue(all((self.root/'logs'/name).read_bytes()==body for name,body in before.items()))
        self.assertEqual(len(self.logs.files()),2)
        self.assertIn(b'postgres-like-process',b''.join(p.read_bytes() for _,p,_ in self.logs.files()))

    def test_startup_and_running_refuse_symlink_without_touching_target(self):
        target=self.root/'untouched';target.write_bytes(b'private');target.chmod(0o600)
        link=self.root/'logs'/retention.Logs.name('service',self.clock)
        link.symlink_to(target)
        with self.assertRaises(trial.TrialError):retention.Logs(self.root)
        self.clock+=timedelta(minutes=1)
        with self.assertRaises(trial.TrialError):self.logs.tick()
        self.assertEqual(target.read_bytes(),b'private')
        link.unlink()
        (self.root/'postgres.log').symlink_to(target)
        with self.assertRaises(trial.TrialError):retention.Logs(self.root)

    def test_unknown_entries_and_hardlinks_are_never_deleted(self):
        unknown=self.root/'logs'/'business-file.txt';unknown.write_bytes(b'keep');unknown.chmod(0o600)
        with self.assertRaises(trial.TrialError):self.logs.cleanup()
        self.assertEqual(unknown.read_bytes(),b'keep');unknown.unlink()
        self.logs.write('service',b'log')
        path=self.logs.files()[0][1];os.link(path,self.root/'external-hardlink')
        with self.assertRaises(trial.TrialError):self.logs.cleanup()

    def test_legacy_birth_anchor_does_not_renew_on_migration(self):
        old=self.root/'service.log';old.write_bytes(b'old diagnostic');old.chmod(0o600)
        ancient=(self.clock-timedelta(days=31)).timestamp();os.utime(old,(ancient,ancient))
        retention.Logs(self.root)
        self.assertFalse(old.exists())
        self.assertEqual(list((self.root/'logs').iterdir()),[])


if __name__=='__main__':unittest.main()
