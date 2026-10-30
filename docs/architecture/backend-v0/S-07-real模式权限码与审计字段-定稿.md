# S-07 定稿：real 模式权限码与审计字段

> 梦擎·系统架构｜2026-10-30（北京时间）｜基线 main `a2a41d5`｜来源：安全审查草案 `/workspace/security-review/real模式权限码与审计字段-草案.md`（全文采纳，**不弱化**；本稿只做定名、定主体、定表）
> **状态：已双签（安全审查 ✅ 有条件、专家·架构逻辑 ✅ 有条件；条件均已并入本稿，2026-10-30）。代码按所挂 PR 逐个复验；对应 PR 合入前 real 模式一律拒绝**（`QUALITY_OPS_PERMISSION_DENIED`，与 ADR-B1 首版调试默认一致）。
> 标记：Q-A/B/D/E 来源：DQ 裁定 2026-10-30；〔与后端开发确认〕= 实现层确认，不改语义。
> 链接：ADR-B1「安全边界」、ADR-B2「安全决策 S-07」、`安全必改处理表-S01-S16.md` S-07 行、ADR-B8（[`ADR-B8-第四端边界-统一agent管理平台.md`](./ADR-B8-第四端边界-统一agent管理平台.md)）。

## 0. 已定口径（沿用草案 D1–D6）
D1 生产只跑 Linux；D2 首版不开放租户自带模型 key（只预留，不设权限码）；D3 tenantId 只从认证上下文推导；D4 parser 白名单代码硬编码，**ModuleVersion 只引用 recipeId**；D5 首版 Live 空数据；D6 平台/支持会话不代跑 real。
新增：**B8**——`AGENT_ADMIN` 为第四端独立平台角色，与 `PLATFORM_ADMIN` 互不包含（DQ 已定）。

## 1. 权限码全表（`QUALITY_OPS_*`，SCREAMING_SNAKE；代码常量，无集中注册表——ADR-B1 Q3）
| 定稿名 | 草案工作名 | 含义 | 持有主体 |
|---|---|---|---|
| `QUALITY_OPS_DEBUG_RUN` | CAPABILITY_RUN_DRY | simulated（dry）执行 | tenant-admin；MEMBER **默认不授予**，须租户管理员显式授予（Q-E） |
| `QUALITY_OPS_DEBUG_RUN_REAL` | CAPABILITY_RUN_REAL | real 执行（四条件，见 R3） | OWNER 默认；非 owner TENANT_ADMIN 与 MEMBER 须 `governance_capabilities` 显式授予；`PLATFORM_ADMIN`/`AGENT_ADMIN`/支持会话**一律不持有** |
| `QUALITY_OPS_PUBLISH` | EXECUTION_RESULT_PUBLISH | real 结果发布到生产表面；simulated 不可发布 | tenant-admin（OWNER 默认；非 owner 须授予） |
| `QUALITY_OPS_MODULE_REGISTER` | MODULE_VERSION_REGISTER | 登记 ModuleVersion（**只引用 recipeId**） | **仅 `AGENT_ADMIN`（第四端）** |
| `QUALITY_OPS_MODULE_ENABLE_GLOBAL` | MODULE_VERSION_ENABLE（全局部分） | 全局启停某 ModuleVersion | **仅 `AGENT_ADMIN`**（第四端）；tenant-admin ✗ |
| `QUALITY_OPS_MODULE_ENABLE_TENANT` | MODULE_VERSION_ENABLE（本租户部分） | 本租户启停**已授权**版本 | tenant-admin（本租户；只能开关已授权且全局启用的版本，不能新建/新增授权/越过授权）；`AGENT_ADMIN` ✗ |
| `QUALITY_OPS_MODULE_RETIRE` | （新增） | 全局强制下线，不可逆 | **仅 `AGENT_ADMIN`，强制四眼（Q-F）** |
| `QUALITY_OPS_LIMITS_CEILING` | EXECUTION_LIMITS_ADJUST（上限部分） | 设平台资源上限 | **仅 `AGENT_ADMIN`**；tenant-admin ✗ |
| `QUALITY_OPS_LIMITS_TIGHTEN` | EXECUTION_LIMITS_ADJUST（收紧部分） | 本租户在上限内**只收紧** | tenant-admin（本租户）；放宽或超上限 → 400 |
| `QUALITY_OPS_RESULT_READ` | EXECUTION_RESULT_READ | 读本租户结果 | tenant-admin、本 workspace 成员；支持会话只读且审计 |
| `QUALITY_OPS_DIAGNOSTICS_READ` | EXECUTION_STDERR_READ | 读**清理后**诊断（不返回原始 stderr） | `AGENT_ADMIN`（跨租户读，每次入审计并记 `target_tenant_id`）；tenant-admin（本租户、清理后）；MEMBER ✗；支持会话可读结果与清理后诊断，**不含诊断 stderr 原文**（Q-B） |
| ~~local-process 登记~~ / ~~租户模型 key~~ | — | **不开放**（D4/D2） | — |

**作用域拆分（架构逻辑 S3）**：每个权限码只对应一种作用域，鉴权按码判定，不靠调用方判断作用域。

**拒绝码（3 个）**：`QUALITY_OPS_PERMISSION_DENIED`（403，通用）；`QUALITY_OPS_SUPPORT_READ_ONLY`（403，支持会话任一写，错误体固定 `{"code":"QUALITY_OPS_SUPPORT_READ_ONLY"}`，先判会话再查资源）；`MODULE_VERSION_RETIRED`（409，下线后新调度 fail closed，不静默改绑）。

**默认最小**：非 owner 的 TENANT_ADMIN 默认只有 `DEBUG_RUN`、`RESULT_READ`、`DIAGNOSTICS_READ`、`MODULE_ENABLE_TENANT`、`LIMITS_TIGHTEN`；`MODULE_ENABLE_GLOBAL`、`LIMITS_CEILING` 任何租户角色都不能被授予；`DEBUG_RUN_REAL`、`PUBLISH` 须 OWNER 显式授予。
**角色术语**：DB 角色只有 `platform_roles.role ∈ {PLATFORM_ADMIN, AGENT_ADMIN(新)}`、`memberships.role ∈ {TENANT_ADMIN, MEMBER}`；OWNER/"ADMIN" 是展示角色（`WorkAudienceService.java:43`），审计 `actor_role` 记 DB 角色 + `is_owner` 布尔。

## 2. 规则 R1–R8（草案原文采纳）
- R1 tenantId 只取认证上下文 + 路由并校验一致；请求体出现 `tenantId` → 400。
- R2 inputRef/moduleVersionId/inputVersionId 以 `tenant_id = ctx.tenant` 复查；不属本租户 → 404；权限不足 → 403。
- R3 `executionMode` 缺省 simulated；real 须同时：显式 `real` + `QUALITY_OPS_DEBUG_RUN_REAL` + 版本本租户已启用且未下线 + `real.enabled=true`（预览环境固定 false）。**本稿双签前 real 一律拒绝。**
- R4 生效 limits = min(平台上限, 租户值, 请求值)；超上限 → 400 不截断。
- R5 ModuleVersion 的**可执行定义只以 recipeId 引用**（附参数 schema）；五维登记字段（enterpriseFunction / modelVendor / runtimeKind / version / 租户授权）照 ADR-B8；出现 path/argv/env/image → schema 层拒绝。白名单为代码常量，只经代码 PR 修改（代码评审 + 两名 CODEOWNERS，见 S-02）。
- R6 鉴权在 Controller/应用服务；适配器不重复鉴权但必须拿到已校验 `ExecutionScope`（含 `sessionKind`）。
- R7 所有 real 请求带 Idempotency-Key，复用 `identities.priorRequest`。
- R8 先鉴权→再查资源→再执行；失败路径写审计（DENIED/FAILURE）。

**RETIRE 附加**：`reason`（必填 ≤500 字）、`confirmTargetVersionId`（=路径 ID）、`inFlight=let_finish|cancel`（无默认）、Idempotency-Key、**第二名不同 `AGENT_ADMIN` 批准**；不可逆，恢复只能登记新版本。

## 3. 审计（Q-C 定：新建只追加表 `qo_audit_event`）
- 位置：ADR-B1 V190+ `qo_*` 族，`migration-common`，**PR3** 落迁移。〔与后端开发确认〕
- 理由：V109 `identity_audit` 只有 AFTER INSERT、无防篡改触发器；身份审计与执行审计领域不同；不改现有表（B1「新表不改旧表」）。
- 事件（统一 `QUALITY_OPS_` 前缀）：`QUALITY_OPS_EXECUTION_REQUESTED/DENIED/COMPLETED/FAILED`、`QUALITY_OPS_MODULE_REGISTERED`、`QUALITY_OPS_MODULE_ENABLED_GLOBAL/DISABLED_GLOBAL`、`QUALITY_OPS_MODULE_ENABLED_TENANT/DISABLED_TENANT`、`QUALITY_OPS_MODULE_RETIRE_REQUESTED/APPROVED`、`QUALITY_OPS_MODULE_RETIRED`、`QUALITY_OPS_LIMITS_CEILING_CHANGED`、`QUALITY_OPS_LIMITS_TIGHTENED`、`QUALITY_OPS_RESULT_PUBLISHED`、`QUALITY_OPS_DIAGNOSTICS_VIEWED`、`QUALITY_OPS_SUPPORT_READ`。
- **全域必填 19 项**（逐个计数，`outcome` 与 `result_status` 分别计）：`id`、`occurred_at`(UTC)、`event`、`actor_realm`、`actor_id`、`actor_role`、`trace_id`、`request_id`、`capability`、`enterprise_function`、`module_version_id`、`recipe_id`、`mode`、`input_ref`、`input_sha256`、`effective_limits`(JSON)、`outcome`、`result_status`、`idempotency_fp`。（原稿「17 项」实列 18 名，已更正；新增 `enterprise_function`（S1，Capability≠功能码，审计须可按企业端功能追溯）、`actor_realm`（S2）；`tenant_id`/`space_id` 移入按域必填。）非执行类事件（登记/启停/上限/下线）的 `mode`/`input_ref`/`input_sha256`/`idempotency_fp` 记固定哨兵值 `n/a`，不得留空。〔与后端开发确认〕
- **按域必填（S2）**：`actor_realm ∈ {customer, platform, agent, support}`。
  - `customer`（租户内用户）/`support`（总部支持会话）：`tenant_id`、`space_id` **必填**。
  - `agent`（第四端 `AGENT_ADMIN`）：`tenant_id`、`space_id` **必须为 NULL**。
  - `platform`（`PLATFORM_ADMIN`）：`tenant_id`、`space_id` **必须为 NULL**（架构逻辑原文只明定 agent 域；platform 同属无租户上下文的平台角色，系统架构按同口径补定）。
  - **跨租户动作**（租户授权、`AGENT_ADMIN` 诊断读、RETIRE）另记必填 `target_tenant_id`；RETIRE 影响多租户时 `target_tenant_id` 为 NULL 并必填 `affected_tenant_count`（及条件必填中的受影响配置数/attempt 数）。
  - CHECK 约束草案：
    ```sql
    CONSTRAINT qo_audit_event_realm_tenant_ck CHECK (
      (actor_realm IN ('customer','support') AND tenant_id IS NOT NULL AND space_id IS NOT NULL)
      OR (actor_realm IN ('agent','platform') AND tenant_id IS NULL AND space_id IS NULL)
    ),
    CONSTRAINT qo_audit_event_cross_tenant_ck CHECK (
      event NOT IN ('QUALITY_OPS_DIAGNOSTICS_VIEWED','QUALITY_OPS_GRANT_CHANGED') OR actor_realm <> 'agent'
      OR target_tenant_id IS NOT NULL
    ),
    CONSTRAINT qo_audit_event_retire_ck CHECK (
      event <> 'QUALITY_OPS_MODULE_RETIRED' OR target_tenant_id IS NOT NULL OR affected_tenant_count IS NOT NULL
    )
    ```
    用例 `audit_realm_tenant_consistency`（PR3）：四域各插合法/非法组合，非法一律被 CHECK 拒绝。
- 条件必填：`delegated_by`（委托）、`support_session_id`（支持会话，`actor_id`=真实员工）、`approver_id`（RETIRE）、`duration_ms`（完成）、`error_class`（失败，枚举码）、RETIRE 的 `reason`/受影响租户数/配置数/`inFlight`/受影响 attempt 数。
- **禁止字段**：输入/输出原文、文档片段、PII；密钥、token、Authorization 头、模型 key、attempt 凭据（S-13）；原始 stderr、环境变量；本机绝对路径、job 目录名。
- **只追加实现（DQ 并入，后端答复采纳）**：
  - 主键 `id uuid PRIMARY KEY`（应用生成，非 bigserial）。
  - `occurred_at timestamptz NOT NULL`，**写入前截到微秒**（应用侧 `truncatedTo(MICROS)`，与 PostgreSQL `timestamptz` 精度一致，避免回读比对漂移）。
  - 索引 `CREATE INDEX qo_audit_event_tenant_time ON qo_audit_event(tenant_id, occurred_at);`（agent/platform 域 `tenant_id` 为 NULL 的行同样入索引；跨租户查询另按 `target_tenant_id` 视需要在 PR3 评估）。
  - 库层：`CREATE FUNCTION qo_audit_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'qo_audit_event is append-only'; END $$;` + `CREATE TRIGGER qo_audit_event_immutable BEFORE UPDATE OR DELETE ON qo_audit_event FOR EACH ROW EXECUTE FUNCTION qo_audit_event_immutable();`。写法先例（已对 main `a2a41d5` 核实）：只追加 `BEFORE UPDATE OR DELETE … RAISE` 的仓内先例是 `db/migration/V109__library_permissions.sql:52-54`（`library_event_immutable`）与 `V115__library_launch_boundaries.sql:100`；`V55__platform_identity_sessions.sql` 只提供 plpgsql `RAISE EXCEPTION` 触发器函数风格（`reject_platform_membership`，BEFORE INSERT OR UPDATE），**不含**只追加触发器。
  - 应用账号只授 `INSERT, SELECT`（`REVOKE UPDATE, DELETE, TRUNCATE`）；触发器与授权双层，任一层单独失效仍拒。
  - PR3 验收（与用例 12 `qo_audit_event_rejects_update_delete` 对齐，同一用例覆盖）：①应用账号 UPDATE/DELETE 被权限拒；②以表 owner 身份 UPDATE/DELETE 被触发器 RAISE；③`qo_audit_event_occurred_at_microsecond`（写入纳秒时间回读等于截断到微秒值）；④迁移断言主键类型为 uuid、存在 `(tenant_id, occurred_at)` 索引。
- **不可篡改**：应用 DB 角色仅 `INSERT, SELECT`（`REVOKE UPDATE, DELETE`）+ `BEFORE UPDATE OR DELETE` 触发器 `RAISE EXCEPTION`（见上）；可选 `prev_hash` 哈希链。租户退出/PURGE 时只假名化主体，不删审计。
- 保留期见 Q-D。

## 4. 负向用例（14 条，草案原样 + 定名）
1 body 他租户 tenantId→400+DENIED；2 路由 tenant≠主体→404/403；3 `quality_ops_cross_tenant_denied`；4 缺 executionMode→simulated；5 `debug_run_real_requires_explicit_mode_and_authz`；6 预览 `real.enabled=false` 请求 real→403；7 tenant-admin 登记→403；8 登记体含 argv/path/env→400；9 limits 超上限/放宽→400；10 MEMBER 读诊断→403、tenant-admin 诊断无路径/env；11 发布 simulated→409/400；12 **`qo_audit_event_rejects_update_delete`**；13 审计 canary grep 无原文/密钥；14 同 Idempotency-Key 异体→409。
另加（定稿新增，不计入 14）：`platform_or_agent_admin_real_run_denied`、`support_session_cannot_execute_or_publish_quality_ops`、`module_retire_requires_second_agent_admin`、`attempt_audit_fields_present`、`module_retired_new_dispatch_409`、`tenant_admin_cannot_enable_global`（tenant-admin 调全局启停 → 403，PR5b）、`tenant_admin_cannot_raise_ceiling`（tenant-admin 改平台上限 → 403，PR5b）、`audit_realm_tenant_consistency`（PR3）。

## 5. Q 项
| 项 | 定稿 | 依据/状态 |
|---|---|---|
| Q-A 发布者≠执行者 | **强制分离**：`QUALITY_OPS_PUBLISH` 拒绝发布本人执行的 real 结果 | DQ 裁定（与安全建议一致） |
| Q-B 支持会话读是否含诊断 | 支持会话「读」**不含诊断 stderr 原文**；可读结果摘要与清理后诊断，原始 stderr 一律拒 | DQ 裁定 |
| Q-C 审计表 | **新建 `qo_audit_event`**（PR3） | 本稿定；〔与后端开发确认〕 |
| Q-D 保留期 | **180 天在线 + 1 年归档** | DQ 裁定（与安全建议一致）；厂商侧留存仍待法务 |
| Q-E MEMBER 默认 `DEBUG_RUN`（dry） | MEMBER **默认不授予** dry run，由租户管理员显式授予；real 同样须显式授予 | DQ 裁定（改写原暂定） |
| Q-F RETIRE 四眼 | **强制**：两个不同 `AGENT_ADMIN`；演示需两个账号 | 本稿定（不可逆 + 跨租户） |
| Q-G 命名/注册表 | `QUALITY_OPS_*` 代码常量，PR2 契约列出 | 本稿定 |

## 6. 落 PR
PR2 契约（权限码、拒绝码、schema 禁字段）；PR3 `qo_audit_event`（uuid 主键、微秒截断、`(tenant_id, occurred_at)` 索引、只授 INSERT/SELECT）+ 触发器 + 用例 12 与 `qo_audit_event_occurred_at_microsecond`；PR4a `ExecutionScope.sessionKind`；PR5 用例 1–6、10–14 与支持会话用例；**PR5b** 第四端 REGISTER/`MODULE_ENABLE_GLOBAL`/`LIMITS_CEILING`/RETIRE + 两条越权用例 + 四眼 + 用例 7–9；PR7 `real.enabled=false`。


## 补充裁定（DQ 2026-10-30 09:49）
- 匿名 `/api/v1/system/info` 收到**登录后**访问：未认证请求一律 401，不暴露版本/构建信息；PR7 验收增 `system_info_requires_authentication`。
- Q-F（RETIRE 强制四眼）、Q-C（新建只追加 `qo_audit_event`）、S-13 单列 PR 8a（model-agent 启用前必合）、`sessionKind` 复用现有两种支持模式：DQ 均同意。

## 安全有条件签字所附条件（安全审查 2026-10-30 09:49，已写入即生效）
- Q-A/B/D/E 来源统一为「DQ 裁定 2026-10-30」。
- 新增负向用例 `member_without_grant_dry_run_forbidden`：未被显式授予 `QUALITY_OPS_DEBUG_RUN` 的 MEMBER 发起 dry run → 403 `PERMISSION_DENIED`（PR5）。
- `AGENT_ADMIN` 的 `QUALITY_OPS_DIAGNOSTICS_READ` 属跨租户读：**每次读取**写入 `qo_audit_event`（`actor_realm=agent`、`tenant_id` NULL），必含 `target_tenant_id`；用例 `agent_admin_diagnostics_read_is_audited`（PR5b）。
- 匿名 `/api/v1/system/info` 收到登录后：挂 **PR7**，用例 `system_info_requires_authentication`。
- 签字状态：安全审查 ✅（有条件，条件已并入）。

## 架构逻辑有条件签字所附条件（2026-10-30，DQ 定直接写入）
- S1 `enterprise_function` 入必填并重新计数 → §3「全域必填 19 项」。
- S2 `actor_realm` + 按域必填 + `target_tenant_id` + CHECK + `audit_realm_tenant_consistency` → §3「按域必填」。
- S3 拆 `MODULE_ENABLE_GLOBAL/_TENANT`、`LIMITS_CEILING/_TIGHTEN` + 两条越权用例 → §1、§4。
- 顺带：R5 措辞 → §2 R5；审计事件前缀统一 `QUALITY_OPS_` → §3「事件」。
- ADR-B8 推翻条件第 3 条（A1 暂留 platform-admin 写）若触发，须同步改本稿 `QUALITY_OPS_MODULE_REGISTER` 持有主体。
- 签字状态：架构逻辑 ✅（有条件，条件已并入）。
