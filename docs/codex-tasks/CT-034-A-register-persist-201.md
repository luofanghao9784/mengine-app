# CT-034-A 登记目录落库并返回 201（A 档）

状态：架构已裁可跑 · 待 docs 入库后交老板 Mac Codex　｜　分支：`codex/ct-034-a-register-persist-201`　｜　**审查人（PR 后两人审）：架构逻辑 + 安全审查 + 质量性能**　｜　基准：切单时最新 `origin/main`（须含 tip `022768b` / CT-034-P1 `#22`，以及 CT-035 `#21`）

> **日切片：D2 持久化真名单 / 可演示点**：已登录且 CSRF 有效时，`POST /api/agent-admin/v1/capabilities` 把一条平台级目录写入数据库并返回 **201**；无会话仍 **401**；有会话无 CSRF 仍 **403**。禁止无落库的假 201。  
> **挂靠**：两周日切片·轨 A，验收句 **W1** 的落库起步（登记保存落库），不是 W2–W5，也不是「开通给企业」。`docs/codex-tasks/两周日切片-三轨并行-20261031.md`。  
> **总负责人不代跑**；老板/后端岗在 Mac 自跑 Codex。模型 `gpt-6.1-sol`（仓内 CT-034-P1 / CT-035 惯用；本机若是 `gpt-5.1-codex` 亦可），思考强度 **high**。  
> **仓**：`luofanghao9784/mengine-app`。

规格依据：

- 旧薄片与门禁：[`CT-034-register-save-write-api-thin.md`](CT-034-register-save-write-api-thin.md)（C 档 stub 已合 `#14`；其「落库须带租户」**不要**沿用，以本单「平台全局」为准）、[`CT-034-P1-stub-security-replace-auth-csrf.md`](CT-034-P1-stub-security-replace-auth-csrf.md)（已合 `022768b`）
- 登录链已合：[`CT-035-agent-admin-login-tenant-isolation.md`](CT-035-agent-admin-login-tenant-isolation.md)（`bd06caf` / `#21`）
- ADR-B8 D8-4 / D8-5 / D8-7：`docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md`（登记表名 `qo_capability` 可作最小表名；授权表、开通、`CapabilityCatalogPort` 全套 **不是**本单）
- 今日控制器：`apps/api/src/main/java/com/dreamcore/workspace/agentadmin/CapabilityRegistryController.java`  
  合法 POST 在已登录 + CSRF 之后仍 **501**，`message`「登记保存还在开通中，请稍后再试」
- 今日安全链：`apps/api/src/main/java/com/dreamcore/workspace/identity/AgentAdminSecurity.java`（`@Order(3)`，`DREAMCORE_AGENT`，`ROLE_AGENT_ADMIN`）。`CapabilityRegistryStubSecurity` **已删除**，本单不得加回
- 契约：`contracts/public-api/capability-registry.openapi.json`  
  `Capability`：`additionalProperties:false`；`required` 只有 `capabilityId`、`name`；`enterpriseFunction` 引用闭集 `EnterpriseFunction`。`GET` `listCapabilities` 与 `/tenants/{tenantId}/grants` **仍是骨架，代码未实现**
- 错误形状：`contracts/public-api/error.schema.json`；人话引 [`QUEUE.md`](QUEUE.md)「编制·前端开发」硬性第 6 条（`message` 同样禁止裸词）
- 迁移：`apps/api/src/main/resources/db/migration-common/V190__agent_admin_identity_sessions.sql` 已占用。仓内 **没有** `qo_*` 登记表

> **脚注（今日实测口径）**：`CapabilityRegistryIntegrationTest` 已钉死无会话 POST → 401「还没有登录，请先登录后再试」；有会话无/错 CSRF → 403「登录校验未通过，请刷新页面后再试」；已登录 + CSRF + 合法体 → 501。未知字段 → 400「有无法识别的字段，请检查后再提交」。本单只把「合法且已过门闸」从 501 换成落库 201，401/403/400 的先后与文案保持。

### 架构已裁

#### 已裁九条（必须遵守）

1. **前提**：`CapabilityRegistryStubSecurity` 已删。未登录写 → **401** 人话；有会话无 CSRF → **403**。本单**不得**恢复 `permitAll`，不得恢复 `csrf.disable()` 意义上的开放链，不得把登记 POST 重新放成匿名可达。
2. **写口只** `POST /api/agent-admin/v1/capabilities`（及本单若明确裁出的那一个最小回读）。禁止任何 `/api/platform-admin/**` 写入口。禁止企业端、工作台去调这个登记写口。
3. **会话**：Cookie `DREAMCORE_AGENT` + 独立 `identity.AgentAdminSecurity`。不挂客户 `IdentitySecurity`。跨域 cookie 仍 **401**。不要另写一套登录。
4. **A 档目标**：已登录 + 有效 CSRF 的合法 POST → **落库并 201**（替换今日 501）。非法/未知字段仍 **400**。未登录仍 **401**。有会话无 CSRF 仍 **403**。400/401/403 **不得**插入行。
5. **`enterpriseFunction`**：按 OpenAPI，**不要**把 `required` 改成含它（今日 `required` 仍是 `capabilityId`、`name`）。出现时必须落在闭集 `document-parse`、`table-compare`、`quality-check`、`semantic-annotation`、`repair-suggestion`；闭集外 **400**。`additionalProperties:false` 保持。演示与主验收请求至少带 `quality-check`，且该值必须写进库。省略 `enterpriseFunction` 时按 schema 仍可 201，不要擅自改成必填。ADR 预留值的 `ENTERPRISE_FUNCTION_NOT_ENABLED`（422）**不在本单**。
6. **持久化**落在 agentadmin 登记表：仓内还没有 `qo_*`。本单建**最小**平台目录表（表名用 `qo_capability`，只含本单登记列）。写者放在现有 `com.dreamcore.workspace.agentadmin`。不要借机拆出整套 `agentregistry.*`，不要做 ArchUnit R-B8。**禁止**假 201 无落库。
7. **非范围**：企业侧消费 UI（CT-036）；批量开通页精致化；登录签发（已合 CT-035）；模块版本、准入测试、授权给企业、四眼、审计全量。
8. **人话**：错误 `message` 用中文白话。禁止在 `message`（以及任何本单新加的可见文案）里裸用 `seed` / `capability` / `Capability` / `Grant` / `admission`。API 的 `code` 可保留英文码。不要改 `IdentityErrors` 或 `AgentAdminErrors` 的全局文案去波及登录。
9. **测试**：未登录 401；无 CSRF 403；合法 → 201 且能再读到刚写入的行；重复/冲突行为按下条钉死；未知字段 400 且不落库。

**重复/冲突（钉死）**：`capability_id` 平台级唯一。同一 `capabilityId` 再次合法 POST → **409**，人话例：「已经登记过了，请勿重复提交」。不插第二行，不覆盖已有 `name` / `enterprise_function` / `kind`，不再返回 201。不同 `capabilityId` 各 201 一行。

#### 后端前置（须原样遵守）

1) **登记落库=平台全局**：第四端会话无 tenant；`POST /api/agent-admin/v1/capabilities` 写入的是**平台级能力目录**（非某租户私有）。勿写成带 tenant_id 的租户域落库，勿与旧薄片 CT-034（C 档 stub）冲突。给企业开通是另一条写（非本单 A 档；本单只做目录登记→201）。
2) 企业侧「本租户已开通」读口归 **CT-039**，本单禁止实现/冒充企业读口，也禁止让企业端调本登记写口。
3) 若需新表/改表：**下一迁移宜 V191+**（勿占 V190；V190 已给 agent_admin identity）。契约里 GET list/grants **均未实现**——本单不要假装已有 list；A 档验收可用「落库后同连接/测试直接读表或本单最小 GET（若裁）」，但默认 **不要**依赖未实现的 OpenAPI GET list/grants。

## ① 目标与范围

- **目标**：把已过第四端会话和 CSRF 的合法登记 POST，从诚实 501 改成平台目录落库并 **201**。
- **增量边界**：
  1. `CapabilityRegistryController.registerCapability`：校验通过后写入 `qo_capability`，返回 201 与所存字段（形状仍是 `Capability`，不多给字段）。不再对合法请求返回 501 或「登记保存还在开通中，请稍后再试」。
  2. 新迁移只放在 `apps/api/src/main/resources/db/migration-common/`。版本号为三处迁移目录当前最大号 + 1，且 **≥ V191**。只建平台目录最小表：`capability_id` 主键、`name` 非空、可选 `kind`（仅空或 `quality_check`）、可选 `enterprise_function`（仅空或闭集五值）、`created_at`。**无 `tenant_id`**。禁止改 V190 与任何已有迁移。禁止建 `qo_module_version`、`qo_capability_tenant_grant`、`qo_admission_test_record`、`qo_tenant_module_enablement`。
  3. 空白的 `capabilityId` / `name`（trim 后为空）→ 400「请按要求填写登记内容」，不插入。
  4. 回读默认：集成测试用同一 `JdbcTemplate` 读刚插入的行。默认**不要**新增 GET。若测试实在不能同库读表，才允许本单另裁一个最小 GET，PR 写明「不是 OpenAPI `listCapabilities`，也不是 grants」。
  5. `capability-registry.openapi.json` 只允许把 POST 201 与 `info.description` 从「未实现 / 501」改成「CT-034-A：平台目录已落库」。**不要**把 `listCapabilities`、modules、grants 写成已实现。不要改 `required`，不要改路径前缀。
  6. 改 `CapabilityRegistryIntegrationTest`：今日期望 501 的合法请求改为 201 + 读表断言；401/403/400 保持；补 409 与「失败不插行」。
- **改哪些文件（允许）**：
  - `apps/api/src/main/java/com/dreamcore/workspace/agentadmin/CapabilityRegistryController.java`（及同包最小写入类，若控制器不宜直接写 SQL）
  - `apps/api/src/test/java/com/dreamcore/workspace/CapabilityRegistryIntegrationTest.java`
  - `apps/api/src/main/resources/db/migration-common/V<≥191>__*.sql`（只增）
  - `contracts/public-api/capability-registry.openapi.json`（仅 POST 实现状态说明）
- **不做什么**：见架构已裁第 7 条与后端前置第 2、3 条。不改 `AgentAdminSecurity` 的放行范围（`permitAll` 仍只给 csrf 与 login）。

### 契约贴合点

| 项 | 约定 |
|---|---|
| POST | `/api/agent-admin/v1/capabilities` · `registerCapability` · 合法 → 201 |
| 目录范围 | 平台全局；无 `tenant_id`；会话无租户 |
| 回读 | 测试直接读 `qo_capability`；不依赖未实现的 GET list/grants |
| 冲突 | 同一 `capabilityId` → 409，不覆盖 |
| 错误 | JSON 四字段；`message` 中文白话；无堆栈、无裸术语 |

## ② 前置条件与分支名

- **⓪ 暂停令自查**：有或拿不准 → 立刻停，问 DQ。
- **依赖**：CT-034-P1 与 CT-035 已在 main。本单不再等门禁。企业读（CT-039）与企业消费（CT-036）都不要提前做。
- 正确仓：`~/Desktop/mengine-app-luofanghao9784`（origin=`luofanghao9784/mengine-app`）。

```bash
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || { echo 'ERROR: 错误 remote，停'; exit 1; }
git status
git switch main && git pull
git merge-base --is-ancestor 022768b HEAD || { echo 'ERROR: main 不含 CT-034-P1，停'; exit 1; }
test ! -e apps/api/src/main/java/com/dreamcore/workspace/agentadmin/CapabilityRegistryStubSecurity.java || { echo 'ERROR: StubSecurity 还在，停'; exit 1; }
test -f apps/api/src/main/resources/db/migration-common/V190__agent_admin_identity_sessions.sql || { echo 'ERROR: 找不到 V190，停'; exit 1; }
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export POSTGRES_BIN="$(brew --prefix postgresql@18)/bin"
git switch -c codex/ct-034-a-register-persist-201
```

## ③ 完整 Codex 提示词

把下面整段交给 Codex（`$CODEX`，模型 `gpt-6.1-sol`，思考强度 **high**；本机模型若是 `gpt-5.1-codex` 亦可）：

```
你在梦擎仓库分支 codex/ct-034-a-register-persist-201 上工作。基准 origin/main，须含 022768b（CT-034-P1 #22）与 CT-035 #21。只做本单范围。执行单：docs/codex-tasks/CT-034-A-register-persist-201.md。
对照：docs/codex-tasks/CT-034-register-save-write-api-thin.md、docs/codex-tasks/CT-034-P1-stub-security-replace-auth-csrf.md、docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md。
今日代码：apps/api/src/main/java/com/dreamcore/workspace/agentadmin/CapabilityRegistryController.java 在已登录且 CSRF 有效时对合法 POST 返回 501，message「登记保存还在开通中，请稍后再试」。apps/api/src/main/java/com/dreamcore/workspace/identity/AgentAdminSecurity.java 已是独立链。CapabilityRegistryStubSecurity 已不存在。
契约：contracts/public-api/capability-registry.openapi.json。Capability additionalProperties:false，required 只有 capabilityId 与 name。GET listCapabilities 与 grants 都还是骨架。
错误形状：contracts/public-api/error.schema.json。人话：docs/codex-tasks/QUEUE.md 编制·前端开发硬性第 6 条。message 禁止裸用 seed、capability、Capability、Grant、admission。code 可以保留英文。
两周挂靠：docs/codex-tasks/两周日切片-三轨并行-20261031.md（W1 落库起步，不是开通给企业）。

【已裁九条】
1. StubSecurity 已删。未登录写 → 401 人话；有会话无 CSRF → 403。本单不得恢复 permitAll，不得把登记 POST 重新匿名放行。
2. 写口只 POST /api/agent-admin/v1/capabilities，外加本单若明确裁出的一个最小回读。禁止 platform-admin 写入口。禁止企业端或工作台调用这个写口。
3. 会话是 DREAMCORE_AGENT，安全链是已有的 identity.AgentAdminSecurity。禁止挂回客户 IdentitySecurity。不要重做登录。
4. 已登录 + 有效 CSRF + 合法 POST → 落库并 201，替换今日 501。未知字段与非法字段仍 400。未登录仍 401。有会话无 CSRF 仍 403。400/401/403 不得插入行。
5. enterpriseFunction 按 OpenAPI：不要改 required（仍是 capabilityId、name）。出现时必须是闭集 document-parse、table-compare、quality-check、semantic-annotation、repair-suggestion，否则 400。additionalProperties:false。演示请求必须带 quality-check，并且这个值要写进库。省略 enterpriseFunction 仍可 201。不要做 ENTERPRISE_FUNCTION_NOT_ENABLED 422。
6. 持久化用本单最小表 qo_capability，写在 com.dreamcore.workspace.agentadmin。不要搬迁整包到 agentregistry，不要做 ArchUnit。禁止没有插入却返回 201。
7. 非范围：CT-036 企业消费 UI、批量开通页、CT-035 登录、模块版本、准入、授权给企业。
8. 错误 message 人话。不要改 IdentityErrors / AgentAdminErrors 的全局文案。
9. 测试覆盖：未登录 401；无 CSRF 403；合法 201 且再读得到；重复冲突按下一条；未知字段 400。

重复钉死：capability_id 平台级唯一。同一 capabilityId 再 POST → 409，message 例：「已经登记过了，请勿重复提交」。不插第二行，不更新旧行，不再 201。不同 capabilityId 各一行。

【后端前置·原样】
1) **登记落库=平台全局**：第四端会话无 tenant；`POST /api/agent-admin/v1/capabilities` 写入的是**平台级能力目录**（非某租户私有）。勿写成带 tenant_id 的租户域落库，勿与旧薄片 CT-034（C 档 stub）冲突。给企业开通是另一条写（非本单 A 档；本单只做目录登记→201）。
2) 企业侧「本租户已开通」读口归 **CT-039**，本单禁止实现/冒充企业读口，也禁止让企业端调本登记写口。
3) 若需新表/改表：**下一迁移宜 V191+**（勿占 V190；V190 已给 agent_admin identity）。契约里 GET list/grants **均未实现**——本单不要假装已有 list；A 档验收可用「落库后同连接/测试直接读表或本单最小 GET（若裁）」，但默认 **不要**依赖未实现的 OpenAPI GET list/grants。

【要做成】
1. 迁移只新增在 db/migration-common。先看 db/migration、db/migration-local、db/migration-common 的最大号。版本号 = 最大号 + 1，且必须 ≥ V191。V190 是 agent_platform_accounts / agent_platform_sessions，禁止改它。表 qo_capability：capability_id 主键（非空文本）、name 非空、kind 可空且只允许 quality_check、enterprise_function 可空且只允许闭集五值、created_at。不要 tenant_id，不要租户索引，不要 grant 列。
2. 控制器在现有字段校验之后写入该表。201 的 JSON 只含本次存下的 Capability 字段（至少 capabilityId、name；有 enterpriseFunction / kind 则一并返回）。Cache-Control: no-store。合法请求禁止再返回 501 和「登记保存还在开通中，请稍后再试」。
3. trim 后空白的 capabilityId 或 name → 400「请按要求填写登记内容」，不插入。未知字段仍 400「有无法识别的字段，请检查后再提交」，不插入。校验失败不得先插入再回滚成业务错误以外的 500。
4. 重复 capabilityId → 409，四字段错误 JSON，retryable=false，人话如上。旧行字节级不变。
5. 回读：CapabilityRegistryIntegrationTest 用已有 JdbcTemplate 查询 qo_capability。默认不要新 GET。不要实现 listCapabilities，不要实现 grants，不要写 tenant-admin / workspace 读口。
6. 改测试，保留方法精神，501 期望改为 201：
   - unauthenticatedWriteReturnsChinese401BeforeBodyValidation：仍 401，且 qo_capability 行数不变。
   - sessionWithoutOrWithWrongCsrfReturnsChinese403：仍 403，不插行。
   - authenticatedControllerReturnsHonestChinese501WithSessionAndCsrf：合法体改为 201；库中 capability_id=quality-check、name=质量检查、enterprise_function=quality-check；无 tenant 列。
   - authenticatedUnknownFieldsReturnChinese400、capabilityRequiredFieldsTypesAndClosedEnumsAreValidated：仍 400，不插行。
   - csrfIsBoundToTheAuthenticatedSession 与 dedicatedChainDoesNotOpenOtherMethods 里原先期望 501 的那一击，改为 201（邻接 401/403 不变）。
   - 新增：同一 capabilityId 再 POST → 409，仍一行，name 不被改写。
7. OpenAPI 只更新 POST 与 info.description 的实现状态一句：CT-034-A 平台目录已落库。GET list 与 grants 的描述保持「骨架 · 未实现」。

【不许碰】
src/** 前端、engine/**、workers/parser、AgentAdminSecurity 的 permitAll 范围、客户 IdentitySecurity、已有 Flyway（含 V190）、登录四个端点、CT-036、CT-039 的企业读口、grants、模块版本、准入、force push、reset --hard、直推 main、gh issue、口令入库。
禁止恢复 CapabilityRegistryStubSecurity 或任何 permitAll 登记 POST。
禁止给 qo_capability 加 tenant_id。禁止企业端调用本写口。
禁止改 Java 包名 dreamcore、/mengine-api、MENGINE_*。

【验收】
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export POSTGRES_BIN="$(brew --prefix postgresql@18)/bin"
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml test -Dtest=CapabilityRegistryIntegrationTest
禁止 -DskipTests。

无 cookie 仍是 401 不是 201：
curl -si -X POST "http://127.0.0.1:50831/api/agent-admin/v1/capabilities" \
  -H "Content-Type: application/json" \
  -d '{"capabilityId":"quality-check","name":"质量检查","enterpriseFunction":"quality-check"}'

已登录且 CSRF 正确时期望 201，并且测试库 qo_capability 有对应行。不要用未实现的 GET /api/agent-admin/v1/capabilities 当验收。

【做完输出】git diff --stat、迁移文件名（必须 V191 或更大）、201 是否能在表里读回、409 是否不覆盖、确认没有 tenant_id、没有新的 list/grants 路由、没有恢复 permitAll。
```

## ④ 推荐模型与思考强度

- 模型：`gpt-6.1-sol`（仓内惯用，与 CT-034-P1 / CT-035 相同；本机若是 `gpt-5.1-codex` 亦可）
- 思考强度：**high**（401/403 顺序、平台表误加 tenant、假 201、把未实现的 list 当成验收，都会把 W1 做成错库或假成功）
- **预计耗时**：Codex 40–80 分钟；测试 15–30 分钟

## ⑤ 可复制 git 步骤（跑完如何提交）

```bash
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || exit 1
git add apps/api/src/main/java/com/dreamcore/workspace/agentadmin \
  apps/api/src/test/java/com/dreamcore/workspace/CapabilityRegistryIntegrationTest.java \
  apps/api/src/main/resources/db/migration-common \
  contracts/public-api/capability-registry.openapi.json
git diff --cached --stat | grep -E 'V190__|src/features/|workers/parser|IdentitySecurity' && echo 'ERROR: V190/前端/客户链非本单' && exit 1
git commit -m "$(cat <<'EOM'
feat(api): CT-034-A 登记目录落库并返回 201

已登录且 CSRF 有效的合法 POST 写入平台级 qo_capability。
无会话仍 401；重复 capabilityId 为 409。不恢复开放链。
EOM
)"
git push -u origin codex/ct-034-a-register-persist-201
gh pr create -R luofanghao9784/mengine-app --base main --head codex/ct-034-a-register-persist-201 \
  --title "feat(api): CT-034-A 登记目录落库并返回 201" \
  --body "## 摘要
已登录且 CSRF 有效时，POST /api/agent-admin/v1/capabilities 写入平台级目录并返回 201，替换 501。无 tenant_id。未登录仍 401。重复登记 409。

## 验收句
W1 起步：登记保存落库。不是开通给企业，不是 W2–W5。

## 审查
- 架构逻辑 + 安全审查 + 质量性能
- 挂靠 ADR-B8 第四端写路径；不得恢复 permitAll
- 企业「本租户已开通」读口归 CT-039，本 PR 不做
- 勿自动合并"
```

网页备用：https://github.com/luofanghao9784/mengine-app/compare/main...codex/ct-034-a-register-persist-201

## ⑥ 验收标准

| # | 标准 | 如何验 |
|---|---|---|
| A1 | 合法落库 | 已登录 + CSRF + `capabilityId`/`name`/`enterpriseFunction=quality-check` → **201**；`qo_capability` 能读到该行，且值为 quality-check |
| A2 | 无假成功 | 201 的同一测试连接里行存在；没有插入时不得 201 |
| A3 | 未登录 | 无 cookie POST → **401**，文案仍是「还没有登录，请先登录后再试」；行数不变 |
| A4 | CSRF | 有会话、不带或错 `X-CSRF-TOKEN` → **403**；不插行 |
| A5 | 未知字段 | 多余字段 → **400**「有无法识别的字段，请检查后再提交」；不插行 |
| A6 | 冲突 | 同一 `capabilityId` 再 POST → **409**，仍一行，旧 `name` 不变 |
| A7 | 平台全局 | 表与插入语句都没有 `tenant_id`；不读租户、不造 `ExecutionScope` |
| A8 | 无假 list | 未实现 `listCapabilities` 与 grants；验收不依赖这两条 GET |
| A9 | 门禁还在 | 源码没有登记 POST 的 `permitAll`；`CapabilityRegistryStubSecurity` 不存在 |
| A10 | 迁移 | 新文件版本 ≥ V191，在 `migration-common`；V190 无 diff |
| A11 | 测试 | `CapabilityRegistryIntegrationTest` 按上表改完且绿；未用 `-DskipTests` |
| A12 | 边界 | 无前端 diff；无企业读口；无 platform-admin 写入口；`message` 无裸术语 |

## ⑦ 禁止操作 / 失败卡住

| 症状 | 动作 |
|---|---|
| remote 不是 mengine-app | 立刻停 |
| 有暂停令 | 不开 Codex；问 DQ |
| main 不含 `022768b` | 停；先拉含 CT-034-P1 的 main |
| 找不到 V190，或新迁移用了 ≤ V190 | 停；改为当前最大号 + 1 且 ≥ V191 |
| 无会话变成 201 或 501 | 未完成；401 必须仍在过滤器里先返回 |
| 无会话变成 403 | 调整顺序：先认会话，再查 CSRF。不要改成先 CSRF |
| 201 但表里没有行，或表带 `tenant_id` | **打回** |
| 实现了 list 或 grants，或企业端能调这个 POST | **打回**；企业读归 CT-039 |
| 同一 `capabilityId` 插了两行或覆盖了 name | **打回**；改为 409 且不更新 |
| 出现 `permitAll` 或 StubSecurity | **打回** |
| 测试红 | 修到绿；禁止 `-DskipTests` |
| CONFLICT / push rejected | rebase 一次；仍失败停 |

**硬禁止**：

- 恢复 `permitAll`，或新建一条不校验 CSRF 的登记 POST
- 无落库返回 201
- 给目录表加 `tenant_id`，或把本单做成「开通给企业」
- 实现或冒充企业侧「本租户已开通」读口（CT-039），或让企业端调用本写口
- 把未实现的 OpenAPI GET list/grants 写成已实现，并靠它们验收
- 占用或修改 V190
- `git push --force`、`git reset --hard`、直推 `main`
- 改前端、改包名、改 `/mengine-api`、改 `MENGINE_*`
- `gh issue`；口令进仓库
- 有暂停令仍开 Codex

回滚（未合入）：`git switch main && git branch -D codex/ct-034-a-register-persist-201`。

---

**DQ 审路径**：本文件「架构已裁」九条 + 后端前置三条原文 + ADR-B8 D8-5 的登记表面（不要做到授权）。通过后交老板/后端岗 Mac 粘贴③开跑。安全审查必看：不得恢复开放链、不得把平台目录写成租户表。总负责人不代跑。
