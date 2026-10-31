#!/usr/bin/env bash
# 健康检查：四端页面、API/engine 健康、根路径、actuator 暴露面、监听地址仅 127.0.0.1、版本信息。退出码 0=通过。
# shellcheck disable=SC2015  # A && B || C 用于日志分支，B 为 log 恒成功
set -euo pipefail
. "$(dirname "$0")/preview-common.sh" "$@"
if [ "$DRY_RUN" = 1 ]; then log "[dry-run] 读取 trial status 与 config.json 端口，curl 各入口，检查监听地址"; exit 0; fi
st="$(trial status)"; echo "$st" | grep -q '"state": "ready"' || die "预览未就绪：$st"
web="$(echo "$st" | python3 -c 'import json,sys;print(json.load(sys.stdin)["webUrl"])')"; api="$(port_of api)"
fail=0; warn=0
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1" || echo 000; }
chk() { c="$(code "$2")"; if [ "$c" = "$3" ]; then echo "  [OK]  $1 $2 → $c"; else echo "  [FAIL] $1 $2 → ${c}（期望 $3）"; fail=1; fi; }
echo "== 入口 =="
chk workspace "$web/workspace/" 200; chk tenant-admin "$web/tenant-admin/" 200; chk platform-admin "$web/platform-admin/" 200
if [ -f "$REPO/agent-admin/index.html" ]; then chk agent-admin "$web/agent-admin/" 200; chk agent-admin-api "$web/api/agent-admin/v1/" 401
else echo "  [留位] /agent-admin/ 与 /api/agent-admin/v1/**：代码就绪后启用（ADR-B8，PR 5b/7a）"; fi
echo "== 后端 =="
chk api-health "http://127.0.0.1:$api/actuator/health" 200
for p in env heapdump configprops beans; do c="$(code "http://127.0.0.1:$api/actuator/$p")"; case "$c" in 404|401|403) echo "  [OK]  /actuator/$p → $c";; *) echo "  [FAIL] /actuator/$p → $c"; fail=1;; esac; done
echo "== 根路径 =="
rc="$(code "$web/")"; loc="$(curl -s -o /dev/null -w '%{redirect_url}' --max-time 10 "$web/" || true)"
if [ "$rc" = 302 ] && echo "$loc" | grep -q '/workspace/'; then echo "  [OK]  / → 302 /workspace/"
else echo "  [已知差距] / → ${rc}（vite preview 仍提供历史 Demo；需代码改动，见方案②）"; warn=1; fi
echo "== 版本 =="
ct="$(curl -s -o /dev/null -w '%{content_type}' --max-time 10 "$web/version.json" || true)"
if echo "$ct" | grep -qi json; then curl -s "$web/version.json" | python3 -c '
import json,sys; d=json.load(sys.stdin); extra=set(d)-{"version","commit","buildTime","env"}
print("  [OK]  version.json 字段", sorted(d)) if not extra else (print("  [FAIL] 白名单外字段", sorted(extra)), sys.exit(1))' || fail=1
else echo "  [留位] /version.json 尚未实现（当前返回 ${ct}，SPA 回落）；PR 7/7a 实现；当前以 git HEAD $(cd "${REPO}" && git rev-parse --short HEAD) 为准"; fi
echo "== 监听地址（签字条件①：只允许 127.0.0.1） =="
check_listen "$LOGS/listen-health-$(date +%Y%m%d-%H%M%S).log" || fail=1
echo "== 模型/real 关闭（签字条件③） =="
mode="$(echo "$st" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("agentMode"),d.get("model"))')"
[ "$mode" = "off None" ] && echo "  [OK]  trial status agentMode=off, model=null" || { echo "  [FAIL] trial status: $mode"; fail=1; }
apipid=""; for p in $(instance_pids); do ps -o args= -p "$p" 2>/dev/null | grep -q 'workspace-api.*\.jar$' && apipid="$p"; done
if [ -n "$apipid" ] && [ -r "/proc/$apipid/environ" ]; then
  v="$(tr '\0' '\n' < "/proc/$apipid/environ" | grep -E '^AGENT_TASK_MODE=' || true)"   # 只取这一项，不打印其他环境
  [ "$v" = "AGENT_TASK_MODE=off" ] && echo "  [OK]  API 进程 $v" || { echo "  [FAIL] API 进程 ${v:-未设置}"; fail=1; }
elif [ -n "$apipid" ]; then
  v="$(ps eww -o command= -p "$apipid" 2>/dev/null | tr ' ' '\n' | grep -E '^AGENT_TASK_MODE=' || true)"
  [ "${v}" = "AGENT_TASK_MODE=off" ] && echo "  [OK]  API 进程 ${v}" || echo "  [注意] macOS 无法读取进程环境（${v}），以 trial status 为准"
fi
echo "  [留位] real.enabled：代码尚无此键（仅 S-07 文档），已导出占位 QUALITY_OPS_REAL_ENABLED=false；PR 实现后校验 403"
echo "== 私有文件权限（签字条件⑤） =="
check_perms || fail=1
echo "== parser =="
[ -e "$REPO/workers/parser/.venv" ] && echo "  [注意] KNOWLEDGE_ENABLED=true（存在 .venv）" || echo "  [OK]  KNOWLEDGE_ENABLED=false（fail closed）"
[ "${fail}" = 0 ] && log "健康检查通过（已知差距 ${warn} 项）" || log "健康检查未通过"
exit "$fail"
