#!/usr/bin/env bash
# 停止：走 trial.py stop（按实例锁/stop-request 退出，不按端口或 PID 杀其他程序），数据保留。
# shellcheck disable=SC2015  # A && B || C 用于日志分支，B 为 log 恒成功
set -euo pipefail
. "$(dirname "$0")/preview-common.sh" "$@"
[ -d "$INSTANCE" ] || { log "无预览实例，无需停止"; exit 0; }
if [ "$DRY_RUN" = 1 ]; then log "[dry-run] trial.py stop --directory $INSTANCE"; exit 0; fi
trial stop
pidf="$STATE/supervisor.pid"
if [ -f "$pidf" ]; then p="$(cat "$pidf")"; i=0
  while kill -0 "$p" 2>/dev/null && [ $i -lt 30 ]; do sleep 1; i=$((i+1)); done
  kill -0 "$p" 2>/dev/null && die "监督进程 $p 30s 未退出，请人工检查" ; rm -f "$pidf"; fi
# 残留检查：本实例 PG 数据目录不应再有 postmaster.pid
[ -f "$INSTANCE/postgres/postmaster.pid" ] && die "本实例 PostgreSQL 仍在运行" || log "已停止，无残留（数据保留在 $INSTANCE）"
