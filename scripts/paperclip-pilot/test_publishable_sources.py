"""Prevent runtime-generated authentication from entering review artifacts again."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]


class PublishableSourceSafetyTests(unittest.TestCase):
    def test_publishable_pilot_sources_contain_no_jwt_or_managed_mcp_credentials(self):
        token = re.compile(rb'\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{16,}\b')
        findings = []
        for directory in ('config/paperclip-pilot', 'scripts/paperclip-pilot', 'docs/协作/Paperclip隔离试点'):
            for path in (ROOT / directory).rglob('*'):
                if not path.is_file() or path.suffix not in ('.toml', '.json', '.py', '.mjs', '.md', '.template', '.sh'):
                    continue
                if token.search(path.read_bytes()):
                    findings.append(str(path.relative_to(ROOT)))
        # Never include matched credential text in test output.
        self.assertEqual(findings, [], 'Embedded JWT found in files: ' + ', '.join(findings))
        template = ROOT / 'config/paperclip-pilot/codex-profiles/config.template.toml'
        self.assertNotIn('BEGIN PAPERCLIP MANAGED MCP', template.read_text())


if __name__ == '__main__':
    unittest.main()
