# CT-041 企业读口改读租户授权表

> **现状**：#41 已合 348cafc，生产 CapabilityCatalogPort=GrantCatalogAdapter，Empty 已删。下文若仍写 Empty 恒空或「尚未合入」，以本句为准。

状态：架构已裁可跑 · 待 docs 入库后交老板 Mac Codex　｜　分支：`codex/ct-041-catalog-read-from-tenant-grants`　｜　**审查人（实现 PR 后）：架构逻辑 + 安全审查 + 质量性能**　｜　基准：本执行单 docs 对照 `727063f` / [#33](https://github.com/luofanghao9784/mengine-app/pull/33)（CT-040 执行单）。**实现分支**必须含 CT-040 实现 tip。撰写时该 tip **尚未合入**，见脚注【待合-CT-040-实现】。合入后把脚注与②里的 SHA 改成已合值再派。其前已在 main 的还有：#35 接真 `7fa4946`、CT-037 `1d847e6` / #32、CT-039 实现 `701c3ca` / [#31](https://github.com/luofanghao9784/mengine-app/pull/31)、CT-034-A 实现 `75ab17a` / [#30](https://github.com/luofanghao9784/mengine-app/pull/30)。

> **日切片：D6 读侧真源 / 可演示点**：企业会话 `GET /api/tenant-admin/v1/opened-capabilities`。该企业在 `qo_capability_tenant_grant` 有 `quality-check` 行时，**200**，`items` 含 `enterpriseFunction=quality-check` 且 `displayName=质量检查`。没有授权行时仍 **200**，`items` 为 `[]`（`qo_capability` 里已有登记也不算开通）。path 与字段保持 CT-039。  
> **挂靠**：两周日切片·轨 A · M3「tenant 见已开通」的真名单。开通写仍是 [CT-040](CT-040-agent-admin-grant-tenant-opened.md)。消费页仍是 [CT-036](CT-036-enterprise-consume-opened-capability.md)。现网冒烟仍是 [CT-037](CT-037-prod-mount-desktop-mobile-smoke.md)。`docs/codex-tasks/两周日切片-三轨并行-20261031.md`。  
> **总负责人不代跑**；老板 / 后端岗在 Mac 自跑 Codex。模型 `gpt-6.1-sol`，思考强度 **high**。  
> **仓**：`luofanghao9784/mengine-app`。

规格依据：

- 企业读口已合：[`CT-039-tenant-opened-capabilities-readonly.md`](CT-039-tenant-opened-capabilities-readonly.md)（实现 `701c3ca` / #31）。path `GET /api/tenant-admin/v1/opened-capabilities`，operationId `listOpenedCapabilities`。契约 `contracts/public-api/opened-capabilities.openapi.json`。控制器 `com.dreamcore.workspace.qualityops.OpenedCapabilitiesController`。端口 `com.dreamcore.workspace.capability.registry.CapabilityCatalogPort#listOpenedCapabilities(UUID)`。#41 已合 348cafc，生产 CapabilityCatalogPort=GrantCatalogAdapter，Empty 已删
- 开通写执行单已合：[`CT-040-agent-admin-grant-tenant-opened.md`](CT-040-agent-admin-grant-tenant-opened.md)（`727063f` / #33）。表 `qo_capability_tenant_grant` 与 `POST /api/agent-admin/v1/tenants/{tenantId}/grants` 归那张实现单，迁移 **V193+**。本单不建表、不改写口
- 前端已接该读口：#35 / `7fa4946`。本单不改 `src/**`
- ADR-B8 **R-B8-2**：`docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md`。`qualityops` 只经 `CapabilityCatalogPort`，不依赖 `agentregistry` / `agentadmin`，不 SQL 授权表
- 人话闭集与 CT-039 相同五值。规范：[《全端文案规范》](https://www.notion.so/40966c386fbf8120aaefc0290f9dedb8)、[去黑话对照](https://app.notion.com/p/40966c386fbf81f3a2e3e1822ae6a9b9)。错误 `message` 沿用现读口，不新造术语

> **脚注（【待合-CT-040-实现】）**：CT-040 **执行单已合** main `727063f` / #33。开通写实现（表 `qo_capability_tenant_grant` + POST 开通）**尚未合入**。本执行单 docs 可先合。实现分支的基准必须是含该实现的 tip。合入后把本句改成「CT-040 实现已合 `<SHA>`」，并在②取消注释、写入同一个 SHA。在此之前 Codex **停**。禁止本单建授权表，禁止占任何新迁移号，禁止改 V191 / V192。  
> **脚注（读口现状）**：CT-039 实现已合 `701c3ca` / #31。生产 `EmptyCapabilityCatalogAdapter` 恒返回空列表，不把 `qo_capability` 登记行当成开通。`OpenedCapabilitiesIntegrationTest` 今日用 `@Primary SeedCatalog` 内存投影冒充「已开通」，并另断言生产 adapter 永远为空。本单删掉这层投影，生产默认改读授权表。**#35 接真已合** `7fa4946`，前端不用再改。

### 架构已裁（2026-10-30）

1. **本单不是新读口。** path、operationId、OpenAPI 字段保持 CT-039：`GET /api/tenant-admin/v1/opened-capabilities` · `listOpenedCapabilities` · `OpenedCapabilityList` / `OpenedCapability`。元素只有 `enterpriseFunction` 与 `displayName`，`additionalProperties: false`。禁止改契约形状：不增删字段、不改 required、不改五值 enum、不加 parameters、不加 requestBody。禁止响应里出现 `tenantId`、`grantedAt`、`moduleVersionId`、`isDefault`，schema 名不要用 Grant，JSON 文案不要出现 `Grant`。`info.description` 里「生产数据源未接入时返回空列表」这一句改为「按本企业授权行返回名单，没有授权行时 items 为空」。其余描述、【待补-会话】、错误 `$ref` 不动。不要改 `contracts/public-api/capability-registry.openapi.json`。
2. **经 CapabilityCatalogPort。** `qualityops` 继续只调用已有的 `listOpenedCapabilities(UUID)`。tenant 仍由控制器从企业会话解析后传入。adapter 读 `qo_capability_tenant_grant`。`qualityops` 仍不得 SQL，不得 import `agentregistry` / `agentadmin`（R-B8-2），源码里也不要出现表名 `qo_capability_tenant_grant`。生产实现替换为 `com.dreamcore.workspace.capability.adapter.GrantCatalogAdapter`（类名钉死）。删掉 `EmptyCapabilityCatalogAdapter`，容器里不要留下第二个 `CapabilityCatalogPort` Bean，也不要用 `@Primary` 让空实现或测试种子继续当生产。端口方法签名与 `EnterpriseFunction` 五值人话保持不变。
3. **依赖 CT-040 实现已合。** 表与 POST 开通写都在那张实现里，迁移 V193+。本执行单 docs 可先合。实现开跑时 main 必须含该 tip；脚注仍是【待合-CT-040-实现】就停。禁止本单 `CREATE TABLE`、禁止新增 Flyway、禁止改 V191、禁止改或新建 V192、禁止改 CT-040 将占用的 V193+ 文件。
4. **登记行不是开通。** 只读授权表的 `enterprise_function`。某企业只有 `qo_capability` 行、没有对应 grant 行 → 200 且 `items` 为 `[]`。不要 JOIN 登记表来决定「算不算开通」：登记行不能单独出现在名单里，已有授权行也不要因为目录文本被滤掉。禁止企业会话自开通：不得新增会插入授权表的 `/api/v1/**` 或 `/api/tenant-admin/**` 路由。禁止实现 `listCapabilityTenantGrants`，禁止任何 `/api/agent-admin/**` 的 grants GET。
5. **跨租户。** SQL 必须是 `WHERE tenant_id = ?`，问号只绑定会话已经解析出的那一个企业。禁止先 `SELECT` 全表再在内存里滤。企业 A 的响应不得含企业 B 的功能、名称、材料或 id。B 的响应同样不得含 A。
6. **displayName** 仍是服务端闭集人话，与 CT-039 相同五值，走 `EnterpriseFunction` 枚举：`document-parse`→文档解析，`table-compare`→表格对比，`quality-check`→质量检查，`semantic-annotation`→语义标注，`repair-suggestion`→修复建议。对不上这五值的行跳过，不进 `items`，不 500，不把库里的原文当成 `displayName`，也不把英文 key 当成 `displayName`。演示与主验收只用 `quality-check` / 「质量检查」。
7. **非范围**：前端 #35 已接真，不改 `src/**`。CT-036 材料提交与空态壳文案。CT-040 写口、它的控制器、它的迁移、它的 OpenAPI。开通页 UI。批量开通。grants GET。登记 POST。模块版本、`isDefault`、准入。登录签发与 `IdentitySecurity` 的全局 401 文案。

#### 读哪一行、返回什么（钉死）

授权表列以 CT-040 为准：`tenant_id`、`enterprise_function`、`capability_id`、`granted_at`。主键 `(tenant_id, enterprise_function)`。本单只读前两列里的租户与功能。`capability_id`、`granted_at` 不出现在企业响应里。

```sql
SELECT enterprise_function
FROM qo_capability_tenant_grant
WHERE tenant_id = ?
```

参数化查询（`JdbcTemplate` 即可）。adapter 内不要拼接 SQL，不要 `INSERT` / `UPDATE` / `DELETE`。查出的 code 只经 `EnterpriseFunction` 换成枚举；控制器已有的 `code()` + `displayName()` 映射保持。无行 → 空列表，HTTP 仍是现控制器的 **200**。

成功体形状与今日契约相同，例如：

```json
{"items":[{"enterpriseFunction":"quality-check","displayName":"质量检查"}]}
```

未开通：

```json
{"items":[]}
```

租户、400、404、401 的人话与状态码保持现控制器：query / 多余 path / body → 400「有无法识别的字段，请检查后再提交」；定不出唯一 ACTIVE 企业 → 404「暂时不能查看已开通功能」；未登录 → 401「请求未获授权。」。不要改这些句子。`Cache-Control: no-store` 保持。

## ① 目标与范围

- **目标**：CT-040 把某企业的某项功能写入 `qo_capability_tenant_grant` 之后，该企业的企业会话能在已有读口上看见人话名。没写过授权行的企业仍得到空列表。别的企业的行不出现。
- **增量边界**：
  1. 用 `GrantCatalogAdapter` 替换 `EmptyCapabilityCatalogAdapter`，作为唯一的生产 `CapabilityCatalogPort`。
  2. `OpenedCapabilitiesIntegrationTest` 改成打这条真读：无 grant 行 → 空；同库插入或经开通 POST 写入之后 → 含「质量检查」；跨租户；`qualityops` 无禁包 import；未登录 401。删掉 `@Primary SeedCatalog`，禁止再用内存投影冒充 200 名单。
  3. OpenAPI 只改 `info.description` 那一句「未接入」。path、operationId、schema 不动。
  4. 控制器与端口签名尽量不动。400 / 404 仍在调用端口之前返回。
- **改哪些文件（允许）**：
  - `apps/api/src/main/java/com/dreamcore/workspace/capability/adapter/GrantCatalogAdapter.java`（新建）
  - 删除 `apps/api/src/main/java/com/dreamcore/workspace/capability/adapter/EmptyCapabilityCatalogAdapter.java`
  - `apps/api/src/test/java/com/dreamcore/workspace/OpenedCapabilitiesIntegrationTest.java`（扩写，不另起一套读口测试来代替它）
  - `contracts/public-api/opened-capabilities.openapi.json`（仅 description 那一句）
  - 枚举上若要加「按 code 查找」，只加在 `CapabilityCatalogPort.EnterpriseFunction`，不新造返回类型
- **不做什么**：见架构已裁第 7 条。不改 `OpenedCapabilitiesController` 的 path、状态码和人话。不改 `AgentAdminSecurity`。不改登记 POST。

## ② 前置条件与分支名

- **⓪ 暂停令自查（第一步）**：有或拿不准 → 立刻停，问 DQ。
- **⓪b 实现 tip**：脚注仍是【待合-CT-040-实现】，或下面 SHA 仍是占位 → **停**。不要建表，不要改 adapter。合入后由架构改 SHA，再把本段交给 Codex。
- **依赖**：CT-039 读口已合（`701c3ca`）。#35 已接前端（`7fa4946`）。CT-040 执行单已合（`727063f`）。CT-040 **实现**必须已在所切的 main 上（表 + POST）。本单不实现写口。
- 正确仓：`~/Desktop/mengine-app-luofanghao9784`（origin=`luofanghao9784/mengine-app`）。

```bash
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || { echo 'ERROR: 错误 remote，停'; exit 1; }
git status
git switch main && git pull
git merge-base --is-ancestor 727063f HEAD || { echo 'ERROR: main 不含 CT-040 执行单，停'; exit 1; }
git merge-base --is-ancestor 701c3ca HEAD || { echo 'ERROR: main 不含 CT-039 实现，停'; exit 1; }
git merge-base --is-ancestor 7fa4946 HEAD || { echo 'ERROR: main 不含 #35 接真，停'; exit 1; }
# 【待合-CT-040-实现】合入后删掉行首 #，把 REPLACE_WITH_CT040_IMPL_SHA 换成已合 tip。占位未改就停。
# git merge-base --is-ancestor REPLACE_WITH_CT040_IMPL_SHA HEAD || { echo 'ERROR: main 不含 CT-040 实现，停'; exit 1; }
git grep -l qo_capability_tenant_grant -- 'apps/api/src/main/resources/db/migration-common/*.sql' || { echo 'ERROR: 【待合-CT-040-实现】授权表不在本分支，停。禁止本单建表。'; exit 1; }
git grep -n "createCapabilityTenantGrant" -- apps/api/src/main '*.java' || { echo 'ERROR: 【待合-CT-040-实现】开通 POST 不在本分支，停。'; exit 1; }
git grep -n "listCapabilityTenantGrants" -- apps/api/src/main '*.java' || echo 'OK: 无 grants GET 实现'
# 若上面有命中：只允许注释写明未实现。出现映射或控制器就停，问 DQ。不要补一个 grants GET。
test -f apps/api/src/main/java/com/dreamcore/workspace/capability/adapter/EmptyCapabilityCatalogAdapter.java || { echo 'ERROR: 找不到 Empty adapter，停，问 DQ'; exit 1; }
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export POSTGRES_BIN="$(brew --prefix postgresql@18)/bin"
git switch -c codex/ct-041-catalog-read-from-tenant-grants
```

## ③ 完整 Codex 提示词

把下面整段交给 Codex（`$CODEX`，模型 `gpt-6.1-sol`，思考强度 **high**）。

```
你在梦擎仓库分支 codex/ct-041-catalog-read-from-tenant-grants 上工作。只做本单范围。执行单：docs/codex-tasks/CT-041-catalog-read-from-tenant-grants.md。
对照：docs/codex-tasks/CT-039-tenant-opened-capabilities-readonly.md、docs/codex-tasks/CT-040-agent-admin-grant-tenant-opened.md、docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md（R-B8-2）。
今日代码：GET /api/tenant-admin/v1/opened-capabilities 已由 OpenedCapabilitiesController 实现。租户来自 IdentityService.me 的唯一 ACTIVE 成员。端口是 CapabilityCatalogPort.listOpenedCapabilities(UUID)。生产类 EmptyCapabilityCatalogAdapter 恒返回空列表。OpenedCapabilitiesIntegrationTest 用 @Primary SeedCatalog 内存投影冒充已开通。契约在 contracts/public-api/opened-capabilities.openapi.json。enterpriseFunction 与 displayName 的五值人话在 EnterpriseFunction 枚举里。
CT-040 开通写应已在本分支：表 qo_capability_tenant_grant（tenant_id、enterprise_function、capability_id、granted_at），POST /api/agent-admin/v1/tenants/{tenantId}/grants。本单不改那个 POST，不改它的迁移。

【开跑门】
执行单脚注若仍写【待合-CT-040-实现】，或②里的实现 SHA 仍是 REPLACE_WITH_CT040_IMPL_SHA，立刻停，不要改业务代码。授权表或开通 POST 不在本分支，同样停。禁止自己 CREATE TABLE，禁止新 Flyway 文件。

【已裁】
1. 这不是新读口。保持 GET /api/tenant-admin/v1/opened-capabilities、operationId listOpenedCapabilities、schema OpenedCapabilityList / OpenedCapability。字段只有 enterpriseFunction 与 displayName。不要返回 tenantId、grantedAt、moduleVersionId、isDefault，不要出现 Grant。不要改 path、required、enum、parameters、requestBody。info.description 里「生产数据源未接入时返回空列表」改成「按本企业授权行返回名单，没有授权行时 items 为空」。不要改 capability-registry.openapi.json。
2. 经 CapabilityCatalogPort。新建 com.dreamcore.workspace.capability.adapter.GrantCatalogAdapter，作为唯一生产实现。删除 EmptyCapabilityCatalogAdapter。不要第二个 CapabilityCatalogPort Bean，不要 @Primary 空实现。端口方法签名不要改。qualityops 不得 import agentregistry 或 agentadmin，不得出现 qo_capability_tenant_grant，不得 SQL。
3. 不要建表，不要改 V191，不要新增或修改 V192，不要改 CT-040 的 V193+ 迁移。不要改开通 POST 控制器。
4. 不要实现 listCapabilityTenantGrants，不要加任何 /api/agent-admin/** 的 grants GET。不要新增会插入授权表的企业端或工作台路由。qo_capability 登记行不是开通：没有 grant 行必须 200 且 items 为空。
5. 只读会话解析出的那一个 tenant_id。SQL 必须 WHERE tenant_id = ?，禁止先查全表再过滤。A 的响应不得含 B，B 的响应不得含 A。
6. displayName 只用 EnterpriseFunction 已有的五句人话。对不上闭集的 code 跳过，不 500，不把库文本或英文 key 写进 displayName。
7. 非范围：src/** 前端、CT-036 材料提交、开通页、批量、CT-040 写口本身、grants GET、登记 POST、IdentitySecurity 全局 401 文案。

【读法 · 原样】
SELECT enterprise_function FROM qo_capability_tenant_grant WHERE tenant_id = ?
用 JdbcTemplate 占位参数。adapter 源码不得含 INSERT、UPDATE、DELETE。不要 JOIN qo_capability 来决定是否开通。capability_id 与 granted_at 不要放进企业 JSON。
无行 → 空列表，控制器仍返回 200。有 quality-check 行 → items 含 enterpriseFunction=quality-check、displayName=质量检查。
400「有无法识别的字段，请检查后再提交」、404「暂时不能查看已开通功能」、401「请求未获授权。」保持现文案。400 与 404 仍在调用端口之前返回。Cache-Control: no-store 保持。

【测试 · 必须改 OpenedCapabilitiesIntegrationTest】
删掉 @Primary SeedCatalog 以及「生产 adapter 永远为空」那条断言。有名单和无名单都要打到 GrantCatalogAdapter，可以用 HTTP，也可以再直接调端口，但 HTTP 是验收。禁止再用内存 Map 冒充 200 名单。
覆盖：
- 无 cookie GET → 401，message「请求未获授权。」，body 无 items、无他企、无 Grant。
- 该企业没有任何 grant 行，即使 qo_capability 已有 capability_id=quality-check、enterprise_function=quality-check → 200，items 为 []。
- 同一测试库插入一行 qo_capability_tenant_grant（tenant_id=本企业，enterprise_function=quality-check，capability_id 指向已有登记行）后再 GET → 200，items 为 [{"enterpriseFunction":"quality-check","displayName":"质量检查"}]。插入前的 GET 必须是空列表。
- 若本分支已有开通 POST：另用真实 DREAMCORE_AGENT + CSRF（对齐 CapabilityTenantGrantIntegrationTest，不要手插第四端会话冒充）对另一企业或同一企业做一次合法开通，再用该企业的 DREAMCORE_SESSION GET，结果含「质量检查」。企业会话自己去 POST 必须不是 201，且不得因此多出授权行。不要把两条 cookie 混在同一次请求里。
- 企业 A 有 quality-check 授权行，企业 B 有 table-compare 授权行。A 的企业会话响应只有质量检查，body 不含 table-compare、表格对比、B 的名称和 B 的 id。B 的企业会话响应不含 quality-check 与质量检查。query 或 body 自报对方 tenantId → 400，且不返回对方名单。
- qualityops 源码无 import com.dreamcore.workspace.agentregistry 与 import com.dreamcore.workspace.agentadmin。这条断言留在默认会跑的本测试类里。
- 契约断言保持：operationId=listOpenedCapabilities，无 parameters，无 requestBody，OpenedCapability additionalProperties false，properties 仍是 2 个，enterpriseFunction enum 仍是 5 个。
- 上下文里的 CapabilityCatalogPort 实现类是 GrantCatalogAdapter，不是 EmptyCapabilityCatalogAdapter，也不是测试种子。

【不许碰】
src/**、engine/**、workers/parser、OpenedCapabilitiesController 的 path 与人话、AgentAdminSecurity、客户 IdentitySecurity、CapabilityTenantGrant 写类、已有 Flyway（含 V190、V191、V192、CT-040 的 V193+）、capability-registry.openapi.json、grants GET、登录端点、force push、reset --hard、直推 main、gh issue、口令入库。
禁止改包名 dreamcore、/mengine-api、MENGINE_*。
禁止 -DskipTests。

【验收命令】
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export POSTGRES_BIN="$(brew --prefix postgresql@18)/bin"
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml test -Dtest=OpenedCapabilitiesIntegrationTest
若 diff 碰到 CT-040 的开通写类，把 CapabilityTenantGrantIntegrationTest 一并跑绿。没有碰到就不要为了看热闹加跑。

【做完输出】
git diff --stat；确认没有 db/migration 文件；path / operationId / 字段是否与 CT-039 一致；生产 Bean 是否已是 GrantCatalogAdapter；无 grant 与有 grant 的状态码和 body；跨租户；qualityops 是否 import 禁包（必须否）；未登录是否仍 401；是否新建了 grants GET（必须否）；是否新建了迁移（必须否）。
```

## ④ 推荐模型与思考强度

- 模型：`gpt-6.1-sol`（本机若是 `gpt-5.1-codex` 亦可）
- 思考强度：**high**（把登记行当成开通、查出全表、或新开一条 grants GET，都会把企业读口接到错的真源上）
- **预计耗时**：Codex 30–70 分钟；一次性 Postgres 跑本单测试 15–30 分钟

## ⑤ 可复制 git 步骤（跑完如何提交）

```bash
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || exit 1
git add apps/api/src/main/java/com/dreamcore/workspace/capability/adapter \
  apps/api/src/main/java/com/dreamcore/workspace/capability/registry/CapabilityCatalogPort.java \
  apps/api/src/test/java/com/dreamcore/workspace/OpenedCapabilitiesIntegrationTest.java \
  contracts/public-api/opened-capabilities.openapi.json
git diff --cached --name-only | grep -E 'db/migration|src/admin/|src/identity/|agentadmin/|capability-registry.openapi' && echo 'ERROR: 迁移/前端/开通写/登记契约非本单' && exit 1
git commit -m "$(cat <<'EOM'
feat(api): CT-041 已开通改读授权表

生产目录端口改为读取 qo_capability_tenant_grant。
无授权行仍返回空列表。读口路径与字段不变。
EOM
)"
git push -u origin codex/ct-041-catalog-read-from-tenant-grants
gh pr create -R luofanghao9784/mengine-app --base main --head codex/ct-041-catalog-read-from-tenant-grants \
  --title "feat(api): CT-041 已开通改读授权表" \
  --body "## 摘要
GET /api/tenant-admin/v1/opened-capabilities 的生产实现从 EmptyCapabilityCatalogAdapter 改为读取 qo_capability_tenant_grant。无授权行仍是 200 空列表。path、operationId、字段不变。

## 真源
名单只来自本企业的授权行。qo_capability 登记行不算开通。不新开读口，不实现 grants GET。

## 依赖
基准含 CT-040 实现 tip。本 PR 不建授权表，不改 V191/V192，不改开通 POST。

## 审查
- 架构逻辑 + 安全审查 + 质量性能
- qualityops 不得 SQL、不得 import agentregistry/agentadmin
- 勿自动合并"
```

网页备用：https://github.com/luofanghao9784/mengine-app/compare/main...codex/ct-041-catalog-read-from-tenant-grants

## ⑥ 验收标准

| # | 标准 | 如何验 |
|---|---|---|
| R1 | 有授权行可见 | 同库插入 `qo_capability_tenant_grant`（或经开通 POST 写入）后，该企业会话 `GET /api/tenant-admin/v1/opened-capabilities` → 200，`items` 含 `enterpriseFunction=quality-check` 且 `displayName=质量检查` |
| R2 | 无授权行仍空 | 没有任何 grant 行 → 200，`items` 为 `[]`。同一企业只有 `qo_capability` 登记行、没有 grant 行，仍是空列表 |
| R3 | 跨租户 | A 的响应不含 B 的功能、名称、id。B 的响应不含 A。自报对方 tenantId → 400，且不返回对方名单。SQL 带 `tenant_id = ?` |
| R4 | 无禁包 | `qualityops` 源码无 `agentregistry` / `agentadmin` import，且无 `qo_capability_tenant_grant`。断言在 `OpenedCapabilitiesIntegrationTest` 里，默认测试为绿 |
| R5 | 不是新口、没有 grants GET | path、operationId、`OpenedCapability` 字段与 CT-039 一致。`apps/api/src/main` 的 Java 仍无 `listCapabilityTenantGrants`。响应无 `tenantId` / `grantedAt` / `moduleVersionId` / `Grant` |
| R6 | 未登录 | 无 cookie → 401「请求未获授权。」。body 无他企、无 `Grant`。未改 `IdentitySecurity` 全局文案 |
| R7 | 生产 Bean | 容器里的 `CapabilityCatalogPort` 是 `GrantCatalogAdapter`。`EmptyCapabilityCatalogAdapter` 已删除。测试没有 `@Primary` 内存种子 |
| R8 | 无迁移 | diff 不含 `db/migration`。未改 V191，未新建 V192，未改 CT-040 的授权表迁移。adapter 源码无 INSERT / UPDATE / DELETE |
| R9 | 人话闭集 | `displayName` 只来自原五值枚举。闭集外的 code 不进 `items` |
| R10 | 非范围 | 无 `src/**` diff。未改开通 POST、登记 POST、开通页。企业会话不能靠新路由插入授权行 |

命令（禁止 `-DskipTests`）：

```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export POSTGRES_BIN="$(brew --prefix postgresql@18)/bin"
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml test -Dtest=OpenedCapabilitiesIntegrationTest
```

## ⑦ 禁止操作 / 失败卡住

| 症状 | 动作 |
|---|---|
| remote 不是 mengine-app | 立刻停 |
| 有暂停令 | 不开 Codex；问 DQ |
| 脚注仍是【待合-CT-040-实现】，或实现 SHA 仍是占位 | 停；不要建表，不要改 adapter |
| 分支上没有 `qo_capability_tenant_grant` 或开通 POST | 停；等 CT-040 实现合入 |
| 新读口、改了 path / operationId / 字段，或响应含 `tenantId` / `grantedAt` / `Grant` | **打回** |
| 仍用 `@Primary` 内存种子冒充已开通，或生产 Bean 仍是 Empty | **打回** |
| 只有登记行也返回「质量检查」 | **打回**；无 grant 行必须空列表 |
| `qualityops` import 了 `agentregistry` / `agentadmin`，或自己 SQL 授权表 | **打回**；改经端口 |
| SQL 没有 `tenant_id = ?`，或 A 的响应含 B | **打回** |
| 实现了 grants GET，或企业端能插入授权行 | **打回** |
| 出现新的 Flyway，或改了 V191 / V192 / CT-040 迁移 | **打回**；本单零迁移 |
| 改了前端、开通 POST、登记 POST | `git restore` 这些路径 |
| 测试红 | 修到绿；禁止 `-DskipTests` |
| CONFLICT / push rejected | `git pull --rebase` 一次；仍失败停，发 DQ |

**硬禁止**：

- 把本单做成新的企业读口，或改 OpenAPI 字段形状
- 把 `qo_capability` 登记行当成开通
- 实现或冒充 `listCapabilityTenantGrants` 与任何 grants GET
- 企业会话、工作台、tenant-admin 自开通
- 查出全表授权再在内存里按租户过滤
- 新建或修改 Flyway；改 V191；占用或修改 V192；改 CT-040 的 V193+
- 保留 `EmptyCapabilityCatalogAdapter` 作为生产 Bean
- `git push --force`、`git reset --hard`、直推 `main`
- 改前端、改包名、改 `/mengine-api`、改 `MENGINE_*`
- `gh issue`；口令进仓库
- 有暂停令，或【待合-CT-040-实现】未改成已合 SHA，仍开 Codex

回滚（未合入）：`git switch main && git branch -D codex/ct-041-catalog-read-from-tenant-grants`。

---

**DQ 审路径**：本文件「架构已裁」+ 读法 SQL + CT-039 的 path/字段 + CT-040 的表形。通过后等 CT-040 实现 tip 合入，把【待合-CT-040-实现】改成已合 SHA，再交老板 / 后端岗 Mac 粘贴③。安全审查必看：只读本企业行、登记行不算开通、不得新开 grants GET、不得自开通。总负责人不代跑。
