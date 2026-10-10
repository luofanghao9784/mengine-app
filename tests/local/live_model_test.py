import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/local'))
import trial
import live_model


class LiveModelBoundaryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.workspace = Path(self.temp.name)
        self.path = self.workspace / '.local/model-private/bailian.json'
        self.value = {'format': live_model.FORMAT, 'workspace': str(self.workspace), 'provider': 'bailian',
                      'model': live_model.DEFAULT_MODEL, 'workspaceId': 'synthetic-workspace',
                      'apiKey': 'synthetic-key-never-sent-to-cloud'}
        for module in (trial, live_model):
            patcher = patch.object(module, 'WORKSPACE', self.workspace)
            patcher.start()
            self.addCleanup(patcher.stop)

    def save(self):
        live_model.owned_path(self.path, True)
        trial.private_write(self.path, self.value)

    def build_marker(self):
        marker = self.workspace / 'engine/dist/runtime/model-config.js'
        marker.parent.mkdir(parents=True)
        marker.write_text('synthetic marker only')

    def test_missing_key_has_actionable_error_without_creating_instance(self):
        with self.assertRaisesRegex(trial.TrialError, 'model:configure'):
            trial.start(self.workspace / 'instance', self.path)
        self.assertFalse((self.workspace / 'instance').exists())

    def test_private_configuration_is_bound_to_project_and_model(self):
        self.save()
        self.assertEqual(live_model.load(self.path), self.value)
        for changed in [{'workspace': '/another/project'}, {'model': 'latest'}, {'provider': 'unknown'},
                        {'workspaceId': 'https://elsewhere.invalid/'}, {'extra': 'setting'},
                        {'apiKey': 'key\nsecret'}, {'model': []}]:
            with self.subTest(changed=tuple(changed)):
                trial.private_write(self.path, {**self.value, **changed})
                with self.assertRaises(trial.TrialError):
                    live_model.load(self.path)

    def test_public_or_symlink_credentials_and_parent_are_rejected(self):
        self.save()
        self.path.chmod(0o644)
        with self.assertRaises(trial.TrialError): live_model.load(self.path)
        self.path.chmod(0o600)
        alias = self.path.with_name('alias.json')
        alias.symlink_to(self.path)
        with self.assertRaises(trial.TrialError): live_model.load(alias)
        self.path.parent.chmod(0o755)
        with self.assertRaises(trial.TrialError): live_model.load(self.path)

    def test_symlink_local_directory_and_external_config_are_rejected(self):
        outside = self.workspace / 'outside'
        outside.mkdir()
        (self.workspace / '.local').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(trial.TrialError): live_model.owned_path(self.path, True)
        with self.assertRaises(trial.TrialError): live_model.load(outside / 'key.json')
        self.assertEqual(list(outside.iterdir()), [])

    def test_secret_is_only_passed_to_engine_and_ambient_settings_cannot_activate_model(self):
        inherited = {'AGENT_MODEL_API_KEY': 'other-project-secret', 'AGENT_TASK_MODE': 'live',
                     'AGENT_PUBLIC_WEB_ENABLED': 'true', 'AGENT_CANDIDATE_TRIALS_ENABLED': 'true',
                     'AGENT_PLATFORM_URL': 'https://other-project.invalid', 'PATH': '/local-bin'}
        with patch.dict(os.environ, inherited, clear=True):
            off_api, off_engine = trial.model_environments(None, 23001, 'synthetic-service-token', 23002)
            self.assertEqual(off_api, {'AGENT_TASK_MODE': 'off'})
            self.assertNotIn('AGENT_MODEL_API_KEY', off_engine)
            api, engine = trial.model_environments(self.value, 23001, 'synthetic-service-token', 23002)
            self.assertEqual(api, {'AGENT_TASK_MODE': 'live'})
            self.assertEqual(engine['AGENT_MODEL_API_KEY'], self.value['apiKey'])
            self.assertEqual(engine['AGENT_PLATFORM_URL'], 'http://127.0.0.1:23002')
            self.assertNotIn('AGENT_PUBLIC_WEB_ENABLED', engine)
            self.assertNotIn('AGENT_CANDIDATE_TRIALS_ENABLED', engine)
            self.assertNotIn(self.value['apiKey'], json.dumps({**trial.clean_environment(), **api}))
            self.assertNotIn('other-project-secret', json.dumps(engine))

    def test_explicit_automatic_work_overrides_manual_mode_without_ambient_activation(self):
        with self.assertRaises(trial.TrialError):
            trial.model_environments(None, 23001, 'synthetic', 23002, automatic_work=True)
        api, _ = trial.model_environments(self.value, 23001, 'synthetic', 23002, True, automatic_work=True)
        for key in ('COMPANY_INFORMATION_ENABLED', 'EXPERIENCE_INTAKE_ENABLED',
                    'EXPERIENCE_ANALYSIS_ENABLED', 'EXPERIENCE_GENERALIZATION_ENABLED',
                    'BRIEFING_AUTOMATIC_ENABLED', 'ONGOING_PLANS_ENABLED'):
            self.assertEqual(api[key], 'true')

    def test_default_start_does_not_load_model_file(self):
        root = self.workspace / 'instance'
        root.mkdir(mode=0o700)
        (root / 'unowned').write_text('keep')
        with patch.object(live_model, 'load') as load:
            with self.assertRaises(trial.TrialError): trial.start(root)
            load.assert_not_called()
        self.assertEqual((root / 'unowned').read_text(), 'keep')

    def test_instance_directory_cannot_contain_credentials(self):
        for root in [self.workspace, self.workspace / '.local', self.path.parent, self.path.parent / 'data']:
            with self.subTest(directory=root):
                with self.assertRaisesRegex(trial.TrialError, '模型私有配置'):
                    trial.start(root)

    def test_existing_off_instance_cannot_turn_on_paid_plans(self):
        trial.validate_instance_mode({}, 'off')
        trial.validate_instance_mode({'agentMode': 'live'}, 'live')
        for settings, mode in [({}, 'live'), ({'agentMode': 'live'}, 'off'), ({'agentMode': 'invalid'}, 'off')]:
            with self.assertRaises(trial.TrialError): trial.validate_instance_mode(settings, mode)

    def test_explicit_existing_live_acceptance_is_not_a_restore_bypass(self):
        for previous in ['off', 'live']:
            trial.validate_instance_mode({'agentMode': previous}, 'live', enable_live=True)
        for settings, mode, restored, reconnect in [({}, 'live', False, False),
                ({'agentMode': 'off'}, 'off', False, False),
                ({'agentMode': 'off'}, 'live', True, False),
                ({'agentMode': 'off'}, 'live', True, True)]:
            with self.assertRaises(trial.TrialError):
                trial.validate_instance_mode(settings, mode, restored, reconnect, enable_live=True)

    def test_manual_acceptance_keeps_background_dispatch_off_and_model_key_private(self):
        api, engine = trial.model_environments(self.value, 23001, 'synthetic-service-token', 23002, True)
        self.assertEqual(api['AGENT_TASK_MODE'], 'live')
        for field in ['COMPANY_INFORMATION_ENABLED', 'EXPERIENCE_INTAKE_ENABLED',
                      'EXPERIENCE_ANALYSIS_ENABLED', 'EXPERIENCE_GENERALIZATION_ENABLED',
                      'BRIEFING_AUTOMATIC_ENABLED', 'ONGOING_PLANS_ENABLED']:
            self.assertEqual(api[field], 'false')
        self.assertNotIn(self.value['apiKey'], json.dumps(api))
        self.assertEqual(engine['AGENT_MODEL_API_KEY'], self.value['apiKey'])
        with patch.dict(os.environ, {'BRIEFING_AUTOMATIC_ENABLED':'true', 'ONGOING_PLANS_ENABLED':'true'}, clear=True):
            self.assertEqual(trial.clean_environment(), {})

    def test_reconnect_requires_explicit_live_and_verified_restore(self):
        trial.validate_instance_mode({}, 'live', restored=True, reconnect_live=True)
        for mode, restored, explicit in [('live', True, False), ('live', False, True), ('off', True, True)]:
            with self.assertRaises(trial.TrialError):
                trial.validate_instance_mode({}, mode, restored, explicit)

    def test_reconnect_cannot_bypass_activation(self):
        import backup_recovery
        root = self.workspace / 'restored'
        root.mkdir(mode=0o700)
        (root / 'restore.json').write_text('{}')
        with patch.object(live_model, 'load', return_value=self.value), patch.object(live_model, 'check'), \
             patch.object(backup_recovery, 'require_activation', side_effect=trial.TrialError('still quarantined')), \
             patch.object(trial.subprocess, 'Popen') as start_process:
            with self.assertRaisesRegex(trial.TrialError, 'quarantined'):
                trial.start(root, self.path, reconnect_live=True)
            start_process.assert_not_called()
        self.assertFalse((root / 'config.json').exists())

    def test_checker_receives_key_in_environment_only_and_no_cloud_proof_is_inferred(self):
        self.build_marker()
        report = {'status': 'configured', 'provider': 'bailian', 'model': live_model.DEFAULT_MODEL,
                  'region': 'cn-beijing', 'modelRequests': 0, 'liveVerified': False}
        with patch.object(live_model, 'binary', return_value='/synthetic/node'), \
             patch.object(live_model.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, json.dumps(report), '')) as run:
            self.assertEqual(live_model.check(self.value), report)
        args, kwargs = run.call_args
        self.assertNotIn(self.value['apiKey'], json.dumps(args))
        self.assertEqual(kwargs['env']['AGENT_MODEL_API_KEY'], self.value['apiKey'])
        self.assertEqual(set(kwargs['env']), {'PATH', 'AGENT_MODEL_PROVIDER', 'AGENT_MODEL_NAME', 'AGENT_MODEL_API_KEY', 'AGENT_BAILIAN_WORKSPACE_ID'})

    def test_raw_error_response_and_secret_cannot_be_forwarded(self):
        self.build_marker()
        for output in ['supplier error with ' + self.value['apiKey'], json.dumps({'status': self.value['apiKey']}),
                       json.dumps({'status': 'failed', 'responseBody': self.value['apiKey']})]:
            with patch.object(live_model, 'binary', return_value='/synthetic/node'), \
                 patch.object(live_model.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', output)):
                with self.assertRaises(trial.TrialError) as raised:
                    live_model.invoke(self.value, 'engine/scripts/live-model-smoke.mjs')
                self.assertNotIn(self.value['apiKey'], str(raised.exception))

    def test_engine_preflight_rejects_before_api_can_start_and_hides_transport_errors(self):
        (self.workspace / 'engine').mkdir()
        (self.workspace / 'engine/package.json').write_text('{"version":"0.12.0"}')
        with patch.object(trial, 'binary', return_value='/synthetic/node'), \
             patch.object(trial.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, b'', b'secret transport error')) as run:
            with self.assertRaisesRegex(trial.TrialError, 'API 尚未启动'):
                trial.verify_engine(23001, 'synthetic-service-secret', 'live')
        args, kwargs = run.call_args
        self.assertIn('agent-live', args[0])
        self.assertNotIn('synthetic-service-secret', json.dumps(args))
        self.assertEqual(kwargs['env']['TASK_ENGINE_TOKEN'], 'synthetic-service-secret')

    def test_public_search_routing_is_explicit_and_manual_mode_stays_manual(self):
        search = {'provider': 'bing-rss', 'dns': 'google', 'proxy': 'http://127.0.0.1:7897'}
        api, engine = trial.model_environments(self.value, 23001, 'synthetic-service-token', 23002, True, search)
        self.assertEqual(api['AGENT_NEWS_SEARCH_PROVIDER'], 'bing-rss')
        self.assertEqual(api['BRIEFING_AUTOMATIC_ENABLED'], 'false')
        self.assertEqual(engine['AGENT_PUBLIC_WEB_PROXY'], search['proxy'])
        self.assertEqual(engine['AGENT_PUBLIC_WEB_DNS'], 'google')
        for value in [{'provider': 'unknown'}, {'provider': 'searx'}, {'provider': 'bing-rss', 'proxy': 'http://remote.example.org:8080'}]:
            with self.assertRaises(trial.TrialError):
                trial.public_search_environments(value)

    def test_configure_refuses_noninteractive_key_input(self):
        with patch.object(sys.stdin, 'isatty', return_value=False):
            with self.assertRaisesRegex(trial.TrialError, '交互终端'):
                live_model.configure(self.path)
        self.assertFalse(self.path.exists())


if __name__ == '__main__':
    unittest.main()
