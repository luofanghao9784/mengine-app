import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/local'))
import trial

class WeKnoraRuntimeTest(unittest.TestCase):
    def test_private_opt_in_and_restore_gate(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.assertEqual(trial.instance_weknora_environment(root), {'WEKNORA_ENABLED': 'false'})
            config = {'enabled': True, 'url': 'http://127.0.0.1:54630', 'apiKey': 'synthetic', 'rerankModelId': 'model-1'}
            path = root / 'weknora-runtime.json'
            trial.private_write(path, config)
            self.assertEqual(trial.instance_weknora_environment(root)['WEKNORA_ENABLED'], 'true')
            path.chmod(0o644)
            with self.assertRaises(trial.TrialError): trial.instance_weknora_environment(root)
            path.chmod(0o600)
            for url in ('http://example.test', 'https://user:pass@example.test', 'https://example.test/path', 'https://example.test?secret=1'):
                trial.private_write(path, dict(config, url=url))
                with self.assertRaises(trial.TrialError): trial.instance_weknora_environment(root)
            trial.private_write(path, config)
            (root / 'restore.json').write_text('{}')
            self.assertEqual(trial.instance_weknora_environment(root), {'WEKNORA_ENABLED': 'false'})

if __name__ == '__main__': unittest.main()
