#!/usr/bin/env bash
# 梦擎 Mac 预览公共函数（草稿）。兼容 macOS bash 3.2 / Linux bash；由各脚本 source。
# shellcheck disable=SC2034  # 变量供 source 本文件的脚本使用
# shellcheck disable=SC2015  # A && B || C 用于日志分支，B 为 log 恒成功
# 不输出任何口令；所有私有文件 0600、目录 0700。
set -euo pipefail

DRY_RUN=0
for _a in "$@"; do [ "$_a" = "--dry-run" ] && DRY_RUN=1; done

OS_NAME="$(uname -s)"
REPO="${DREAMCORE_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)}"
[ -d "${DREAMCORE_REPO:-}" ] && REPO="$DREAMCORE_REPO"
if [ "$OS_NAME" = "Darwin" ]; then
  # DQ 裁定：老板 Mac = Apple Silicon；Homebrew 以 /opt/homebrew 为主。系统版本由 uname 自动探测，不为 Intel 另开一套脚本。
  PREVIEW_HOME="${PREVIEW_HOME:-$HOME/Library/Application Support/DreamcorePreview}"
  BREW_PREFIX="/opt/homebrew"
  [ -x "$BREW_PREFIX/bin/brew" ] || BREW_PREFIX="$(command -v brew >/dev/null 2>&1 && brew --prefix 2>/dev/null || echo /opt/homebrew)"
else
  PREVIEW_HOME="${PREVIEW_HOME:-$HOME/.local/share/dreamcore-preview}"
  BREW_PREFIX=""
fi
INSTANCE="$PREVIEW_HOME/instance"      # trial.py --directory（0700）
SECRETS="$PREVIEW_HOME/secrets"        # 只读角色口令等（0700，文件 0600）
LOGS="$PREVIEW_HOME/logs"
BACKUPS="$PREVIEW_HOME/backups"
STATE="$PREVIEW_HOME/state"
RO_ROLE="${PREVIEW_RO_ROLE:-dreamcore_ro}"   # DQ 裁定：定名 dreamcore_ro

log()  { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; [ -d "$LOGS" ] && printf '[%s] %s\n' "$(date '+%F %T')" "$*" >> "$LOGS/preview.log" || true; }
die()  { log "失败：$*"; exit 1; }
run()  { if [ "$DRY_RUN" = 1 ]; then log "[dry-run] $*"; else log "+ $*"; "$@"; fi; }
mkpriv() { if [ "$DRY_RUN" = 1 ]; then log "[dry-run] mkdir -m 700 $1"; else mkdir -p "$1"; chmod 700 "$1"; fi; }

# Homebrew 的 PG18 不在 PATH 默认位置；trial.py 通过 POSTGRES_BIN 找 initdb/pg_ctl/psql
detect_pg_bin() {
  if [ -n "${POSTGRES_BIN:-}" ]; then return 0; fi
  for d in "$BREW_PREFIX/opt/postgresql@18/bin" /usr/lib/postgresql/18/bin; do
    if [ -n "$d" ] && [ -x "$d/initdb" ]; then export POSTGRES_BIN="$d"; return 0; fi
  done
  return 1
}
detect_java() {
  if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then export PATH="$JAVA_HOME/bin:$PATH"; return 0; fi
  if [ "$OS_NAME" = "Darwin" ] && /usr/libexec/java_home -v 21 >/dev/null 2>&1; then
    JAVA_HOME="$(/usr/libexec/java_home -v 21)"; export JAVA_HOME PATH="$JAVA_HOME/bin:$PATH"; return 0; fi
  if [ -n "$BREW_PREFIX" ] && [ -x "$BREW_PREFIX/opt/openjdk@21/bin/java" ]; then
    export JAVA_HOME="$BREW_PREFIX/opt/openjdk@21" PATH="$BREW_PREFIX/opt/openjdk@21/bin:$PATH"; return 0; fi
  command -v java >/dev/null 2>&1
}
trial() { (cd "$REPO" && python3 scripts/local/trial.py "$@" --directory "$INSTANCE"); }
# 读 trial 私有 config.json 端口（不读口令）
port_of() { python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["ports"][sys.argv[2]])' "$INSTANCE/config.json" "$1"; }

# —— 安全签字条件（DQ 追加 2026-10-30）——
# ③ 强制模型/real 关闭：AGENT_TASK_MODE 为代码真实键（application.properties:57 dreamcore.tasks.agent-mode=${AGENT_TASK_MODE:off}）；
#    real.enabled 代码中尚无（仅 S-07 文档），QUALITY_OPS_REAL_ENABLED 为占位名，待 PR 定名后替换。
export AGENT_TASK_MODE=off
export QUALITY_OPS_REAL_ENABLED=false

# 本实例进程树（监督进程 + 子孙 + 守护化的 postgres）
instance_pids() {
  _pid="$(cat "$STATE/supervisor.pid" 2>/dev/null || true)"
  _pg="$(head -1 "$INSTANCE/postgres/postmaster.pid" 2>/dev/null || true)"
  _tree="$_pid $_pg"; _front="$_pid"
  while [ -n "$_front" ]; do _next=""
    for _c in $_front; do _next="$_next $( { pgrep -P "$_c" 2>/dev/null || true; } | tr '\n' ' ')"; done
    _front="$(echo "$_next" | xargs)"; _tree="$_tree $_front"; done
  echo "$_tree" | xargs
}
# ① 监听留证 + 判定：任何 0.0.0.0 / [::] / * 即失败。证据写入 $1（日志文件）。返回 0=全回环
check_listen() {
  _out="$1"; _bad=0; _n=0
  { echo "# 监听留证 $(date '+%F %T %z')  实例 pids: $(instance_pids)"
    if command -v lsof >/dev/null 2>&1; then echo "# 工具: lsof -iTCP -sTCP:LISTEN -nP"; lsof -iTCP -sTCP:LISTEN -nP 2>/dev/null || true
    else echo "# 工具: ss -ltnp（无 lsof 回退）"; ss -ltnp 2>/dev/null || true; fi; } > "$_out"
  chmod 600 "$_out"
  for _p in $(instance_pids); do
    if command -v lsof >/dev/null 2>&1; then _addrs="$(lsof -a -p "$_p" -iTCP -sTCP:LISTEN -nP 2>/dev/null | awk 'NR>1{print $9}' || true)"
    else _addrs="$(ss -ltnpH 2>/dev/null | { grep "pid=$_p," || true; } | awk '{print $4}')"; fi
    for _a in $_addrs; do _n=$((_n+1))
      case "$_a" in
        127.0.0.1:*|\[::1\]:*|\[::ffff:127.0.0.1\]:*) echo "  [OK]  pid $_p $(ps -o comm= -p "$_p" 2>/dev/null) $_a";;
        *) echo "  [FAIL] pid $_p $(ps -o comm= -p "$_p" 2>/dev/null) $_a 非回环（0.0.0.0/[::]/* 一律判失败）"; _bad=1;;
      esac; done; done
  [ "$_n" -gt 0 ] || { echo "  [FAIL] 未找到本实例任何监听（无法留证）"; _bad=1; }
  echo "  证据：$_out"
  return "$_bad"
}
# ⑤ 权限：目录 700、账号/口令/密钥文件 600；不符返回 1
check_perms() {
  _bad=0
  for _d in "$PREVIEW_HOME" "$INSTANCE" "$SECRETS" "$REPO/.local/model-private"; do
    [ -d "$_d" ] || continue
    _m="$(stat -c '%a' "$_d" 2>/dev/null || stat -f '%Lp' "$_d")"
    [ "$_m" = 700 ] && echo "  [OK]  目录 $_m $_d" || { echo "  [FAIL] 目录 $_m ${_d}（应 700）"; _bad=1; }
  done
  for _f in "$INSTANCE"/*.json "$SECRETS"/* "$REPO"/.local/model-private/*; do
    [ -f "$_f" ] || continue
    _m="$(stat -c '%a' "$_f" 2>/dev/null || stat -f '%Lp' "$_f")"
    [ "$_m" = 600 ] && echo "  [OK]  文件 $_m $(basename "$_f")" || { echo "  [FAIL] 文件 $_m ${_f}（应 600）"; _bad=1; }
  done
  return "$_bad"
}
