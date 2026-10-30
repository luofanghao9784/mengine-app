# CT-001 简报生成：全部来源未就绪时写回具体等待原因（#230 回归，NativeAutomaticContinuity :340）

状态：待执行（顺序第 3，CT-000、CT-004 之后；CT-001/002 可并行）　｜　分支：`codex/ct-001-briefing-hold-reason`　｜　审查人（老板推送 PR 后单审）：架构逻辑　｜　基准：origin/main a2a41d5

## ① 目标与范围
- **目标**：修复 #230（3a29ed3「手动画报不被同空间未交付表拖死」）引入的回归。#230 之后只挑「已就绪」的数据来源；当一个都没挑到时，`BriefingGenerationService` 提前 `hold(...,"RESULT_NOT_READY")` 返回，**没有**把具体原因（如 `SOURCE_RECEIPT_REQUIRED`）写进 `briefing_generation_policies.reason`。导致 `NativeAutomaticContinuityIntegrationTest.missingAcceptanceWaitsWithoutPaidTaskAndReceiptResumesExactlyOnce` 第 340 行失败（期望 `SOURCE_RECEIPT_REQUIRED`，实际 `null`）。
- **改动范围**：生产 `apps/api/src/main/java/com/dreamcore/workspace/briefing/BriefingGenerationService.java` 中**只这一个 hold 分支**（a2a41d5 第 481 行）；测试 `NativeAutomaticContinuityIntegrationTest.java` **只新增** 4 条回归用例。
- **不做什么**：不重构；不改「只派发已就绪来源」的 #230 行为；不改原 :338/:340 用例一个字；不修同类其余 5 例失败（:111/:147/:258/:281/:310，归 CT-003）；不碰 workflow；不并入 PR #7；不碰微秒截断（CT-002）。
- 本机复现证据（数据库转储）：policy.reason=null；batch 状态 WAITING_DATA、reason=RESULT_NOT_READY、trigger=INITIALIZATION、task_id=null。详见判定文档「:340 本机复现」节。

## ② 前置条件与分支名
- 无前置单。CT-003 改同一测试文件，**本单先合**，CT-003 在本单合入后再从最新 main 切。
- 已完成 README 第 6 节一次性准备。
```bash
cd ~/dreamcore-workspace
git status
# 干净时显示：On branch main ... nothing to commit, working tree clean
git switch main && git pull
git switch -c codex/ct-001-briefing-hold-reason
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export POSTGRES_BIN="$(brew --prefix postgresql@18)/bin"
codex -m gpt-6.1-sol
```
进入 Codex 后输入 `/model` 选择推理强度 **high**，然后粘贴第 ③ 节整段。

## ③ Codex 提示词（整段复制）
```text
你在 dreamcore-workspace 仓库（Java 21 / Spring / Postgres 18）。请修复一个生产回归，严格按以下约束，只做这一件事。

【背景与根因】
- 回归来自提交 3a29ed3（#230「手动画报不被同空间未交付表拖死」）：BriefingGenerationService 现在只把“已就绪”的数据来源放进 selected。
- 文件 apps/api/src/main/java/com/dreamcore/workspace/briefing/BriefingGenerationService.java，约第 481 行：
    if(selected.isEmpty()&&!info){hold(batch,manualBatch,"WAITING_DATA","RESULT_NOT_READY");return;}
  当所有数据来源都未就绪时，selected 为空，这里直接 hold 并 return：既不写 briefing_generation_policies.reason，也到不了紧随其后（约 482-489 行）那段 “readiness 未就绪 → hold(ready.reason()) + UPDATE briefing_generation_policies SET reason=?” 的分支。
- 结果：测试 apps/api/src/test/java/com/dreamcore/workspace/NativeAutomaticContinuityIntegrationTest.java 中 missingAcceptanceWaitsWithoutPaidTaskAndReceiptResumesExactlyOnce（约 336-343 行）在第 340 行失败：expected SOURCE_RECEIPT_REQUIRED but was null。运行时转储：policy.reason=null；batch=WAITING_DATA/RESULT_NOT_READY，task_id=null。
- readiness 是该方法内已构建的 Map（按 source.materialId() 取，约 375 行 readiness.put）；排序比较器 order 在约 454 行（sourceScore 降序→changedAt 降序→filename）。hold(...) 定义在约 137 行。

【修法（只改第 481 行这个分支）】
1. 在 selected.isEmpty()&&!info 分支里：从 sources 中找出“dataset 且 readiness 存在且 !ready()”的候选来源。
2. 候选按**显式、确定**的顺序排序后取第一个：先用已有 order，再 thenComparing(Source::materialId)（来源主键）作最终决胜键。禁止依赖 HashMap 迭代顺序或查询自然顺序。在代码处写一行中文注释说明此规则：“多来源未就绪时取排序第一个（order→materialId）的原因，保证稳定”。
3. 找到时：hold(batch,manualBatch,"WAITING_DATA",reason) 并 db.update("UPDATE briefing_generation_policies SET reason=? WHERE id=?",reason,id)，然后 return。
4. 找不到具体原因时才兜底：hold(...,"RESULT_NOT_READY") 并同样把 policy.reason 写为 RESULT_NOT_READY，保持 batch 与 policy 一致。RESULT_NOT_READY 绝不能覆盖已有的具体原因。
5. 幂等：同一批次重复 tick/hold 不得产生重复记录，也不得在不同 reason 之间来回切换。
6. 不改“只派发已就绪来源”的行为；不改其他分支；不重构、不顺手改格式或命名。

【新增 4 条回归用例（加在 NativeAutomaticContinuityIntegrationTest 中，复用现有夹具 publish()/version()/receipt()/policy()/dispatched()/generation.tick()）】
① 同空间一源就绪、一源缺回执(SOURCE_RECEIPT_REQUIRED) → tick 后恰好派发 1 次，policy.reason 为 null（保护 #230 意图）。
② 全部来源未就绪 → batch.reason 与 policy.reason 相同且为具体原因（非 RESULT_NOT_READY）。
③ 补回执后一次 tick → 恰好派发 1 次且 policy.reason 被清空为 null；另外在补回执前连续 hold/tick 两次，断言 briefing_generation_batches 中该 policy 的记录数不变、reason 不变。
④ 两个未就绪来源且原因不同 → policy.reason 恰好等于按 order→materialId 排序第一个来源的原因；同一用例内重复 tick 多次结果不变。
如果某条用例需要多数据集夹具而现有 helper 不够，只在测试文件里新增私有 helper，不改已有 helper 的行为。

【绝对不许碰】
- .github/workflows/**（任何 workflow 文件）
- 原用例 missingAcceptanceWaitsWithoutPaidTaskAndReceiptResumesExactlyOnce（:336-343）一个字都不改，包括 :338/:340 的断言
- 本测试文件其他已有用例（尤其 :101/:138/:251/:266/:299 这 5 个失败用例，另有单子处理）
- BriefingGenerationService 中除第 481 行分支以外的代码
- 其他模块：governance/**、scene/**（含 FoundationModelReviewProjection）、objectlifecycle/**、collection/**、engine/**、workers/**、qualityops 相关业务、前端（apps/web 等所有前端目录）、数据库迁移、docs/**、package.json、pom.xml
- 禁止：@Disabled、assumeTrue 跳过、删除或放宽任何断言、调大任何超时、加测试专用开关、mock 生产服务

【必跑测试】（环境已设 JAVA_HOME 与 POSTGRES_BIN）
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml -Dtest=NativeAutomaticContinuityIntegrationTest test
（整类约 5 分钟）

【验收标准】
- :340 所在用例与 4 条新用例全部通过。
- 本类中 confirmedDefinitionsAutomaticallyPublishKnowledgeAndRepeatWithoutDuplicates、unavailableHistoricalReleaseDoesNotRollbackCurrentKnowledgePage、refreshedRowsKeepDefinitionsButRecheckEverySnapshotAndDoNotCallModel、modelContractWithoutEvidenceAutomaticallyPublishesAndReusesDefinitionsWithoutModelJobs、transportedDefinitionsReusePublishedMeaningButNeverCarryForwardRowSuccess 这 5 例**预期仍然失败**（#208 模型审阅门槛，另单修），失败原因必须与修改前相同；不得出现任何其他新增失败。
- 若出现 deliveringCalculatedOlderSnapshotKeepsItsPublishedUnitWhenCollectionAdvances 报 TASK_ACCESS_DENIED，如实报告是否修改前也出现（修改前请先跑一次整类作对照）。
- git diff 只涉及上述两个文件。

【做完输出】
1. git diff --stat 与完整 diff；
2. 修改前、修改后整类测试的 Tests run / Failures / Errors 汇总，以及失败用例名单；
3. 一段中文说明：改了哪一行、排序规则、兜底规则、幂等如何保证；
不要 commit、不要 push。
```

## ④ 推荐模型与思考强度
`gpt-6.1-sol`，**high**。理由：改动小但涉及排序确定性、兜底与幂等多条约束，需新增多数据源夹具，容易误改相邻分支；high 能更好地守住范围。账号可用更强的 Astra 系列也可，不必用 Max/Ultra。

## ⑤ 预计耗时
Codex 修改与自测 30–60 分钟（含它自己跑 2 次整类，每次约 308 秒）；老板复核本地测试约 6 分钟；提交开 PR 5 分钟。合计约 1 小时。

## ⑥ 跑完如何提交
1）本地复核测试：
```bash
cd ~/dreamcore-workspace
git diff --stat
# 只应出现 BriefingGenerationService.java 与 NativeAutomaticContinuityIntegrationTest.java 两个文件
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml -Dtest=NativeAutomaticContinuityIntegrationTest test 2>&1 | tee /tmp/ct-001-test.log
```
正常样子：结尾 `Tests run: 31, Failures: 5, ...`（原 27 例 + 新 4 例；Errors 可能为 0 或 1，见下）、`BUILD FAILURE`。**这是预期的**：剩下 5 个失败必须恰好是 ① 列出的 5 例。检查命令：
```bash
grep -E "\[ERROR\] .*NativeAutomaticContinuityIntegrationTest\." /tmp/ct-001-test.log
```
不应出现 `missingAcceptanceWaits...` 及 4 条新用例名。若多出 `deliveringCalculatedOlderSnapshot...TASK_ACCESS_DENIED`（本机已知，原因未定），记录下来写进 PR 描述，不算本单引入。
2）提交与推送：
```bash
git add apps/api
git commit -m "fix(briefing): 全部来源未就绪时写回具体等待原因（#230 回归）"
git push -u origin codex/ct-001-briefing-hold-reason
```
3）写 PR 描述到文件并开 PR：
```bash
cat > /tmp/ct-001-pr.md <<'PR'
## 背景
#230（3a29ed3）后只派发已就绪来源；全部未就绪时提前 hold(RESULT_NOT_READY) 返回，未写 briefing_generation_policies.reason，导致 NativeAutomaticContinuityIntegrationTest:340 失败（期望 SOURCE_RECEIPT_REQUIRED，实际 null）。
本机复现转储：policy.reason=null；batch=WAITING_DATA/RESULT_NOT_READY，trigger=INITIALIZATION，task_id=null。

## 改动
- BriefingGenerationService：仅改 `selected.isEmpty()&&!info` 分支。取未就绪来源中按 order→materialId 排序第一个的 ready.reason() hold，并写 policy.reason。
- RESULT_NOT_READY 只在找不到具体原因时兜底，也写 policy.reason，不覆盖具体原因。
- 幂等：重复 hold 不增记录、不切换 reason。
- 原 :338/:340 一字未改；新增 4 条回归用例（①一就绪一缺回执 ②全未就绪 ③补回执恰派发一次 + 重复 hold 记录数不变 ④两源不同原因取排序第一个）。

## 测试
- 命令：`python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml -Dtest=NativeAutomaticContinuityIntegrationTest test`
- 结果：Tests run: __，Failures: __，Errors: __（贴 Results 段）
- 预期仍红 5 例（#208 测试契约，另由 CT-003 修）：:111/:147/:258/:281/:310
- TASK_ACCESS_DENIED（deliveringCalculatedOlderSnapshot...）：出现/未出现，修改前是否同样出现：__

## 范围
不并入 #7；不碰 .github/workflows；不重构。审查：架构逻辑（单审）。
PR
gh pr create --base main --head codex/ct-001-briefing-hold-reason --title "fix(briefing): 全部来源未就绪时写回具体等待原因（#230 回归，NativeAutomaticContinuity :340）" --body-file /tmp/ct-001-pr.md
```
先用文本编辑器把 `/tmp/ct-001-pr.md` 里的 `__` 填上真实数字再执行最后一行（`open -e /tmp/ct-001-pr.md`）。
网页备用：<https://github.com/luofanghao9784/dreamcore-workspace/compare/main...codex/ct-001-briefing-hold-reason>
开好后把 PR 链接发给 DQ（一条消息）。


### 验收（#7 合入前，main 无 API CI）
老板 Mac 本地测试绿 + 附 surefire 报告。打包到桌面：
```bash
cd ~/dreamcore-workspace
zip -j ~/Desktop/CT-001-surefire.zip apps/api/target/surefire-reports/*NativeAutomaticContinuity*
```
把 `~/Desktop/CT-001-surefire.zip` 拖进 PR 页面底部评论框发出；或发文字摘要：
```bash
gh pr comment codex/ct-001-briefing-hold-reason --body "CT-001 Mac 本地：$(grep -h -o 'Tests run: [0-9]*, Failures: [0-9]*, Errors: [0-9]*, Skipped: [0-9]*' apps/api/target/surefire-reports/*NativeAutomaticContinuity*.txt | tr '\n' ';')"
```

## ⑦ 失败/卡住时怎么办
| 症状 | 动作 |
|---|---|
| `git status` 不干净 | `git stash push -u -m "ct-001-before"`，做完后回原分支 `git stash pop` |
| `Missing initdb ...` | 重新执行两条 `export`（README 6.4） |
| `java: invalid target release` / `release version 21 not supported` | `java -version` 不是 21，重新 export JAVA_HOME |
| `git diff --stat` 出现第三个文件 | 对 Codex 说「只保留 BriefingGenerationService.java 第 481 行分支和测试文件新增用例的改动，撤回其他文件」，再检查 |
| :340 或新用例仍失败 / 失败名单与预期不同 / 多了新失败 | 让 Codex 再修一次；仍不对就停下 |
| Codex 想改原 :340、加 @Disabled、改超时 | 拒绝，重申提示词约束 |
| push 被拒 | `git pull --rebase` 后再 `git push`；仍失败停下 |
| 冲突 `CONFLICT` | 停下，不要自己解 |
**停下时发给 DQ**：`/tmp/ct-001-test.log`、`git status` 与 `git diff --stat` 输出、Codex 最后一段回答、报错原文。禁止 force push、reset --hard、直推 main。
