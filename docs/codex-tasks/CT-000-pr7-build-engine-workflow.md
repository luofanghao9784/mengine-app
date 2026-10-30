# CT-000 PR #7 补 build:engine 步骤（workflow，老板账号推送）

状态：待执行（**最先做**）　｜　分支：已有的 #7 分支 `cursor/api-postgres-gate-1c11`（当前头 622dfea）　｜　**审查人（2026-10-30 起按 CT-007 两人审口径）：质量性能 + 架构逻辑**（历史：当时为测试审查单审，已停用）　｜　PR：<https://github.com/luofanghao9784/dreamcore-workspace/pull/7>

## ① 目标与范围
- **目标**：在 `.github/workflows/api-postgres-gate.yml` 的 `Install engine dependencies` 步骤之后、`test:api` 步骤之前，新增 1 个 `Build engine` 步骤（7 行，含 1 行空行）。CI 里缺 `engine/dist`，导致 BriefingFaceAlignment、ExperienceAdjustment、PlatformExperienceProcessing、Presentation、NativeSchedules 等测试失败（定性文档第 3、5 条），这一步就是补上它。
- **为什么要老板推**：组内机器的 GitHub 令牌没有 `workflow` 权限，GitHub 拒绝任何改 `.github/workflows` 的推送；老板本人账号有此权限。
- **不做什么**：不改这个文件的其他行（timeout、分片、缓存都不动）；不改任何 Java/engine 代码；不开新 PR（推到已有的 #7 分支）。

## ② 前置条件与分支名
- 已完成 README 第 6 节的「安装 git/gh、gh auth login、克隆仓库」（本单**不需要** JDK、Postgres、Codex）。
- `gh auth login` 用的是老板本人账号。若推送报 `refusing to allow ... workflow`，执行 `gh auth refresh -s workflow` 后重推。
```bash
# ① 进仓库
cd ~/dreamcore-workspace
# ② 确认干净：应显示 "nothing to commit, working tree clean"
git status
# ③ 拉取远端所有分支
git fetch origin
# ④ 切到已有的 #7 分支并更新
git switch cursor/api-postgres-gate-1c11
git pull
# 确认分支头：第一行应是 622dfea（若更新过可能不同，见第⑦节）
git log --oneline -1
```

## ③ 本单不用 Codex
只粘贴补丁 + git。两种做法任选一种，**推荐做法 A**。

### 做法 A：用补丁（推荐，最不容易出错）
在终端里整段复制执行下面这一块（它会把补丁保存为 `~/Desktop/ct-000.patch`）：
```bash
cat > ~/Desktop/ct-000.patch <<'PATCH'
diff --git a/.github/workflows/api-postgres-gate.yml b/.github/workflows/api-postgres-gate.yml
--- a/.github/workflows/api-postgres-gate.yml
+++ b/.github/workflows/api-postgres-gate.yml
@@ -375,5 +375,12 @@ jobs:
           test -d engine/node_modules
           test -d engine/node_modules/@deepseek-ai/dsh-schedule
 
+      # 供 NativeSchedules / Presentation / BriefingFaceAlignment 等测试使用本地引擎产物（engine/dist）；只构建，不连 live 模型。
+      - name: Build engine
+        run: |
+          set -euo pipefail
+          npm run build:engine
+          test -f engine/dist/runtime/agent-task.js || { echo "::error::engine/dist/runtime/agent-task.js missing after build:engine"; exit 1; }
+
       - name: test:api
         run: python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml test package
PATCH
```
然后先检查、再应用：
```bash
cd ~/dreamcore-workspace
git apply --check ~/Desktop/ct-000.patch && echo 可以应用
git apply ~/Desktop/ct-000.patch
```
`git apply --check` 没有报错并打印「可以应用」，才执行第二条。（已在 622dfea 上实测 `--check` 通过。）

### 做法 B：用编辑器手工插入（补丁失败时用）
```bash
open -e ~/dreamcore-workspace/.github/workflows/api-postgres-gate.yml
```
找到这一行（在 622dfea 上是第 376 行）：
```
          test -d engine/node_modules/@deepseek-ai/dsh-schedule
```
它下面是一行空行（第 377 行），再下面是 `      - name: test:api`（第 378 行）。在**第 377 行空行之后、`- name: test:api` 之前**粘贴下面 7 行（第 1 行和 `- name` 前面是 6 个空格，`run:` 前 8 个，`set`/`npm`/`test` 前 10 个；最后一行是空行）：
```yaml
      # 供 NativeSchedules / Presentation / BriefingFaceAlignment 等测试使用本地引擎产物（engine/dist）；只构建，不连 live 模型。
      - name: Build engine
        run: |
          set -euo pipefail
          npm run build:engine
          test -f engine/dist/runtime/agent-task.js || { echo "::error::engine/dist/runtime/agent-task.js missing after build:engine"; exit 1; }

```
保存（⌘S）。注意：TextEdit 需是纯文本模式（格式 → 制作纯文本），不要用 Tab 缩进。

## ④ 推荐模型与思考强度
不适用（本单不用 Codex）。

## ⑤ 预计耗时
操作 5–10 分钟；推送后 #7 的 CI 自动重跑约 90 分钟（不用盯）。

## ⑥ 跑完如何提交
```bash
cd ~/dreamcore-workspace
# ⑤ 核对：只应改 1 个文件，+7 行、-0 行
git diff --stat
#   .github/workflows/api-postgres-gate.yml | 7 +++++++
#   1 file changed, 7 insertions(+)
git diff
# 新增 7 行应与上面完全一致，前面都是 "+"
# ⑥ 提交
git add .github/workflows/api-postgres-gate.yml
git commit -m "ci(api): test:api 前构建 engine/dist（build:engine）"
# ⑦ 普通推送（分支已存在）
git push
```
⑧ **PR 已存在，推完即自动重跑**：打开 <https://github.com/luofanghao9784/dreamcore-workspace/pull/7>，在 Checks 里能看到 `API · Postgres gate` 重新开始。无需新建 PR，也不用盯着等。推完给审查人（质量性能）发一条：「#7 已推 build:engine，提交 <git log --oneline -1 的结果>」。

## ⑦ 失败/卡住时怎么办
| 症状 | 动作 |
|---|---|
| `git status` 不干净 | `git stash push -u -m "ct-000-before"`，完成后回原分支 `git stash pop` |
| `git log` 第一行不是 622dfea | #7 被别人更新过：先跑 `git apply --check`，通过就继续；不通过改用做法 B；找不到第 376 行那段文字就停下 |
| `git apply --check` 报 `patch does not apply` / `corrupt patch` | 改用做法 B |
| `git diff --stat` 不是 `7 insertions(+)` | 用 `git checkout -- .github/workflows/api-postgres-gate.yml` 撤回本次未提交改动，重做 |
| push 报 `refusing to allow ... to create or update workflow` | `gh auth refresh -s workflow`，再 `git push` |
| push 报 `rejected` / `non-fast-forward` | `git pull --rebase` 再 `git push`；仍失败或 `CONFLICT` 就停下 |
| CI 在 `Build engine` 步骤红 | 把该步骤日志（PR → Checks → 失败步骤，复制全文）发给 DQ |
停下时发给 DQ：`git status`、`git log --oneline -3`、报错原文。禁止 force push（--force/-f/--force-with-lease）、reset --hard、直推 main。
