# CT-039 企业侧「本租户已开通」只读

状态：架构已裁可跑 · 待 docs 入库后交老板 Mac Codex　｜　分支：`codex/ct-039-tenant-opened-capabilities-readonly`　｜　**审查人（实现 PR 后）：架构逻辑 + 安全审查 + 质量性能**　｜　基准：切单时对照 `fdc22fe`（CT-034-A 执行单 [#28](https://github.com/luofanghao9784/mengine-app/pull/28)）。其后目录实现已合 `75ab17a` / [#30](https://github.com/luofanghao9784/mengine-app/pull/30)（平台全局 `qo_capability`，不是开通数据）。**实现已合** main `701c3ca` / [#31](https://github.com/luofanghao9784/mengine-app/pull/31)。生产 `EmptyCapabilityCatalogAdapter` 仍空。**#35 接真已合** `7fa4946`（企业侧消费该读口，未改生产 adapter）。开通真源仍靠 [CT-040](CT-040-agent-admin-grant-tenant-opened.md) 写口，合入后由读口接。测试可对照授权表。**CT-037 已合** `1d847e6`。

> **本单只做后端 / 契约读口。** 供 CT-036 钉死【待补-读口】。CT-036 仍是消费骨架，不是本读口的实现单。  
> **已合空态壳**：`#25` 的 tenant-admin「已开通」与 workspace「质量检查」曾是固定诚实空态。**#35 接真已合** `7fa4946`：这两页已消费本读口，生产 adapter 仍空。本单不改这两页。  
> **总负责人不代跑**；老板 / 后端岗在 Mac 自跑 Codex。模型 `gpt-6.1-sol`，思考强度 **high**。  
> **仓**：`luofanghao9784/mengine-app`。

规格依据：

- CT-036【待补-读口】：[`CT-036-enterprise-consume-opened-capability.md`](CT-036-enterprise-consume-opened-capability.md)
- ADR-B8 **R-B8-2**：`docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md`（`qualityops` 只经 `CapabilityCatalogPort`，不依赖 `agentregistry`）
- 第四端 grants 只读 UI：[`CT-020-F3-versions-grants-readonly.md`](CT-020-F3-versions-grants-readonly.md)（`#view=capability-registry&tab=grants`，第四端表面）
- 契约骨架：`contracts/public-api/capability-registry.openapi.json`（`listCapabilities`、`listCapabilityTenantGrants` 均为骨架，**未实现**）、`contracts/public-api/check-flow-config.openapi.json`（`listBindableModulesForTenant` 是「可绑定版本」骨架，不是已开通列表）
- 人话：[《全端文案规范》](https://www.notion.so/40966c386fbf8120aaefc0290f9dedb8)、[去黑话对照](https://app.notion.com/p/40966c386fbf81f3a2e3e1822ae6a9b9)

> **脚注（现状）**：CT-039 **实现已合** main `701c3ca` / [#31](https://github.com/luofanghao9784/mengine-app/pull/31)。`CapabilityCatalogPort`、`qualityops` 读口与 `EmptyCapabilityCatalogAdapter` 已落盘；生产 adapter 仍恒为空，不把登记行当成开通。**#35 接真已合** `7fa4946`：企业侧已消费该读口，未改生产 adapter。登记 POST 已由 CT-034-A 落库并 201（`75ab17a`）。没有登记 GET，没有 grants GET。开通真源仍靠 CT-040 写口，合入后由读口接。**CT-037 已合** `1d847e6`。  
> **脚注（A 档 #30 / 读口 #31 / 接真 #35）**：目录实现已合，表 `qo_capability` 无 `tenant_id`（V191）。读口实现已合，生产 Empty adapter 仍空。**#35 接真已合** `7fa4946`。测试可对照授权表。不要改登记 POST，不要占 V191，不要实现 grants POST。投影若仍自建，迁移钉 **V192+**。不要再造第二套开通真源。**CT-037 已合** `1d847e6`。

### 架构已裁（2026-10-30）

1. **登记目录是平台全局。** 第四端会话没有租户（CT-035：`/me` 无 `tenantId`，会话表无 `tenant_id`）。**本单不做登记写，也不做开通写。** 不改已落库的 `POST /api/agent-admin/v1/capabilities`（`75ab17a` 已是 201，禁止改回 501）。开通写归 CT-040。
2. **消费读口 ≠ 第四端授权表面。** 企业登录后的「本租户已开通」**禁止**调用 `GET /api/agent-admin/v1/tenants/{tenantId}/grants`，也**禁止**把任何 `/api/agent-admin/**` 当企业读口。该 GET 的 operationId `listCapabilityTenantGrants` 在契约里仍是骨架，**没有实现**。`GET /api/agent-admin/v1/capabilities`（`listCapabilities`）同样未实现。本单**不要**写「接上已有 grants GET / 已有目录 GET」。
3. **另裁企业读口（本单钉死）**：
   - `GET /api/tenant-admin/v1/opened-capabilities`
   - operationId：`listOpenedCapabilities`
   - 租户**只**从企业登录会话来，路径、query、body 都**没有** `tenantId`
   - 鉴权是客户域企业会话（cookie `DREAMCORE_SESSION`，`/api/v1/auth`，`IdentitySecurity`）。第四端 cookie `DREAMCORE_AGENT`、总台 cookie `DREAMCORE_PLATFORM` 进这条路径 → **401**
   - tenant-admin 与 workspace 共用这一条读口。已合空态壳上的 `#tenant=` 只是前端路由，**不是**本接口的租户来源
4. **R-B8-2**：读侧经 `capability.registry.CapabilityCatalogPort`（端口未落盘则本单只加只读方法）。控制器放 `com.dreamcore.workspace.qualityops`。端口由 adapter 实现（`agentregistry.adapter` 或 `capability.adapter`，PR 写明选哪一个）。`qualityops` **不得** import `agentregistry` 或 `agentadmin`。禁止 SQL 直读 `qo_capability` / `qo_module_version` / `qo_capability_tenant_grant` / `qo_admission_test_record`。
5. **会话里的企业**：用已登录账号的 ACTIVE 成员身份（`IdentityService.me`）。恰好一个企业 → 读该企业。零个，或多于一个且会话没有钉住当前企业 → **404**，人话「暂时不能查看已开通功能」，响应里没有企业名称、没有开通名单。这种情况标【待补-会话】，**不要**改信前端自报的 tenantId，也不要新造「当前企业」cookie。CT-035 是第四端登录，**不是**这条企业会话；它已合也不把 `DREAMCORE_AGENT` 当成企业读口。
6. **未开通**：本企业已能确定、但没有已开通功能 → **200**，`items` 为空数组。不要用假名单。跨企业：A 的响应里不得出现 B 的名称、功能或材料。
7. **字段钉死**（`additionalProperties: false`）：
   - 响应体 schema 名 `OpenedCapabilityList`，必填 `items`
   - 元素 schema 名 `OpenedCapability`，必填 `enterpriseFunction`、`displayName`
   - `enterpriseFunction` 闭集与登记契约相同：`document-parse`、`table-compare`、`quality-check`、`semantic-annotation`、`repair-suggestion`。不新增枚举
   - `displayName` 由服务端填人话，闭集对应：「文档解析」「表格对比」「质量检查」「语义标注」「修复建议」。演示种子只用 `quality-check` / 「质量检查」
   - 响应**不要** `tenantId`、`moduleVersionId`、`isDefault`、`grantedAt`，schema 名不要用 Grant
8. **契约 GET 未实现。** 本单新增的是上面这条企业读口，写入 `contracts/public-api/opened-capabilities.openapi.json`（新文件）。不要改 `listCapabilityTenantGrants` / `listCapabilities` 去冒充已实现，也不要改 `listBindableModulesForTenant`。错误体沿用 `contracts/public-api/error.schema.json`（`contractVersion`、`code`、`message`、`retryable`）。
9. **数据**：目录实现已合（V191 `qo_capability`，无 `tenant_id`）。CT-039 **实现已合** `701c3ca` / #31，生产 `EmptyCapabilityCatalogAdapter` 仍空（200 + `items: []`），不把登记行当成开通。开通真源仍靠 CT-040 写口，合入后由读口接。测试可对照授权表，种子不得走登记 POST，也不得走开通 POST。若必须建只读投影表：迁移号 **V192+**，且大于开跑时 `db/migration`、`db/migration-local`、`db/migration-common` 三处最大号。禁止改已有迁移，禁止改 V191。CT-040 的授权表占 **V193+**，本单不要占那个号，也不要建 `qo_capability_tenant_grant`。投影只供本读口。不要再造第二套开通真源。
10. **与总部名单对账（E36-6）**可以做，但只在测试里对照**同一份种子投影**。禁止企业会话去请求第四端 grants。第四端只读 grants 仍未实现，本单不实现它。
11. **非范围**：开通写、登记 POST 落库（CT-034-A）、CT-036 前端页与空态壳接线、精致开通页、批量开通、真实质量检查执行。

## ① 目标与范围

- **目标**：企业登录后，用一条新的只读接口看见「本租户已开通」。已开通的企业能看到人话名；未开通得到空列表；别的企业的数据不出现。
- **增量边界**：
  1. 实现并契约化 `GET /api/tenant-admin/v1/opened-capabilities`（`listOpenedCapabilities`），字段按上面第 7 条。
  2. 租户只从企业会话的唯一 ACTIVE 成员身份来。带 `tenantId` 的 query 或 body → **400**，人话「有无法识别的字段，请检查后再提交」，且不按该 id 查询。
  3. `qualityops` 只调用 `CapabilityCatalogPort`。同 PR 带一条自动断言：该包源码不 import `agentregistry` / `agentadmin`（读源文件或 ArchUnit 均可，必须进默认测试并绿）。
  4. 目录已合。CT-039 **实现已合** `701c3ca` / #31：生产 `EmptyCapabilityCatalogAdapter` 仍返回空列表。开通真源仍靠 CT-040 写口，合入后由读口接。集成测试可对照授权表；种子不是生产数据，不得走登记 POST，也不得走开通 POST。
  5. 有会话但定不出唯一企业 → 404 +「暂时不能查看已开通功能」。未登录沿用客户域安全链的 401；**不要**改 `IdentitySecurity.writeError` 的全局文案。若本路径未登录文案仍是「请求未获授权。」，测试断言 401，且 body 不含他企、不含 `Grant`。
- **改哪些文件（允许）**：
  - `contracts/public-api/opened-capabilities.openapi.json`（新建）
  - `apps/api/src/main/java/com/dreamcore/workspace/qualityops/**`（新建只读控制器）
  - `apps/api/src/main/java/com/dreamcore/workspace/capability/registry/CapabilityCatalogPort.java`（只读方法；已存在则只加方法，不加重载写）
  - adapter 一个包：`...capability.adapter` 或 `...agentregistry.adapter`（只实现端口，不暴露登记写）
  - 对应测试；若建投影，仅新增 `db/migration-common` 里大于当时最大号且 ≥ V192 的新文件。禁止改 V191。禁止建 CT-040 的授权表
- **不做什么**：
  - 不实现 `listCapabilities`、`listCapabilityTenantGrants`、`createCapabilityTenantGrant`
  - 不让企业会话访问 `/api/agent-admin/**` 来完成本单
  - 不改 `src/admin/OpenedFunctions.tsx`、`src/identity/QualityCheck.tsx`、agent-admin 人话、空态壳文案
  - 不改登记 POST、不做开通写、不改包名字符串、`/mengine-api`、`MENGINE_*`

## ② 前置条件与分支名

- **⓪ 暂停令自查（第一步）**：有或拿不准 → 立刻停，问 DQ。
- **依赖**：
  - 企业登录已在 main（客户域 `DREAMCORE_SESSION`）。解析不出唯一企业时按【待补-会话】返回 404，不要改走第四端。
  - 登记目录已合（`75ab17a`）。本读口 **实现已合**（`701c3ca` / #31），生产 Empty adapter 仍空。开通真源仍靠 CT-040 写口，合入后由读口接。测试可对照授权表。开通写归 CT-040，本单不做。
  - 空态壳 `#25` 已合。本单不接前端。
- 正确仓：`~/Desktop/mengine-app-luofanghao9784`（origin=`luofanghao9784/mengine-app`）。

```bash
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || { echo 'ERROR: 错误 remote，停'; exit 1; }
git status
git switch main && git pull
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export POSTGRES_BIN="$(brew --prefix postgresql@18)/bin"
git switch -c codex/ct-039-tenant-opened-capabilities-readonly
```

开跑前确认契约 GET 仍未实现（没有对应控制器即符合预期，不要补一个 grants GET）：

```bash
git grep -n "listCapabilityTenantGrants\|/tenants/.*/grants" -- apps/api/src/main '*.java' || echo 'OK: 无 grants GET 实现'
git grep -n "opened-capabilities" -- contracts apps/api || echo 'OK: 企业读口尚未存在，本单新建'
```

## ③ 完整 Codex 提示词

把下面整段交给 Codex（模型 `gpt-6.1-sol`，思考强度 **high**）。

```
你在梦擎仓库分支 codex/ct-039-tenant-opened-capabilities-readonly 上工作。基准 origin/main（须含 7e21bc0 空态壳）。只做本单范围。执行单：docs/codex-tasks/CT-039-tenant-opened-capabilities-readonly.md。
ADR-B8 R-B8-2：docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md
CT-036 只作消费骨架，不要把它改成实现单，也不要改 src/admin/OpenedFunctions.tsx 与 src/identity/QualityCheck.tsx。

【后端前置 · 必须遵守】
1. 登记目录是平台全局（第四端无 tenant）。本单不做登记写，也不做开通写。不要改 POST /api/agent-admin/v1/capabilities（它已是 201，禁止改回 501）。不要做 CT-040 的 grants POST。
2. 禁止企业登录后直接调第四端 GET /api/agent-admin/v1/tenants/{tenantId}/grants，或任何 /api/agent-admin/**，来充当「本租户已开通」。另裁企业读口：GET /api/tenant-admin/v1/opened-capabilities，operationId listOpenedCapabilities。与总部名单对账可以，但只能在测试里对照同一份种子；路径和鉴权必须是企业会话（DREAMCORE_SESSION）。禁止企业会话打到 /api/agent-admin/**。
3. 契约 GET listCapabilities 与 listCapabilityTenantGrants 均未实现。本单实现的是新的企业读口，不要写「接上已有 grants GET」。不要修改这两条 operation 去假装已实现。listBindableModulesForTenant 是可绑定版本骨架，不是本列表。若投影表需要迁移：大于三处迁移目录当前最大号，且 ≥ V192。V191 已是 qo_capability，禁止改。禁止建 qo_capability_tenant_grant（那是 CT-040，迁移 V193+）。目录已合 75ab17a。CT-039 实现已合 701c3ca / #31，生产 EmptyCapabilityCatalogAdapter 仍空。开通真源仍靠 CT-040 写口，合入后由读口接。测试可对照授权表。

【钉死的接口】
GET /api/tenant-admin/v1/opened-capabilities
operationId: listOpenedCapabilities
无 path/query/body tenantId。出现 tenantId → 400，message「有无法识别的字段，请检查后再提交」，不按该 id 查。
200 体：{"items":[{"enterpriseFunction":"quality-check","displayName":"质量检查"}]}
schema：OpenedCapabilityList 必填 items；OpenedCapability 必填 enterpriseFunction、displayName；additionalProperties false。
enterpriseFunction 闭集：document-parse、table-compare、quality-check、semantic-annotation、repair-suggestion。
displayName 只许服务端人话：文档解析、表格对比、质量检查、语义标注、修复建议。
不要返回 tenantId、moduleVersionId、isDefault、grantedAt。不要在 JSON 文案里写 Grant。
契约新文件：contracts/public-api/opened-capabilities.openapi.json。错误体 $ref ./error.schema.json。

【租户与鉴权】
- 只认客户域企业会话。从 IdentityService.me 的 ACTIVE 成员身份取企业。恰好一个 → 用它。零个或多于一个 → 404，message「暂时不能查看已开通功能」，body 无企业名、无 items 名单。标【待补-会话】，不要读前端 #tenant=，不要新造当前企业 cookie。
- DREAMCORE_AGENT、DREAMCORE_PLATFORM → 401。不要改 IdentitySecurity 的全局 401 文案。
- 本企业已确定但没有开通 → 200，items 空数组。
- 不泄露他企名称、名单、材料。

【包边界】
- 控制器：com.dreamcore.workspace.qualityops。只依赖 CapabilityCatalogPort。
- 端口：com.dreamcore.workspace.capability.registry.CapabilityCatalogPort，只加「按服务端已解析的 tenant 列出已开通」的只读方法。tenant 参数由 qualityops 在会话解析之后传入，不从 HTTP 自报字段来。
- adapter 实现端口。qualityops 源码不得出现 import com.dreamcore.workspace.agentregistry 或 import com.dreamcore.workspace.agentadmin。
- 禁止 SQL 直读 qo_capability / qo_capability_tenant_grant。不要新建 qo_capability（V191 已有）。不要新建授权表。要投影才允许大于当时最大号且 ≥ V192 的新表（禁止改 V191），且只有 adapter 读它。
- 同 PR 测试断言 qualityops 无上述 import。测试必须跑，禁止 -DskipTests。

【种子】
生产默认空列表。测试种子覆盖：已开通企业可见「质量检查」；未开通企业 items 为空；跨租户响应不含另一企业的名称和功能。种子不要调用登记 POST。不要发 GET /api/agent-admin/v1/tenants/{tenantId}/grants。

【不许碰】
src/** 前端、空态壳、agent-admin、CapabilityRegistryController、CapabilityRegistryStubSecurity、登记 201、engine/**、workers/parser、已有 Flyway、口令、force push、reset --hard、直推 main、gh issue。
禁止改包名 dreamcore、/mengine-api、MENGINE_*。

【验收命令】
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export POSTGRES_BIN="$(brew --prefix postgresql@18)/bin"
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml test -Dtest=OpenedCapabilitiesIntegrationTest

【做完输出】
git diff --stat；path、operationId、字段是否与上面钉死值一致；是否新建了 grants GET（必须否）；qualityops 是否 import agentregistry/agentadmin（必须否）；生产是否仍读空；种子如何造；若有迁移，文件名是否 V192+（不得是 V191）；未登录 / 未开通 / 跨租户的状态码与 message。
```

## ④ 推荐模型与思考强度

- 模型：`gpt-6.1-sol`
- 思考强度：**high**（企业会话与第四端 grants 表面容易接错；接错会把总部授权口暴露成企业读口）
- **预计耗时**：Codex 40–90 分钟；一次性 Postgres 跑本单测试 15–30 分钟

## ⑤ 可复制 git 步骤（跑完如何提交）

```bash
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || exit 1
git add contracts/public-api/opened-capabilities.openapi.json \
  apps/api/src/main/java/com/dreamcore/workspace/qualityops \
  apps/api/src/main/java/com/dreamcore/workspace/capability \
  apps/api/src/test
# adapter 若在 agentregistry.adapter，按实际路径追加 git add。有 V192+ 迁移再追加该文件。勿 git add -A
git diff --cached --stat | grep -E 'src/admin/OpenedFunctions|src/identity/QualityCheck|agentadmin/CapabilityRegistry' && echo 'ERROR: 空态壳/登记写非本单' && exit 1
git commit -m "$(cat <<'EOM'
feat(api): CT-039 企业侧已开通只读

新增 GET /api/tenant-admin/v1/opened-capabilities。
租户来自企业会话；不接第四端 grants。
EOM
)"
git push -u origin codex/ct-039-tenant-opened-capabilities-readonly
gh pr create -R luofanghao9784/mengine-app --base main --head codex/ct-039-tenant-opened-capabilities-readonly \
  --title "feat(api): CT-039 企业侧已开通只读" \
  --body "## 摘要
另裁企业读口 GET /api/tenant-admin/v1/opened-capabilities（listOpenedCapabilities）。禁止用第四端 grants。契约上的目录 GET / grants GET 仍未实现，本单没有接它们。

## 数据
CT-039 实现已合 701c3ca / #31。生产 EmptyCapabilityCatalogAdapter 仍空。开通真源仍靠 CT-040 写口，合入后由读口接。测试可对照授权表。若有投影表，迁移大于当时最大号且 ≥ V192（禁止改 V191，禁止建 CT-040 授权表）。

## 审查
- 架构逻辑 + 安全审查 + 质量性能
- 供 CT-036 读口；不改空态壳
- 勿自动合并"
```

网页备用：https://github.com/luofanghao9784/mengine-app/compare/main...codex/ct-039-tenant-opened-capabilities-readonly

## ⑥ 验收标准

| # | 标准 | 如何验 |
|---|---|---|
| R1 | 已开通企业可见 | 种子企业的企业会话 `GET /api/tenant-admin/v1/opened-capabilities` → 200，`items` 含 `enterpriseFunction=quality-check` 且 `displayName=质量检查` |
| R2 | 未开通不可见 | 同一接口，该企业无开通 → 200，`items` 为 `[]`。没有假名单 |
| R3 | 跨租户不泄露 | 企业 A 的响应 body 不含企业 B 的名称、功能、材料。query/body 自报 B 的 tenantId → 400，且不返回 B 的名单 |
| R4 | 无 agentadmin / agentregistry import | `qualityops` 源码无这两处 import；同 PR 测试为绿 |
| R5 | 不接第四端 grants | 仓内仍无 `listCapabilityTenantGrants` 控制器；企业读口不是 `/api/agent-admin/**`；测试不请求 grants GET |
| R6 | 契约钉死 | OpenAPI path、operationId、`OpenedCapabilityList` / `OpenedCapability` 字段与③一致；`listCapabilities` 与 `listCapabilityTenantGrants` 仍是未实现骨架 |
| R7 | 会话 | 无企业会话 → 401，body 无他企、无 `Grant`。定不出唯一企业 → 404，人话「暂时不能查看已开通功能」。`DREAMCORE_AGENT` 调本路径 → 401 |
| R8 | 非写 | 不改登记 POST（保持已有 201），无开通写。有迁移则仅为大于当时最大号且 ≥ V192 的新文件，不得改 V191，不得建授权表 |

E36-6：种子投影里该企业的功能集合与 R1/R2 的 `items` 一致。第四端 grants GET 未实现，对账不得调用它。

## ⑦ 禁止操作 / 失败卡住

| 症状 | 动作 |
|---|---|
| remote 不是 mengine-app | 立刻停 |
| 有暂停令 | 不开 Codex；问 DQ |
| 企业读口做成了 grants GET，或控制器挂在 `/api/agent-admin/**` | **打回**；改回钉死的 path |
| 契约 GET 被改成「已实现」或返回了总部授权体 | **打回**；企业读口单独文件 |
| `qualityops` import 了 `agentregistry` 或 `agentadmin` | **打回**；改经端口（R-B8-2） |
| 未开通却返回假「质量检查」，或响应含他企 | **打回**；空列表 / 404，fail closed |
| 用前端 `#tenant=` 或 path tenantId 选企业 | **打回**；只认企业会话里的唯一成员身份 |
| 改了登记 POST、把 201 改回 501、占了或改了 V191、或改了 V190 及更早迁移 | **打回**；投影只许大于当时最大号且 ≥ V192 的新文件 |
| 改了空态壳或 agent-admin 文案 | `git restore` 这些路径 |
| 测试红 | 修到绿；禁止 `-DskipTests` |
| CONFLICT / push rejected | `git pull --rebase` 一次；仍失败停，发 DQ |

**硬禁止**：

- 把 `GET /api/agent-admin/v1/tenants/{tenantId}/grants` 或任何 `/api/agent-admin/**` 当作「本租户已开通」
- 实现或冒充 `listCapabilities` / `listCapabilityTenantGrants`
- `qualityops` 直依赖 `agentregistry` / `agentadmin`，或 SQL 直读登记表 / 授权表
- 信任前端自报 tenantId
- 用假已开通冒充生产数据（目录已合也不等于某企业已开通）
- 改空态壳、做开通写（CT-040）、改登记 POST（CT-034-A 已合）
- `git push --force`、`git reset --hard`、直推 `main`
- 改包名、`/mengine-api`、`MENGINE_*`
- `gh issue`；口令进仓库
- 有暂停令仍开 Codex

回滚（未合入）：`git switch main && git branch -D codex/ct-039-tenant-opened-capabilities-readonly`。

---

**DQ 审路径**：本文件 + CT-036【待补-读口】+ ADR-B8 R-B8-2 + capability-registry 里仍未实现的 grants GET。架构逻辑与安全审查主审。通过后交老板 / 后端岗 Mac 粘贴③。本单不改 CT-036 前端。总负责人不代跑。
