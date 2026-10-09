from pathlib import Path
import os
import tempfile
import unittest
from unittest.mock import patch
from trial import instance_briefing_environment, private_write, clean_environment, TrialError
class BriefingRestartTest(unittest.TestCase):
    def test_explicit_enable_and_restore_off(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            self.assertEqual({'BRIEFING_DAILY_ENABLED':'false'},instance_briefing_environment(root))
            private_write(root/'briefing-runtime.json',{'dailyEnabled':True})
            self.assertEqual({'BRIEFING_DAILY_ENABLED':'true'},instance_briefing_environment(root))
            (root/'restore.json').write_text('{}')
            self.assertEqual({'BRIEFING_DAILY_ENABLED':'false'},instance_briefing_environment(root))
    def test_invalid_and_inherited_configuration_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            private_write(root/'briefing-runtime.json',{'dailyEnabled':'true'})
            with self.assertRaises(TrialError):instance_briefing_environment(root)
        with patch.dict(os.environ,{'BRIEFING_DAILY_ENABLED':'true'}):
            self.assertNotIn('BRIEFING_DAILY_ENABLED',clean_environment())
if __name__=='__main__':unittest.main()
