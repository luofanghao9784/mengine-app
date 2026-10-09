from pathlib import Path
import os
import tempfile
import unittest
from unittest.mock import patch
from trial import instance_analysis_environment, private_write, clean_environment, TrialError

class AnalysisRestartTest(unittest.TestCase):
    def test_explicit_configuration_persists_but_restored_instance_stays_off(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            self.assertEqual({'ANALYSIS_MATERIAL_API_ENABLED':'false'},instance_analysis_environment(root))
            private_write(root/'analysis-runtime.json',{'materialApiEnabled':True})
            self.assertEqual({'ANALYSIS_MATERIAL_API_ENABLED':'true'},instance_analysis_environment(root))
            (root/'restore.json').write_text('{}')
            self.assertEqual({'ANALYSIS_MATERIAL_API_ENABLED':'false'},instance_analysis_environment(root))
    def test_invalid_and_public_configuration_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for data in [{'materialApiEnabled':'true'},{'materialApiEnabled':True,'automatic':True}]:
                private_write(root/'analysis-runtime.json',data)
                with self.assertRaises(TrialError):instance_analysis_environment(root)
            private_write(root/'analysis-runtime.json',{'materialApiEnabled':True})
            (root/'analysis-runtime.json').chmod(0o644)
            with self.assertRaises(TrialError):instance_analysis_environment(root)
    def test_parent_environment_cannot_enable_feature(self):
        with patch.dict(os.environ,{'ANALYSIS_MATERIAL_API_ENABLED':'true'}):
            self.assertNotIn('ANALYSIS_MATERIAL_API_ENABLED',clean_environment())

if __name__=='__main__':unittest.main()
