from pathlib import Path
import tempfile
import unittest
from trial import instance_experience_environment, private_write, TrialError

class ExperienceRestartTest(unittest.TestCase):
    def test_explicit_switches_persist_and_restore_does_not_enable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual({}, instance_experience_environment(root))
            private_write(root / 'experience-runtime.json', {
                'intakeEnabled': True, 'analysisEnabled': True, 'generalizationEnabled': False})
            self.assertEqual({'EXPERIENCE_INTAKE_ENABLED': 'true',
                'EXPERIENCE_ANALYSIS_ENABLED': 'true',
                'EXPERIENCE_GENERALIZATION_ENABLED': 'false'}, instance_experience_environment(root))
            (root / 'restore.json').write_text('{}')
            self.assertEqual({}, instance_experience_environment(root))

    def test_invalid_or_public_configuration_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for value in [{}, {'intakeEnabled': 'true', 'analysisEnabled': True, 'generalizationEnabled': True}]:
                private_write(root / 'experience-runtime.json', value)
                with self.assertRaises(TrialError):
                    instance_experience_environment(root)
            private_write(root / 'experience-runtime.json', {
                'intakeEnabled': True, 'analysisEnabled': True, 'generalizationEnabled': True})
            (root / 'experience-runtime.json').chmod(0o644)
            with self.assertRaises(TrialError):
                instance_experience_environment(root)

if __name__ == '__main__':
    unittest.main()
