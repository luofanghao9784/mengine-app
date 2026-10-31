# CT-076：固定修复候选独立复验

候选 head：`3b5f566cb2330ad1b3bae27d41e6cc23268abe19`；唯一 parent／原CI merge：`3e6bdc740955b06ce6f5b250b43fb600d359104a`；tree：`68d122b56da56df1b2586facd013bbacba8bfc1d`。原#76 PR head另为`3e450e72660eda88498d4719e17f84a7a335f380`，不同版本结果不混用。

质量性能实际读取远端提交与本地完整diff，唯一变更是NativeConversationIntegrationTest注册IsolatedTestDatabase的4行；原全部断言、worker/claim/生产鉴权均未改。独立新worktree执行，最终git status --short为空、git diff --check退出0。

## 实际范围与结果

计数为tests/failures/errors/skipped；耗时取Surefire类耗时。命令整体耗时、逐类argv、原始方法名和身份快照见同目录CT-076-fixed-candidate-evidence.json。没有重跑原红基线。

| 严格顺序／selector | Maven退出码 | 计数 | 类耗时 |
|---|---:|---:|---:|
| fix-native-knowledge: NativeConversationIntegrationTest#crossSpaceReferenceReadsBoundVersionAndStillEnforcesOwnerPermissions | 0 | 1/0/0/0 | 10.145s |
| fix-native-knowledge: KnowledgeIntegrationTest#ordinaryHistoricalUploadStillGetsItsParse | 0 | 1/0/0/0 | 11.151s |
| fix-knowledge-native: KnowledgeIntegrationTest#ordinaryHistoricalUploadStillGetsItsParse | 0 | 1/0/0/0 | 10.335s |
| fix-knowledge-native: NativeConversationIntegrationTest#crossSpaceReferenceReadsBoundVersionAndStillEnforcesOwnerPermissions | 0 | 1/0/0/0 | 23.513s |
| fix-native-table: NativeConversationIntegrationTest#crossSpaceReferenceReadsBoundVersionAndStillEnforcesOwnerPermissions | 0 | 1/0/0/0 | 71.775s |
| fix-native-table: TableCalculationIntegrationTest#sourceAndCapabilityMustBelongToCurrentSpaceAndAttemptAndToolMustBeStarted | 0 | 1/0/0/0 | 110.642s |
| fix-table-native: TableCalculationIntegrationTest#sourceAndCapabilityMustBelongToCurrentSpaceAndAttemptAndToolMustBeStarted | 0 | 1/0/0/0 | 124.89s |
| fix-table-native: NativeConversationIntegrationTest#crossSpaceReferenceReadsBoundVersionAndStillEnforcesOwnerPermissions | 0 | 1/0/0/0 | 90.561s |
| fix-native-negative: NativeConversationIntegrationTest#ownerTenantAndCurrentMembershipGuardEveryEntry+nativeReadKeepsSourcePermissionsAndDoesNotExpandPublishAudience | 0 | 2/0/0/0 | 81.357s |

总计：10次原方法执行，0 failures、0 errors、0 skipped。各wrapper进程退出码另单列在JSON，不用Maven通过掩盖外层清理错误。

同条件使用Java21.0.13+9、PostgreSQL18.6、Node24.20.0及原Maven依赖环境；新副本`npm ci --prefix engine`和`npm run build --prefix engine`均退出0。每组由原with-test-postgres.py新建/销毁临时集群，同组两个Maven JVM顺序执行，反序另起新集群。每次先保存退出码、新Surefire和结果JSON再下一条；保留前后队列快照，不清理生产或其他fixture任务。诊断外层600秒边界未修改CI的90分钟配置。

## 隔离及权限证据的解释边界

驱动读取wrapper所有自有`dreamcore_test`与`dreamcore_isolated_test_*`数据库，不能只看主库为空。Native类的Flyway URL与上传队列快照均在隔离库；后序Knowledge/Table使用原wrapper主库。具体随机库名、任务/租户/版本及权限mask在JSON中逐组保留。隔离库内仍可留有前序合成QUEUED任务，修复机制是库隔离，不冒称fixture清理；wrapper退出后销毁整个临时集群。

静态读回证明NativeConversationService和KnowledgeService使用Spring注入JdbcTemplate，KnowledgeWorker通过注入同一KnowledgeService执行claim/input/finish，没有另造独立数据连接。此次验证了服务实际存储库及原调用链，但没有触发或等待真实周期worker tick，不能声称调度动态验收通过。

Table原权限用例保留跨空间/工具启动/过期租约403及零artifact断言。另执行Native的ownerTenantAndCurrentMembershipGuardEveryEntry、nativeReadKeepsSourcePermissionsAndDoesNotExpandPublishAudience原方法。Native辅助断言只要求IdentityException，结果只能证明原有拒绝行为保留，不能据此单独声称精确403或某一具体生产拒绝分支。

原merge已记录Native→Knowledge错误版本、Native→Table MATERIAL_NOT_FOUND且反序通过的红证据，见d88da84的CT-076-evidence.json；本次只执行修复候选对照，没有重复红基线。结论限定为本次夹具隔离修复范围，不能外推全部rest/general或产品验收通过，不能声称所有原CI失败均已归因或修复。

## 可复用的固定版本参数与命令

仅在已授权Linux云端使用；不要在本地Mac或现有预览副本运行。完整独立克隆、环境检查和可选Maven设置方法见[固定便携命令](https://github.com/luofanghao9784/mengine-app/blob/266e0079c078b16bd86505eb2742d581c9ca09c4/docs/codex-tasks/CT-076-portable-validation.md)。使用以下已确定的版本参数，执行其中独立副本准备、记录函数和四组validate即可；不要重跑旧红基线。

```bash
export CT076_MATERIAL_SHA=266e0079c078b16bd86505eb2742d581c9ca09c4
export CT076_SOURCE_SHA=3b5f566cb2330ad1b3bae27d41e6cc23268abe19
```

额外两项原负向方法（在同一准备完成的Bash会话、source根目录）：

```bash
validate native-negative \
 'NativeConversationIntegrationTest#ownerTenantAndCurrentMembershipGuardEveryEntry+nativeReadKeepsSourcePermissionsAndDoesNotExpandPublishAudience'
```

validate实际调用的完整驱动位于材料仓库相对路径`../materials/docs/codex-tasks/ct076-cross-jvm.py`；无任何私有驱动依赖。默认Maven不传-s；只有执行端确需网络设置时通过CT076_MAVEN_SETTINGS本地提供，内容不得提交。历史本次实际argv中的绝对路径按原样保留在JSON作为执行证据，不要求另一执行人复制该私有路径。

## 完整候选diff

```diff
diff --git a/apps/api/src/test/java/com/dreamcore/workspace/NativeConversationIntegrationTest.java b/apps/api/src/test/java/com/dreamcore/workspace/NativeConversationIntegrationTest.java
index d6e685fb..601f81df 100644
--- a/apps/api/src/test/java/com/dreamcore/workspace/NativeConversationIntegrationTest.java
+++ b/apps/api/src/test/java/com/dreamcore/workspace/NativeConversationIntegrationTest.java
@@ -12,6 +12,10 @@ import static org.junit.jupiter.api.Assertions.*;
 
 @SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.knowledge.enabled=true","dreamcore.tasks.enabled=true"})
 class NativeConversationIntegrationTest {
+ @org.springframework.test.context.DynamicPropertySource
+ static void isolateDatabase(org.springframework.test.context.DynamicPropertyRegistry registry) {
+  IsolatedTestDatabase.register(registry);
+ }
  @BeforeAll static void requireBuiltEngine(){NativeEnginePrerequisites.verify(NativeEnginePrerequisites.root());}
  @Autowired NativeConversationService nativeSessions;@Autowired MaterialService materials;@Autowired ConversationService conversations;@Autowired JdbcTemplate db;
  @org.springframework.boot.test.web.server.LocalServerPort int port;

```

## 仍未决

general长耗时、其余失败族、缓存context/后台调度竞争、真实parser/calculator依赖仍未决；原Harness TASK_MODEL_FAILED仅在此前单独新库未复现。队列修复不依赖bwrap，未为真实parser/calculator绕过OS沙箱。原云端bwrap探针 Operation not permitted、user-systemd offline的能力边界未被这次通过取代。

没有发新远端run、重试旧run、提高超时、修改main/门禁或部署。该记录是质量性能独立执行证据，不是正式非作者Approve，也不代表整片放行。

耗时观察补充：第四组Native运行中，对已核验cwd的本次JVM作一次只读jcmd线程采样，退出0；main为RUNNABLE，位于MaterialService.uploadReceipt的JDBC结果映射。单点样本不能解释原CI慢因，也不能据此声称数据库锁等待或性能已恢复；样本片段保留在JSON。
