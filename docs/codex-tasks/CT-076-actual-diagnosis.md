# CT-076：实际最小诊断结果

状态：已完成最小隔离与跨类对照；整片验收未通过，未发布生产修复。

完整执行单：[固定仓库正文](https://github.com/luofanghao9784/mengine-app/blob/2222858f71d305fffac4fbf4c4d24b8ba1f23866/docs/codex-tasks/CT-076-api-queue-isolation-and-duration.md)。这是补齐终态的当前完整执行版，不冒称不可达旧文件的逐字副本。

## 固定版本和既有终态

- 本次全部测试实际执行在原 CI merge `3e6bdc740955b06ce6f5b250b43fb600d359104a`，父提交依次为 base `d945af9235b07ecfbfc4990bd6c4ebae4324b769`、PR #76 head `3e450e72660eda88498d4719e17f84a7a335f380`。源代码未改，git diff --check 和 git status --short 均退出0，后者输出为空。
- [general](https://github.com/luofanghao9784/mengine-app/actions/runs/41158561952/job/124410710178)：completed/cancelled，test:api cancelled，Upload surefire reports success；北京时间10:07:49–11:38:18。原始日志末尾错误：`The operation was canceled.`。最后开始 GeneralExperienceSuggestionIntegrationTest（10:46:11），未产出其完整XML。
- [rest](https://github.com/luofanghao9784/mengine-app/actions/runs/41158561952/job/124410710273)：completed/cancelled，test:api cancelled，Upload surefire reports success；10:07:49–11:38:07。原始日志同为 `The operation was canceled.`。最后开始 CalculationMaterialIntegrationTest（11:34:25），未产出其完整XML。
- [general报告](https://github.com/luofanghao9784/mengine-app/actions/runs/41158561952/artifacts/13028792309)：3个完整XML类，55 tests、0 failures、0 errors、0 skipped。
- [rest报告](https://github.com/luofanghao9784/mengine-app/actions/runs/41158561952/artifacts/13029256525)：187个完整XML类，1634 tests、60 failures、71 errors、33 skipped。
- 两份ZIP均已实际下载、解压、逐XML计数。取消前部分报告不是全片最终总数；上传成功不等于测试成功。原workflow timeout-minutes仍为90，本轮未延长或重试。

## 实际环境及结果

Java21.0.13+9、PostgreSQL18.6、Node24.20.0均实际探针退出0；engine锁文件安装及构建均退出0。所有DB只用原with-test-postgres.py创建/销毁。Maven读取任务专用网络设置和缓存，设置内容及口令不导出。

下表计数为 tests/failures/errors/skipped，类耗时取Surefire，命令总耗时另见JSON。

| 步骤/严格顺序 | 退出码 | 耗时 | 计数 |
|---|---:|---:|---|
| engine-install | 0 | 9.186s | 不适用 |
| engine-build | 0 | 0.467s | 不适用 |
| harness-isolated | 0 | 22.848s（类） | 1/0/0/0 |
| knowledge-claim-isolated | 0 | 11.758s（类） | 3/0/0/0 |
| table-access-isolated | 0 | 12.083s（类） | 1/0/0/0 |
| material-then-knowledge-v2 → MaterialIntegrationTest#editableTextUsesOriginalAndMaintenanceAndVersionUpload | 0 | 12.229s（类） | 1/0/0/0 |
| material-then-knowledge-v2 → KnowledgeIntegrationTest#ordinaryHistoricalUploadStillGetsItsParse | 0 | 8.301s（类） | 1/0/0/0 |
| native-then-knowledge → NativeConversationIntegrationTest#crossSpaceReferenceReadsBoundVersionAndStillEnforcesOwnerPermissions | 0 | 9.798s（类） | 1/0/0/0 |
| native-then-knowledge → KnowledgeIntegrationTest#ordinaryHistoricalUploadStillGetsItsParse | 1 | 8.426s（类） | 1/1/0/0 |
| knowledge-then-native → KnowledgeIntegrationTest#ordinaryHistoricalUploadStillGetsItsParse | 0 | 10.120s（类） | 1/0/0/0 |
| knowledge-then-native → NativeConversationIntegrationTest#crossSpaceReferenceReadsBoundVersionAndStillEnforcesOwnerPermissions | 0 | 7.526s（类） | 1/0/0/0 |
| native-then-table → NativeConversationIntegrationTest#crossSpaceReferenceReadsBoundVersionAndStillEnforcesOwnerPermissions | 0 | 10.064s（类） | 1/0/0/0 |
| native-then-table → TableCalculationIntegrationTest#sourceAndCapabilityMustBelongToCurrentSpaceAndAttemptAndToolMustBeStarted | 1 | 10.767s（类） | 1/0/1/0 |
| table-then-native → TableCalculationIntegrationTest#sourceAndCapabilityMustBelongToCurrentSpaceAndAttemptAndToolMustBeStarted | 0 | 117.759s（类） | 1/0/0/0 |
| table-then-native → NativeConversationIntegrationTest#crossSpaceReferenceReadsBoundVersionAndStillEnforcesOwnerPermissions | 0 | 91.837s（类） | 1/0/0/0 |

每个跨JVM序列使用同一个新库；反序另起新库。驱动先保存每类退出码、Surefire和队列身份快照，再执行下一类；任一失败则整个序列退出1。没有全表清理，也没有改原断言。Knowledge仅选3个不调用真实parser的方法，Table仅选权限边界1方法；不冒称全类通过。

## 已复现与未证实的因果

1. **H1最小复现成立**：NativeConversationIntegrationTest.crossSpaceReferenceReadsBoundVersionAndStillEnforcesOwnerPermissions通过后留下两个QUEUED版本；下一JVM的Knowledge原断言失败。实际错误为 `expected: <e7060bbc-8d29-410c-ab8d-676c2fbebcc3> but was: <782a5a0f-8923-4f3b-95fc-4823815a6d3b>`。实际版本正是前序快照第一条，tenant `36e63cc2-49f8-4aa3-8406-6eb4c2ad5732`；after快照该任务变为RUNNING/attempts=1。Knowledge先运行则通过，随后Native通过并留下两条。该链不需要缓存Spring context、并发worker或等待1小时即可发生。
2. **H3一条具体链成立**：独立新库Native→Table，前序留下的材料/版本均存在，`material_active=true`、`version_exists=true`，但`actor_material_mask=0`（原用例已撤销请求人权限）。后序Table错误为MATERIAL_NOT_FOUND，栈为 `TableCalculationIntegrationTest.upload:62 → KnowledgeService.finish:215 → requireParseAccess:202 → MaterialAccess.checkObject:31`。这证明错领撤权前序任务能触发该错误；生产权限校验保持生效。
3. Material→Knowledge对照两项通过，前序零待领任务，未支持其为残留生产者。不能把静态上传事实当作队列残留证据。
4. H4本次新库Harness 1项通过，原CI的TASK_MODEL_FAILED未复现，原因仍未决。原CI8个Knowledge断言、14个Table error及其余失败不能全部自动归为上述链；原CI日志没有完整任务身份，未证明原UUID来自哪个具体前序用例。
5. H2缓存context调度及H5耗时/分片负载尚未动态证实。general慢类/最后未结束类仍须独立查SQL/阶段耗时；不以扩大超时替代诊断。

最小处理方向是测试夹具队列隔离或只回收本fixture确实拥有的任务。不要修改全局claim生产语义、绕过MaterialAccess或全表清理。现成IsolatedTestDatabase仅允许原wrapper拥有的临时集群，可作为独立库修复候选；尚未实现、提交或按修复后对照验证。

## 真实执行边界

- `bwrap --unshare-all --die-with-parent --ro-bind / / --proc /proc --dev /dev /bin/true` 退出1：`bwrap: Failed to make / slave: Operation not permitted`。
- `systemctl --user is-system-running` 退出1：`offline`。
- 因此当前主机不能合法完成依赖Linux namespace/mount及user-systemd/cgroup的真实parser/calculator全类验证，不能靠安装依赖、跳过沙箱或改成成功消除。恢复步骤：在现有授权且具备原workflow OS隔离能力的Linux CI执行端，先完成同样探针和原parser venv/OCR准备，再只执行剩余最小方法/类；沿用原隔离库和90分钟边界。本轮未切换电脑、启动新远端run或调用真实模型。

## 精确执行命令及保留说明

命令cwd均为原merge隔离工作树。实际Java/PG/Node路径、每类Maven argv、每步总耗时、退出码、原断言消息、队列身份和ZIP SHA256见同目录 `CT-076-evidence.json`；不含数据库口令或代理配置内容。以下为run-step驱动实际调用的argv；其受控环境设置为CI=true、NODE_ENV=test，并把已探针确认的Java21、PG18和Node24.20.0置于PATH。

```bash
npm ci --prefix engine
```

```bash
npm run build --prefix engine
```

```bash
python3 scripts/with-test-postgres.py ./apps/api/mvnw -s /data/.openmausbot/task-workspaces/5d214d51-f70a-4414-a47a-2875fe562364/dc3deb62-952c-4ef5-b8f2-03d18a6b87b7/context-validation/maven-settings.xml -B -f apps/api/pom.xml -Dtest=TaskContextHarnessIT test
```

```bash
python3 scripts/with-test-postgres.py ./apps/api/mvnw -s /data/.openmausbot/task-workspaces/5d214d51-f70a-4414-a47a-2875fe562364/dc3deb62-952c-4ef5-b8f2-03d18a6b87b7/context-validation/maven-settings.xml -B -f apps/api/pom.xml '-Dtest=KnowledgeIntegrationTest#ordinaryHistoricalUploadStillGetsItsParse+supersededAutomaticSceneVersionDoesNotStarveCurrentParse+repeatedWorkerCrashesStopAfterThreeAttempts' test
```

```bash
python3 scripts/with-test-postgres.py ./apps/api/mvnw -s /data/.openmausbot/task-workspaces/5d214d51-f70a-4414-a47a-2875fe562364/dc3deb62-952c-4ef5-b8f2-03d18a6b87b7/context-validation/maven-settings.xml -B -f apps/api/pom.xml '-Dtest=TableCalculationIntegrationTest#sourceAndCapabilityMustBelongToCurrentSpaceAndAttemptAndToolMustBeStarted' test
```

```bash
python3 scripts/with-test-postgres.py python3 /data/.openmausbot/task-workspaces/5d214d51-f70a-4414-a47a-2875fe562364/dc3deb62-952c-4ef5-b8f2-03d18a6b87b7/ct076-diagnosis/cross-jvm.py material-then-knowledge-v2 'MaterialIntegrationTest#editableTextUsesOriginalAndMaintenanceAndVersionUpload' 'KnowledgeIntegrationTest#ordinaryHistoricalUploadStillGetsItsParse'
```

```bash
python3 scripts/with-test-postgres.py python3 /data/.openmausbot/task-workspaces/5d214d51-f70a-4414-a47a-2875fe562364/dc3deb62-952c-4ef5-b8f2-03d18a6b87b7/ct076-diagnosis/cross-jvm.py native-then-knowledge 'NativeConversationIntegrationTest#crossSpaceReferenceReadsBoundVersionAndStillEnforcesOwnerPermissions' 'KnowledgeIntegrationTest#ordinaryHistoricalUploadStillGetsItsParse'
```

```bash
python3 scripts/with-test-postgres.py python3 /data/.openmausbot/task-workspaces/5d214d51-f70a-4414-a47a-2875fe562364/dc3deb62-952c-4ef5-b8f2-03d18a6b87b7/ct076-diagnosis/cross-jvm.py knowledge-then-native 'KnowledgeIntegrationTest#ordinaryHistoricalUploadStillGetsItsParse' 'NativeConversationIntegrationTest#crossSpaceReferenceReadsBoundVersionAndStillEnforcesOwnerPermissions'
```

```bash
python3 scripts/with-test-postgres.py python3 /data/.openmausbot/task-workspaces/5d214d51-f70a-4414-a47a-2875fe562364/dc3deb62-952c-4ef5-b8f2-03d18a6b87b7/ct076-diagnosis/cross-jvm.py native-then-table 'NativeConversationIntegrationTest#crossSpaceReferenceReadsBoundVersionAndStillEnforcesOwnerPermissions' 'TableCalculationIntegrationTest#sourceAndCapabilityMustBelongToCurrentSpaceAndAttemptAndToolMustBeStarted'
```

```bash
python3 scripts/with-test-postgres.py python3 /data/.openmausbot/task-workspaces/5d214d51-f70a-4414-a47a-2875fe562364/dc3deb62-952c-4ef5-b8f2-03d18a6b87b7/ct076-diagnosis/cross-jvm.py table-then-native 'TableCalculationIntegrationTest#sourceAndCapabilityMustBelongToCurrentSpaceAndAttemptAndToolMustBeStarted' 'NativeConversationIntegrationTest#crossSpaceReferenceReadsBoundVersionAndStillEnforcesOwnerPermissions'
```

首次material-then-knowledge的采集脚本在Flyway建表前查询队列，退出1、未执行测试；已原样留档，修正为先探测to_regclass后以v2新目录运行。较早隔离结果快照混入的前次XML已标记并从本次统计排除；本报告只计该次selector的真实新报告，后续每步先保存再清理生成报告目录。

未修改生产源码、测试断言、分片、main/保护或90分钟上限，未发布修复PR、重跑成功项或合并部署。文档和诊断证据不代表正式非作者审批或整片通过。
