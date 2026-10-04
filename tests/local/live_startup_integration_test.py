"""Opt-in owned live-mode startup; fake credentials, no model requests or existing data."""
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/local'))
import live_model
import trial


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


@unittest.skipUnless(os.environ.get('RUN_LIVE_STARTUP_TESTS') == '1',
                     'explicit owned live-mode startup test opt-in; no cloud request')
class LiveStartupIntegrationTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='dreamcore-live-startup-synthetic-'))
        self.instance = self.root / 'instance'
        self.child = None
        self.output = None
        self.retain_diagnostics = False
        self.addCleanup(self.cleanup_owned)
        self.fake_key = 'synthetic-never-valid-' + uuid.uuid4().hex
        self.model_path = trial.WORKSPACE / '.local/model-private' / ('test-' + uuid.uuid4().hex + '.json')
        live_model.owned_path(self.model_path, create=True)
        value = {'format': live_model.FORMAT, 'workspace': str(trial.WORKSPACE),
                 'provider': 'bailian', 'model': live_model.DEFAULT_MODEL,
                 'workspaceId': 'synthetic-startup-no-cloud', 'apiKey': self.fake_key}
        descriptor = os.open(self.model_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, 'w') as file:
            json.dump(value, file)
        self.model_inode = self.model_path.stat().st_ino
        self.environment = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'),
                            'PYTHONUNBUFFERED': '1', 'LC_ALL': 'C', 'LANG': 'C'}
        if os.environ.get('POSTGRES_BIN'):
            self.environment['POSTGRES_BIN'] = os.environ['POSTGRES_BIN']
        self.log_path = self.root / 'supervisor.log'
        self.output = self.log_path.open('ab')
        self.log_path.chmod(0o600)

    def command(self, operation, *arguments):
        return [sys.executable, str(trial.WORKSPACE / 'scripts/local/trial.py'), operation,
                '--directory', str(self.instance), *arguments]

    def cleanup_owned(self):
        # Never let unittest's automatic TemporaryDirectory cleanup remove a running database.
        if self.child is not None and self.child.poll() is None:
            try:
                self.stop_instance()
            except Exception:
                self.child.terminate()
                try:
                    self.child.wait(timeout=45)
                except subprocess.TimeoutExpired:
                    pass
        if self.output is not None:
            self.output.close()
        if hasattr(self, 'model_inode') and self.model_path.is_file() and not self.model_path.is_symlink():
            if self.model_path.stat().st_ino == self.model_inode:
                self.model_path.unlink()
        running = self.child is not None and self.child.poll() is None
        if not running and not (self.instance / 'postgres/postmaster.pid').exists():
            if self.retain_diagnostics:
                # Keep this test's private logs long enough to diagnose startup failures.
                diagnostic = self.root / 'startup-diagnostics'
                if (self.instance / 'logs').is_dir():
                    shutil.copytree(self.instance / 'logs', diagnostic)
                if self.instance.exists():
                    shutil.rmtree(self.instance)
            else:
                shutil.rmtree(self.root)
        else:
            raise AssertionError('Owned runtime did not fully stop; its temporary data was retained at ' + str(self.root))

    def start_instance(self, live=True, enable=False):
        arguments = ['--live', '--model-config', str(self.model_path)] if live else []
        if enable: arguments += ['--enable-live', '--phone-local']
        self.child = subprocess.Popen(
            self.command('start', *arguments),
            cwd=trial.WORKSPACE, env=self.environment, stdin=subprocess.DEVNULL,
            stdout=self.output, stderr=self.output)
        deadline = time.monotonic() + 100
        while time.monotonic() < deadline:
            if self.child.poll() is not None:
                self.retain_diagnostics = True
                self.fail('Owned startup exited before ready; private diagnostic log: ' + str(self.log_path))
            runtime_file = self.instance / 'runtime.json'
            if runtime_file.is_file():
                runtime = trial.private_read(runtime_file)
                if runtime.get('state') == 'ready':
                    self.assertEqual(runtime.get('agentMode'), 'live' if live else 'off')
                    self.assertIs(runtime.get('cloudVerifiedByStartup'), False)
                    return runtime
            time.sleep(0.2)
        self.fail('Owned live-mode startup did not become ready within its bounded wait')

    def stop_instance(self):
        result = subprocess.run(self.command('stop'), cwd=trial.WORKSPACE,
                                env=self.environment, capture_output=True, timeout=50)
        self.assertEqual(result.returncode, 0, 'Owned stop command failed; no child output forwarded')
        self.assertFalse(self.fake_key.encode() in result.stdout + result.stderr, 'Stop output exposed the synthetic key')
        self.child.wait(timeout=20)
        self.assertEqual(self.child.returncode, 0, 'Owned supervisor did not exit normally')
        self.assertFalse((self.instance / 'postgres/postmaster.pid').exists(), 'Owned PostgreSQL remains running')
        runtime = trial.private_read(self.instance / 'runtime.json')
        self.assertEqual(runtime['state'], 'stopped')
        self.assertEqual(runtime['agentMode'], trial.config(self.instance)['agentMode'])
        self.assertIs(runtime['cloudVerifiedByStartup'], False)

    def request(self, opener, base, path, body=None, expected=200):
        headers = {}
        if body is not None:
            csrf = self.request(opener, base, ('/api/platform-admin/v1/auth' if path.startswith('/api/platform-admin/') else '/api/v1/auth') + '/csrf')
            headers = {'Content-Type': 'application/json', csrf['headerName']: csrf['token']}
        request = urllib.request.Request(base + path,
                                         data=None if body is None else json.dumps(body).encode(),
                                         headers=headers)
        try:
            with opener.open(request, timeout=10) as response:
                status, data = response.status, response.read(1024 * 1024)
        except urllib.error.HTTPError as error:
            with error:
                status, data = error.code, error.read(1024 * 1024)
        self.assertEqual(status, expected, 'Unexpected HTTP status at owned endpoint ' + path)
        self.assertFalse(self.fake_key.encode() in data, 'HTTP response exposed the synthetic model key')
        if expected == 401:
            return None
        return json.loads(data)

    def client(self):
        return urllib.request.build_opener(NoRedirect(), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def live_capabilities(self, runtime):
        base = runtime['webUrl']
        opener = self.client()
        for path in ('/workspace/', '/tenant-admin/', '/platform-admin/'):
            with opener.open(base + path, timeout=10) as response:
                body = response.read(1024 * 1024)
                self.assertEqual(response.status, 200)
                self.assertTrue(b'<html' in body.lower(), 'Real built surface did not serve HTML')
                self.assertFalse(self.fake_key.encode() in body, 'Built surface exposed the synthetic key')
        # System metadata is intentionally public; account/management data requires login.
        self.request(opener, base, '/api/v1/me', expected=401)
        account = trial.private_read(self.instance / 'accounts.json')['platform']
        identity = self.request(opener, base, '/api/platform-admin/v1/auth/login', {'username':trial.platform_login(account),'password':account['password']})
        self.assertIs(identity['platformAdmin'], True)
        info = self.request(opener, base, '/api/v1/system/info')
        self.assertEqual(info['engine']['runtimeMode'], 'agent-live')
        self.assertEqual(info['engine']['capabilities'], ['source-lookup', 'agent-task'])
        self.assertEqual(info['integrations']['harness'], 'configured')
        self.assertEqual(info['dataSource'], 'live')
        return opener, identity['account']['id']

    def database_counters(self):
        settings = trial.config(self.instance)
        password = trial.private_read(self.instance / 'database.json')['password']
        query = """SELECT json_build_object(
          'requests',(SELECT count(*) FROM agent_model_requests),
          'attempts',(SELECT count(*) FROM agent_attempt_usage),
          'tasks',(SELECT count(*) FROM conversation_tasks),
          'plans',(SELECT count(*) FROM ongoing_plans),
          'accounts',(SELECT count(*) FROM accounts),
          'tenants',(SELECT count(*) FROM tenants))"""
        result = subprocess.run(
            [trial.binary('psql'), '-X', '-h', '127.0.0.1', '-p', str(settings['ports']['database']),
             '-U', 'dreamcore_trial', '-d', 'dreamcore_trial', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query],
            cwd=trial.WORKSPACE, env={**self.environment, 'PGPASSWORD': password, 'PGCONNECT_TIMEOUT': '5'},
            capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, 'Owned database inspection failed; no raw output forwarded')
        counters = json.loads(result.stdout)
        for field in ('requests', 'attempts', 'tasks', 'plans'):
            self.assertEqual(counters[field], 0, 'Startup must not schedule or submit AI work: ' + field)
        self.assertEqual(counters['accounts'], 1)
        return counters

    def assert_no_key_in_instance(self):
        files = list(self.instance.glob('*.json')) + list((self.instance / 'logs').glob('*')) + [self.log_path]
        for path in files:
            if path.is_file():
                self.assertFalse(self.fake_key.encode() in path.read_bytes(),
                                 'Synthetic model key appeared in runtime metadata or log: ' + path.name)
        self.assertFalse(self.model_path.is_relative_to(self.instance))

    def test_explicit_off_to_manual_live_preserves_instance_and_local_phone_without_cloud_requests(self):
        first = self.start_instance(live=False)
        first_config = trial.config(self.instance)
        account = trial.private_read(self.instance / 'accounts.json')['platform']
        opener = self.client()
        before = self.request(opener, first['webUrl'], '/api/platform-admin/v1/auth/login',
                              {'username':trial.platform_login(account),'password':account['password']})
        tenant = self.request(opener, first['webUrl'], '/api/platform-admin/v1/tenants', {
            'requestId':str(uuid.uuid4()), 'name':'Synthetic manual live acceptance',
            'adminEmail':'synthetic-manual-live@example.test'}, expected=201)['tenant']
        account_hash=hashlib.sha256((self.instance/'accounts.json').read_bytes()).hexdigest()
        self.stop_instance()
        second=self.start_instance(enable=True)
        current=trial.config(self.instance)
        self.assertEqual(current['ports'],first_config['ports'])
        self.assertEqual(current['agentMode'],'live')
        self.assertTrue(current['manualModelAcceptance'])
        opener,account_id=self.live_capabilities(second)
        self.assertEqual(account_id,before['account']['id'])
        self.assertEqual(self.request(opener,second['webUrl'],'/api/platform-admin/v1/tenants')[0]['id'],tenant['id'])
        phone=self.request(opener,second['webUrl'],'/api/v1/auth/phone/configuration')
        self.assertEqual(phone['delivery'],'LOCAL')
        self.assertTrue(phone['localPreview'])
        self.assertEqual(hashlib.sha256((self.instance/'accounts.json').read_bytes()).hexdigest(),account_hash)
        self.assertEqual(self.database_counters()['tenants'],1)
        self.stop_instance();self.assert_no_key_in_instance()
        print('PASS: explicit off-to-manual-live activation, retained tenant/account/ports, local phone, zero model requests.')

    def test_live_runtime_restarts_keep_data_without_model_requests(self):
        first = self.start_instance()
        first_config = trial.config(self.instance)
        self.assertEqual(first_config['agentMode'], 'live')
        account_hash = hashlib.sha256((self.instance / 'accounts.json').read_bytes()).hexdigest()
        database_hash = hashlib.sha256((self.instance / 'database.json').read_bytes()).hexdigest()
        opener, account_id = self.live_capabilities(first)
        self.assertEqual(self.database_counters()['tenants'], 0)
        name = 'Synthetic live startup ' + uuid.uuid4().hex
        tenant = self.request(opener, first['webUrl'], '/api/platform-admin/v1/tenants', {
            'requestId': str(uuid.uuid4()), 'name': name,
            'adminEmail': 'synthetic-live-startup@example.test'}, expected=201)['tenant']
        self.assertEqual(tenant['name'], name)
        self.assertEqual(self.database_counters()['tenants'], 1)
        self.stop_instance()
        self.assert_no_key_in_instance()

        second = self.start_instance()
        self.assertEqual(trial.config(self.instance), first_config)
        self.assertEqual(second['webUrl'], first['webUrl'])
        self.assertNotEqual(second['runId'], first['runId'])
        self.assertEqual(hashlib.sha256((self.instance / 'accounts.json').read_bytes()).hexdigest(), account_hash)
        self.assertEqual(hashlib.sha256((self.instance / 'database.json').read_bytes()).hexdigest(), database_hash)
        opener, restored_account_id = self.live_capabilities(second)
        self.assertEqual(restored_account_id, account_id)
        tenants = self.request(opener, second['webUrl'], '/api/platform-admin/v1/tenants')
        self.assertEqual([(item['id'], item['name']) for item in tenants], [(tenant['id'], name)])
        self.assertEqual(self.database_counters()['tenants'], 1)
        self.stop_instance()
        self.assert_no_key_in_instance()
        print('PASS: live startup/restart, 3 real HTTP surfaces, authenticated agent-live, retained account/tenant/ports, 0 model requests, no key in runtime/logs.')


if __name__ == '__main__':
    unittest.main()
