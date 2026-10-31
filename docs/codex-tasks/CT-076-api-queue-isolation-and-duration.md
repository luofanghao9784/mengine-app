# CT-076：API 门禁失败、队列隔离与耗时修复执行单

日期：2026-10-31。审单及本次执行：质量性能；状态：返工诊断中，未通过验收。

本文复用此前 CT-076 的边界、假设和对照方案，补齐两片真实终态、报告及本次执行要求，作为当前完整执行版。旧文件在本执行环境不可达，历史会话可检索正文不完整；本文不冒称旧文件的逐字副本。此次只授权将执行单文档放到独立文档分支供审核；诊断/业务修复代码不发布、不合并、不部署。

## 1. 固定版本及边界

- 仓库：luofanghao9784/mengine-app；PR #76。
- PR head：`3e450e72660eda88498d4719e17f84a7a335f380`。
- CI 实际 checkout merge：`3e6bdc740955b06ce6f5b250b43fb600d359104a`；其父为 base `d945af9235b07ecfbfc4990bd6c4ebae4324b769` 和上述 head。
- 原 run：41158561952；general job 124410710178；rest job 124410710273。
- 复现必须记录实际 commit；head 单测不冒充 merge 复现。需要判断新增缺陷时，另以 base 做相同最小对照，不跑全套。
- 禁止放宽生产权限、绕过 MaterialAccess/requireParseAccess、吞异常、删断言、排除失败类、默认跳过、使用真实模型、盲重跑全片或成功项、提高 90 分钟上限。需要业务修改时先交 DQ 确认范围。

## 2. 既有终态与可访问证据

- [原运行](https://github.com/luofanghao9784/mengine-app/actions/runs/41158561952)。两片均 `completed/cancelled`，`test:api=cancelled`，`Upload surefire reports=success`，不再报告在途。
- [general job](https://github.com/luofanghao9784/mengine-app/actions/runs/41158561952/job/124410710178)：北京时间10:07:49–11:38:18；[报告](https://github.com/luofanghao9784/mengine-app/actions/runs/41158561952/artifacts/13028792309)。已写出3类55项，0 failures/0 errors/0 skipped；最后开始 GeneralExperienceSuggestionIntegrationTest，未有其完整类报告。
- [rest job](https://github.com/luofanghao9784/mengine-app/actions/runs/41158561952/job/124410710273)：10:07:49–11:38:07；[报告](https://github.com/luofanghao9784/mengine-app/actions/runs/41158561952/artifacts/13029256525)。已写出187类1634项，60 failures/71 errors/33 skipped；最后开始 CalculationMaterialIntegrationTest，未有其完整类报告。
- 上述是取消前已写出报告的汇总，不是全片最终测试总数或绿色验收。上传成功不等于测试成功。
- general 已完成慢类：GeneralExperiencePipelineIntegrationTest 589.323秒，GeneralExperienceLibraryIntegrationTest 1593.634秒。rest 已成功慢类含 BriefingGenerationIntegrationTest 672.838秒、ExperienceIntegrationTest 659.594秒、BriefingTimelineIntegrationTest 183.576秒；只读报告，不为测时重跑。
- rest 原始失败族：TaskContextHarnessIT 的 TASK_MODEL_FAILED；TableCalculationIntegrationTest 14 errors，涉及 upload→finish→requireParseAccess→MATERIAL_NOT_FOUND；KnowledgeIntegrationTest 8 failures，claim实际版本与fixture预期UUID不同；还有 KNOWLEDGE_INDEX_NOT_READY、SQL归档约束、超时及空结果，逐族处理。
- KnowledgeService全局claim按created_at选QUEUED/过期RUNNING；部分fixture仅清理本tenant。该设计事实本身不是生产缺陷，错领来源仍须对照证明。
- POM若干调度 initial-delay=3600000ms、context cache maxSize=6；超过1h只是调度竞争假设，不是触发证据。

## 3. 假设与证伪条件

| 假设 | 需要的对照证据 | 未证实时 |
|---|---|---|
| H1 跨类队列残留导致错领 | 新库单类与同库严格顺序/反序对照；领到的tenant/version能关联前序fixture | 检查本类内部残留，不扩大删除范围 |
| H2 缓存context的后台调度启动 | 线程/触发时间、受控短延迟与手动worker对照 | 不因超过1h即关闭调度或简单加大延迟 |
| H3 MATERIAL_NOT_FOUND来自错领/归档 | 对齐job tenant/workspace/material/version，存在/归档/权限/事务顺序 | 新库仍失败时独立查fixture和权限契约，不绕过鉴权 |
| H4 Harness子进程失败 | 新库TaskContextHarnessIT，退出码、脱敏stderr、cwd/Node/engine版本、mock请求记录 | 与队列错误分别归类，不改成成功或调用真实模型 |
| H5 分片负载不均 | 既有报告类级耗时、总量及覆盖清单 | 证据不足不改分片，仍保持90分钟 |

## 4. 环境与执行能力

原单模型建议为 gpt-6.1-sol / High，不是本次已切换模型的证据；本次使用既有执行环境，不因建议新增代理或费用。

先实测 Java21、PostgreSQL18的initdb/pg_ctl/psql、仓库Node24.20.0、engine锁文件安装/构建。解析/计算类还需parser venv/OCR、真实Linux systemd/cgroup/bwrap能力，不能用放宽沙箱替代。前提缺失须按测试族标记BLOCKED，不把环境失败冒充原CI根因。可用的Harness或claim-only诊断继续执行，不因一个沙箱前提缺失停止全部工作。

所有数据库经原 `scripts/with-test-postgres.py` 创建/销毁，禁止读取或清理生产/共享库。每个命令执行前记录commit；执行后立即保存退出码、日志和Surefire副本，再进行下一条。报告只导出必要任务身份和状态，不打印口令或全环境。

## 5. Git准备

```bash
git remote get-url origin
git status --short
git fetch origin 3e6bdc740955b06ce6f5b250b43fb600d359104a
git cat-file -e 3e450e72660eda88498d4719e17f84a7a335f380^{commit}
git cat-file -e 3e6bdc740955b06ce6f5b250b43fb600d359104a^{commit}
git worktree add --detach ../ct076-original-merge 3e6bdc740955b06ce6f5b250b43fb600d359104a
```

目录须不存在；不可reset/stash他人工作。原merge不可取、remote或版本不符时停止依赖该绑定的修改，不用新merge替代。

## 6. 最小诊断矩阵

先对实际失败类做新库单类；必要时把方法缩到不需要缺失环境的队列领取契约，明确不是全类通过。

```bash
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml -Dtest=TaskContextHarnessIT test
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml -Dtest=KnowledgeIntegrationTest test
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml -Dtest=TableCalculationIntegrationTest test
```

每步执行后复制 `apps/api/target/surefire-reports` 到独立结果目录，不得被下一条覆盖。所需的任务级网络代理配置可以通过 `-s` 指定，但不提交配置内容。

同一新库、跨JVM严格Table→Knowledge，然后另一个新库反序；第一类失败也继续收集第二类，整步仍非零：

```bash
python3 scripts/with-test-postgres.py bash -c '
  failed=0
  for cls in TableCalculationIntegrationTest KnowledgeIntegrationTest; do
    ./apps/api/mvnw -B -f apps/api/pom.xml "-Dtest=$cls" test || failed=1
    mkdir -p "artifacts/ct076/table-then-knowledge/$cls"
    cp -R apps/api/target/surefire-reports/. "artifacts/ct076/table-then-knowledge/$cls/"
  done
  exit "$failed"
'
```

反序用不同结果目录。若两类不是残留生产者，根据原报告改为最小前序类→受害类，不把未复现当通过。记录实际运行顺序、claim前后队列身份/状态及对象存在/归档；严禁全表清理抹掉证据。

同JVM对照用于区分缓存context/后台线程；先核验Surefire支持且日志实际采用顺序：

```bash
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml -Dtest=KnowledgeIntegrationTest,TableCalculationIntegrationTest -Dsurefire.runOrder=alphabetical -DforkCount=1 -DreuseForks=true test
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml -Dtest=KnowledgeIntegrationTest,TableCalculationIntegrationTest -Dsurefire.runOrder=reversealphabetical -DforkCount=1 -DreuseForks=true test
```

不可仅凭-Dtest名单推断顺序。若解析/计算沙箱前提缺失，不能用这些全类失败证明H1；可以在不改生产校验的测试专用诊断中仅驱动真实upload/claim/finish和原断言，并标记该范围。

H2必须用受控短延迟及真实线程记录，不等待1h。真实调度契约测试仍独立进程/库；测试开关不可关闭生产调度。H4保留子进程退出/stderr与通信阶段，不与其他错误合并归因。

## 7. 修复与验收

1. 每个假设标证实/否定/未决，提供原始命令、commit、退出码、Surefire、真实顺序、耗时与环境限制。
2. 同条件修复前失败、修复后通过；跨tenant、撤权、归档、幂等及权限负向断言保留。
3. fixture只清理自己证明拥有的队列资源，失败路径也清理，处理在途线程/事务；不删其他租户数据，不静默忽略错领。
4. 手动worker测试不得在长运行中意外启动真实调度；不得靠延迟大于90分钟冒充修复。
5. 分片只按既有耗时证据调整，清单不漏不重，原Maven package及90分钟上限保留；不单独重跑已成功慢类。
6. 新head及tree必须记录；不同SHA不继承旧绿。若需业务修改，先报最小范围/风险，不自行扩展。
7. 提交诊断结果和最小diff供独立审查；本执行单不是正式非作者审批，也不是发布/合并/部署授权。

## 8. 交付清单

- 本文完整可访问仓库链接，以及执行版与旧历史快照的区别。
- 两片completed/cancelled原始字段、原merge/head分开记录、最后开始测试及已完成报告计数。
- 报告下载及hash、部分性说明、类级耗时与失败族。
- 真实环境探针、已执行最小诊断、逐步退出码/Surefire/顺序/身份依据。
- 无法执行的测试族给唯一能力边界及具体恢复步骤；不让老板重复选择环境。
- 未解决根因和验收缺口明确保留，不将写完执行单或单类通过当成本批完成。
