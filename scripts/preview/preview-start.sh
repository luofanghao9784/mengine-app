#!/usr/bin/env bash
# 启动：后台运行 trial.py（只绑 127.0.0.1，模型 off），等待就绪，然后幂等创建只读 DB 角色。
# shellcheck disable=SC2015  # A && B || C 用于日志分支，B 为 log 恒成功
set -euo pipefail
. "$(dirname "$0")/preview-common.sh" "$@"
for a in "$@"; do case "$a" in --live|--enable-live|--automatic-work) die "预览禁止真实模型参数 ${a}（签字条件③）";; esac; done
# 签字条件②：start 前复跑穿透检测（doctor 仅告警）；命中即 die——穿透可将 127.0.0.1 转出
tun="$(ps -axo args= 2>/dev/null | grep -Ei '^([^ ]*/)?(ngrok|cloudflared|frpc|frps|zrok|bore|localtunnel|lt|inlets|sshuttle)( |$)|^([^ ]*/)?ssh .*-R ' | grep -v grep || true)"
[ -z "$tun" ] || die "发现穿透/转发进程（签字条件②），请关闭后再 start"
detect_java || die "无 Java 21"; detect_pg_bin || die "无 PostgreSQL 18"
mkpriv "$PREVIEW_HOME"; mkpriv "$LOGS"; mkpriv "$SECRETS"
if [ -d "$INSTANCE" ] && trial status 2>/dev/null | grep -q '"running": true'; then log "预览已在运行，未重复启动"; exit 0; fi
if [ "$DRY_RUN" = 1 ]; then
  log "[dry-run] nohup trial.py start --directory $INSTANCE > $LOGS/trial-supervisor.log"
  log "[dry-run] 等待 status=ready（最长 180s）；随后 ensure_ro_role $RO_ROLE"; exit 0
fi
# DQ：parser 显式开关，首版默认 off；PREVIEW_PARSER=1 才开。PREVIEW_PHONE_LOCAL=1 传 --phone-local（种子脚本需要）。
START_ARGS=(--parser off); [ "${PREVIEW_PARSER:-0}" = 1 ] && START_ARGS=(--parser on)
[ "${PREVIEW_PHONE_LOCAL:-0}" = 1 ] && START_ARGS+=(--phone-local)
log "启动 shell: Bash ${BASH_VERSION}"
nohup python3 "$REPO/scripts/local/trial.py" start --directory "$INSTANCE" "${START_ARGS[@]}" >> "$LOGS/trial-supervisor.log" 2>&1 &
echo $! > "$STATE/supervisor.pid"; chmod 600 "$STATE/supervisor.pid"
i=0; while [ $i -lt 180 ]; do
  if trial status 2>/dev/null | grep -q '"state": "ready"'; then break; fi
  kill -0 "$(cat "$STATE/supervisor.pid")" 2>/dev/null || { tail -5 "$LOGS/trial-supervisor.log"; die "trial 监督进程已退出（已有私有日志），数据保留"; }
  sleep 1; i=$((i+1)); done
[ $i -lt 180 ] || { bash "$(dirname "$0")/preview-stop.sh"; die "180s 未就绪，已回滚停止"; }
ts="$(date +%Y%m%d-%H%M%S)"
if ! check_listen "$LOGS/listen-$ts.log" | tee -a "$LOGS/preview.log"; then
  log "监听地址不合规（签字条件①），自动停止"; bash "$(dirname "$0")/preview-stop.sh"; die "已停止：发现非 127.0.0.1 监听，证据 $LOGS/listen-$ts.log"
fi
log "就绪：$(trial status | python3 -c 'import json,sys;print(json.load(sys.stdin)["webUrl"])')/workspace/"

# —— 只读角色 dreamcore_ro（DQ 裁定）：CONNECT + USAGE + SELECT + 默认权限 ——
pwfile="$SECRETS/db-readonly.password"
if [ ! -f "$pwfile" ]; then (umask 077; python3 -c 'import secrets;print(secrets.token_urlsafe(32))' > "$pwfile"); fi
chmod 600 "$pwfile"
dbport="$(port_of database)"
# 管理口令只从 trial 私有 database.json 读入环境变量，不打印
PGPASSWORD="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["password"])' "$INSTANCE/database.json")" \
RO_PW="$(cat "$pwfile")" \
"$POSTGRES_BIN/psql" -h 127.0.0.1 -p "$dbport" -U dreamcore_trial -d dreamcore_trial -v ON_ERROR_STOP=1 -q -At \
  -v role="$RO_ROLE" >> "$LOGS/ro-role.log" 2>&1 <<'SQL'
\getenv ro_pw RO_PW
SELECT format('CREATE ROLE %I LOGIN', :'role') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role') \gexec
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'role', :'ro_pw') \gexec
SELECT format('ALTER ROLE %I SET default_transaction_read_only = on', :'role') \gexec
SELECT format('GRANT CONNECT ON DATABASE dreamcore_trial TO %I', :'role') \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'role') \gexec
SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I', :'role') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE dreamcore_trial IN SCHEMA public GRANT SELECT ON TABLES TO %I', :'role') \gexec
SQL
log "只读角色 ${RO_ROLE} 已确保（口令文件 ${pwfile}，0600，未输出）"
