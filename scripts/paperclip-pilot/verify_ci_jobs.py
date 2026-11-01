"""Do not quietly weaken copied gate names, commands, matrices or timeouts."""
from pathlib import Path

root = Path(__file__).resolve().parents[2]
workflow = (root / '.github/workflows/paperclip-pilot-ci.yml').read_text()
sources = ['frontend-gate.yml', 'contracts-engine-gate.yml', 'api-postgres-gate.yml']
for name in sources:
    body = (root / '.github/workflows' / name).read_text().split('jobs:\n', 1)[1]
    if body not in workflow:
        raise SystemExit(f'Copied gate differs from owning workflow: {name}')
print('All six required gate jobs preserve their original definitions.')
