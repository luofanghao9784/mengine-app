# CT-005 Mac 本机预览脚本 + smoke workflow + 账号种子

状态：待执行　｜　分支：`codex/ct-005-mac-preview`　｜　**审查人（2026-10-30 起按 CT-007 两人审口径）：安全审查 + 发布验收 + 质量性能**（涉及密钥/认证 + 预览体验）　｜　基准：`origin/main` `050e414`（CT-004 已合入）

> DQ 裁定 v0.2（2026-10-30）：`/` 302→`/workspace/` 归 PR 7a；`version.json` 按现状；`QUALITY_OPS_REAL_ENABLED=false` 占位同意、正式键名待 PR4a；parser 加显式开关、首版默认关；只读角色定名 `dreamcore_ro`；密钥本机 600 文件、**不上钥匙串**；不做手机访问（手机截图用浏览器 390 宽模拟）；**Mac = Apple Silicon，Homebrew 以 `/opt/homebrew` 为主**（系统版本脚本自动探测，不为 Intel 另开一套）。
> **`.github/workflows/macos-preview-smoke.yml` 由老板账号推送；Codex 本单不推 workflow 文件**（组内令牌无 workflow 权限，同 CT-000/CT-004）。

## ① 目标与范围

- **目标**：落地老板 Mac（Apple Silicon）本机一键预览：`scripts/preview/` 七个脚本 + `preview-seed-accounts.py`；`scripts/local/trial.py` 增加 `--parser {auto,on,off}`（默认 `auto` 保持旧行为；预览 start 显式传 `off`）；另附 smoke workflow 全文，**由老板推**。
- **改哪些文件**：
  1. 新增 `scripts/preview/preview-{common,doctor,install,start,stop,health,uninstall}.sh`（全文见附录 A）
  2. 新增 `scripts/preview/preview-seed-accounts.py`（全文见附录 C；只用 `--bootstrap-admin` + 真实 API，不直写 SQL、不复用密码哈希）
  3. 修改 `scripts/local/trial.py`：加 `--parser`（精确变更见 ③）
  4. **老板另推**：`.github/workflows/macos-preview-smoke.yml`（附录 B；Codex **不许** `git add` 此文件）
- **不做什么**：
  - 不改 Java/engine/前端业务代码；不碰根路径 `/`（归 PR 7a）；不实现 `version.json`；不定 PR4a 正式 real 键名。
  - 不采购云/域名/Cloudflare；不开手机外网访问；不上钥匙串；不 `brew uninstall` 用户已有包。
  - **不推、不改** 任何 `.github/workflows/*`（workflow 交给老板）。
  - 不删共享 `.local/trial`；自测必须用独立 `PREVIEW_HOME`。
  - 任何文档/日志/PR/回报**不写口令**。

## ② 前置条件与分支名

- **⓪ 暂停令自查（CT-007，优先级最高）**：在老板 Mac 开 Codex 前，先确认 DQ/总负责人当前没有生效的暂停令；有暂停令或无法确认时，**禁止启动 Codex**，停下问 DQ。
- CT-004 已合入 main（基准 `050e414`）。
- 已完成 README 第 6 节工具准备（JDK 21、Node 按 `.node-version`、PostgreSQL 18、`gh`、`codex`）。
- 本单涉及密钥与认证、预览体验 → PR 后由**安全审查 + 发布验收 + 质量性能**审（CT-007 两人及以上，P0/P1 都拦；发布验收做体验走查）。
```bash
# ① 进仓库
cd ~/mengine
# ② 确认干净
git status
# ③ 回到 main 并更新
git switch main && git pull
# ④ 新建分支（业务落地用；本 docs PR 已用 docs/ct-005-mac-preview 开单）
git switch -c codex/ct-005-mac-preview
```

## ③ 完整 Codex 提示词

把下面整段粘贴给 Codex（推荐 `/model gpt-6.1-sol`，思考强度 medium）：

```
你在梦擎仓库分支 codex/ct-005-mac-preview 上工作。基准 origin/main。只做本单范围，不许碰清单见下。

【背景】
老板 Mac（已确认 Apple Silicon / arm64）要一键预览四端。生产仍只 Linux。DQ 裁定 v0.2：
- Homebrew 以 /opt/homebrew 为主；系统版本自动探测；不为 Intel 另开一套脚本。
- 只读角色定名 dreamcore_ro；密钥 0600 文件，不上钥匙串。
- parser 显式开关，首版默认关（KNOWLEDGE_ENABLED=false）。
- 不做手机访问；QUALITY_OPS_REAL_ENABLED=false 占位；version.json 按现状；根路径 / 归 PR 7a。
- .github/workflows/macos-preview-smoke.yml 由老板推，你禁止 git add / commit / push 任何 workflow。

【A. 新增 scripts/preview/*.sh】
按执行单附录 A 七个文件原样落盘（路径 scripts/preview/），chmod +x。要点：
- set -euo pipefail；兼容 macOS bash 3.2（无关联数组/mapfile/${x,,}）。
- PREVIEW_HOME：Mac 为 ~/Library/Application Support/DreamcorePreview；目录 0700、密钥文件 0600。
- doctor 只读预检，不自动 brew install；告警穿透工具（ngrok/cloudflared/frpc/zrok/bore/localtunnel/ssh -R/tailscale funnel）。
- start：拒绝 --live/--enable-live/--automatic-work；默认 --parser off；PREVIEW_PARSER=1 才 --parser on；PREVIEW_PHONE_LOCAL=1 才 --phone-local；**启动前复跑穿透检测，命中即 die**（doctor 仍仅告警）；就绪后 check_listen，非回环自动 stop；幂等建 dreamcore_ro。
- health：四端 200、actuator/health 200、敏感 actuator 非 200、agentMode=off、check_listen、check_perms；第四端入口不存在则 SKIP。
- uninstall：先 backup（可 --no-backup）、无 --yes 不删；不 brew uninstall、不删仓库。

【B. trial.py --parser】
在 scripts/local/trial.py：
1. 在 start() 前增加 knowledge_enabled(parser_mode)：
   installed = (WORKSPACE / 'workers/parser/.venv/bin/python').exists()
   parser_mode=='on' 且未安装 → raise TrialError
   auto → installed；on → True；off → False
2. start(..., parser_mode='auto')，把原
   'KNOWLEDGE_ENABLED': str((WORKSPACE / 'workers/parser/.venv/bin/python').exists()).lower(),
   改为
   'KNOWLEDGE_ENABLED': str(knowledge_enabled(parser_mode)).lower(),
3. argparse 增加 --parser choices=['auto','on','off'] default='auto'
4. 两处 start(...) 调用传入 parser_mode=args.parser
不要改 trial.py 其他行为。

【C. 账号种子 scripts/preview/preview-seed-accounts.py】
按附录 C。硬约束：
- 只用 trial --bootstrap-admin 产出的 #1 + 真实 HTTP API（CSRF+登录+邀请+加入+角色/状态），禁止直写 SQL、禁止复用密码哈希。
- 12 个真实账号（#1–#13 与 #15 中可建的）+ #14 待接受/已撤销邀请；已过期邀请若 API/TTL 无法造出则 SKIP 并打印「待定：invitation.ttl-hours=72 固定」。
- #16/#17 AGENT_ADMIN：代码无端点则自动 SKIP 并提示「第四端未就绪」。
- 随机口令 secrets.token_urlsafe(18+) 写入 PREVIEW_HOME/secrets/seed-accounts.json（0600）；状态机 seed-state.json（0600）保证幂等。
- 登录有 LoginThrottle（15 分钟窗口），必须复用已登录会话，避免 429。
- 脚本与回报永不打印口令。

【D. workflow】
附录 B 全文是给老板的。你本单禁止创建或修改 .github/workflows/ 下任何文件。在 PR 描述里写：「workflow 请老板按附录 B 另推」。

【不许碰】
- .github/workflows/**
- apps/**、engine/**、dist/**、workers/parser 业务代码（只允许 trial.py 的 --parser）
- docs/architecture/**、共享 .local/trial/**
- 任何含口令的提交

【验收命令（预期）】
export DREAMCORE_REPO="$PWD"
export PREVIEW_HOME="/tmp/dreamcore-preview-ct005-$$"
# 1) shell 语法
bash -n scripts/preview/preview-*.sh
# 2) doctor（缺项以本机为准；有 JDK21+PG18+Node 应通过）
bash scripts/preview/preview-doctor.sh
# 3) dry-run
bash scripts/preview/preview-install.sh --dry-run
bash scripts/preview/preview-start.sh --dry-run
# 4) parser 开关（不真正连模型）
python3 scripts/local/trial.py start --help | grep -q -- '--parser'
# 5) 若本机可起实例（独立目录）：
bash scripts/preview/preview-install.sh
PREVIEW_PHONE_LOCAL=1 bash scripts/preview/preview-start.sh
bash scripts/preview/preview-health.sh   # 期望 exit 0；输出含 agentMode=off、监听 OK、权限 OK
python3 scripts/preview/preview-seed-accounts.py --instance "$PREVIEW_HOME/instance" --secrets "$PREVIEW_HOME/secrets"
# 再跑一次应全部 SKIP-已完成
bash scripts/preview/preview-stop.sh
bash scripts/preview/preview-uninstall.sh --yes --no-backup
# 6) 自检 diff
git status; git diff --stat
# 只应出现：scripts/preview/*、scripts/local/trial.py、以及本单未改的 docs（docs 已由 docs PR 合入则不应再改）
# 禁止出现 .github/workflows/

【做完输出】
- git diff --stat 与关键 hunk
- 验收命令实际输出（打码口令）
- 若某步 SKIP/待定，列清单
```

## ④ 推荐模型与思考强度

- 模型：`gpt-6.1-sol`（`/model` 选择）
- 思考强度：**medium**（主要是落盘脚本与小改 trial.py，逻辑已由 DQ 裁定）

## ⑤ 预计耗时

- Codex 落盘 + trial.py 小改：20–40 分钟
- 本地 doctor/dry-run/起停/种子：30–60 分钟（视首次 `npm ci`/`trial:build`）
- 老板推 workflow + Actions macos smoke：约 45 分钟/矩阵行

## ⑥ 跑完如何提交

```bash
cd ~/mengine
# 确认无 workflow
git status
git diff --stat | grep -i workflow && echo 'ERROR: 不得改 workflow' && exit 1
# 测试（见 ③ 验收命令）通过后：
git add scripts/preview scripts/local/trial.py
git commit -m "$(cat <<'EOF'
feat(preview): Mac 本机预览脚本、parser 开关与账号种子

DQ 裁定 v0.2：Apple Silicon /opt/homebrew；dreamcore_ro；密钥 600 文件；
parser 默认 off；workflow 由老板另推。
EOF
)"
git push -u origin codex/ct-005-mac-preview
# 开 PR（不要 auto-merge）
gh pr create --base main --head codex/ct-005-mac-preview \
  --title "feat(preview): CT-005 Mac 本机预览脚本与账号种子" \
  --body "$(cat <<'EOF'
## 摘要
落地 `scripts/preview/` 与 `preview-seed-accounts.py`，并为 `trial.py` 增加 `--parser`（预览默认 off）。

## 审查
- 需**测试**本地起停/健康检查
- 需**安全审查**（密钥文件 600、只听 127.0.0.1、禁止穿透、agentMode=off）
- **不要自动合并**

## Workflow（老板另推）
本 PR **不含** `.github/workflows/macos-preview-smoke.yml`。请老板按 `docs/codex-tasks/CT-005-mac-preview.md` 附录 B 用本人账号推送（需 `workflow` scope）。

## DQ 裁定摘要
Mac=Apple Silicon `/opt/homebrew`；`dreamcore_ro`；不上钥匙串；无手机访问；parser 默认关；`/` 归 PR 7a；`version.json` 现状；`QUALITY_OPS_REAL_ENABLED=false` 占位。
EOF
)"
```
网页备用：https://github.com/luofanghao9784/mengine/compare/main...codex/ct-005-mac-preview

**老板推 workflow（Codex 不做）**：
```bash
# 老板本人账号，且 gh auth refresh -s workflow
cd ~/mengine
git switch main && git pull
git switch -c boss/macos-preview-smoke
# 将附录 B 存为 .github/workflows/macos-preview-smoke.yml
git add .github/workflows/macos-preview-smoke.yml
git commit -m "ci(preview): 新增 macos-preview-smoke（workflow_dispatch）"
git push -u origin boss/macos-preview-smoke
gh pr create --base main --title "ci(preview): macos-preview-smoke" --body "CT-005 附录 B；仅 workflow_dispatch；contents:read"
```

## ⑦ 失败/卡住时怎么办

| 症状 | 动作 |
|---|---|
| `git status` 不干净 | `git stash push -u -m "ct-005-before"`，完成后 `git stash pop` |
| doctor 缺 JDK/PG/Node | 按提示手工 brew/fnm 安装，**不要**让脚本自动装 |
| start 180s 超时 | 已自动 stop；看 `$PREVIEW_HOME/logs/trial-supervisor.log` 发 DQ |
| 监听非回环 | 脚本应已自动 stop；把 `listen-*.log` 发 DQ |
| 种子 429 LOGIN_THROTTLED | 确认会话复用；等 15 分钟窗口或换独立实例 |
| 过期邀请造不出 | 标 SKIP-待定（TTL=72h 固定）；不要改生产 TTL |
| AGENT_ADMIN 无 API | SKIP 并提示；不要直写 SQL |
| push 碰 workflow 被拒 | 立刻 `git restore --staged .github` 并移出提交；workflow 交老板 |
| push rejected | `git pull --rebase` 再推；冲突则停下发 DQ |
| 禁止 | force push、`reset --hard`、直推 main、在回报里写口令 |

回滚：`git switch main && git branch -D codex/ct-005-mac-preview`（未合入时）；已合入则 `git revert`；本机 `preview-uninstall.sh --yes`。

---

## 附录 A — `scripts/preview/*.sh` 全文

### `preview-common.sh`

```bash
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
    [ "$_m" = 700 ] && echo "  [OK]  目录 $_m $_d" || { echo "  [FAIL] 目录 $_m $_d（应 700）"; _bad=1; }
  done
  for _f in "$INSTANCE"/*.json "$SECRETS"/* "$REPO"/.local/model-private/*; do
    [ -f "$_f" ] || continue
    _m="$(stat -c '%a' "$_f" 2>/dev/null || stat -f '%Lp' "$_f")"
    [ "$_m" = 600 ] && echo "  [OK]  文件 $_m $(basename "$_f")" || { echo "  [FAIL] 文件 $_m $_f（应 600）"; _bad=1; }
  done
  return "$_bad"
}
```

### `preview-doctor.sh`

```bash
#!/usr/bin/env bash
# 预检：只读检查，不安装、不改动任何东西。退出码 0=全部满足，1=有缺项。
# shellcheck disable=SC2015  # A && B || C 用于日志分支，B 为 log 恒成功
set -euo pipefail
. "$(dirname "$0")/preview-common.sh" "$@"
fail=0
ok()  { printf '  [OK]  %s\n' "$*"; }
bad() { printf '  [缺]  %s\n' "$*"; fail=1; }
log "doctor：OS=$OS_NAME $(uname -m)  REPO=$REPO  PREVIEW_HOME=$PREVIEW_HOME"
[ -f "$REPO/scripts/local/trial.py" ] && ok "仓库 $(cd "$REPO" && git rev-parse --short HEAD 2>/dev/null)" || bad "找不到仓库 scripts/local/trial.py（设 DREAMCORE_REPO）"
if [ "$OS_NAME" = "Darwin" ]; then
  command -v brew >/dev/null 2>&1 && ok "Homebrew $BREW_PREFIX（Apple Silicon /opt/homebrew）" || bad "Homebrew 未装：见 https://brew.sh（本机按 Apple Silicon，路径 /opt/homebrew）"
  [ -x /usr/bin/sandbox-exec ] && ok "sandbox-exec 存在（parser macOS 沙箱前提）" || bad "无 /usr/bin/sandbox-exec，parser 将 fail closed"
fi
if detect_java && java -version 2>&1 | grep -Eq 'version "21'; then ok "Java 21"; else bad "需要 JDK 21（Mac：brew install openjdk@21；Linux：Temurin 21）"; fi
want_node="$(cat "$REPO/.node-version" 2>/dev/null || echo '?')"
have_node="$(node -v 2>/dev/null | sed 's/^v//' || true)"
if [ "$have_node" = "$want_node" ]; then ok "Node $have_node"; elif [ -n "$have_node" ] && [ "${have_node%%.*}" = "${want_node%%.*}" ]; then ok "Node $have_node（.node-version=$want_node，主版本一致；CI 要求严格相等）"; else bad "Node 需 $want_node（建议 fnm/nvm 按 .node-version 安装），当前 ${have_node:-无}"; fi
if command -v python3 >/dev/null 2>&1 && python3 -c 'import sys;sys.exit(0 if sys.version_info>=(3,9) else 1)'; then ok "Python $(python3 -c 'import platform;print(platform.python_version())')"; else bad "需要 Python 3.9+"; fi
if detect_pg_bin; then
  v="$("$POSTGRES_BIN/initdb" --version 2>/dev/null | awk '{print $NF}')"
  case "$v" in 18*) ok "PostgreSQL 服务端 $v（POSTGRES_BIN=$POSTGRES_BIN）";; *) bad "initdb 版本 $v，需要 18";; esac
  [ -x "$POSTGRES_BIN/pg_ctl" ] && [ -x "$POSTGRES_BIN/psql" ] || bad "POSTGRES_BIN 下缺 pg_ctl/psql"
else bad "缺 PostgreSQL 18 服务端（Mac：brew install postgresql@18，无需 brew services 启动；Linux：apt.postgresql.org postgresql-18）"; fi
command -v curl >/dev/null 2>&1 && ok "curl" || bad "缺 curl"
[ -d "$INSTANCE" ] && ok "已有预览实例 $INSTANCE（重复安装将复用，不清数据）" || ok "尚无预览实例（首次安装）"
avail_kb="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"; [ "$avail_kb" -gt 5242880 ] && ok "磁盘剩余 $((avail_kb/1048576))G" || bad "磁盘剩余 <5G"
# 签字条件②：禁止穿透/局域网共享。发现即告警（不阻断安装，但须人工关闭后再 start）
# shellcheck disable=SC2009  # 需匹配完整命令行（ssh -R），pgrep 跨平台参数不一致
tun="$(ps -axo args= 2>/dev/null | grep -Ei '^([^ ]*/)?(ngrok|cloudflared|frpc|frps|zrok|bore|localtunnel|lt|inlets|sshuttle)( |$)|^([^ ]*/)?ssh .*-R ' | grep -v grep || true)"
if [ -n "$tun" ]; then echo "  [告警] 发现穿透/转发进程（预览期禁止，请关闭）："; echo "$tun" | cut -c1-120 | sed 's/^/          /'; else ok "未发现 ngrok/cloudflared/frpc/zrok/bore/localtunnel/ssh -R 等穿透进程"; fi
if command -v tailscale >/dev/null 2>&1; then
  if tailscale funnel status 2>/dev/null | grep -qiE 'https?://'; then echo "  [告警] tailscale funnel/serve 正在对外发布，请 tailscale funnel reset"; else ok "tailscale funnel 未发布"; fi
fi
[ "$fail" = 0 ] && log "doctor 通过" || log "doctor 未通过：按上面 [缺] 项安装后重试（install 不会自动 brew install）"
exit "$fail"
```

### `preview-install.sh`

```bash
#!/usr/bin/env bash
# 安装：预检 → 依赖安装（仅仓库内 node_modules）→ 构建（commit 未变则跳过）→ 建私有目录。
# shellcheck disable=SC2015  # A && B || C 用于日志分支，B 为 log 恒成功
# 不执行 brew install（只给指引）；不默认安装 parser venv（fail closed）。幂等。
# 用法：preview-install.sh [--dry-run] [--with-parser] [--force-build]
set -euo pipefail
. "$(dirname "$0")/preview-common.sh" "$@"
WITH_PARSER=0; FORCE=0
for a in "$@"; do case "$a" in --with-parser) WITH_PARSER=1;; --force-build) FORCE=1;; --dry-run) ;; *) die "未知参数 $a";; esac; done
mkpriv "$PREVIEW_HOME"; for d in "$SECRETS" "$LOGS" "$BACKUPS" "$STATE"; do mkpriv "$d"; done
bash "$(dirname "$0")/preview-doctor.sh" || { [ "$DRY_RUN" = 1 ] && log "[dry-run] doctor 未通过，真跑时此处中止" || die "doctor 未通过"; }
detect_java || true; detect_pg_bin || true
head="$(cd "$REPO" && git rev-parse HEAD)"
stamp="$STATE/build-commit"
if [ "$FORCE" = 0 ] && [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$head" ] && [ -f "$REPO/apps/api/target/workspace-api-0.1.0-SNAPSHOT.jar" ] && [ -f "$REPO/dist/index.html" ]; then
  log "构建产物与 HEAD $head 一致，跳过构建"
elif [ "$FORCE" = 0 ] && [ -f "$REPO/apps/api/target/workspace-api-0.1.0-SNAPSHOT.jar" ] && [ -f "$REPO/engine/dist/main.js" ] && [ -z "$(cd "$REPO" && git status --porcelain --untracked-files=no)" ] && [ "${PREVIEW_TRUST_EXISTING_BUILD:-0}" = 1 ]; then
  log "PREVIEW_TRUST_EXISTING_BUILD=1：复用已有构建产物（共享电脑自测用，避免改写共享工作树）"
  [ "$DRY_RUN" = 1 ] || echo "$head" > "$stamp"
else
  run bash -c "cd '$REPO' && npm ci --no-audit --no-fund"
  run bash -c "cd '$REPO' && npm --prefix engine ci --no-audit --no-fund"
  run bash -c "cd '$REPO' && npm run trial:build"
  [ "$DRY_RUN" = 1 ] || echo "$head" > "$stamp"
fi
if [ "$WITH_PARSER" = 1 ]; then
  run bash -c "cd '$REPO' && python3 scripts/knowledge/setup.py"
else
  log "未安装 parser venv：start 默认 --parser off，与本机 .venv 无关（fail closed）"
  [ -e "$REPO/workers/parser/.venv" ] && log "提示：工作树已有 workers/parser/.venv；start 仍默认 --parser off，与本机 .venv 无关"
fi
log "安装完成。下一步：preview-start.sh"
```

### `preview-start.sh`

```bash
#!/usr/bin/env bash
# 启动：后台运行 trial.py（只绑 127.0.0.1，模型 off），等待就绪，然后幂等创建只读 DB 角色。
# shellcheck disable=SC2015  # A && B || C 用于日志分支，B 为 log 恒成功
set -euo pipefail
. "$(dirname "$0")/preview-common.sh" "$@"
for a in "$@"; do case "$a" in --live|--enable-live|--automatic-work) die "预览禁止真实模型参数 $a（签字条件③）";; esac; done
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
PARSER_ARGS=(--parser off); [ "${PREVIEW_PARSER:-0}" = 1 ] && PARSER_ARGS=(--parser on)
PHONE_ARGS=(); [ "${PREVIEW_PHONE_LOCAL:-0}" = 1 ] && PHONE_ARGS=(--phone-local)
nohup python3 "$REPO/scripts/local/trial.py" start --directory "$INSTANCE" "${PARSER_ARGS[@]}" "${PHONE_ARGS[@]}" >> "$LOGS/trial-supervisor.log" 2>&1 &
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
log "只读角色 $RO_ROLE 已确保（口令文件 $pwfile，0600，未输出）"
```

### `preview-stop.sh`

```bash
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
```

### `preview-health.sh`

```bash
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
chk() { c="$(code "$2")"; if [ "$c" = "$3" ]; then echo "  [OK]  $1 $2 → $c"; else echo "  [FAIL] $1 $2 → $c（期望 $3）"; fail=1; fi; }
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
else echo "  [已知差距] / → $rc（vite preview 仍提供历史 Demo；需代码改动，见方案②）"; warn=1; fi
echo "== 版本 =="
ct="$(curl -s -o /dev/null -w '%{content_type}' --max-time 10 "$web/version.json" || true)"
if echo "$ct" | grep -qi json; then curl -s "$web/version.json" | python3 -c '
import json,sys; d=json.load(sys.stdin); extra=set(d)-{"version","commit","buildTime","env"}
print("  [OK]  version.json 字段", sorted(d)) if not extra else (print("  [FAIL] 白名单外字段", sorted(extra)), sys.exit(1))' || fail=1
else echo "  [留位] /version.json 尚未实现（当前返回 $ct，SPA 回落）；PR 7/7a 实现；当前以 git HEAD $(cd "$REPO" && git rev-parse --short HEAD) 为准"; fi
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
  [ "$v" = "AGENT_TASK_MODE=off" ] && echo "  [OK]  API 进程 $v" || echo "  [注意] macOS 无法读取进程环境（$v），以 trial status 为准"
fi
echo "  [留位] real.enabled：代码尚无此键（仅 S-07 文档），已导出占位 QUALITY_OPS_REAL_ENABLED=false；PR 实现后校验 403"
echo "== 私有文件权限（签字条件⑤） =="
check_perms || fail=1
echo "== parser =="
[ -e "$REPO/workers/parser/.venv" ] && echo "  [注意] KNOWLEDGE_ENABLED=true（存在 .venv）" || echo "  [OK]  KNOWLEDGE_ENABLED=false（fail closed）"
[ "$fail" = 0 ] && log "健康检查通过（已知差距 $warn 项）" || log "健康检查未通过"
exit "$fail"
```

### `preview-uninstall.sh`

```bash
#!/usr/bin/env bash
# 卸载：停止 → 默认先 pg_dump 备份（0600）→ 删除 PREVIEW_HOME 下的实例/密钥/日志。
# shellcheck disable=SC2015  # A && B || C 用于日志分支，B 为 log 恒成功
# 绝不 brew uninstall、不动用户已有 brew 包/系统 PG、不删仓库。需要 --yes 才真删。
# 用法：preview-uninstall.sh [--dry-run] [--yes] [--no-backup] [--keep-backups]
set -euo pipefail
. "$(dirname "$0")/preview-common.sh" "$@"
YES=0; BACKUP=1; KEEP=1
for a in "$@"; do case "$a" in --yes) YES=1;; --no-backup) BACKUP=0;; --purge-backups) KEEP=0;; --dry-run|--keep-backups) ;; *) die "未知参数 $a";; esac; done
[ -d "$PREVIEW_HOME" ] || { log "无预览目录，无需卸载"; exit 0; }
if [ "$DRY_RUN" = 1 ]; then run bash "$(dirname "$0")/preview-stop.sh" --dry-run; else bash "$(dirname "$0")/preview-stop.sh"; fi
if [ "$BACKUP" = 1 ] && [ -d "$INSTANCE/postgres" ]; then
  # trial 自带 backup.py 只对已停止实例备份（含 pg 数据与密码散列），输出 0600；密钥文件单独保存
  run bash -c "cd '$REPO' && umask 077 && python3 scripts/local/backup.py create --directory '$INSTANCE' --output '$BACKUPS/preview-$(date +%Y%m%d-%H%M%S).bundle'"
fi
[ "$YES" = 1 ] || { log "未带 --yes：只打印将删除的内容"; DRY_RUN=1; }
for d in "$INSTANCE" "$SECRETS" "$LOGS" "$STATE"; do run rm -rf "$d"; done
[ "$KEEP" = 0 ] && run rm -rf "$BACKUPS"
log "卸载完成（未卸载任何 brew 包；备份保留于 $BACKUPS，除非 --purge-backups）"
```

## 附录 B — `.github/workflows/macos-preview-smoke.yml`（**老板推，Codex 不推**）

```yaml
# 草稿：未进仓库。进仓库须按 docs/codex-tasks/ 执行单交老板用 Codex 落地，且需 DQ 批准新增 workflow。
# 目的：在 GitHub macOS runner 上跑 安装→启动→健康检查→停止→卸载，降低老板 Mac 首装失败风险。
name: macos-preview-smoke
on:
  workflow_dispatch: {}          # 仅手动触发；不挂 push/PR
permissions:
  contents: read
concurrency: { group: macos-preview-smoke, cancel-in-progress: true }
jobs:
  smoke:
    strategy:
      fail-fast: false
      matrix:
        os: [macos-14, macos-15]  # 均为 Apple Silicon（/opt/homebrew）；DQ 裁定不为 Intel 另开一套
    runs-on: ${{ matrix.os }}
    timeout-minutes: 45
    env:
      PREVIEW_HOME: ${{ runner.temp }}/dreamcore-preview
      DREAMCORE_REPO: ${{ github.workspace }}
    steps:
      - uses: actions/checkout@v4
        with: { persist-credentials: false }
      - uses: actions/setup-node@v4
        with: { node-version-file: .node-version, cache: npm }
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: '21', cache: maven }
      - name: PostgreSQL 18 服务端（不启动 brew services）
        run: brew install postgresql@18 && echo "POSTGRES_BIN=$(brew --prefix)/opt/postgresql@18/bin" >> "$GITHUB_ENV"
      - name: doctor
        run: bash scripts/preview/preview-doctor.sh
      - name: install（dry-run 后真跑；不装 parser venv → fail closed）
        run: |
          bash scripts/preview/preview-install.sh --dry-run
          bash scripts/preview/preview-install.sh
      - name: install 幂等（第二次应跳过构建）
        run: bash scripts/preview/preview-install.sh | tee /dev/stderr | grep -q '跳过构建'
      - name: start
        run: bash scripts/preview/preview-start.sh
      - name: health
        run: bash scripts/preview/preview-health.sh
      - name: stop
        if: always()
        run: bash scripts/preview/preview-stop.sh
      - name: 卸载前保存日志
        if: always()
        run: cp -R "$PREVIEW_HOME/logs" "$RUNNER_TEMP/preview-logs" || true
      - name: uninstall（含 pg_dump 备份）
        if: always()
        run: bash scripts/preview/preview-uninstall.sh --yes
      - name: 残留检查
        if: always()
        run: |
          ! pgrep -fl "workspace-api|engine/dist/main.js|vite.js preview|$PREVIEW_HOME" || { echo "有残留进程"; exit 1; }
      - name: 上传日志（不含密钥目录）
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: preview-logs-${{ matrix.os }}
          path: ${{ runner.temp }}/preview-logs/
          if-no-files-found: ignore
          retention-days: 7
```

## 附录 C — `scripts/preview/preview-seed-accounts.py` 要点与草稿

### API 端点（文件:行，基准 main；以方法名为准）
| 用途 | 方法/路径 | 代码位置 |
|---|---|---|
| 客户 CSRF | GET `/api/v1/auth/csrf` | `IdentityController` |
| 客户登录 | POST `/api/v1/auth/login` `{phone,password}` | 同上 |
| 平台 CSRF | GET `/api/platform-admin/v1/auth/csrf` | `PlatformIdentityController` |
| 平台登录 | POST `/api/platform-admin/v1/auth/login` `{username,password}` | 同上 |
| 邀员工 | POST `/api/platform-admin/v1/staff/invitations` | `PlatformStaffController` |
| 员工本地链 | GET `.../staff/invitations/{id}/local-link` | 同上 |
| 接受员工邀 | POST `.../auth/invitation/accept` | 同上 |
| 撤员工 | POST `.../staff/{id}/revoke` | 同上 |
| 开企业 | POST `/api/platform-admin/v1/tenants` `{requestId,name,adminPhone,...}`（只要 phone） | `PlatformAdminController` |
| 企业状态 | POST `.../tenants/{t}/status` | 同上 |
| 手机加入 | POST `/api/v1/auth/phone/challenges` / `local-code` / `accept` | `PhoneIdentityController` |
| 租户邀成员 | POST `/api/tenant-admin/v1/tenants/{t}/invitations` | `IdentityController` |
| 成员角色 | POST `/api/v1/tenants/{t}/governance/members/{a}/role` | `GovernanceController` |
| 成员/空间 | tenant-admin members/workspaces API | `TenantAdminController` |
| 账号全局停用 | POST `/api/platform-admin/v1/accounts/{id}/status` | `PlatformDirectoryController` |

邀请 TTL 固定 `dreamcore.invitation.ttl-hours=72`（`application.properties`）→ **已过期邀请无法经 API 造出**，种子对「过期」行 SKIP-待定。
`AGENT_ADMIN` 代码无命中 → #16/#17 自动 SKIP。

### 草稿实现

落地时按下列草稿整理为 `scripts/preview/preview-seed-accounts.py`（仅 stdlib；不打印口令）：

```python
#!/usr/bin/env python3
"""梦擎本机预览：账号种子（只走 --bootstrap-admin 产出的 #1 + 真实 HTTP API；不直写 SQL、不复用密码哈希）。

用法：python3 scripts/preview/preview-seed-accounts.py --instance <trial 实例目录> --secrets <私有目录> [--dry-run]
前提：实例已由 preview-start.sh 以 PREVIEW_PHONE_LOCAL=1（trial.py --phone-local）启动；只连 127.0.0.1。
幂等：进度记在 <secrets>/seed-state.json（0600）；重跑跳过已完成步骤，只做登录核验。
口令：每个账号 secrets.token_urlsafe(18) 随机生成，只写 <secrets>/seed-accounts.json（0600），绝不打印。
"""
import argparse, http.cookiejar, json, os, pathlib, secrets, sys, urllib.error, urllib.request, uuid

P = '/api/platform-admin/v1'
TA = '/api/tenant-admin/v1/tenants/'
# 号码用 +1 555-555-01xx（北美保留的虚构号段）；本地投递，不会发真实短信
def phone(n): return f'+1555555{n:04d}'

class SeedError(Exception): pass

def private_write(path, value):
    tmp = path.with_suffix('.tmp')
    fd = os.open(tmp, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as f: json.dump(value, f, ensure_ascii=False, indent=2)
    os.chmod(tmp, 0o600); os.replace(tmp, path)

def private_read(path, default):
    return json.loads(path.read_text()) if path.exists() else default

class Browser:
    def __init__(self, api):
        self.api = api
        self.o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def send(self, method, path, body=None, csrf_from=None, expect=(200, 201, 204)):
        headers = {'Content-Type': 'application/json'}
        if csrf_from:
            _, c = self.send('GET', csrf_from)
            headers[c.get('headerName', 'X-CSRF-TOKEN')] = c['token']
        req = urllib.request.Request(self.api + path, method=method, headers=headers,
                                     data=None if body is None else json.dumps(body).encode())
        try:
            with self.o.open(req, timeout=30) as r: status, text = r.status, r.read().decode()
        except urllib.error.HTTPError as e: status, text = e.code, e.read().decode()
        if status not in expect:
            # 只回显错误码，不回显请求体（可能含口令）
            code = ''
            try: code = json.loads(text).get('code', '')
            except Exception: pass
            raise SeedError(f'{method} {path} → {status} {code}')
        return status, (json.loads(text) if text else None)
    def customer(self, method, path, body=None, **kw): return self.send(method, path, body, '/api/v1/auth/csrf' if method != 'GET' else None, **kw)
    def platform(self, method, path, body=None, **kw): return self.send(method, path, body, P + '/auth/csrf' if method != 'GET' else None, **kw)

def rid(): return str(uuid.uuid4())

class Seeder:
    def __init__(self, instance, secrets_dir, dry):
        self.instance, self.dir, self.dry = instance, secrets_dir, dry
        cfg = json.loads((instance / 'config.json').read_text())
        self.api = f"http://127.0.0.1:{cfg['ports']['api']}"
        self.state_file, self.acc_file = secrets_dir / 'seed-state.json', secrets_dir / 'seed-accounts.json'
        self.state = private_read(self.state_file, {'done': {}, 'ids': {}})
        self.accounts = private_read(self.acc_file, {})
        self.report = []
        self.sessions = {}  # 复用已登录会话：登录有频控（每账号 15 分钟窗口，LoginThrottle.java:19-31）
    def save(self):
        if self.dry: return
        private_write(self.state_file, self.state); private_write(self.acc_file, self.accounts)
    def step(self, key, label, fn):
        if key in self.state['done']: self.report.append(('SKIP-已完成', key, label)); return
        if self.dry: self.report.append(('DRY-RUN', key, label)); return
        fn(); self.state['done'][key] = True; self.save(); self.report.append(('OK', key, label))
    def new_account(self, key, role, contact, realm):
        if key not in self.accounts:
            self.accounts[key] = {'role': role, 'login': contact, 'realm': realm, 'password': secrets.token_urlsafe(18)}
            self.save()
        return self.accounts[key]
    # —— 登录 ——
    def platform_admin(self):
        if '#1' in self.sessions: return self.sessions['#1']
        acc = json.loads((self.instance / 'accounts.json').read_text())['platform']
        b = Browser(self.api); b.platform('POST', P + '/auth/login', {'username': acc['loginName'], 'password': acc['password']})
        self.sessions['#1'] = b; return b
    def customer_login(self, key):
        if key in self.sessions: return self.sessions[key]
        a = self.accounts[key]; b = Browser(self.api)
        b.customer('POST', '/api/v1/auth/login', {'phone': a['login'], 'password': a['password']})
        self.sessions[key] = b; return b
    def outbox_token(self, invitation_id):
        return json.loads((self.instance / 'invitations' / f'{invitation_id}.json').read_text())['token']
    # —— 平台员工（#2 #3）——
    def staff(self, key, n, label, revoke=False):
        def run():
            a = self.new_account(key, label, phone(n), 'platform'); pa = self.platform_admin()
            _, inv = pa.platform('POST', P + '/staff/invitations', {'requestId': rid(), 'phone': a['login']})
            _, link = pa.platform('GET', P + f"/staff/invitations/{inv['id']}/local-link")
            token = link['path'].split('#invite=', 1)[1]
            r = Browser(self.api); r.platform('POST', P + '/auth/invitation/preview', {'token': token})
            _, ch = r.platform('POST', P + '/auth/invitation/challenge', {'token': token})
            _, code = r.send('GET', f"/api/v1/auth/phone/local-code/{ch['id']}")
            _, me = r.platform('POST', P + '/auth/invitation/accept', {'token': token, 'username': a['login'], 'password': a['password'],
                                                                      'displayName': label, 'challengeId': ch['id'], 'code': code['code']})
            self.state['ids'][key] = me['account']['id']
            if revoke:
                _, staff = pa.platform('GET', P + '/staff')
                row = next(s for s in staff if s['id'] == me['account']['id'])
                pa.platform('POST', P + f"/staff/{row['id']}/revoke", {'requestId': rid(), 'expectedVersion': row['version']})
        self.step(key, label, run)
    # —— 企业 + 首位负责人（#5 #6 #15）——
    def tenant(self, tkey, name, owner_key, n):
        def run():
            a = self.new_account(owner_key, f'{name} 负责人（TENANT_ADMIN+owner）', phone(n), 'customer'); pa = self.platform_admin()
            _, created = pa.platform('POST', P + '/tenants', {'requestId': rid(), 'name': name, 'adminPhone': a['login'], 'designateAuthorizationOwner': True})
            self.state['ids'][tkey] = created['tenant']['id']
            self.join(owner_key, created['invitation']['id'], owner=True)
        self.step(tkey, f'企业「{name}」+ 负责人', run)
    def join(self, key, invitation_id, owner=False):
        a = self.accounts[key]; token = self.outbox_token(invitation_id); c = Browser(self.api)
        c.customer('POST', '/api/v1/auth/phone/invitation', {'token': token})
        _, ch = c.customer('POST', '/api/v1/auth/phone/challenges', {'purpose': 'JOIN', 'token': token})
        _, code = c.send('GET', f"/api/v1/auth/phone/local-code/{ch['id']}")
        _, joined = c.customer('POST', '/api/v1/auth/phone/accept', {'requestId': rid(), 'token': token, 'displayName': a['role'][:80],
                               'password': a['password'], 'challengeId': ch['id'], 'code': code['code'], 'acceptResponsibility': owner})
        self.state['ids'][key] = joined['identity']['account']['id']
    def invite(self, admin_key, tkey, contact, spaces=()):
        b = self.customer_login(admin_key)
        _, inv = b.customer('POST', TA + self.state['ids'][tkey] + '/invitations', {'requestId': rid(), 'phone': contact, 'workspaceIds': list(spaces)})
        return b, inv
    def member(self, key, n, label, tkey='A', admin='#5'):
        def run():
            a = self.new_account(key, label, phone(n), 'customer'); _, inv = self.invite(admin, tkey, a['login']); self.join(key, inv['id'])
        self.step(key, label, run)
    def members(self, b, t):
        _, rows = b.customer('GET', TA + t + '/members?limit=100'); return {m['accountId']: m for m in rows}
    def run(self, agent_admin_ready):
        S = self.state['ids']
        self.step('#1', '首位平台管理员（--bootstrap-admin，仅核验登录）', lambda: self.platform_admin())
        self.staff('#2', 2, '第二位平台管理员')
        self.staff('#3', 3, '已撤权平台员工', revoke=True)
        self.tenant('A', '预览企业A', '#5', 5)
        self.tenant('B', '预览企业B', '#6', 6)
        self.member('#7', 7, '企业A 非负责人 TENANT_ADMIN（受限）')
        def promote():
            b = self.customer_login('#5'); m = self.members(b, S['A'])[S['#7']]
            b.customer('POST', f"/api/v1/tenants/{S['A']}/governance/members/{S['#7']}/role", {'requestId': rid(), 'expectedVersion': m['version'], 'role': 'TENANT_ADMIN'})
        self.step('#7-role', '#7 提升为 TENANT_ADMIN', promote)
        for k, n, label in (('#8', 8, '企业A MEMBER（空间成员）'), ('#9', 9, '企业A MEMBER + can_maintain'), ('#10', 10, '企业A 空间负责人'),
                            ('#11', 11, '企业A MEMBER 无共享空间（无权限）'), ('#12', 12, '企业A 已停用成员'), ('#13', 13, '全局停用账号')):
            self.member(k, n, label)
        def space():
            b = self.customer_login('#5')
            _, w = b.customer('POST', TA + S['A'] + '/workspaces', {'requestId': rid(), 'name': '预览共享空间', 'ownerId': S['#10'], 'description': '种子脚本创建'})
            S['space'] = w['id']
            for acct in ('#8', '#9'):
                _, cur = b.customer('GET', TA + S['A'] + f"/workspaces/{w['id']}")
                b.customer('POST', TA + S['A'] + f"/workspaces/{w['id']}/members/{S[acct]}", {'requestId': rid(), 'expectedVersion': cur['version'], 'enabled': True})
            _, cur = b.customer('GET', TA + S['A'] + f"/workspaces/{w['id']}")
            b.customer('POST', TA + S['A'] + f"/workspaces/{w['id']}/members/{S['#9']}/maintenance", {'requestId': rid(), 'expectedVersion': cur['version'], 'enabled': True})
        self.step('space', '共享空间（负责人 #10，成员 #8/#9，#9 可维护）', space)
        def disable_member():
            b = self.customer_login('#5'); m = self.members(b, S['A'])[S['#12']]
            b.customer('POST', TA + S['A'] + f"/members/{S['#12']}/status", {'requestId': rid(), 'expectedVersion': m['version'], 'status': 'DISABLED'})
        self.step('#12-disable', '#12 企业内停用', disable_member)
        def disable_account():
            pa = self.platform_admin(); _, d = pa.platform('GET', P + f"/accounts/{S['#13']}")
            pa.platform('POST', P + f"/accounts/{S['#13']}/status", {'requestId': rid(), 'expectedVersion': d['account']['version'], 'status': 'DISABLED', 'reason': '预览种子：全局停用用例'})
        self.step('#13-disable', '#13 平台全局停用', disable_account)
        def invitations():
            b, pend = self.invite('#5', 'A', phone(141)); S['inv-pending'] = pend['id']
            _, rev = b.customer('POST', TA + S['A'] + '/invitations', {'requestId': rid(), 'phone': phone(142), 'workspaceIds': []})
            b.customer('DELETE', TA + S['A'] + f"/invitations/{rev['id']}", csrf_from='/api/v1/auth/csrf'); S['inv-revoked'] = rev['id']
        self.step('#14', '邀请：待接受 + 已撤销', invitations)
        self.report.append(('SKIP-待定', '#14-expired', '已过期邀请：TTL 固定 72h（application.properties:33），trial 无覆盖口；见执行单待定项'))
        self.tenant('C', '预览企业C（将暂停）', '#15', 15)
        def suspend():
            pa = self.platform_admin(); _, d = pa.platform('GET', P + f"/tenants/{S['C']}")
            pa.platform('POST', P + f"/tenants/{S['C']}/status", {'requestId': rid(), 'expectedVersion': d['version'], 'status': 'SUSPENDED',
                        'internalReason': '预览种子：暂停用例', 'publicReason': '预览环境测试暂停'})
        self.step('C-suspend', '企业C 暂停（SUSPENDED）', suspend)
        def pending():
            pa = self.platform_admin()
            _, created = pa.platform('POST', P + '/tenants', {'requestId': rid(), 'name': '预览企业D（待开通）', 'adminPhone': phone(151), 'designateAuthorizationOwner': True})
            S['D'] = created['tenant']['id']
        self.step('D-pending', '企业D 待开通（PENDING，邀请不接受）', pending)
        if agent_admin_ready:
            self.report.append(('TODO', '#16/#17', 'AGENT_ADMIN 授权接口就绪后在此实现（PR 5b/7a）'))
        else:
            self.report.append(('SKIP-未就绪', '#16/#17', '代码中无 AGENT_ADMIN 角色（rg 0 命中），第四端就绪后重跑本脚本'))
        if not self.dry: self.verify()
    def verify(self):
        expect = {'#2': 200, '#3': 401, '#5': 200, '#6': 200, '#7': 200, '#8': 200, '#9': 200, '#10': 200, '#11': 200, '#12': 200, '#13': 401, '#15': 200}
        for k, want in expect.items():
            a = self.accounts.get(k)
            if not a: continue
            b = Browser(self.api)
            if a['realm'] == 'platform':
                st, _ = b.platform('POST', P + '/auth/login', {'username': a['login'], 'password': a['password']}, expect=range(100, 600))
                if st == 200: st, _ = b.send('GET', P + '/staff', expect=range(100, 600))
            else:
                st, _ = b.customer('POST', '/api/v1/auth/login', {'phone': a['login'], 'password': a['password']}, expect=range(100, 600))
            ok = st == want or (k == '#3' and st in (401, 403))
            self.report.append(('VERIFY-OK' if ok else 'VERIFY-FAIL', k, f'登录/访问 → {st}（预期 {want}）'))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--instance', type=pathlib.Path, required=True)
    ap.add_argument('--secrets', type=pathlib.Path, required=True)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--agent-admin-ready', action='store_true', help='第四端（AGENT_ADMIN）代码就绪时使用')
    a = ap.parse_args()
    a.secrets.mkdir(mode=0o700, parents=True, exist_ok=True); os.chmod(a.secrets, 0o700)
    s = Seeder(a.instance, a.secrets, a.dry_run)
    if not s.api.startswith('http://127.0.0.1:'): raise SystemExit('只允许 127.0.0.1')
    try: s.run(a.agent_admin_ready)
    except (SeedError, KeyError, StopIteration, OSError, ValueError, TypeError) as e:
        s.report.append(('FAIL', '-', f'{type(e).__name__}: {e}'))
    finally:
        for row in s.report: print('  [%s] %s %s' % row)
        print(f'账号与口令文件：{s.acc_file}（0600，未输出口令）')
    sys.exit(1 if any(r[0] in ('FAIL', 'VERIFY-FAIL') for r in s.report) else 0)

if __name__ == '__main__': main()
```

## 安全红线（七条，DQ 签字条件，必须满足）

1. **S1** API/引擎/PG/前端只听 `127.0.0.1`；start/health 用 lsof/ss 留证；非回环 → 失败并自动 stop。
2. **S2** 禁止内网穿透与对外共享（ngrok/cloudflared/frpc/zrok/bore/localtunnel/ssh -R/tailscale funnel 等）；doctor 告警；**start 前复跑穿透检测，命中即 die**。
3. **S3** 模型关、real 关：`AGENT_TASK_MODE=off`；拒绝 `--live`；占位 `QUALITY_OPS_REAL_ENABLED=false`（正式键名待 PR4a）。
4. **S4** 只上传自己提供、可信的文件；parser 仅有 macOS sandbox-exec 基础隔离。
5. **S5** 种子口令随机；账号/口令/密钥文件 **600**、目录 **700**；health 校验。
6. **S6** Mac 本机预览**不是**生产沙箱验收证据（sandbox-exec ≠ bwrap/systemd）。
7. **S7** AGENT_ADMIN ×2：第四端未就绪则自动跳过并提示，不得直写 SQL。

另：密钥不上钥匙串；不做手机访问；不为 Intel 另开一套脚本。
