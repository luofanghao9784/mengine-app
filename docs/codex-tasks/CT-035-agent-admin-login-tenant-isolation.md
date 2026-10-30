# CT-035 第四端正式登录 + 租户隔离（后端薄片）

状态：架构已裁可跑 · 待 docs 入库后交老板 Mac Codex　｜　分支：`codex/ct-035-agent-admin-login-isolation`　｜　**审查人（PR 后两人审）：架构逻辑 + 安全审查 + 质量性能**　｜　基准：切单时最新 `origin/main`（须含 CT-034 `#14`：`CapabilityRegistryStubSecurity` 仍在）

> **日切片：D4～D5（11-03～11-04）/ 可演示点**：本机或预览 API 上，持 `AGENT_ADMIN` 的合成账号可登录第四端；错账密返回人话；登出只清本域；客户 cookie / 平台 cookie 进不了 `/api/agent-admin/**`。  
> **挂靠**：两周日切片 D4～D5·轨 A；`docs/codex-tasks/两周日切片-三轨并行-20261031.md`；验收句 **L1–L4** 方向（本单钉登录与隔离，不收企业侧「未开通看不到」全量）。  
> **总负责人不代跑**；老板/后端岗在 Mac 自跑 Codex。Codex 尽量用。模型 `gpt-6.1-sol`，思考强度 **high**。  
> **仓**：`luofanghao9784/mengine-app`。

规格依据：

- ADR-B8 D8-2 / D8-3：`docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md`
- 平台同构实现（勿另起身份服务）：`PlatformIdentity.java`、`PlatformIdentityController.java`、`PlatformSecurity.java`、`IdentityService.hash`
- 会话表先例：`apps/api/src/main/resources/db/migration/V55__platform_identity_sessions.sql`（只作对照，**禁止改这个文件**）
- 角色约束现状：`platform_roles.role` 的 CHECK 只允许 `PLATFORM_ADMIN`（`V1__identity_and_tenants.sql`，**禁止改 V1**）
- 错误形状：`contracts/public-api/error.schema.json`（`contractVersion` / `code` / `message` / `retryable`）；人话引 QUEUE「编制·前端开发」**硬性第 6 条**
- 验收句：[两周主路径验收句](https://www.notion.so/40966c386fbf81ad97cff544bc2906ff)（L1–L4）
- 开放链勿碰：`apps/api/src/main/java/com/dreamcore/workspace/agentadmin/CapabilityRegistryStubSecurity.java`（替换属 **CT-034-P1**）

> **脚注（与 CT-034 共存）**：main 上登记 POST 仍由 `CapabilityRegistryStubSecurity`（`@Order(2)`，只匹配 `POST /api/agent-admin/v1/capabilities`，`permitAll` + `csrf.disable()`）返回 **501**。本单登录链不得抢走这条 POST，不得改 `CapabilityRegistryIntegrationTest` 的「无会话也 501」期望。拆掉开放链是 CT-034-P1，且 **硬挡在任何 A 档落库 / 201 之前**。

### 架构已裁（须照此实现；DQ 可覆）

#### 后端四裁（2026-10-31，与 CT-034-P1 相同，必须遵守）

1. **写口钉死 agent-admin**：登记等写接口只走 `/api/agent-admin/v1/...`。禁止再做 `/api/platform-admin/v1/capabilities` 或任何总台写入口。契约里旧的 platform 表面示意作废。OpenAPI 以 `contracts/public-api/capability-registry.openapi.json` 的 **agent-admin** 表面为准。
2. **独立链**：Cookie `DREAMCORE_AGENT`，`Path=/api/agent-admin/`。单独一条 `SecurityFilterChain`，同构 `PlatformSecurity`（无状态、会话绑定 CSRF）。**禁止**把第四端挂回客户域 `IdentitySecurity`。跨域 cookie → **401**。
3. **未登录写不是 501**：删除 `CapabilityRegistryStubSecurity` 的 `permitAll` + `csrf.disable()`，改回会话 + CSRF。未登录写 **401 人话，禁止 501**。501 只表示已登录但还没落库。拆开放链的代码在 **CT-034-P1**；本单不改 Stub，登录链不要抢走这条 POST。
4. **Capability 补 `enterpriseFunction`**：`components.schemas.Capability` 今日 `additionalProperties:false` 且没有该字段（字段只在 `CapabilityModuleVersion`）。须在 OpenAPI **增加** `enterpriseFunction`（`$ref` 已有闭集 `EnterpriseFunction`；演示值 `quality-check`）。未知字段 **400**，禁止静默丢弃。补 schema 与 400 的代码在 **CT-034-P1**；本单禁止新 DTO 把未声明字段丢掉还当成功。

1. **路径钉死**：API 前缀 `/api/agent-admin/v1/**`。登录/会话只做与平台同构的四个端点，挂在 `/api/agent-admin/v1/auth`：`GET /csrf`、`POST /login`、`GET /me`、`POST /logout`。请求体照 `PlatformIdentityController.Login`：`username` + `password`。类放在 `com.dreamcore.workspace.identity`，复用 `IdentityService.hash`、现有 `PasswordEncoder`、`LoginThrottle`。**禁止**另起 JWT/OAuth/第二套用户库，禁止复用平台「没有 platform_accounts 时用企业口令登平台」的旁路。
2. **Cookie**：名 `DREAMCORE_AGENT`（配置键 `dreamcore.agent.cookie-name`，默认即此名）。`Path=/api/agent-admin/`，HttpOnly，SameSite=Strict；Secure 照 `PlatformIdentity.cookie`（仅 `request.isSecure()` 时带 Secure，本机 http 不要写死 Secure）。与客户 cookie `DREAMCORE_SESSION`、平台 cookie `DREAMCORE_PLATFORM` **三者互不同名**。启动期校验：第四端构造器与 `PlatformIdentity` 构造器都要拒绝重名（把现有「平台名 ≠ 客户名」扩成三者两两不同，重名抛 `IllegalArgumentException`，应用起不来）。
3. **角色**：`AGENT_ADMIN` 写入现有 `platform_roles`，与 `PLATFORM_ADMIN` 并列，**互不包含**。只持平台角色不能登第四端；只持 `AGENT_ADMIN` 不能登总台。首版用测试夹具最小授予。迁移只放宽 CHECK，**不**做人员管理 UI，**不**把可登录口令写进迁移。
4. **会话表**：新建独立表 `agent_platform_accounts`、`agent_platform_sessions`（列对齐 V55 的 `platform_accounts` / `platform_sessions`；表名若与后端确认后改名，仍须独立表）。**禁止**给 `platform_sessions`、客户会话表加 `realm` 列。令牌哈希只用 `IdentityService.hash`；CSRF 照平台：`hash("csrf:"+token)`、头 `X-CSRF-TOKEN`、常量时间比较。校验 SQL 只查 `agent_platform_sessions`，且账号当前持 `AGENT_ADMIN`、状态 ACTIVE。跨域：带着 `DREAMCORE_PLATFORM` 访问 `/api/agent-admin/**` → **401**；带着 `DREAMCORE_AGENT` 访问 `/api/platform-admin/**` → **401**。
5. **会话无租户**：第四端不构造租户执行作用域，不调用、不新增 `ExecutionScope`。租户只是将来的授权被管理对象（路径参数）。本单不做授权写。会话表不要 `tenant_id`。`/me` 不得返回 `tenantId`。
6. **人话错误**：401/403 的 JSON `message` 用中文白话（QUEUE 硬性第 6 条的精神落到接口：不裸英文码、不堆栈、不出现 `seed` / `capability` / `Grant` / `admission`）。错账密例：「账号或密码不对，请重新输入」。未登录例：「还没有登录，请先登录后再试」。企业账号例：「企业账号不能登录这一端」。**不要**改 `IdentityErrors` 的全局文案（那句「请求未完成…」会波及客户域/总台）。禁止响应体带异常类名或堆栈。
7. **非范围**：前端大改与人话（CT-038）；删除或替换 `CapabilityRegistryStubSecurity`、以及 CT-034 A 档落库 / 201（**CT-034-P1 必须先于或并行挡住 A 档**）；企业侧消费已开通（CT-036）；假 Live；邀请/改密/关联客户账号；人员 UI；四眼与 `qo_audit_event` 全量审计；`qo_*` 登记表（CT-014）。
8. **同人两角色**：允许同一个 `accounts.id` 同时持有 `PLATFORM_ADMIN` 与 `AGENT_ADMIN`，两套会话表各一行，两枚 cookie 不互通。**不要**做「account_id 不得同时出现在 `platform_accounts` 与 `agent_platform_accounts`」的互斥触发器（与「互不包含但可兼任」冲突）。ADR 里该触发器标了待后端确认，本单明确不做。
9. **旧吊销触发器勿改**：V55 `platform_role_session_revocation` 会在 `platform_roles` **任意** DELETE 时删掉该账号全部 `platform_sessions`。本单禁止改 V55。测试账号把 `AGENT_ADMIN` 与 `PLATFORM_ADMIN` 分成两个 `accounts.id`。若要级联，只**新增**触发器：删除的角色是 `AGENT_ADMIN` 时只删 `agent_platform_sessions`。不要在「同一账号删掉 AGENT_ADMIN」上冒险，除非你能证明平台会话还在；做不到就停，问 DQ。

## ① 目标与范围

- **目标**：按 ADR-B8 D8-2/D8-3 落地第四端独立会话域的最小薄片，使写路径之后可以走正式鉴权，并钉死跨租户、跨域隔离。
- **增量边界（只做这些）**：
  1. 第四端身份类 + 控制器 + `securityMatcher("/api/agent-admin/**")` 安全链。Order 必须**低于**现有 Stub（Stub 为 `@Order(2)`），建议 `@Order(3)`：`POST /api/agent-admin/v1/capabilities` 仍先命中 Stub 并保持 501；登录四个端点走新链。Support 链 `@Order(0)`、平台链 `@Order(1)` 的 matcher 不要改。
  2. 新迁移只放在 `apps/api/src/main/resources/db/migration-common/`。版本号 = `db/migration`、`db/migration-local`、`db/migration-common` 三处当前最大号 + 1（切单时最大为 V189，先复查）。只放宽 `platform_roles.role` 的 CHECK，使 `AGENT_ADMIN` 可写入；并建两张独立会话表。禁止改已有迁移。不要占号去建 `qo_*`。
  3. 匿名 `GET /csrf` 可签发短期匿名会话（照平台 actor 为空）；`POST /login` 须带 CSRF。登录成功 Set-Cookie `DREAMCORE_AGENT`，`GET /me` 200。`POST /logout` 只清本 cookie 与本表会话，不清 `DREAMCORE_PLATFORM`、不清 `DREAMCORE_SESSION`。
  4. 集成测试落地下列方法（能落地几条写几条；未落地的在 PR 用 SKIP 表列出，禁止静默省略）：
     - `agentAdmin_loginWithCustomerAccount_rejected`
     - `agentAdmin_platformCookie_401`
     - `platformAdmin_agentCookie_401`
     - 另须有：登录成功、错账密人话、登出只清本域、`AGENT_ADMIN` 与 `PLATFORM_ADMIN` 互不包含、`agentAdmin_otherTenantResource_notVisible`
  5. 跨租户：夹具两个名称不同的租户。用第四端 cookie **显式**请求一条仓内既有的、按租户授权的客户域只读接口（先搜到真实路径再写，不要新造授权 API）。期望 401，响应体不得含另一租户的名称。`/me` 无 `tenantId`。会话表无 `tenant_id`。
- **改哪些文件（允许）**：
  - `apps/api/src/main/java/com/dreamcore/workspace/identity/**`（新增第四端类；`PlatformIdentity` 只为三者 cookie 不同名做启动校验）
  - `apps/api/src/test/java/com/dreamcore/workspace/**`（本单测试）
  - `apps/api/src/main/resources/db/migration-common/V<新号>__*.sql`（只增）
- **不做什么（非范围）**：见架构已裁第 7 条。特别是 **不要改** `CapabilityRegistryStubSecurity.java`、`CapabilityRegistryController.java`、`CapabilityRegistryIntegrationTest.java`。

### 契约贴合点

| 项 | 约定 |
|---|---|
| 登录面 | `GET/POST /api/agent-admin/v1/auth/{csrf,login,me,logout}` |
| Cookie | `DREAMCORE_AGENT`；Path `/api/agent-admin/`；与 `DREAMCORE_SESSION`、`DREAMCORE_PLATFORM` 不同名 |
| 角色 | `platform_roles.role = AGENT_ADMIN`；不隐含 `PLATFORM_ADMIN` |
| 错误 | JSON 四字段；`message` 中文白话；无堆栈 |
| 租户 | 会话无租户；本单不写授权 |

## ② 前置条件与分支名

- **⓪ 暂停令自查（第一步，优先级最高）**：有或拿不准 → **立刻停**，问 DQ。
- **依赖**：ADR-B8 已在 main。CT-034 C 档 stub 已在 main（`#14`）。本单不依赖 CT-034-P1 先合；两者可并行。A 档落库依赖 CT-034-P1，不依赖本单先把开放链拆掉。
- 正确仓：`~/Desktop/mengine-app-luofanghao9784`（origin=`luofanghao9784/mengine-app`）。
- Java 包名 `com.dreamcore.*`、`/mengine-api`、`MENGINE_*` **勿改**。

```bash
# ⓪ 暂停令自查：无暂停令再继续
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || { echo 'ERROR: 错误 remote，停'; exit 1; }
git status
git switch main && git pull
# 确认开放链仍在，避免登录链误伤 501
test -f apps/api/src/main/java/com/dreamcore/workspace/agentadmin/CapabilityRegistryStubSecurity.java || echo 'WARN: StubSecurity 不在，先读 CT-034-P1 再决定 Order'
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export POSTGRES_BIN="$(brew --prefix postgresql@18)/bin"
git switch -c codex/ct-035-agent-admin-login-isolation
```

## ③ 完整 Codex 提示词

把下面整段交给 Codex（`$CODEX`，模型 `gpt-6.1-sol`，思考强度 **high**）：

```
你在梦擎仓库分支 codex/ct-035-agent-admin-login-isolation 上工作。基准 origin/main。只做本单范围。执行单：docs/codex-tasks/CT-035-agent-admin-login-tenant-isolation.md。
ADR-B8 D8-2/D8-3：docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md。
同构对照：apps/api/src/main/java/com/dreamcore/workspace/identity/PlatformIdentity.java、PlatformIdentityController.java、PlatformSecurity.java；哈希只用 IdentityService.hash。
V55 只许读、不许改：apps/api/src/main/resources/db/migration/V55__platform_identity_sessions.sql。
错误形状：contracts/public-api/error.schema.json。人话：docs/codex-tasks/QUEUE.md 编制·前端开发硬性第 6 条（接口 message 同样用中文白话，禁止 seed/capability/Grant/admission 裸词和堆栈）。
两周挂靠：docs/codex-tasks/两周日切片-三轨并行-20261031.md（D4～D5 · 验收句 L1–L4）。

【后端四裁】
1. 写接口只允许 /api/agent-admin/v1/... 。禁止新增或改回 /api/platform-admin 的能力写入口。契约旧的 platform 示意作废；OpenAPI 表面跟 contracts/public-api/capability-registry.openapi.json 的 agent-admin。
2. Cookie 名 DREAMCORE_AGENT，Path=/api/agent-admin/。独立 SecurityFilterChain，同构 PlatformSecurity。禁止把第四端挂进客户 IdentitySecurity。跨域 cookie → 401。
3. 未登录的登记写由 CT-034-P1 改为 401 人话，禁止再用 501 表示未登录；501 仅已登录未落库。本单不要删 StubSecurity，不要改 CapabilityRegistryIntegrationTest。
4. Capability 在 additionalProperties:false 下须有 enterpriseFunction（闭集 EnterpriseFunction，演示 quality-check）。未知字段 400，禁止静默丢弃。本单不要改 capability-registry.openapi.json（CT-034-P1 改）。

【强制口径】
1. 第四端是独立会话域，不是第二套身份服务。端点只有 GET /api/agent-admin/v1/auth/csrf、POST .../login、GET .../me、POST .../logout。login 体是 username + password。安全链是独立 SecurityFilterChain，禁止注册进客户 IdentitySecurity。
2. Cookie 名 DREAMCORE_AGENT，Path=/api/agent-admin/，HttpOnly，SameSite=Strict，Secure 仅在 request.isSecure() 时设置。启动期保证它、DREAMCORE_PLATFORM、DREAMCORE_SESSION 两两不同，重名则进程拒绝启动。
3. 角色 AGENT_ADMIN 与 PLATFORM_ADMIN 互不包含。禁止复用「无平台账号时用企业口令登平台」的旁路。只有 agent_platform_accounts 且当前持 AGENT_ADMIN 才能拿到第四端会话。
4. 新表 agent_platform_accounts、agent_platform_sessions。禁止给旧会话表加 realm 列。禁止会话表出现 tenant_id。禁止构造 ExecutionScope。
5. 不要删除或修改 CapabilityRegistryStubSecurity、CapabilityRegistryController、CapabilityRegistryIntegrationTest。该 Stub 是 @Order(2)，只放行 POST /api/agent-admin/v1/capabilities 并返回 501。你的安全链用 @Order(3)，matcher 为 /api/agent-admin/**，这样这条 POST 仍先命中 Stub。若现有测试从 501 变成 401，是 Order 抢了 POST，把链放到 Stub 之后，不要改 501 测试。
6. 跨域 cookie：平台 cookie 访问 /api/agent-admin/** 的 GET /me → 401；第四端 cookie 访问 /api/platform-admin/** 的 GET /me → 401。用 GET /me，避免和无 CSRF 的 403 混在一起。
7. 错账密与未登录的 message 必须是人话，且只影响第四端。不要改 IdentityErrors 的全局「请求未完成…」。
8. 客户账号不能登录第四端。登出只清 DREAMCORE_AGENT 和 agent_platform_sessions，不清另外两枚 cookie。
9. 迁移只新增在 db/migration-common，版本号为三处迁移目录最大号 +1。只放宽 platform_roles 的 CHECK 以允许 AGENT_ADMIN，并建两张新表。禁止改 V1/V55。不要建 qo_* 表。不要在迁移里写口令。
10. 不要做 account_id 在 platform_accounts 与 agent_platform_accounts 之间的互斥触发器。测试用两个不同 accounts.id 分别持两种角色。不要改 V55 的吊销函数。

【A. 安全链】
- 无状态，会话绑定 CSRF，授权 ROLE_AGENT_ADMIN。Spring 的 csrf().disable() 只表示不用框架默认 CSRF，过滤器里仍要校验 X-CSRF-TOKEN（照 PlatformSecurity）。
- permitAll 只给 csrf 与 login。me 与其余 /api/agent-admin/** 要已认证。
- GET/HEAD/OPTIONS 不要求 CSRF。POST login 无 CSRF → 403。GET /me 无第四端会话 → 401，message 例：「还没有登录，请先登录后再试」。
- 错账密（CSRF 正确）→ 401，message 例：「账号或密码不对，请重新输入」。企业账号来登 → 401，message 例：「企业账号不能登录这一端」。
- 总部支持链的 matcher 保持原样，不要让它匹配 /api/agent-admin/**。

【B. 测试（方法名）】
新增集成测试（一次性测试库，走仓库既有 IsolatedTestDatabase / with-test-postgres 模式）。方法名：
- agentAdmin_loginWithCustomerAccount_rejected：客户域能登 /api/v1/auth/login 的合成账号，登第四端被拒，且不签发带主体的 DREAMCORE_AGENT。
- agentAdmin_platformCookie_401：总台登录得到的 DREAMCORE_PLATFORM，显式放到 GET /api/agent-admin/v1/auth/me，401，响应体不是总台 me。
- platformAdmin_agentCookie_401：第四端登录得到的 DREAMCORE_AGENT，显式放到 GET /api/platform-admin/v1/auth/me，401。
- 登录成功：AGENT_ADMIN → 200，Set-Cookie 含 DREAMCORE_AGENT、HttpOnly、SameSite=Strict、Path=/api/agent-admin/。
- 错账密：401 + 上述人话，body 不含 Exception、at com.、SQL。
- 登出：POST logout（带本域 CSRF）后 GET /me 为 401；若另一个客户端仍持总台 cookie，总台 GET /me 仍 200。
- 互不包含：只有 PLATFORM_ADMIN 的账号登第四端 401；只有 AGENT_ADMIN 的账号登总台 401。
- agentAdmin_otherTenantResource_notVisible：两个名称不同的租户。第四端 cookie 显式请求一条既有租户只读接口（先在仓内找到真实路径）。401，且 body 不含另一租户名称。/me 无 tenantId。
未落地的方法写入 PR 的 SKIP 表并说明原因。禁止整段跳过跨租户：只有仓内确实没有租户范围读接口时，才允许 SKIP 该条，并改为断言 /me 无 tenantId、会话表无 tenant_id。L4 里「未开通企业看不到功能」归 CT-036，本单不做授权写，这一条可以 SKIP，但必须写明。

【C. 验收命令】
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export POSTGRES_BIN="$(brew --prefix postgresql@18)/bin"
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml test -Dtest=CapabilityRegistryIntegrationTest,第四端测试类名
CapabilityRegistryIntegrationTest 必须仍绿（无会话 POST 仍 501）。禁止 -DskipTests。

curl 示例（端口换成本机 API；预览约定 50831）。先 csrf 再 login：
curl -si "http://127.0.0.1:50831/api/agent-admin/v1/auth/csrf"
curl -si -X POST "http://127.0.0.1:50831/api/agent-admin/v1/auth/login" \
  -H "Content-Type: application/json" -H "X-CSRF-TOKEN: <token>" \
  -d '{"username":"<合成登录名>","password":"<合成口令>"}'
错账密时期望 401 与人话 message，不是堆栈。

【不许碰】
src/** 前端、session.tsx、agent-admin UI（CT-038）、CapabilityRegistryStubSecurity、CapabilityRegistryController、CapabilityRegistryIntegrationTest、登记落库与 201（CT-034-P1 之后的 A 档）、企业侧消费（CT-036）、engine/**、workers/parser、dist/**、.local/**、口令入库、force push、reset --hard、直推 main、gh issue。
禁止改 Java 包名 dreamcore、/mengine-api、MENGINE_*。禁止改已有 Flyway 文件。

【做完输出】git diff --stat、新类与迁移文件名、cookie 启动校验做在哪、安全链 Order、测试方法落地/SKIP 表、curl 实测状态码。确认登记 POST 仍是 501。
```

## ④ 推荐模型与思考强度

- 模型：`gpt-6.1-sol`
- 思考强度：**high**（会话隔离、cookie 重名、与 Stub 的 Order 共存，想错就会串域或把 501 打成 401）
- **预计耗时**：Codex 60–120 分钟；一次性库测试 20–40 分钟

## ⑤ 可复制 git 步骤（跑完如何提交）

```bash
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || exit 1
git add apps/api/src/main/java/com/dreamcore/workspace/identity \
  apps/api/src/test/java/com/dreamcore/workspace \
  apps/api/src/main/resources/db/migration-common
git diff --cached --stat | grep -E 'CapabilityRegistry|src/features/|workers/parser|migration/V55|migration/V1__' && echo 'ERROR: 开放链/前端/旧迁移非本单' && exit 1
git commit -m "$(cat <<'EOM'
feat(api): CT-035 第四端独立登录与跨域隔离

AGENT_ADMIN 会话走 DREAMCORE_AGENT；客户与总台 cookie 不能进第四端。
不拆登记 StubSecurity，不落库。
EOM
)"
git push -u origin codex/ct-035-agent-admin-login-isolation
gh pr create -R luofanghao9784/mengine-app --base main --head codex/ct-035-agent-admin-login-isolation \
  --title "feat(api): CT-035 第四端登录与租户隔离" \
  --body "## 摘要
按 ADR-B8 D8-2/D8-3 增加第四端会话域：/api/agent-admin/v1/auth 的 csrf、login、me、logout。Cookie DREAMCORE_AGENT。与客户域、总台互不认 cookie。

## 验收句
L1 可登录；L2 错账密人话；L3 登出只清本域；L4 跨域 cookie 401 + 至少一条跨租户不可见。企业侧「未开通看不到」归 CT-036。

## 审查
- 两人审：架构逻辑 + 安全审查 + 质量性能
- 挂靠两周日切片 D4～D5
- 未改 CapabilityRegistryStubSecurity。A 档落库仍须先合 CT-034-P1
- 勿自动合并

## 非范围
前端人话（CT-038）、登记落库/201、企业侧消费（CT-036）、假 Live"
```

网页备用：https://github.com/luofanghao9784/mengine-app/compare/main...codex/ct-035-agent-admin-login-isolation

## ⑥ 验收标准

日可演示（API 口以预览为准；约定目标 api=`50831`）：

| # | 对齐 | 标准 | 如何验 |
|---|---|---|---|
| L1 | 可登录 | `AGENT_ADMIN` 合成账号 `POST .../auth/login` 为 200，Set-Cookie 为 `DREAMCORE_AGENT` | curl 或集成测试 |
| L2 | 错账密人话 | 401 JSON，`message` 为中文白话；无堆栈、无 SQL | 错密码 curl；断言 body |
| L3 | 登出清本域 | logout 后本域 `GET /me` 为 401；总台 cookie 仍可用 | 双客户端测试 |
| L4a | 跨域 | `agentAdmin_platformCookie_401`、`platformAdmin_agentCookie_401` 为 401 | 测试名 |
| L4b | 客户不可登 | `agentAdmin_loginWithCustomerAccount_rejected` | 测试名 |
| L4c | 跨租户不可见 | `agentAdmin_otherTenantResource_notVisible`：401 且不含他租名称。无授权表时不写授权 API | 测试；做不到则 PR 写 SKIP 与替代断言 |
| V5 | 开放链仍在 | 无会话 `POST /api/agent-admin/v1/capabilities` 仍 501 | `CapabilityRegistryIntegrationTest` 仍绿 |
| V6 | 启动校验 | 三个 cookie 名两两相同则应用拒绝启动 | 构造器测试或启动失败断言 |
| V7 | 边界 | 无前端 diff；无 V1/V55 diff；无口令迁移；无 201 | `git diff --stat` |

## ⑦ 禁止操作 / 失败卡住

| 症状 | 动作 |
|---|---|
| remote 不是 mengine-app | 立刻停 |
| 有暂停令 | 不开 Codex；问 DQ |
| 登记 POST 从 501 变成 401 | 登录链 Order 抢了 Stub；放到 `@Order(3)`，不要改 501 测试 |
| 企业账号登上了第四端 | 打回；删掉平台那条企业口令旁路的复制 |
| 401/403 只有英文码或堆栈 | 补第四端人话；不要改全局 IdentityErrors |
| 会话表出现 tenant_id，或代码新造 ExecutionScope | 打回 |
| 改了 V1/V55，或迁移里有口令 | `git restore` 那些文件；口令只留测试夹具 |
| 同一账号上删 AGENT_ADMIN 把总台会话清掉 | 停；不要改 V55；问 DQ |
| 误改前端 / StubSecurity / 包名 | `git restore`；报 DQ |
| 测试红 | 修到绿；禁止 `-DskipTests` 掩盖本单 |
| CONFLICT / push rejected | `git pull --rebase` 一次；仍失败停发 DQ |

**硬禁止**：

- `git push --force` / `-f` / `--force-with-lease`、`git reset --hard`、直推 `main`
- 拆 `CapabilityRegistryStubSecurity` 或在本单返回登记 201（那是 CT-034-P1 之后的 A 档）
- 前端人话与登录墙 UI（CT-038）、企业侧消费（CT-036）、假 Live
- 第二套身份服务（JWT/OAuth/新用户库）
- 改 `com.dreamcore.*` 包名、`/mengine-api`、`MENGINE_*`
- `gh issue create/comment`；把口令写进迁移或提交
- 有暂停令仍开 Codex

回滚（未合入）：`git switch main && git branch -D codex/ct-035-agent-admin-login-isolation`。

---

**DQ 审路径**：本文件 + ADR-B8 D8-2/D8-3 + 两周日切片 D4～D5 + 验收句 L1–L4。通过后交老板/后端岗 Mac 粘贴③开跑。安全审查必看 cookie 隔离与 Stub Order。总负责人不代跑。
