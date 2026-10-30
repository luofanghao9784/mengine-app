# CT-034-P1 替换登记 Stub 开放链（正式鉴权 + CSRF）

状态：架构已裁可跑 · 待 docs 入库后交老板 Mac Codex　｜　分支：`codex/ct-034-p1-stub-security-replace`　｜　**审查人（PR 后两人审）：架构逻辑 + 安全审查（主）+ 质量性能**　｜　基准：切单时最新 `origin/main`（须含 CT-034 `#14` 的 `CapabilityRegistryStubSecurity`）

> **硬前置**：任何 CT-034 **A 档落库 / 返回 201** 之前，本单必须先合入。可与 **CT-035** 同日或紧随；**不要**等登录薄片全部做完才挡门，也**不要**在本单合入前做 A 档。  
> **挂靠**：两周日切片·轨 A，挡在 D1 写接口薄片与 D2 真名单之间；`docs/codex-tasks/两周日切片-三轨并行-20261031.md`；验收句 **W1** 的门禁（还不是 W1 落库本身）。  
> **总负责人不代跑**；老板/后端岗在 Mac 自跑 Codex。模型 `gpt-6.1-sol`，思考强度 **high**。  
> **仓**：`luofanghao9784/mengine-app`。

规格依据：

- 硬门禁原文已在 [`CT-034-register-save-write-api-thin.md`](CT-034-register-save-write-api-thin.md)「架构已裁」第 5 条，以及 [`QUEUE.md`](QUEUE.md)「后端写接口硬性」第 1 条
- 现网开放链（main `#14`）：`apps/api/src/main/java/com/dreamcore/workspace/agentadmin/CapabilityRegistryStubSecurity.java`  
  `@Order(2)`，只匹配 `POST /api/agent-admin/v1/capabilities`，`csrf.disable()` + `anyRequest().permitAll()`
- 控制器仍是诚实 stub：`CapabilityRegistryController` 无会话也返回 501，`message` 为「登记保存还在开通中，请稍后再试」
- 测试现状：`CapabilityRegistryIntegrationTest.registeredControllerReturnsHonestChinese501WithoutSessionOrCsrf` 期望无会话、无 CSRF 也是 501
- 正式会话：CT-035（`docs/codex-tasks/CT-035-agent-admin-login-tenant-isolation.md`）。本单对接它的第四端会话；它未合时允许临时「须认证」门闸

> **脚注**：平台链 `PlatformSecurity` 也写了 `csrf.disable()`，但过滤器里用会话绑定的 `X-CSRF-TOKEN` 校验，并且除 csrf/login 外 `authenticated()`。本单要换成这种门闸。**禁止**留下「`permitAll` + 不再校验 CSRF」的开放链。无副作用 501 可以留下，但必须先过鉴权。

### 架构已裁

#### 后端四裁（2026-10-31，与 CT-035 相同，必须遵守）

1. **写口钉死 agent-admin**：`POST /api/agent-admin/v1/capabilities` 以及同资源写口只在 `/api/agent-admin/v1/...`。禁止改到 `/api/platform-admin/**`。契约旧的 platform 表面示意作废。OpenAPI 表面维持并注明 agent-admin（`contracts/public-api/capability-registry.openapi.json`）。
2. **独立链**：回会话用 `DREAMCORE_AGENT`，`Path=/api/agent-admin/`。独立 `SecurityFilterChain`，同构 `PlatformSecurity`。**禁止**挂回客户 `IdentitySecurity`。跨域 cookie → **401**。CT-035 已合则落入它的链；未合则本单最小门闸也必须是独立链，不得塞进客户链。
3. **未登录写 → 401 人话，禁止 501**：删除 `CapabilityRegistryStubSecurity` 的 `permitAll` + `csrf.disable()`，改回会话 + CSRF。无会话的写 **401** + 中文白话 `message`。**501 仅已登录且尚未落库**。
4. **Capability 补 `enterpriseFunction`**：在 `components.schemas.Capability`（`additionalProperties:false`，今日没有该字段）**增加** `enterpriseFunction`，`$ref` `#/components/schemas/EnterpriseFunction`（闭集：`document-parse`、`table-compare`、`quality-check`、`semantic-annotation`、`repair-suggestion`；演示只用 `quality-check`）。不要新造枚举，不要把路径改回 platform-admin。已通过鉴权与 CSRF 后：未知字段 **400** 人话，禁止静默丢弃。未登录仍先 401，不要先 400。缺必填字段按该 schema 现有 `required`（`capabilityId`、`name`）处理；不要擅自把 `enterpriseFunction` 改成 required。

1. **删或彻底替换** `CapabilityRegistryStubSecurity` 上对登记 POST 的 `permitAll` + `csrf.disable()`。该类可以删除；若保留文件，Bean 不得再对这条 POST `permitAll`。
2. 登记 POST 进入正式 `/api/agent-admin/**` 安全链（CT-035 的链，或本单等价的 Order 链）。Stub 今日是 `@Order(2)`，会抢在更后面的链之前把 POST 放行；不删掉它，后面的登录链够不到这条 POST。
3. **无会话 POST → 401** + 人话 `message`（例：「还没有登录，暂时不能登记」）。不要再 501。这条与平台链不同：平台过滤器往往先因 CSRF 失败返回 403。本单必须先区分「没有第四端会话 → 401」，「有会话但 CSRF 不对 → 403」。
4. **有会话、无 CSRF → 403**（或平台同等失败），人话，无堆栈。
5. **有会话且 CSRF 正确 → 到达现有控制器**。未落库时仍返回 **501** 与现有人话「登记保存还在开通中，请稍后再试」。**禁止 201**，禁止建登记表。
6. 若 CT-035 尚未合入：本单自己装上最小 `authenticated` + 会话绑定 CSRF，测试可用临时夹具账号。PR 正文写明「合入 CT-035 后改为 `AGENT_ADMIN` / `DREAMCORE_AGENT` 会话」。临时门闸也**禁止** `permitAll`。
7. **非范围**：A 档落库、返回 201、前端、人员 UI、企业侧消费（CT-036）、假 Live。登录四个端点若 CT-035 已在另一分支做，本单不要重写一套。

## ① 目标与范围

- **目标**：让 `POST /api/agent-admin/v1/capabilities` 不再匿名可达；未登录 401，登录后仍可诚实 501，但必须过鉴权与 CSRF。
- **增量边界**：
  1. 改或删 `CapabilityRegistryStubSecurity.java`，使该 POST 不再走开放链。
  2. 更新 `CapabilityRegistryIntegrationTest`：无会话不再期望 501；无会话期望 401；有会话无 CSRF 期望 403；有会话且 CSRF 正确才看到控制器的 501 与原文案。
  3. 邻接断言保持：`GET` 该路径不是开放成功；`POST` 旁路路径与 `/api/v1/me` 不被本单放行（今日测试是 GET 401、POST 旁路 403、`/api/v1/me` 401）。
  4. 控制器 501 文案可保留，且只在已登录 + CSRF 通过后出现。不要改成 201，不要写库。
  5. `contracts/public-api/capability-registry.openapi.json` 的 `Capability` 增加 `enterpriseFunction`；未知字段 400。
- **改哪些文件（允许）**：
  - `apps/api/src/main/java/com/dreamcore/workspace/agentadmin/CapabilityRegistryStubSecurity.java`（删或去掉开放链）
  - `apps/api/src/main/java/com/dreamcore/workspace/agentadmin/CapabilityRegistryController.java`（只加：已认证后的未知字段 400；未落库仍 501）
  - `apps/api/src/test/java/com/dreamcore/workspace/CapabilityRegistryIntegrationTest.java`
  - `contracts/public-api/capability-registry.openapi.json`（只补 `Capability.enterpriseFunction` 与表面说明，不改路径前缀）
  - 若 CT-035 的第四端安全链已在 main：只删 Stub，让 POST 落入该链；必要时只调整「无会话 401 / 无 CSRF 403」的先后顺序
  - 若 CT-035 未合：允许在 `com.dreamcore.workspace.identity` 或现有 agentadmin 包加**最小**认证链与测试夹具，PR 标明临时
- **不做什么**：不落库、不返回 201、不改前端、不新建 `qo_*`、不把口令写入迁移。

## ② 前置条件与分支名

- **⓪ 暂停令自查**：有或拿不准 → 立刻停，问 DQ。
- **依赖**：CT-034 C 档已在 main。宜紧跟 CT-035；CT-035 未合时用临时门闸，不得等待到 A 档才做。
- 正确仓：`~/Desktop/mengine-app-luofanghao9784`（origin=`luofanghao9784/mengine-app`）。

```bash
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || { echo 'ERROR: 错误 remote，停'; exit 1; }
git status
git switch main && git pull
test -f apps/api/src/main/java/com/dreamcore/workspace/agentadmin/CapabilityRegistryStubSecurity.java || { echo 'ERROR: 找不到 StubSecurity，停'; exit 1; }
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export POSTGRES_BIN="$(brew --prefix postgresql@18)/bin"
git switch -c codex/ct-034-p1-stub-security-replace
```

## ③ 完整 Codex 提示词

把下面整段交给 Codex（`$CODEX`，模型 `gpt-6.1-sol`，思考强度 **high**）：

```
你在梦擎仓库分支 codex/ct-034-p1-stub-security-replace 上工作。基准 origin/main。只做本单范围。执行单：docs/codex-tasks/CT-034-P1-stub-security-replace-auth-csrf.md。
硬门禁：docs/codex-tasks/CT-034-register-save-write-api-thin.md 架构已裁第 5 条；docs/codex-tasks/QUEUE.md 后端写接口硬性第 1 条。落库或返回 201 之前必须换掉开放链。本单只换门闸，不做落库。

现状（main #14）：
- apps/api/src/main/java/com/dreamcore/workspace/agentadmin/CapabilityRegistryStubSecurity.java
  @Order(2)，securityMatcher 仅为 POST /api/agent-admin/v1/capabilities，csrf.disable()，permitAll。
- CapabilityRegistryController 对该 POST 返回 501，message「登记保存还在开通中，请稍后再试」。
- CapabilityRegistryIntegrationTest.registeredControllerReturnsHonestChinese501WithoutSessionOrCsrf 期望无会话无 CSRF 也是 501。

【后端四裁】
1. 写口钉死 POST /api/agent-admin/v1/capabilities 与 /api/agent-admin/v1/... 。禁止改去 /api/platform-admin。契约旧 platform 示意作废；OpenAPI 表面跟 agent-admin，在 info.description 注明即可，不要换路径。
2. 会话 cookie DREAMCORE_AGENT，Path=/api/agent-admin/。独立 SecurityFilterChain，同构 PlatformSecurity。禁止挂回客户 IdentitySecurity。跨域 cookie → 401。
3. 删除 StubSecurity 的 permitAll + csrf.disable()，改回会话 + CSRF。未登录写 → 401 人话，禁止 501。501 只在已登录且未落库时返回。
4. Capability 保持 additionalProperties:false，在 components.schemas.Capability 增加 enterpriseFunction（$ref EnterpriseFunction 闭集，演示 quality-check）。未知字段 400 人话，禁止静默丢弃。未登录先 401，不要先 400。不要把 enterpriseFunction 改成 required（现 required 仍是 capabilityId 与 name）。

【要做成】
1. 删除 Stub 的开放链，或删掉整个 CapabilityRegistryStubSecurity。不得再 permitAll 这条 POST。独立链，禁止并进 IdentitySecurity。
2. POST 必须进入正式 /api/agent-admin/** 安全链：
   - 若 main 已有 CT-035 的第四端链（cookie DREAMCORE_AGENT、角色 AGENT_ADMIN）：不要另写一套登录。删掉 Stub 后，POST 落到那条链。测试用 AGENT_ADMIN 会话。
   - 若 CT-035 还未合：本单装最小门闸（须认证 + 会话绑定 CSRF，头 X-CSRF-TOKEN，哈希复用 IdentityService.hash）。测试夹具可以是临时账号。PR 正文写明随后切到 AGENT_ADMIN 会话。临时方案仍然禁止 permitAll。
3. 状态码：
   - 无第四端会话的 POST → 401，JSON message 人话，例：「还没有登录，暂时不能登记」。不要 501，不要堆栈。先判未登录，不要先因缺少 CSRF 打成 403。
   - 有会话但无/错 CSRF → 403，人话。
   - 有会话且 CSRF 正确 → 控制器 501，message 仍是「登记保存还在开通中，请稍后再试」。禁止 200/201，禁止写数据库。
4. 改 CapabilityRegistryIntegrationTest：
   - 去掉「无 CSRF 也 501」的期望。
   - 无会话 POST → 401，且 message 为中文白话。
   - 有会话无 CSRF → 403。
   - 有会话 + CSRF → 501 与原 message。
   - 保留邻接用例的精神：GET 该路径、POST 旁路、GET /api/v1/me 不得被放行。方法名可改，PR 里对照旧名写清。
5. 错误 JSON 保持 contractVersion、code、message、retryable。不要改 IdentityErrors 的全局文案去波及客户域。
6. 改 contracts/public-api/capability-registry.openapi.json：只在 Capability.properties 增加 enterpriseFunction（$ref EnterpriseFunction）。info.description 可加一句「写口表面=agent-admin，不用 platform-admin」。已认证且 CSRF 通过后，请求体出现 schema 未声明字段 → 400 人话（例：「有无法识别的字段，请检查后再提交」），不得忽略后仍 501。未登录不因字段返回 400。

【不许碰】
登记表与 201、src/** 前端、engine/**、workers/parser、已有 Flyway 文件、口令入库、force push、reset --hard、直推 main、gh issue。
禁止把写路径改成 /api/platform-admin。禁止把第四端过滤器注册进客户 IdentitySecurity。
不要重做 CT-035 的 csrf/login/me/logout，除非 main 上根本没有第四端链、而门闸又无法复用测试夹具——即便如此也只做最小认证，并在 PR 标明临时。
禁止改 Java 包名 dreamcore、/mengine-api、MENGINE_*。

【验收】
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export POSTGRES_BIN="$(brew --prefix postgresql@18)/bin"
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml test -Dtest=CapabilityRegistryIntegrationTest
禁止 -DskipTests。

curl（无 cookie）期望 401 不是 501：
curl -si -X POST "http://127.0.0.1:50831/api/agent-admin/v1/capabilities" \
  -H "Content-Type: application/json" \
  -d '{"enterpriseFunction":"quality-check"}'

【做完输出】git diff --stat、Stub 是删了还是替换了、POST 落在哪条 FilterChain、三类状态码实测、是否仍为临时夹具（若是，写明待切 AGENT_ADMIN）。确认没有 201、没有新表。
```

## ④ 推荐模型与思考强度

- 模型：`gpt-6.1-sol`
- 思考强度：**high**（安全主审；Order 和 401/403 顺序错了会继续裸奔，或把诚实 501 写成假 201）
- **预计耗时**：Codex 40–80 分钟；测试 15–30 分钟

## ⑤ 可复制 git 步骤（跑完如何提交）

```bash
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || exit 1
git add apps/api/src/main/java/com/dreamcore/workspace/agentadmin/CapabilityRegistryStubSecurity.java \
  apps/api/src/main/java/com/dreamcore/workspace/agentadmin/CapabilityRegistryController.java \
  apps/api/src/test/java/com/dreamcore/workspace/CapabilityRegistryIntegrationTest.java \
  contracts/public-api/capability-registry.openapi.json
# 若临时门闸落在 identity 包，按实际路径追加 git add，勿 git add -A
git diff --cached --stat | grep -E 'src/features/|workers/parser|migration' && echo 'ERROR: 前端/迁移非本单' && exit 1
git commit -m "$(cat <<'EOM'
fix(api): CT-034-P1 登记 POST 改为须鉴权与 CSRF

去掉 CapabilityRegistryStubSecurity 的 permitAll。未登录 401；登录后未落库仍 501。
EOM
)"
git push -u origin codex/ct-034-p1-stub-security-replace
gh pr create -R luofanghao9784/mengine-app --base main --head codex/ct-034-p1-stub-security-replace \
  --title "fix(api): CT-034-P1 登记接口改为鉴权与 CSRF" \
  --body "## 摘要
删除登记 POST 的 permitAll 开放链。未登录 401；有会话无 CSRF 403；有会话且 CSRF 正确才到控制器的 501。不落库、不返回 201。

## 后续
本单合入前禁止 CT-034 A 档。若本次仍是临时夹具，合入 CT-035 后改为 AGENT_ADMIN 会话。

## 审查
- 架构逻辑 + 安全审查（主）+ 质量性能
- 挂靠 ADR-B8 第四端写路径；验收句 W1 的门禁，不是 W1 本身
- 勿自动合并"
```

网页备用：https://github.com/luofanghao9784/mengine-app/compare/main...codex/ct-034-p1-stub-security-replace

## ⑥ 验收标准

| # | 标准 | 如何验 |
|---|---|---|
| P1 | 开放链消失 | 源码中该 POST 不再 `permitAll`；`rg permitAll` 打在 Stub 类上无匹配，或类已删 |
| P2 | 未登录 | 无 cookie `POST /api/agent-admin/v1/capabilities` → **401**，`message` 中文白话，不是 501 |
| P3 | CSRF | 有会话、不带 `X-CSRF-TOKEN` → 403 |
| P4 | 诚实 stub | 有会话且 CSRF 正确 → 501，文案仍是「登记保存还在开通中，请稍后再试」 |
| P5 | 不落库 | 无新表、无 201、响应无「已保存」 |
| P6 | 测试 | `CapabilityRegistryIntegrationTest` 按上表改完且绿 |
| P7 | 衔接 | PR 写明会话来自 CT-035 的 `AGENT_ADMIN`，或标明临时夹具及切换条件 |

## ⑦ 禁止操作 / 失败卡住

| 症状 | 动作 |
|---|---|
| remote 不是 mengine-app | 立刻停 |
| 有暂停令 | 不开 Codex；问 DQ |
| 找不到 StubSecurity | 停；不要新建一条 permitAll |
| 无会话仍是 501 | 未完成；开放链还在 |
| 无会话变成 403 而不是 401 | 调整顺序：先认会话，再查 CSRF |
| 出现 201 或新迁移 | 打回；本单禁止 A 档 |
| 与 CT-035 分支同时改安全链 Order | `git pull --rebase` 一次；仍冲突则停，发 DQ，不要两套 matcher 叠成再次 permitAll |
| 测试红 | 修到绿；禁止 `-DskipTests` |
| CONFLICT / push rejected | rebase 一次；仍失败停 |

**硬禁止**：

- 保留 `permitAll` + 不校验 CSRF 的登记 POST
- 在本单落库或返回 201
- `git push --force`、`git reset --hard`、直推 `main`
- 改前端、改包名、改 `/mengine-api`、改 `MENGINE_*`
- `gh issue`；口令进仓库
- 有暂停令仍开 Codex

回滚（未合入）：`git switch main && git branch -D codex/ct-034-p1-stub-security-replace`。

---

**DQ 审路径**：本文件 + CT-034 架构已裁第 5 条 + QUEUE 后端写接口硬性第 1 条。安全审查主审。通过后交老板/后端岗 Mac 粘贴③。建议开跑顺序：**本单与 CT-035 并行或紧随其后 → 本单合入后才允许 A 档落库**。总负责人不代跑。
