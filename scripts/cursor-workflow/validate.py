#!/usr/bin/env python3
"""Validate Cursor files or local delivery evidence; never execute supplied commands."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STAGES = ('requirements', 'product', 'architecture', 'development', 'quality', 'testing', 'operations')
AGENTS = ('coordinator', 'requirements', 'product', 'architect', 'developer', 'quality', 'tester', 'operations')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def evidence(items, base):
    require(isinstance(items, list) and items, 'missing evidence')
    for item in items:
        require(isinstance(item, dict), 'evidence must contain path and sha256')
        rel = Path(item.get('path', ''))
        require(str(rel) not in ('', '.') and not rel.is_absolute(), 'evidence path must be relative')
        path = (base / rel).resolve()
        require(path.is_relative_to(base.resolve()), 'evidence escaped task directory')
        require(path.is_file(), 'evidence file missing: ' + str(rel))
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        require(item.get('sha256') == digest, 'evidence digest mismatch: ' + str(rel))


def config():
    for role in AGENTS:
        path = ROOT / '.cursor' / 'agents' / ('mengine-' + role + '.md')
        text = path.read_text()
        require(text.startswith('---\n'), 'missing frontmatter: ' + role)
        _, header, body = text.split('---', 2)
        fields = dict(line.split(':', 1) for line in header.strip().splitlines())
        fields = {key.strip(): value.strip() for key, value in fields.items()}
        require(set(fields) <= {'name', 'description', 'model', 'readonly', 'is_background'}, 'unknown agent field')
        require(fields.get('name') == 'mengine-' + role, 'agent name mismatch')
        require(fields.get('description') and body.strip(), 'empty agent definition')
        require(fields.get('model') == 'inherit', 'model must preserve current choice')
        readonly = role in ('requirements', 'product', 'architect', 'quality', 'operations')
        require(fields.get('readonly') == str(readonly).lower(), 'incorrect write boundary: ' + role)
    rule = (ROOT / '.cursor/rules/mengine-delivery.mdc').read_text()
    require('alwaysApply: true' in rule, 'delivery rule not enabled in this project')
    require('不设置全局并行人数上限' in rule, 'missing parallel policy')
    template = json.loads((ROOT / 'docs/协作/Cursor自动协作/task-card.template.json').read_text())
    require(set(template['stages']) == set(STAGES), 'missing delivery stage')
    require(template['state'] == 'in_progress', 'template must not claim success')
    readiness = json.loads((ROOT / 'docs/协作/Cursor自动协作/b2b-readiness.template.json').read_text())
    require(len(readiness['dimensions']) >= 10, 'B2B readiness coverage missing')
    require(all(x['status'] == 'unverified' for x in readiness['dimensions']), 'template claims unverified readiness')
    return {'agents': len(AGENTS), 'stages': len(STAGES), 'parallel_cap': None, 'models': 'inherit'}


def task(path):
    data = json.loads(path.read_text())
    base = path.resolve().parent
    require(data.get('schema_version') == 1, 'unsupported task schema')
    require(data.get('task_id') and data['task_id'] != 'REPLACE', 'missing task id')
    require(data.get('scope') in ('trial', 'development'), 'invalid task scope')
    require(data.get('state') == 'complete', 'task not marked complete')
    head = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip()
    require(data.get('head_sha') == head, 'evidence is not for current HEAD')
    require(not data.get('blockers'), 'task has unresolved blockers')
    require(set(data.get('stages', {})) == set(STAGES), 'delivery stages incomplete')
    for name, stage in data['stages'].items():
        require(stage.get('status') in ('passed', 'reused', 'not-applicable'), 'stage not accepted: ' + name)
        require(stage.get('summary'), 'stage has no explanation: ' + name)
        evidence(stage.get('evidence'), base)
    checks = data.get('checks', [])
    require(checks, 'no executed checks')
    check_ids = set()
    for check in checks:
        require(check.get('id') and check['id'] not in check_ids, 'missing or duplicate check id')
        check_ids.add(check['id'])
        require(check.get('command'), 'missing executed command')
        require(check.get('head_sha') == head, 'stale check evidence')
        require(check.get('status') == 'passed' and type(check.get('exit_code')) is int and check['exit_code'] == 0,
                'failed/skipped/unverified check cannot pass')
        evidence(check.get('evidence'), base)
        for entry in check['evidence']:
            log = (base / entry['path']).read_text(errors='replace')
            require(not re.search(r'(?im)^\s*(?:SKIP\s*:|#\s*SKIP\s*:)', log), 'SKIP log cannot prove a pass')
        if 'test:e2e:frontend' in check['command']:
            package = json.loads((ROOT / 'package.json').read_text())
            require('SKIP:' not in package['scripts'].get('test:e2e:frontend', ''), 'frontend entry is still a SKIP')
    acceptance = data.get('acceptance', [])
    require(acceptance, 'missing acceptance criteria')
    acceptance_ids = set()
    for criterion in acceptance:
        require(criterion.get('id') and criterion['id'] not in acceptance_ids, 'missing or duplicate acceptance id')
        acceptance_ids.add(criterion['id'])
        require(criterion.get('description'), 'acceptance criterion lacks behavior')
        ids = criterion.get('check_ids', [])
        require(ids and set(ids) <= check_ids, 'acceptance criterion has no matching passed check')
    review = data.get('review', {})
    require(review.get('status') == 'passed' and review.get('head_sha') == head, 'missing current independent review')
    require(review.get('author_actor') and review.get('reviewer_actor') and
            review['author_actor'] != review['reviewer_actor'], 'author cannot approve their own work')
    require(not review.get('open_blockers'), 'independent review has blockers')
    evidence(review.get('evidence'), base)
    delivery = data.get('delivery', {})
    require(delivery.get('status') == 'ready' and delivery.get('summary'), 'delivery handoff incomplete')
    require(delivery.get('production_deployed') is False, 'pilot cannot claim production deployment')
    evidence(delivery.get('evidence'), base)
    return {'task_id': data['task_id'], 'scope': data['scope'], 'head_sha': head,
            'checks': len(checks), 'acceptance': len(acceptance),
            'limitation': 'Checks evidence structure and digests, not truth of claims or business acceptance.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--config', action='store_true')
    group.add_argument('--task', type=Path)
    args = parser.parse_args()
    try:
        result = config() if args.config else task(args.task)
        print(json.dumps({'status': 'passed', **result}, ensure_ascii=False))
        return 0
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({'status': 'failed', 'reason': str(error)}, ensure_ascii=False))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
