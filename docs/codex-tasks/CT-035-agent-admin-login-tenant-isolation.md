# CT-035 正式登录 + 租户隔离（第四端独立会话）

状态：架构已裁可跑 · 待 docs 入库后交老板 Mac Codex　｜　分支：`codex/ct-035-agent-admin-login-tenant-isolation`　｜　**审查人（PR 后）：架构逻辑 + 安全审查 + 质量性能**（登录 / 会话 / cookie 必加安全审查）　｜　基准：切单时最新 `origin/main`（本单开出时 `e339056`，含 CT-038 `#15`；开跑前再 `git pull`）

> **日切片：2026-11-03～11-04（D4～D5）/ 可演示点**：四端可登；第四端只走 `/api/agent-admin` + cookie `DREAMCORE_AGENT`；错账密人话；登出干净；跨域 cookie **401**；未登录写 **401**；已登录写请求未知字段 **400**。  
> **挂靠**：两周日切片 D4～D5·轨 A；`docs/codex-tasks/两周日切片-三轨并行-20261031.md`；终签 **L1–L4**（+ 隔离，不对齐成 CT-036 的 E1–E4）。  
> **总负责人不代跑**；老板/后端岗在 Mac 自跑 Codex。Codex 尽量用。  
> **非范围**：CT-038 人话替换、CT-036 企业侧/工作台消费已开通、假 Live 名单。

规格依据：

- ADR-B8 **D8-2 / D8-3**：`docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md`
- 终签 L1–L4：[两周主路径验收句](https://www.notion.so/40966c386fbf81ad97cff544bc2906ff)
- 人话句 L35-1～8（错账密主文案钉死）：[CT-035/036 人话验收句](https://www.notion.so/40966c386fbf811a8a68f00cb5ac8a77)
- 先例：`PlatformIdentity.java`、`PlatformSecurity.java`（`securityMatcher("/api/platform-admin/**")` `@Order(1)`）、`V55__platform_identity_sessions.sql`
- 现状：`src/identity/session.tsx` 的 `agentIdentityClient.login/logout` 仍抛「后端未就绪」；`contracts/public-api/capability-registry.openapi.json` 的 `Capability` **没有** `enterpriseFunction`（闭集枚举已在 `EnterpriseFunction`，挂在 `CapabilityModuleVersion`）；`additionalProperties: false` 已在，但登记 POST 未见 **400**
- 错误形状：`contracts/public-api/error.schema.json`（`contractVersion` / `code` / `message` / `retryable`）

### 架构已裁（本岗；DQ 可覆）

下列四条与 D8-2 / D8-3 一起执行，提示词③须原文照做。

1. **API 前缀是 `/api/agent-admin`，不是 platform-admin。** 登录、会话、`me`、登记写全部在 `/api/agent-admin/v1/**`。禁止新开 `/api/platform-admin/v1/**` 充当第四端登录或能力登记。页面入口仍是 `/agent-admin/`（D8-3）。
2. **`DREAMCORE_AGENT` + 独立 `SecurityFilterChain`，不挂客户 `IdentitySecurity`。** 新链 `securityMatcher("/api/agent-admin/**")`，Order 与平台链同级且先于客户兜底链；cookie 名 `DREAMCORE_AGENT`，`Path=/api/agent-admin/`，HttpOnly、SameSite=Strict，Secure 随 `request.isSecure()`（与 `PlatformIdentity` 同构，本机 http 预览不被字面 Secure 卡死；生产 HTTPS 必须 Secure）。与 `DREAMCORE_SESSION`、`DREAMCORE_PLATFORM` 两两不同，启动期拒绝同名。**不**把第四端 matcher / `permitAll` 写进客户 `IdentitySecurity`。持平台 cookie、客户 cookie 或总部支持会话访问 `/api/agent-admin/**` **一律 401**；持 `DREAMCORE_AGENT` 访问 `/api/platform-admin/**` 与客户 `/api/v1/**` **一律 401**。
3. **未登录写 401。** 至少 `POST /api/agent-admin/v1/capabilities`：无第四端会话必须 **401** + 人话 JSON。禁止 `CapabilityRegistryStubSecurity`（或等价）对登记 POST 继续 `permitAll` 后返回 501/201。已登录但本单仍不落库时，可维持 CT-034 诚实 **501**；**禁止无落库 201**。未登录时先 401，不做字段校验（垃圾 body 也是 401）。
4. **OpenAPI `Capability` 补 `enterpriseFunction` 闭集（演示只用 `quality-check`）；`additionalProperties: false` 下未知字段 400。** 在 `contracts/public-api/capability-registry.openapi.json` 的 `Capability` 上增加 `enterpriseFunction`，`$ref` 已有 `EnterpriseFunction` 闭集（`document-parse`、`table-compare`、`quality-check`、`semantic-annotation`、`repair-suggestion`），**不新增第六值**。登记请求将该字段视为必填。`additionalProperties` 保持 `false`。已登录写请求若带未声明字段，运行时 **400** + 人话（禁止 Jackson 忽略未知字段后当成功，禁止裸英文堆栈）。闭集外字符串同样 **400**。闭集内预留未启用值（`semantic-annotation`、`repair-suggestion`）若做到登记语义，仍按 ADR **422** `ENTERPRISE_FUNCTION_NOT_ENABLED`，不要改写成 400。演示样例只使用 `quality-check`。补上登记 POST 的 **400** 响应，勿宣称全 Live。

其余裁（D8-2 / D8-3，与上四条同时有效）：

5. **`AGENT_ADMIN` 与 `PLATFORM_ADMIN` 独立，互不包含。** 只持 `PLATFORM_ADMIN` 不能进入第四端。租户账号一律不能登录第四端。同一人可被授予两角色，但**凭据表不共用**。
6. **独立会话表，不加 realm 列。** 新迁移（只增不改 V55 文件）建 `agent_platform_accounts`、`agent_platform_sessions`，照 V55。表名暂定，PR 写明。触发器：agent 账号不得成为租户成员；`agent_platform_accounts` BEFORE INSERT 拒绝已在 `platform_accounts` 的账号，反向同理。级联吊销只作用于本域：撤销 `AGENT_ADMIN` 只删 `agent_platform_sessions`；撤销 `PLATFORM_ADMIN` 只删 `platform_sessions`。新迁移可用 `CREATE OR REPLACE` 把「删除任意 `platform_roles` 就清空 `platform_sessions`」收窄为仅 `role='PLATFORM_ADMIN'`，**不改 V55 文件**。恢复角色不复活旧会话。令牌哈希只用 `IdentityService.hash`；CSRF 照 `hash("csrf:"+token)` + 常量时间比较，不得另写一套。校验 SQL 只查 `agent_platform_sessions` 且账号当前持 `AGENT_ADMIN`，授予 `ROLE_AGENT_ADMIN`。
7. **`platform_roles.role` 现 CHECK 只有 `PLATFORM_ADMIN`。** 新迁移放宽为允许 `AGENT_ADMIN`（约束名以库内实际名为准）。授予/撤销沿用 `PlatformStaffService` 与 `management_version` 递增。首个 `AGENT_ADMIN` 只种一次，其余经授予。**口令不进 git。**
8. **第四端会话没有租户，不构造 `ExecutionScope`。** 租户只是被管理对象。总部支持会话不能进入第四端。A 企业会话看不到 B 企业的成员或数据。
9. **人话**：错账密 `message` 钉死「账号或密码不对，请再试一次」。无权限「这个账号没有这里的权限」，并给可恢复动作（换账号或去对应入口）。未登录写「还没有登录，暂时不能保存」。未知字段「有无法识别的字段，请去掉后再试」。不白屏、不甩堆栈、不在错误体里带出别的企业名称或数据。
10. **前端只接登录墙。** `agentIdentityClient.login/logout` 改为真请求（路径已是 `/api/agent-admin/v1/auth/login|logout|me`）；`CHANGE_KEY` 保持 `dreamcore-agent-session-change`；登出只清本域。未登录不得直接看到已登录壳。**不改** CT-038 已合的导航/分区/按钮文案，不改探针去伪造已连接。

## ① 目标与范围

- **目标**：第四端正式登录与租户隔离可验收（L1–L4）：独立 cookie、独立过滤链、跨域 401、未登录写 401、`Capability.enterpriseFunction` 闭集与未知字段 400。
- **增量边界（只做这些）**：
  1. 第四端身份：cookie、过滤链、登录/登出/`me`/csrf、角色、两张会话表与跨域触发器。
  2. 未登录写 401；收掉登记 POST 上的 StubSecurity 开放链。已登录不落库则诚实 501。
  3. OpenAPI `Capability` 补 `enterpriseFunction` 闭集；已登录未知字段 400（运行时 + 契约 400）。
  4. 最小登录墙，使人话错误与登出可点开。
  5. 集成测试覆盖跨域 401、错账密人话、登出、跨租户不可见、未知字段 400、未登录写 401。
- **改哪些文件（允许）**：
  - `apps/api/src/main/java/com/dreamcore/**`（新链与登录；**禁止改包名**）
  - `apps/api/src/test/java/com/dreamcore/**`
  - `apps/api/src/main/resources/db/migration-common/` **新**迁移（三处目录里现有最大版本之后的下一个空号；本单开出时最大为 V189，以开跑时 `ls` 为准；勿占用已出现的 `qo_*` 号）
  - `contracts/public-api/capability-registry.openapi.json`（只补 `Capability.enterpriseFunction`、400、实现状态注记）
  - `src/identity/session.tsx`（替换 agent login/logout 桩）
  - 登录墙：`src/identity/main.tsx` 和/或 `src/features/agent-admin/` 内薄封装（未登录出登录卡；**不改** CT-038 可见文案与 hash）
- **不做什么（非范围）**：
  - **CT-038**：不重写 agent-admin 导航/分区/按钮人话，不改 `#view=` / `capability-registry` 路由键
  - **CT-036**：不做企业侧/工作台「用上已开通」、质量检查提交、E1–E4 主路径 UI
  - **假 Live**：禁止假已上架列表、假成功 toast、无落库 201、探针改成真连接
  - 不实现上架/开通/四眼 RETIRE 完整态机；不构造 `ExecutionScope`；不调用 qualityops 执行/发布
  - 不改 `/mengine-api`、`MENGINE_*`、Java 包名；远程仓 **`luofanghao9784/mengine-app`**

## ② 前置条件与分支名

- **⓪ 暂停令自查（第一步）**：有或拿不准 → **立刻停**，问 DQ。
- 正确仓：`~/Desktop/mengine-app-luofanghao9784`（origin=`luofanghao9784/mengine-app`）。
- 依赖：main 上已有 agent-admin 壳与 `Capability` 骨架。CT-034 若已合，本单把未登录写从 501 改成 401，并拆掉开放链；未合也不另开 platform-admin 路径。

```bash
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || { echo 'ERROR: 错误 remote，停'; exit 1; }
git status
git switch main && git pull
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export POSTGRES_BIN="$(brew --prefix postgresql@18)/bin"
git switch -c codex/ct-035-agent-admin-login-tenant-isolation
```

## ③ 完整 Codex 提示词

把下面整段交给 Codex（模型 `gpt-6.1-sol`，思考强度 **high**）：

```
你在梦擎仓库分支 codex/ct-035-agent-admin-login-tenant-isolation 上工作。基准 origin/main。只做本单范围。执行单全文：docs/codex-tasks/CT-035-agent-admin-login-tenant-isolation.md。
ADR-B8 D8-2/D8-3：docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md。
终签 L1–L4：平台账号可登 platform-admin 与 agent-admin；企业负责人登 tenant-admin、员工登 workspace；错账密/无权限短人话；登出后再登看不到上一账号。错账密主文案钉死「账号或密码不对，请再试一次」。
先例：PlatformIdentity、PlatformSecurity（securityMatcher /api/platform-admin/** 、@Order(1)）、V55 会话表。客户兜底链在 IdentitySecurity，第四端不得挂上去。
契约：contracts/public-api/capability-registry.openapi.json。现状 Capability 无 enterpriseFunction；EnterpriseFunction 闭集已存在。错误形状 contracts/public-api/error.schema.json。
前端桩：src/identity/session.tsx 的 agentIdentityClient.login/logout 仍抛「后端未就绪」，me 已指向 /api/agent-admin/v1/auth/me。

【强制口径 · 架构裁定，四条都要落地】
1. API 前缀 `/api/agent-admin`，不是 platform-admin。登录、me、登出、csrf、登记写都在 `/api/agent-admin/v1/**`。禁止新写 `/api/platform-admin/v1/**` 当第四端。
2. Cookie 名 `DREAMCORE_AGENT`，Path=/api/agent-admin/，HttpOnly，SameSite=Strict，Secure 随 request.isSecure()。独立 SecurityFilterChain：securityMatcher("/api/agent-admin/**")，Order 先于客户兜底链。不要把第四端路由或 permitAll 写进客户 IdentitySecurity。跨域 401：平台 cookie、客户 cookie、总部支持会话访问 /api/agent-admin/** 一律 401；DREAMCORE_AGENT 访问 /api/platform-admin/** 与客户 /api/v1/** 一律 401。三枚 cookie 名两两不同，启动期拒绝同名。
3. 未登录写 401。POST /api/agent-admin/v1/capabilities 无第四端会话必须 401 + 人话 JSON（建议 message「还没有登录，暂时不能保存」）。垃圾 body 也先 401，不要先 400。禁止 StubSecurity（或等价）对登记 POST permitAll + csrf.disable 后返回 501 或 201。已登录且本单不落库则诚实 501；禁止无落库 201。
4. OpenAPI Capability 补 enterpriseFunction 闭集，演示只用 quality-check。$ref 已有 EnterpriseFunction（document-parse、table-compare、quality-check、semantic-annotation、repair-suggestion），不要加第六值。登记请求该字段必填。additionalProperties 保持 false。已登录写请求出现未声明字段必须 400 + 人话「有无法识别的字段，请去掉后再试」，禁止反序列化时丢掉未知字段。闭集外字符串 400。预留未启用值若做到登记语义仍 422 ENTERPRISE_FUNCTION_NOT_ENABLED。给 registerCapability 补 400 响应。info.description 可注「CT-035：登录隔离；Capability.enterpriseFunction 已补；勿当全 Live」。

【A. 身份与会话】
1. 新表 agent_platform_accounts、agent_platform_sessions（照 V55，不在旧会话表加 realm 列）。新迁移只放 migration-common，版本号取三处迁移目录最大号 + 1，不改已有迁移文件。
2. platform_roles 允许 AGENT_ADMIN，与 PLATFORM_ADMIN 互不包含。只持 PLATFORM_ADMIN 登录第四端 → 401，人话「这个账号没有这里的权限」。租户账号登录第四端同样 401 + 该人话。
3. 凭据不共用：agent_platform_accounts 拒绝已在 platform_accounts 的 account_id，反向同理。演示用两个合成账号，不要合成一条共享口令。口令不进提交。
4. 吊销：删 AGENT_ADMIN 只删 agent_platform_sessions；删 PLATFORM_ADMIN 只删 platform_sessions。若现有触发器「任意角色删除都清 platform_sessions」，用新迁移 CREATE OR REPLACE 收窄，不编辑 V55 文件。恢复角色不复活旧会话。
5. 哈希只用 IdentityService.hash；CSRF 照平台链 hash("csrf:"+token) + 常量时间比较。校验只查 agent_platform_sessions 且当前持 AGENT_ADMIN，授予 ROLE_AGENT_ADMIN。
6. 端点与平台链同构：GET .../auth/csrf、POST .../auth/login、POST .../auth/logout、GET .../auth/me。错账密 401，message 恰好「账号或密码不对，请再试一次」。
7. 第四端不构造 ExecutionScope，会话里没有租户。总部支持会话进第四端 401。

【B. 租户隔离】
- 合成企业 A/B。A 的客户会话 me/名单不得含 B 的企业名、成员或数据；跨企业读失败且人话诚实，错误体不泄露对方数据。
- 不做 CT-036 的「质量检查」消费 UI。授权表若尚未在 main，不要造假 Live 目录冒充「未开通看不到」；用现有租户作用域读证明 A≠B，并在 PR 写明 grant UI 归 CT-036。

【C. 前端登录墙（薄）】
- session.tsx：agent login/logout 改为真 POST，沿用 createIdentityRequest（自带 CSRF），不要另写哈希。CHANGE_KEY 仍是 dreamcore-agent-session-change。登出只清 agent 域。
- 未登录渲染登录卡，已登录才进现有 AgentAdminApp。风格靠近总台登录卡，勿新皮肤。登录失败展示服务端 message。
- 不改 CT-038 导航/分区/按钮、不改 hash、不改 probeCapabilities 去假装已连接，不 import src/demo/。

【D. 测试】
- 第四端登录 Set-Cookie 名为 DREAMCORE_AGENT 且 Path=/api/agent-admin/。
- 跨域互访 401（平台↔第四端、客户→第四端）。
- 未登录 POST /api/agent-admin/v1/capabilities → 401，不是 501/201/无路由 404。
- 已登录 POST 带未知字段 → 400，message 为人话；enterpriseFunction=quality-check 能被识别（不落库则为 501，禁止 201）。
- 错账密 message 全等「账号或密码不对，请再试一次」。
- 登出后 me 为 401，且平台/客户 cookie 仍在。
- A 看不到 B。
- 禁止 -DskipTests 掩盖本单。

【不许碰】
CT-038 文案与路由键、CT-036 企业侧消费与质量检查提交、假 Live / 假已上架、engine/** 业务大改、workers/parser、dist/** 手改、.local/**、口令、force push、reset --hard、直推 main、gh issue。
禁止改 Java 包名 dreamcore、/mengine-api、MENGINE_*。禁止把第四端挂进客户 IdentitySecurity。禁止 /api/platform-admin 新登录路径。

【本地验收（预览 api=50831、web=50832；以实测为准）】
# 未登录写：401，不是 404/501/201
curl -si -X POST "http://127.0.0.1:50831/api/agent-admin/v1/capabilities" \
  -H "Content-Type: application/json" \
  -d '{"capabilityId":"quality-check","name":"质量检查","enterpriseFunction":"quality-check"}'

# 错账密：401，message=账号或密码不对，请再试一次（先取 csrf，按平台登录同构带头）
# 已登录未知字段：400（多一个未声明字段）；enterpriseFunction 用 quality-check
# 跨域：把 DREAMCORE_PLATFORM 或 DREAMCORE_SESSION 打到 /api/agent-admin/v1/auth/me → 401

页面：http://127.0.0.1:50832/agent-admin/ 未登录见登录卡；错账密见钉死文案；登出后再登无上一账号企业名。
http://127.0.0.1:50832/platform-admin/ 与 /tenant-admin/ 、/workspace/ 仍可登，cookie 不互通。

【做完输出】git diff --stat、过滤链类名与 Order、cookie 属性、迁移版本号、未登录写与未知字段的实测状态码、SKIP（含 CT-036）、是否仍无落库 201。
```

## ④ 推荐模型与思考强度

- 模型：`gpt-6.1-sol`
- 思考强度：**high**
- 本机没有该模型 id 时停，问 DQ，不要擅自换成别的模型。
- **预计耗时**：Codex 60–120 分钟；迁移 + 测试 + curl 30–50 分钟

## ⑤ 可复制 git 步骤（跑完如何提交）

```bash
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || exit 1
git add apps/api/src/main apps/api/src/test \
  contracts/public-api/capability-registry.openapi.json \
  src/identity/session.tsx src/identity/main.tsx src/features/agent-admin
git diff --cached --stat | grep -E 'workers/parser|src/demo/' && echo 'ERROR: 禁区' && exit 1
git commit -m "$(cat <<'EOM'
feat(agent-admin): CT-035 第四端登录与租户隔离

独立 cookie DREAMCORE_AGENT 与 SecurityFilterChain；跨域与未登录写 401。
Capability 补 enterpriseFunction 闭集；未知字段 400。不接假 Live。
EOM
)"
git push -u origin codex/ct-035-agent-admin-login-tenant-isolation
gh pr create -R luofanghao9784/mengine-app --base main --head codex/ct-035-agent-admin-login-tenant-isolation \
  --title "feat(agent-admin): CT-035 正式登录与租户隔离" \
  --body "## 摘要
第四端登录走 /api/agent-admin + DREAMCORE_AGENT 独立过滤链（不挂客户 IdentitySecurity）。跨域 401，未登录写 401。Capability 补 enterpriseFunction 闭集（演示 quality-check），未知字段 400。

## 验收
- L1–L4：四端可登、错账密人话、登出干净、跨租户不可见
- 未登录 POST /api/agent-admin/v1/capabilities → 401
- 已登录未知字段 → 400

## 审查
- 架构逻辑 + 安全审查 + 质量性能
- 勿自动合并

## 非范围
CT-038 人话、CT-036 企业侧已开通消费、假 Live"
```

网页备用：https://github.com/luofanghao9784/mengine-app/compare/main...codex/ct-035-agent-admin-login-tenant-isolation

## ⑥ 验收标准（L1–L4）

日可演示（Mac 预览；约定 api=`50831`、web=`50832`，以实测 URL 为准）。四条架构裁定的验法写在「如何验」里。

| # | 标准 | 如何验 |
|---|---|---|
| L1 | 平台账号可登录 platform-admin 与 agent-admin | 第四端只打 `POST /api/agent-admin/v1/auth/login`（**没有**新的 platform-admin 登录路径）。Set-Cookie 名为 `DREAMCORE_AGENT`，Path=`/api/agent-admin/`，HttpOnly，SameSite=Strict。独立 `SecurityFilterChain`，源码里第四端 matcher **不在**客户 `IdentitySecurity`。只持 `PLATFORM_ADMIN` 不能换到第四端会话。`AGENT_ADMIN` 与 `PLATFORM_ADMIN` 各登各的端 |
| L2 | 企业负责人可登录 tenant-admin；员工可登录 workspace | 两端仍用客户域，互不串页。客户 cookie、平台 cookie、总部支持会话访问 `/api/agent-admin/**` 为 **401**；`DREAMCORE_AGENT` 访问 `/api/platform-admin/**` 与客户 `/api/v1/**` 为 **401** |
| L3 | 错账密 / 无权限：短人话 + 可恢复动作；不白屏、不甩堆栈 | 错账密 `message` 全等「账号或密码不对，请再试一次」。无权限「这个账号没有这里的权限」，可换账号或离开。**未登录** `POST /api/agent-admin/v1/capabilities` 为 **401** + 人话，不是 501/201/无路由 404。**已登录**且 body 含未声明字段为 **400** +「有无法识别的字段，请去掉后再试」；`enterpriseFunction` 只接受闭集，演示用 `quality-check`。JSON 无堆栈、无别的企业数据 |
| L4 | 登出后再登：会话干净，看不到上一账号数据 | 登出只清 `DREAMCORE_AGENT` 与 `agent_platform_sessions`；再登另一账号，页面与 `me` 无上一账号企业名、菜单、列表。合成企业 A 的会话看不到 B 的成员或数据。不靠假 Live 列表演示「未开通」 |

契约侧同时看：`Capability` 含 `enterpriseFunction`（`$ref` `EnterpriseFunction`），`additionalProperties` 仍为 `false`，`registerCapability` 有 400。本单相关测试绿。

## ⑦ 禁止操作 / 失败卡住

| 症状 | 动作 |
|---|---|
| remote 不是 mengine-app | 立刻停 |
| 有暂停令 | 不开 Codex；问 DQ |
| 模型不是 `gpt-6.1-sol` | 停，问 DQ，不换模型 |
| 第四端路径写成 `/api/platform-admin` | 打回；改到 `/api/agent-admin` |
| 第四端逻辑写进客户 `IdentitySecurity` | 打回；拆成独立 `SecurityFilterChain` |
| 跨域 cookie 仍能 200 | 未完成；补 401 |
| 未登录写返回 501/201 | **打回**；改为 401，并去掉登记 POST 的 permitAll 开放链 |
| 未知字段被忽略或返回 201/501 | **打回**；已登录必须 400 |
| `Capability` 仍无 `enterpriseFunction` 或闭集多了第六值 | 打回 |
| 错账密文案漂移 | 改回钉死句 |
| 无落库却 201，或列表出现假已上架 | **打回** |
| 改了 CT-038 文案 / hash，或做了 CT-036 消费页 | `git restore` 越界文件；报 DQ |
| 测试红 | 修到绿；禁止 `-DskipTests` 掩盖本单 |
| CONFLICT / push rejected | `git pull --rebase` 一次；仍失败停发 DQ |

**硬禁止**：

- `git push --force` / `-f` / `--force-with-lease`、`git reset --hard`、直推 `main`
- 把第四端挂进客户 `IdentitySecurity`，或新开 platform-admin 登录/登记路径
- 跨域放行；未登录写返回 501/201；未知字段不 400
- 假 Live、无落库 201、改探针假装已连接
- **CT-038** 人话重写、**CT-036** 企业侧/工作台消费已开通
- 改 `com.dreamcore.*` 包名、`/mengine-api`、`MENGINE_*`；编辑 V55 文件；提交口令
- `gh issue create/comment`；有暂停令仍开 Codex

回滚（未合入）：`git switch main && git branch -D codex/ct-035-agent-admin-login-tenant-isolation`。

---

**DQ 审路径**：本文件 + ADR-B8 D8-2/D8-3 + 终签 L1–L4。通过后交老板/后端岗 Mac 粘贴③开跑。合入前安全审查必看 cookie、跨域 401 与未登录写。
