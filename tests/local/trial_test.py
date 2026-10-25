import importlib.util
import os
from pathlib import Path
import tempfile
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/local'))

spec = importlib.util.spec_from_file_location('trial', Path(__file__).resolve().parents[2] / 'scripts/local/trial.py')
trial = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trial)


class LocalTrialBoundaryTest(unittest.TestCase):
    def test_explicit_live_scene_binding_is_forwarded_to_supervisor(self):
        tenant = '11111111-1111-4111-8111-111111111111'
        with patch('sys.argv', ['trial.py', 'start', '--live', '--enable-live', '--scene-tenant', tenant]), patch.object(trial, 'start') as start:
            trial.main()
            self.assertEqual(start.call_args.kwargs['scene_tenant'], tenant)
            self.assertTrue(start.call_args.kwargs['enable_live'])

    def test_independent_platform_initialization_ignores_legacy_customer_roles(self):
        seen=[]
        def query(statement):
            seen.append(statement)
            return 'platform_accounts' if 'to_regclass' in statement else '0'
        self.assertFalse(trial.platform_initialized(query))
        self.assertFalse(any('platform_roles' in s for s in seen))
        self.assertTrue(trial.platform_initialized(lambda q: 'platform_accounts' if 'to_regclass' in q else '1'))
        self.assertFalse(trial.platform_initialized(lambda q: ''))

    def test_platform_login_accepts_new_and_old_private_formats_without_customer_conversion(self):
        self.assertEqual(trial.platform_login({'loginName':'new@example.test','password':'synthetic'}), 'new@example.test')
        self.assertEqual(trial.platform_login({'email':'legacy@example.test','password':'synthetic'}), 'legacy@example.test')
        self.assertEqual(trial.platform_login({'loginName':'new@example.test','email':'legacy@example.test','password':'synthetic'}), 'new@example.test')
        with self.assertRaises(trial.TrialError):trial.platform_login({'password':'synthetic'})

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
                  'BOOTSTRAP_EMAIL': 'other-account', 'INVITATION_OUTBOX': 'other-outbox', 'MATERIAL_STORAGE_ROOT': 'other-storage', 'BACKUP_STATUS_FILE': 'other-backup', 'BACKUP_STATUS_STALE_SECONDS': '60', 'OPERATIONS_TIME_ZONE': 'other-zone', 'KNOWLEDGE_ENABLED': 'true', 'KNOWLEDGE_PARSER_ROOT': 'other-parser', 'TASK_ENABLED': 'true', 'TASK_ENGINE_TOKEN': 'other-token', 'ENGINE_BASE_URL': 'http://other-project', 'AGENT_TASK_MODE': 'live', 'AGENT_MODEL_API_KEY': 'other-key', 'AGENT_MODEL_PROVIDER': 'deepseek'}
        unsafe.update({'PLATFORM_COOKIE_NAME':'other-platform','COMPANY_INFORMATION_ENABLED':'true',
                       'COLLECTION_EXECUTABLE':'/other/collector','EXPERIENCE_ENABLED':'true',
                       'GENERAL_EXPERIENCE_ENABLED':'true'})
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


class BriefingTrialBoundaryTest(unittest.TestCase):
    def test_automatic_generation_requires_explicit_private_config(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch.dict(os.environ, {'BRIEFING_AUTOMATIC_ENABLED': 'true'}):
                self.assertNotIn('BRIEFING_AUTOMATIC_ENABLED', trial.instance_briefing_environment(root))
            saved = root / 'briefing-runtime.json'
            trial.private_write(saved, {'dailyEnabled': True})
            self.assertEqual(trial.instance_briefing_environment(root), {'BRIEFING_DAILY_ENABLED': 'true'})
            for enabled in (True, False):
                trial.private_write(saved, {'dailyEnabled': True, 'automaticEnabled': enabled})
                self.assertEqual(trial.instance_briefing_environment(root), {'BRIEFING_DAILY_ENABLED': 'true', 'BRIEFING_AUTOMATIC_ENABLED': str(enabled).lower()})
            trial.private_write(root / 'restore.json', {})
            self.assertEqual(trial.instance_briefing_environment(root), {'BRIEFING_DAILY_ENABLED': 'false'})

    def test_automatic_generation_rejects_invalid_or_public_config(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            saved = root / 'briefing-runtime.json'
            for value in [{'automaticEnabled': True}, {'dailyEnabled': True, 'automaticEnabled': 'true'}, {'dailyEnabled': True, 'other': True}]:
                trial.private_write(saved, value)
                with self.assertRaises(trial.TrialError): trial.instance_briefing_environment(root)
            trial.private_write(saved, {'dailyEnabled': True, 'automaticEnabled': True})
            saved.chmod(0o644)
            with self.assertRaises(trial.TrialError): trial.instance_briefing_environment(root)


class PresentationTrialBoundaryTest(unittest.TestCase):
    def test_platform_capabilities_are_private_explicit_and_quarantined_on_restore(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch.dict(os.environ, {'DREAMCORE_TASKS_PPT_RENDERER_ENABLED': 'true'}):
                self.assertEqual(set(trial.instance_platform_capabilities(root).values()), {'false'})
            saved = root / 'capabilities-runtime.json'
            trial.private_write(saved, {'presentationEnabled': True, 'governanceDispatchEnabled': False})
            self.assertEqual(trial.instance_platform_capabilities(root), {
                'DREAMCORE_TASKS_PPT_RENDERER_ENABLED': 'true',
                'DREAMCORE_TASKS_ARTIFACT_TRANSFER_ENABLED': 'true',
                'DREAMCORE_GOVERNANCE_DISPATCH_ENABLED': 'false'})
            saved.chmod(0o644)
            with self.assertRaises(trial.TrialError): trial.instance_platform_capabilities(root)
            saved.chmod(0o600)
            trial.private_write(saved, {'presentationEnabled': True, 'governanceDispatchEnabled': 'true'})
            with self.assertRaises(trial.TrialError): trial.instance_platform_capabilities(root)
            trial.private_write(root / 'restore.json', {})
            self.assertEqual(set(trial.instance_platform_capabilities(root).values()), {'false'})

    def test_fixed_renderer_requires_explicit_private_config_and_stays_off_on_restore(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch.dict(os.environ, {'AGENT_PPT_RENDERER_ENABLED': 'true'}):
                self.assertEqual(trial.instance_presentation_environment(root), {'AGENT_PPT_RENDERER_ENABLED': 'false'})
            saved = root / 'presentation-runtime.json'
            trial.private_write(saved, {'enabled': True})
            self.assertEqual(trial.instance_presentation_environment(root), {'AGENT_PPT_RENDERER_ENABLED': 'true'})
            trial.private_write(root / 'restore.json', {})
            self.assertEqual(trial.instance_presentation_environment(root), {'AGENT_PPT_RENDERER_ENABLED': 'false'})

    def test_renderer_rejects_untrusted_config_and_arbitrary_settings(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            saved = root / 'presentation-runtime.json'
            for value in [{'enabled': 'true'}, {'enabled': True, 'executable': '/tmp/other'}, {}]:
                trial.private_write(saved, value)
                with self.assertRaises(trial.TrialError): trial.instance_presentation_environment(root)
            trial.private_write(saved, {'enabled': True})
            saved.chmod(0o644)
            with self.assertRaises(trial.TrialError): trial.instance_presentation_environment(root)
            saved.unlink()
            target = root / 'target.json'
            trial.private_write(target, {'enabled': True})
            saved.symlink_to(target)
            with self.assertRaises(trial.TrialError): trial.instance_presentation_environment(root)


class PhoneTrialBoundaryTest(unittest.TestCase):
    def test_phone_simulation_cannot_be_enabled_for_live_or_non_start_commands(self):
        for args in [['trial.py', 'start', '--live', '--phone-local'], ['trial.py', 'status', '--phone-local']]:
            with patch('sys.argv', args), patch.object(trial, 'start') as start:
                with self.assertRaises(trial.TrialError):
                    trial.main()
                start.assert_not_called()

    def test_explicit_manual_live_preserves_local_phone_without_real_sms(self):
        with patch('sys.argv', ['trial.py', 'start', '--live', '--enable-live', '--phone-local']), patch.object(trial, 'start') as start:
            trial.main()
            self.assertTrue(start.call_args.kwargs['enable_live'])
            self.assertTrue(start.call_args.kwargs['phone_local'])
        for args in [['trial.py','start','--enable-live'], ['trial.py','status','--live','--enable-live'],
                     ['trial.py','start','--live','--enable-live','--reconnect-live']]:
            with patch('sys.argv', args), patch.object(trial, 'start') as start:
                with self.assertRaises(trial.TrialError): trial.main()
                start.assert_not_called()

    def test_phone_simulation_requires_an_explicit_start_flag(self):
        with patch('sys.argv', ['trial.py', 'start', '--phone-local']), patch.object(trial, 'start') as start:
            trial.main()
            self.assertTrue(start.call_args.kwargs['phone_local'])
        with patch('sys.argv', ['trial.py', 'start']), patch.object(trial, 'start') as start:
            trial.main()
            self.assertFalse(start.call_args.kwargs['phone_local'])
