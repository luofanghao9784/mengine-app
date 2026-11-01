# CT-045 客户链写请求先认会话，再查 CSRF

状态：可交给后端在共享电脑上直接实现　｜　实现分支：`fix/ct-045-customer-session-before-csrf`　｜　审查人：架构逻辑 + 安全审查 + 质量性能　｜　基准：`d945af9235b07ecfbfc4990bd6c4ebae4324b769`（`origin/main`，[#50](https://github.com/luofanghao9784/mengine-app/pull/50)；其前 #49 为 `b9cea9ca`）

主号 **CT-045**。QUEUE 里 CT-044 及更早的主号都已有用途，CT-033 留给自托管，本单用下一个未占用主号。无新页面。共享电脑上用下面的接口断言验收。

仓：`luofanghao9784/mengine-app`。

## 目标与背景

客户链 `IdentitySecurity`（Cookie `DREAMCORE_SESSION`，`apps/api/src/main/resources/application.properties` 第 21 行）对写请求先判断是不是已登录会话，再查 CSRF。

未登录的写请求，无论不带 CSRF、带着乱 CSRF，还是带着从 `GET /api/v1/auth/csrf` 拿到的有效 CSRF 和对应 Cookie，一律 **401**，`code=AUTHENTICATION_REQUIRED`。不写库，响应里没有业务结论。已登录但 CSRF 缺失或无效，才是 **403**，`code=ACCESS_DENIED`。已登录并且 CSRF 是这次会话的有效值，请求照旧进入现有业务。

#49（`b9cea9ca`）在 [`CT-043-A`](CT-043-A-quality-check-submit-api.md) 把匿名写记成：不带 CSRF 或乱 CSRF 可以是 401 或 403；带着上述有效 CSRF 仍未登录则必须 401。QUEUE 同时留下债务：「客户链先查会话再查 CSRF」。本单就是这张安全小单。两条链保持独立：对照第四端已合实现 #22（`022768b`）和任务单 [`CT-034-P1`](CT-034-P1-stub-security-replace-auth-csrf.md)，只借鉴顺序，不合并过滤器，不共享 Filter Bean。

本基准上的实际顺序：

- 客户链 `IdentitySecurity.apiSecurity`（约第 38–82 行）没有 `securityMatcher`，是兜底链。CSRF 使用 `HttpSessionCsrfTokenRepository`（第 32、41 行）。登录轮换 CSRF 靠 `loginSessions` 里的 `CsrfAuthenticationStrategy`（第 33–35 行）。自定义过滤器加在 `AuthorizationFilter` 之前（第 53 行），框架 CSRF 过滤器仍在它前面。缺 CSRF 或 CSRF 不对时，走第 52 行的 `accessDeniedHandler`，**403**。匿名但 CSRF 有效时，CSRF 过滤器放行，`anyRequest().authenticated()` 才走到第 51 行入口点，**401**。所以今天「匿名无 CSRF / 乱 CSRF」多半是 403，「匿名但 CSRF 有效」才是 401。`GET /api/v1/auth/csrf` 会写下尚未登录的 `DREAMCORE_SESSION`，这枚 Cookie 不是登录。
- 第四端 `AgentAdminSecurity`（`@Order(3)`，只匹配 `/api/agent-admin/**`）已经先认会话。公开的 csrf/login 之外，没有 actor 就 401 返回；其后才对非安全方法查 CSRF，失败 403：

```java
if(!publicAuthEndpoint && (session==null || session.actor()==null)) {
    AgentAdminErrors.writeError(response,401,"AUTHENTICATION_REQUIRED"); return;
}
if(!List.of("GET","HEAD","OPTIONS").contains(request.getMethod()) && !identities.validCsrf(session,request.getHeader("X-CSRF-TOKEN"))) {
    AgentAdminErrors.writeError(response,403,"ACCESS_DENIED"); return;
}
```

对应测试在 `CapabilityRegistryIntegrationTest`：`unauthenticatedWriteReturnsChinese401BeforeBodyValidation`、`sessionWithoutOrWithWrongCsrfReturnsChinese403`、`preLoginSessionAndRevokedRoleReturn401BeforeCsrf`。

客户链的 401/403 正文保持 `IdentitySecurity.writeError`（第 84–88 行）：`message` 为「请求未获授权。」。第四端那句「还没有登录，请先登录后再试」留在第四端。

平台 API 父 POM 是 Spring Boot 4.1.1。

## 边界（做什么 / 不做什么）

做什么：

1. 在客户链 `apiSecurity` 上、框架 CSRF 过滤器之前，增加只属于这条链的过滤器。类名 `CustomerSessionBeforeCsrfFilter`，放在 `com.dreamcore.workspace.identity`。在 `apiSecurity` 里 `new` 出来再 `addFilterBefore(..., CsrfFilter.class)`。它不是 `@Bean`，类上没有 `@Component`、`@Service`、`@Configuration`、`@Controller`、`@RestController`、`@Repository`、`@WebFilter`，也没有其它会让组件扫描把它收成 Bean 的构造型注解。禁止 Spring Boot 把它自动注册成全局 Servlet 过滤器。
2. 该过滤器只处理写方法（不是 `GET` / `HEAD` / `OPTIONS`）。安全方法直接放行，行为与今天相同。
3. 写方法且路径不在下面的豁免清单时：当前不是有效客户登录 → 立刻 `IdentitySecurity.writeError(response, 401, "AUTHENTICATION_REQUIRED")` 并返回，后面的 CSRF 过滤器看不到这次请求。有效登录的判断复用现有逻辑，而不是「有没有 Session」：
   - `SecurityContext` 里没有已认证主体，或主体是 `AnonymousAuthenticationToken` → 未登录。`GET /api/v1/auth/csrf` 留下的预登录 Session 属于这一类。此种 401 不新建 Session，也不作废这枚预登录 Cookie。
   - 有主体但 `IdentityService.validSession` 失败，或 Session 的 `AUTHENTICATION_SOURCE` 为 `PLATFORM_PASSWORD` → 按第 59–70 行的现有后果处理（作废会话、必要时 `closeSupportSession`），然后 401。这段对写请求发生在 CSRF 之前。
4. 已是有效客户登录的写请求：过滤器调用 `chain.doFilter`，继续走现有 CSRF 过滤器。缺失或无效 CSRF 仍是 403 `ACCESS_DENIED`。有效 CSRF 进入原控制器。第 53 行那个已有过滤器保留，继续负责 GET 上的会话校验，并在 CSRF 通过后照旧复核。
5. 豁免判断与这条链的 `permitAll` 用同一份路径模式、同一种匹配。只用 `PathPattern`，或与 `requestMatchers` 相同的 `servletPath`。禁止用原始 `getRequestURI()` 做前缀比较（含 `startsWith`、`contains`、`indexOf`）。豁免模式集合与 `apiSecurity` 里 `requestMatchers(...).permitAll()` 的路径模式相等，不多不少。今天就是第 45–48 行已有的全部 `permitAll` 路径：客户入口、手机号入口、总台上的那些入口，以及 `/internal/v1/agent-access/**`、`/internal/v1/engine-receipts/**`、`/internal/v1/native-conversations/**`。`dispatcherTypeMatchers` 不是路径豁免。`local-code` 保持 `permitAll` 里的 `/*`，不要改成另一套 `/**` 前缀。这些写口保持今天的顺序：没有 CSRF 仍 403，带上本次 CSRF 仍进入现有处理器。
6. 过滤器 `doFilterInternal` 内任何异常都直接返回错误并结束（fail closed）。包括主体 `UUID.fromString` 失败、`validSession` 查库失败，以及其它运行时异常。捕获后调用 `IdentitySecurity.writeError(response, 401, "AUTHENTICATION_REQUIRED")` 然后 `return`。`catch` 与 `finally` 里都不得调用 `chain.doFilter`。查库失败不得把请求放进后续 CSRF 或控制器。
7. 更新测试，使下面「验收断言」可重复跑绿。已知必改的旧断言只有 `ForwardingIntegrationTest.publicApiRequiresSessionAndCsrf` 里那次匿名 POST（今天期望 403）。

已钉死的范围：

- 登录、取 CSRF、邀请接受，以及上面列出的手机号引导写口，本身就是未登录入口。它们继续「无 CSRF → 403，带本次 CSRF → 现有处理器」。改成匿名一律 401 会让登录和入驻无法完成。
- `POST /api/v1/auth/logout`、`POST /api/v1/auth/phone/bind`、`POST /api/v1/auth/phone/password` 不在豁免清单。匿名写这些口改为 401。已登录但 CSRF 缺失或无效仍是 403。
- 客户链继续使用 Spring 的 `HttpSessionCsrfTokenRepository` 和登录时的 `CsrfAuthenticationStrategy`。实现方式是把未登录判断移到 CSRF 过滤器之前。客户链保持 `csrf` 启用。第四端那种 `csrf.disable()` 加上自有 `validCsrf` 只属于 `DREAMCORE_AGENT`。
- 只换 `AuthenticationEntryPoint` 不够：缺 CSRF 时框架 CSRF 过滤器走的是 `accessDeniedHandler`，到不了入口点。401 由新过滤器写出。不新增 EntryPoint 类。
- `IdentitySecurity` 不增加 `securityMatcher`，不改 `@Order`。`/api/platform-admin/**` 由 `PlatformSecurity`（`@Order(1)`）先匹配，`/api/agent-admin/**` 由第四端链匹配，支持链是 `SupportSecurity`（`@Order(0)`）。这三条链的源码保持原样。

不做什么：

- 不修改 `AgentAdminSecurity`、`AgentAdminIdentity`、`AgentAdminErrors`、`PlatformSecurity`、`SupportSecurity`。
- 不把客户过滤器并进第四端链，不抽出两边共用的 Filter `@Bean`，不调用 `AgentAdminIdentity.validCsrf`。
- 不恢复或新建 `CapabilityRegistryStubSecurity`，不新增 `permitAll`，不在客户链 `csrf.disable()`，不把客户业务写口加进 `ignoringRequestMatchers`。登录和豁免清单上已有的 `permitAll` 保持原样。
- 不放宽任何已登录 CSRF：已登录且缺 CSRF、乱 CSRF、或登录前那枚已轮换失效的 CSRF，都仍是 403。
- 不改 GET / HEAD / OPTIONS 的现状，不为安全方法新增 CSRF 要求。
- 不改 `IdentitySecurity.writeError` 的文案、字段和 `retryable`。
- 不改业务控制器、契约、迁移、`src/**`、`engine/**`、`workers/**`。本基准没有 `CheckTaskController`，本单不实现质量检查。
- 不改 [`CT-043-A`](CT-043-A-quality-check-submit-api.md) 那份任务单。
- 不用 `getRequestURI()` 做豁免前缀比较，不在过滤器异常之后调用 `chain.doFilter`。
- 不给 `CustomerSessionBeforeCsrfFilter` 加 `@Component`、`@Service`、`@Configuration` 或其它会被组件扫描收成 Bean 的注解。

**`CheckTaskIntegrationTest` 的匿名断言按合入顺序收紧。** 本单自己的新测试仍把 `POST /api/tenant-admin/v1/quality-ops/check-tasks` 的匿名三种锁成严格 401。不改 [`CT-043-A`](CT-043-A-quality-check-submit-api.md) 那份任务单。按当前进度，#53（CT-043-A 实现）大概率先合。

- #53 先合：在 CT-045 的同一个实现 PR 里，把 `CheckTaskIntegrationTest` 的「匿名无 CSRF」「匿名乱 CSRF」两条断言从 `{401,403}` 收紧为 `401`。该文件写入改动白名单，只许改这两条断言。
- CT-045 先合：这个实现 PR 不创建、不修改 `CheckTaskIntegrationTest`。#53 合入之后另开一个单行小改，只做同样的两处收紧。

## 契约（各情形状态码与行为表）

客户链 401 与 403 的 JSON 都是现有 `writeError`：

```json
{"contractVersion":"1.0","code":"<code>","message":"请求未获授权。","retryable":false}
```

键只有这四个。`message` 固定为「请求未获授权。」。`Cache-Control` 含 `no-store`。响应无 `result`、无 `verdict`、无堆栈。

「有效 CSRF」指同一次 `GET /api/v1/auth/csrf` 返回的 `token`，头名用响应里的 `headerName`，并带上这次 `Set-Cookie` 的 `DREAMCORE_SESSION`。登录成功后会话标识会变，旧 token 不再算有效。

「客户链受保护写」指方法为 POST / PUT / PATCH / DELETE，路径落在客户兜底链上，且不在豁免清单。代表口有两个：`POST /api/tenant-admin/v1/quality-ops/check-tasks`（质量检查，本基准尚无控制器），`POST /api/v1/tenants/{tenant}/forwarding/batches`（既有写口）。

| 场景 | 端点 | 状态码 | code | 写库 |
|---|---|---|---|---|
| 匿名，无 Cookie，无 CSRF 头 | 客户链受保护写 | 401 | `AUTHENTICATION_REQUIRED` | 否 |
| 匿名，无 Cookie，CSRF 头为乱值 | 客户链受保护写 | 401 | `AUTHENTICATION_REQUIRED` | 否 |
| 匿名，带预登录 Cookie 和与之配对的有效 CSRF，未调用 login | 客户链受保护写 | 401 | `AUTHENTICATION_REQUIRED` | 否 |
| 已登录，不带 CSRF 头 | 客户链受保护写 | 403 | `ACCESS_DENIED` | 否 |
| 已登录，CSRF 为乱值 | 客户链受保护写 | 403 | `ACCESS_DENIED` | 否 |
| 已登录，却使用登录前那枚 CSRF | 客户链受保护写 | 403 | `ACCESS_DENIED` | 否 |
| 已登录，使用登录后当次有效 CSRF | `POST .../forwarding/batches` 的既有成功用例 | 201 | 现有业务码 | 按既有业务写 |
| 已登录，使用登录后当次有效 CSRF | `POST .../check-tasks` | 过滤器放行后的原结果 | 不是 401/403 | 本单不新增写入。无控制器时不是 201；已有控制器时与改过滤器之前相同 |
| 匿名 GET | `/api/v1/me`、`.../forwarding/inbox` | 401 | `AUTHENTICATION_REQUIRED` | 否 |
| `GET /api/v1/auth/csrf` | 取令牌 | 200 | — | 返回 `token` 与 `headerName`，并写预登录 Cookie |
| `POST /api/v1/auth/login` 无 CSRF | 登录 | 403 | 保持今天 | 不建立登录 |
| `POST /api/v1/auth/login` 有 CSRF、口令错误 | 登录 | 401 | 保持今天 | 否 |
| `POST /api/v1/auth/login` 有 CSRF、口令正确 | 登录 | 200 | — | 会话标识轮换；旧 CSRF 再写为 403 |
| `POST /api/v1/auth/invitations/accept` 以及豁免清单中的手机号引导写 | 未登录入口 | 与今天相同 | 与今天相同 | 与今天相同 |
| `POST /api/v1/auth/logout` 匿名 | 退出 | 401 | `AUTHENTICATION_REQUIRED` | 否 |
| `POST /api/v1/auth/logout` 已登录且当次 CSRF 有效 | 退出 | 204 | — | 按今天关闭会话 |
| `/internal/v1/agent-access/**`、`/internal/v1/engine-receipts/**`、`/internal/v1/native-conversations/**` | 引擎回调 | 与今天相同 | 与今天相同 | 不因本过滤器变成 401 |
| 第四端未登录写、预登录 Session 写 | `/api/agent-admin/**` | 401 先于 CSRF | 第四端现有文案 | 与 #22 相同，本单不改 |
| 第四端已登录、无或错 CSRF | `/api/agent-admin/**` | 403 | 第四端现有文案 | 否 |
| 总台登录不带 CSRF | `/api/platform-admin/v1/auth/login` | 403 | 保持今天 | 否 |
| 已认证主体名不是合法 UUID | 客户链受保护写 | 401 | `AUTHENTICATION_REQUIRED` | 否。过滤器直接返回，不调用 `chain.doFilter` |
| `validSession` 查库抛异常 | 客户链受保护写 | 401 | `AUTHENTICATION_REQUIRED` | 否。过滤器直接返回，不调用 `chain.doFilter` |

总台链 `PlatformSecurity` 今天仍先查 CSRF（约第 40–42 行）。本单保持这条顺序。支持链同样不动。

## 验收断言（逐条可测）

必跑（禁止 `-DskipTests`，禁止 `@Disabled`，禁止把已登录 403 改成 401 来变绿）：

共享电脑是 Linux。JDK 21，PostgreSQL 18.6。`JAVA_HOME` 指本机已装的 JDK 21，示例路径按实际安装修改。`initdb`、`pg_ctl`、`psql` 已在 `PATH` 里就不必设 `POSTGRES_BIN`；不在 `PATH` 里时再设，例如 `export POSTGRES_BIN=/usr/lib/postgresql/18/bin`。测试仍走 `scripts/with-test-postgres.py`。

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export PATH="$JAVA_HOME/bin:${POSTGRES_BIN:+$POSTGRES_BIN:}$PATH"
java -version
psql --version
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml test \
  -Dtest=CustomerSessionBeforeCsrfIntegrationTest,ForwardingIntegrationTest,IdentityIntegrationTest,PhoneIdentityIntegrationTest,CapabilityRegistryIntegrationTest,AgentAdminIdentityIntegrationTest,UnifiedIdentityIntegrationTest,ExperienceIntegrationTest,FeedbackIntegrationTest,ExperienceAdjustmentIntegrationTest,GeneralExperienceSuggestionIntegrationTest,GeneralExperienceLibraryIntegrationTest
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml test
```

两次都要 `BUILD SUCCESS`，并且 `Failures: 0, Errors: 0`。第二次是 `apps/api` 全量 `mvn test`，不带 `-Dtest`。

| # | 断言 |
|---|---|
| A1 | 匿名、无 CSRF，`POST /api/tenant-admin/v1/quality-ops/check-tasks`，body 为 `{"materialText":"问题：尺寸超差"}` → 401，`code=AUTHENTICATION_REQUIRED`，`message` 为「请求未获授权。」，键仅四个，`retryable=false`，无 `result`、无 `verdict`，`Cache-Control` 含 `no-store`。`to_regclass('qo_check_task')` 非空则行数不变；为空则状态码不是 201 |
| A2 | 同一 POST，无 Cookie，CSRF 头为乱值 → 与 A1 相同，且是单独断言 |
| A3 | 同一 POST：先 `GET /api/v1/auth/csrf`，带上返回的 `token`、`headerName` 和对应 Cookie，不登录 → 401，与 A1 相同，且是单独断言 |
| A4 | `POST /api/v1/tenants/{tenant}/forwarding/batches`，body `{}`。匿名无 CSRF、乱 CSRF、有效预登录 CSRF 三者都是 401，合同同 A1。该租户 `publication_forward_batches` 行数不增加。`ForwardingIntegrationTest.publicApiRequiresSessionAndCsrf` 里原来的匿名 POST 403 改为 401。同方法里的匿名 GET inbox 仍是 401 |
| A5 | 遍历断言：读取 `RequestMappingHandlerMapping` 的全部写映射（POST/PUT/PATCH/DELETE）。去掉 `/api/platform-admin/**`、`/api/agent-admin/**` 和豁免清单。路径变量换成随机 UUID。每一条都对匿名三种打请求，结果都是 A1 的 401 合同。这就是「客户链所有写端点」的覆盖；A1–A4 的两个代表口即使当时没有映射（check-tasks 在本基准没有控制器）也要单独打 |
| A6 | 已登录、不带 CSRF：check-tasks 与 forwarding batches 都是 403，`code=ACCESS_DENIED`，正文与 A1 的字段相同，对应表不增加行 |
| A7 | 已登录、乱 CSRF：两个代表口都是 403，同 A6，且与 A6 分开断言 |
| A8 | 已登录、使用登录前那枚 CSRF 写 forwarding batches → 403，不新增批次。`IdentityIntegrationTest.authenticationCsrfSessionRotationAndLogout` 保持绿：登录后旧 CSRF 调用 logout 仍是 403 |
| A9 | 已登录、登录后重新取到的有效 CSRF，`ForwardingIntegrationTest.realAuthenticatedHttpAcceptanceConflictAndRevocation` 仍是 201。不放宽这条用例 |
| A10 | 已登录、当次有效 CSRF，check-tasks：状态码不是 401，也不是 403。开工时无 `CheckTaskController` 则也不是 201（过滤器放行后的未映射结果）。已有该控制器则状态码与改过滤器之前相同，PR 写明改前测到的码。不新增该控制器 |
| A11 | `GET /api/v1/auth/csrf` 仍 200，含 `token` 与 `headerName`。`POST /api/v1/auth/login` 无 CSRF 仍 403；有 CSRF 且口令错误仍 401；有 CSRF 且口令正确仍 200，Cookie 里的会话标识与登录前不同 |
| A12 | `POST /api/v1/auth/invitations/accept` 与豁免清单中的手机号引导写口行为不变。`PhoneIdentityIntegrationTest` 全绿。匿名 `GET /api/v1/me` 仍 401 |
| A13 | 第四端回归不变：`CapabilityRegistryIntegrationTest` 与 `AgentAdminIdentityIntegrationTest` 全绿。`git diff` 中没有 `AgentAdminSecurity.java` |
| A14 | 总台回归不变：`UnifiedIdentityIntegrationTest` 全绿（总台登录不带 CSRF 仍 403）。`PlatformSecurity.java` 与 `SupportSecurity.java` 无 diff |
| A15 | `git diff --name-only origin/main` 每一行都在白名单。无迁移。无 `src/**`。客户链源码中该写路径没有新的 `permitAll` 或 `csrf.disable()`。`AgentAdminSecurity` 不引用新过滤器。测试反射 `CustomerSessionBeforeCsrfFilter`：不存在返回该类型的 `@Bean` 方法；类上的直接注解和元注解都不得包含 `@Component`、`@Service`、`@Configuration`、`@Controller`、`@RestController`、`@Repository`、`@WebFilter` |
| A16 | 已登录后不带 CSRF 仍须 403 的旧用例保持原断言，包括 `ExperienceIntegrationTest.realHttpRequiresSessionCsrfAndReturnsNoStore`、`FeedbackIntegrationTest.realHttpFeedbackPersistsAndRequiresSessionCsrf`、`ExperienceAdjustmentIntegrationTest.httpSubmissionAndObservationRequireCustomerCsrfAndExposeNoProposedBody`、`GeneralExperienceSuggestionIntegrationTest.httpSuggestionRequiresCustomerSessionAndCsrfAndNeverReturnsPrivateText`，以及 `GeneralExperienceLibraryIntegrationTest` 里已登录缺 CSRF 仍为 403 的断言。它们变红时，修正过滤器对已登录的判断 |
| A17 | 豁免模式集合与 `apiSecurity` 里 `requestMatchers(...).permitAll()` 的路径模式集合相等，测试读出两边比较。豁免匹配使用 `PathPattern` 或与 `requestMatchers` 相同的 `servletPath`。过滤器源码不得用 `getRequestURI()` 做豁免前缀比较。匿名 `POST /api/v1/auth/login/extra` 仍是 401，不得因字符串前缀被当成登录豁免 |
| A18 | 两条独立用例，都落在受保护写上，响应为 A1 的 401 合同，业务表不增加，且不是后续 CSRF 的 403、也不是业务成功。其一：已认证主体名不是合法 UUID。其二：`validSession` 抛出查库异常。两条都不得进入控制器 |
| A19 | 按合入顺序收紧 `CheckTaskIntegrationTest` 的「匿名无 CSRF」「匿名乱 CSRF」，从 `{401,403}` 改为 `401`，其余断言不动。#53 先合（按当前进度大概率如此）：收紧写在 CT-045 的同一个实现 PR。CT-045 先合：本 PR 不改该文件，#53 合入后另开单行小改。不改 CT-043-A 任务单 |

A5 的覆盖方式：安全链在进入控制器之前返回固定 401 合同，所以已映射的客户写口都到不了业务写入。代表口再查表。豁免口和安全方法不进这条遍历，由 A4 的 GET、A11、A12 锁住。

## 改动白名单与禁改清单

`git diff --name-only origin/main` 每一行都必须落在下表。

| 路径 | 动作 |
|---|---|
| `apps/api/src/main/java/com/dreamcore/workspace/identity/IdentitySecurity.java` | 只在 `apiSecurity` 上、CSRF 过滤器之前挂上新过滤器。保留现有 CSRF 仓库、`loginSessions`、入口点、`accessDeniedHandler` 和第 53 行已有过滤器。不改 `writeError` 文案 |
| `apps/api/src/main/java/com/dreamcore/workspace/identity/CustomerSessionBeforeCsrfFilter.java` | 新建。仅服务客户链，由 `IdentitySecurity` 显式 `new`。无 `@Bean`，无 `@Component` / `@Service` / `@Configuration` 等扫描注解。豁免与 `permitAll` 同一套路径匹配。异常路径不调用 `chain.doFilter` |
| `apps/api/src/test/java/com/dreamcore/workspace/CustomerSessionBeforeCsrfIntegrationTest.java` | 新建。承担 A1–A3、A5、A6–A7 的 check-tasks、A10、A15 的注解反射、A17、A18 |
| `apps/api/src/test/java/com/dreamcore/workspace/ForwardingIntegrationTest.java` | 只扩展 `publicApiRequiresSessionAndCsrf`：匿名 POST 改为 401，并补上匿名三种与已登录缺 CSRF、乱 CSRF、登录前 CSRF。`realAuthenticatedHttpAcceptanceConflictAndRevocation` 的 201 保持原样 |
| `apps/api/src/test/java/com/dreamcore/workspace/CheckTaskIntegrationTest.java` | 仅当 #53 已先合。按 A19 只改「匿名无 CSRF」「匿名乱 CSRF」两条，从 `{401,403}` 改为 `401`。CT-045 先合时，本 PR 不改此文件 |

额外只允许这一类 diff：某个已有测试仅仅因为「匿名、非豁免、客户链写」从 403 变成 401 而失败。只改那一条期望，PR 正文列出文件名。已知必改是转发测试那一行。已登录仍应 403 的期望不在此列。

禁改：

- `apps/api/src/main/java/com/dreamcore/workspace/identity/AgentAdminSecurity.java`
- `apps/api/src/main/java/com/dreamcore/workspace/identity/AgentAdminIdentity.java`
- `apps/api/src/main/java/com/dreamcore/workspace/identity/AgentAdminErrors.java`
- `apps/api/src/main/java/com/dreamcore/workspace/identity/PlatformSecurity.java`
- `apps/api/src/main/java/com/dreamcore/workspace/support/SupportSecurity.java`
- 任何 `*StubSecurity*`，以及把登记 POST 重新做成 `permitAll` 的代码
- `apps/api/src/main/resources/db/migration-common/**` 与其他迁移
- 业务控制器，含 `CheckTaskController`、转发控制器、`IdentityController`、`PhoneIdentityController`
- `contracts/**`、`src/**`、`engine/**`、`workers/**`
- 新的 EntryPoint 类。401 复用 `IdentitySecurity.writeError`

禁止：`git push --force`、`git reset --hard`、直接推 `main`、`-DskipTests`、`@Disabled`、放宽已登录 CSRF、口令写入仓库。

## 可复制 git 步骤

```bash
# 开工前确认当前没有暂停令。有，或拿不准：停，问 DQ。
# 共享电脑是 Linux。REPO 改成这台机器上的正式克隆；origin 必须是 luofanghao9784/mengine-app。
REPO="${MENGINE_REPO:-$HOME/mengine-app}"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || { echo 'ERROR: 错误 remote，停'; exit 1; }
git status
git switch main && git pull
git merge-base --is-ancestor d945af9235b07ecfbfc4990bd6c4ebae4324b769 HEAD || { echo 'ERROR: main 不含本单基准，停'; exit 1; }
test -f apps/api/src/main/java/com/dreamcore/workspace/identity/IdentitySecurity.java || { echo 'ERROR: 找不到 IdentitySecurity，停'; exit 1; }
test ! -f apps/api/src/main/java/com/dreamcore/workspace/agentadmin/CapabilityRegistryStubSecurity.java || { echo 'ERROR: StubSecurity 还在，停'; exit 1; }
# JDK 21。下面路径是示例，改成已安装的 JDK 21。
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export PATH="$JAVA_HOME/bin:$PATH"
# PostgreSQL 18.6。工具已在 PATH 则下面这一行不必执行。
# export POSTGRES_BIN=/usr/lib/postgresql/18/bin
# [ -n "${POSTGRES_BIN:-}" ] && export PATH="$POSTGRES_BIN:$PATH"
java -version
psql --version
git switch -c fix/ct-045-customer-session-before-csrf
```

实现并跑完「验收断言」里的测试命令，看到 `BUILD SUCCESS` 之后：

```bash
cd "${MENGINE_REPO:-$HOME/mengine-app}"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || exit 1
git add \
  apps/api/src/main/java/com/dreamcore/workspace/identity/IdentitySecurity.java \
  apps/api/src/main/java/com/dreamcore/workspace/identity/CustomerSessionBeforeCsrfFilter.java \
  apps/api/src/test/java/com/dreamcore/workspace/CustomerSessionBeforeCsrfIntegrationTest.java \
  apps/api/src/test/java/com/dreamcore/workspace/ForwardingIntegrationTest.java
# #53 已先合时，按 A19 追加 CheckTaskIntegrationTest，且 diff 只有那两条断言：
# git add apps/api/src/test/java/com/dreamcore/workspace/CheckTaskIntegrationTest.java
# 因匿名写从 403 变为 401 而改到的旧测试：按 PR 正文列出的文件追加
echo '验收：git diff --name-only 仅落在白名单内'
git diff --name-only origin/main
git commit -m "$(cat <<'EOM'
fix(api): CT-045 客户链写请求先认会话再查 CSRF

未登录写一律 401。已登录但 CSRF 缺失或无效仍是 403。
EOM
)"
git -c http.proxy= -c https.proxy= push origin fix/ct-045-customer-session-before-csrf
gh pr create -R luofanghao9784/mengine-app --base main --head fix/ct-045-customer-session-before-csrf \
  --title "fix(api): CT-045 客户链写请求先认会话再查 CSRF" \
  --body "## 摘要
客户链 IdentitySecurity 对写请求先认 DREAMCORE_SESSION，再查 CSRF。未登录写一律 401；已登录但 CSRF 缺失或无效仍是 403。第四端链、总台链不改，不共享 Filter Bean。

## 测试
必跑类见任务单 -Dtest。另跑一次 apps/api 全量 mvn test。两次都是 Failures: 0, Errors: 0。

## 审查
架构逻辑 + 安全审查 + 质量性能。勿自动合并。"
```

网页备用：https://github.com/luofanghao9784/mengine-app/compare/main...fix/ct-045-customer-session-before-csrf

共享电脑是 Linux。克隆不在 `$HOME/mengine-app` 时，只改 `REPO` 或 `cd` 的目录，不改 remote。

`git status` 若已有别人的改动：`git stash push -u -m "ct-045-before"`，做完回到原分支再 `git stash pop`。`git pull` 或 `stash pop` 出现 `CONFLICT`：把 `git status` 原文交给 DQ，自己不解。`git push` 被拒：`git pull --rebase` 一次再执行上面的 push；仍冲突则停。禁止 `git push --force`、`-f`、`--force-with-lease`。

未合入时退回：`git switch main && git branch -D fix/ct-045-customer-session-before-csrf`。
