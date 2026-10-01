import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('trial', Path(__file__).resolve().parents[2] / 'scripts/local/trial.py')
trial = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trial)


class LocalTrialBoundaryTest(unittest.TestCase):
    def test_nonempty_unowned_directory_is_never_initialized(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            marker = root / 'other-project-data'
            marker.write_text('keep')
            with self.assertRaises(trial.TrialError):
                trial.start(root)
            self.assertEqual(list(root.iterdir()), [marker])
            self.assertEqual(marker.read_text(), 'keep')

    def test_symlink_and_public_credential_file_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            target = root / 'target'
            target.mkdir(mode=0o700)
            link = root / 'link'
            link.symlink_to(target, target_is_directory=True)
            with self.assertRaises(trial.TrialError):
                trial.directory(link, True)
            secret = target / 'credentials.json'
            secret.write_text('{"password":"synthetic-only"}')
            secret.chmod(0o644)
            with self.assertRaises(trial.TrialError):
                trial.private_read(secret)
            secret.chmod(0o600)
            file_link = root / 'secret-link'
            file_link.symlink_to(secret)
            with self.assertRaises(trial.TrialError):
                trial.private_read(file_link)

    def test_private_atomic_write_does_not_follow_existing_symlink(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            target = root / 'untouched'
            target.write_text('keep')
            destination = root / 'accounts.json'
            destination.symlink_to(target)
            trial.private_write(destination, {'password': 'synthetic-only'})
            self.assertEqual(target.read_text(), 'keep')
            self.assertFalse(destination.is_symlink())
            self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
            self.assertEqual(trial.private_read(destination)['password'], 'synthetic-only')

    def test_inherited_production_settings_cannot_select_another_service(self):
        unsafe = {'SPRING_DATASOURCE_URL': 'other-db', 'SPRING_CONFIG_LOCATION': 'other-config',
                  'DATABASE_URL': 'other-db', 'API_PORT': '9999', 'SERVER_PORT': '9999',
                  'PGHOST': 'other-host', 'PGSERVICE': 'other-service', 'JAVA_TOOL_OPTIONS': 'other-options',
                  'PHONE_DELIVERY': 'local', 'PHONE_LOCAL_PREVIEW': 'true', 'PHONE_OUTBOX': 'other-phone-outbox',
                  'BOOTSTRAP_EMAIL': 'other-account', 'INVITATION_OUTBOX': 'other-outbox', 'MATERIAL_STORAGE_ROOT': 'other-storage', 'KNOWLEDGE_ENABLED': 'true', 'KNOWLEDGE_PARSER_ROOT': 'other-parser', 'TASK_ENABLED': 'true', 'TASK_ENGINE_TOKEN': 'other-token', 'ENGINE_BASE_URL': 'http://other-project', 'AGENT_TASK_MODE': 'live', 'AGENT_MODEL_API_KEY': 'other-key', 'AGENT_MODEL_PROVIDER': 'deepseek'}
        with patch.dict(os.environ, {**unsafe, 'PATH': '/synthetic-bin'}, clear=True):
            self.assertEqual(trial.clean_environment(), {'PATH': '/synthetic-bin'})

    def test_stop_refuses_another_worktrees_configuration_before_touching_process_state(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            trial.private_write(root / 'config.json', {'format': trial.FORMAT, 'workspace': '/another/worktree'})
            with self.assertRaises(trial.TrialError):
                trial.stop(root)
            self.assertFalse((root / 'stop-request.json').exists())
            self.assertFalse((root / 'supervisor.lock').exists())


class PhoneTrialBoundaryTest(unittest.TestCase):
    def test_phone_simulation_cannot_be_enabled_for_live_or_non_start_commands(self):
        for args in [['trial.py', 'start', '--live', '--phone-local'], ['trial.py', 'status', '--phone-local']]:
            with patch('sys.argv', args), patch.object(trial, 'start') as start:
                with self.assertRaises(trial.TrialError):
                    trial.main()
                start.assert_not_called()

    def test_phone_simulation_requires_an_explicit_start_flag(self):
        with patch('sys.argv', ['trial.py', 'start', '--phone-local']), patch.object(trial, 'start') as start:
            trial.main()
            self.assertTrue(start.call_args.kwargs['phone_local'])
        with patch('sys.argv', ['trial.py', 'start']), patch.object(trial, 'start') as start:
            trial.main()
            self.assertFalse(start.call_args.kwargs['phone_local'])
