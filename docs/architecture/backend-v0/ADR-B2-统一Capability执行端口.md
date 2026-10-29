# ADR-B2：统一 Capability 执行端口（CapabilityExecutionPort）

| 字段 | 内容 |
| --- | --- |
| 状态 | **Proposed（follow-up 修订 · 本地）**。相对已合 PR #12；并入架构逻辑 + 质量性能必改；仍不推仓。 |
| 日期 | 2026-10-30（Asia/Shanghai） |
| 作者 | 梦擎·系统架构 |
| 审阅 | 梦擎重构总监（提纲已通过；正文待总负责人批） |
| 依据 | [`01-现状盘点.md`](./01-现状盘点.md) · [`02-目标分层.md`](./02-目标分层.md) · [`03-首版闭环落点.md`](./03-首版闭环落点.md) · [`04-风险与ADR提纲.md`](./04-风险与ADR提纲.md) · [`ADR-B1-首版边界-新包与只读上游.md`](./ADR-B1-首版边界-新包与只读上游.md) |
| 仓库快照 | `/workspace/dreamcore` @ `3325b6e`（只读核实调用点；本文不改业务代码） |
| 成本估计 | 约 **4–6 人日**（S1–S4）；低–中风险 |

---

## 上下文（Context）

解析与表格计算今天由 API **直接** `ProcessBuilder` 拉起 `workers/parser/sandbox.py`，**不经** `engine`：

| 调用点 | 类 | 用途 | 超时 / 限额（事实） |
| --- | --- | --- | --- |
| 1 | `knowledge/LocalDocumentParser` | 文档解析（经 `DocumentParser`） | 85s；输出 ≤ 4_000_000；chunks ≤ 500 等 |
| 2 | `knowledge/LocalTableCalculator` | `table-compare`（同一 `sandbox.py`） | 10s；输出 ≤ 60000 |

`DocumentParser` 接口注释已写明 *Replaceable execution boundary*；`KnowledgeWorker` 经该接口调度，是天然缝。`LocalTableCalculator` 无对等端口，由 `conversation/TableCalculationService` 直持。另有 `collection/ProcessCollectionAdapter`、`conversation/NativeScheduleRules` 等 ProcessBuilder，**与 parser 无关**，本 ADR 不收编。

若继续在业务代码里复制 ProcessBuilder，新质检 / 模型 agent 步骤无法共用同一套限额、沙箱与登记。需要统一执行端口，并把「企业端业务功能 → 可替换实现」接到五维登记（见 ADR-B1）。

---

## 决策（Decision）

引入统一 **`CapabilityExecutionPort`**。编排与业务代码只提交 `ExecutionRequest`；由端口**先按企业端业务功能（及五维约束）解析登记，再按 `runtimeKind` 选适配器**（**禁止**「仅按 `moduleVersionId` 路由」）。首版启用 `LocalProcessAdapter` 与 `InProcessRuleAdapter`；**预留** `model-agent` 与 `engine-http`——二者首版为**同一适配器实现**（建议名 `ModelAgentOrEngineHttpAdapter`，或同一适配器族/同一类；首版**不启用**真实调度）。

### 端口与路由

```java
interface CapabilityExecutionPort {
  ExecutionResult execute(ExecutionRequest req);
}

// 路由（禁止「仅按 moduleVersionId 路由」）：
// 1) 先按企业端业务功能（enterpriseFunction）及五维约束解析登记
//    → 得到/确认 moduleVersionId（请求可已带已解析值；空则端口解析）
// 2) 再按 ModuleVersion.runtimeKind 选适配器
// runtimeKind ∈ { in-process, local-process, model-agent, engine-http }
// 首版：model-agent 与 engine-http → 同一适配器实现，可注册但不调度（或显式 NotEnabled）
```

| `runtimeKind` | 适配器 | 首版 |
| --- | --- | --- |
| `local-process` | `LocalProcessAdapter` | **启用**（搬入现有 ProcessBuilder） |
| `in-process` | `InProcessRuleAdapter` | **启用**（如 `pii-regex/v1`） |
| `model-agent` | **同一适配器**：建议名 `ModelAgentOrEngineHttpAdapter`（或同一适配器族/同一类） | **预留，不启用** |
| `engine-http` | **同上**（与 `model-agent` 首版非两个并行实现） | **预留，不启用** |

### 五维登记与路由（与 B1 对齐）

能力登记是**多维索引**，不是单键。调度时：

1. **触发维**：企业端业务功能（例：解析、表格比对、质检、修复建议、语义标注）。`ExecutionRequest` **必须显式**带该维度（字段名 **`enterpriseFunction`**，或契约定稿之等价名；**待契约五分片定稿**），**禁止**只传厂商/模型名发起执行，**禁止**「仅按 `moduleVersionId` 路由」。
2. **约束维**（可组合）：模型/厂商 · 运行时类型 · 版本 · 租户/企业。先按功能 + 约束解析登记，得到唯一（或默认策略下的）`moduleVersionId` 后，**再**按该版本的 `runtimeKind` 选适配器。
3. **厂商是维度之二，不是唯一主键**；不得以厂商名冒充企业端功能。
4. **`moduleVersionId`**：可为调用方已解析结果；若空则由端口/注册表按五维解析。不得把「已带 moduleVersionId」理解成可跳过企业端功能维校验——请求仍须带 `enterpriseFunction`，且与该版本所属功能一致（不一致则失败）。

`Capability` = 某企业端功能下的**实现族**（≠ 功能码）；`ModuleVersion` 挂在 Capability 下。功能码独立列见 ADR-B1。

### ExecutionRequest / ExecutionResult（关键字段草案）

**Request（建议字段；契约定稿可改名，不得删维度语义）：**

| 字段 | 含义 |
| --- | --- |
| `enterpriseFunction` | 企业端业务功能（触发维） |
| `moduleVersionId` | 已解析的模块版本；若空则端口/注册表按五维约束解析 |
| `tenantId` | 租户/企业（维度五） |
| `vendorOrModel` | 可选约束（维度二）；不得单独作为触发键 |
| `runtimeKindHint` | 可选约束（维度三） |
| `inputVersionId` | 上游材料版本（只读上游，见 B1） |
| `step` | 流程步（parse / quality-check / …） |
| `inputRef` | 输入句柄（对象存储键、临时目录约定等） |
| `limits` | 超时、输出大小等；适配器可与 ModuleVersion 默认值合并 |
| `executionMode` | `simulated` \| `real`（调试默认见 B1） |

**Result（建议字段）：**

| 字段 | 含义 |
| --- | --- |
| `status` | 与步骤协议对齐的执行态（解析侧现有 READY/PARTIAL/FAILED/UNSUPPORTED 等经适配器映射） |
| `moduleVersionId` | 实际执行的版本 |
| `runtimeKind` | 实际适配器 |
| `warnings` | 警告码列表（保持既有枚举语义，见风险） |
| `outputRef` / 结构化载荷 | 按步骤：chunks、表格结果、质检 findings 等 |
| `errorCode` | 失败时稳定码 |

具体 JSON/OpenAPI 形状以契约五分片为准；本文只钉语义。

### LocalProcessAdapter

把现有 ProcessBuilder **约束原样搬入**（核实自 `LocalDocumentParser` / `LocalTableCalculator`）：

- 解释器：`.venv/bin/python -I -B` + `sandbox.py` + job 目录 + 子命令/扩展名。
- `builder.environment().clear()` 后仅放受控 `PATH`。
- 超时：解析 85s；`table-compare` 10s（按 ModuleVersion / 步骤配置，**首迁不得改数值**）。
- 输出限额：解析约 4MB；表格约 60KB（同上，值不变）。
- 沙箱分 OS：`LocalTableCalculator.available()` 现依赖 macOS `sandbox-exec` 路径；Linux 另路径——适配器**不得擅自统一改掉**，只集中代码。
- **白名单**：原 `parserVersion ∈ {local-1, local-2, local-3, docling-2.140.0}` 改为「由预置 `ModuleVersion` 注册」；**种子值不变**（S3）。

业务代码中指向 parser 的 `ProcessBuilder` 只应留在该适配器内。

### DocumentParser 兼容外观

- `LocalDocumentParser` 改为委托 `CapabilityExecutionPort`（预置企业端功能如「文档解析」、`moduleVersionId` 可对应 `parse/local-3` 等种子或留空由端口解析）。
- `DocumentParser` 接口保留，供 `KnowledgeWorker` 无感；lease/attempt 语义不变。
- `LocalTableCalculator` 同样委托（企业端功能如「表格比对」）。

### 进行中 attempt 锁定 `moduleVersionId`

- 调度创建 attempt 时写入并**锁定**当时的 `moduleVersionId`（及解析所用企业端功能 / 关键五维快照，以契约定稿为准）。
- 能力替换、新版本准入、默认策略变更——**只影响新调度**的 attempt；**禁止**改写进行中（queued 已绑定、running、awaiting_human）attempt 的实现绑定。
- 与 ADR-B1 同条；兼容外观路径（KnowledgeWorker）同等适用。

### LocalProcessAdapter / 端口资源硬限（首版）

正式条文见 [`FOLLOWUP-B1B2-质量性能硬约束-20261030.md`](./FOLLOWUP-B1B2-质量性能硬约束-20261030.md) §1；下列为决策级写入，语义不得弱于附录。

**`CapabilityExecutionPort` 经 `LocalProcessAdapter`（及首版 in-process 以外、会占 OS 进程/临时目录的适配器）必须满足下列首版硬限；禁止无界排队。**

1. **有界队列**  
   - 端口（或适配器）维护**有界**等待队列；队列容量为显式配置常量（种子默认值由实现 ADR/配置定稿，**本文不编造具体数字**，但合入 PR 必须写出默认值与配置键）。  
   - **禁止**无界 `BlockingQueue` / 无界线程池 / 无限 `CompletableFuture` 堆积作为默认。  
   - 入队前已满：立即失败，**不得**阻塞调用方直到资源出现（除非契约显式约定同步背压且有超时；首版默认「满则失败」）。

2. **信号量 / 并发上限**  
   - 同时处于「进程已拉起、尚未回收」的 `local-process` 执行数 ≤ 配置上限（信号量或等价物）。  
   - in-process 规则执行可另设更高上限，但仍须有界；不得与 local-process 共用无界池。  
   - 超限与队列满使用**稳定失败码**（见下），不得静默丢弃、不得改写为成功/PARTIAL 伪绿。

3. **超限失败码（稳定、可断言）**  
   - 建议语义码（契约定稿可改名，**不得删语义**）：  
     - `EXECUTION_QUEUE_FULL` — 等待队列已满  
     - `EXECUTION_CONCURRENCY_LIMIT` — 并发信号量耗尽  
     - `EXECUTION_TIMEOUT` — 步骤/适配器超时（与现有解析 85s、table-compare 10s 对齐，首迁数值不变）  
     - `EXECUTION_OUTPUT_LIMIT` — 输出超限（与现有限额对齐）  
     - `EXECUTION_JOB_CLEANUP_FAILED` — 临时 job 目录清理失败（可降为 warning + 指标，但不得掩盖主结果失败态）  
   - 失败时 `ExecutionResult.status` 映射为失败态；**禁止**用空 warnings 或成功态掩盖。

4. **超时叠加策略**  
   - 单步 `limits.timeout`（或 ModuleVersion 默认）为**硬上限**；端口不得在适配器外再无限等待。  
   - 队列等待时间计入总时限或单独配置 `queueWaitTimeout`；二者任一触达即失败并返回 `EXECUTION_TIMEOUT`（或拆分 `EXECUTION_QUEUE_WAIT_TIMEOUT`，契约定一即可）。  
   - **禁止**「队列等待无超时 + 进程超时」叠加导致调用方挂死。  
   - 首迁：解析 85s、table-compare 10s 的**进程内**超时数值不变；本条约束的是端口调度层，不得借机改 sandbox 数值。

5. **job 目录清理**  
   - 每次 local-process 执行使用独立临时目录（或既有 job 目录约定）；**成功与失败路径均须**尝试清理。  
   - 清理失败不得把主结果从失败改成成功；须可观测（日志/指标）。  
   - 禁止依赖「进程退出后 OS 偶然回收」作为唯一清理手段。

### 迁移步骤 S1–S4

| 步 | 内容 | 验收标准 | 估计 |
| --- | --- | --- | --- |
| **S1** | 抽 `CapabilityExecutionPort` + `LocalProcessAdapter`；`LocalDocumentParser` 改委托 | 既有解析集成/验收用例通过；业务路径无第二处 parser ProcessBuilder；请求含企业端功能维；**资源硬限验收清单同期勾选**（不得只跑 golden 即合端口） | 1–2 人日 |
| **S2** | `LocalTableCalculator` 同样委托 | `TableCalculation*` 相关用例通过；计算器内无裸 ProcessBuilder | 0.5 人日 |
| **S3** | parserVersion 白名单 → 预置 `ModuleVersion` 种子（`migration-common` V190+ 相关表，属 B1 表族） | 种子中的 version 字符串与现白名单**值不变**；五维可查（至少功能+版本+运行时；厂商/租户可先占位） | 1 人日 |
| **S4** | golden 回归 + 超时/限额用例 | 同输入 golden 输出一致；超时与超限仍失败且码稳定 | 1–2 人日 |

**合计约 4–6 人日。** 调用点仅上述 2 个业务实现类（外加委托后的测试夹具）。

### 与 B1 的依赖

- B2 **可先于**完整 qualityops 应用层落地端口与 LocalProcessAdapter。
- 种子表 / `qo_module_version` 等属 **B1 表族**（V190+）；无表时 S3 可用测试夹具或临时配置，但合入主干前须落在 `migration-common`。
- 五维登记模型以 B1 为准；B2 负责执行路由与适配器边界。

### 风险

- **R3**：`warnings` 枚举与 `parserVersion` 是隐式契约；S3/S4 必须值不变，否则 knowledge 下游断裂。
- 沙箱路径 macOS/Linux 分裂：集中代码时禁止「顺手重构」隔离策略。
- `model-agent` / `engine-http`（同一适配器）预留若过早被业务直接 HTTP 调引擎，会绕过端口——须靠代码评审 / 后续 ArchUnit 禁止业务包直依赖引擎客户端（候选，不锁定）。

---

## 后果（Consequences）

### 正向

- 两处 parser 直调收敛；新企业端功能（质检、标注、修复建议）共用同一执行面。
- 五维索引支持「按企业端功能替换」，同时可按厂商/运行时/版本/租户约束选用。
- `DocumentParser` 兼容外观降低 KnowledgeWorker 改动面。

### 代价

- 短期多一层委托与种子数据。
- 首版不启用 model-agent，产品期望「马上全用模型」须靠排期，不能靠本 ADR 自动生效。

### 回退

- S1/S2 可回退为类内 ProcessBuilder（不推荐）；若放弃统一端口，须废止本 ADR 并说明如何避免第三处直调。

---

## 明确不做（Out of scope）

- 不启用 `model-agent` / `engine-http` 真实调度（只预留路由与登记字段；二者首版同一适配器实现，非两个并行首版实现）。
- 不收编 `ProcessCollectionAdapter`、`NativeScheduleRules` 等非 parser ProcessBuilder。
- 不改 sandbox.py 行为与超时/限额数值（迁移期）。
- 不写 B3–B6 正文；不 commit / push；不改业务代码（本文仅为文档）。

---

## 验收清单（文档级；实现阶段对照）

### 端口合入前硬条件（测试审查）

- 合入前必须通过 **golden** 回归与 **超时/限额** 用例（见 S4）。
- `parserVersion` 与 `warnings` 相关取值须与迁移前**字节级不变**（不得改拼写、枚举字面量或序列化形状）。
- **沙箱行为禁止改**（macOS `sandbox-exec` / Linux 路径与隔离策略原样集中进适配器，禁止顺手统一或放宽）。
- 首版 PR 审查清单必勾：`ProcessBuilder` 调 parser **仅**在适配器内（与 ADR-B1 可测性约束对齐）。

### 勾选清单

- [ ] 两调用点（`LocalDocumentParser`、`LocalTableCalculator`）均经端口，无业务侧裸 ProcessBuilder 调 parser。
- [ ] `runtimeKind` 含 `local-process` / `in-process`，并**预留** `model-agent` 与 `engine-http`（**同一适配器实现**）。
- [ ] **登记/路由是五维索引**（企业端业务功能 · 模型/厂商 · 运行时类型 · 版本 · 租户/企业；**不含环境**）；触发维为企业端业务功能；**禁止**「仅按 moduleVersionId 路由」。
- [ ] **禁止**以厂商名/模型名作为唯一触发键；厂商仅为约束维。
- [ ] S1–S4 验收标准在实现 PR 中可勾选；parserVersion 种子值不变。
- [ ] `ExecutionRequest` **显式**含 `enterpriseFunction`（及可选约束维）；`moduleVersionId` 可已解析或空；而非 vendor 主键。
- [ ] 进行中 attempt **锁定** `moduleVersionId`；替换只影响新调度。

### 资源硬限验收（实现 PR 必勾 · 质量性能 §1）

- [ ] 存在配置化的**有界**队列容量与并发上限（信号量或等价）；默认值写在 PR 说明与配置样例中；**禁止**无界排队。
- [ ] 单测/集成：填满队列或打满并发时返回稳定失败码（`EXECUTION_QUEUE_FULL` / `EXECUTION_CONCURRENCY_LIMIT` 等），且无成功伪绿。
- [ ] 超时用例：队列等待或执行超时均失败且码稳定（`EXECUTION_TIMEOUT` 或拆分码）。
- [ ] 成功与失败路径均覆盖 job 目录清理断言（目录不存在或为空）。
- [ ] 无 `continue-on-error`；无「跳过资源限制」的测试后门进入默认 CI。

---

## 参考

- [`ADR-B1-首版边界-新包与只读上游.md`](./ADR-B1-首版边界-新包与只读上游.md)（只读上游=`UpstreamReadPort`、五维、attempt 锁定、`simulated` 默认）
- [`FOLLOWUP-B1B2-质量性能硬约束-20261030.md`](./FOLLOWUP-B1B2-质量性能硬约束-20261030.md)（§1 资源硬限原文）
- [`02-目标分层.md`](./02-目标分层.md) §2 · [`01-现状盘点.md`](./01-现状盘点.md) §1.3
- 仓内：`apps/api/.../knowledge/DocumentParser.java`、`LocalDocumentParser.java`、`LocalTableCalculator.java`
