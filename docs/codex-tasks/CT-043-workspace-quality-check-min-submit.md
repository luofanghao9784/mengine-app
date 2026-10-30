# CT-043 工作台「质量检查」最小提交（E2）

> **拆子单（2026-10-30）**：本文件是前端 + e2e 总单。禁止改 `apps/api`、契约、迁移，禁止新增 qualityops 类。**后端部分由 [CT-043-A](CT-043-A-quality-check-submit-api.md) 放开，范围见 A。** 接线与 e2e 见 [CT-043-B](CT-043-B-workspace-submit-result.md)。不单列 C。A 与 B 写在同一个文档 PR；实现上 B 可按契约并行开发，**A 先合再合 B**。
>
> #41 已合 348cafc，生产 CapabilityCatalogPort=GrantCatalogAdapter，Empty 已删。#41 `348cafc` 之后企业读口真读授权表，第四端开通后工作台会显示三步。
>
> **硬性**：A/B 合入前，提交按钮保持灰色，并保留人话原因。现句「暂时不能提交检查材料（执行服务尚未接通）」可继续用。禁假提交、禁假结果。下面的 fail-closed 提示词不要再开跑去接 API。

状态：总单封存为灰钮 · 实现走 A/B · 架构已裁可跑 · 待 docs 入库后交老板 Mac Codex　｜　**正式岗** id=`ec838a2d-d838-48cd-a789-e1af1424a7f3`（勿派重复岗）　｜　分支：`codex/ct-043-workspace-quality-check-min-submit`　｜　**审查人（实现 PR 后）：发布验收 + 质量性能 + 架构逻辑 + 安全审查**　｜　基准：切单时最新 `origin/main`（须含 tip `ea6e827` / [#38](https://github.com/luofanghao9784/mengine-app/pull/38) CT-040 实现；其前含 CT-042 执行单 `23da838` / [#37](https://github.com/luofanghao9784/mengine-app/pull/37)、CT-041 执行单 `a514be5` / [#36](https://github.com/luofanghao9784/mengine-app/pull/36)、#35 接真 `7fa4946`、CT-039 实现 `701c3ca` / [#31](https://github.com/luofanghao9784/mengine-app/pull/31)、CT-034-A 实现 `75ab17a` / #30、空态壳 `#25` / `7e21bc0`）

> **日切片：D6～D8 / 可演示点**：员工打开 `/workspace/#tenant=<企业ID>&view=quality-check`。三步都在：进入（#35 已接）→ 提交检查材料 → 处理结果。提交口是【待补-提交口】，本单 **fail closed**：未开通则人话拒绝，不落材料；读口里已有「质量检查」时，按钮仍不可点，结果区仍是诚实空态。禁止「检查通过」，禁止假 Live。  
> **挂靠**：两周日切片·轨 B。验收句 **E2**（[两周主路径验收句](https://www.notion.so/40966c386fbf81ad97cff544bc2906ff)）。不是开通写（[CT-040](CT-040-agent-admin-grant-tenant-opened.md)，实现已合），不是开通按钮（[CT-042](CT-042-agent-admin-grant-tenant-button.md)），不是读口换源（[CT-041](CT-041-catalog-read-from-tenant-grants.md)），不是现网冒烟（CT-037）。`docs/codex-tasks/两周日切片-三轨并行-20261031.md`。  
> **总负责人不代跑**；老板 / 正式前端岗在 Mac 自跑 Codex。模型 `gpt-6.1-sol`，思考强度 **high**（本机若是 `gpt-5.1-codex` 亦可）。  
> **仓**：`luofanghao9784/mengine-app`。

规格依据：

- 现页已钉：`src/identity/QualityCheck.tsx`。hash `qualityCheckHref` = `#tenant=<企业ID>&view=quality-check`。工作台入口在 `src/identity/AccessApp.tsx`（`view=quality-check`）。样式 `src/identity/quality-check.css`。三步标题：「① 进入说明」「② 提交检查材料」「③ 处理结果」。按钮文案「提交检查材料」，今日 `disabled`
- 进入已接：#35 / `7fa4946`。读函数 `src/admin/openedCapabilities.ts` 的 `readOpenedCapabilities`，只 `GET /api/tenant-admin/v1/opened-capabilities`。空态壳 [#25](https://github.com/luofanghao9784/mengine-app/pull/25) / `7e21bc0`。专项 `tests/e2e/ct036-empty-shell.spec.ts`
- 前门闸：[`CT-039-tenant-opened-capabilities-readonly.md`](CT-039-tenant-opened-capabilities-readonly.md)（实现 `701c3ca` / #31）。path `GET /api/tenant-admin/v1/opened-capabilities`，operationId `listOpenedCapabilities`。控制器 `com.dreamcore.workspace.qualityops.OpenedCapabilitiesController`，只调用 `com.dreamcore.workspace.capability.registry.CapabilityCatalogPort#listOpenedCapabilities(UUID)`。#41 已合 348cafc，生产 CapabilityCatalogPort=GrantCatalogAdapter，Empty 已删。第四端开通后，工作台读口会列出「质量检查」并显示三步
- 开通写已合，本单不调用：[`CT-040-agent-admin-grant-tenant-opened.md`](CT-040-agent-admin-grant-tenant-opened.md)。**实现已合** `ea6e827` / #38。`POST /api/agent-admin/v1/tenants/{tenantId}/grants` 在 `agentadmin.CapabilityTenantGrantController`。表 `qo_capability_tenant_grant`，迁移 `V193__qo_capability_tenant_grant.sql`。GET list 仍无控制器
- 读口换源已合：[`CT-041-catalog-read-from-tenant-grants.md`](CT-041-catalog-read-from-tenant-grants.md)。#41 已合 348cafc，生产 CapabilityCatalogPort=GrantCatalogAdapter，Empty 已删
- 开通按钮不是本单：[`CT-042-agent-admin-grant-tenant-button.md`](CT-042-agent-admin-grant-tenant-button.md)（执行单 `23da838` / #37）。第四端 `#view=capability-registry&tab=grants`
- ADR-B8 **R-B8-2**：`docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md`。`qualityops` 只经 `CapabilityCatalogPort`，不得依赖 `agentregistry` / `agentadmin`，不得 SQL 授权表或登记表
- 文案：[《全端文案规范》](https://www.notion.so/40966c386fbf8120aaefc0290f9dedb8)、[去黑话对照](https://app.notion.com/p/40966c386fbf81f3a2e3e1822ae6a9b9)、[体验落部 · UX](https://app.notion.com/p/40966c386fbf8142b0bbcb16d1876e8f)。QUEUE「编制·前端开发」硬性第 6 条：可见文案禁止裸用 `seed` / `capability` / `Capability` / `Grant` / `admission`

> **脚注（CT-040 实现已合）**：开通写实现已合 main `ea6e827` / [#38](https://github.com/luofanghao9784/mengine-app/pull/38)。表与 POST 都在 `agentadmin`。本单不调用该 POST，不改该控制器，不改 V193，不把开通写当成质量检查提交。  
> **脚注（【待补-提交口】）**：2026-10-30 对照 `ea6e827` 查仓。能钉的只有现页 path（见下「页 path」）。下列都**不能**当成本单提交口：`contracts/public-api/check-flow-config.openapi.json` 是流程配置骨架；`quality-check-run.openapi.json` 是 tenant 侧 `CheckDebugRun` 骨架（`createCheckDebugRun`）；`check-run-log.openapi.json` 的 `POST /api/tenant-admin/v1/quality-ops/check-tasks`（`createCheckTask`）描述为「骨架占位 · 未实现」，必填是 `inputVersionId`、`configVersionId`、`executionMode`，没有材料字段。三份契约 `info.description` 均写「骨架 · 后端未实现 · 勿当 Live」。`apps/api/src/main` 无这些 operation 的 Java 控制器。`data-version-readonly` 是员工只读，不得当提交。因此提交口标 **【待补-提交口】**，**fail closed**。禁止新造返回「检查通过」、201 成功或假 Live 的 API。  
> **脚注（前门闸）**：放行只认 `GET /api/tenant-admin/v1/opened-capabilities` 的 `items` 里有 `enterpriseFunction=quality-check`。该读口经 `CapabilityCatalogPort`。#41 已合 348cafc，生产 CapabilityCatalogPort=GrantCatalogAdapter，Empty 已删。第四端开通后工作台会显示三步。禁止前端或 `qualityops` 直读 `qo_capability_tenant_grant` / `qo_capability` 来放行。A/B 合入前按钮保持灰色。

### 架构已裁

1. **页 path 钉死。** 只改现页 `/workspace/#tenant=<企业ID>&view=quality-check`（`QualityCheck`）。三步标题保持。风格、动效、壳子跟随现 workspace，不另起页面，不换肤，不复用旧 `admin/governance` 页 id。进入已由 #35 接上，本单不重做登录、不重做读口客户端。
2. **提交口【待补-提交口】，fail closed。** 不新增、不调用下列 path，也不把它们的 200/201/501 显示成提交成功或「检查通过」：
   - `POST /api/tenant-admin/v1/quality-ops/check-tasks`
   - `POST /api/tenant-admin/v1/quality-ops/check-debug-runs` 及其 cancel
   - `POST /api/tenant-admin/v1/quality-ops/config-versions` 及其 publish / rollback
   - `POST /api/agent-admin/v1/tenants/{tenantId}/grants`
   - `POST /api/agent-admin/v1/capabilities`
   - 任何新的 `/api/v1/**`、`/api/tenant-admin/**`、`/api/workspace/**` 质量检查提交
   不新增文件选择，不 `FormData`，不把材料写入 `localStorage` / 内存名单。按钮保持 `disabled`。已开通时可见句保持：「暂时不能提交检查材料（执行服务尚未接通）」「暂时不能查看处理结果（执行服务尚未接通）」。说明句保持：「材料提交与结果读取尚未接通。」
3. **前门闸只走读口。** 未登录沿用现登录墙。读口失败沿用 `openedCapabilitiesFailureTitle`。`items` 不含 `quality-check`（含 `[]`、只有别的功能）→ 现句「本企业尚未开通此 AI 功能」与「请联系企业管理员确认，开通后再进入。」不渲染提交按钮，不落材料。`items` 含 `quality-check` 只表示可以**看见**这三步。#41 已合 348cafc，生产 CapabilityCatalogPort=GrantCatalogAdapter，Empty 已删。第四端开通后工作台会显示三步。A/B 合入前按钮保持灰色，禁假提交、禁假结果。
4. **R-B8-2。** 本单不新增 `qualityops` 类。若 diff 碰到该包：只许经已有 `CapabilityCatalogPort`，禁止 `import` `agentadmin` / `agentregistry`，禁止 SQL `qo_capability`、`qo_capability_tenant_grant`、`qo_module_version`、`qo_admission_test_record`。禁止把授权表读进工作台。
5. **禁假成功。** 界面不得出现「检查通过」「已提交」「处理完成」「Live」。不得把骨架 501、空列表、开通 POST 的 201 说成检查完成。不得 toast。结果区保持诚实空态，不插入结果行。
6. **非范围。** 开通写（CT-040，已合，勿改）、开通按钮（CT-042）、CT-041 换 adapter、grants GET、登记 POST、parser / engine 大改、模块版本、假演示包上传、精致结果页。

#### 现页句（整句照抄，不要改写）

| 场景 | 可见句 |
|---|---|
| 读口 `items` 含 `quality-check` | 按钮「提交检查材料」保持禁用。旁句「暂时不能提交检查材料（执行服务尚未接通）」。结果「暂时不能查看处理结果（执行服务尚未接通）」 |
| 读口 200 且不含 `quality-check` | 「本企业尚未开通此 AI 功能」 |
| 读口失败 | 沿用现 `openedCapabilitiesFailureTitle`，不新造「检查通过」 |

## ① 目标与范围

- **目标**：E2 三步在现页上可点开。进入沿用 #35。提交与结果在【待补-提交口】下 fail closed：未开通人话拒绝且不落材料；已出现在读口里也不假成功。
- **增量边界**：
  1. 不新 API，不启用按钮，不上传。
  2. 新测试锁住：无 POST、无「检查通过」、未开通无提交钮、读口含质量检查时钮仍禁用且两句诚实空态还在。
  3. 现页若已被改成可点或出现成功句，恢复为上表，不要改去接骨架。
- **改哪些文件（允许）**：
  - `tests/e2e/ct043-quality-check-min-submit.spec.ts`（新建）
  - `src/identity/QualityCheck.tsx`（仅当要恢复上表原句与 `disabled`；禁止加请求）
- **不做什么**：见架构已裁第 6 条。

## ② 前置条件与分支名

- **⓪ 暂停令自查（第一步）**：有或拿不准 → 立刻停，问 DQ。
- **依赖**：#35 接真已在 main（`7fa4946`）。CT-039 读口已合（`701c3ca`）。CT-040 **实现已合**（`ea6e827`），本单仍不调用开通 POST。CT-041 执行单已合（`a514be5`），其实现未合，不挡本单的 fail closed。CT-042 执行单已合（`23da838`），本单不改那颗钮。
- 正确仓：`~/Desktop/mengine-app-luofanghao9784`（origin=`luofanghao9784/mengine-app`）。
- 正式岗 id=`ec838a2d-d838-48cd-a789-e1af1424a7f3`。

```bash
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || { echo 'ERROR: 错误 remote，停'; exit 1; }
git status
git switch main && git pull
git merge-base --is-ancestor ea6e827 HEAD || { echo 'ERROR: main 不含 CT-040 实现，停'; exit 1; }
git merge-base --is-ancestor 23da838 HEAD || { echo 'ERROR: main 不含 CT-042 执行单，停'; exit 1; }
git merge-base --is-ancestor 7fa4946 HEAD || { echo 'ERROR: main 不含 #35 接真，停'; exit 1; }
test -f src/identity/QualityCheck.tsx || { echo 'ERROR: 找不到质量检查现页，停'; exit 1; }
test -f apps/api/src/main/java/com/dreamcore/workspace/capability/adapter/GrantCatalogAdapter.java || { echo 'ERROR: GrantCatalogAdapter 不在，停'; exit 1; }
echo 'OK: #41 已合 348cafc，生产 CapabilityCatalogPort=GrantCatalogAdapter，Empty 已删'
git grep -n "createCheckTask\|createCheckDebugRun" -- apps/api/src/main '*.java' && { echo 'ERROR: 骨架已被实现，停，问 DQ。禁止把该 path 接成检查通过'; exit 1; }
echo 'OK: 无检查任务/调试 Java 控制器，提交口维持【待补-提交口】'
git switch -c codex/ct-043-workspace-quality-check-min-submit
```

## ③ 完整 Codex 提示词

把下面整段交给 Codex（`$CODEX`，模型 `gpt-6.1-sol`，思考强度 **high**；本机若是 `gpt-5.1-codex` 亦可）：

```
你在梦擎仓库分支 codex/ct-043-workspace-quality-check-min-submit 上工作。只做本单范围。执行单：docs/codex-tasks/CT-043-workspace-quality-check-min-submit.md。
正式岗 id=ec838a2d-d838-48cd-a789-e1af1424a7f3。勿派重复岗。
基准 origin/main 须含 ea6e827（CT-040 实现 #38）。对照：src/identity/QualityCheck.tsx、src/admin/openedCapabilities.ts、docs/codex-tasks/CT-039-tenant-opened-capabilities-readonly.md、docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md（R-B8-2）、docs/codex-tasks/QUEUE.md 编制·前端开发硬性第 6 条。
文案同时对照：《全端文案规范》https://www.notion.so/40966c386fbf8120aaefc0290f9dedb8 ；去黑话 https://app.notion.com/p/40966c386fbf81f3a2e3e1822ae6a9b9 ；体验落部 https://app.notion.com/p/40966c386fbf8142b0bbcb16d1876e8f 。
可见文案禁止裸用 seed、capability、Capability、Grant、admission。禁止出现「检查通过」。
两周挂靠：docs/codex-tasks/两周日切片-三轨并行-20261031.md。本单是 E2 的提交与结果。不是 CT-042 开通按钮，不是 CT-040 开通写，不是 CT-041 换 adapter。

【已裁】
1. 页 path 只许 /workspace/#tenant=<企业ID>&view=quality-check。三步标题保持「① 进入说明」「② 提交检查材料」「③ 处理结果」。不新页面，不换肤，不复用 admin/governance。
2. 提交口是【待补-提交口】，fail closed。不要实现或调用 POST /api/tenant-admin/v1/quality-ops/check-tasks、check-debug-runs、config-versions，不要调用 POST /api/agent-admin/v1/tenants/{tenantId}/grants，不要新造提交 API。这些骨架的 200/201/501 都不是提交成功。不要文件选择，不要 FormData，不要 localStorage。按钮保持 disabled。
3. 前门闸只认 GET /api/tenant-admin/v1/opened-capabilities（CapabilityCatalogPort）。items 不含 quality-check：显示「本企业尚未开通此 AI 功能」，不渲染「提交检查材料」按钮，不落材料。items 含 quality-check：只显示三步，按钮仍禁用，旁句整句「暂时不能提交检查材料（执行服务尚未接通）」，结果整句「暂时不能查看处理结果（执行服务尚未接通）」。#41 已合 348cafc，生产 CapabilityCatalogPort=GrantCatalogAdapter，Empty 已删。第四端开通后才会出现三步。不要直读 qo_capability_tenant_grant 或 qo_capability。A/B 合入前按钮保持灰色，人话继续用「暂时不能提交检查材料（执行服务尚未接通）」。禁假提交、禁假结果。
4. 本总单不要新增 qualityops 类。后端部分由 CT-043-A 子单放开，范围见 A。不要 import agentadmin 或 agentregistry。不要 SQL 授权表或登记表。不要改 OpenedCapabilitiesController、CapabilityCatalogPort、GrantCatalogAdapter。
5. 禁止「检查通过」「已提交」「处理完成」「Live」和 toast。不要插入结果行。
6. 非范围：开通写、开通按钮、CT-041、grants GET、登记 POST、parser、engine、契约、迁移。

【要做成】
1. 新建 tests/e2e/ct043-quality-check-min-submit.spec.ts。夹具可对照 tests/e2e/ct036-empty-shell.spec.ts，用合成身份和拦截，不要打真实开通或真实模型。
2. 覆盖：读口 items 含 quality-check 时三步可见、按钮 disabled、两句诚实空态可见、全文无「检查通过」、请求里没有 POST，也没有 check-tasks / check-debug-runs / config-versions / grants。
3. 覆盖：items 为 []，以及 items 只有 document-parse：标题「本企业尚未开通此 AI 功能」，提交按钮数量为 0，无 POST。
4. 若 QualityCheck.tsx 已是上述句子和 disabled，不要为了有 diff 去改它。若它已可点或已写成功句，只恢复执行单表格里的原句和 disabled，不要改去接 API。
5. npm run build 须过。跑本文件与 ct036 的 playwright。禁止 -DskipTests。

【不许碰】
apps/api/**、contracts/**、engine/**、workers/parser/**、src/features/agent-admin/**、src/admin/OpenedFunctions.tsx、Flyway、AgentAdminSecurity、登录端点、force push、reset --hard、直推 main、gh issue、口令入库。
禁止恢复 CapabilityRegistryStubSecurity。
禁止改 Java 包名 dreamcore、/mengine-api、MENGINE_*。

【验收】
打开 http://127.0.0.1:50832/workspace/#tenant=<企业ID>&view=quality-check （端口以预览实测为准）。
读口没有质量检查：看见「本企业尚未开通此 AI 功能」，没有提交按钮，网络面板无材料 POST。
读口有质量检查：看见三步；「提交检查材料」不可点；看见「暂时不能提交检查材料（执行服务尚未接通）」和「暂时不能查看处理结果（执行服务尚未接通）」；没有「检查通过」。

【做完输出】git diff --stat、确认没有新 API、没有 POST、按钮仍 disabled、没有改 V193、没有改开通按钮、没有「检查通过」。
```

## ④ 推荐模型与思考强度

- 模型：`gpt-6.1-sol`（与 CT-040 / CT-042 相同；本机若是 `gpt-5.1-codex` 亦可）
- 思考强度：**high**（把骨架 501 或开通 201 当成检查通过、或直读授权表绕过空读口，都会把 E2 做成假成功）
- **预计耗时**：Codex 20–40 分钟；`npm run build` 与专项浏览器 15–25 分钟

## ⑤ 可复制 git 步骤（跑完如何提交）

```bash
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || exit 1
git add tests/e2e/ct043-quality-check-min-submit.spec.ts src/identity/QualityCheck.tsx
git diff --cached --stat | grep -E 'apps/api|contracts/|engine/|workers/parser|agent-admin|OpenedFunctions|V193__' && echo 'ERROR: 禁区' && exit 1
git commit -m "$(cat <<'EOM'
test(workspace): CT-043 质量检查提交保持诚实空态

工作台质量检查仍不提交材料。未开通只显示人话，不落材料。
读口已含质量检查时按钮仍不可用，不显示检查通过。
EOM
)"
git -c http.proxy= -c https.proxy= push origin codex/ct-043-workspace-quality-check-min-submit
gh pr create -R luofanghao9784/mengine-app --base main --head codex/ct-043-workspace-quality-check-min-submit \
  --title "test(workspace): CT-043 质量检查最小提交诚实空态" \
  --body "## 摘要
工作台现页「质量检查」维持三步。提交口仍是【待补-提交口】，fail closed。未开通显示「本企业尚未开通此 AI 功能」，不落材料。读口含质量检查时按钮仍禁用，结果区仍是执行服务尚未接通。没有「检查通过」。

## 可演示
- http://127.0.0.1:50832/workspace/#tenant=<企业ID>&view=quality-check
- 前门闸只看 GET /api/tenant-admin/v1/opened-capabilities

## 验收句
E2 的提交与结果。不是 CT-040 开通写，不是 CT-042 开通按钮，不是 CT-041 换读源。

## 审查
- 发布验收 + 质量性能 + 架构逻辑 + 安全审查
- 正式岗 id=ec838a2d-d838-48cd-a789-e1af1424a7f3
- 不得直读授权表，不得新造成功 API
- 勿自动合并"
```

网页备用：https://github.com/luofanghao9784/mengine-app/compare/main...codex/ct-043-workspace-quality-check-min-submit

## ⑥ 验收标准

日可演示（Mac `127.0.0.1`，端口以预览为准；约定目标 web=`50832`）：`/workspace/#tenant=<企业ID>&view=quality-check`。

| # | 标准 | 如何验 |
|---|---|---|
| E2-1 | 进入 | #35 的现页仍在。三步标题可见（读口含 quality-check 时） |
| E2-2 | 未开通不落材料 | `items` 为 `[]` 或不含 `quality-check` →「本企业尚未开通此 AI 功能」。无提交按钮。无 POST。无文件 |
| E2-3 | 已开通仍诚实 | `items` 含 `quality-check` → 按钮 disabled，两句「执行服务尚未接通」都在。无「检查通过」，无结果行 |
| G1 | 无假 path | 网络面板无 check-tasks、check-debug-runs、config-versions、grants、capabilities 的 POST |
| G2 | 前门闸 | 只出现既有 `GET /api/tenant-admin/v1/opened-capabilities`。无授权表查询，无登记表查询 |
| G3 | 读口失败 | 404/500/网络错误沿用现人话，不出现检查通过，无提交按钮 |
| G4 | R-B8-2 | diff 无新 `qualityops` 类；无 `agentadmin` / `agentregistry` import；无授权表 SQL |
| G5 | 边界 | 无 `apps/api`、契约、迁移、engine、parser、agent-admin diff。V193 无 diff |
| G6 | 文案 | 可见句无裸术语。成功类句子数量为 0 |
| G7 | build | `npm run build` 通过。`npx playwright test tests/e2e/ct043-quality-check-min-submit.spec.ts tests/e2e/ct036-empty-shell.spec.ts` 通过 |

## ⑦ 禁止操作 / 失败卡住

| 症状 | 动作 |
|---|---|
| remote 不是 mengine-app | 立刻停 |
| 有暂停令 | 不开 Codex；问 DQ |
| main 不含 `ea6e827` | 停；先拉含 CT-040 实现的 main。拉到之后仍然不要调用开通 POST |
| Java 里出现 `createCheckTask` 或 `createCheckDebugRun` | 停，问 DQ。不要接成检查通过 |
| 看不到 GrantCatalogAdapter | 停。#41 已合 348cafc，生产 CapabilityCatalogPort=GrantCatalogAdapter，Empty 已删。不要改成直读 `qo_capability_tenant_grant` |
| 界面出现「检查通过」或按钮可点并发出 POST | **打回** |
| 未开通仍上传或写入材料 | **打回** |
| 用开通 201 或骨架 501 当检查完成 | **打回** |
| `qualityops` import 了 `agentadmin` / `agentregistry`，或 SQL 了授权表/登记表 | **打回** |
| 改了开通按钮、V193、契约或 parser | `git restore`；报 DQ |
| build 或本单 playwright 红 | 修到绿；禁止 `-DskipTests` |
| CONFLICT / push rejected | rebase 一次；仍失败停 |

**硬禁止**：

- 本总单新造提交 API。后端 `createCheckTask` 只由 CT-043-A 放开。A/B 合入前按钮保持灰色，人话继续用「暂时不能提交检查材料（执行服务尚未接通）」。禁假提交、禁假结果
- 未开通时落材料；已开通时显示「检查通过」或假 Live
- 直读 `qo_capability_tenant_grant` / `qo_capability` 绕过 `opened-capabilities` 与 `CapabilityCatalogPort`
- 把本单做成 CT-040 开通写、CT-042 开通按钮或 CT-041 换 adapter
- 改 parser、engine、V193、`permitAll`
- `git push --force`、`git reset --hard`、直推 `main`
- 改包名、改 `/mengine-api`、改 `MENGINE_*`
- `gh issue`；口令进仓库
- 有暂停令仍开 Codex

回滚（未合入）：`git switch main && git branch -D codex/ct-043-workspace-quality-check-min-submit`。

---

**DQ 审路径**：本文件「架构已裁」+【待补-提交口】脚注 + 前门闸只走 `GET /api/tenant-admin/v1/opened-capabilities`。CT-040 实现已合 `ea6e827`，不得因此改成直读授权表或假成功。通过后交老板 / 正式前端岗 Mac 粘贴③开跑。安全审查必看：未开通不落材料；`qualityops` 不 SQL 授权表。总负责人不代跑。
