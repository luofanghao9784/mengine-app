#!/usr/bin/env python3
"""Explicit PPT acceptance using a disposable database and project-owned model config."""
import argparse
import json
import os
import re
import signal
from pathlib import Path
import subprocess
import sys
import uuid
from live_model import DEFAULT_CONFIG, load, check, engine_environment
from trial import WORKSPACE, TrialError, binary, directory


def attempt(args):
    # Maven and PostgreSQL never receive the model credential; only this short-lived engine child does.
    env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin')}
    secret = None
    if args.mode == 'live':
        value = load(args.config)
        secret = value['apiKey']
        env.update(engine_environment(value))
    run = subprocess.run([binary('node'), str(WORKSPACE / 'engine/scripts/presentation-acceptance-attempt.mjs'), args.mode, str(args.input)],
                         cwd=WORKSPACE, env=env, capture_output=True, text=True, timeout=70)
    diagnostics = []
    for line in run.stderr.splitlines():
        try:
            event = json.loads(line)
            if event.get('event') == 'TASK_TOOL_REJECTED':
                diagnostics.append({k: event[k] for k in ('event', 'tool', 'code') if isinstance(event.get(k), str) and re.fullmatch(r'[A-Za-z_]{1,64}', event[k])})
        except (ValueError, AttributeError):
            pass
    diagnostic_path = args.output.with_suffix('.diagnostics.json')
    diagnostic_path.write_text(json.dumps(diagnostics))
    diagnostic_path.chmod(0o600)
    if run.returncode:
        raise TrialError('PPT 引擎验收未完成；未输出模型原始错误或凭据。')
    try:
        result = json.loads(run.stdout)
        if not isinstance(result, dict) or result.get('contractVersion') != '1.5' or (secret and secret in run.stdout):
            raise ValueError()
    except (ValueError, TypeError):
        raise TrialError('PPT 引擎未返回安全有效回执。') from None
    args.output.write_text(json.dumps(result, ensure_ascii=False))
    args.output.chmod(0o600)


def main():
    parser = argparse.ArgumentParser(description='隔离 PPT 验收。默认仅检查；synthetic 不调用模型；live 最多三案例、每案两次 attempt。')
    parser.add_argument('command', choices=['check', 'synthetic', 'live', 'attempt'])
    parser.add_argument('--config', type=Path, default=DEFAULT_CONFIG)
    parser.add_argument('--case', choices=['proposal-4', 'source-review-6', 'data-analysis-8'])
    parser.add_argument('--mode', choices=['synthetic', 'live'])
    parser.add_argument('--input', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.command == 'attempt':
        if not args.mode or not args.input or not args.output:
            raise TrialError('缺少验收 attempt 参数。')
        attempt(args)
        return
    if args.command in ['check', 'live']:
        check(load(args.config))  # No network, no fallback, no credential discovery.
    if args.command == 'check':
        print('项目模型配置可用；尚未调用模型。运行 npm run test:ppt:live 开始隔离验收。')
        return
    root = WORKSPACE / '.local/ppt-acceptance'
    directory(root, True)
    target = root / str(uuid.uuid4())
    directory(target, True)
    env = {k: v for k, v in os.environ.items() if not k.startswith(('AGENT_', 'DATABASE_', 'SPRING_', 'DREAMCORE_PPT_'))}
    env.update({'DREAMCORE_PPT_ACCEPTANCE': args.command, 'DREAMCORE_PPT_ACCEPTANCE_OUTPUT': str(target), 'DREAMCORE_PPT_MODEL_CONFIG': str(args.config)})
    if args.case:
        env['DREAMCORE_PPT_ACCEPTANCE_CASE'] = args.case
    command = [sys.executable, 'scripts/with-test-postgres.py', './apps/api/mvnw', '-B', '-f', 'apps/api/pom.xml', '-Dtest=PresentationAcceptanceTest', 'test']
    print(f'模式：{args.command}；独立临时数据库；输出：{target}', flush=True)
    with (target / 'runner.log').open('w') as log:
        result = subprocess.Popen(command, cwd=WORKSPACE, env=env, stdout=log, stderr=log, start_new_session=True)
        try:
            result.wait(timeout=600)
        except (subprocess.TimeoutExpired, KeyboardInterrupt):
            os.killpg(result.pid, signal.SIGTERM)
            try:
                result.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(result.pid, signal.SIGKILL)
                result.wait()
            raise
    print('验收链路通过；内容与排版仍需检查。' if result.returncode == 0 else '验收未完成，请查看隔离目录中的报告。')
    sys.exit(result.returncode)


if __name__ == '__main__':
    try:
        main()
    except (TrialError, OSError, ValueError, subprocess.SubprocessError, KeyboardInterrupt) as error:
        print(str(error) if isinstance(error, TrialError) else '隔离验收未完成；未输出供应商原始错误或凭据。', file=sys.stderr)
        sys.exit(1)
