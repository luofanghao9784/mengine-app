# CT-044 第四端列出已登记平台目录（只读）

状态：架构已裁可跑 · 待 docs 入库后交老板 Mac Codex　｜　分支：`codex/ct-044-agent-admin-list-capabilities`　｜　**审查人（实现 PR 后）：架构逻辑 + 安全审查 + 质量性能**　｜　基准：切单时最新 `origin/main` tip `bbd0c60` / [#39](https://github.com/luofanghao9784/mengine-app/pull/39)（CT-043 执行单）。其前含 CT-040 实现 `ea6e827` / [#38](https://github.com/luofanghao9784/mengine-app/pull/38)、CT-041 执行单 `a514be5` / [#36](https://github.com/luofanghao9784/mengine-app/pull/36)、CT-034-A 实现 `75ab17a` / [#30](https://github.com/luofanghao9784/mengine-app/pull/30)、CT-034-P1 `022768b` / #22、CT-035 `bd06caf` / #21。

> **日切片：第四端目录只读 / 可演示点**：第四端会话 `GET /api/agent-admin/v1/capabilities`。表空时 **200**，body 为 `[]`。登记过的行出现在这个数组里，只有目录字段。没有页面增量。前端把这口接到现页仍是 CT-020-F4，本单不改 `src/**`。  
> **挂靠**：两周日切片·轨 A。与 CT-041 的实现并行，不互相改文件。不是企业读口（[CT-039](CT-039-tenant-opened-capabilities-readonly.md)），不是开通写（[CT-040](CT-040-agent-admin-grant-tenant-opened.md)），不是企业读口换源（[CT-041](CT-041-catalog-read-from-tenant-grants.md)），不是开通按钮（[CT-042](CT-042-agent-admin-grant-tenant-button.md)），不是 E2 提交（[CT-043](CT-043-workspace-quality-check-min-submit.md)）。`docs/codex-tasks/两周日切片-三轨并行-20261031.md`。  
> **总负责人不代跑**；老板 / 后端岗在 Mac 自跑 Codex。模型 `gpt-6.1-sol`，思考强度 **high**（本机若是 `gpt-5.1-codex` 亦可）。  
> **仓**：`luofanghao9784/mengine-app`。

规格依据：

- 契约：`contracts/public-api/capability-registry.openapi.json`。`GET /api/agent-admin/v1/capabilities` 的 operationId 是 `listCapabilities`。200 的 schema 是 **JSON 数组**，元素 `$ref` `Capability`。`Capability` 的 `required` 只有 `capabilityId`、`name`；`enterpriseFunction` 引用闭集 `EnterpriseFunction`（五值）；`kind` 只允许 `quality_check`；`additionalProperties: false`
- 今日代码：`com.dreamcore.workspace.agentadmin.CapabilityRegistryController` 只有 `POST` `registerCapability`。同 path 的 `GET` 没有映射。未登录 GET 已经是 401（`CapabilityRegistryIntegrationTest.dedicatedChainDoesNotOpenOtherMethodsOrNeighboringRoutes`）
- 表：`apps/api/src/main/resources/db/migration-common/V191__platform_capability_registry.sql`。`qo_capability` 列是 `capability_id`、`name`、`kind`、`enterprise_function`、`created_at`。**无 `tenant_id`**。写者今日是 `CapabilityRegistryStore.insert`
- 会话：`com.dreamcore.workspace.identity.AgentAdminSecurity` 匹配 `/api/agent-admin/**`。Cookie 默认名 `DREAMCORE_AGENT`（`AgentAdminIdentity`）。未登录走 `AgentAdminErrors`，401，`AUTHENTICATION_REQUIRED`，人话「还没有登录，请先登录后再试」。同一过滤器对 `GET` / `HEAD` / `OPTIONS` **不检查** `X-CSRF-TOKEN`；CSRF 只挡写方法
- 开通写已合，本单不读它的名单：`qo_capability_tenant_grant`（V193），`CapabilityTenantGrantController` 只有 POST。`CapabilityTenantGrantStore` 按 `capability_id` 锁目录行是开通写的校验，不是本列表
- 企业读口：`GET /api/tenant-admin/v1/opened-capabilities`，`qualityops.OpenedCapabilitiesController`，经 `CapabilityCatalogPort`。#41 已合 348cafc，生产 CapabilityCatalogPort=GrantCatalogAdapter，Empty 已删。那条口的成功体是 `{"items":[]}`，**不要**抄到本 GET
- ADR-B8 **R-B8-2**：`docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md`。`qualityops` 不得 SQL 直读 `qo_capability`

> **脚注（CT-040 实现已合）**：开通写已合 main `ea6e827` / [#38](https://github.com/luofanghao9784/mengine-app/pull/38)。表 `qo_capability_tenant_grant`，迁移 **V193**。本单不改该 POST、该 Store、该迁移。目录列表不 JOIN 这张表，响应里不出现租户、开通时间或「已给哪家企业开过」。  
> **脚注（CT-041）**：执行单已合 `a514be5` / [#36](https://github.com/luofanghao9784/mengine-app/pull/36)。实现 PR [#41](https://github.com/luofanghao9784/mengine-app/pull/41)（`codex/ct-041-catalog-read-from-tenant-grants`）#41 已合 348cafc，生产 CapabilityCatalogPort=GrantCatalogAdapter，Empty 已删。不要改 `GrantCatalogAdapter`。

### 架构已裁（2026-10-30）

1. **路径与会话钉死。** `GET /api/agent-admin/v1/capabilities`，operationId `listCapabilities`，方法名 `listCapabilities`，挂在现有 `CapabilityRegistryController`（常量 `PATH` 已是这条 path）。只认 `DREAMCORE_AGENT` 上的第四端已登录会话。无 cookie、客户 cookie `DREAMCORE_SESSION`、总台 cookie `DREAMCORE_PLATFORM`、无效或预登录会话 → **401**，code `AUTHENTICATION_REQUIRED`，message「还没有登录，请先登录后再试」。沿用 `AgentAdminErrors`，不要改这句话，不要改 `AgentAdminSecurity`，不要 `permitAll`。
2. **GET 不另加 CSRF。** 现链已经放行：非 `GET` / `HEAD` / `OPTIONS` 才查 `X-CSRF-TOKEN`。已登录且不带 CSRF 头的 GET 必须 **200**，不得 403。带了 CSRF 头也是 200。不要为这条 GET 新做 CSRF 校验，也不要把写口的 CSRF 拆掉。POST 无 CSRF 仍是 403。
3. **线缆形状钉死为骨架数组。** OpenAPI 200 是 `type: array`，元素是 `Capability`。空目录的验收句「200 items=[]」在本单的意思是：HTTP **200**，body 为 `[]`。有行时 body 是 JSON 数组。不要改成 `{"items":[]}`。那个信封属于企业读口 `OpenedCapabilityList`。不要改 200 的 schema 类型，不要给数组外再包一层。
4. **元素字段钉死为现有 `Capability`。** `additionalProperties: false`。`required` 仍只有 `capabilityId`、`name`。`enterpriseFunction` 有列值时必须出现，且只能是闭集五值；列为空时**省略该键**，不要写 `null`，不要编一个值。`kind` 同样：有值才出现，且只能是 `quality_check`。`name` 原样返回登记时写入的文本。本单不新增 `display` / `displayName`（人话展示字段不做）。不要返回 `createdAt`、`tenantId`、`grantedAt`、`moduleVersionId`、`isDefault`。
5. **只读 `qo_capability`。** 平台全局，表上没有 `tenant_id`，查询也不要加租户条件。读法见下节。空表 → 200 `[]`，不是 404，不是 501。有授权行也不要多返回元素，不要少返回元素。禁止把 `qo_capability_tenant_grant` 当目录。GET 不得 `INSERT` / `UPDATE` / `DELETE`。
6. **不泄露开通信息。** 响应 body（含 401 / 400）不得出现任何租户 id、企业名称、`grantedAt`、授权表列名或「已开通给谁」。两家企业各有授权行时，目录仍然只是目录行本身，每条 `capability_id` 出现一次。
7. **包。** 控制器与 `SELECT` 都在 `com.dreamcore.workspace.agentadmin`：GET 加在 `CapabilityRegistryController`，查询加在 `CapabilityRegistryStore`。禁止 `qualityops` 读 `qo_capability`（源码不得出现这张表名）。不要把本列表接到 `CapabilityCatalogPort`，不要改 `OpenedCapabilitiesController`。禁止实现 grants GET（operationId `listCapabilityTenantGrants`，path `/api/agent-admin/v1/tenants/{tenantId}/grants` 的 GET）。该 path 保持无映射：已登录 GET 不得返回 200。
8. **查询参数与 body 不参与过滤。** 任何 query（含 `tenantId`）或非空 body → **400**，code `INVALID_REQUEST`，message「有无法识别的字段，请检查后再提交」。不要用它们筛行。`Cache-Control: no-store` 保持（过滤器已设；控制器可再写，不要拿掉）。
9. **非范围。** 上架写（登记 POST 保持 CT-034-A）、模块版本、准入、开通写（CT-040 已合，勿改）、CT-041 换 adapter、开通按钮、E2、前端大改、新迁移、`agentregistry` 包、ArchUnit R-B8。

#### 读哪一行、返回什么（钉死）

```sql
SELECT capability_id, name, kind, enterprise_function
FROM qo_capability
ORDER BY capability_id
```

`JdbcTemplate` 占位即可（这条没有参数）。`CapabilityRegistryStore` 里新增的列表方法源码不得含 `INSERT`、`UPDATE`、`DELETE`，不得出现 `qo_capability_tenant_grant`。类里原有的 `insert` 留给 POST，不要改它的语义。不要 `SELECT *`（会带上 `created_at`）。无行 → 控制器返回 **200** 与 `[]`。

成功体示例（登记行没有 `kind` 时不要带 `kind` 键）：

```json
[{"capabilityId":"quality-check","name":"质量检查","enterpriseFunction":"quality-check"}]
```

空目录：

```json
[]
```

401 体保持现过滤器：`{"contractVersion":"1.0","code":"AUTHENTICATION_REQUIRED","message":"还没有登录，请先登录后再试","retryable":false}`。400 沿用控制器已有的 `RegistryError` 形状，message 用上面那句。

## ① 目标与范围

- **目标**：第四端登录后能看到平台已登记目录。没登记过就是空数组。开通给哪家企业不出现在这口上。
- **增量边界**：
  1. `CapabilityRegistryController.listCapabilities` + `CapabilityRegistryStore` 的只读查询。
  2. `CapabilityRegistryIntegrationTest` 加上文各条。既有 POST 断言保持。`resetRegistry` 若会插入授权行，先 `DELETE FROM qo_capability_tenant_grant` 再删 `qo_capability`，避免外键挡住后面的用例。这只改测试清理顺序。
  3. OpenAPI 只改三处措辞：`info.description` 里「GET list 与模块、准入仍是骨架 · 未实现」改为「GET listCapabilities 已实现（CT-044，只读 qo_capability，空目录为 []）；模块、准入与 grants GET 仍是骨架 · 未实现」。`listCapabilities` 的 summary 改为「列出已登记平台目录（CT-044）」。其 200 description 改为「CT-044：已登记平台目录。空目录为 []。不返回开通信息。」200 的 schema 仍是数组。不要把 grants、modules、admission 写成已实现。
- **改哪些文件（允许）**：
  - `apps/api/src/main/java/com/dreamcore/workspace/agentadmin/CapabilityRegistryController.java`
  - `apps/api/src/main/java/com/dreamcore/workspace/agentadmin/CapabilityRegistryStore.java`
  - `apps/api/src/test/java/com/dreamcore/workspace/CapabilityRegistryIntegrationTest.java`
  - `contracts/public-api/capability-registry.openapi.json`（仅上面三处措辞）
- **不做什么**：见架构已裁第 9 条。

## ② 前置条件与分支名

- **⓪ 暂停令自查（第一步）**：有或拿不准 → 立刻停，问 DQ。
- **依赖**：CT-034-A 已在 main（表 + POST 201）。CT-034-P1 与 CT-035 已在 main（第四端会话与 CSRF 链）。CT-040 实现已合，本单不调用开通 POST 来构造目录。CT-041 实现未合也不挡本单。
- 正确仓：`~/Desktop/mengine-app-luofanghao9784`（origin=`luofanghao9784/mengine-app`）。

```bash
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || { echo 'ERROR: 错误 remote，停'; exit 1; }
git status
git switch main && git pull
git merge-base --is-ancestor bbd0c60 HEAD || { echo 'ERROR: main 不含 CT-043 执行单 tip，停'; exit 1; }
git merge-base --is-ancestor ea6e827 HEAD || { echo 'ERROR: main 不含 CT-040 实现，停'; exit 1; }
git merge-base --is-ancestor 75ab17a HEAD || { echo 'ERROR: main 不含 CT-034-A，停'; exit 1; }
test -f apps/api/src/main/java/com/dreamcore/workspace/agentadmin/CapabilityRegistryController.java || { echo 'ERROR: 找不到登记控制器，停'; exit 1; }
test -f apps/api/src/main/resources/db/migration-common/V191__platform_capability_registry.sql || { echo 'ERROR: 找不到 qo_capability 迁移，停。禁止本单建表。'; exit 1; }
git grep -n "listCapabilityTenantGrants" -- apps/api/src/main '*.java' && { echo 'ERROR: 已有 grants GET，停，问 DQ。不要再补一条。'; exit 1; }
echo 'OK: 无 grants GET 实现'
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export POSTGRES_BIN="$(brew --prefix postgresql@18)/bin"
git switch -c codex/ct-044-agent-admin-list-capabilities
```

#41 已合时：上面 `git pull` 之后的 main 会包含它。不要改去叠 `codex/ct-041-catalog-read-from-tenant-grants`。不要改 CT-041 的文件。

## ③ 完整 Codex 提示词

把下面整段交给 Codex（`$CODEX`，模型 `gpt-6.1-sol`，思考强度 **high**）。

```
你在梦擎仓库分支 codex/ct-044-agent-admin-list-capabilities 上工作。基准是最新 origin/main，须含 bbd0c60。只做本单范围。执行单：docs/codex-tasks/CT-044-agent-admin-list-capabilities-readonly.md。
对照：contracts/public-api/capability-registry.openapi.json 的 listCapabilities 与 Capability、V191__platform_capability_registry.sql、AgentAdminSecurity、CapabilityRegistryController、CapabilityRegistryStore、CapabilityRegistryIntegrationTest。
ADR-B8 R-B8-2：qualityops 不得 SQL 直读 qo_capability。

今日：POST /api/agent-admin/v1/capabilities 已落库并 201。GET 同 path 没有映射；无 cookie 的 GET 已是 401。AgentAdminSecurity 对 GET/HEAD/OPTIONS 不检查 X-CSRF-TOKEN。qo_capability 无 tenant_id。开通表 qo_capability_tenant_grant 已存在，本单不读它来组列表。企业读口是 GET /api/tenant-admin/v1/opened-capabilities，成功体才是 {"items":[]}。CT-041 实现若已在 main，不要改它的文件。

【已裁】
1. 实现 GET /api/agent-admin/v1/capabilities，Java 方法名 listCapabilities，加在 com.dreamcore.workspace.agentadmin.CapabilityRegistryController。只认 DREAMCORE_AGENT。未登录、DREAMCORE_SESSION、DREAMCORE_PLATFORM、无效会话都是 401，code AUTHENTICATION_REQUIRED，message「还没有登录，请先登录后再试」。不要改 AgentAdminErrors 的这句话，不要改 AgentAdminSecurity，不要 permitAll。
2. 已登录 GET 不带 CSRF 必须 200，不得 403。不要给 GET 加 CSRF。POST 无 CSRF 仍是 403。
3. 200 的 body 是 JSON 数组，不是 {"items":[]}。空目录是 []，HTTP 200，不是 404，不是 501。有行时按 capability_id 升序。
4. 每个元素只允许骨架 Capability 的键：capabilityId、name 必有；enterpriseFunction、kind 有列值才出现。null 键省略。enterpriseFunction 只能是 document-parse、table-compare、quality-check、semantic-annotation、repair-suggestion。kind 只能是 quality_check。不要新增 display 或 displayName。不要返回 createdAt、tenantId、grantedAt、moduleVersionId、isDefault。additionalProperties 意义上不得多键。
5. 只读 qo_capability。SQL 原样：SELECT capability_id, name, kind, enterprise_function FROM qo_capability ORDER BY capability_id。不要 WHERE tenant，不要 JOIN 授权表，不要 SELECT *。列表方法不得 INSERT/UPDATE/DELETE。不要改 insert 的语义。GET 前后目录行数与授权行数都不变。
6. 响应不得含他租户开通信息。授权行不增加、不减少目录元素。
7. 查询放在 CapabilityRegistryStore。qualityops 源码不得出现 qo_capability。不要改 OpenedCapabilitiesController，不要改 CapabilityCatalogPort，不要把本列表接到企业读口。不要实现 listCapabilityTenantGrants。不要给 /api/agent-admin/v1/tenants/{tenantId}/grants 加 GET。已登录 GET 那条 path 不得 200。
8. 任何 query 或非空 body：400，INVALID_REQUEST，「有无法识别的字段，请检查后再提交」。不要用 tenantId 过滤。Cache-Control: no-store 保持。
9. 非范围：登记 POST 的行为、开通 POST、V193、CT-041 的 adapter 与 opened-capabilities 契约、前端、模块版本、准入、新 Flyway、agentregistry 包。

【OpenAPI · 只改三处措辞】
info.description 中「GET list 与模块、准入仍是骨架 · 未实现」改为「GET listCapabilities 已实现（CT-044，只读 qo_capability，空目录为 []）；模块、准入与 grants GET 仍是骨架 · 未实现」。
listCapabilities 的 summary 改为「列出已登记平台目录（CT-044）」。
该 GET 的 200 description 改为「CT-044：已登记平台目录。空目录为 []。不返回开通信息。」
200 schema 保持 type array。不要改 Capability 的 required、properties、additionalProperties。不要把 grants GET、modules、admission 标成已实现。

【测试 · 扩写 CapabilityRegistryIntegrationTest，不要另起一套代替它】
若用例会插入 qo_capability_tenant_grant：resetRegistry 先 DELETE 授权表再 DELETE qo_capability。租户行可按 CapabilityTenantGrantIntegrationTest 的 INSERT INTO tenants(id,name) 造，用完删授权行。
覆盖：
- 无 cookie GET → 401，message「还没有登录，请先登录后再试」。body 无 capabilityId、无 tenantId、无 grantedAt。qo_capability 行数不变。既有「无 cookie GET → 401」断言保持。
- Cookie 名为 DREAMCORE_SESSION 或 DREAMCORE_PLATFORM → 401，同上。
- 已登录、不带 X-CSRF-TOKEN、表空 → 200，body 为 []，Cache-Control 含 no-store。带 CSRF 头同样 200 []。不得 403，不得 501。
- 用现有 POST（会话 + CSRF）写入 quality-check / 质量检查 / enterpriseFunction=quality-check 后 GET → 200，body 为 [{"capabilityId":"quality-check","name":"质量检查","enterpriseFunction":"quality-check"}]。没有 kind 键。再 GET 一次，body 相同，行数不变。
- 再插入第二行（capability_id 排序不同）→ 数组按 capability_id 升序，两条都在。
- 直接插入一行 enterprise_function 与 kind 都为 null 的目录行 → 该元素只有 capabilityId 与 name。
- 两家合成企业各插入一行授权（指向已登记的 capability_id）后 GET：body 仍只有目录字段，不含两家的 tenant id、企业名、grantedAt、tenantId。授权行数不变。目录元素不因授权而增加。
- GET ?tenantId=<某 uuid> → 400，「有无法识别的字段，请检查后再提交」，且 body 不是那一家的开通名单。
- 已登录 GET /api/agent-admin/v1/tenants/{tenantId}/grants → 不是 200。不要为此新增映射。
- qualityops 目录下的 Java 源码不含 qo_capability。CapabilityRegistryStore.java 不含 qo_capability_tenant_grant。扫不到 qualityops 目录则失败，不要跳过。
- 契约：listCapabilities 的 200 schema 仍是 array；Capability additionalProperties false；required 仍是 capabilityId 与 name。info.description 已写明 GET list 已实现，并仍写明 grants GET 未实现。
- 既有 POST 用例（401、403、400、201、409）保持通过。

【不许碰】
src/**、engine/**、workers/parser、AgentAdminSecurity、AgentAdminErrors 的 401 文案、客户 IdentitySecurity、CapabilityTenantGrantController、CapabilityTenantGrantStore、OpenedCapabilitiesController、capability.adapter、capability.registry、已有 Flyway（含 V190、V191、V192、V193）、opened-capabilities.openapi.json、grants GET、登录端点、force push、reset --hard、直推 main、gh issue、口令入库。
禁止改包名 dreamcore、/mengine-api、MENGINE_*。
禁止 -DskipTests。禁止新建迁移。禁止 CREATE TABLE。

【验收命令】
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export POSTGRES_BIN="$(brew --prefix postgresql@18)/bin"
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml test -Dtest=CapabilityRegistryIntegrationTest
没有改到开通写类就不要加跑 CapabilityTenantGrantIntegrationTest。

【做完输出】
git diff --stat；确认没有 db/migration；GET 的 path / 方法名；空目录与有目录的状态码和 body；不带 CSRF 的 GET 是否 200；401 人话是否未改；body 是否出现 tenantId 或 grantedAt（必须否）；是否实现了 grants GET（必须否）；qualityops 是否出现 qo_capability（必须否）；OpenAPI 200 是否仍为数组。
```

## ④ 推荐模型与思考强度

- 模型：`gpt-6.1-sol`（本机若是 `gpt-5.1-codex` 亦可）
- 思考强度：**high**（把授权表当成目录、改成 `{"items":[]}`、或顺手实现 grants GET，都会把这口接到错的数据上）
- **预计耗时**：Codex 30–70 分钟；一次性 Postgres 跑本单测试 15–30 分钟

## ⑤ 可复制 git 步骤（跑完如何提交）

```bash
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || exit 1
git add apps/api/src/main/java/com/dreamcore/workspace/agentadmin/CapabilityRegistryController.java \
  apps/api/src/main/java/com/dreamcore/workspace/agentadmin/CapabilityRegistryStore.java \
  apps/api/src/test/java/com/dreamcore/workspace/CapabilityRegistryIntegrationTest.java \
  contracts/public-api/capability-registry.openapi.json
git diff --cached --name-only | grep -E 'db/migration|src/admin/|src/identity/|qualityops/|capability/adapter|opened-capabilities' && echo 'ERROR: 迁移/前端/企业读口/开通写非本单' && exit 1
git commit -m "$(cat <<'EOM'
feat(api): CT-044 列出已登记平台目录

已登录的 GET /api/agent-admin/v1/capabilities 只读 qo_capability。
空目录返回空数组。不返回开通信息。
EOM
)"
git push -u origin codex/ct-044-agent-admin-list-capabilities
gh pr create -R luofanghao9784/mengine-app --base main --head codex/ct-044-agent-admin-list-capabilities \
  --title "feat(api): CT-044 列出已登记平台目录" \
  --body "## 摘要
GET /api/agent-admin/v1/capabilities（listCapabilities）在第四端会话下只读 qo_capability。空目录 200，body 为 []。不返回租户开通信息。

## 范围
不是开通写，不是 grants GET，不是企业读口 CT-039。未改 V191 / V193。GET 沿用现链，不另要 CSRF。

## 审查
- 架构逻辑 + 安全审查 + 质量性能
- qualityops 不得 SQL 读 qo_capability
- 勿自动合并"
```

网页备用：https://github.com/luofanghao9784/mengine-app/compare/main...codex/ct-044-agent-admin-list-capabilities

## ⑥ 验收标准

| # | 标准 | 如何验 |
|---|---|---|
| L1 | 空目录 | 已登录、表空、不带 CSRF → 200，body 为 `[]`，`Cache-Control` 含 `no-store`。不是 404，不是 501，不是 403 |
| L2 | 有目录 | POST 201 之后 GET → 200，元素含 `capabilityId`、`name`、`enterpriseFunction`。无多余键。再次 GET 不改行数 |
| L3 | 字段 | `additionalProperties` 意义上只有骨架键。`enterpriseFunction` / `kind` 为空则省略，不写 null。无 `display`、`displayName`、`createdAt` |
| L4 | 不返回开通 | 两家企业都有授权行时，body 不含其 id、名称、`tenantId`、`grantedAt`。元素条数等于目录行数。授权行数不变 |
| L5 | 未登录 | 无 cookie，以及 `DREAMCORE_SESSION` / `DREAMCORE_PLATFORM` → 401「还没有登录，请先登录后再试」。body 无目录字段、无他企 |
| L6 | 只读目录表 | SQL 只查 `qo_capability`，`ORDER BY capability_id`，无租户条件。列表方法无写语句。`qualityops` 源码无 `qo_capability` |
| L7 | 无 grants GET | `apps/api/src/main` 的 Java 仍无 `listCapabilityTenantGrants`。已登录 GET `/api/agent-admin/v1/tenants/{tenantId}/grants` 不是 200 |
| L8 | 契约 | 200 schema 仍是数组。`Capability.required` 仍是 `capabilityId` 与 `name`。`additionalProperties: false`。description 写明本 GET 已实现，并写明 grants GET 仍未实现 |
| L9 | 查询串 | `?tenantId=` → 400「有无法识别的字段，请检查后再提交」，且不返回该企业的开通名单 |
| L10 | 非范围 | 无新迁移。未改开通 POST、企业读口、`AgentAdminSecurity`、`src/**`。POST 的 401 / 403 / 400 / 201 / 409 仍绿 |

命令（禁止 `-DskipTests`）：

```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export POSTGRES_BIN="$(brew --prefix postgresql@18)/bin"
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml test -Dtest=CapabilityRegistryIntegrationTest
```

## ⑦ 禁止操作 / 失败卡住

| 情况 | 动作 |
|---|---|
| main 不含 `bbd0c60` 或 `75ab17a` 或 `ea6e827` | 停，先拉 main |
| 想叠 #41 的分支，或去改 `GrantCatalogAdapter` | 停。#41 未合也不等；已合则 rebase main，仍不改那些文件 |
| 把 200 做成 `{"items":[]}` | **打回**。那是企业读口的信封。本单是骨架数组 |
| 用授权表填充列表，或响应里出现租户 / `grantedAt` | **打回** |
| `qualityops` 出现 `qo_capability`，或实现了 grants GET | **打回** |
| 给 GET 加 CSRF，或恢复 `permitAll` | **打回**。未登录必须仍是 401 人话 |
| 空目录返回 404 或 501 | **打回** |
| 新建迁移或改 V191 / V193 | **打回**。表已经在 |
| 顺手改前端、开通按钮、E2 | 拆出去。本单只有目录 GET |

- 禁止实现 `listCapabilityTenantGrants` 或任何 grants GET
- 禁止把 `qo_capability_tenant_grant` 当成目录
- 禁止企业会话调用这条 GET 来冒充「本租户已开通」（那条口仍是 CT-039）
- 禁止 `force push`、`reset --hard`、直推 `main`、把口令写入仓库
