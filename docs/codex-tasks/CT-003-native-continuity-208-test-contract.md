# CT-003 NativeAutomaticContinuity 测试契约按 #208 修订（方案 A，只改测试）

状态：待执行（**须等 #7 合入 main 之后**，顺序见 README 1.1，已定）　｜　分支：`codex/ct-003-native-continuity-208-contract`　｜　审查人（老板推送 PR 后单审）：测试审查　｜　基准：origin/main a2a41d5（行号为修订前）

## ① 目标与范围
- **背景**：#208（865ccdc「接入模型治理并统一知识星链来源」）要求每个当前数据快照都要有当前模型审阅依据（`docs/技术/模型治理与知识星链统一来源设计-2026-10-27.md:11`：“每个当前数据快照/资料版本均需要当前模型审阅依据；稳定字段定义可以复用，但不能用旧批次模型审阅冒充新批次。”）。`FoundationModelReviewProjection` 中 `checksPassed = parsed && deterministic && modelReady`。#208 合入时漏改了 `NativeAutomaticContinuityIntegrationTest`，5 例因此失败。DQ 已书面确认方案 A；架构逻辑同意；测试审查同意（条件已写入本单）。
- **要修的 5 例**（a2a41d5 行号）：
  | 用例（方法起始行） | 失败断言行 |
  |---|---|
  | confirmedDefinitionsAutomaticallyPublishKnowledgeAndRepeatWithoutDuplicates（:101） | :111 知识页含「数据口径知识」 |
  | unavailableHistoricalReleaseDoesNotRollbackCurrentKnowledgePage（:138） | :147 items.size==1 |
  | refreshedRowsKeepDefinitionsButRecheckEverySnapshotAndDoNotCallModel（:251） | :258 checksPassed |
  | modelContractWithoutEvidenceAutomaticallyPublishesAndReusesDefinitionsWithoutModelJobs（:266） | :281 checksPassed；:279 model_jobs==0 |
  | transportedDefinitionsReusePublishedMeaningButNeverCarryForwardRowSuccess（:299） | :310 automaticAnalysisReady |
- **只改** `apps/api/src/test/**`（实际只应改这一个测试文件）。碰到 `src/main` 测试审查直接打回。
- **不做什么**：不改生产代码；不新增 `not_applicable` 之类状态（架构逻辑已否决）；不动 :336-343 用例（:338/:340，已由 CT-001 修好）；不动 CT-001 新增的 4 条用例；不并入 #7；不碰 workflow。

## ② 前置条件与分支名
- **CT-001 必须已合入 main**（同一测试文件，先合可避免冲突）。确认：在 PR 页看到 CT-001 为 `Merged`。
- 若在 CT-001 合入前已开始，本分支会冲突：不要自己解，停下，等 CT-001 合入后删掉本地分支重来（`git switch main && git branch -D codex/ct-003-native-continuity-208-contract`，未推送的分支删除只影响本机）。
```bash
cd ~/dreamcore-workspace
git status
# 干净时显示：nothing to commit, working tree clean
git switch main && git pull
git log --oneline -5
# 应能看到 CT-001 的提交「fix(briefing): 全部来源未就绪时写回具体等待原因（#230 回归）」
git switch -c codex/ct-003-native-continuity-208-contract
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export POSTGRES_BIN="$(brew --prefix postgresql@18)/bin"
codex -m gpt-6.1-sol
```
进入后 `/model` 选 **high**，粘贴第 ③ 节。

## ③ Codex 提示词（整段复制）
```text
你在 dreamcore-workspace 仓库。任务：只修改测试文件 apps/api/src/test/java/com/dreamcore/workspace/NativeAutomaticContinuityIntegrationTest.java，使其符合 #208（865ccdc）确立的产品规则。不得修改任何 src/main 代码。

【规则来源】
- docs/技术/模型治理与知识星链统一来源设计-2026-10-27.md 第 11 行：每个当前数据快照/资料版本均需要当前模型审阅依据；稳定字段定义可以复用，但不能用旧批次模型审阅冒充新批次。
- apps/api/src/main/java/com/dreamcore/workspace/scene/FoundationModelReviewProjection.java：checksPassed = parsed && deterministic && modelReady；未通过时 modelReviewState=WAITING，标签“等待当前版本模型审阅通过”。
- 生产代码在没有模型任务时会停在 WAITING，不会放行；这是有意设计。测试在 #208 合入时漏改。

【要修的 5 个用例（行号为修改前，可能已因 CT-001 新增用例而偏移，以方法名为准）】
1. confirmedDefinitionsAutomaticallyPublishKnowledgeAndRepeatWithoutDuplicates：断言“知识页含 数据口径知识”失败
2. unavailableHistoricalReleaseDoesNotRollbackCurrentKnowledgePage：items.size 期望 1 实得 0
3. refreshedRowsKeepDefinitionsButRecheckEverySnapshotAndDoNotCallModel：新快照 version(2) 后 checksPassed 期望 true 实得 false
4. modelContractWithoutEvidenceAutomaticallyPublishesAndReusesDefinitionsWithoutModelJobs：checksPassed 失败；该用例还断言 governance_model_jobs 数=0
5. transportedDefinitionsReusePublishedMeaningButNeverCarryForwardRowSuccess：automaticAnalysisReady 失败（消息 "legacy local pins no longer impose an approval gate"）

【修法与硬约束】
A. 前置：在每个用例的失败断言之前，让“当前版本模型审阅通过”成立。只能走真实派发路径：复用本文件已有 helper publish()（governance.execute → engineAnswer → governance_model_dispatch SUCCEEDED → governance.publish），或在本文件新增私有 helper 包装同一真实路径（需要时参照 apps/api/src/test/java/com/dreamcore/workspace/ModelSemanticGovernanceIntegrationTest.java 的合成模型回包，例如 output 含 qualityReview=USABLE）。新快照出现后要为“该新快照”产生当前批次审阅。
   禁止：直接 UPDATE/INSERT nativeGovernance 或 modelReviewState 相关字段；mock 或替换 FoundationModelReviewProjection；新增测试专用开关/属性；ReflectionTestUtils 改生产逻辑开关（已有的 evidencePath/dispatchEnabled 用法保持原样）。
B. 断言只强不弱：原有断言一条都不删、不放宽（不改 assertTrue 为 assertFalse、不改期望值），唯一例外是下面 C 中被规则直接推翻的 model_jobs=0，它要替换为更强断言。
C. 用例 4 中 “governance_model_jobs 数 == 0” 改为“每个新快照恰好 1 个当前版本模型任务”（按快照计数断言），并保留原有关于字段定义复用的断言（source_contract_publications 数为 1 等）。
D. 反例（每个补了前置的用例都要配一条）：去掉当前批次审阅，或只用旧批次审阅时，必须 checksPassed=false 或知识页不出现该项，证明前置是必要的。
   用例 3 必须包含这条：用旧批次（version 1）的审阅面对新快照 version(2)，断言 checksPassed=false 且 modelReviewState=WAITING —— 钉死“不得以旧冒新”。
   反例可写在同一用例内（先断言反例，再补前置断言正例），或新增独立 @Test；@Test 总数不得减少。
E. 改名：测试名不得再含 WithoutModelJobs、DoNotCallModel 或其他与新规则矛盾的字样。建议：
   refreshedRowsKeepDefinitionsButRecheckEverySnapshotAndDoNotCallModel → refreshedRowsKeepDefinitionsButRequireCurrentSnapshotModelReview
   modelContractWithoutEvidenceAutomaticallyPublishesAndReusesDefinitionsWithoutModelJobs → modelContractWithoutEvidencePublishesAfterCurrentModelReviewAndReusesDefinitions
   其余 3 个名称不矛盾，可保留。
F. 不许动：missingAcceptanceWaitsWithoutPaidTaskAndReceiptResumesExactlyOnce（含其中的两条 SOURCE_RECEIPT_REQUIRED 断言），以及 #230 回归修复新增的 4 条用例；本文件其余通过中的用例不改。
G. 绝对不许碰的文件：apps/api/src/main/**（全部生产代码）、.github/workflows/**、其他测试文件（含 FoundationModelReviewProjectionTest、ModelSemanticGovernanceIntegrationTest 等，只读参考）、qualityops 相关业务、前端所有目录、engine/**、workers/**、数据库迁移、docs/**、pom.xml、package.json。
H. 禁止：@Disabled、assumeTrue/Assumptions 跳过、调大任何超时、靠重跑取绿。

【必跑测试】（已设 JAVA_HOME、POSTGRES_BIN）
1) python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml -Dtest=NativeAutomaticContinuityIntegrationTest test      （约 5 分钟）
2) 再原样跑第二次（要求两次都绿，不改任何东西）
3) python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml -Dtest='FoundationModelReviewProjectionTest,ModelSemanticGovernanceIntegrationTest,DatasetSemanticGovernanceIntegrationTest,AutomaticGovernanceCompatibilityIntegrationTest' test

【验收】
- NativeAutomaticContinuityIntegrationTest 两次运行 Failures 0；FoundationModelReviewProjectionTest（8 例）与 #208 自带集成测试全绿。
- 若 deliveringCalculatedOlderSnapshotKeepsItsPublishedUnitWhenCollectionAdvances 报 TASK_ACCESS_DENIED：先在未改动的代码上跑一次确认是否原本就有，如实报告，不要去改它。
- git diff 只涉及本测试文件。

【做完输出（用于 PR 描述）】
1. 对照表：原名→新名、原前置→新前置、断言增减（逐条列出；删除断言数必须为 0，被替换的 model_jobs=0 单独注明“替换为更强断言”）；
2. 改前、改后本类 @Test 数量；
3. 三次测试运行的 Results 段；
4. git diff --stat 与完整 diff。
不要 commit、不要 push。
```

## ④ 推荐模型与思考强度
`gpt-6.1-sol`，**high**。需要读懂模型治理真实派发链路、为每个快照构造当前批次审阅、写反例并严守「只强不弱」，判断量大；low/medium 容易走捷径直写字段或 mock。

## ⑤ 预计耗时
Codex 60–120 分钟（含多次整类运行，每次约 308 秒）；老板本地复核约 15 分钟（整类 2 次 + #208 测试 1 次）；提交 10 分钟（填对照表）。

## ⑥ 跑完如何提交
```bash
cd ~/dreamcore-workspace
git diff --stat
# 只应有 apps/api/src/test/java/com/dreamcore/workspace/NativeAutomaticContinuityIntegrationTest.java
git diff --stat -- apps/api/src/main
# 必须没有任何输出
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml -Dtest=NativeAutomaticContinuityIntegrationTest test 2>&1 | tee /tmp/ct-003-run1.log
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml -Dtest=NativeAutomaticContinuityIntegrationTest test 2>&1 | tee /tmp/ct-003-run2.log
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml -Dtest='FoundationModelReviewProjectionTest,ModelSemanticGovernanceIntegrationTest,DatasetSemanticGovernanceIntegrationTest,AutomaticGovernanceCompatibilityIntegrationTest' test 2>&1 | tee /tmp/ct-003-208.log
grep -E "Tests run:.*Fail" /tmp/ct-003-run1.log /tmp/ct-003-run2.log /tmp/ct-003-208.log | tail -n 6
```
通过样子：每个日志最后的汇总都是 `Failures: 0, Errors: 0`，并有 `BUILD SUCCESS`；NativeAutomaticContinuity 的 `Tests run` 数 ≥ 31（CT-001 合入后为 31，加上新增反例用例会更多）。例外：若 Errors: 1 且仅为 `deliveringCalculatedOlderSnapshot...TASK_ACCESS_DENIED`（本机已知现象），会显示 `BUILD FAILURE`——记下，写进 PR 描述，交审查判断，不算本单失败。
保存 surefire 报告供附到 PR：
```bash
mkdir -p ~/Desktop/ct-003-surefire && cp apps/api/target/surefire-reports/*NativeAutomaticContinuity* ~/Desktop/ct-003-surefire/
```
提交：
```bash
git add apps/api/src/test
git commit -m "test(native-continuity): 按 #208 修订测试契约，补当前版本模型审阅前置与反例"
git push -u origin codex/ct-003-native-continuity-208-contract
cat > /tmp/ct-003-pr.md <<'PR'
## 背景
#208（865ccdc）要求每个当前快照都需当前模型审阅（docs/技术/模型治理与知识星链统一来源设计-2026-10-27.md:11）。NativeAutomaticContinuityIntegrationTest 在 #208 合入时漏改，5 例失败。方案 A：生产不动，只修订测试契约（DQ 书面确认；架构逻辑同意；测试审查同意）。

## 对照表
| 原名 | 新名 | 原前置 | 新前置 | 断言增 | 断言减 |
|---|---|---|---|---|---|
| （粘贴 Codex 输出的对照表） | | | | | 0 |

- @Test 数：改前 __ → 改后 __
- 删除断言：0（:279 model_jobs=0 替换为“每个新快照恰好 1 个当前版本模型任务”，并保留字段定义复用断言）
- 反例：每个补前置用例各 1 条；refreshedRows… 含“旧批次审阅不能冒充新快照”（checksPassed=false、modelReviewState=WAITING）

## 范围
- 只改 apps/api/src/test/**；未改 src/main；无 @Disabled/跳过/超时调整/测试开关/mock Projection。
- missingAcceptanceWaits…（:338/:340）与 #230 回归用例未动。
- 不并入 #7；不碰 .github/workflows。

## 测试证据
- NativeAutomaticContinuityIntegrationTest 连续两次：run1 __ / run2 __（未重跑取绿）
- FoundationModelReviewProjectionTest + #208 集成测试：__
- surefire 报告：见附件
- TASK_ACCESS_DENIED：出现/未出现，改前是否同样：__

审查：测试审查（单审）。
PR
open -e /tmp/ct-003-pr.md
gh pr create --base main --head codex/ct-003-native-continuity-208-contract --title "test(native-continuity): 按 #208 修订测试契约（方案 A，只改测试）" --body-file /tmp/ct-003-pr.md
```
填好 `__` 和对照表后再执行最后一行。surefire 报告：PR 开好后在网页评论框把 `~/Desktop/ct-003-surefire` 里的文件拖进去（.txt 可直接拖；.xml 先压缩：`cd ~/Desktop && zip -r ct-003-surefire.zip ct-003-surefire`）。
网页备用：<https://github.com/luofanghao9784/dreamcore-workspace/compare/main...codex/ct-003-native-continuity-208-contract>　开好后把链接发 DQ。


### 验收：Actions 连续两次绿（#7 合入后，PR 自带 API CI）
1. 打开本 PR 页面 → 点 **Checks** 标签 → 左侧选 `API · Postgres gate`，等第 1 次跑完为绿色 ✓。
2. 右上角点 **Re-run jobs** → **Re-run all jobs** → 确认，等第 2 次跑完。
3. 查看结果：Checks 页左上角的 **Attempt #1 / #2** 下拉可切换两次运行；两次都绿才算通过。红了点开失败步骤，复制日志发给 DQ。
4. 在 PR 下评论：`gh pr comment codex/ct-003-native-continuity-208-contract --body "CT-003：Actions 第 1、2 次均绿"`

## ⑦ 失败/卡住时怎么办
| 症状 | 动作 |
|---|---|
| `git log` 看不到 CT-001 提交 | CT-001 还没合入，**停下等待** |
| 工作区不干净 | `git stash push -u -m "ct-003-before"`，完成后回原分支 `git stash pop` |
| `git diff --stat -- apps/api/src/main` 有输出 | 让 Codex「撤回所有 src/main 改动，只改测试」；确认无输出再继续 |
| Codex 说“必须改生产代码才能绿” | **停下**，这说明方案 A 前提可能不成立，把 Codex 原话发 DQ 和架构逻辑 |
| Codex 直写 modelReviewState / mock Projection / 删断言 / 加 @Disabled | 拒绝，重申提示词 A/B/H 条 |
| 第一次绿、第二次红（不稳定） | 不要重跑碰运气；两份日志发 DQ |
| #208 测试变红 | 停下，发 `/tmp/ct-003-208.log` |
| push 被拒 | `git pull --rebase` 再 `git push`；仍失败停下 |
| `CONFLICT` | 停下，不要自己解 |
停下时发 DQ：三个 `/tmp/ct-003-*.log`、`git status`、`git diff --stat`、Codex 最后一段回答、报错原文。禁止 force push、reset --hard、直推 main。
