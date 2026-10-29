# ADR-B1：首版边界——新包 / 新路径 / 新表，material 与 knowledge 作只读上游

| 字段 | 内容 |
| --- | --- |
| 状态 | **Proposed（本地草稿）**。供总负责人批纯文档 PR；合并前决策仍可微调。 |
| 日期 | 2026-10-30（Asia/Shanghai） |
| 作者 | 梦擎·系统架构 |
| 审阅 | 梦擎重构总监（提纲「修正后采纳」已通过；正文待总负责人批） |
| 依据 | [`01-现状盘点.md`](./01-现状盘点.md) · [`02-目标分层.md`](./02-目标分层.md) · [`03-首版闭环落点.md`](./03-首版闭环落点.md) · [`04-风险与ADR提纲.md`](./04-风险与ADR提纲.md) · `/workspace/agent-tools/dreamcore-后端可改入口清单.md` |
| 关联 | [`ADR-B2-统一Capability执行端口.md`](./ADR-B2-统一Capability执行端口.md)（执行槽位）；仓内已合 [`docs/architecture/契约分片-检查与能力.md`](../契约分片-检查与能力.md)、[`docs/architecture/ADR-检查结果三态展示.md`](../ADR-检查结果三态展示.md)、[`docs/architecture/乙表面落点-platform登记-tenant运维.md`](../乙表面落点-platform登记-tenant运维.md)（路径相对仓库根为 `docs/architecture/…`） |
| 仓库快照 | `/workspace/dreamcore` @ `3325b6e`（只读摸底；本文不改业务代码） |

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

**修正 2 — 只读必须经 Facade**

- 上游读取一律经 `MaterialKnowledgeReadFacade`（查询接口）。
- 禁止 qualityops 跨包直接 SQL 读 `material` / `knowledge` 表。
- 禁止引用 `material.*` / `knowledge.*` 的内部类（可用 ArchUnit 等架构断言固化；本轮只登记候选，不锁定工具）。

**修正 3 — 规则可复制，不可调用旧服务**

- `MaterialGovernance` 的规则函数可以**复制**为首个 in-process 模块（如 `pii-regex/v1`），作为槽位示例。
- 禁止 qualityops 调用 `MaterialGovernanceService` 或其它旧「检查」服务。
- 旧 API 冻结：只读或对照，不新增调用边。

### 命名对照（必须一致）

| 层 | 标识 | 说明 |
| --- | --- | --- |
| Java 包 | `com.dreamcore.workspace.qualityops` | 新代码包根；**不含** `governance` |
| 产品 / 路由 feature | `quality-ops` | 租户表面 feature 名与路径片段（如 `/api/v1/tenants/{t}/quality-ops/*`） |
| 表前缀 | `qo_` | 如 `qo_capability`、`qo_module_version`、`qo_check_task`、`qo_debug_run`、`qo_data_version` |
| 迁移位置 | `db/migration-common` | 两 profile 都会加载；编号从 **V190** 起（ADR-B6 提纲） |

新码、新路由、新表名均不得出现 `governance` 字样。历史包名仍含该词的旧代码不在本 ADR 重命名范围内。

### 首版调试默认

- `qo_debug_run` 默认 **`executionMode = simulated`**。
- 选择 `real` 必须显式指定，并受权限约束（原则：仅具备相应运维/调试权限的身份可发起；具体权限码与审计字段由契约与身份 ADR/实现定稿，本文不编造码名）。
- 与已合三态 ADR 一致：`simulated` 时质量与发布不得呈现为生产可用。

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
   | 5 | **租户 / 企业** | 约束维：该实现对哪些租户可用或默认 |

   - **实时替换**按「企业端业务功能」触发（编排只说「跑质检」，不说「跑某厂商模型」）。
   - 选用哪套实现时，可叠加厂商、运行时、版本、租户等约束做筛选。
   - 与「禁止以厂商名作**唯一**登记键」不矛盾：**厂商是维度之二，不是唯一主键**；主键/触发维仍是企业端业务功能。禁止以厂商名、模型名或平台内部技术分类冒充主维度。
   - `Capability` / `ModuleVersion` **挂在企业端业务功能之下**；实现（规则 / 进程 / 模型 agent）可替换。对齐 `CapabilityExecutionPort`（ADR-B2）。

3. **开源框架 + 模型须可论证。** 探索开源框架与模型能力结合时，须在后续选型或实现 ADR/评审中写明：可靠性（失败语义、超时、输出校验）、可维护性（升级与供应链）、可替换性（换实现不改编排契约、不改企业端功能触发维）。具体框架名本轮 backlog，不在本文锁定。

4. **首版与后续优先级。** 首版仍可先落地 `pii-regex/v1`（in-process）作为**槽位与闭环示例**，证明端口、三态与「企业端功能 → 五维可选实现」链路可跑通。ADR 明确：后续质检、语义标注、修复建议等**企业端功能**优先换为模型 agent 实现（经统一 agent 管理平台按企业端功能触发、五维约束准入），规则实现降为可选基线或对照，不得长期独占。

### 边界条件（a）（b）（c）（d）

- **(a)** qualityops **不写** `material` / `knowledge` 业务表（parse 过渡期写 `knowledge_runs`/chunks 由既有 knowledge 路径负责，经端口执行，不由 qualityops 包直接写）。
- **(b)** 新路由、新表、新包名都不含 `governance`。
- **(c)** 当 Foundation 等投影需要读新结果时，由 Foundation **读** `qo_*`，而不是 qualityops 回写旧表。
- **(d)** 若上游版本模型变化导致 `inputVersionId` 语义变化，须**重开本 ADR**，不得静默改含义。

### 可测性与合入约束（边界补充 · 测试审查）

下列约束与边界条件同等效力；未满足不得宣称 qualityops / 纵切「通过」。

1. **契约硬门禁**：五个契约分片（`capability-registry` / `quality-check-run` / `check-flow-config` / `check-run-log` / `data-version-readonly`）**必须先入仓**；未入仓不得将 qualityops 相关实现标为通过或可合入主干。
2. **首版 PR 审查清单（必勾）**：① `qualityops` **禁止**跨包 import `material.*` / `knowledge.*` 内部类（只经 Facade）；② 指向 parser 的 `ProcessBuilder` **仅允许**出现在执行适配器内。ArchUnit 等自动化可 backlog，**不能**代替本清单勾选。
3. **三态与 executionMode 契约断言**：`runStatus` / `qualityVerdict` / `publishStatus` 分列存储与契约字段必须有断言覆盖；`executionMode` 仅 `simulated` | `real`。字段合并、枚举模糊或同义混用——**一律否决**。
4. **纵切逐片绿**：最小纵切五步（契约 → V190 → 端口 → `pii-regex/v1` → 只读 data-version）须**逐片**通过后再进下一片；`admissionTestVerdict` 相关 CI **禁止**依赖 live/model（对齐首版调试默认 `simulated`）。

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
- 只读 Facade + 单向依赖降低 material↔knowledge 环被加深的风险（R2）。
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
- 不启用 `engine-http` / 模型 agent 运行时（接口与登记原则在 B2 预留；实现另派）。
- 不做 Foundation 投影切换（二期：Foundation 改读 `qo_*`）。
- 不写 ADR-B3–B6 正文（仍见 [`04-风险与ADR提纲.md`](./04-风险与ADR提纲.md)）。
- 不 commit / push；不改业务代码。

---

## 待办清单（Status checklist）

- [x] 总监批准「修正后采纳」立场与边界/推翻条件方向
- [x] 本文本地正文（含命名对照、`simulated` 默认、模型能力与企业端功能登记原则（五维））
- [ ] 总负责人批纯文档 PR（01–04 + B1 + B2）
- [ ] 合并后：契约五分片 → V190 → 端口 → `pii-regex/v1` → 只读 data-version
- [ ] 后续：质检/标注/修复建议等企业端功能优先换模型 agent（按企业端功能准入）

---

## 参考

- 本地：[`01-现状盘点.md`](./01-现状盘点.md)、[`02-目标分层.md`](./02-目标分层.md)、[`03-首版闭环落点.md`](./03-首版闭环落点.md)、[`04-风险与ADR提纲.md`](./04-风险与ADR提纲.md)、[`ADR-B2-统一Capability执行端口.md`](./ADR-B2-统一Capability执行端口.md)
- 仓内已合（仓库相对路径）：[`docs/architecture/契约分片-检查与能力.md`](../契约分片-检查与能力.md)、[`docs/architecture/ADR-检查结果三态展示.md`](../ADR-检查结果三态展示.md)、[`docs/architecture/乙表面落点-platform登记-tenant运维.md`](../乙表面落点-platform登记-tenant运维.md)、[`docs/architecture/企业数据基座-路由对照-S0.md`](../企业数据基座-路由对照-S0.md)
