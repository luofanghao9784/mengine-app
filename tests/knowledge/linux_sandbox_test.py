"""Integration checks on a real rootless Linux systemd/cgroup-v2 host, synthetic data only."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'workers/parser'))
import sandbox


@unittest.skipUnless(sys.platform == 'linux', 'Linux integration host required')
class LinuxSandboxTests(unittest.TestCase):
    def test_isolated_python_cli_used_by_java(self):
        with tempfile.TemporaryDirectory() as job:
            Path(job, 'input').write_text('plain synthetic input')
            result = subprocess.run([sys.executable, '-I', '-B', str(ROOT/'workers/parser/sandbox.py'),
                                     job, 'txt'], capture_output=True, text=True, check=True)
            self.assertEqual('READY', json.loads(result.stdout)['status'])

    def probe(self, body, extension='txt'):
        script = ROOT / 'workers/parser/.local' / ('probe-' + uuid.uuid4().hex + '.py')
        script.parent.mkdir(exist_ok=True)
        script.write_text(body)
        self.addCleanup(script.unlink, missing_ok=True)
        with tempfile.TemporaryDirectory() as job:
            Path(job, 'input').write_text('immutable input')
            result = sandbox.run(job, extension, script)
            self.assertEqual('immutable input', Path(job, 'input').read_text())
            return result

    def test_namespaces_environment_and_readonly_input(self):
        with tempfile.TemporaryDirectory() as outside:
            canary = Path(outside, 'private'); canary.write_text('synthetic secret')
            os.environ['DREAMCORE_SYNTHETIC_SECRET'] = 'must-not-leak'
            self.addCleanup(os.environ.pop, 'DREAMCORE_SYNTHETIC_SECRET', None)
            body = '''import json,os,socket
from pathlib import Path
checks=[]
for path in [CANARY, '/etc/9pop-v2/9pop-v2.env', '/run/user/1000/bus']:
 try: Path(path).read_bytes();checks.append(False)
 except OSError: checks.append(True)
try: Path('/job/input').write_text('corrupt');checks.append(False)
except OSError: checks.append(True)
try: socket.create_connection(('1.1.1.1',443),timeout=1);checks.append(False)
except OSError: checks.append(True)
checks += ['DREAMCORE_SYNTHETIC_SECRET' not in os.environ,
           'NoNewPrivs:\\t1' in Path('/proc/self/status').read_text(),
           'CapEff:\\t0000000000000000' in Path('/proc/self/status').read_text()]
print(json.dumps({'checks':checks,'net':os.readlink('/proc/self/ns/net'),'pid':os.readlink('/proc/self/ns/pid')}))
'''.replace('CANARY', repr(str(canary)))
            result = json.loads(self.probe(body))
            self.assertTrue(all(result['checks']), result)
            self.assertNotEqual(os.readlink('/proc/self/ns/net'), result['net'])
            self.assertNotEqual(os.readlink('/proc/self/ns/pid'), result['pid'])
            self.assertEqual('synthetic secret', canary.read_text())

    def test_memory_limit_kills_allocation(self):
        with self.assertRaises(RuntimeError):
            self.probe("x=bytearray(600*1024*1024); print('unexpected success')")

    def test_file_size_limit(self):
        with self.assertRaises(RuntimeError):
            self.probe("from pathlib import Path\nPath('/job/oversize').write_bytes(b'x'*(9*1024*1024))")

    def test_process_limit(self):
        body = '''import subprocess,json
children=[]
try:
 for i in range(80): children.append(subprocess.Popen(['/usr/bin/sleep','3']))
except OSError: pass
finally:
 for p in children: p.kill();p.wait()
print(json.dumps(len(children)))
'''
        count = json.loads(self.probe(body))
        self.assertGreater(count, 0)
        self.assertLess(count, 32)

    def test_wall_timeout_and_descendant_cleanup(self):
        start = time.monotonic()
        with self.assertRaises(RuntimeError):
            self.probe("import subprocess,time\nsubprocess.Popen(['/usr/bin/sleep','90'],start_new_session=True)\ntime.sleep(90)", 'table-compare')
        self.assertLess(time.monotonic() - start, 17)
        env = {'PATH':'/usr/bin:/bin', 'XDG_RUNTIME_DIR':f'/run/user/{os.getuid()}',
               'DBUS_SESSION_BUS_ADDRESS':f'unix:path=/run/user/{os.getuid()}/bus'}
        units = subprocess.check_output(['/usr/bin/systemctl','--user','list-units','--state=running',
                                         '--no-legend','dreamcore-parser-*'],env=env,text=True)
        self.assertEqual('', units.strip())

    def test_worker_without_resource_scope_fails_closed(self):
        result = subprocess.run([sys.executable, str(ROOT/'workers/parser/linux_worker.py'),
                                 '/tmp', 'txt', str(ROOT/'workers/parser/parse.py')],capture_output=True,text=True)
        self.assertNotEqual(0, result.returncode)
        self.assertIn('PARSER_LINUX_ISOLATION_UNAVAILABLE', result.stderr)

    def test_launcher_crash_keeps_admission_until_worker_ends(self):
        script = ROOT / 'workers/parser/.local' / ('probe-' + uuid.uuid4().hex + '.py')
        script.parent.mkdir(exist_ok=True)
        script.write_text("import time\nprint('started',flush=True)\ntime.sleep(90)")
        self.addCleanup(script.unlink, missing_ok=True)
        with tempfile.TemporaryDirectory() as job:
            Path(job, 'input').write_text('synthetic input')
            code = 'import sys;sys.path.insert(0,sys.argv[1]);import sandbox;sandbox.run(sys.argv[2],"table-compare",sys.argv[3])'
            process = subprocess.Popen([sys.executable, '-c', code, str(ROOT/'workers/parser'), job, str(script)],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    result = Path(job, 'result')
                    if result.exists() and 'started' in result.read_text():
                        break
                    time.sleep(0.1)
                else:
                    self.fail('sandbox worker did not start')
                process.kill(); process.wait(timeout=3)
                with self.assertRaises(RuntimeError):
                    self.probe("print('must not run concurrently')")
                # RuntimeMaxSec still terminates the orphaned job; admission reopens.
                deadline = time.monotonic() + 14
                while time.monotonic() < deadline:
                    try:
                        self.assertEqual('ready', self.probe("print('ready')").strip())
                        break
                    except RuntimeError:
                        time.sleep(0.5)
                else:
                    self.fail('admission did not reopen after the worker deadline')
            finally:
                if process.poll() is None:
                    process.kill(); process.wait(timeout=3)


if __name__ == '__main__':
    unittest.main()
