"""Do not quietly weaken copied gate names, commands, matrices or timeouts."""
import re
from pathlib import Path

PREFIX = 'Paperclip · '

root = Path(__file__).resolve().parents[2]
workflow = (root / '.github/workflows/paperclip-pilot-ci.yml').read_text()
normalized = re.sub(r'(?m)^(    name: )' + re.escape(PREFIX), r'\1', workflow)
sources = ['frontend-gate.yml', 'contracts-engine-gate.yml', 'api-postgres-gate.yml']
for name in sources:
    body = (root / '.github/workflows' / name).read_text().split('jobs:\n', 1)[1]
    for m in re.finditer(r'(?m)^    name: (.+)$', body):
        if ('    name: ' + PREFIX + m.group(1)) not in workflow.splitlines():
            raise SystemExit(
                f'Copied gate job name lacks required prefix {PREFIX!r}: {m.group(1)}'
            )
    if body not in normalized:
        raise SystemExit(f'Copied gate differs from owning workflow: {name}')
print('All six required gate jobs preserve their original definitions.')
