#!/usr/bin/env bash
# 预检：只读检查，不安装、不改动任何东西。退出码 0=全部满足，1=有缺项。
# CT-006 E1/E2：Darwin 无 Homebrew 不算失败；缺工具优先提示 export JAVA_HOME/POSTGRES_BIN；禁止引导装 Homebrew。
# shellcheck disable=SC2015
set -euo pipefail
. "$(dirname "$0")/preview-common.sh" "$@"
fail=0
ok()  { printf '  [OK]  %s\n' "$*"; }
bad() { printf '  [缺]  %s\n' "$*"; fail=1; }
log "doctor：OS=${OS_NAME} $(uname -m)  REPO=${REPO}  PREVIEW_HOME=${PREVIEW_HOME}"
[ -f "${REPO}/scripts/local/trial.py" ] && ok "仓库 $(cd "${REPO}" && git rev-parse --short HEAD 2>/dev/null)" || bad "找不到仓库 scripts/local/trial.py（设 DREAMCORE_REPO）"
if [ "${OS_NAME}" = "Darwin" ]; then
  if command -v brew >/dev/null 2>&1; then
    ok "Homebrew ${BREW_PREFIX}"
  else
    ok "无 Homebrew（允许 JAVA_HOME/POSTGRES_BIN 指向已有 .local/tools；禁止安装 Homebrew）"
  fi
  [ -x /usr/bin/sandbox-exec ] && ok "sandbox-exec 存在（parser macOS 沙箱前提）" || bad "无 /usr/bin/sandbox-exec，parser 将 fail closed"
fi
if detect_java && java -version 2>&1 | grep -Eq 'version "21'; then
  ok "Java 21"
else
  bad "需要 JDK 21：export JAVA_HOME=.../java/Contents/Home（示例：\$HOME/Desktop/dreamcore-workspace/.local/tools/java/Contents/Home）"
fi
want_node="$(cat "${REPO}/.node-version" 2>/dev/null || echo '?')"
have_node="$(node -v 2>/dev/null | sed 's/^v//' || true)"
if [ "${have_node}" = "${want_node}" ]; then
  ok "Node ${have_node}"
elif [ -n "${have_node}" ] && [ "${have_node%%.*}" = "${want_node%%.*}" ]; then
  ok "Node ${have_node}（.node-version=${want_node}，主版本一致；CI 要求严格相等）"
else
  bad "Node 需 ${want_node}（将 node 放入 PATH，示例：\$HOME/Desktop/dreamcore-workspace/.local/tools/node/bin），当前 ${have_node:-无}"
fi
if command -v python3 >/dev/null 2>&1 && python3 -c 'import sys;sys.exit(0 if sys.version_info>=(3,9) else 1)'; then
  ok "Python $(python3 -c 'import platform;print(platform.python_version())')"
else
  bad "需要 Python 3.9+（放入 PATH）"
fi
if detect_pg_bin; then
  v="$("${POSTGRES_BIN}/initdb" --version 2>/dev/null | awk '$1=="initdb" && $2=="(PostgreSQL)" && $3 ~ /^[0-9]+([.][0-9]+)*$/ {print $3}')"
  v="${v:-}"
  case "${v}" in
    18|18.*) ok "PostgreSQL 服务端 ${v}（POSTGRES_BIN=${POSTGRES_BIN}）";;
    *) bad "initdb 版本 ${v}，需要 18：export POSTGRES_BIN=.../postgres/bin";;
  esac
  [ -x "${POSTGRES_BIN}/pg_ctl" ] && [ -x "${POSTGRES_BIN}/psql" ] || bad "POSTGRES_BIN 下缺 pg_ctl/psql：export POSTGRES_BIN=.../postgres/bin"
else
  bad "缺 PostgreSQL 18：export POSTGRES_BIN=.../postgres/bin（示例：\$HOME/Desktop/dreamcore-workspace/.local/tools/postgres/bin）；禁止安装 Homebrew"
fi
command -v curl >/dev/null 2>&1 && ok "curl" || bad "缺 curl"
[ -d "${INSTANCE}" ] && ok "已有预览实例 ${INSTANCE}（重复安装将复用，不清数据）" || ok "尚无预览实例（首次安装）"
avail_kb="$(df -Pk "${HOME}" | awk 'NR==2{print $4}')"; [ "${avail_kb}" -gt 5242880 ] && ok "磁盘剩余 $((avail_kb/1048576))G" || bad "磁盘剩余 <5G"
# 签字条件②：禁止穿透/局域网共享。发现即告警（不阻断安装，但须人工关闭后再 start）
# shellcheck disable=SC2009
tun="$(ps -axo args= 2>/dev/null | grep -Ei '^([^ ]*/)?(ngrok|cloudflared|frpc|frps|zrok|bore|localtunnel|lt|inlets|sshuttle)( |$)|^([^ ]*/)?ssh .*-R ' | grep -v grep || true)"
if [ -n "${tun}" ]; then
  echo "  [告警] 发现穿透/转发进程（预览期禁止，请关闭）："
  echo "${tun}" | cut -c1-120 | sed 's/^/          /'
else
  ok "未发现 ngrok/cloudflared/frpc/zrok/bore/localtunnel/ssh -R 等穿透进程"
fi
if command -v tailscale >/dev/null 2>&1; then
  if tailscale funnel status 2>/dev/null | grep -qiE 'https?://'; then
    echo "  [告警] tailscale funnel/serve 正在对外发布，请 tailscale funnel reset"
  else
    ok "tailscale funnel 未发布"
  fi
fi
[ "${fail}" = 0 ] && log "doctor 通过" || log "doctor 未通过：按上面 [缺] 项用 export JAVA_HOME/POSTGRES_BIN 补齐后重试（禁止 brew install）"
exit "${fail}"
