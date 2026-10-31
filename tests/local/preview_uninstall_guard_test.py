"""Real shell control-flow test, copied uninstall with synthetic common/backup commands only."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

class UninstallGuardTest(unittest.TestCase):
    def test_backup_success_does_not_delete_source_or_key(self):
        source=Path(__file__).resolve().parents[2]/'scripts/preview/preview-uninstall.sh'
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); scripts=root/'scripts';scripts.mkdir()
            script=scripts/source.name;script.write_bytes(source.read_bytes())
            (scripts/'preview-stop.sh').write_text('#!/bin/bash\nexit 0\n')
            (scripts/'preview-common.sh').write_text('''set -eu
PREVIEW_HOME="$FIXTURE/home"
INSTANCE="$PREVIEW_HOME/instance"
SECRETS="$PREVIEW_HOME/secrets"
LOGS="$PREVIEW_HOME/logs"
STATE="$PREVIEW_HOME/state"
BACKUPS="$PREVIEW_HOME/backups"
REPO="$FIXTURE/repo"
DRY_RUN=0
log() { printf '%s\\n' "$*"; }
die() { printf '%s\\n' "$*" >&2; exit 1; }
run() { if [ "$1" = bash ]; then mkdir -p "$BACKUPS/synthetic.bundle"; touch "$BACKUPS/synthetic.bundle/manifest.json"; else "$@"; fi; }
''')
            home=root/'home'
            for name in ['instance/postgres','secrets','logs','state','backups']:(home/name).mkdir(parents=True,exist_ok=True)
            key=home/'secrets/fixture.key';key.write_text('synthetic-no-credential')
            result=subprocess.run(['bash',str(script),'--yes'],env={**os.environ,'FIXTURE':str(root)},capture_output=True,text=True)
            self.assertEqual(1,result.returncode)
            self.assertIn('未执行删除',result.stderr)
            for name in ['instance/postgres','secrets/fixture.key','logs','state','backups/synthetic.bundle/manifest.json']:
                self.assertTrue((home/name).exists(),name)
