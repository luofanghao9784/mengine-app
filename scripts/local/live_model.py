#!/usr/bin/env python3
"""Explicit project-owned model configuration; no inherited credentials or cloud call on startup."""
import argparse
import getpass
import json
import os
from pathlib import Path
import re
import subprocess
import sys

from trial import WORKSPACE, TrialError, binary, directory, private_read, private_write

FORMAT = 'dreamcore-local-model-v1'
DEFAULT_CONFIG = WORKSPACE / '.local/model-private/bailian.json'
DEFAULT_MODEL = 'qwen3.7-plus-2026-05-26'
MODELS = {'qwen3.7-plus', 'qwen3.7-flash', DEFAULT_MODEL, 'qwen3.7-flash-2026-07-15', 'qwen3.8-max-0902'}


def owned_path(path, create=False):
    path = Path(os.path.abspath(path))
    base = WORKSPACE / '.local/model-private'
    if path.parent != base or path.suffix != '.json':
        raise TrialError('模型配置须位于本工作树 .local/model-private/ 的独立 JSON 文件中。')
    local = WORKSPACE / '.local'
    if local.is_symlink() or (local.exists() and (not local.is_dir() or local.stat().st_uid != os.getuid() or local.stat().st_mode & 0o022)):
        raise TrialError('本工作树 .local 目录归属或权限无效。')
    if not base.exists() and not base.is_symlink() and not create:
        raise TrialError('尚未配置本项目模型，请先运行 npm run model:configure。')
    directory(base, create)
    if path.is_symlink():
        raise TrialError('模型配置不能是符号链接。')
    return path


def validate(value):
    fields = {'format', 'workspace', 'provider', 'model', 'workspaceId', 'apiKey'}
    if not isinstance(value, dict) or set(value) not in (fields, fields | {'routineModel'}) or value['format'] != FORMAT or value['workspace'] != str(WORKSPACE):
        raise TrialError('模型配置格式或工作树归属不匹配，请在当前工作树运行 model:configure。')
    if value['provider'] != 'bailian' or not isinstance(value['model'], str) or value['model'] not in MODELS:
        raise TrialError('当前本地真实验收使用百炼已支持模型版本，请检查模型名称。')
    if not isinstance(value['workspaceId'], str) or not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', value['workspaceId']):
        raise TrialError('百炼工作空间 ID 无效。')
    if 'routineModel' in value and (not isinstance(value['routineModel'], str) or value['routineModel'] not in MODELS):
        raise TrialError('常规任务模型须使用受支持的模型 ID。')
    key = value['apiKey']
    if not isinstance(key, str) or not 1 <= len(key) <= 4096 or any(c.isspace() or ord(c) < 33 or ord(c) > 126 for c in key):
        raise TrialError('API Key 为空或包含无效字符，请通过隐藏输入重新配置。')
    return value


def load(path=DEFAULT_CONFIG):
    path = owned_path(path)
    if not path.exists():
        raise TrialError('尚未配置本项目模型，请先运行 npm run model:configure。')
    if path.stat().st_size > 16384:
        raise TrialError('模型配置文件过大。')
    return validate(private_read(path))


def engine_environment(value):
    validate(value)
    return {'AGENT_MODEL_PROVIDER': value['provider'], 'AGENT_MODEL_NAME': value['model'],
            'AGENT_BAILIAN_WORKSPACE_ID': value['workspaceId'], 'AGENT_MODEL_API_KEY': value['apiKey'],
            **({'AGENT_ROUTINE_MODEL_NAME': value['routineModel']} if value.get('routineModel') else {})}


def invoke(value, script, tools=False):
    # Only this short-lived checker/smoke process and the engine receive the key.
    if not (WORKSPACE / 'engine/dist/runtime/model-config.js').is_file():
        raise TrialError('引擎尚未构建，请先运行 npm run build:engine。')
    result = subprocess.run([binary('node'), str(WORKSPACE / script), *(['--tools'] if tools else [])], cwd=WORKSPACE,
                            env={'PATH': os.environ.get('PATH', '/usr/bin:/bin'), **engine_environment(value)},
                            capture_output=True, text=True, timeout=60)
    # Never forward arbitrary child output or exception text (including supplier response bodies).
    try:
        report = json.loads(result.stdout or result.stderr)
        allowed = {'status', 'code', 'provider', 'model', 'region', 'modelRequests', 'requestCount',
                   'liveVerified', 'durationMs', 'usage', 'usageKnown'}
        if not isinstance(report, dict) or set(report) - allowed:
            raise ValueError()
        serialized = json.dumps(report, ensure_ascii=False)
        if value['apiKey'] in serialized:
            raise ValueError()
    except (ValueError, TypeError):
        raise TrialError('模型检查未返回可核验的安全结果；未输出子进程内容。') from None
    return result.returncode, report


def check(value):
    code, report = invoke(value, 'engine/scripts/check-model-config.mjs')
    if code or report.get('status') != 'configured' or report.get('liveVerified') is not False:
        raise TrialError('引擎拒绝模型配置；未发送云端请求。')
    return report


def configure(path):
    if not sys.stdin.isatty() or not sys.stderr.isatty():
        raise TrialError('请在本机交互终端运行 model:configure；不要把密钥写在命令行参数或会话中。')
    path = owned_path(path, True)
    if path.exists():
        previous = private_read(path)
        # Permit correcting this project's invalid model/key without overwriting foreign files.
        if not isinstance(previous, dict) or previous.get('format') != FORMAT or previous.get('workspace') != str(WORKSPACE):
            raise TrialError('现有配置不属于本工作树，拒绝覆盖。')
    workspace_id = input('百炼北京工作空间 ID：').strip()
    model = input(f'模型快照（回车使用 {DEFAULT_MODEL}）：').strip() or DEFAULT_MODEL
    api_key = getpass.getpass('本项目专用 API Key（隐藏输入）：')
    value = validate({'format': FORMAT, 'workspace': str(WORKSPACE), 'provider': 'bailian',
                      'model': model, 'workspaceId': workspace_id, 'apiKey': api_key})
    check(value)
    private_write(path, value)
    print(f'私有配置已保存：{path}\n本地校验通过，尚未发送云端请求。运行 npm run model:smoke 进行一次最小真实请求。')


def main():
    parser = argparse.ArgumentParser(description='本项目百炼私有配置与显式单次真实连接检查。')
    parser.add_argument('command', choices=['configure', 'check', 'smoke'])
    parser.add_argument('--config', type=Path, default=DEFAULT_CONFIG)
    parser.add_argument('--tools', action='store_true', help='smoke 时额外验证工具回放，最多两次模型请求。')
    args = parser.parse_args()
    if args.tools and args.command != 'smoke':
        raise TrialError('--tools 仅适用于 smoke。')
    if args.command == 'configure':
        configure(args.config)
        return
    value = load(args.config)
    if args.command == 'check':
        print(json.dumps(check(value), ensure_ascii=False))
    else:
        check(value)
        code, report = invoke(value, 'engine/scripts/live-model-smoke.mjs', args.tools)
        print(json.dumps(report, ensure_ascii=False))
        sys.exit(code)


if __name__ == '__main__':
    try:
        main()
    except (TrialError, OSError, ValueError, TypeError, subprocess.SubprocessError, EOFError, KeyboardInterrupt):
        error = sys.exc_info()[1]
        print(str(error) if isinstance(error, TrialError) else '本地模型操作未完成；未输出凭据或供应商原始响应。', file=sys.stderr)
        sys.exit(1)
