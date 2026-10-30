# CT-004 PR #7 API·Postgres 作业分片 + 上传 surefire 报告（workflow，老板账号推）

状态：待执行（**紧接 CT-000**）　｜　分支：已有的 #7 分支 `cursor/api-postgres-gate-1c11`　｜　**审查人（2026-10-30 起按 CT-007 两人审口径）：质量性能 + 架构逻辑**（历史：当时为测试审查单审，已停用）　｜　PR：<https://github.com/luofanghao9784/mengine/pull/7>

## ① 目标与范围
- **目标**：改 `.github/workflows/api-postgres-gate.yml`，把单个 `api` 作业改成 4 个并行分片（matrix），每片结束后**无论成败**（`if: always()`）都把 `apps/api/target/surefire-reports` 上传成产物 `surefire-reports-<分片>`。
- **为什么**：run 40937260088 整套跑了 90 分钟仍被超时取消。四个慢类合计约 55 分钟（PlatformExperienceAdjustment 1589s、GeneralExperienceTaskContext 701s、PublicationFeedback 648s、FeedbackAdjustment 340s），GeneralExperiencePipeline 及之后的类来不及跑。另外当时没有上传报告，拿不到逐用例耗时。慢的原因**尚未证实**（推测是 parser 沙箱/OCR 或共享库数据增长），本单不处理慢因，只拆分并补证据。
- **硬约束**：**不调大超时**，每片 `timeout-minutes: 90`，与现值相同。保留 CT-000 的 `Build engine` 步骤，保留 `scripts/with-test-postgres.py`（每片各起一个一次性 Postgres）。不改任何 Java/engine 代码，也不改断言。

### 分片方案
| 分片 | 测试类 | 依据（run 40937260088 耗时） |
|---|---|---|
| `adjust` | PlatformExperienceAdjustmentIntegrationTest | 1589s |
| `context` | GeneralExperienceTaskContextIntegrationTest、PublicationFeedbackIntegrationTest | 701s + 648s |
| `general` | GeneralExperiencePipelineIntegrationTest、GeneralExperienceLibraryIntegrationTest、GeneralExperienceSuggestionIntegrationTest、FeedbackAdjustmentIntegrationTest | 340s + Pipeline（当次未跑完，耗时未知） |
| `rest` | **其余全部**：用排除法 `-Dtest=!类A,!类B,…`，排除上面 7 个类 | 其余约 180 个类 |

- **恰好覆盖一次**：7 个显式类只在 `Resolve test shard` 一个步骤里定义一次，`rest` 的排除清单由同一份清单自动生成，所以不会漏也不会重。该步骤还会校验三件事：清单无重复；每个类在 `apps/api/src/test` 下恰有一个源文件，不满足就报错退出；surefire 默认 `failIfNoSpecifiedTests=true`，类名写错会直接失败。
- **命令变化**：原来是 `test package`，现改为 `"-Dtest=<本片>" package`。`package` 阶段本身就包含 `test`，所以不会少跑测试，jar 也照样打包。
- **检查名会变**：原来的 `with-test-postgres · test:api` 变成 4 个：`with-test-postgres · test:api (adjust)`、`(context)`、`(general)`、`(rest)`。main 上这个检查**从未设为必需**（该 workflow 只在 #7 上），所以不影响分支保护。按 README 顺序，#7 合入后也暂不设为必需检查；将来要设时，按这 4 个新名字设。
- **代价**：前置安装步骤（Postgres 18、parser 沙箱、Node、engine 构建）每片各跑一次，Actions 总分钟数会增加，但墙钟时间缩短。

## ② 前置条件与分支名
- **CT-000 已推到 #7**。本补丁是在「#7 头 622dfea + CT-000」的状态上生成并校验的。
- 与 CT-000 相同：老板本人账号，需有 `workflow` 权限；不需要 JDK、Postgres。
```bash
# ① 进仓库
cd ~/mengine
# ② 确认干净：应显示 "nothing to commit, working tree clean"
git status
# ③ 拉取远端
git fetch origin
# ④ 切到已有的 #7 分支并更新
git switch cursor/api-postgres-gate-1c11
git pull
# 确认 CT-000 已在：应输出 "- name: Build engine" 所在行
grep -n "name: Build engine" .github/workflows/api-postgres-gate.yml
```
grep 没输出就说明 CT-000 还没做，先去做 CT-000。

## ③ 改法：内嵌补丁（推荐），或交给 Codex
### 做法 A：补丁
整段复制执行（保存为 `~/Desktop/ct-004.patch`）：
```bash
cat > ~/Desktop/ct-004.patch <<'PATCH'
diff --git a/.github/workflows/api-postgres-gate.yml b/.github/workflows/api-postgres-gate.yml
--- a/.github/workflows/api-postgres-gate.yml
+++ b/.github/workflows/api-postgres-gate.yml
@@ -21,9 +21,16 @@ concurrency:
 
 jobs:
   api:
-    name: with-test-postgres · test:api
+    # CT-004：按耗时分 4 片并行；每片超时仍为 90 分钟（不调大）。
+    # 慢类耗时据 run 40937260088：PlatformExperienceAdjustment 1589s、GeneralExperienceTaskContext 701s、
+    # PublicationFeedback 648s、FeedbackAdjustment 340s；GeneralExperiencePipeline 当次未跑完，耗时未知。
+    name: with-test-postgres · test:api (${{ matrix.shard }})
     runs-on: ubuntu-latest
     timeout-minutes: 90
+    strategy:
+      fail-fast: false
+      matrix:
+        shard: [adjust, context, general, rest]
     env:
       CI: "true"
       POSTGRES_BIN: /usr/lib/postgresql/18/bin
@@ -382,5 +389,44 @@ jobs:
           npm run build:engine
           test -f engine/dist/runtime/agent-task.js || { echo "::error::engine/dist/runtime/agent-task.js missing after build:engine"; exit 1; }
 
+      # 分片清单只在这里定义一次；rest 片用排除法跑其余全部，保证每个测试类恰好落在一片。
+      - name: Resolve test shard
+        id: shard
+        env:
+          SHARD: ${{ matrix.shard }}
+        run: |
+          set -euo pipefail
+          adjust="PlatformExperienceAdjustmentIntegrationTest"
+          context="GeneralExperienceTaskContextIntegrationTest,PublicationFeedbackIntegrationTest"
+          general="GeneralExperiencePipelineIntegrationTest,GeneralExperienceLibraryIntegrationTest,GeneralExperienceSuggestionIntegrationTest,FeedbackAdjustmentIntegrationTest"
+          explicit="${adjust},${context},${general}"
+          # 校验：显式类不重复，且每个类在 apps/api/src/test 下恰有一个源文件。
+          dup=$(tr ',' '\n' <<<"${explicit}" | sort | uniq -d)
+          [ -z "${dup}" ] || { echo "::error::duplicate shard class: ${dup}"; exit 1; }
+          for c in $(tr ',' ' ' <<<"${explicit}"); do
+            n=$(find apps/api/src/test -name "${c}.java" | wc -l)
+            [ "${n}" -eq 1 ] || { echo "::error::${c}.java found ${n} times"; exit 1; }
+          done
+          case "${SHARD}" in
+            adjust)  filter="${adjust}" ;;
+            context) filter="${context}" ;;
+            general) filter="${general}" ;;
+            rest)    filter=$(tr ',' '\n' <<<"${explicit}" | sed 's/^/!/' | paste -sd, -) ;;
+            *) echo "::error::unknown shard ${SHARD}"; exit 1 ;;
+          esac
+          echo "shard ${SHARD}: -Dtest=${filter}"
+          echo "filter=${filter}" >> "$GITHUB_OUTPUT"
+
       - name: test:api
-        run: python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml test package
+        env:
+          TEST_FILTER: ${{ steps.shard.outputs.filter }}
+        run: python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml "-Dtest=${TEST_FILTER}" package
+
+      - name: Upload surefire reports
+        if: always()
+        uses: actions/upload-artifact@v4
+        with:
+          name: surefire-reports-${{ matrix.shard }}
+          path: apps/api/target/surefire-reports/
+          if-no-files-found: warn
+          retention-days: 14
PATCH
```
```bash
cd ~/mengine
git apply --check ~/Desktop/ct-004.patch && echo 可以应用
git apply ~/Desktop/ct-004.patch
# YAML 语法自检（macOS 自带 python3；若提示无 yaml 模块，先 python3 -m pip install --user pyyaml）
python3 -c "import yaml;yaml.safe_load(open('.github/workflows/api-postgres-gate.yml'));print('YAML OK')"
```
已校验：在 622dfea + CT-000 的状态上，`git apply --check` 通过，python `yaml.safe_load` 解析通过（matrix 4 片，timeout 90）。

### 做法 B：补丁失败时交给 Codex
`codex` 启动后粘贴这段提示：
```
只改 .github/workflows/api-postgres-gate.yml 一个文件，其他文件一律不动。
1) 在 jobs.api 下加 strategy: fail-fast: false，matrix.shard: [adjust, context, general, rest]；
   name 改为 "with-test-postgres · test:api (${{ matrix.shard }})"；timeout-minutes 保持 90，不许调大。
2) 在 Build engine 之后、test:api 之前加步骤 "Resolve test shard"（id: shard），在其中一次性定义：
   adjust=PlatformExperienceAdjustmentIntegrationTest
   context=GeneralExperienceTaskContextIntegrationTest,PublicationFeedbackIntegrationTest
   general=GeneralExperiencePipelineIntegrationTest,GeneralExperienceLibraryIntegrationTest,GeneralExperienceSuggestionIntegrationTest,FeedbackAdjustmentIntegrationTest
   rest=上面 7 个类全部加 "!" 前缀、逗号连接（排除法）。
   要校验清单无重复，并且每个类在 apps/api/src/test 下恰有一个 .java 文件，否则 exit 1；结果写入 $GITHUB_OUTPUT 的 filter。
3) test:api 改为：python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml "-Dtest=${TEST_FILTER}" package
   （TEST_FILTER 取自 steps.shard.outputs.filter，经 env 传入）。
4) 末尾加 actions/upload-artifact@v4，if: always()，name: surefire-reports-${{ matrix.shard }}，path: apps/api/target/surefire-reports/，retention-days: 14。
保留 Build engine 和 with-test-postgres 步骤原样。做完后输出 git diff。
```
本单推荐使用的模型和思考强度见 ④。

## ④ 推荐模型与思考强度
做法 A 不用 Codex。做法 B 用默认模型、medium（以 README 6.5 节为准）。

## ⑤ 预计耗时
操作 10 分钟。推送后 4 片并行，预计每片明显短于 90 分钟（未经 CI 证实，以首跑为准）。

## ⑥ 提交与验收
```bash
cd ~/mengine
# ⑤ 核对：只改 1 个文件，约 48 行新增、2 行删除
git diff --stat
git diff
# ⑥ 提交
git add .github/workflows/api-postgres-gate.yml
git commit -m "ci(api): test:api 分 4 片并上传 surefire 报告（不调大超时）"
# ⑦ 普通推送
git push
```
⑧ **PR 已存在，推完即自动重跑**：<https://github.com/luofanghao9784/mengine/pull/7>

**验收（四条都满足才算通过）**：
1. Actions 出现 **4 个**分片作业：adjust / context / general / rest。
2. 每片都有产物 `surefire-reports-<分片>` 可下载（失败的片也要有）。
3. **没有任何分片超时**（日志里没有 "exceeded the maximum execution time"）。
4. 失败只限 README 1.2 节列出的已知红。出现清单外的红，把类名和失败步骤日志发给 DQ。

**网页上怎么看**：
- 看分片：打开 PR #7 → **Checks** 标签 → 左侧 `API · Postgres gate` 下面有 4 行 `with-test-postgres · test:api (…)`，每行前面有 ✓ / ✗ / 黄点（运行中）。点任意一行，右侧显示该片的步骤日志。
- 下载产物：在 Checks 页点右上角 **View more details on GitHub Actions**（或进 Actions 标签打开这次运行）→ 运行汇总页滚到底部 **Artifacts** 区 → 点 `surefire-reports-adjust` 等名字下载 zip。里面的 `TEST-*.xml` 带逐用例耗时，把 4 个 zip 一起发给 DQ。

## ⑦ 失败/卡住时怎么办
| 症状 | 动作 |
|---|---|
| `git status` 不干净 | `git stash push -u -m "ct-004-before"`，做完后 `git stash pop` |
| grep 找不到 Build engine | 先做 CT-000 |
| `git apply --check` 失败 | 改用做法 B（Codex），或把报错发 DQ |
| YAML 自检报错 | `git checkout -- .github/workflows/api-postgres-gate.yml` 撤回，重做 |
| push 报 workflow 权限 | `gh auth refresh -s workflow` 后再 `git push` |
| push 报 rejected | `git pull --rebase` 再 `git push`；遇到 CONFLICT 停下 |
| `Resolve test shard` 红（duplicate / found 0 times） | 有类改名或删除，把日志发 DQ |
| 某片仍超时 | 不调大超时，把该片的产物与日志发 DQ，再定是否继续拆 |
停下时发给 DQ：`git status`、`git log --oneline -3`、报错原文。禁止 force push（--force/-f/--force-with-lease）、reset --hard、直推 main。
