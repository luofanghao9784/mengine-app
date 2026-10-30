# ADR-B8：第四端边界——统一 agent 管理平台

| 字段 | 内容 |
| --- | --- |
| 状态 | **已裁定；专家·架构逻辑有条件通过（2026-10-30），B1–B3 必改与四条建议已并入**（DQ 四项裁定已写入）。纯文档，不改业务代码 |
| 日期 | 2026-10-30 |
| 作者 | 梦擎·系统架构 |
| 基线 | `/workspace/dreamcore` main `a2a41d5`（#11，包含 #12/#13） |
| 上游 ADR | ADR-B1/B2 follow-up2（本目录 `docs/architecture/backend-v0/`）；前端模块边界 ADR D1–D5；乙表面落点；契约分片提纲；三态 ADR |
| 必审 | 专家·架构逻辑（依赖方向、五维、契约）+ 测试审查联签；安全审查（身份域、会话、授权）；交付运维（入口、健康检查）；发布验收（页面编号） |

> 约定：〔DQ 已定〕= 已有书面裁定；〔待 DQ 裁定〕= 本文给建议，未定（定稿版已无此项）；「未找到」= 在基线与本地稿中查不到，不作推断。引用格式 `文件:行`。

---

## 1. 背景（Context）

### 1.1 老板定调：三端 → 四端

- 审查流程 v1.1 已把「三端」改为「四端」：在 platform-admin / tenant-admin / workspace 之外新增**统一 agent 管理平台，单独入口、单独登录，入口路径待定**（`梦擎审查门禁与分工流程-v1.1.md:264`，位于 `/cursor/stores/store-ad9464e8-…/dreamcore-qa/`；本地 `/workspace/dreamcore-review-process/` 下**未找到**该文件）。
- 发布验收对四端有一票否决，包括「任一端不可用」（同上 `:30`）；I 类里程碑要求四端均可访问（`:141`）；第四端页面编号由发布验收补充（`:163`）；健康检查要求四端入口 200，第四端「路径待定」（`:168`）。
- 产品定位与五维：follow-up2 ADR-B1 已写入总负责人原话「模型在统一 agent 管理平台**按照企业端功能**进行管理」，五维为企业端业务功能（主维/触发维）、模型/厂商、运行时类型、版本、租户/企业（授权边界），**不含环境**（`dreamcore-backend-arch-followup2/ADR-B1-首版边界-新包与只读上游.md:91-106`）。功能码独立列、`Capability ≠ 功能码`（同上 `:110-111`）；租户维是授权边界而非筛选条件（同上 `:175`）；替换只影响之后新调度的 attempt（同上 `:82`）。

### 1.2 现状：三端（+总部支持）如何独立入口、独立登录

| 事实 | 位置 |
| --- | --- |
| 每端一个 HTML 入口，构建输入写死 7 个 HTML，无第四端 | 仓根 `vite.config.ts:8-16`（`input` 数组 :8，条目 :9-15，收尾 :16）；注：`site/vite.config.ts:18` 是官网/演示站点的另一构建（`index/demo/login`），**不是**四端应用入口 |
| 各入口以 `data-surface` 区分，共用 `src/identity/main.tsx` | `platform-admin/index.html:12`；`tenant-admin/support/index.html:12` |
| `main.tsx` 白名单只接受 `workspace / tenant-admin / platform-admin / headquarters-support`，否则抛 `Unknown entry` | `src/identity/main.tsx:20-22` |
| 两个会话域：`platform-admin` 与 `headquarters-support` 走 `realm='platform'`，其余走 `customer` | `src/identity/main.tsx:26-31`；`src/identity/session.tsx:31-37` |
| platform-admin 渲染 `PlatformApp`，总部支持渲染 `SupportApp`，workspace/tenant-admin 走 `AccessApp` | `src/identity/main.tsx:33-39` |
| `Surface` 类型只有三值；`entryHref` 按 `../${surface}/` 拼路径 | `src/identity/AccessApp.tsx:65`、`:72-73` |
| platform-admin 可见性取 `identity.platformAdmin`；客户端按租户成员关系 | `src/identity/AccessApp.tsx:360`、`:366-376` |
| 平台会话**专用 cookie**，注释明确「不替换、不失效企业/员工会话」 | `apps/api/.../identity/PlatformIdentity.java:16` |
| 平台 cookie 路径 `/api/platform-admin/`（常量 `PATH`）；名称默认 `DREAMCORE_PLATFORM`，启动时拒绝与客户 cookie 同名 | `PlatformIdentity.java:20`（PATH）、`:30`（cookie 名默认值）、`:32`（同名拒绝） |
| cookie 属性：HttpOnly、SameSite=Strict、Secure 跟随请求、`Cache-Control: no-store` | `PlatformIdentity.java:42-44`（方法头 :41） |
| 会话校验要求账号持有 `platform_roles.role='PLATFORM_ADMIN'` | `PlatformIdentity.java:60` |
| 平台安全链：`securityMatcher("/api/platform-admin/**")`、无状态、关闭框架 CSRF 改自管、匿名端点白名单、授予 `ROLE_PLATFORM_ADMIN` | `apps/api/.../identity/PlatformSecurity.java:27-28`、`:31`、`:33`、`:44` |
| 总部支持代入链：`/api/platform-admin/v1/support-access/*/api/**` | `apps/api/.../support/SupportSecurity.java:30` |
| `/me` 返回 `platformAdmin` 布尔，取值查 `platform_roles.role='PLATFORM_ADMIN'` | `apps/api/.../identity/IdentityService.java:27`、`:119` |
| 部署健康检查目前只列三端 | `/workspace/dreamcore-ops-evidence/deploy-plan.md:89` |
| nginx 方案按端写 `location /<surface>/ { try_files … }`，未列第四端 | `deploy-plan.md:114` |
| 平台角色体系：仅 `PLATFORM_ADMIN` 单一角色；授予写 `platform_roles` 并递增 `management_version`；撤销有「最后一名管理员」保护 | `dreamcore-roles-inventory.md`（本地，10:15 已交）；源码 `PlatformStaffService.java:33`（判定）、`:138`（授予+版本递增）、`:95`（`LAST_PLATFORM_ADMIN`）、`:96-97`（撤销）；`PlatformIdentity.java:60`（会话校验）、`:181` 与 `IdentityService.java:172`（写入角色） |
| 租户 DB 角色仅 `TENANT_ADMIN`/`MEMBER`；展示角色 OWNER/ADMIN/MEMBER 由映射得出（OWNER 取 `tenant_governance.owner_id`，`TENANT_ADMIN`→"ADMIN"）——**DB 角色与展示角色不混用** | `apps/api/.../audience/WorkAudienceService.java:43` |
| 总部支持会话 mode 只有 `ADJUSTMENT`/`TEST` | `apps/api/.../support/SupportAccess.java:26` |
| 第四端的任何代码、路由、契约 | **未找到** |

结论：仓内已有「**同一账号库 + 按端独立 cookie/路径/安全链**」的成熟模式（平台域与客户域分离）。第四端应**复用这一模式**，而非另建身份服务。

### 1.3 已合/已定的相关边界

- 乙表面：platform = 能力登记与准入；tenant = 调试、配置、运行与回退；workspace = B6/B7 只读（`docs/architecture/乙表面落点-platform登记-tenant运维.md:6`、`:13-17`）。新页不复用旧 governance id（同上 `:23`）。平台登记权 ≠ 客户正文访问权（同上 `:27`）。
- 契约分片：`capability-registry` 标为 platform 表面（`docs/architecture/契约分片-检查与能力.md:11`），端点示意 `.../platform-admin/v1/capabilities` 等（同上 `:67`），非目标「Agent 市场、拖拽编排、读客户正文」（同上 `:69`）；准入枚举 `candidate|admitted|deprecated`（同上 `:28`）、`admissionTestVerdict` 独立字段（同上 `:29`）。
- A1 路由原定 `#admin=capability-admission`（`dreamcore-首版必验页-路由与权限.md:15`，本 ADR 裁定后作废，见 D8-1）；A2 总部支持只读、后端强制（同上 `:49`、`:56`，DQ 裁定）。
- 后端包：`com.dreamcore.workspace.capability`（端口、`capability.registry` 解析、`capability.adapter`）、`upstream.UpstreamReadPort`、`qualityops` 只依赖两端口（`ADR-B2-统一Capability执行端口.md:170-174`）；依赖规则 1–3（同上 `:177-180`）；ProcessBuilder 只在 `capability.adapter..`（同上 `:181`）。
- 前端：Live 不得依赖 Demo（D1）、`shared` 不知会话（D2）、每 surface 一份路由模块（D5）（`docs/architecture/ADR-前端模块边界-演示与正式分家.md:32-36`、`:40-42`、`:57-61`）；门禁三规则（`docs/architecture/dependency-cruiser.md:19-23`）；允许清单只减不增（同上 `:35-41`）。

**冲突点（已由本 ADR + DQ 裁定消解）**：已合文档把「能力登记与准入」放在 platform 表面；老板的四端定调把「按企业端功能管理模型/agent」放进统一 agent 管理平台。二者语义重叠，必须由本 ADR 定唯一写入口，否则出现同一实体两处可写。

---

## 2. 决策（Decision）

### D8-1 职责边界：第四端是五维登记与实现生命周期的**唯一写入口**

| 实体 / 动作 | 唯一写入口 | 只读方 | 禁止 |
| --- | --- | --- | --- |
| 企业端功能目录 `EnterpriseFunction`（kebab-case 闭集，代码常量，见 D8-5） | **代码**（不经任何端写） | 第四端、tenant-admin | 任何端运行时增删 |
| `Capability`（某功能下的实现族） | **第四端** | tenant-admin（可绑定列表） | platform-admin 写 |
| `ModuleVersion`（含模型/厂商、运行时类型、版本、限额） | **第四端** | tenant-admin | 改写已 admitted 版本的不可变字段（只能出新版本） |
| 准入测试 `AdmissionTestRecord` 发起与结论 | **第四端** | — | 用客户正文作样本（乙:27） |
| 准入状态迁移 candidate→admitted→deprecated、强制下线 | **第四端**（强制下线需权限码+审计，DQ 裁定） | tenant-admin A4/A5 显示 deprecated 提示 | 自动切换已发布配置 |
| 租户授权 `CapabilityTenantGrant`（五维之「租户/企业」） | **第四端** | tenant-admin（仅见本租户被授权集合） | 租户自授；请求体带 tenantId |
| 本租户启停（仅限已授权版本）`TenantModuleEnablement` | **tenant-admin**（`QUALITY_OPS_MODULE_ENABLE_TENANT`） | 第四端（只读聚合） | 新增授权、越过授权、启用未授权/已下线版本；与 `CapabilityTenantGrant` 是**两个实体**，写者各一（授权=第四端，启停=tenant-admin） |
| 替换策略（新版本对新调度生效） | **第四端**（发布新 admitted 版本 + 授权） | — | 改写进行中 attempt（B1:82） |
| 检查流程配置、发布、回退（A3/A4） | **tenant-admin** | workspace B6/B7 只读投影 | 第四端代租户发布（首版不允许，DQ 已定） |
| 单模块调试（A2）、运行记录/重试（A5） | **tenant-admin** | 第四端只看**聚合**（无正文），首版不做 | 第四端触发租户运行 |
| 平台账号、租户开通、平台人员（含授予/撤销 `AGENT_ADMIN`） | **platform-admin**（现状） | — | 第四端管理平台账号 |
| 权限码主体：`QUALITY_OPS_MODULE_REGISTER`、`QUALITY_OPS_MODULE_RETIRE`、`QUALITY_OPS_MODULE_ENABLE_GLOBAL`、`QUALITY_OPS_LIMITS_CEILING` | **第四端 `AGENT_ADMIN`**（见 followup2 `S-07-real模式权限码与审计字段-定稿.md`） | tenant-admin 只持 `QUALITY_OPS_MODULE_ENABLE_TENANT`、`QUALITY_OPS_LIMITS_TIGHTEN` | `PLATFORM_ADMIN` 持有（独立，不包含） |

**A1 的去留（论证）**

- 选项 A：A1 整体迁入第四端，platform-admin 不保留能力页，只在导航放「统一 agent 管理平台」外链。
- 选项 B：A1 迁入第四端写，platform-admin 保留只读视图。
- 选项 C：A1 留 platform-admin，第四端只做模型/agent 部分。→ 否决：同一 `ModuleVersion` 的准入与模型维被拆到两端写，正是要消除的双写。

**〔DQ 已定〕选 A**：A1 整体迁入第四端，编号仍为 A1，platform-admin 只保留外链。理由：①四端定调后「能力登记」就是第四端的核心职能，在 platform-admin 留只读副本是第二份 UI、第二套路由、第二组验收截图，却没有用户需要（平台管理员若需查看，可登录第四端）；②只读视图也要接 `capability-registry` 读接口，等于给 platform 会话开第二条读路径，扩大授权面；③A1 尚未实现（路由对照表仍为「待命」，`企业数据基座-路由对照-S0.md:19`、`:135`），迁移成本为零。A1 的**验收编号沿用 A1**，表面改为第四端，路由改为第四端内的 `#view=capability-admission`（见 D8-3），由发布验收确认编号。

后果：`乙表面落点:13` 与 `契约分片:11` 中「platform」表面需改为「agent-admin」（文档修订 PR，见 §7）；`首版必验页-路由与权限.md:15` 的 `#admin=capability-admission` 作废，替换为第四端路由。

### D8-2 身份域与登录：复用账号库，**独立会话域**

1. **谁能登录**：持有平台角色 `AGENT_ADMIN`（新增于现有 `platform_roles` 表，与 `PLATFORM_ADMIN` 并列）的平台人员账号。租户账号（customer 域）**一律不能登录**第四端。
2. **与 `PLATFORM_ADMIN` 的关系**：**独立，互不包含**。`PLATFORM_ADMIN` 不自动获得第四端；由 `PLATFORM_ADMIN` 在 platform-admin 人员管理中授予/撤销 `AGENT_ADMIN`（沿用 `PlatformStaffService` 的授予与 `management_version` 递增机制，`PlatformStaffService.java:138`）。理由：最小权限；能力准入（决定什么代码/模型能对租户运行）与平台运营（开租户、管账号）是不同风险面；首版人员少时一人可同时持两角色。首个 `AGENT_ADMIN` 的种子方式与 `PLATFORM_ADMIN` 一致，只种首个，其余经授予（与 roles-inventory 结论一致）。**〔DQ 已定〕`AGENT_ADMIN` 与 `PLATFORM_ADMIN` 独立，互不包含**（持一个不隐含另一个；同一人可同时被授予两者）。
3. **单独登录的实现**：复用身份服务与账号/口令校验，**会话隔离**：
   - 新 cookie `DREAMCORE_AGENT`，`Path=/api/agent-admin/`，HttpOnly、SameSite=Strict、Secure，与客户 cookie、平台 cookie 三者互不同名（照 `PlatformIdentity.java:30-32` 的启动期同名拒绝，扩展为三者两两不同）。
   - 新安全链 `securityMatcher("/api/agent-admin/**")`，无状态、会话绑定 CSRF、授予 `ROLE_AGENT_ADMIN`；与平台链同构（`PlatformSecurity.java:27-44`）。
   - 会话存储（**DQ 并入，后端答复采纳**）：**新建独立表，不在现有会话表上加 `realm` 列**。照 `db/migration/V55__platform_identity_sessions.sql` 的 `platform_accounts`/`platform_sessions` 先例（已核实）：
     - `agent_platform_accounts(account_id uuid PRIMARY KEY REFERENCES accounts(id), login_name … UNIQUE, password_hash, credential_version, created_at)`；`agent_platform_sessions(token_hash char(64) PRIMARY KEY, csrf_hash char(64) NOT NULL, account_id → agent_platform_accounts, credential_version, expires_at)` + 过期索引。〔表名暂定，PR 时与后端开发确认〕
     - **触发器禁止跨域**：照 V55 `reject_platform_membership`（BEFORE INSERT OR UPDATE ON tenant_memberships → RAISE），agent 账号不得成为租户成员；并在 `agent_platform_accounts` 上 BEFORE INSERT 拒绝已在 `platform_accounts` 中的账号、反向同理（第四端与平台域凭据不共用）。〔是否允许同一人持两套独立账号由后端开发确认，与 D8-2 第 2 点「可同时持两角色」一致〕
     - **级联吊销**：照 V55 三个 AFTER 触发器——撤销 `AGENT_ADMIN` 角色（AFTER DELETE ON platform_roles，限 role='AGENT_ADMIN'）、改口令/`credential_version`（AFTER UPDATE ON agent_platform_accounts）、账号 `status` 变化（AFTER UPDATE OF status ON accounts）→ 删除该账号全部 `agent_platform_sessions`；恢复角色不复活旧会话。
     - **复用公共令牌哈希与 CSRF 工具**：令牌哈希用 `IdentityService.hash`（`IdentityService.java:55`），随机令牌与会话绑定 CSRF 照 `PlatformIdentity.java:37-38`、`:67-69`、`:74-85`（`hash("csrf:"+token)` + 常量时间比较）；不得另写哈希/CSRF 实现。
     - 校验 SQL 只查 `agent_platform_sessions` 且账号当前持 `AGENT_ADMIN`。**持平台 cookie 访问 `/api/agent-admin/**` 一律 401**，反之亦然。
   - 前端 `SessionProvider` 增 `realm='agent'`，使用独立 client 与独立 `CHANGE_KEY`（照 `session.tsx:36-37`），登出只清本域。
4. **原则落地**：
   - **租户只从认证上下文推导**：第四端是平台域，**会话中没有租户**。凡涉及租户的操作只有「授权某版本给租户 X」，X 是**被管理对象**（路径参数），不是执行作用域；第四端**不构造 `ExecutionScope`**，因此不能以任何租户身份执行。
   - **首版不允许平台代租户执行或发布**：第四端无任何调用 `qualityops` 执行/发布的路径（D8-4 ArchUnit 规则 R-B8-3 强制）；准入测试只用平台合成样本，走 `ExecutionScope.platformAdmission()`（专用作用域，无 tenant/space，`UpstreamReadPort` 对其恒拒），由安全审查定名。
   - **总部支持会话只读**：总部支持会话（`SupportSecurity.java:30`）**不能进入第四端**；第四端也不提供代入租户功能。
   - 所有写操作审计：写入 `qo_audit_event`（只追加，S-07 定稿 Q-C），`actor_role=AGENT_ADMIN`、`actorRealm=agent`、`trace_id`、目标实体、前后值摘要；字段以 S-07 定稿「全域必填 19 项 + 按域必填」为准。`QUALITY_OPS_MODULE_RETIRE` 强制四眼（发起人≠批准人，均为 `AGENT_ADMIN`，S-07 定稿 Q-F）→ 首版演示须准备两个 `AGENT_ADMIN` 账号。

### D8-3 入口路径

- 前端：**`/agent-admin/`**（`agent-admin/index.html`，`data-surface="agent-admin"`）。**〔DQ 已定〕**
- API：**`/api/agent-admin/v1/**`**〔DQ 已定〕；cookie Path `/api/agent-admin/`。
- 一致性：与 `/workspace/`、`/tenant-admin/`、`/platform-admin/` 同为「一级目录 = 表面名 = data-surface = API 前缀段」（对照 `PlatformIdentity.java:20`、`AccessApp.tsx:72-73`）；kebab-case；不用 `/agent/`（易与 workspace 内 agent 会话混淆）、不用 `/platform-admin/agents`（会共享平台 cookie 路径，破坏会话隔离）。
- 页内路由：`#view=capability-admission`（A1 迁入，子视图 `&tab=catalog|versions|admission-tests|grants`）；首页 `#view=functions`（按企业端功能浏览）。路由模块按 D5 一份 `agent-admin` 路由表。
- 备选名（已不采用）：`/agent-platform/`、`/agents-admin/`。

### D8-4 后端分层与依赖方向

**新顶层包 `com.dreamcore.workspace.agentregistry`**（与 `capability`、`upstream`、`qualityops` 同级，遵循 B2:172 的「一功能一顶层包」）：

| 子包 | 内容 |
| --- | --- |
| `agentregistry.api` | `/api/agent-admin/v1/**` 控制器、DTO |
| `agentregistry.app` | 登记、版本、准入、授权、下线的应用服务；审计 |
| `agentregistry.domain` | `Capability`、`ModuleVersion`、`AdmissionTestRecord`、`CapabilityTenantGrant` |
| `agentregistry.persistence` | 表访问（唯一写这些表的位置） |
| `agentregistry.adapter` | 实现 `capability.registry.CapabilityCatalogPort`（只读） |
| `agentregistry.security` | 安全链、会话（或置于 `identity` 下，以安全审查意见为准） |

**写读分离**：`capability.registry` 只定义只读端口 `CapabilityCatalogPort`（按 `ExecutionScope` 解析「当前租户可用的 ModuleVersion」），由 `agentregistry.adapter` 实现。即 **`agentregistry → capability`（实现端口、调用 `CapabilityExecutionPort` 跑准入测试）**，`capability` 不知道 `agentregistry`。tenant 侧 `qualityops` 经 `capability` 端口读可绑定版本，**不直接依赖 `agentregistry`**。

```text
identity ←─────────── agentregistry.security
                         │
agentregistry ──────▶ capability（端口：CapabilityExecutionPort、CapabilityCatalogPort）
                         ▲
qualityops ──────────────┘ ──▶ upstream（UpstreamReadPort）
（qualityops ✗ agentregistry；agentregistry ✗ qualityops / upstream / material / knowledge）
```

**ArchUnit 规则草案**（与 B2:177-180 规则 1–3 同一测试类，PR1 风格，默认 CI 执行，禁 skip）：

```java
// R-B8-1 capability 不知道登记写侧
noClasses().that().resideInAPackage("..workspace.capability..")
  .should().dependOnClassesThat().resideInAPackage("..workspace.agentregistry..");
// R-B8-2 租户应用层不直接依赖登记写侧（只经 capability 端口）
noClasses().that().resideInAPackage("..workspace.qualityops..")
  .should().dependOnClassesThat().resideInAPackage("..workspace.agentregistry..");
// R-B8-3 第四端不得触达租户执行/发布、客户数据
noClasses().that().resideInAPackage("..workspace.agentregistry..")
  .should().dependOnClassesThat().resideInAnyPackage(
      "..workspace.qualityops..", "..workspace.upstream..",
      "..workspace.material..", "..workspace.knowledge..", "..workspace.governance..");
// R-B8-4 登记表唯一写者：持久化类只在 agentregistry.persistence（类名规则只是辅助；SQL 层由下方 CI grep 门禁兜底）
classes().that().haveSimpleNameEndingWith("RegistryRepository")
  .should().resideInAPackage("..workspace.agentregistry.persistence..");
// R-B8-5 子包分层（api→app→domain；adapter/persistence→domain），禁止反向；agentregistry.security 归 Api 层（只被 Spring 安全链装配，不被 app/domain/infra 依赖）
layeredArchitecture().consideringOnlyDependenciesInLayers()
  .layer("Api").definedBy("..agentregistry.api..", "..agentregistry.security..")
  .layer("App").definedBy("..agentregistry.app..")
  .layer("Domain").definedBy("..agentregistry.domain..")
  .layer("Infra").definedBy("..agentregistry.persistence..", "..agentregistry.adapter..")
  .whereLayer("Api").mayNotBeAccessedByAnyLayer()
  .whereLayer("App").mayOnlyBeAccessedByLayers("Api")
  .whereLayer("Infra").mayOnlyBeAccessedByLayers("App");
// R-B8-6 无环
slices().matching("com.dreamcore.workspace.(*)..").namingSlices("$1")
  .that().haveNameMatching("agentregistry|capability|qualityops|upstream")
  .should().beFreeOfCycles();
// R-B8-7 ProcessBuilder 规则不变：agentregistry 内零例外（沿用 B2:181）
```

**登记表归属与唯一写者（架构逻辑 B3）**

| 表（V190+ `qo_*` 族，PR3 建表） | 唯一写者包 | 读侧 |
| --- | --- | --- |
| `qo_capability` | `com.dreamcore.workspace.agentregistry.persistence` | 只经 `CapabilityCatalogPort` |
| `qo_module_version` | 同上 | 同上 |
| `qo_capability_tenant_grant` | 同上 | 同上 |
| `qo_admission_test_record` | 同上 | 第四端自身 |
| `agent_platform_accounts`、`agent_platform_sessions`（第四端身份/会话，非登记表；V55 先例；〔表名 PR 时与后端开发确认〕） | `com.dreamcore.workspace.agentregistry.security`（身份写入复用 identity 公共工具，不经 platform 会话表） | 第四端安全链 |
| `qo_tenant_module_enablement`（本租户启停，非登记表） | `com.dreamcore.workspace.qualityops.persistence` | qualityops |
| `qo_check_task`/`qo_check_attempt`/`qo_debug_run`/`qo_data_version`、`qo_audit_event`（只追加） | qualityops（审计由 qualityops 与 agentregistry 经共享只追加写入器 `INSERT`，不 UPDATE/DELETE） | 各自 |

- PR3 建表迁移在 `migration-common`，但表归属按上表，不因谁写迁移而变。〔表名 `qo_capability_tenant_grant`/`qo_admission_test_record`/`qo_tenant_module_enablement` 为本稿定名，PR3 与后端开发确认〕
- **CI grep 门禁**（PR1 加，与 ArchUnit 并列）：`qo_capability|qo_module_version|qo_capability_tenant_grant|qo_admission_test_record`（按词边界匹配）在 `**/agentregistry/persistence/**` 与迁移目录 `**/db/migration*/**` 之外的任一 `*.java`/`*.sql`/`*.xml` 中出现即失败（含字符串字面量）；反例探针验证会红（不提交探针）。
- **读侧只走 `CapabilityCatalogPort`**：qualityops 及其他包不得 SQL 直读上述登记表（门禁同上强制）。

隐式耦合禁令：不得以共享表绕过端口（qualityops 不得 SQL 直读登记表——R-B8-4 + CI grep 门禁）；不得以 Spring 事件从 agentregistry 驱动 qualityops 执行；替换生效只能通过「新 admitted 版本 + 授权」，由 `CapabilityCatalogPort` 在**新调度**时读取（B1:82）。

### D8-5 契约

| 分片 | 动作 | 写端 | 读端 |
| --- | --- | --- | --- |
| `capability-registry` | **复用并改表面**：platform → agent-admin；端点前缀 `/agent-admin/v1/…`（替换 `契约分片:67` 的 `/platform-admin/v1/…`）；新增 `enterpriseFunction`、`modelVendor`、`runtimeKind`、`CapabilityTenantGrant`、强制下线动作 | 第四端 | 第四端 |
| `check-flow-config` | **复用**；绑定时引用 `moduleVersionId`，新增只读字段 `admissionStatus`（显示 deprecated）与「本租户可绑定版本」列表端点（由 `CapabilityCatalogPort` 供数） | tenant-admin | tenant-admin |
| `quality-check-run` / `check-run-log` / `data-version-readonly` | 不变 | 各自 | 各自 |
| 新分片 | **不新增**（五分片保持；避免第六分片与 capability-registry 双写同一实体） | — | — |

字段（追加到 `契约分片:49-55` 的 `CapabilityModuleVersion`）：

```text
enterpriseFunction: EnterpriseFunction        // 独立列（B1:110），≠ capabilityId（B1:111）
modelVendor?: string                          // runtimeKind=model-agent 时必填；无密钥
runtimeKind: "in-process" | "local-process" | "model-agent"
CapabilityTenantGrant { moduleVersionId, tenantId(被管理对象，路径参数), isDefault, grantedBy, grantedAt }
```

- `runtimeKind` 契约闭集只有上列三值；B2 内部别名 `engine-http` **不对外暴露**（只在 capability 内部枚举，不进契约/API/登记字段）。

**默认版本唯一与解析确定（架构逻辑 B1）**：
- 部分唯一索引：`CREATE UNIQUE INDEX qo_capability_tenant_grant_one_default_uk ON qo_capability_tenant_grant (tenant_id, enterprise_function) WHERE is_default;`（表冗余存 `enterprise_function`，与所引 `module_version` 一致性由复合外键保证）。
- 解析：显式 `moduleVersionId` 优先；否则取该 `(tenant_id, enterprise_function)` 的 default；**无 default 时返回稳定错误码 `CAPABILITY_DEFAULT_NOT_CONFIGURED`（409）**，fail closed，不得任取一个。
- 用例：`grant_single_default_per_tenant_function`（同租户同功能第二个 default 被拒）、`resolve_without_default_fails_closed`（返回 `CAPABILITY_DEFAULT_NOT_CONFIGURED`）。

`EnterpriseFunction`（kebab-case **闭集**，代码常量；取值**以实施计划 PR2 取值清单为准**，`dreamcore-backend-impl-plan-v0/实施计划.md:170-180`）：
- 启用：`document-parse`、`table-compare`、`quality-check`（与步骤 id 一致，`契约分片:193`）。
- 预留不启用：`semantic-annotation`、`repair-suggestion`（契约中列出；登记/调度返回稳定错误码 `ENTERPRISE_FUNCTION_NOT_ENABLED`（422），与闭集外取值的 400 区分；用例 `enterpriseFunction_reserved_notEnabled`）。
- 第四端首版**演示登记闭环只用 `quality-check`**（D8-7）；`document-parse`、`table-compare` 以**登记种子**形式在第四端只读可见（不可编辑、不可新登记版本）；`table-compare` 在 Linux 上标「不可用」（`EXECUTION_RUNTIME_UNAVAILABLE`，B2 S-12，是否纳入 parser worker 由 ADR-B7 定）。
- **已确认**（专家·架构逻辑 2026-10-30：闭集五值、首版只用 `quality-check` 登记闭环、另两个启用值只读种子）。

`tenantId` 只以「被授权对象」出现在第四端授权端点路径中，**从不**作为执行作用域；客户侧契约仍不得含 `tenantId` 请求字段（PR2 验收项，DQ 已定）。

### D8-6 Demo/Live 与前端边界

- 第四端**全 Live**，不挂 Demo 入口，不 import `src/demo/` 或根上演示内核（D1）。
- 目录：`agent-admin/index.html`（壳）→ `src/features/agent-admin/`（页面、路由描述、client）→ 复用 `src/shared`（无会话）与 `src/platform`（fetch/CSRF/会话）。A1 页面写在 `src/features/capability-admission/`，由 agent-admin 壳装配（不再由 `PlatformConsole` 装配）。
- 需改的现有文件（PR 7a 范围内）：`vite.config.ts:8-16` 加入口；`src/identity/main.tsx:20-39` 白名单与分支加 `agent-admin`、`realm='agent'`；`session.tsx:31-37` 加 realm。
- **allowlist 不新增任何条目**（只减不增，`dependency-cruiser.md:35-41`）；新壳入口加进 `SHELL_ENTRIES`（这是壳登记，不是违规边，`dependency-cruiser.md:33`、`:41`）。
- 建议新增一条 depcruise 规则 `agent-admin-isolated`：`src/features/agent-admin/**` 不得 import `src/admin/TenantConsole*`、`src/identity/AccessApp*`、`conversation/**`；反向亦禁止。〔与测试审查定是否首版加〕
- 不改 platform-admin 外观，仅在其导航加一个外链（同窗口跳 `/agent-admin/`，需重新登录）。

### D8-7 首版范围

**最小可演示闭环（Live，空数据起步）**：

1. `AGENT_ADMIN` 登录 `/agent-admin/`（空库：除种子账号外无数据）→ 空状态页（无占位文案，给「登记第一个实现」按钮）。
2. 按企业端功能 `quality-check`（首版演示唯一可登记功能；`document-parse`/`table-compare` 为只读种子）登记 `Capability` 与 `ModuleVersion`（`runtimeKind=in-process`，如 `pii-regex/v1`，B1:125）。
3. 发起准入测试（平台合成样本，`executionMode=simulated`）→ `admissionTestVerdict=passed` → candidate→admitted。
4. 授权给某租户。
5. 该租户 tenant-admin A4 中可见并可绑定；未授权租户不可见（403/空列表用例）。
6. deprecated 标记 → A4/A5 显示提示，已发布配置继续运行（DQ 裁定）。

**后置**：模型 agent 实现上线（`model-agent` 真调用）、租户自带模型 key（DQ 已定首版不开放，仅预留）、跨租户运行聚合看板、替换灰度/百分比、预留功能码开放、agent 市场与编排（契约非目标）、第四端手机端深度适配之外的交互优化。

**对实施计划的影响**（基线 §11.10 = 28 人日，`dreamcore-backend-impl-plan-v0/实施计划.md:599-600`；定稿后总表见实施计划 §11.12a）：

| PR | 变更 | 增量人日 |
| --- | --- | --- |
| ADR-B8（本文）文档 PR | 新增；并修订乙表面:13、契约分片:11/67、首版必验页 A1 行 | +0.5 |
| PR1 ArchUnit | 加 R-B8-1…7（空包也可断言） | +0.25 |
| PR2 契约 | capability-registry 改表面与端点前缀、加三维字段与 Grant、`EnterpriseFunction` 闭集 | +0.5 |
| **新 PR 5b** 第四端身份域与登记写入口 | `AGENT_ADMIN` 角色、`DREAMCORE_AGENT` 会话与安全链、`agentregistry` 包、`CapabilityCatalogPort` 实现、审计；依赖 PR2、PR4a，位于 PR5 之后、PR6 之前（或与 PR6 并行） | +3 |
| PR 7a 前端 | 新壳 `agent-admin/`、realm、A1 页挂第四端（原挂 platform-admin 的工作量转移，不重复计） | +1 |
| PR 7 部署 | nginx `location /agent-admin/`、健康检查第四端 200、cookie Path 核对 | +0.25 |
| **合计** | | **+5.5 → ≈33.5 人日** |

关键路径变为：PR0 → 1 → 2 → 3 → 4a → 4b → 5 → **5b** → 6 → 7a → 7（原 `实施计划.md:387`）。若 5b 与 6 并行（不同人），关键路径只增约 1 人日。**〔DQ 已定〕第四端登录与写入后端单列为 PR 5b**（身份/安全面独立审；安全审查、架构逻辑、测试审查必审）。

### D8-8 部署与验收

- 远程预览：四端 `/workspace/`、`/tenant-admin/`、`/platform-admin/`、`/agent-admin/` 均返回 200；API `/actuator/health` 200；新增 `/api/agent-admin/v1/auth/csrf` 未登录 200（可匿名端点，作第四端 API 链路探活）。交付运维把 `deploy-plan.md:89` 与 `:114` 补第四端（本 ADR 定稿后）。
- 发布验收：第四端主路径（D8-7 第 1–6 步）+ 异常路径（空数据、租户账号登录被拒、平台 cookie 访问 401、总部支持会话不能进入、未授权租户看不到版本、强制下线无权限码 403）；桌面 1440/1280 + 手机 375/390/430（WebKit+Chromium）截图（流程 v1.1:141 后视口矩阵）。页面编号由发布验收补充（流程 v1.1:163），建议沿用 A1 并新增 G 前缀（G1 登录、G2 功能目录…）。

---

## 3. 备选（Alternatives）

| 备选 | 结论 | 理由 |
| --- | --- | --- |
| 第四端作为 platform-admin 内的一个 `#admin=` 视图 | 否决 | 违背老板「单独入口、单独登录」（流程 v1.1:264）；共享平台 cookie |
| 第四端独立身份服务/独立账号库 | 否决 | 重复建设；口令、邀请、禁用、最后管理员保护要再做一套；现有按域 cookie 模式已足够隔离 |
| 复用平台 cookie，仅前端分页 | 否决 | 会话不隔离，平台管理员自动获得准入权，违背最小权限 |
| 登记写侧并入 `capability` 子域（`capability.registry` 可写） | 否决（次选） | `capability` 是执行端口包，被 qualityops 依赖；把写侧、控制器、平台会话放进去，会让 qualityops 传递可达写入口，破坏 R-B8-2 的意图 |
| 新增第六契约分片 `agent-registry` | 否决 | 与 capability-registry 描述同一实体，双写风险 |
| A1 保留 platform-admin 只读视图（选项 B） | 备选 | 若 DQ 要求平台管理员不登录第四端也能看 |

## 4. 后果（Consequences）

正向：五维登记与实现生命周期只有一个写入口；平台运营与能力准入权限分离；第四端在依赖图上是叶子（只出不入），替换模型实现不波及租户包；契约仍五分片。

代价：多一套会话与安全链（安全审查面增加）；A1 表面变更需修订三份已合/已交文档；+5.5 人日；平台人员需第二次登录。

风险：

| 编号 | 风险 | 缓解 |
| --- | --- | --- |
| R12 | 第四端会话与平台会话串用（cookie Path/名称配置错误） | 启动期三名两两不同校验；跨域 cookie 401 用例 |
| R13 | 绕过端口直读登记表形成隐式耦合 | R-B8-4 + 审查清单 |
| R14 | 准入测试误用客户数据 | `platformAdmission` 作用域 `UpstreamReadPort` 恒拒；R-B8-3 |
| R15 | A1 表面变更导致发布验收清单与路由文档不一致 | 本文 §7 修订清单随 ADR PR 一起改 |
| R16 | 5b 产能不足拖慢关键路径 | 与 PR6 并行；R10 加人机制 |

## 5. 验收（Acceptance）

- [ ] ArchUnit R-B8-1…7 在默认 CI 绿，含反例探针验证会红（不提交探针）
- [ ] depcruise 门禁绿；allowlist 条目数不增
- [ ] 具名用例：`agentAdmin_loginWithCustomerAccount_rejected`、`agentAdmin_platformCookie_401`、`platformAdmin_agentCookie_401`、`supportSession_cannotEnterAgentAdmin`、`agentAdmin_noTenantInSession_cannotExecute`、`grant_unauthorizedTenant_notVisibleInA4`、`deprecate_publishedConfigKeepsRunning_noAutoSwitch`、`forceOffline_withoutPermission_403_audited`、`enterpriseFunction_outsideClosedSet_400`、`enterpriseFunction_reserved_notEnabled`、`grant_single_default_per_tenant_function`、`resolve_without_default_fails_closed`、`tenant_admin_cannot_enable_global`、`tenant_admin_cannot_raise_ceiling`；CI grep 登记表门禁绿；第四端会话：`agent_session_cross_realm_insert_rejected`（触发器拒跨域）、`agent_session_revoked_on_role_removal`、`agent_session_revoked_on_credential_change`、`agent_session_revoked_on_account_status_change`、`agent_session_uses_shared_token_hash_and_csrf`（ArchUnit/grep：agentregistry 不自实现 SHA-256/CSRF）
- [ ] 四端 + 第四端 API 健康检查 200，附命令输出与部署 SHA
- [ ] 发布验收第四端桌面+手机截图齐全、编号已补

## 6. 推翻条件（Reversal）

- DQ/老板裁定第四端不需单独登录 → 回退为 platform-admin 内视图，`agentregistry` 包保留，删 5b 中会话部分。
- 产品要求租户在第四端自助登记实现 → 重新设计身份域（需新 ADR，安全审查前置）。
- 实测 5b 超 5 人日或阻塞 I 类里程碑 → 首版 A1 暂留 platform-admin 写（单写入口不变），第四端二期上线；**触发时须同步改 S-07 定稿**中 `QUALITY_OPS_MODULE_REGISTER`（及 `_ENABLE_GLOBAL`/`_RETIRE`/`LIMITS_CEILING`）的持有主体。
- 模型 agent 实现需要按环境区分登记 → 违背「不含环境维」，须老板重定，不在本 ADR 内调整。

## 7. 文档修订清单（随 ADR-B8 文档 PR）

- `docs/architecture/乙表面落点-platform登记-tenant运维.md:6`、`:13`：platform → agent-admin（第四端）
- `docs/architecture/契约分片-检查与能力.md:11`、`:67`：表面与端点前缀
- `docs/architecture/企业数据基座-路由对照-S0.md:19`、`:135`：A1 落点
- `dreamcore-首版必验页-路由与权限.md:15`（本地稿）
- `deploy-plan.md:89`、`:114`（交付运维负责）

## 8. 自检

- 依赖单向：agentregistry → capability；qualityops → capability/upstream；无反向、无环（R-B8-1/2/3/6）✓
- 无同一实体两处可写：§D8-1 表每行唯一写入口；契约不新增重复分片；A1 不留可写副本 ✓
- 与 follow-up2 术语一致：`ExecutionScope`、`UpstreamReadPort`、`com.dreamcore.workspace.capability`、`capability.registry`、`moduleVersionId`、`admissionStatus`、`admissionTestVerdict`、`executionMode=simulated|real`、五维名称与「租户维=授权边界」✓
- DQ 四项已裁定并写入（D8-1 A1、D8-2 独立角色、D8-3 路径、D8-7 PR 5b）✓
- 同一实体一个写入方：模块登记/下线/全局启用只归 `AGENT_ADMIN`（第四端），与 S-07 定稿一致 ✓
- 术语与 followup2/S-07 定稿/实施计划一致：ADR-B7（容器 parser 沙箱，原口头 ADR-B3）、ADR-B8、`QUALITY_OPS_*` 权限码、`ExecutionScope`（含 `sessionKind`）、`enterpriseFunction` 五值 ✓
- 文件:行引用已逐条用 `sed -n` 对 main `a2a41d5` 核对（定稿修正 13 处，见 README）✓
