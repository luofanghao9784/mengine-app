# CT-040 第四端「开通给企业」写口

> **现状**：#41 已合 348cafc，生产 CapabilityCatalogPort=GrantCatalogAdapter，Empty 已删。下文若仍写 Empty 恒空，以本句为准。

状态：架构已裁可跑 · 待 docs 入库后交老板 Mac Codex　｜　分支：`codex/ct-040-agent-admin-grant-tenant-opened`　｜　**审查人（PR 后两人审）：架构逻辑 + 安全审查 + 质量性能**　｜　基准：切单时最新 `origin/main`（须含 tip `7fa4946` / #35 接真；其前含 CT-037 `1d847e6` / #32、CT-039 实现 `701c3ca` / [#31](https://github.com/luofanghao9784/mengine-app/pull/31)、CT-034-A 实现 `75ab17a` / [#30](https://github.com/luofanghao9784/mengine-app/pull/30)、CT-039 执行单 `e2415b8` / [#29](https://github.com/luofanghao9784/mengine-app/pull/29)、CT-034-A 执行单 `fdc22fe` / #28、空态壳 `#25`/`7e21bc0`、登记鉴权 `#22`/`022768b`、第四端登录 `#21`/`bd06caf`）

> **日切片：D6 写侧 / 可演示点**：已登录且 CSRF 有效时，`POST /api/agent-admin/v1/tenants/{tenantId}/grants` 把一条**已登记**的企业功能授权给路径上的那个企业，返回 **201**，同一测试库能读到带 `tenant_id` 的行。无会话仍 **401**。有会话无 CSRF 仍 **403**。重复开通同一项 → **200**，不插第二行，不改已有审计列。禁止无落库的 201，禁止把登记目录 POST 再做成开通。  
> **挂靠**：两周日切片·轨 A。验收句 **W1** 里的「开通给企业」写口，不是登记目录（CT-034-A 已合），不是企业读口（CT-039），不是消费页（CT-036），不是现网冒烟（CT-037）。`docs/codex-tasks/两周日切片-三轨并行-20261031.md`。  
> **总负责人不代跑**；老板/后端岗在 Mac 自跑 Codex。模型 `gpt-6.1-sol`（与 CT-034-A / CT-035 相同；本机若是 `gpt-5.1-codex` 亦可），思考强度 **high**。  
> **仓**：`luofanghao9784/mengine-app`。

规格依据：

- 登记目录已合：[`CT-034-A-register-persist-201.md`](CT-034-A-register-persist-201.md)（实现 `75ab17a` / #30）。表 `qo_capability` **无** `tenant_id`。迁移 `V191__platform_capability_registry.sql`。写口仍只是 `POST /api/agent-admin/v1/capabilities`
- 企业读口：[`CT-039-tenant-opened-capabilities-readonly.md`](CT-039-tenant-opened-capabilities-readonly.md)（执行单 `e2415b8` / #29，**实现已合** `701c3ca` / [#31](https://github.com/luofanghao9784/mengine-app/pull/31)）。读路径是 `GET /api/tenant-admin/v1/opened-capabilities`，不是第四端 grants。生产 `EmptyCapabilityCatalogAdapter` 仍空。**#35 接真已合** `7fa4946`（前端已消费读口，未改生产 adapter）。**CT-037 已合** `1d847e6`。开通真源仍靠本单写口，合入后由读口接。测试可对照授权表
- 消费骨架：[`CT-036-enterprise-consume-opened-capability.md`](CT-036-enterprise-consume-opened-capability.md)。本单不改它的前端
- ADR-B8 D8-1 / D8-5：`docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md`。授权唯一写入口在第四端；租户不得自授；`tenantId` 只作被授权对象出现在路径上。本单**不做**模块版本、默认版本、`CAPABILITY_DEFAULT_NOT_CONFIGURED`
- 今日契约：`contracts/public-api/capability-registry.openapi.json`  
  `POST /api/agent-admin/v1/tenants/{tenantId}/grants` · `createCapabilityTenantGrant` 仍是骨架（成功体占位 201，并标 501）。`GET` 同路径 · `listCapabilityTenantGrants` 仍是骨架。`info.description` 写明 grants 未实现  
  今日 `CapabilityTenantGrantCreate` 的 required 是 `moduleVersionId`、`isDefault`。仓内**没有** `qo_module_version`。按该体原样落库只能编造版本号，本单禁止
- 今日安全链：`apps/api/src/main/java/com/dreamcore/workspace/identity/AgentAdminSecurity.java`（`@Order(3)`，匹配 `/api/agent-admin/**`，`DREAMCORE_AGENT`，`ROLE_AGENT_ADMIN`）。`permitAll` 只有 csrf 与 login。未登录写 401「还没有登录，请先登录后再试」；有会话无/错 CSRF 403「登录校验未通过，请刷新页面后再试」。`CapabilityRegistryStubSecurity` **已删除**，本单不得加回
- 错误形状：`contracts/public-api/error.schema.json`（`contractVersion`、`code`、`message`、`retryable`）。人话引 [`QUEUE.md`](QUEUE.md)「编制·前端开发」硬性第 6 条：`message` 禁止裸用 `seed` / `capability` / `Capability` / `Grant` / `admission`
- 迁移：`V190__agent_admin_identity_sessions.sql`、`V191__platform_capability_registry.sql` 已占用。**V192 留给 CT-039 投影**（文件可以还不存在，本单也不许占）。本单新文件 **≥ V193**

> **脚注（今日实测口径）**：登记 POST 在 `75ab17a` 已是「未登录 401、无 CSRF 403、合法 201、重复 capabilityId 409」。开通 POST 在代码里还没有控制器；契约仍写骨架/501。本单新增开通写，不改登记 POST 的状态码和文案。  
> **脚注（CT-039 #31）**：CT-039 **实现已合** main `701c3ca` / [#31](https://github.com/luofanghao9784/mengine-app/pull/31)。生产 `EmptyCapabilityCatalogAdapter` 仍恒为空，不把登记行当成开通。**#35 接真已合** `7fa4946`。**CT-037 已合** `1d847e6`。开通真源仍靠本单写口，合入后由读口接。测试可对照授权表。本单不改那条读口。

### 架构已裁

#### 已裁（必须遵守）

1. **本单是开通写，不是登记目录。** 平台全局 `qo_capability` 已由 CT-034-A 落库。本单把某条**已经登记**、且 `enterprise_function` 非空的目录行，授权给路径上的那个企业。禁止改 `POST /api/agent-admin/v1/capabilities` 的 201/409/400/401/403。禁止给 `qo_capability` 加 `tenant_id`。禁止改 V191。
2. **表面钉死**：`POST /api/agent-admin/v1/tenants/{tenantId}/grants`（operationId `createCapabilityTenantGrant`）。会话 Cookie `DREAMCORE_AGENT` + 已有 `identity.AgentAdminSecurity`。未登录 → **401**。有会话但无/错 `X-CSRF-TOKEN` → **403**。先认会话，再查 CSRF，再验 body。禁止 `permitAll`，禁止新的开放链。禁止任何 `/api/platform-admin/**` 写入口。禁止企业会话、工作台、tenant-admin 自开通（不得新增会插入授权表的 `/api/v1/**` 或 `/api/tenant-admin/**` 路由）。
3. **契约**：实现上面这条 POST 写。`GET /api/agent-admin/v1/tenants/{tenantId}/grants`（`listCapabilityTenantGrants`）**保持未实现**，不要加 GET 控制器，不要把 GET 描述改成已实现。企业侧「本租户已开通」仍走 CT-039，本单不实现那条读口。
4. **持久化**：新表 `qo_capability_tenant_grant`，**必须有 `tenant_id`**。只新增迁移，版本号为 `db/migration`、`db/migration-local`、`db/migration-common` 三处当前最大号 + 1，且 **≥ V193**。V192 文件可以还不存在，本单也不许用 V192；那时版本取 193（或更大的最大号 + 1），把较小空号留给 CT-039。CT-039 之后只能继续用当时最大号 + 1，不能回头插入比已合迁移更小的号。禁止改已有迁移。禁止占用 V191。禁止建 `qo_module_version`、`qo_admission_test_record`、`qo_tenant_module_enablement`。
5. **幂等钉死为 200，且不覆盖**（实现 PR 正文必须写明这句）：
   - 该企业该 `enterprise_function` 还没有行，且校验通过 → **201**，插入一行。
   - 同一 `tenantId` + 同一 `enterpriseFunction` + 同一 `capabilityId` 再 POST → **200**，返回已有行（含原来的 `grantedAt`）。不插第二行，不执行 UPDATE，`granted_at` 与 `capability_id` 字节级不变。
   - 同一 `tenantId` + 同一 `enterpriseFunction`，但 `capabilityId` 与已有行不同 → **409**，人话「已经开通过了，不能改成另一项」。不插入、不更新。这不是重复开通，是改指向。
6. **人话与假成功**：错误 `message` 用中文白话，四字段 JSON，`retryable=false`，无堆栈。`code` 可保留英文。JSON 字段名沿用下面钉死的名字。401/403/400/404/409 **不得**插入或修改授权行。没有插入时不得 201。200 只表示已有行并且本次没有改它。
7. **非范围**：精致开通页（agent-admin「开通给企业」可继续灰钮）；批量开通（body 是数组 → 400）；CT-036 前端与空态壳接线；CT-037 现网冒烟；模块版本、`isDefault`、准入、四眼、默认版本解析；第四端 grants GET；CT-039 企业读口实现；登录签发。

#### 请求 / 表 / 响应（钉死）

今日骨架的 create 体是 `moduleVersionId` + `isDefault`。没有模块版本表。本单把 **POST 的请求体和成功体**改成开通字段，并在 `info.description` 写明：这是 CT-040 开通写，不是模块版本授权。`GET` 仍可引用原来的 `CapabilityTenantGrant`（含 `moduleVersionId`），描述保持「骨架 · 未实现」。不要为了填满旧 required 而编造 `moduleVersionId` 或 `isDefault`。

请求体（`additionalProperties: false`，必填只有这两项）：

```json
{"capabilityId":"quality-check","enterpriseFunction":"quality-check"}
```

- `capabilityId`、`enterpriseFunction` 都必须是非空文本。trim 后为空 → 400「请按要求填写开通内容」。
- `enterpriseFunction` 闭集：`document-parse`、`table-compare`、`quality-check`、`semantic-annotation`、`repair-suggestion`。闭集外 → 400「请按要求填写开通内容」。
- 出现 `moduleVersionId`、`isDefault`、`tenantId`、`grantedBy`、`grantedAt` 或任何其他字段 → 400「有无法识别的字段，请检查后再提交」。租户只来自路径。
- 路径 `tenantId` 不是 UUID → 400「请按要求填写开通内容」，不查库。
- UUID 在 `tenants` 里不存在 → 404「没有这个企业，不能开通」，不插入。本单不新建企业，不按状态过滤。
- `capabilityId` 在 `qo_capability` 不存在 → 404「还没有这项登记，请先登记再开通」，不插入。禁止顺手写目录。
- 目录行的 `enterprise_function` 为空，或与 body 的 `enterpriseFunction` 不一致 → 400「请按要求填写开通内容」，不插入。不得用 body 改写目录上的功能。

表（仅此列）：

```sql
CREATE TABLE qo_capability_tenant_grant (
    tenant_id uuid NOT NULL REFERENCES tenants (id),
    enterprise_function text NOT NULL CHECK (enterprise_function IN (
        'document-parse', 'table-compare', 'quality-check',
        'semantic-annotation', 'repair-suggestion'
    )),
    capability_id text NOT NULL REFERENCES qo_capability (capability_id),
    granted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, enterprise_function)
);
```

无 `is_default`，无 `module_version_id`，无 `granted_by`。写入用「冲突则不更新」：`INSERT ... ON CONFLICT DO NOTHING` 后再读回。禁止 `ON CONFLICT DO UPDATE`。

成功体（201 与 200 相同形状，`additionalProperties: false`）：

```json
{"tenantId":"<路径上的 uuid>","capabilityId":"quality-check","enterpriseFunction":"quality-check","grantedAt":"<该行的 granted_at>"}
```

`grantedAt` 来自数据库该行，不来自请求。`Cache-Control: no-store`。演示与主验收用 `quality-check`。

#### 后端前置（须原样遵守）

1. 第四端会话没有租户。路径上的 `tenantId` 是被开通的企业，不是调用者的租户。不要从 `DREAMCORE_AGENT` 会话里读 tenant，也不要造 `ExecutionScope`。
2. 企业读口归 **CT-039**。本单禁止实现 `GET /api/tenant-admin/v1/opened-capabilities`，禁止实现 `listCapabilityTenantGrants`，禁止让企业会话调用本 POST。
3. CT-039 **实现已合** `701c3ca` / #31。生产 `EmptyCapabilityCatalogAdapter` 仍空。开通真源仍靠本单写口，合入后由读口接。本单测试用同一 `JdbcTemplate` 直读 `qo_capability_tenant_grant`（可对照授权表）。不要为了验收去改 CT-039 读口，也不要另造第二张开通真源表。
4. 写者放在现有 `com.dreamcore.workspace.agentadmin`（新控制器即可，例如 `CapabilityTenantGrantController`）。不要借机拆 `agentregistry.*`，不要做 ArchUnit R-B8。`qualityops` 不得在本单里 SQL 这张表。

## ① 目标与范围

- **目标**：第四端登录并通过 CSRF 后，可以把一条已登记的企业功能开通给指定企业；库里留下带 `tenant_id` 的授权行；重复开通不覆盖。
- **增量边界**：
  1. 新开通控制器，只处理上面那条 POST。登记控制器的行为保持 `75ab17a`。
  2. 新迁移只建 `qo_capability_tenant_grant`。不改 `qo_capability`。
  3. 按「请求 / 表 / 响应」校验。失败不写行。
  4. OpenAPI 只改这条 POST 的请求体、201、新增的 200、以及 `info.description` 里关于开通写的一句。GET、modules、admission 的「骨架 · 未实现」保持。登记 POST 的「已落库」描述保持。
  5. 新测试 `CapabilityTenantGrantIntegrationTest`。登录与 CSRF 做法对齐 `CapabilityRegistryIntegrationTest`（真实 `DREAMCORE_AGENT`，不手插会话冒充）。
- **改哪些文件（允许）**：
  - `apps/api/src/main/java/com/dreamcore/workspace/agentadmin/` 下的新开通类（及该包内它专用的写入类）
  - `apps/api/src/test/java/com/dreamcore/workspace/CapabilityTenantGrantIntegrationTest.java`（新建）
  - `apps/api/src/main/resources/db/migration-common/V<≥193>__*.sql`（只增）
  - `contracts/public-api/capability-registry.openapi.json`（仅 POST 开通写的实现状态与字段）
- **不做什么**：见架构已裁第 7 条与后端前置第 2 条。不改 `AgentAdminSecurity` 的 `permitAll` 范围。

### 契约贴合点

| 项 | 约定 |
|---|---|
| POST | `/api/agent-admin/v1/tenants/{tenantId}/grants` · `createCapabilityTenantGrant` · 首次 201 · 完全相同的再提交 200 |
| 改指向 | 同企业同功能、另一 `capabilityId` → 409，不覆盖 |
| 会话 | `DREAMCORE_AGENT` + CSRF；未登录 401；无 CSRF 403 |
| 目录 | 必须先有 `qo_capability` 行，且 `enterprise_function` 与 body 一致 |
| 回读 | 测试直读 `qo_capability_tenant_grant`（可对照授权表）；不依赖未实现的 grants GET。CT-039 实现已合，生产 Empty adapter 仍空，本单不改读口 |
| 错误 | JSON 四字段；`message` 中文白话；无堆栈、无裸术语 |

## ② 前置条件与分支名

- **⓪ 暂停令自查**：有或拿不准 → 立刻停，问 DQ。
- **依赖**：CT-034-A 实现已在 main（`75ab17a`）。CT-039 **实现已合**（`701c3ca` / #31），生产 Empty adapter 仍空，不阻塞本单。测试可对照授权表。本单不再登记目录。
- 正确仓：`~/Desktop/mengine-app-luofanghao9784`（origin=`luofanghao9784/mengine-app`）。

```bash
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || { echo 'ERROR: 错误 remote，停'; exit 1; }
git status
git switch main && git pull
git merge-base --is-ancestor 75ab17a HEAD || { echo 'ERROR: main 不含 CT-034-A 实现，停'; exit 1; }
git merge-base --is-ancestor 701c3ca HEAD || { echo 'ERROR: main 不含 CT-039 实现，停'; exit 1; }
git merge-base --is-ancestor 1d847e6 HEAD || { echo 'ERROR: main 不含 CT-037，停'; exit 1; }
git merge-base --is-ancestor 7fa4946 HEAD || { echo 'ERROR: main 不含 #35 接真，停'; exit 1; }
test ! -e apps/api/src/main/java/com/dreamcore/workspace/agentadmin/CapabilityRegistryStubSecurity.java || { echo 'ERROR: StubSecurity 还在，停'; exit 1; }
test -f apps/api/src/main/resources/db/migration-common/V191__platform_capability_registry.sql || { echo 'ERROR: 找不到 V191，停'; exit 1; }
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export POSTGRES_BIN="$(brew --prefix postgresql@18)/bin"
git switch -c codex/ct-040-agent-admin-grant-tenant-opened
```

开跑前确认 GET 仍未实现（没有对应控制器即符合预期，不要补一个 grants GET）：

```bash
git grep -n "listCapabilityTenantGrants" -- apps/api/src/main '*.java' || echo 'OK: 无 grants GET 实现'
```

## ③ 完整 Codex 提示词

把下面整段交给 Codex（`$CODEX`，模型 `gpt-6.1-sol`，思考强度 **high**；本机模型若是 `gpt-5.1-codex` 亦可）：

```
你在梦擎仓库分支 codex/ct-040-agent-admin-grant-tenant-opened 上工作。基准 origin/main，须含 7fa4946（#35 接真）与 1d847e6（CT-037），从而含 701c3ca（CT-039 实现 #31）与 75ab17a（CT-034-A 实现 #30）。只做本单范围。执行单：docs/codex-tasks/CT-040-agent-admin-grant-tenant-opened.md。
CT-039 读口已合。生产 EmptyCapabilityCatalogAdapter 仍空。#35 接真已合 7fa4946（前端已消费读口，未改生产 adapter）。CT-037 已合 1d847e6。开通真源仍靠本单写口，合入后由读口接。测试可对照 qo_capability_tenant_grant。不要改那条读口。
对照：docs/codex-tasks/CT-034-A-register-persist-201.md、docs/codex-tasks/CT-039-tenant-opened-capabilities-readonly.md、docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md。
今日代码：POST /api/agent-admin/v1/capabilities 已落库 qo_capability（无 tenant_id，V191）。AgentAdminSecurity 匹配 /api/agent-admin/**。未登录 401「还没有登录，请先登录后再试」；有会话无 CSRF 403「登录校验未通过，请刷新页面后再试」。CapabilityRegistryStubSecurity 已不存在。
契约：contracts/public-api/capability-registry.openapi.json 里 POST /api/agent-admin/v1/tenants/{tenantId}/grants（createCapabilityTenantGrant）仍是骨架。GET listCapabilityTenantGrants 仍是骨架。今日 CapabilityTenantGrantCreate 要求 moduleVersionId 与 isDefault；仓内没有 qo_module_version，禁止编造这两个字段。
错误形状：contracts/public-api/error.schema.json。人话：docs/codex-tasks/QUEUE.md 编制·前端开发硬性第 6 条。message 禁止裸用 seed、capability、Capability、Grant、admission。code 可以保留英文。JSON 字段名按本单钉死值。
两周挂靠：docs/codex-tasks/两周日切片-三轨并行-20261031.md（W1 的开通写，不是 CT-036 页面，不是 CT-037 冒烟）。

【已裁】
1. 本单是开通写，不是登记目录。不要改 POST /api/agent-admin/v1/capabilities 的状态码和文案。不要给 qo_capability 加 tenant_id。不要改 V191。
2. 写口只 POST /api/agent-admin/v1/tenants/{tenantId}/grants。Cookie 是 DREAMCORE_AGENT，安全链用已有的 AgentAdminSecurity。未登录 401，有会话无或错 X-CSRF-TOKEN 403。先会话，再 CSRF，再 body。禁止 permitAll，禁止 platform-admin 写入口，禁止企业端或工作台自开通。
3. GET listCapabilityTenantGrants 保持未实现。不要改已合的 CT-039 读口 GET /api/tenant-admin/v1/opened-capabilities（生产 Empty adapter 仍空）。
4. 新表 qo_capability_tenant_grant 必须有 tenant_id。迁移只新增。版本 = max(三处目录当前最大号 + 1, 193)。db/migration、db/migration-local、db/migration-common 都要看。禁止改已有迁移。禁止使用 V191 和 V192；V192 不存在也不要占，留给 CT-039，本单从 V193 起。
5. 重复开通钉死为 200 且不覆盖。首次 201。同一租户、同一 enterpriseFunction、同一 capabilityId 再 POST → 200，不 UPDATE，granted_at 不变。同一租户同一 enterpriseFunction 但 capabilityId 不同 → 409，message「已经开通过了，不能改成另一项」，不覆盖。
6. 没有行不得 201。401/403/400/404/409 不得插入或修改。message 人话。不要改 AgentAdminErrors 或 IdentityErrors 的全局文案。
7. 非范围：开通页 UI、批量开通、CT-036 前端、CT-037、模块版本、isDefault、准入、grants GET、企业读口实现。

【请求与表 · 原样】
请求体 additionalProperties false，必填且仅有 capabilityId、enterpriseFunction。示例 {"capabilityId":"quality-check","enterpriseFunction":"quality-check"}。
闭集：document-parse、table-compare、quality-check、semantic-annotation、repair-suggestion。闭集外或空白 → 400「请按要求填写开通内容」。
body 里出现 moduleVersionId、isDefault、tenantId、grantedBy、grantedAt 或其他字段 → 400「有无法识别的字段，请检查后再提交」。
路径 tenantId 不是 UUID → 400「请按要求填写开通内容」。
UUID 不在 tenants → 404「没有这个企业，不能开通」。不要 INSERT tenants。
capabilityId 不在 qo_capability → 404「还没有这项登记，请先登记再开通」。不要顺手登记。
目录行 enterprise_function 为空，或与 body 不一致 → 400「请按要求填写开通内容」。
表列只有 tenant_id、enterprise_function、capability_id、granted_at。主键 (tenant_id, enterprise_function)。tenant_id 引用 tenants(id)，capability_id 引用 qo_capability(capability_id)。enterprise_function 用与目录相同的五值 CHECK。
插入用 INSERT ... ON CONFLICT DO NOTHING，然后读回。禁止 ON CONFLICT DO UPDATE。
201 和 200 的 JSON 只有 tenantId、capabilityId、enterpriseFunction、grantedAt。grantedAt 取自该行。Cache-Control: no-store。不要返回 moduleVersionId 或 isDefault。

【要做成】
1. 先看三处迁移目录的最大号。新文件放 db/migration-common，版本 = max(最大号+1, 193)。不要用 V192。文件名含 qo_capability_tenant_grant 的用途说明即可。不要 ALTER qo_capability。
2. 在 com.dreamcore.workspace.agentadmin 新增开通控制器与最小写入类。不要改 CapabilityRegistryController 的登记逻辑。不要改 AgentAdminSecurity 的 permitAll。
3. 校验失败不得先插入再靠回滚冒充业务错误。
4. 回读：CapabilityTenantGrantIntegrationTest 用 JdbcTemplate 查 qo_capability_tenant_grant（可对照授权表）。默认不要新 GET。不要调用未实现的 listCapabilityTenantGrants，不要改已合的 CT-039 读口。
5. 测试须覆盖：
   - 无 cookie POST（含非法 JSON）→ 401「还没有登录，请先登录后再试」，授权行数不变。
   - 有会话、不带或错 CSRF → 403「登录校验未通过，请刷新页面后再试」，不插行。先会话后 CSRF：无会话不得变成 403。
   - 先有目录行 capability_id=quality-check、enterprise_function=quality-check，再对真实 tenants.id 开通 → 201；该行 tenant_id、capability_id、enterprise_function 正确；表上有 tenant_id 列。目录行数不因开通而增加，目录的 enterprise_function 不被改写。
   - 同一请求再 POST → 200；仍一行；granted_at 与第一次相同。
   - 另一条目录（另一 capabilityId、同一 enterprise_function）对同一租户再开通 → 409「已经开通过了，不能改成另一项」；原 capability_id 与 granted_at 不变。
   - 企业 A 开通后，企业 B 的行数为 0。再开通 B 不改变 A 的 granted_at。响应体不含另一个企业的 id。
   - DREAMCORE_SESSION 与 DREAMCORE_PLATFORM 拿着第四端 token 调本 POST → 401，不插行。
   - 未知字段、未登记、企业不存在、目录功能为空或不一致：对应 400/404，不插行。
   - 映射里没有 listCapabilityTenantGrants。已登录 GET 该 grants 路径不得 200 返回列表（404 或 405 可以）。未登录 GET 仍是 401。
   - 没有 /api/platform-admin 开通写映射。
6. OpenAPI：POST 改为上述请求体与 201/200。info.description 增加一句：CT-040 开通写已落库；GET list 与模块、准入仍是骨架未实现；本 POST 不是模块版本授权。不要把 listCapabilityTenantGrants 写成已实现。不要改登记 POST 的路径和 required。

【不许碰】
src/** 前端、engine/**、workers/parser、AgentAdminSecurity 的 permitAll、客户 IdentitySecurity、已有 Flyway（含 V190、V191）、V192 号、登录端点、CT-036 页面、CT-039 读口实现、grants GET、模块版本、准入、force push、reset --hard、直推 main、gh issue、口令入库。
禁止恢复 CapabilityRegistryStubSecurity。
禁止给 qo_capability 加 tenant_id。
禁止改 Java 包名 dreamcore、/mengine-api、MENGINE_*。

【验收】
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export POSTGRES_BIN="$(brew --prefix postgresql@18)/bin"
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml test -Dtest=CapabilityTenantGrantIntegrationTest,CapabilityRegistryIntegrationTest
禁止 -DskipTests。

无 cookie 必须是 401，不是 201（把 TENANT 换成测试库里真实存在的 uuid）：
curl -si -X POST "http://127.0.0.1:50831/api/agent-admin/v1/tenants/TENANT/grants" \
  -H "Content-Type: application/json" \
  -d '{"capabilityId":"quality-check","enterpriseFunction":"quality-check"}'

已登录且 CSRF 正确时期望首次 201，测试库 qo_capability_tenant_grant 有该 tenant_id 行。不要用 GET /api/agent-admin/v1/tenants/TENANT/grants 当验收。

【做完输出】git diff --stat、迁移文件名（必须 V193 或更大，且不是 V191/V192）、201 是否能在表里读回、重复是否 200 且 granted_at 未变、409 是否不改指向、确认表有 tenant_id、确认没有新的 grants GET、没有改已合的 CT-039 读口、没有恢复 permitAll、没有改登记 POST。
```

## ④ 推荐模型与思考强度

- 模型：`gpt-6.1-sol`（仓内惯用，与 CT-034-A / CT-035 相同；本机若是 `gpt-5.1-codex` 亦可）
- 思考强度：**high**（把开通写成带租户的目录、用假 moduleVersionId 填骨架、重复开通覆盖 `granted_at`、或让企业会话自开通，都会把 W1 做成错库或假成功）
- **预计耗时**：Codex 40–80 分钟；测试 15–30 分钟

## ⑤ 可复制 git 步骤（跑完如何提交）

```bash
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || exit 1
git add apps/api/src/main/java/com/dreamcore/workspace/agentadmin \
  apps/api/src/test/java/com/dreamcore/workspace/CapabilityTenantGrantIntegrationTest.java \
  apps/api/src/main/resources/db/migration-common \
  contracts/public-api/capability-registry.openapi.json
git diff --cached --stat | grep -E 'V190__|V191__|src/features/|workers/parser|IdentitySecurity|OpenedFunctions|QualityCheck' && echo 'ERROR: 旧迁移/前端/客户链/空态壳非本单' && exit 1
git commit -m "$(cat <<'EOM'
feat(api): CT-040 开通给企业

已登录且 CSRF 有效时，把已登记的企业功能写入带 tenant_id 的授权表。
首次 201；重复开通 200 且不覆盖。未登录仍 401。
EOM
)"
git push -u origin codex/ct-040-agent-admin-grant-tenant-opened
gh pr create -R luofanghao9784/mengine-app --base main --head codex/ct-040-agent-admin-grant-tenant-opened \
  --title "feat(api): CT-040 开通给企业" \
  --body "## 摘要
POST /api/agent-admin/v1/tenants/{tenantId}/grants 把已登记的企业功能授权给路径上的企业。表 qo_capability_tenant_grant 带 tenant_id。首次 201。重复开通 200，不更新 granted_at。未登录 401。无 CSRF 403。

## 幂等
重复开通 = 200 幂等，不覆盖 granted_at / capability_id。同企业同功能改成另一个 capabilityId = 409，不覆盖。

## 验收句
W1 的开通写。不是登记目录（CT-034-A），不是企业读口（CT-039），不是 CT-036 页面，不是 CT-037 冒烟。GET list/grants 仍未实现。

## 审查
- 架构逻辑 + 安全审查 + 质量性能
- 不得恢复 permitAll；不得新增 platform-admin 或企业自开通写入口
- 迁移 ≥ V193，不改 V191，不占 V192
- 勿自动合并"
```

网页备用：https://github.com/luofanghao9784/mengine-app/compare/main...codex/ct-040-agent-admin-grant-tenant-opened

## ⑥ 验收标准

| # | 标准 | 如何验 |
|---|---|---|
| G1 | 首次开通 | 已登录 + CSRF + 已有 `quality-check` 目录行 + 真实企业 UUID → **201**；`qo_capability_tenant_grant` 能读到该 `tenant_id` 与 `enterprise_function=quality-check` |
| G2 | 无假成功 | 201 的同一测试连接里行存在。没有插入时不得 201。目录行数不增加 |
| G3 | 未登录 | 无 cookie POST → **401**「还没有登录，请先登录后再试」；授权行数不变 |
| G4 | CSRF | 有会话、不带或错 `X-CSRF-TOKEN` → **403**；不插行。无会话不是 403 |
| G5 | 重复开通 | 相同 tenant + 功能 + capabilityId 再 POST → **200**；仍一行；`granted_at` 不变 |
| G6 | 不改指向 | 同企业同功能、另一 capabilityId → **409**「已经开通过了，不能改成另一项」；旧行不变 |
| G7 | 跨企业 | 只开通 A 时，B 的行数为 0。开通 B 不改变 A 的 `granted_at`。响应不含另一企业的 id |
| G8 | 不能自开通 | `DREAMCORE_SESSION` / `DREAMCORE_PLATFORM` → **401**，不插行。无 platform-admin、tenant-admin、工作台写入口 |
| G9 | 目录门 | 未登记 → 404「还没有这项登记，请先登记再开通」。企业 UUID 不存在 → 404「没有这个企业，不能开通」。功能与目录不一致 → 400，不插行 |
| G10 | 无假 list | 未实现 `listCapabilityTenantGrants` 与 CT-039。验收不依赖这两条 GET |
| G11 | 门禁还在 | 源码没有开通 POST 的 `permitAll`；`CapabilityRegistryStubSecurity` 不存在；登记 POST 行为不变（`CapabilityRegistryIntegrationTest` 仍绿） |
| G12 | 迁移 | 新文件在 `migration-common`，版本 ≥ V193，且大于开跑时三处最大号；V190、V191 无 diff；未占用 V192 |
| G13 | 表形 | 有 `tenant_id`。没有 `module_version_id`、`is_default`。成功 JSON 不编造这两项 |
| G14 | 边界 | 无前端 diff；`message` 无裸术语；未知字段 400 且不写行 |

## ⑦ 禁止操作 / 失败卡住

| 症状 | 动作 |
|---|---|
| remote 不是 mengine-app | 立刻停 |
| 有暂停令 | 不开 Codex；问 DQ |
| main 不含 `75ab17a` | 停；先拉含 CT-034-A 实现的 main |
| 新迁移 ≤ V192，或改了 V191 | 停；改为当前最大号 + 1 且 ≥ V193 |
| 无会话变成 201 或 403 | 未完成；401 必须仍先返回 |
| 201 但表里没有行，或表没有 `tenant_id` | **打回** |
| 重复开通更新了 `granted_at` 或换成了另一个 capabilityId | **打回**；相同再提交必须 200 且不 UPDATE |
| 用假 `moduleVersionId` / `isDefault` 填成功体 | **打回** |
| 实现了 grants GET、CT-039，或企业端能调这个 POST | **打回** |
| 出现 `permitAll` 或 StubSecurity | **打回** |
| 改了登记 POST 或给 `qo_capability` 加了 `tenant_id` | **打回** |
| 测试红 | 修到绿；禁止 `-DskipTests` |
| CONFLICT / push rejected | rebase 一次；仍失败停 |

**硬禁止**：

- 恢复 `permitAll`，或新建一条不校验 CSRF 的开通 POST
- 无落库返回 201；重复开通时 UPDATE 审计列
- 把本单做成登记目录，或给 `qo_capability` 加 `tenant_id`
- 实现或冒充 grants GET、企业读口（CT-039）、platform-admin 写入口、企业自开通
- 编造 `moduleVersionId` 或 `isDefault`
- 占用或修改 V190、V191，或占用 V192
- `git push --force`、`git reset --hard`、直推 `main`
- 改前端、改包名、改 `/mengine-api`、改 `MENGINE_*`
- `gh issue`；口令进仓库
- 有暂停令仍开 Codex

回滚（未合入）：`git switch main && git branch -D codex/ct-040-agent-admin-grant-tenant-opened`。

---

**DQ 审路径**：本文件「架构已裁」+ 请求/表/响应原文 + ADR-B8 D8-1 的授权写入口（不要做到模块版本与企业读口）。通过后交老板/后端岗 Mac 粘贴③开跑。安全审查必看：不得恢复开放链、不得让企业会话自开通、重复开通不得覆盖 `granted_at`。总负责人不代跑。
