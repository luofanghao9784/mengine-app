#!/usr/bin/env python3
"""Lifecycle for the pinned, loopback-only local WeKnora Lite deployment."""
import argparse
import os
from pathlib import Path
import signal
import subprocess
import urllib.request
from trial import WORKSPACE, private_read, TrialError

ROOT = WORKSPACE / '.local/weknora'
BINARY = ROOT / 'source/WeKnora-lite'


def running():
    pidfile = ROOT / 'pid'
    if not pidfile.is_file():
        return None
    pid = int(pidfile.read_text())
    result = subprocess.run(['ps', '-p', str(pid), '-o', 'comm='], capture_output=True, text=True)
    if result.returncode or not result.stdout.strip():
        return None
    if result.stdout.strip() != str(BINARY):
        raise TrialError('PID 已被其他进程使用，拒绝操作。')
    return pid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'stop', 'status'])
    args = parser.parse_args()
    os.umask(0o077)
    pid = running()
    if args.action == 'stop':
        if pid:
            os.kill(pid, signal.SIGTERM)
        print('已请求停止；独立索引数据库保留。')
    elif args.action == 'status':
        if not pid:
            print('未运行')
            return
        try:
            with urllib.request.urlopen('http://127.0.0.1:54630/health', timeout=3) as response:
                print('运行中；健康检查 HTTP', response.status)
        except Exception:
            print('进程运行中；健康检查暂不可用')
    else:
        if pid:
            print('已运行，未重复启动。')
            return
        settings = private_read(ROOT / 'environment.json')
        config = (ROOT / 'source/config/config.yaml').read_text()
        if 'host: "127.0.0.1"' not in config or 'port: 54630' not in config:
            raise TrialError('本地 WeKnora 配置必须监听 127.0.0.1:54630。')
        if settings.get('DB_DRIVER') != 'sqlite' or settings.get('DISABLE_REGISTRATION') != 'true':
            raise TrialError('仅支持已完成初始化并关闭注册的独立 SQLite 实例。')
        env = {k: v for k, v in os.environ.items() if k in ('PATH', 'HOME', 'TMPDIR', 'LANG')}
        env.update(settings)
        with (ROOT / 'service.log').open('ab') as log:
            process = subprocess.Popen([str(BINARY)], cwd=BINARY.parent, env=env,
                                       stdout=log, stderr=log, start_new_session=True)
        (ROOT / 'pid').write_text(str(process.pid))
        print('已启动 WeKnora；启动不等于模型或索引已就绪。')


if __name__ == '__main__':
    try:
        main()
    except (TrialError, OSError, ValueError) as error:
        raise SystemExit(str(error))
