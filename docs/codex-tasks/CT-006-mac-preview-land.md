# CT-006 Mac 预览落地（脚本 / 种子 / smoke 入库）

状态：待执行　｜　分支：`codex/ct-006-mac-preview-land`　｜　**审查人（PR 后两人审）：质量性能 + 发布验收**　｜　基准：切单时最新 `origin/main`（须已含 CT-005 文档 #18+#20）

> **DQ 裁定（2026-10-30，大纲 OK + A–D）**  
> - **A** `.github/workflows/macos-preview-smoke.yml` **进本落地 PR**（交付运维在老板 Mac 用已有 `workflow` scope 推）。  
> - **B** 索引：CT-005 标「已文档（附录规格）；落地改走 CT-006」。  
> - **C** 无 brew（写死）：Darwin 无 Homebrew 时，`preview-doctor.sh` **不得**因缺 brew 失败；只检查 `java`（21）、`node`（与 `.node-version` 主版本一致）、`initdb`/`pg_ctl`/`psql`（经 `POSTGRES_BIN`，版本 18）、`python3`≥3.9、`curl`、磁盘、sandbox-exec（Darwin）可用。允许 `JAVA_HOME` / `POSTGRES_BIN` 指向仓库内或 `Desktop` 下已有 `.local/tools`。**禁止安装 Homebrew**，禁止脚本 `brew install`。  
> - **D** 审查人=**质量性能 + 发布验收**（纯文档两人审，CT-007）；本纯文档 PR 不另开安全审。落地 PR 若含密钥/认证种子，按 CT-007 配人（脚本/CI=质量性能+架构逻辑；涉密钥另加安全审查），由 DQ 在开跑前确认。  
> - 正确仓仅 `~/Desktop/dreamcore-luofanghao9784`（origin=`luofanghao9784/dreamcore-workspace`）。禁止写上游 `dimmm1125-coder`，禁止碰 `~/Desktop/dreamcore-workspace` 的 git。  
> - Codex 使用绝对路径（见下）。总负责人不代跑；质量性能 + 发布验收两人审通过后由**交付运维本人**上 Mac 落地。  
> - 继承 CT-005 DQ 裁定 v0.2：Apple Silicon；`dreamcore_ro`；密钥 600 不上钥匙串；parser 默认 off；不做手机访问；`/` 归 PR 7a；`version.json` 现状；`QUALITY_OPS_REAL_ENABLED=false` 占位。

规格底稿：`docs/codex-tasks/CT-005-mac-preview.md`（附录 A/B/C，含 #20 REPO 路径勘误）。本单=附录真正入库 + 无 brew 写死规则。

## ① 目标与范围

- **目标**：将 CT-005 附录中的七个预览脚本、`preview-seed-accounts.py`、`trial.py --parser`、以及 `macos-preview-smoke.yml` 落进 `luofanghao9784/dreamcore-workspace`，使老板 Mac（可无 brew）能 doctor → install → start → health → seed → stop → uninstall。
- **改哪些文件**：
  1. 新增 `scripts/preview/preview-common.sh`
  2. 新增 `scripts/preview/preview-doctor.sh`（**必须含无 brew 分支，见下「doctor 写死规则」**）
  3. 新增 `scripts/preview/preview-install.sh`
  4. 新增 `scripts/preview/preview-start.sh`
  5. 新增 `scripts/preview/preview-stop.sh`
  6. 新增 `scripts/preview/preview-health.sh`
  7. 新增 `scripts/preview/preview-uninstall.sh`
  8. 新增 `scripts/preview/preview-seed-accounts.py`
  9. 修改 `scripts/local/trial.py`（仅 `--parser {auto,on,off}`，同 CT-005 ③）
  10. 新增 `.github/workflows/macos-preview-smoke.yml`（CT-005 附录 B；`workflow_dispatch`；macos-14/15；`contents: read`）
  11. 修改 `docs/codex-tasks/README.md`（CT-005→已文档；登记 CT-006；§1.3 指向本单）——可随本**纯文档 PR**先改，落地 PR 不再重复除非需同步状态。
- **不做什么**：
  - 不改 Java/engine/前端业务；不碰 `/`；不实现 `version.json`；不定 PR4a real 键名。
  - 不采购云/域名；不上钥匙串；不 `brew uninstall`；**不安装 Homebrew**；不自动 `brew install`。
  - 不对上游写操作；不删共享 `.local/trial`；自测独立 `PREVIEW_HOME`。
  - 回报/日志/PR **不写口令**。
  - 禁止 gh issue create/comment，禁止在任何仓库开或评论 Issue；只允许 gh pr create -R luofanghao9784/dreamcore-workspace。
  - **本纯文档 PR**：只改 `docs/codex-tasks/**`；不落脚本、暂不跑 Codex。

### doctor 写死规则（Darwin / 无 brew）

落地时 `preview-doctor.sh` 必须实现（逻辑，不可含糊）：

```bash
# Darwin：
if command -v brew >/dev/null 2>&1; then
  ok "Homebrew $BREW_PREFIX"
else
  ok "无 Homebrew（允许 JAVA_HOME/POSTGRES_BIN 指向已有 .local/tools；禁止安装 Homebrew）"
fi
# 无论有无 brew，以下缺一则 bad（不是「人工确认后继续」）：
# - java 21（detect_java / JAVA_HOME）
# - node 与 .node-version 主版本一致
# - POSTGRES_BIN 下 initdb/pg_ctl/psql 且 initdb 版本 18*
# - python3 ≥ 3.9、curl、磁盘≥5G、Darwin 上 sandbox-exec
# 缺项提示优先：export JAVA_HOME=… / export POSTGRES_BIN=…（示例见下）；禁止提示「请安装 Homebrew」。
```

本机预览环境变量（示例，路径可按实测改，语义固定）：

```bash
export DREAMCORE_REPO="$HOME/Desktop/dreamcore-luofanghao9784"
export JAVA_HOME="${JAVA_HOME:-$HOME/Desktop/dreamcore-workspace/.local/tools/java/Contents/Home}"
export POSTGRES_BIN="${POSTGRES_BIN:-$HOME/Desktop/dreamcore-workspace/.local/tools/postgres/bin}"
export PATH="$JAVA_HOME/bin:$POSTGRES_BIN:$PATH"
```

说明：`.local/tools` 可在旁侧目录；**只读用二进制**，禁止对该旁侧仓做 git 写。CI runner 仍按附录 B `brew install postgresql@18`。

### 附录落盘时必改相对 CT-005

| ID | 项 | 要求 |
|---|---|---|
| E1 | doctor brew | 按上节写死；无 brew ≠ 失败 |
| E2 | 缺工具文案 | 优先 export 已有路径；禁引导装 Homebrew |
| E3 | 仓路径 | 一律 `~/Desktop/dreamcore-luofanghao9784`；`git remote` 校验 `luofanghao9784/dreamcore-workspace` |
| E4 | Codex | 绝对路径 `$CODEX`（见 ②） |
| E5 | workflow | **能进本单的进**：落地 PR 优先含 `macos-preview-smoke.yml`（须 `workflow` scope）。**不能进的剔除并写后续 CT**：若 push 因缺 scope 被拒，则从本 PR 剔除 `.github/workflows/**`，在本执行单/PR 描述写明「workflow 改走后续 CT-0xx（仅 macos-preview-smoke，老板账号推）」，并开/更新该后续 CT 草稿跟踪；不得静默剔除且不写后续。刷新 scope 后也可补回同 PR。 |
| E6 | REPO | 保持 #20：`scripts/preview/../..`，勿硬拼 `/dreamcore` |

其余脚本/种子行为以 CT-005 附录 A/C 与 DQ v0.2 为准（穿透 start 前 die；parser 默认 off；密钥 600；只听 127.0.0.1 等）。

## ② 前置条件与分支名

- **⓪ 暂停令自查（第一步，优先级最高）**：开 Codex / 上 Mac 前确认**没有暂停令**；有暂停令或无法确认 → **立刻停**，问 DQ。暂停期间禁止任何 Codex。
- CT-005 文档已在 main；本执行单（CT-006）纯文档已合入。
- 本纯文档 PR / 随后落地 PR：经 **质量性能 + 发布验收** 两人审（过渡期正式 Comment「放行/可合」）通过后，交付运维上 Mac 落地。
- 老板 Mac：Apple Silicon；正确仓已存在；Codex 已登录；`gh` 为 `luofanghao9784` 且落地时**须**含 `workflow` scope（否则按 E5 报 DQ）。

```bash
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/dreamcore-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/dreamcore-workspace' || { echo 'ERROR: 错误 remote，停'; exit 1; }
git status
git switch main && git pull
git switch -c codex/ct-006-mac-preview-land
```

## ③ 完整 Codex 提示词

把下面整段交给 Codex（推荐 `$CODEX` + 模型 `gpt-6.1-sol`，思考强度 medium；sandbox/审批参数与组内既有 CT 跑法一致）：

```
你在梦擎仓库分支 codex/ct-006-mac-preview-land 上工作。基准 origin/main。只做本单范围。

【背景】
按 docs/codex-tasks/CT-006-mac-preview-land.md 与 CT-005 附录 A/B/C（含 #20）落地 Mac 预览。DQ 裁定：
- Darwin 无 Homebrew：doctor 不因缺 brew 失败；只检查 java21/node/POSTGRES_BIN(initdb|pg_ctl|psql 18)/python3.9+/curl/磁盘/sandbox-exec；允许 JAVA_HOME、POSTGRES_BIN 指向已有 .local/tools；禁止安装 Homebrew、禁止 brew install。
- 仓仅 luofanghao9784/dreamcore-workspace；禁止写上游。
- dreamcore_ro；密钥 0600；parser 默认 off；workflow 进本 PR。

【A. scripts/preview/*.sh】
按 CT-005 附录 A 落盘七文件，chmod +x，并强制应用 CT-006 doctor 写死规则（E1/E2）与 REPO=../..（E6）。
start：拒绝 --live/--enable-live/--automatic-work；默认 --parser off；PREVIEW_PARSER=1→on；PREVIEW_PHONE_LOCAL=1→--phone-local；启动前穿透检测命中即 die；check_listen 非回环则 stop；幂等建 dreamcore_ro。
兼容 macOS bash 3.2；PREVIEW_HOME 默认 ~/Library/Application Support/DreamcorePreview。

【B. trial.py --parser】
同 CT-005 ③：knowledge_enabled；--parser auto|on|off default auto；两处 start 传 parser_mode。不改其他行为。

【C. preview-seed-accounts.py】
按 CT-005 附录 C；bootstrap-admin + 真实 HTTP API；不直写 SQL；口令只写 secrets（0600）；不打印口令。

【D. workflow】
新增 .github/workflows/macos-preview-smoke.yml = CT-005 附录 B（能进则进）。若缺 workflow scope：剔除 workflow 文件，输出中写明改走后续 CT（仅 smoke yml），不得假装本单已含 workflow。

【不许碰】
apps/**、engine/**、dist/**、workers/parser 业务（除 trial.py --parser）、docs/architecture/**、.local/trial/**、含口令提交、安装 Homebrew、force push/reset --hard/直推 main。
禁止 gh issue create/comment，禁止在任何仓库开或评论 Issue；只允许 gh pr create -R luofanghao9784/dreamcore-workspace。

【验收】
export DREAMCORE_REPO="$PWD"
export PREVIEW_HOME="/tmp/dreamcore-preview-ct006-$$"
# 无 brew 时：export JAVA_HOME=… POSTGRES_BIN=…（见 CT-006）
bash -n scripts/preview/preview-*.sh
bash scripts/preview/preview-doctor.sh    # 无 brew 机器上不得因缺 brew 失败
bash scripts/preview/preview-install.sh --dry-run
bash scripts/preview/preview-start.sh --dry-run
python3 scripts/local/trial.py start --help | grep -q -- '--parser'
git diff --stat   # 仅 preview/、trial.py、workflow；禁业务代码

【做完输出】diff --stat、关键 hunk、验收输出（打码口令）、SKIP 清单。
```

## ④ 推荐模型与思考强度

- 模型：`gpt-6.1-sol`
- 思考强度：**medium**（落盘 + doctor 写死规则 + trial.py 小改）

## ⑤ 预计耗时

- Codex 落盘：20–40 分钟
- 本地 doctor/dry-run/起停/种子：30–60 分钟
- Actions macos smoke（合入后 `workflow_dispatch`）：约 45 分钟/矩阵行

## ⑥ 跑完如何提交

```bash
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/dreamcore-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/dreamcore-workspace' || exit 1
git add scripts/preview scripts/local/trial.py .github/workflows/macos-preview-smoke.yml
git diff --cached --stat | grep -E 'apps/|engine/src|workers/parser' && echo 'ERROR' && exit 1
git commit -m "$(cat <<'EOM'
feat(preview): CT-006 落地 Mac 预览脚本、parser、种子与 smoke

DQ：无 brew 时 doctor 只验工具；workflow 进本 PR；仓仅 luofanghao9784。
EOM
)"
git push -u origin codex/ct-006-mac-preview-land
gh pr create -R luofanghao9784/dreamcore-workspace --base main --head codex/ct-006-mac-preview-land \
  --title "feat(preview): CT-006 Mac 本机预览脚本与 smoke" \
  --body "## 摘要
落地 scripts/preview/、preview-seed-accounts.py、trial.py --parser、macos-preview-smoke.yml。

## 审查
- 两人审：质量性能 + 发布验收（不另开安全审于本纯文档；落地 PR 配人见 D）
- 勿自动合并

## DQ 裁定
无 brew 写死；workflow 进本 PR；正确仓 Desktop/dreamcore-luofanghao9784；禁止装 Homebrew；禁止写上游。"
```

网页备用：https://github.com/luofanghao9784/dreamcore-workspace/compare/main...codex/ct-006-mac-preview-land

## ⑦ 失败/卡住时怎么办

| 症状 | 动作 |
|---|---|
| remote 不是 luofanghao9784 | 立刻停；换 `~/Desktop/dreamcore-luofanghao9784` |
| doctor 因无 brew 失败 | 未落实 E1；改脚本，禁止装 brew |
| 缺 java/node/pg | 只 export `JAVA_HOME`/`POSTGRES_BIN`；仍缺报 DQ，不自动装 |
| push 拒 workflow | 按 E5：剔除 workflow 并写明后续 CT；或刷新 scope 后补推；报 DQ 备案 |
| CONFLICT / push rejected | `git pull --rebase` 一次；仍失败停发 DQ |
| 禁止 | force push、`reset --hard`、直推 main、装 Homebrew、写上游、回报写口令、有暂停令仍开 Codex；禁止 gh issue create/comment，禁止在任何仓库开或评论 Issue；只允许 gh pr create -R luofanghao9784/dreamcore-workspace |

回滚（未合入）：`git switch main && git branch -D codex/ct-006-mac-preview-land`；本机 `preview-uninstall.sh --yes`。

---

## 本 PR（纯文档）说明

只新增本文件，并更新 `docs/codex-tasks/README.md`：

- CT-005 状态 →「已文档（附录规格）；落地改走 CT-006」
- 新增 CT-006 索引行；§1.3 指向 CT-006
- 审查人：**质量性能 + 发布验收**（纯文档两人审，CT-007）

**不要**在本 PR 加入 `scripts/preview/**` 或 `.github/workflows/**`。
