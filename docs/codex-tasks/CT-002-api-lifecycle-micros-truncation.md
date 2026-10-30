# CT-002 生命周期时间戳对齐 Postgres 微秒精度

状态：待执行（顺序第 2，CT-000 之后；CT-001/002 可并行）　｜　分支：`codex/ct-002-lifecycle-micros`　｜　审查人（老板推送 PR 后单审）：测试审查　｜　基准：origin/main a2a41d5

## ① 目标与范围
- **根因**：Linux 上 JDK 的 `Instant.now()` 精度到纳秒，Postgres `timestamptz` 只存微秒，读回来会舍入。macOS 的 `Instant.now()` 只到微秒，所以 Mac 上不暴露，Linux CI 必红（PR #7 run 40937260088，full.log:4407-4435、4775-4776）。
- **要修的 4 例**：
  - `ProfileMethodLifecycleIntegrationTest.explicitOldVersionTrashRestoreEnableAndPermanentErasureKeepCurrentAndMetadata`（:45，断言 :46 `now.plus(30d)` 对读回 `purgeAfter`）
  - `ProfileMethodLifecycleIntegrationTest.concurrentSameActionAndLostReceiptKeepOneDeadlineAndDoNotReviveOldState`（:80，断言 :82）
  - `ProfileMethodLifecycleIntegrationTest.explicitDepartureScopeUsesSameClockAndCanPurgeItsCurrentPrivateProfiles`（:116，:117 `isolateScope` 抛 `LIFECYCLE_SCOPE_BOUNDARY_CHANGED`）
  - `FeedbackAdjustmentIntegrationTest.departureIsolationAndPurgeErasePrivateAdjustmentButPreservePublishedSharedAsset`（:42，`isolateScope` 抛 `LIFECYCLE_SCOPE_BOUNDARY_CHANGED`）
- **改动文件（3 个）**：
  - 生产 `apps/api/src/main/java/com/dreamcore/workspace/objectlifecycle/ObjectScopeLifecycle.java`：`isolateScope`（:19-22）与 `resumeExpiredScope`（:45-47）入口把 `effectiveAt`、`deadline` 截断到 `ChronoUnit.MICROS` 后再写库与比较（:22/:47 用 `Instant.equals` 比对库读回值）。
  - 测试夹具 `ProfileMethodLifecycleIntegrationTest.java:27`：`now=Instant.now().truncatedTo(ChronoUnit.MICROS)`。
  - 测试夹具 `FeedbackAdjustmentIntegrationTest.java:42`：`Instant due=Instant.now().truncatedTo(ChronoUnit.MICROS).minusSeconds(1)`。
- **不做什么**：不改断言、不改为「近似相等」比较；不碰其他生命周期类、`RetentionClock`（生产时钟本就是 `SELECT clock_timestamp()`，天然微秒）；不碰 workflow；不并入 #7；一 PR 只修这一类问题。

## ② 前置条件与分支名
无依赖，可与 CT-001 任意先后。
```bash
cd ~/dreamcore-workspace
git status
# 干净时显示：nothing to commit, working tree clean
git switch main && git pull
git switch -c codex/ct-002-lifecycle-micros
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export POSTGRES_BIN="$(brew --prefix postgresql@18)/bin"
codex -m gpt-6.1-sol
```
进入后 `/model` 选推理强度 **medium**，粘贴第 ③ 节。

## ③ Codex 提示词（整段复制）
```text
你在 dreamcore-workspace 仓库（Java 21 / Spring / Postgres 18）。修复一类时间精度问题，只做这一件事。

【根因】
Linux 上 Instant.now() 是纳秒精度，Postgres timestamptz 只存微秒，读回后舍入。macOS 的 Instant.now() 只到微秒，所以 Mac 本地不会复现，Linux CI 必红。生产时钟 RetentionClock.now() 是 SELECT clock_timestamp()，本身是微秒；纳秒只来自测试夹具，以及将来可能传入纳秒 Instant 的调用方。

【失败用例（Linux CI）】
- ProfileMethodLifecycleIntegrationTest.explicitOldVersionTrashRestoreEnableAndPermanentErasureKeepCurrentAndMetadata：:46 expected …12.360264787Z but was …12.360265Z
- ProfileMethodLifecycleIntegrationTest.concurrentSameActionAndLostReceiptKeepOneDeadlineAndDoNotReviveOldState：:82 同类
- ProfileMethodLifecycleIntegrationTest.explicitDepartureScopeUsesSameClockAndCanPurgeItsCurrentPrivateProfiles：:117 isolateScope 抛 IdentityException 409 LIFECYCLE_SCOPE_BOUNDARY_CHANGED
- FeedbackAdjustmentIntegrationTest.departureIsolationAndPurgeErasePrivateAdjustmentButPreservePublishedSharedAsset：:42 同上

【修法】
1. apps/api/src/main/java/com/dreamcore/workspace/objectlifecycle/ObjectScopeLifecycle.java：
   在 isolateScope（约 19-22 行）和 resumeExpiredScope（约 45-47 行）方法开头，把参数 effectiveAt、deadline 用 truncatedTo(java.time.temporal.ChronoUnit.MICROS) 截断，之后写库和与库读回值的 equals 比较都用截断后的值。加一行中文注释：“与 Postgres timestamptz 微秒精度对齐”。不改其他方法和逻辑。
2. apps/api/src/test/java/com/dreamcore/workspace/ProfileMethodLifecycleIntegrationTest.java 约 27 行：now=Instant.now() 改为 now=Instant.now().truncatedTo(ChronoUnit.MICROS)（补 import）。
3. apps/api/src/test/java/com/dreamcore/workspace/FeedbackAdjustmentIntegrationTest.java 约 42 行：Instant due=Instant.now().minusSeconds(1) 改为 Instant due=Instant.now().truncatedTo(ChronoUnit.MICROS).minusSeconds(1)（补 import）。
4. 新增 1 条小回归用例（放 ProfileMethodLifecycleIntegrationTest）：用一个带纳秒位的 Instant（如 Instant.parse("2030-01-01T00:00:00.123456789Z") 相对 now 偏移构造）调用 isolateScope，再用同一纳秒值重复调用 isolateScope，不应抛 LIFECYCLE_SCOPE_BOUNDARY_CHANGED。这样在 macOS 上也能证明修复有效。

【绝对不许碰】
.github/workflows/**；RetentionClock 及 objectlifecycle 包其他文件；其他测试文件；departure/**、briefing/**、governance/**、scene/**、qualityops 相关业务、前端所有目录、engine/**、workers/**、数据库迁移、docs/**、pom.xml、package.json。
禁止：@Disabled / assumeTrue 跳过、删除或放宽断言（不许改成容差比较）、调大超时、加测试开关、mock 生产服务。

【必跑测试】
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml -Dtest='ProfileMethodLifecycleIntegrationTest,FeedbackAdjustmentIntegrationTest' test
（FeedbackAdjustment 类较慢，CI 上约 340 秒）

【验收】两类全部通过（ProfileMethodLifecycle 18 例含新增 1 例、FeedbackAdjustment 13 例），Failures 0、Errors 0、BUILD SUCCESS；git diff 只涉及上述 3 个文件。

【做完输出】git diff --stat、完整 diff、测试 Results 段、中文说明改动；不要 commit、不要 push。
```

## ④ 推荐模型与思考强度
`gpt-6.1-sol`，**medium**。改动机械、范围清楚（3 处截断 + 1 条用例），不需要 high。

## ⑤ 预计耗时
Codex 15–25 分钟；本地测试约 7 分钟（两类合计，CI 上 72s + 340s）；提交 5 分钟。

## ⑥ 跑完如何提交
```bash
cd ~/dreamcore-workspace
git diff --stat
# 只应有 ObjectScopeLifecycle.java、ProfileMethodLifecycleIntegrationTest.java、FeedbackAdjustmentIntegrationTest.java
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml -Dtest='ProfileMethodLifecycleIntegrationTest,FeedbackAdjustmentIntegrationTest' test 2>&1 | tee /tmp/ct-002-test.log
```
通过样子：`Tests run: 31, Failures: 0, Errors: 0, Skipped: 0` 与 `BUILD SUCCESS`。注意：Mac 上修改前这 4 例**本来就可能是绿的**，所以本地绿只证明没改坏；真正证明靠新增的纳秒用例和 Linux CI。
```bash
git add apps/api
git commit -m "fix(lifecycle): 生命周期时间戳对齐 Postgres 微秒精度"
git push -u origin codex/ct-002-lifecycle-micros
cat > /tmp/ct-002-pr.md <<'PR'
## 背景
Linux JDK 的 Instant.now() 为纳秒，Postgres timestamptz 只存微秒。PR #7 CI（run 40937260088）中 ProfileMethodLifecycleIntegrationTest 3 例、FeedbackAdjustmentIntegrationTest 1 例因此失败（purgeAfter 不等；isolateScope 抛 LIFECYCLE_SCOPE_BOUNDARY_CHANGED）。macOS 精度为微秒，本地不暴露。

## 改动
- ObjectScopeLifecycle.isolateScope / resumeExpiredScope：入口将 effectiveAt、deadline 截断到 MICROS 后写库与比较。
- 测试夹具 ProfileMethodLifecycleIntegrationTest:27、FeedbackAdjustmentIntegrationTest:42 改为微秒时钟，使夹具与生产 RetentionClock（clock_timestamp()）精度一致。
- 新增 1 例：纳秒 Instant 重复 isolateScope 不再报边界变化（Mac 上也能证明）。
- 断言未删、未放宽；未加 skip/超时。

## 测试
`python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml -Dtest='ProfileMethodLifecycleIntegrationTest,FeedbackAdjustmentIntegrationTest' test`
结果：Tests run: __, Failures: __, Errors: __

## 范围
一 PR 一类；不并入 #7；不碰 .github/workflows。
PR
open -e /tmp/ct-002-pr.md
gh pr create --base main --head codex/ct-002-lifecycle-micros --title "fix(lifecycle): 生命周期时间戳对齐 Postgres 微秒精度" --body-file /tmp/ct-002-pr.md
```
（`open -e` 打开文本编辑把 `__` 填上，保存后再执行最后一行。）
网页备用：<https://github.com/luofanghao9784/dreamcore-workspace/compare/main...codex/ct-002-lifecycle-micros>　开好后把链接发 DQ。


### 验收（#7 合入前，main 无 API CI）
老板 Mac 本地测试绿 + 附 surefire 报告。打包到桌面：
```bash
cd ~/dreamcore-workspace
zip -j ~/Desktop/CT-002-surefire.zip apps/api/target/surefire-reports/*ProfileMethodLifecycle* apps/api/target/surefire-reports/*FeedbackAdjustment*
```
把 `~/Desktop/CT-002-surefire.zip` 拖进 PR 页面底部评论框发出；或发文字摘要：
```bash
gh pr comment codex/ct-002-lifecycle-micros --body "CT-002 Mac 本地：$(grep -h -o 'Tests run: [0-9]*, Failures: [0-9]*, Errors: [0-9]*, Skipped: [0-9]*' apps/api/target/surefire-reports/*ProfileMethodLifecycle*.txt apps/api/target/surefire-reports/*FeedbackAdjustment*.txt | tr '\n' ';')"
```

## ⑦ 失败/卡住时怎么办
| 症状 | 动作 |
|---|---|
| 工作区不干净 | `git stash push -u -m "ct-002-before"`，完成后回原分支 `git stash pop` |
| `Missing initdb` / Java 版本不对 | 重新执行 README 6.4 两条 export |
| 新增纳秒用例失败 | 让 Codex 检查是否所有写库/比较都用了截断后的值；再失败停下 |
| 其他用例失败（非这 4 例） | 先在 main 上跑同命令对照（`git stash` 后 `git switch main`），若 main 也红则写进 PR 描述；否则停下 |
| diff 出现第 4 个文件 | 让 Codex 撤回 |
| push 被拒 | `git pull --rebase` 再 `git push`；仍失败停下 |
| `CONFLICT` | 停下 |
停下时发 DQ：`/tmp/ct-002-test.log`、`git status`、`git diff --stat`、报错原文。禁止 force push、reset --hard、直推 main。
