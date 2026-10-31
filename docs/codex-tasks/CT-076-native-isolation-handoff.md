# CT-076 Native 队列隔离交接（续接 #91）

状态：实现及静态检查已完成；本文件不代表动态通过或审批。禁止本地 Mac 任何写入，保留 /home/user/mengine-preview/repo，不合并部署，不加超时，不重复正在执行的 slow-method PID20678。

## 固定版本

仓库 luofanghao9784/mengine-app。原 PR #76 head 3e450e72660eda88498d4719e17f84a7a335f380，base d945af9235b07ecfbfc4990bd6c4ebae4324b769，实际红证据 source merge 3e6bdc740955b06ce6f5b250b43fb600d359104a。
此前四行隔离提交 3b5f566cb2330ad1b3bae27d41e6cc23268abe19 是本次续接 parent。最终修复 SHA 从本文件所在提交读取，禁止把该 parent 称为含归属护栏的最终版本。

既有红证据：[报告](https://github.com/luofanghao9784/mengine-app/blob/d88da84e7a365801850f8216b0f781904aafa71f/docs/codex-tasks/CT-076-actual-diagnosis.md)、[JSON](https://github.com/luofanghao9784/mengine-app/blob/d88da84e7a365801850f8216b0f781904aafa71f/docs/codex-tasks/CT-076-evidence.json)。Native→Knowledge：0/1；Native→Table：0/1；两个反序均0/0。是旧执行结果，本轮未重跑。

## 实现及边界

完整可应用实现 diff：[CT-076-owned-native-isolation.patch](CT-076-owned-native-isolation.patch)；自包含验证驱动：[CT-076-verify-pairs.py](CT-076-verify-pairs.py)。

只改测试基础设施和测试类：
- NativeConversationIntegrationTest 类注册独立数据库，不改任何原 @Test/权限断言。
- wrapper 在其新建集群启动选项中设置每次随机 256-bit dreamcore.test_owner，向子进程传递对应值和临时 data_directory。
- IsolatedTestDatabase.registerOwned 在 CREATE DATABASE 之前核对 URL/账号/非空白密码、随机标记和服务端 data_directory。旧 register 调用保留原机制，同时拒绝空白密码。只有 Native 使用新增严格入口。
- Native 测试的前置探针从实际 native/material/knowledge 服务取出 JdbcTemplate，要求同一 DataSource 且实际 current_database 相同；要求 KnowledgeWorker 使用该 KnowledgeService；日志只输出随机测试库名和通过标记，绝不输出归属标记、数据库口令、文件内容。
- 不清空任何表，不清理其他 fixture，不改生产 claim/鉴权。

该约束证明正常测试链连接到本次 wrapper 启动的集群，不是对恶意同UID进程、superuser或伪造环境的安全认证。随机标记不打印。现有wrapper在成功启动后 finally 停库并由临时目录管理器清理；不承诺 SIGKILL/停库失败/部分启动异常的清理成功。

## 执行

复用已有授权云端独立副本及已探针确认的 Java21/PG18/Node24.20 环境，不另搭环境，不使用审核账号代写。使用 luofanghao9784 开发连接、任务分支；禁 force-push/直推main。Maven settings 使用执行岗自己的配置，不跨岗共享凭据。

在本提交的干净隔离副本：
~~~bash
python3 docs/codex-tasks/CT-076-verify-pairs.py \
  --repo /独立云端副本绝对路径 \
  --out /新的云端证据目录 \
  --phase green \
  --settings /执行岗自己的Maven配置绝对路径
~~~

驱动每个顺逆序各创建一次 wrapper 集群；每个方法各启一个 JVM，保存退出码、日志、Surefire XML：
1. NativeConversationIntegrationTest#crossSpaceReferenceReadsBoundVersionAndStillEnforcesOwnerPermissions → KnowledgeIntegrationTest#ordinaryHistoricalUploadStillGetsItsParse
2. 对应反序
3. 同一 Native 方法 → TableCalculationIntegrationTest#sourceAndCapabilityMustBelongToCurrentSpaceAndAttemptAndToolMustBeStarted
4. 对应反序

共8次选定方法；每次应1项、无failure/error。Native之后共享dreamcore_test队列数不变、隔离库数增加；各服务实际库探针应输出 CT076_DATABASE_BOUNDARY_OK。

5项负向：无wrapper环境、不合规URL、真实wrapper中错误归属标记、错误data_directory、空密码。必须非零退出并出现指定护栏错误；后三项必须在失败前后保持wrapper集群数据库数/队列数不变。驱动将预期负向拒绝视为验证成功，但仍保留 Maven 原非零退出码。每个包装命令结束应正常销毁该临时集群；执行岗另保存进程退出后 PG 已停止及临时目录已消失的脱敏证据，不能用源码推断清理成功。

复用已有红证据；若环境/依赖无法匹配才在原merge副本执行同一驱动 --phase red，不为补表重复已证实组合。若执行端已有相同用例在途，等自然节点再按新的修复 SHA 补必要复验，不重复启动。

质量须实际核验：原撤权前成功读取固定版本，素材/版本存在，撤权后当前主体 mask=0且读取拒绝；原 denied 只要求 IdentityException，因此单凭方法通过不能排除其他错误替代。不得放宽断言或把别的错误当成权限路径证据。

## 下一耗时对照（本轮仅源码读取，不启动）

固定读取 head 3e450e72660eda88498d4719e17f84a7a335f380：
GeneralExperienceSuggestionIntegrationTest#multipleContributionHopsRetainAllAncestorsAndEraseTransitively 建三版本祖先链，随后 read、tenantUsage.state、agents.active、停用祖先及 scrub_lifecycle_object。
TaskContextGuard.requireCurrent 经由实际业务检查访问 task_general_experience_dependencies、task_general_experiences_current、task_general_experiences_readable，并按祖先条目/版本取共享锁；同一 context 入口与返回处都检查（TaskContextService），因此祖先深度和重复守卫是可测变量，不是已证明瓶颈。

下一最少对照选择 GeneralExperienceSuggestionIntegrationTest#localAdaptationRecirculatesOnlyAfterCleanPrivacyQualityAndKeepsExactAncestry：同样 seed→publish→admitLocal→variation→admit→read(working)，但仅两个祖先版本，无末尾三代停用/清除链。新库单方法，前序为零；不要任选外类前序：该类已有类级 IsolatedTestDatabase，跨JVM即新库，外类数据前序不能模拟同库积累。原类没有显式方法顺序，源码邻接不是运行顺序。

待在途 PID20678 自然产出三代方法结果后，只有一跳对照尚无等价证据时再执行该一跳方法，分开计 seed/publish、admit、read/guard、stop/scrub 阶段和锁等待。不能由两个方法总耗时直接断言递归SQL为根因。确需积累对照时，应在诊断副本显式同JVM顺序（JUnit @Order），且先获取实际历史执行序列；不使用 -Dtest 列表先后作为确定执行顺序。

~~~bash
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml \
  -Dtest=GeneralExperienceSuggestionIntegrationTest#localAdaptationRecirculatesOnlyAfterCleanPrivacyQualityAndKeepsExactAncestry test
~~~

本轮没有启动此命令，没有触碰 PID20678。
