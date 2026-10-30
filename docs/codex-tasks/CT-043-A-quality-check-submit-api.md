# CT-043-A 质量检查最小提交：后端 createCheckTask

状态：架构已裁可跑 · 待 docs 入库后交老板 Mac Codex　｜　分支：`codex/ct-043-a-quality-check-submit-api`　｜　**审查人：架构逻辑 + 安全审查 + 质量性能**　｜　基准：`b5c3ab8329b5826735e080b62d1ddff0a097b939`（[#46](https://github.com/luofanghao9784/mengine-app/pull/46)，含已知 `127efe6` / #45、#44 `0f02e83b`、#42 `f8908cdc`、#41 `348cafc4`、#39 `bbd0c605`）

> **日切片：D6～D8 / 可演示点**：企业会话已开通「质量检查」时，`POST /api/tenant-admin/v1/quality-ops/check-tasks` 返回 **201**，`status=COMPLETED`，`result.verdict` 为 `NO_ISSUES` 或 `ISSUES_FOUND`。材料「问题：尺寸超差」得到 `ISSUES_FOUND` 且 `issues` 非空。未开通 **403** 不写库。端口或引擎失败 **503** 不写库、不返回结论。无会话 **401** 先于 CSRF **403**。  
> **挂靠**：两周日切片·轨 A。父单 [`CT-043-workspace-quality-check-min-submit.md`](CT-043-workspace-quality-check-min-submit.md) 仍禁碰后端。**后端由本子单放开，只许白名单。** 前端 [`CT-043-B-workspace-submit-result.md`](CT-043-B-workspace-submit-result.md) 可按下面「契约钉死」并行开发，**本单先合，B 再合**。两单在同一个文档 PR 里。不单列 C。  
> 模型 `gpt-6.1-sol`，思考强度 **high**（本机 `gpt-5.1-codex` 亦可）。仓 `luofanghao9784/mengine-app`。

> **脚注**：#41 已合 348cafc，生产 CapabilityCatalogPort=GrantCatalogAdapter，Empty 已删。本单不改 `GrantCatalogAdapter`。规则与人话标「待产品确认」，不阻塞。

### 契约钉死（A/B 共用）

1. **提交口。** 实现现有 `POST /api/tenant-admin/v1/quality-ops/check-tasks`，operationId 仍是 `createCheckTask`。不另开 path。骨架里的 `inputVersionId` / `configVersionId` / `executionMode` **本片不实现**。请求体改为 `additionalProperties: false`：`materialText` 字符串必填，trim 后 1～20000 字符；`title` 字符串可选，trim 后 ≤200，缺省或 trim 后空则不存。未知字段（含 `tenantId`）**400**。QUEUE 记债：「版本化材料/配置（inputVersionId/configVersionId）后移」。
2. **材料传法。** 只收纯文本 JSON。不做文件上传，不做 multipart，不复用 material 上传。**文件约束本片 = 无文件。** 文件上传、进度条、取消记债后移。
3. **成功判定。** HTTP **201**。必须字段：`taskId`（uuid）、`status` 等于 `"COMPLETED"`、`result.verdict` 为 `"NO_ISSUES"` 或 `"ISSUES_FOUND"`、`result.issues` 为 `[{message}]`。`ISSUES_FOUND` 时 `issues` 非空；`NO_ISSUES` 时 `issues` 为 `[]`。缺任一字段不是成功。人话由前端映射，标待产品确认：`NO_ISSUES`「没有发现需要修改的地方」；`ISSUES_FOUND`「发现 N 处需要注意」并列出 `message`。禁用词样「检查通过」。
4. **结果读法。** 结论只在这一次 201 响应体里。本片无 GET、无轮询、无事件流。刷新页面后不保留历史（记债）。
5. **失败态（都不写库，响应与页面都不带结论）。** 400 校验 →「内容不符合要求」。401 → 页面「请重新登录后再试」（接口体仍是客户域现文案「请求未获授权。」，`code=AUTHENTICATION_REQUIRED`）。403 `CAPABILITY_NOT_OPENED` →「贵企业还没开通「质量检查」，请联系平台管理员开通」。403 CSRF（`ACCESS_DENIED`）→ 页面「请刷新页面后再试」。404 多企业或定不出唯一 ACTIVE 企业：沿用 `OpenedCapabilitiesController` 今日 404。503 或超时 →「质量检查暂时不可用，请稍后再试」。未开通不得用 501、409 或 503。
6. **会话。** 只认 `DREAMCORE_SESSION`。租户由会话 membership 决定，算法照 `OpenedCapabilitiesController`。前端不传 `tenantId`。提交带 CSRF。前端走 `createIdentityRequest`（`src/identity/client.ts`），超时用 #46 `withTimeout`（`src/shared/abort-timeout.ts`）。
7. **门闸。** 后端每次提交都再调 `CapabilityCatalogPort.listOpenedCapabilities(tenantId)`。不含 `QUALITY_CHECK` 则 403，不写库。前端读口只是体验，不是安全边界。禁止直读 `qo_capability` / `qo_capability_tenant_grant`。禁止 import `agentadmin`。

### 允许改动路径白名单

`git diff --name-only origin/main` 每一行都必须落在下表。白名单外 `apps/api/**` 一律禁改。

| # | 路径 | 动作 |
|---|---|---|
| 1 | `apps/api/src/main/java/com/dreamcore/workspace/qualityops/CheckTaskController.java` | 新建。只注入 `CapabilityCatalogPort`、`IdentityService`、`CheckTaskService` |
| 2 | `apps/api/src/main/java/com/dreamcore/workspace/qualityops/CheckTaskService.java` | 新建 |
| 3 | `apps/api/src/main/java/com/dreamcore/workspace/qualityops/QualityCheckEngine.java` | 新建端口 |
| 4 | `apps/api/src/main/java/com/dreamcore/workspace/qualityops/RuleQualityCheckEngine.java` | 新建规则版。不调外部模型 |
| 5 | `apps/api/src/main/java/com/dreamcore/workspace/qualityops/CheckTaskStore.java` | 新建。只写 `qo_check_task` |
| 6 | `apps/api/src/test/java/com/dreamcore/workspace/CheckTaskIntegrationTest.java` | 新建 |
| 7 | `apps/api/src/test/java/com/dreamcore/workspace/QualityOpsBoundaryArchTest.java` | 新建。R-B8-2 |
| 8 | `contracts/public-api/check-run-log.openapi.json` | 只改 `createCheckTask` 的请求体与 201。GET / attempts 仍是骨架 |
| 9 | `apps/api/src/main/resources/db/migration-common/V194__qo_check_task.sql` | 新建。本基准最大号 V193，故 V194。开跑前重算；若最大号已大于 193，改用最大号 + 1 并在 PR 写明。禁止回填 V192，禁止改 V190–V193 |

不得改：`OpenedCapabilitiesController`、`IdentitySecurity`、`AgentAdminSecurity`、`CapabilityTenantGrant*`、`GrantCatalogAdapter`、`src/**`、`agentadmin` 包。

### 架构已裁

1. **规则（待产品确认）。** 必须阅读 `materialText`。一行 trim 后以「问题：」开头且后面有文字 → 一条 `message`（冒号后的文字）。有至少一条 → `verdict=ISSUES_FOUND`。没有 → `verdict=NO_ISSUES` 且 `issues=[]`。禁止不读材料就返回 `NO_ISSUES`。禁止结论或 `message` 使用「检查通过」。
2. **fail closed。** 端口抛错或超时、引擎抛错 → 503，不写库，body 无 `verdict`。先引擎成功再 INSERT。
3. **表列。** `id`、`tenant_id`（会话）、`created_by`（会话账号）、`title`、`material_text`、`status`、`result_json`、`created_at`。成功时 `status=COMPLETED`。`result_json` 存 `result`。无登记表外键。
4. **401 先于 CSRF。** 无会话 POST（无 CSRF 或乱 CSRF）→ 401。有会话无 CSRF → 403 `ACCESS_DENIED`。禁止 StubSecurity、`permitAll`、`csrf.disable()`。`IdentitySecurity` 不在白名单。匿名 POST 若现有链先 403，停，问 DQ，不要改 `IdentitySecurity`。
5. **非范围。** GET、轮询、文件、parser、外部模型、开通写、企业自助开通、第四端 grants。

成功体：

```json
{"taskId":"<uuid>","status":"COMPLETED","result":{"verdict":"ISSUES_FOUND","issues":[{"message":"尺寸超差"}]}}
```

## ① 目标与范围

开通企业提交一段纯文本，规则引擎同步给出 `verdict` 并落在会话租户名下。未开通、故障、校验失败都不落库。

## ② 前置条件与分支名

暂停令有或拿不准 → 停，问 DQ。main 须含 `b5c3ab83` 与 `348cafc`。B 可并行起草，合入必须晚于本单。仓：`~/Desktop/mengine-app-luofanghao9784`。

```bash
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || { echo 'ERROR: 错误 remote，停'; exit 1; }
git switch main && git pull
git merge-base --is-ancestor b5c3ab83 HEAD || { echo 'ERROR: main 不含 #46 基准，停'; exit 1; }
git merge-base --is-ancestor 348cafc HEAD || { echo 'ERROR: main 不含 #41，停'; exit 1; }
test -f apps/api/src/main/java/com/dreamcore/workspace/capability/adapter/GrantCatalogAdapter.java || { echo 'ERROR: GrantCatalogAdapter 不在，停'; exit 1; }
test ! -f apps/api/src/main/java/com/dreamcore/workspace/capability/adapter/EmptyCapabilityCatalogAdapter.java || { echo 'ERROR: Empty 仍在，停'; exit 1; }
echo 'OK: #41 已合 348cafc，生产 CapabilityCatalogPort=GrantCatalogAdapter，Empty 已删'
git switch -c codex/ct-043-a-quality-check-submit-api
```

## ③ 完整 Codex 提示词

交给 Codex（`gpt-6.1-sol`，思考强度 **high**；本机 `gpt-5.1-codex` 亦可）：

```
你在分支 codex/ct-043-a-quality-check-submit-api 上工作。执行单 docs/codex-tasks/CT-043-A-quality-check-submit-api.md。
基准含 b5c3ab83。#41 已合 348cafc，生产 CapabilityCatalogPort=GrantCatalogAdapter，Empty 已删。不要改 GrantCatalogAdapter。
git diff --name-only origin/main 只能落在白名单 9 个路径。

按「契约钉死」实现 POST /api/tenant-admin/v1/quality-ops/check-tasks（createCheckTask）。
请求体只有 materialText（必填 1～20000）和可选 title（≤200），additionalProperties false。不要实现 inputVersionId/configVersionId。
201 必须有 taskId、status=COMPLETED、result.verdict（NO_ISSUES 或 ISSUES_FOUND）、result.issues[{message}]。ISSUES_FOUND 时 issues 非空。
不要 GET，不要文件，不要 multipart。
每次提交都调用 CapabilityCatalogPort。不含 QUALITY_CHECK → 403 CAPABILITY_NOT_OPENED，人话「贵企业还没开通「质量检查」，请联系平台管理员开通」，不写库。
端口或引擎异常 → 503「质量检查暂时不可用，请稍后再试」，不写库，body 无 verdict。
400 一律「内容不符合要求」，含未知字段和 body 里的 tenantId。
租户只从会话来，照 OpenedCapabilitiesController。多企业 404 沿用现控制器，不写库。
无会话 POST → 401，先于 CSRF 403。有会话无 CSRF → 403 ACCESS_DENIED。禁止改 IdentitySecurity。做不到就停问 DQ。
RuleQualityCheckEngine 必须读 materialText。行「问题：尺寸超差」→ ISSUES_FOUND 且 message 含「尺寸超差」。无「问题：」行 → NO_ISSUES 且 issues 为空。禁止不读材料就 NO_ISSUES。禁止「检查通过」。
表 qo_check_task 只列 id, tenant_id, created_by, title, material_text, status, result_json, created_at。迁移 V194（若 main 最大号已大于 193，用最大号+1，禁止 V192，禁止改 V190–V193）。
QualityOpsBoundaryArchTest：qualityops 主源码无 agentadmin import，无 qo_capability 与 qo_capability_tenant_grant 字面量。
CheckTaskIntegrationTest 覆盖：401、CSRF 403、未开通 403 且无行、已开通 201 且 tenant_id=会话租户、问题材料 ISSUES_FOUND、普通材料 NO_ISSUES、A 开通 B 未开通则 B 403、多企业 404、未知字段 400、body tenantId 400、端口抛错 503 无行、引擎抛错 503 无行。
命令：python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml test -Dtest=CheckTaskIntegrationTest,QualityOpsBoundaryArchTest,OpenedCapabilitiesIntegrationTest
禁止 -DskipTests。禁止 StubSecurity。禁止第四端 grants。禁止企业自助开通。禁止改 src/**。

做完输出 git diff --name-only，确认只在白名单内。
```

## ④ 推荐模型与思考强度

`gpt-6.1-sol`，思考强度 **high**。本机 `gpt-5.1-codex` 亦可。恒通过或直读授权表都会把 E2 做成假成功。

## ⑤ 可复制 git 步骤

```bash
cd "$HOME/Desktop/mengine-app-luofanghao9784"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || exit 1
git add \
  apps/api/src/main/java/com/dreamcore/workspace/qualityops/CheckTaskController.java \
  apps/api/src/main/java/com/dreamcore/workspace/qualityops/CheckTaskService.java \
  apps/api/src/main/java/com/dreamcore/workspace/qualityops/QualityCheckEngine.java \
  apps/api/src/main/java/com/dreamcore/workspace/qualityops/RuleQualityCheckEngine.java \
  apps/api/src/main/java/com/dreamcore/workspace/qualityops/CheckTaskStore.java \
  apps/api/src/test/java/com/dreamcore/workspace/CheckTaskIntegrationTest.java \
  apps/api/src/test/java/com/dreamcore/workspace/QualityOpsBoundaryArchTest.java \
  contracts/public-api/check-run-log.openapi.json \
  apps/api/src/main/resources/db/migration-common/V194__qo_check_task.sql
echo '验收：git diff --name-only 仅落在白名单内'
git diff --name-only origin/main
git commit -m "$(cat <<'EOM'
feat(api): CT-043-A 质量检查提交与规则结论

开通企业提交纯文本并同步得到 NO_ISSUES 或 ISSUES_FOUND。
未开通 403 不写库。故障 503 不写库。
EOM
)"
git -c http.proxy= -c https.proxy= push origin codex/ct-043-a-quality-check-submit-api
```

网页备用：https://github.com/luofanghao9784/mengine-app/compare/main...codex/ct-043-a-quality-check-submit-api

## ⑥ 验收标准

| # | 标准 |
|---|---|
| A0 | `git diff --name-only origin/main` 仅落在白名单 |
| A1 | 未开通 403 `CAPABILITY_NOT_OPENED`，指定人话，无新行 |
| A2 | 已开通 201，`tenant_id` 为会话租户，字段齐全 |
| A3 | 「问题：尺寸超差」→ `ISSUES_FOUND`，`issues` 非空且含该句 |
| A4 | 无问题行 → `NO_ISSUES` 且 `issues=[]`。两条 verdict 不同。源码不是不读材料就返回 |
| A5 | 端口抛错、引擎抛错各自 503，无行，无 verdict |
| A6 | 无会话 401 先于 CSRF 403。`IdentitySecurity` 无 diff |
| A7 | 未知字段与 body `tenantId` 均为 400「内容不符合要求」，不写库 |
| A8 | 多企业 404 不写库。B 未开通则 403，无 B 的行 |
| A9 | 架构测试：无 agentadmin import，无授权/登记表 SQL |
| A10 | 迁移 = 当时最大号 + 1。本基准 V194。无 V192，V190–V193 无 diff |
| A11 | 无 GET 控制器。无文件上传 |

## ⑦ 禁止操作

| 症状 | 动作 |
|---|---|
| diff 超出白名单 | 打回 |
| 直读授权表或登记表 | 打回 |
| 未开通仍插入，或用 501/409/503 表示未开通 | 打回 |
| 故障仍 201 或带 verdict | 打回 |
| 不读材料就 `NO_ISSUES` | 打回 |
| 匿名 POST 先 403 | 停，问 DQ。禁止改 IdentitySecurity |
| 出现「检查通过」 | 打回 |

**硬禁止**：门闸只经 `CapabilityCatalogPort`；禁直读 `qo_capability` / `qo_capability_tenant_grant`；禁 import `agentadmin`；禁 body `tenantId`；禁 StubSecurity；未登录写必须 401 先于 CSRF 403；禁第四端 grants；禁企业自助开通；禁改 `IdentitySecurity`、`AgentAdminSecurity`、`OpenedCapabilitiesController`、`CapabilityTenantGrant*`、`src/**`、V190–V193；禁恒通过；禁故障写库或返回结论；禁白名单外 `apps/api`；迁移以 main 实际最大号 + 1 为准（本基准 V194，V192 不用）；推送只用 `git -c http.proxy= -c https.proxy= push origin <branch>`；禁 force push、直推 main、口令入库。

### 依赖与并行

| 单 | 关系 |
|---|---|
| 父单 | 灰钮总单。本单是被放开的后端 |
| CT-043-B | 契约与本单「契约钉死」相同。**开发可并行。合入：A 先，B 后** |
| #41 | 已合 `348cafc`。Empty 已删 |
| C | 不单列。e2e 在 B |

回滚：`git switch main && git branch -D codex/ct-043-a-quality-check-submit-api`。
