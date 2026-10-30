# ADR-B1：首版边界——新包 / 新路径 / 新表，material 与 knowledge 作只读上游

| 字段 | 内容 |
| --- | --- |
| 状态 | **Proposed（follow-up2 安全必改）**。相对已合 #13（`8df9868`）；并入安全审查 S-01–S-12、总负责人代拍决策、架构逻辑 M2/M3；仍不推仓。 |
| 日期 | 2026-10-30（Asia/Shanghai） |
| 作者 | 梦擎·系统架构 |
| 审阅 | 梦擎重构总监（提纲「修正后采纳」已通过；正文待总负责人批） |
| 依据 | [`01-现状盘点.md`](./01-现状盘点.md) · [`02-目标分层.md`](./02-目标分层.md) · [`03-首版闭环落点.md`](./03-首版闭环落点.md) · [`04-风险与ADR提纲.md`](./04-风险与ADR提纲.md) · `/workspace/agent-tools/dreamcore-后端可改入口清单.md` |
| 关联 | [`ADR-B2-统一Capability执行端口.md`](./ADR-B2-统一Capability执行端口.md)（执行槽位）；仓内已合 [`docs/architecture/契约分片-检查与能力.md`](../契约分片-检查与能力.md)、[`docs/architecture/ADR-检查结果三态展示.md`](../ADR-检查结果三态展示.md)、[`docs/architecture/乙表面落点-platform登记-tenant运维.md`](../乙表面落点-platform登记-tenant运维.md)（路径相对仓库根为 `docs/architecture/…`） |
| 仓库快照 | `/workspace/dreamcore` @ `a2a41d5`（follow-up2 基线；原 `3325b6e`）（只读摸底；本文不改业务代码） |

---

## 上下文（Context）

首版检查闭环（ingest → parse → quality-check → review → publish）需要可替换模块、三态分列（`runStatus` / `qualityVerdict` / `publishStatus`）与配置版本锁定。现状盘点（01 §3b）对照了七套「检查·发布·问题」语义：

| 体系 | 一句话 |
| --- | --- |
| 成员职责 `governance` | 仅撞名，与质检无关 |
| 模型治理任务 `GovernanceModel*` | 模型辅助标注近邻，有 publish，无独立 QualityIssue |
| 材料治理 `MaterialGovernance*` | 硬编码正则「质检」，最易误用，**不可**当可替换模块 |
| 数据集 `NativeGovernance*` | 经营表发布近邻，只读参照 |
| Foundation 管线投影 | 派生投影，不能当事实源 |
| `evaluation` issues | 评测工单流，**勿**复用为 QualityIssue |
| `methods` | 能力登记/准入模式参照，字段与 `moduleVersionId` / 准入测试不同构 |

结论：七套里**没有一套**同时具备可替换模块、三态分列和配置版本。在 `MaterialGovernance` / `evaluation` / `methods` 上改建，会把新闭环永久缠进旧语义，迁移与命名成本都更高（风险 R1）。

开发侧建议「首版新包 / 新路径 / 新表，material 与 knowledge 只当只读上游」。本 ADR 对该建议作**修正后采纳**，把修正条款、命名对照、边界与推翻条件写死。

---

## 决策（Decision）

**修正后采纳**：「首版在新包、新路由、新表上建设 qualityops；`material` 与 `knowledge` 的**业务数据**对 qualityops 只读。」

### 修正条款（写死）

**修正 1 — parse 过渡期写路径**

- 解析仍由 `KnowledgeWorker` 队列驱动，过渡期内仍写入 `knowledge_runs` / chunks。
- 对 qualityops 而言：`knowledge` 的**数据**只读；`knowledge` 的**执行路径**进入 `CapabilityExecutionPort`（见 ADR-B2）。
- 禁止把「只读上游」理解成「解析也不走槽位」。

**修正 2 — 只读必须经 `UpstreamReadPort`（Facade = 适配器）**

- 应用层**只依赖**端口 **`com.dreamcore.workspace.upstream.UpstreamReadPort`**（M2：PR1 前定死全限定名）；方法必带 `TenantScope`（S-04）。
- `com.dreamcore.workspace.upstream.adapter.MaterialKnowledgeReadFacade` 是该端口的**适配器实现**，不是应用层可直接当作「端口契约类名」去依赖的边界；编排与应用服务面向 `UpstreamReadPort` 编程。
- 禁止 qualityops 跨包直接 SQL 读 `material` / `knowledge` 表。
- 禁止引用 `material.*` / `knowledge.*` 的内部类（可用 ArchUnit 等架构断言固化；首个代码 PR 前须有可执行自动断言，见下文「可测性」）。

**修正 3 — 规则可复制，不可调用旧服务**

- `MaterialGovernance` 的规则函数可以**复制**为首个 in-process 模块（如 `pii-regex/v1`），作为槽位示例。
- 禁止 qualityops 调用 `MaterialGovernanceService` 或其它旧「检查」服务。
- 旧 API 冻结：只读或对照，不新增调用边。

### 命名对照（必须一致）

| 层 | 标识 | 说明 |
| --- | --- | --- |
| Java 包 | `com.dreamcore.workspace.qualityops` | 新代码包根；**不含** `governance` |
| 产品 / 路由 feature | `quality-ops` | 租户表面 feature 名与路径片段（如 `/api/v1/tenants/{t}/quality-ops/*`） |
| 执行端口包 | `com.dreamcore.workspace.capability` | 端口、注册表解析、适配器（M2）；ProcessBuilder 仅 `capability.adapter..`（M3） |
| 上游端口包 | `com.dreamcore.workspace.upstream` | `UpstreamReadPort` 与其适配器（M2） |
| 表前缀 | `qo_` | 如 `qo_capability`、`qo_module_version`、`qo_check_task`、`qo_debug_run`、`qo_data_version` |
| 迁移位置 | `db/migration-common` | 两 profile 都会加载；编号从 **V190** 起（ADR-B6 提纲） |

新码、新路由、新表名均不得出现 `governance` 字样。历史包名仍含该词的旧代码不在本 ADR 重命名范围内。

### 首版调试默认

- `qo_debug_run` 默认 **`executionMode = simulated`**。
- 选择 `real` 必须显式指定，并受权限约束；权限码与审计字段见下文「安全边界 · S-07」（建议名，待安全草案后定稿）；**定稿前 `real` 一律拒绝（fail-closed）**。
- 与已合三态 ADR 一致：`simulated` 时质量与发布不得呈现为生产可用（可勾选用例见下文「simulated 验收用例名」）。

### 进行中 attempt 锁定 `moduleVersionId`

- 任一已进入执行（或已绑定实现）的 **attempt**（含 `qo_check_attempt`、调试跑等价记录、以及经兼容外观委托的 knowledge attempt）在创建/调度时**锁定**当时解析得到的 `moduleVersionId`。
- 能力替换、新版本准入、五维默认策略变更——**只影响之后新调度**的 attempt；**禁止**改写进行中（含排队已出队、running、awaiting_human）attempt 上已绑定的实现版本。
- 取消后重试 = 新 attempt，可按最新登记解析；不得原地覆盖旧 attempt 的 `moduleVersionId`。

**ModuleVersion 废弃与强制下线（DQ 裁定）**
- 废弃（deprecated）：已发布配置**保持可跑**，版本标 `deprecated`；**禁止新绑定**（新配置/新默认不得选用）；**不自动切换**到其它版本。
- 已绑定该版本的进行中 attempt 与已发布配置的新调度继续使用该版本（与 attempt 锁定一致：废弃不改写任何已绑定版本）。
- 强制下线（retired）是**单独显式操作**：须权限码（建议 `QUALITY_OPS_MODULE_RETIRE`，platform 侧，待安全草案后定稿）并写审计（actor、traceId、原因、受影响配置数）；下线后新调度 fail-closed（建议码 `MODULE_VERSION_RETIRED`），进行中 attempt 的处置须在该操作中显式选择并审计，不得静默改绑。


### 模型能力与企业端功能登记原则（五维）

总负责人要求：企业端尽量用模型能力解决可解问题；探索开源框架与模型能力结合；模型在统一 agent 管理平台**按照企业端功能**进行管理，且能力登记/管理必须支持**五维**（可组合筛选与切换；**不含环境**）。本 ADR 落成下列原则（本轮只定原则，不派实现、不锁定具体开源框架或模型厂商）：

1. **默认走模型能力。** 企业端治理流程中，凡可用模型完成的步骤（解析增强、质检、修复建议、语义标注等**企业端业务功能**）**默认**登记为可替换实现，由模型 agent 或等价实现承担；禁止用死规则独占本可由模型完成的企业端功能。硬编码规则仅作过渡示例、基线对照或明确「规则足够且更安全」的窄场景。

2. **登记是多维索引，不是单键。** 统一 agent / `capability-registry` 必须能按下列五维组合筛选、切换与约束选用（**不含「环境」维**）：

   | # | 维度 | 角色 |
   | --- | --- | --- |
   | 1 | **企业端业务功能** | **主维度 / 触发维**（例：解析增强、质检、修复建议、语义标注） |
   | 2 | **模型 / 厂商** | 约束维：选用哪家模型或哪条模型线路 |
   | 3 | **运行时类型** | 约束维：`in-process` 规则 / `local-process` / `model-agent`（或并入 `engine-http`）等 |
   | 4 | **版本** | 约束维：`moduleVersionId` / 能力版本 |
   | 5 | **租户 / 企业** | **授权边界**（S-10）：该实现对哪些租户被授权可用/默认；由认证上下文决定，**不能由请求自选**，不是筛选条件 |

   - **实时替换**按「企业端业务功能」触发（编排只说「跑质检」，不说「跑某厂商模型」）。
   - 选用哪套实现时，可叠加厂商、运行时、版本约束做筛选；租户维是授权前置（先按认证上下文限定可见集合），不是请求可选的筛选项。
   - 与「禁止以厂商名作**唯一**登记键」不矛盾：**厂商是维度之二，不是唯一主键**；主键/触发维仍是企业端业务功能。禁止以厂商名、模型名或平台内部技术分类冒充主维度。
   - **功能码独立列（触发维）**：表设计 / 登记模型中 `enterpriseFunctionCode`（或契约定稿等价名）为**独立列**，不得与 Capability 主键混写。
   - **`Capability` ≠ 功能码**：`Capability` = 某企业端业务功能下的**实现族**（一族可替换实现的集合），**不等同于**功能码本身。一层功能码之下可挂多个 Capability；每个 Capability 下再挂多个 `ModuleVersion`。
   - 分层示意（建议名）：

     | 层 | 标识（建议） | 含义 |
     | --- | --- | --- |
     | 企业端业务功能 | `enterpriseFunctionCode` | 触发维独立列（质检、解析增强、修复建议、语义标注…） |
     | Capability | `capabilityId` | 该功能下的**实现族**（≠ 功能码） |
     | ModuleVersion | `moduleVersionId` | 某实现族的具体版本（含 `runtimeKind`、限额等） |

   - 实现对齐 `CapabilityExecutionPort`（ADR-B2）。
   - **安全前置（S-06）**：「默认走模型」不豁免 B2「S-06 启用前置条件」；模型输出只作建议，`qualityVerdict`/`publishStatus` 变更须经确定性规则或人工复核。

3. **开源框架 + 模型须可论证。** 探索开源框架与模型能力结合时，须在后续选型或实现 ADR/评审中写明：可靠性（失败语义、超时、输出校验）、可维护性（升级与供应链）、可替换性（换实现不改编排契约、不改企业端功能触发维）。具体框架名本轮 backlog，不在本文锁定。

4. **首版与后续优先级。** 首版仍可先落地 `pii-regex/v1`（in-process）作为**槽位与闭环示例**，证明端口、三态与「企业端功能 → 五维可选实现」链路可跑通。ADR 明确：后续质检、语义标注、修复建议等**企业端功能**优先换为模型 agent 实现（经统一 agent 管理平台按企业端功能触发、五维约束准入），规则实现降为可选基线或对照，不得长期独占。

### 边界条件（a）（b）（c）（d）

- **(a)** qualityops **不写** `material` / `knowledge` 业务表（parse 过渡期写 `knowledge_runs`/chunks 由既有 knowledge 路径负责，经端口执行，不由 qualityops 包直接写）。
- **(b)** 新路由、新表、新包名都不含 `governance`。
- **(c)** 当 Foundation 等投影需要读新结果时，由 Foundation **读** `qo_*`，而不是 qualityops 回写旧表。
- **(d)** 若上游版本模型变化导致 `inputVersionId` 语义变化，须**重开本 ADR**，不得静默改含义。

### 可测性与合入约束（边界补充 · 测试审查 · 质量性能硬约束）

下列约束与边界条件同等效力；未满足不得宣称 qualityops / 纵切 / admission「通过」或可合入主干。正式条文见同目录 [`FOLLOWUP-B1B2-质量性能硬约束-20261030.md`](./FOLLOWUP-B1B2-质量性能硬约束-20261030.md)（§2–§4）；此处写入决策级摘要，语义不得弱于附录。

1. **契约硬门禁**：五个契约分片（`capability-registry` / `quality-check-run` / `check-flow-config` / `check-run-log` / `data-version-readonly`）**必须先入仓**；未入仓不得将 qualityops 相关实现标为通过或可合入主干。

2. **首版 PR 审查清单（必勾）+ 首个代码 PR 前可执行自动断言**：① `qualityops` **禁止**跨包 import `material.*` / `knowledge.*` 内部类（应用层只经 **`UpstreamReadPort`**；Facade 仅为适配器）；② 指向 parser 的 `ProcessBuilder` **仅允许**出现在执行适配器内。清单仍须人工勾选。**此外**：合并**任一** `com.dreamcore.workspace.qualityops`（或等价包根）业务/适配器代码进主干之前，必须已合入**至少一条**在默认 CI 中执行的自动断言，满足下列之一（可并存）：
   - **A. 包依赖测试**：ArchUnit（或等价）——`qualityops` 不得依赖 `material` / `knowledge` 内部实现包；只允许经 `UpstreamReadPort` / 只读端口包（适配器实现可放白名单路径）。
   - **B. CI grep / 结构检查**：门禁 job 中失败即红——禁止 `qualityops` 源码出现对 `material.` / `knowledge.` 内部类的 import；禁止业务包（非执行适配器包）出现指向 parser 的 `ProcessBuilder`。
   - ArchUnit「可 backlog」**仅适用于文档期**；**首个 qualityops 代码 PR 的前置条件**是 A 或 B 已绿。适配器包白名单扩大须过质量性能 + 测试审查，并报总监。手工清单与自动化**同时生效**。

3. **三态与 executionMode 契约断言 + `simulated` 不得呈生产可用**：`runStatus` / `qualityVerdict` / `publishStatus` 分列存储与契约字段必须有断言覆盖；`executionMode` 仅 `simulated` | `real`。字段合并、枚举模糊或同义混用——**一律否决**。字段「存在」类弱断言**不算**满足；必须覆盖 **simulated → 非生产可用表面**。可勾选用例名（建议 ID，可改名不可删语义；与质量性能附录 §3 一致）：

   | 用例 ID | 断言要点 |
   | --- | --- |
   | `debug_run_simulated_rejects_production_publish_surface` | `executionMode=simulated` 时，对外契约/API **不得**将 `publishStatus` 表示为可生产发布（如 `published` / 等价）；若返回，须为明确非生产态或 4xx 业务拒绝。 |
   | `debug_run_simulated_quality_not_production_ready` | `executionMode=simulated` 时，`qualityVerdict` **不得**单独被解释为「已通过可上线」而不展示 simulated；响应中须能区分模拟与真实（字段或并列 `executionMode`）。 |
   | `debug_run_real_requires_explicit_mode_and_authz` | 选择 `real` 必须显式传参；缺省 `simulated`；无相应权限时拒绝；**权限未定义时拒绝**（S-07；建议码 `QUALITY_OPS_DEBUG_RUN_REAL`，待安全草案后定稿）。 |
   | `three_state_columns_not_merged` | 存储与契约中三态分列；合并单一 `status` 或同义混用——测试失败。 |
   | `execution_mode_enum_closed` | `executionMode` 仅 `simulated` | `real`；其它值契约校验失败。 |
   | `simulated_debug_run_not_publishable` | （交叉别名/补充勾选）模拟调试跑不得进入可发布表面。 |
   | `simulated_verdict_not_production_ready` | （交叉别名/补充勾选）模拟结论不得呈现为生产就绪。 |

4. **纵切逐片绿 + CI / workflow 硬约束**：最小纵切五步（契约 → V190 → 端口 → `pii-regex/v1` → 只读 data-version）须**逐片**通过后再进下一片。**首个（及后续）`qualityops` / platform `admission` / `admissionTestVerdict` 相关 GitHub Actions workflow**：
   - **禁止** `continue-on-error: true`（job 级与 step 级均禁）；禁止用 `|| true`、吞非零退出码、或把失败步骤标为 success 的包装进入默认 PR 门禁。
   - **admission 默认禁 live/model**：默认 PR / 默认 branch 门禁不得设置真实模型密钥，不得跑 live/model smoke；`admissionTestVerdict` 相关用例必须在 **simulated / 夹具** 下可绿；依赖 live 的用例须环境变量门闩，且默认 CI **不设置**这些变量（对齐不跑 `model:smoke` / `test:model-smoke` / live 类测试）。live 验证只允许手工/受控 workflow，且不得作为合入主干的唯一绿灯。
   - 任一片红不得宣称整链通过。

### 安全边界（follow-up2 · S-01/S-04/S-07/S-10 · 首个代码 PR 前必须落入契约/ADR）

> 来源：安全审查报告 `/workspace/security-review/ADR-B1-B2-安全审查.md`；〔总负责人代拍·经 DQ〕为已定决策。

**作用域只来自认证上下文（S-01）〔总负责人代拍·经 DQ〕**：tenant/space 只由服务端从认证上下文推导；`tenantId` 不进任何请求体；路由 `{t}` 与会话不一致 → 403。详见 B2「安全决策」。

**UpstreamReadPort 强制租户谓词 + 真只读（S-04）**
1. 全限定名定死：`com.dreamcore.workspace.upstream.UpstreamReadPort`；适配器 `com.dreamcore.workspace.upstream.adapter.MaterialKnowledgeReadFacade`（M2，见 B2「包结构与依赖方向」）。
2. 每个方法显式接收 `TenantScope(tenantId, spaceId)`（由认证上下文构造），适配器 SQL 强制带 `tenant_id`（及 `space`/`workspace_id`）谓词；**不提供无作用域重载**。返回的 `inputRef` 句柄绑定该 scope。
3. 所有 `qo_*` 业务表 `tenant_id NOT NULL`（需要时 `space_id`），用 `(tenant_id, id)` 复合唯一键 + 复合外键防跨租户引用。
4. **真只读技术落实**：适配器使用只读数据源 / 只读 DB 角色（首选）；若首版无法提供独立只读连接，等价机制为 `@Transactional(readOnly = true)` + ArchUnit 禁止适配器调用 `JdbcTemplate.update/batchUpdate/execute`，并在 backlog 登记换只读角色。不能只靠约定。（仓内现状：未找到只读 DataSource 配置；`JdbcTemplate` 直连。）
5. 任何检索索引、向量、缓存的 key / 过滤条件**必须含 tenant/space**（前向决策，见下文 Q1）。

**租户维 = 授权边界，不是筛选条件（S-10）**：五维中「租户/企业」维的语义改为：该实现**对哪些租户被授权可用**；由认证上下文决定，**不能由请求自选**；总部支持会话进入租户时在 qualityops 只有读权限（DQ 裁定），不得借租户维执行或发布。`moduleVersionId` 已带值时，端口必须校验「该版本对当前 tenant 可用」，失败 403 语义码；登记列表只返回当前租户可见版本。

**real 模式权限与审计（S-07）**：定稿前 `real` 一律拒绝（fail-closed）。建议权限码与审计字段见 B2「S-07」（〔待安全草案后定稿〕；安全审查起草 → 系统架构定稿 → 架构逻辑 + 安全审查双签）。审计含 actor、traceId、inputHash；只追加。

**首版范围：Live 端空数据〔总负责人代拍·经 DQ〕**：首版不预置任何业务数据（material、knowledge、`qo_*` 业务行均为空）；仅允许预置平台级登记种子（`ModuleVersion` 引用代码白名单 recipe，S-02）。验收：三端首次打开为空态且不报错。

### 安全复核补丁（S-04 / S-07 / S-15 · 2026-10-30）
- **S-07**：以 [`S-07-real模式权限码与审计字段-定稿.md`](./S-07-real模式权限码与审计字段-定稿.md) 为准；审计表 `qo_audit_event` 属本 ADR V190+ `qo_*` 族（PR3），只追加。登记/下线/全局启用主体为第四端 `AGENT_ADMIN`（ADR-B8）。
- **S-04**：`qo_tables_have_tenant_id` → **PR3**；`upstream_read_port_requires_scope` → **PR6**。只读数据源过渡：readOnly 事务 + ArchUnit `upstream_adapter_has_no_write_calls`（PR6）；**截止**：独立只读 DB 角色在 **PR7 合入前**到位（交付运维），否则 PR7 不合。
- **S-15 WeKnora**：`knowledge_base_id` 唯一已核实——`V150__weknora_index.sql:3-4`（`tenant_id` 主键、`knowledge_base_id ... NOT NULL UNIQUE`，一租户一库、不共享），`:22` `UNIQUE(knowledge_base_id, remote_id)`。`WeKnoraRetrieval.java:31-33` 对混库已 fail closed，但 `:35` `mapped::get` 对授权集外 ID 返回 null 静默丢弃 → 改为：显式过滤授权集外 ID、记安全告警（不含正文）、整次检索 fail closed。用例 `weknora_unmapped_kb_id_fails_closed`；**PR6**。
- **角色术语**：DB 角色 `TENANT_ADMIN`/`MEMBER`；OWNER/ADMIN 为展示角色（`WorkAudienceService.java:43`）。

### 安全审查问题答复 Q1–Q3（只读核实 `/workspace/dreamcore` @ `a2a41d5`）

**Q1（S-04）knowledge chunks / qo 结果是否进入向量库、检索索引或缓存？key 是否带 tenant/space？**
- 向量/embedding：rg `pgvector|embedding|vector(` 于 `apps/api/src/main`——**未找到**（唯一命中为字体嵌入注释 `document/DocumentRenderer.java:57`，无关）。
- 进程内缓存：rg `Caffeine|Redis|@Cacheable|CacheManager`——**未找到**。
- 外部检索索引：**有**。chunks 同步到 WeKnora（`knowledge/WeKnoraClient.java:16` 注明 Tencent WeKnora v0.8.3）。索引映射表 `knowledge_remote_index` 带 `tenant_id`（`knowledge/WeKnoraIndexWorker.java:37-38`），同步查询以 `tenant_id` 连接（`WeKnoraIndexWorker.java:26-28`）；检索时先在本库按授权 scope 取候选，连接条件含 `tenant_id` 与 `workspace_id`（`knowledge/WeKnoraRetrieval.java:16-22`），空授权集不访问 WeKnora（`WeKnoraRetrieval.java:25`）；知识库目标按租户 `knowledge_index_targets.tenant_id`（`WeKnoraRetrieval.java:13-14`）。WeKnora 侧 knowledge base 是否按租户物理隔离：**待核实**。
- `qo_*` 结果：表尚不存在（V190 未建），**未找到**。
- **前向决策（写死）**：任何索引、向量、缓存的 key 或过滤条件必须含 tenant/space；qo 结果首版不进入任何外部索引/缓存，如需进入须先过安全审查。

**Q2（S-05/S-12）macOS profile `process*` / `mach-lookup` 风险；生产平台；Linux table-compare**
- profile 事实：`(deny default) (allow process*) (allow sysctl-read) (allow mach-lookup) …`（`workers/parser/sandbox.py:9`）。`process*` 全开允许 fork/exec 任意可读二进制；无过滤 `mach-lookup` 允许连接任意系统 Mach 服务，存在借系统服务间接出网或越界的面；且无内存/fd/进程数 rlimit（`sandbox.py:25-27`）。结论：**不能作为安全基线**。
- 「macOS 仅开发、生产仅 Linux」：**是**（总负责人代拍·经 DQ）。
- Linux table-compare：`LocalTableCalculator.available()` 依赖 `/usr/bin/sandbox-exec`（`LocalTableCalculator.java:17`），故 Linux 上现状不可用。建议首版在 Linux 上**显式不可用并返回稳定失败码**（`EXECUTION_RUNTIME_UNAVAILABLE`），直到 Linux 沙箱路径通过 S-05 探针或 parser 容器沙箱方案（系统架构 + 安全审查共出）落地。理由：安全优先，避免为启用而临时写弱沙箱；现有用户路径本就不可用，无回归。

**Q3（S-02/S-07）权限码归属与命名；platform 是否可代租户操作**
- 现状事实：仓内**未找到**集中权限码注册表；授权以角色字符串 + 服务内判断实现：平台角色 `platform_roles.role='PLATFORM_ADMIN'`（`identity/PlatformStaffService.java:33`）；租户角色 `OWNER/ADMIN/TENANT_ADMIN/MEMBER`（`audience/WorkAudienceService.java:43`；`db/migration-local/V59__owner_handover_choices.sql:3`）；资源级动作如 `READ` + 拒绝码 `LIBRARY_PERMISSION_DENIED`（`material/LibraryPermissionService.java:88`）。审计实现：`identity/IdentityAudit.java:13-14` 写 `identity_audit(actor_id,tenant_id,action,target_id,outcome,request_id)`。命名约定以 `identity` 包现有大写下划线风格为准（归属：身份/权限负责人，**待确认**）。
- platform 代租户现状：**存在**总部支持进入机制 `support/SupportAccess.java:24-29`——`enter(session, tenant, mode)`，mode 仅 `ADJUSTMENT`/`TEST`，写 `headquarters_support_access` 并记事件；knowledge 任务会绑定 support 上下文（`knowledge/KnowledgeService.java:207,214`）。
- **DQ 裁定**：总部支持会话（`headquarters_support_access`）对 qualityops **只读**；首版**不允许**平台代租户执行或发布，由后端强制拒绝（建议码 `QUALITY_OPS_SUPPORT_READ_ONLY`，403）；用例 `support_session_cannot_execute_or_publish_quality_ops`。

### 推翻条件

若经实现与运维证明：旧 `knowledge_runs`（或同一解析队列）**必须**承载 quality-check 步（同一队列、同一租约语义不可拆），则改为「扩展该队列」方案，并废止本 ADR 中「quality-check 新建 `qo_check_task/attempt`」的落点，另开修订。未满足该证明前，不得以「省一张表」为由把质检挂回 MaterialGovernance 或 evaluation。

### 语义收敛（与 B3 提纲一致，正文级约束）

- **qualityops 是唯一规范语义**（检查任务、质量结论、数据版本、调试跑）。
- 旧四套（MaterialGovernance / GovernanceModel 任务 / NativeGovernance / evaluation issues）及 methods：**冻结**——只读、模式参照或规则**复制**；**不调用**旧服务完成新闭环。
- methods 是否演进为 capability-registry 留二期（判据见 04 ADR-B3 提纲）；本 ADR 不合并。

### 最小纵切顺序

1. **契约五分片**入 `contracts`（`capability-registry` / `quality-check-run` / `check-flow-config` / `check-run-log` / `data-version-readonly`）——文档/契约 PR，先于业务代码。
2. **迁移 V190+**：`qo_*` 表，放 `migration-common`。
3. **端口** + `LocalProcessAdapter`（ADR-B2 S1–S2；可先于完整 qualityops 应用层落地）。
4. **内置模块 `pii-regex/v1`**（in-process），跑通 check → issue → review → publish（示例；非长期独占，见上文「模型能力」原则）。
5. **只读 `data-version` API** 与前端 Live 对接。

---

## 后果（Consequences）

### 正向

- 新闭环不与七套旧语义缠死；命名与表前缀干净。
- `UpstreamReadPort` + 单向依赖（Facade 仅适配器）降低 material↔knowledge 环被加深的风险（R2）；进行中 attempt 锁定版本，避免热替换抖动。
- 槽位与「企业端功能主维 + 五维索引」为后续模型 agent 替换留出同一套契约面。
- 调试默认 `simulated`，降低误当生产发布的产品风险。

### 代价与风险

- 短期双轨：旧 MaterialGovernance / Foundation 投影仍在；文档与评审须反复强调「勿挂旧入口」（R1）。
- parse 过渡期仍写 knowledge 表，边界话术必须区分「数据只读」与「执行进端口」（修正 1）。
- 五分片契约仓内仍为「未找到」，契约 PR 滞后会导致前后端再漂移（R5）。
- `pii-regex/v1` 若被误当成「正式质检完成态」，会违背老板「默认用模型」原则——须在评审与后续排期中显式替换计划。

### 回退

- 若总负责人不批本文，本地草稿保留，不入库。
- 若仅微调修正条款或命名对照，修订本文并在 PR 说明写明改动点；不另开同题 ADR。
- 触发推翻条件时，开修订 ADR，废止本文件中与队列扩展冲突的条文。

---

## 明确不做（Out of scope）

- 不改 `MaterialGovernance` / `evaluation` / `methods` / `GovernanceModel*` 的既有行为。
- 不把 qualityops 回写旧 governance / material_governance / evaluation 表。
- 不在本 ADR 锁定开源框架、模型厂商或生成工具。
- 不启用 `model-agent` / `engine-http` 真实调度（二者首版为**同一适配器实现**，见 B2；接口与登记原则预留，实现另派）。
- 不做 Foundation 投影切换（二期：Foundation 改读 `qo_*`）。
- 不写 ADR-B3–B6 正文（仍见 [`04-风险与ADR提纲.md`](./04-风险与ADR提纲.md)）。
- 不 commit / push；不改业务代码。

---

## 待办清单（Status checklist）

- [x] 总监批准「修正后采纳」立场与边界/推翻条件方向
- [x] 本文本地正文（含命名对照、`simulated` 默认、模型能力与企业端功能登记原则（五维））
- [x] follow-up：功能码独立列、Capability≠功能码、attempt 锁定、UpstreamReadPort、首代码 PR 前自动断言、simulated 用例名、workflow 禁 continue-on-error（相对 #12）
- [x] follow-up2：安全 S-01–S-12、总负责人代拍 5 条、M2/M3、Q1–Q3 答复（相对 #13）
- [ ] 安全审查逐条复核 + 两位专家审 → 总监开纯文档 PR
- [ ] 合并后：契约五分片 → V190 → 端口 → `pii-regex/v1` → 只读 data-version
- [ ] 后续：质检/标注/修复建议等企业端功能优先换模型 agent（按企业端功能准入）

---

## 参考

- 本地：[`01-现状盘点.md`](./01-现状盘点.md)、[`02-目标分层.md`](./02-目标分层.md)、[`03-首版闭环落点.md`](./03-首版闭环落点.md)、[`04-风险与ADR提纲.md`](./04-风险与ADR提纲.md)、[`ADR-B2-统一Capability执行端口.md`](./ADR-B2-统一Capability执行端口.md)
- 仓内已合（仓库相对路径）：[`docs/architecture/契约分片-检查与能力.md`](../契约分片-检查与能力.md)、[`docs/architecture/ADR-检查结果三态展示.md`](../ADR-检查结果三态展示.md)、[`docs/architecture/乙表面落点-platform登记-tenant运维.md`](../乙表面落点-platform登记-tenant运维.md)、[`docs/architecture/企业数据基座-路由对照-S0.md`](../企业数据基座-路由对照-S0.md)
