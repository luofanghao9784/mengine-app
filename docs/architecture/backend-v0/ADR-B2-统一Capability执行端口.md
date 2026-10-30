# ADR-B2：统一 Capability 执行端口（CapabilityExecutionPort）

| 字段 | 内容 |
| --- | --- |
| 状态 | **Proposed（follow-up2 安全必改）**。相对已合 #13（`8df9868`）；并入安全审查 S-01–S-12 与总负责人代拍决策（经 DQ）；仍不推仓。 |
| 日期 | 2026-10-30（Asia/Shanghai） |
| 作者 | 梦擎·系统架构 |
| 审阅 | 梦擎重构总监（提纲已通过；正文待总负责人批） |
| 依据 | [`01-现状盘点.md`](./01-现状盘点.md) · [`02-目标分层.md`](./02-目标分层.md) · [`03-首版闭环落点.md`](./03-首版闭环落点.md) · [`04-风险与ADR提纲.md`](./04-风险与ADR提纲.md) · [`ADR-B1-首版边界-新包与只读上游.md`](./ADR-B1-首版边界-新包与只读上游.md) |
| 仓库快照 | `/workspace/dreamcore` @ `a2a41d5`（follow-up2 基线；原 `3325b6e`）（只读核实调用点；本文不改业务代码） |
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
// 包：com.dreamcore.workspace.capability（M2）
interface CapabilityExecutionPort {
  ExecutionResult execute(ExecutionScope scope, ExecutionRequest req); // scope 来自认证上下文（S-01）
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
2. **约束维**（可组合）：模型/厂商 · 运行时类型 · 版本；**租户/企业维是授权边界**（来自认证上下文，请求不可自选，S-10）。先按功能 + 约束解析登记，得到唯一（或默认策略下的）`moduleVersionId` 后，**再**按该版本的 `runtimeKind` 选适配器。
3. **厂商是维度之二，不是唯一主键**；不得以厂商名冒充企业端功能。
4. **`moduleVersionId`**：可为调用方已解析结果；若空则由端口/注册表按五维解析。不得把「已带 moduleVersionId」理解成可跳过企业端功能维校验——请求仍须带 `enterpriseFunction`，且与该版本所属功能一致（不一致则失败）。

`Capability` = 某企业端功能下的**实现族**（≠ 功能码）；`ModuleVersion` 挂在 Capability 下。功能码独立列见 ADR-B1。

### ExecutionRequest / ExecutionResult（关键字段草案）

**Request（建议字段；契约定稿可改名，不得删维度语义）：**

| 字段 | 含义 |
| --- | --- |
| `enterpriseFunction` | 企业端业务功能（触发维） |
| `moduleVersionId` | 已解析的模块版本；若空则端口/注册表按五维约束解析 |
| ~~`tenantId`~~ | **不进请求体**（S-01，总负责人代拍）。`tenantId`/`spaceId` 由服务端从**认证上下文**推导为 `ExecutionScope`，以独立参数传入端口：`execute(ExecutionScope scope, ExecutionRequest req)`；`ExecutionScope` 只能由接口层/调度层从会话或 attempt 凭据构造。路由 `{t}` 与会话租户不一致 → 403。租户维是**授权边界**，不是筛选条件，不能由请求自选（S-10）。 |
| `vendorOrModel` | 可选约束（维度二）；不得单独作为触发键 |
| `runtimeKindHint` | 可选约束（维度三） |
| `inputVersionId` | 上游材料版本（只读上游，见 B1） |
| `step` | 流程步（parse / quality-check / …） |
| `inputRef` | **服务端签发的不透明句柄**（由 `UpstreamReadPort` 返回，绑定 tenant/space）；**禁止**任意对象存储键或文件路径（S-01） |
| `limits` | 超时、输出大小等；**只能收紧，不得放宽**：`effective = min(request, moduleVersion, 平台全局上限)`；全局上限在代码/配置，不进库；`real`/调试同样适用（S-03）。不得携带凭据（S-08） |
| `executionMode` | `simulated` \| `real`（调试默认见 B1） |

**Result（建议字段）：**

| 字段 | 含义 |
| --- | --- |
| `status` | 与步骤协议对齐的执行态（解析侧现有 READY/PARTIAL/FAILED/UNSUPPORTED 等经适配器映射） |
| `moduleVersionId` | 实际执行的版本 |
| `runtimeKind` | 实际适配器 |
| `warnings` | 警告码列表（保持既有枚举语义，见风险） |
| `outputRef` / 结构化载荷 | 按步骤：chunks、表格结果、质检 findings 等 |
| `errorCode` | 失败时稳定码；**不回显** stderr、主机路径、异常原文（S-09） |
| 审计字段 | `actorId`、`actorRole`、`tenantId/spaceId`、`executionMode`、`enterpriseFunction`、`moduleVersionId`、`recipeId`、`inputVersionId`、`inputHash`、`traceId`(=`requestId`)、起止时间、结果码——写入 attempt/调试跑审计记录（S-07，见下文「安全」） |

具体 JSON/OpenAPI 形状以契约五分片为准；本文只钉语义。

### LocalProcessAdapter

把现有 ProcessBuilder **约束原样搬入**（核实自 `LocalDocumentParser` / `LocalTableCalculator`）：

- 解释器：`.venv/bin/python -I -B` + `sandbox.py` + job 目录 + 子命令/扩展名。
- `builder.environment().clear()` 后仅放受控 `PATH`。
- 超时：解析 85s；`table-compare` 10s（按 ModuleVersion / 步骤配置，**首迁不得改数值**）。
- 输出限额：解析约 4MB；表格约 60KB（同上，值不变）。
- 沙箱分 OS：**生产基线仅 Linux**（systemd-run + bwrap，见下文平台基线表）；macOS `sandbox-exec` 路径保留但**仅限开发**，不作安全基线（总负责人代拍，S-05）。集中代码时**不得放宽**任何一侧；收紧须经安全审查并附回归。
- **白名单（S-02，总负责人代拍，修正 #12/#13）**：`parserVersion ∈ {local-1, local-2, local-3, docling-2.140.0}` 及可执行配方（解释器、脚本、子命令）**保持代码硬编码常量**（recipe 表），数据与登记**均不能修改**。`ModuleVersion` 只能引用已在代码白名单中的 `recipeId`，不得携带 argv、路径、env、sandbox profile 片段；启动参数**不得来自数据或请求**。准入时校验 + 运行时再校验，未知 `recipeId` fail-closed。种子值不变（S3）。

业务代码中指向 parser 的 `ProcessBuilder` 只应留在该适配器内。

### DocumentParser 兼容外观

- `LocalDocumentParser` 改为委托 `CapabilityExecutionPort`（预置企业端功能如「文档解析」、`moduleVersionId` 可对应 `parse/local-3` 等种子或留空由端口解析）。
- `DocumentParser` 接口保留，供 `KnowledgeWorker` 无感；lease/attempt 语义不变。
- `LocalTableCalculator` 同样委托（企业端功能如「表格比对」）。

### 进行中 attempt 锁定 `moduleVersionId`

- 调度创建 attempt 时写入并**锁定**当时的 `moduleVersionId`（及解析所用企业端功能 / 关键五维快照，以契约定稿为准）。
- 能力替换、新版本准入、默认策略变更——**只影响新调度**的 attempt；**禁止**改写进行中（queued 已绑定、running、awaiting_human）attempt 的实现绑定。
- 与 ADR-B1 同条；兼容外观路径（KnowledgeWorker）同等适用。

**ModuleVersion 废弃与强制下线（DQ 裁定）**
- 废弃（deprecated）：已发布配置**保持可跑**，版本标 `deprecated`；**禁止新绑定**（新配置/新默认不得选用）；**不自动切换**到其它版本。
- 已绑定该版本的进行中 attempt 与已发布配置的新调度继续使用该版本（与 attempt 锁定一致：废弃不改写任何已绑定版本）。
- 强制下线（retired）是**单独显式操作**：须权限码（建议 `QUALITY_OPS_MODULE_RETIRE`，platform 侧，待安全草案后定稿）并写审计（actor、traceId、原因、受影响配置数）；下线后新调度 fail-closed（建议码 `MODULE_VERSION_RETIRED`），进行中 attempt 的处置须在该操作中显式选择并审计，不得静默改绑。


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

### 包结构与依赖方向（M2/M3 · 架构逻辑，DQ 采纳）

| 名称 | 全限定名（PR1 前定死） | 说明 |
| --- | --- | --- |
| 执行端口包 | `com.dreamcore.workspace.capability` | 端口 `CapabilityExecutionPort`、`ExecutionScope`、注册表解析 `capability.registry`、适配器 `capability.adapter`（`LocalProcessAdapter`、`InProcessRuleAdapter`、`ModelAgentOrEngineHttpAdapter`） |
| 输入句柄解析 | `com.dreamcore.workspace.capability.InputHandleResolver` | capability 内接口；由上游适配器实现，使 capability 不依赖 material/knowledge |
| 只读上游端口 | `com.dreamcore.workspace.upstream.UpstreamReadPort` | 新顶层包（与仓内 `workspace.material`、`workspace.knowledge` 同级，按现有「一功能一顶层包」结构） |
| 上游适配器 | `com.dreamcore.workspace.upstream.adapter.MaterialKnowledgeReadFacade` | 唯一允许依赖 material/knowledge **公开服务**的位置；实现 `UpstreamReadPort` 与 `InputHandleResolver` |
| 应用层 | `com.dreamcore.workspace.qualityops` | 只依赖 `capability`（端口）与 `upstream`（端口） |

依赖方向（写死，ArchUnit 断言，首个代码 PR 前绿）：
1. `capability..` **不依赖** `qualityops..`、`material..`、`knowledge..`（也不依赖 `upstream.adapter..`）。
2. `knowledge..`、`material..` **不依赖** `qualityops..`（knowledge 兼容外观可依赖 `capability` 端口）。
3. `material ↔ knowledge` 现存循环（仓内事实：`material/MaterialService.java:6` import `knowledge.KnowledgeService`；`knowledge/MaterialProcessingService.java:5`、`knowledge/MaterialGovernanceService.java:4`、`knowledge/WeKnoraIndexWorker.java:3` import `material.*`）用 **ArchUnit `FreezingArchRule` 冻结**，违规数只减不增。

ProcessBuilder 规则（M3）：`new ProcessBuilder` 只允许出现在 `com.dreamcore.workspace.capability.adapter..`。显式白名单（只减不增）：

| 例外 | 位置（a2a41d5 核实） | 负责人 | 二期收口编号 |
| --- | --- | --- | --- |
| `collection/ProcessCollectionAdapter` | `ProcessCollectionAdapter.java:23` | 梦擎·后端开发 | CAP-P2-01 |
| `conversation/NativeScheduleRules` | `NativeScheduleRules.java:17` | 梦擎·后端开发 | CAP-P2-02 |

parser（`LocalDocumentParser.java:27`）与表格计算（`LocalTableCalculator.java:26`）**不设任何例外**，S1/S2 后必须迁入 `capability.adapter`。

### 安全决策（follow-up2 · 安全审查 S-01–S-12 · 不得弱于 `/workspace/security-review/ADR-B1-B2-安全审查.md`）

> 来源：〔总负责人代拍·经 DQ〕= 已定决策；〔安全审查〕= 报告建议采纳为决策；〔待…〕= 未定。

**S-01（P0）作用域只从认证上下文推导〔总负责人代拍·经 DQ〕**
1. `tenantId` / `spaceId` **只**由服务端从**认证上下文**（会话或 attempt 凭据）推导为 `ExecutionScope`；**不进请求体**；调用方传入的租户值一律不信任。路由 `{t}` 与会话租户不一致 → 403。
2. 端口入口断言同一作用域：`inputVersionId`/`inputRef` → 所属 tenant/space；`moduleVersionId` → 对该 tenant 可用（S-10）；`attempt` → tenant。任一不一致 → `EXECUTION_SCOPE_MISMATCH`，fail-closed，不降级。
3. `inputRef` 只接受 `UpstreamReadPort` 签发的不透明句柄（绑定 tenant/space），由 `InputHandleResolver` 带 scope 解析；不接受任意对象键或路径。
4. 跨租户访问返回 403/404，**不得** 200 后再报失败。

**S-02（P0）local-process 白名单代码硬编码〔总负责人代拍·经 DQ；严于报告「构建期登记」，以本条为准〕**
1. 可执行配方（解释器、脚本、子命令、parserVersion）= **代码硬编码常量 recipe 表**；数据、登记 API、配置**均不能修改**。
2. `ModuleVersion` 只能引用已在白名单中的 `recipeId`；schema 不含 argv、路径、env、profile；ProcessBuilder 参数只来自常量表（job 目录由端口生成）；启动参数不得来自数据或请求。
3. **登记权限与审批链**：`local-process` / `in-process` 版本只能由 platform（`PLATFORM_ADMIN`）登记，须双人审批或走发布流水线；tenant-admin 只能在 platform 已准入版本中「选用/设默认」，不能新建（403）。新增 recipe = 代码 PR，触发安全审查。
4. 准入校验 + 运行时再校验；未知 `recipeId` fail-closed。

**S-03（P1）limits 只能收紧，不得放宽**：`effective = min(request, moduleVersion, 平台全局上限)`；全局上限在代码/配置；`real`/调试无例外。

**S-05（P1）沙箱不得放宽，收紧须经安全审〔生产仅 Linux：总负责人代拍·经 DQ〕** — 平台基线表（只读核实 `/workspace/dreamcore` @ `a2a41d5`）：

| 项 | Linux（**生产安全基线**） | macOS（**仅开发**，不作安全基线） |
| --- | --- | --- |
| 隔离 | systemd-run `--user` unit + bwrap `--unshare-all --unshare-user --unshare-cgroup --die-with-parent --new-session --cap-drop ALL --clearenv`（`linux_sandbox.py:37-43`、`linux_worker.py:30-31`） | `sandbox-exec`：`deny default`，但 `(allow process*)`、无过滤 `(allow mach-lookup)`（`sandbox.py:9`） |
| 网络 | 网络命名空间隔离（`--unshare-all`） | 无显式 network deny |
| uid | 拒绝 root → `PARSER_ROOT_FORBIDDEN`（`linux_sandbox.py:15-16`） | 未找到等价校验 |
| cgroup | MemoryMax 512MiB（docling 2GiB）、MemorySwapMax=0、TasksMax 32（64）、CPUQuota 50%（100%）、NoNewPrivileges、KillMode=control-group（`linux_sandbox.py:39-41`） | 无 |
| rlimit | FSIZE 8MiB；CPU 50s（table 5s）；NOFILE 128（`linux_worker.py:52-54`） | FSIZE 8MiB；CPU 50s/5s；无 AS/NOFILE/NPROC（`sandbox.py:25-27`） |
| 文件系统 | ro-bind `/usr` `/lib` `/lib64`、venv、tessdata、脚本；`/tmp` `/job` tmpfs；拒绝 input symlink；脚本须在 ROOT 下（`linux_worker.py:32-46`、`linux_sandbox.py:19-20`） | 读系统库/ROOT/job；写仅 job 与 `/dev/null`（`sandbox.py:8-9`） |
| env | 白名单 PATH/LANG/TMPDIR/TESSDATA_PREFIX/OMP_THREAD_LIMIT/PYTHONDONTWRITEBYTECODE（`linux_worker.py:47-50`）；Java `environment().clear()` 后仅 PATH（`LocalDocumentParser.java:28`） | 同类白名单（`sandbox.py:22`） |
| 超时 | Java 85s / 10s（`LocalDocumentParser.java:31`、`LocalTableCalculator.java:29`）；Python 80s / 12s，`RuntimeMaxSec`=超时−2（`linux_sandbox.py:36,40`） | Python 75s / 8s（`sandbox.py:32`） |
| 输出 | 解析 ≤4,000,000 B、chunks ≤500、单块 ≤4000 字、总 ≤800,000；表格 ≤60,000 B（`LocalDocumentParser.java:32-41`、`LocalTableCalculator.java:29`） | 同 |

任何沙箱 diff 须对照本表；放宽 = 安全一票否决；收紧须经安全审查并附回归。

**S-06（P1）model-agent / engine-http 启用前置条件**：以下全部满足并经安全审查前，适配器保持 `NotEnabled`：
1. 文档/chunks/表格/上游文本一律视为不可信数据，与指令通道分离；
2. 模型输出**只作建议**：`qualityVerdict`/`publishStatus` 变更须经确定性规则或人工复核，模型不得直接驱动发布；
3. 工具调用沿用 S-01 作用域，由 attempt 级短期凭据授权（参照现有 `/internal/v1/agent-access/{task}` 以 attempt Bearer 鉴权，`AgentAccessController.java:8,17`）；
4. 出网仅限登记过的厂商端点；输出 URL / markdown 链接过滤或去链接化；
5. 每次调用上下文只来自单一租户（无跨租户共享会话、few-shot、prompt 缓存）；
6. 记录发往厂商的数据分级，厂商关闭训练与留存〔待法务确认〕；
7. 注入夹具集（直接/间接/外泄 URL）在 simulated 下绿；
8. 密钥满足 S-08。

**S-07（P1）real 模式权限码与审计**〔**已定稿** → [S-07 定稿](./S-07-real模式权限码与审计字段-定稿.md)，下列建议名以定稿为准〕
- 定稿前 `real` 分支一律拒绝（fail-closed）。
- 建议权限码（仿仓内大写下划线风格，如角色 `PLATFORM_ADMIN`/`TENANT_ADMIN`、拒绝码 `LIBRARY_PERMISSION_DENIED`；仓内**未找到**独立权限码注册表，见 B1 Q3）：`QUALITY_OPS_DEBUG_RUN_REAL`、`QUALITY_OPS_PUBLISH`（tenant 侧），`QUALITY_OPS_MODULE_REGISTER`（platform 侧，S-02）；拒绝码 `QUALITY_OPS_PERMISSION_DENIED`。
- 审计最小集：`actorId`、`actorRole`、`tenantId/spaceId`、`executionMode`、`enterpriseFunction`、`moduleVersionId`、`recipeId`、`inputVersionId`、`inputHash`、`traceId`(=`requestId`，对齐 `identity_audit.request_id`)、起止时间、结果码；只追加，拒绝 UPDATE/DELETE，租户不可删。
- platform 代租户（总部支持会话）：**DQ 裁定**——对 qualityops 只读；首版不允许执行或发布，后端强制拒绝（建议码 `QUALITY_OPS_SUPPORT_READ_ONLY`）。
- 审签：安全审查起草 → 系统架构定稿入契约 → 架构逻辑 + 安全审查双签。

**S-08（P1）密钥管理决策（不锁定厂商）**
1. 厂商 key、引擎回调凭据只放密钥管理服务 / secret 存储；适配器执行时按 `vendor` 拉取；不进 `ExecutionRequest`、`ModuleVersion`、`qo_*`、日志、子进程环境。
2. `local-process` 子进程 env 白名单为不变量。
3. 规定轮换周期与泄露应急（吊销、重签、审计回溯）；gitleaks 命中先轮换。
4. 租户自带模型 key（BYOK）〔总负责人代拍·经 DQ〕：设计预留——加密存储、按租户隔离、不落日志、禁止跨租户回退到平台 key；**首版不开放**。

**S-09（P2）错误回显**：stderr 只进服务端日志（截断 + 脱敏），对外只返回稳定码；清理失败须日志/指标可观测（现状 `catch(Exception ignored)` 静默：`LocalDocumentParser.java:48`、`LocalTableCalculator.java:36`），PR4 修正。

**S-12（P2 → PR4 必验）进程组 / unit 不随父进程退出**
- 现状：Java 超时 `destroyForcibly` 后代（`LocalDocumentParser.java:47`），但 `systemd-run --user` unit 属用户 manager，不是 Java 后代；Python launcher 先被强杀则 finally 不执行，unit 跑到 RuntimeMaxSec。
- 决策：三层超时不变量 **外层(Java) > 内层(Python) > RuntimeMaxSec**；端口生成 unit 名并传入，取消/超时显式 `systemctl --user stop <unit>`；**信号量待 unit 确认结束才释放**（残留进程计入并发）。
- Linux 上 table-compare：首版**显式不可用**，返回稳定失败码（建议 `EXECUTION_RUNTIME_UNAVAILABLE`），直到 Linux 沙箱路径就绪或 parser 容器沙箱方案（系统架构 + 安全审查共出）落地；不得回落无沙箱执行（`LocalTableCalculator.java:17` 现依赖 `/usr/bin/sandbox-exec`）。

### 安全复核补丁（2026-10-30 安全复核 → S-02/S-07/S-10/S-12/S-13/S-14）

**S-07 定稿**：权限码、拒绝码、审计字段、R1–R8、14 条负向用例以 [`S-07-real模式权限码与审计字段-定稿.md`](./S-07-real模式权限码与审计字段-定稿.md) 为准；本文「安全决策 S-07」中的建议名作废以定稿为准。审计表 `qo_audit_event` 迁移在 PR3。

**S-02 白名单变更机制**：白名单/配方 = 代码常量（`capability.adapter` 内），只经代码 PR 修改，须代码评审 + 两名 CODEOWNERS 批准；ModuleVersion 登记只引用 `recipeId`。「双人审批 vs 发布流水线」由 **PR2**（契约）书面选定，早于登记 API 所在 **PR5b**。

**S-10 会话类型**：`ExecutionScope(tenantId, spaceId, actorId, sessionKind, traceId)`，`sessionKind ∈ {NORMAL, HQ_SUPPORT_ADJUSTMENT, HQ_SUPPORT_TEST}`（对应 `SupportAccess.java:26` 的 mode）；端口对任一 HQ_SUPPORT_* 拒绝 execute（dry/real）、publish、dry run → 403 `QUALITY_OPS_SUPPORT_READ_ONLY`，先判会话再查资源。用例：`port_rejects_execute_in_support_session`、`port_rejects_dry_run_in_support_session`、`port_rejects_publish_in_support_session`、`support_session_error_body_identical_for_missing_resource`（PR4a 端口 + PR5 端点）。

**S-13 attempt 凭据**（model-agent 启用前置，PR 8a）：
- 现状暴露点（main `a2a41d5`）：`apps/api/.../AgentAccessController.java:17`（解析 `Bearer <UUID>` 作 attempt）；同模式 `AgentContextController.java:15`、`ArtifactTransferController.java:13`、`LiveAnswerController.java:22`（:23 answer 端点）；`EngineTaskRuntime.java:50`、`:81`（请求体带 attemptId 发往 engine；engine-token Bearer 于 :58/:95 校验）；`ConversationService.java:1203`（`job.token().equals(result.attemptId())`，token 即 attemptId）；`identity_audit.target_id` 存 attemptId（`BriefingGenerationService.java:633` 关联）；`engine/src/main.ts` 使用 attemptId；DB `conversation_attempts.attempt_id` UNIQUE（V19:13）。前端 `src/` 未找到；显式含 attempt 的日志行未找到。
- 决策：独立 256-bit 随机 token；DB 只存 SHA-256 哈希；绑定 `(attempt_id, tenant_id)`；TTL（默认 = attempt 超时上限）；可吊销（attempt 终态/取消即失效）；attemptId 不再作凭据，审计/日志不记 token。
- 用例：`attempt_token_not_equal_attempt_id`、`attempt_token_hash_only_stored`、`attempt_token_wrong_tenant_401`、`attempt_token_expired_401`、`attempt_token_revoked_on_terminal_401`。

**S-14 Linux 基线补列**（补「安全决策 S-05」基线表；**PR4b** 验收）：
| 项 | 要求 | 用例 |
|---|---|---|
| seccomp | 默认拒绝过滤器（禁 ptrace/mount/keyctl/bpf 等），加载失败 fail closed | `sandbox_seccomp_blocks_ptrace` |
| flock 单并发 | 每 job 目录 `flock` 互斥，取锁失败不执行 | `sandbox_job_lock_single_concurrency` |
| stderr 不回显 | 原始 stderr 只进清理后诊断，不进 API 响应/审计 | `stderr_never_echoed_raw` |
| fail-closed 错误码 | `SANDBOX_UNAVAILABLE`、`EXECUTION_RUNTIME_UNAVAILABLE`、`LIMIT_EXCEEDED`、`EXECUTION_TIMEOUT`，无降级直跑 | `sandbox_missing_fails_closed` |
| die-with-parent | `--die-with-parent`/`PR_SET_PDEATHSIG`，父进程死则子进程组死 | `child_dies_with_launcher` |
容器基线（gVisor 等）由 **ADR-B7** 承接（安全审查与 DQ 称 ADR-B3；因与 04「语义收敛」B3 编号冲突改为 B7）。

**S-12 容器路径**：S-12 用例在容器 parser worker（ADR-B7）上同样必跑：`container_timeout_kills_worker_no_residual`、`container_launcher_killed_no_orphan`、`container_semaphore_released_after_exit`；PR7 前。

### 迁移步骤 S1–S4

| 步 | 内容 | 验收标准 | 估计 |
| --- | --- | --- | --- |
| **S1** | 抽 `CapabilityExecutionPort` + `LocalProcessAdapter`；`LocalDocumentParser` 改委托 | 既有解析集成/验收用例通过；S-01 负向用例与「端口安全验收」同期勾选；业务路径无第二处 parser ProcessBuilder；请求含企业端功能维；**资源硬限验收清单同期勾选**（不得只跑 golden 即合端口） | 1–2 人日 |
| **S2** | `LocalTableCalculator` 同样委托 | `TableCalculation*` 相关用例通过；计算器内无裸 ProcessBuilder | 0.5 人日 |
| **S3** | 预置 `ModuleVersion` 种子**引用**代码白名单 `recipeId`（白名单本身仍为代码常量，不迁入表；`migration-common` V190+，属 B1 表族） | 种子中的 version 字符串与代码白名单**值不变**；schema 不含 argv/路径/env 字段；五维可查（至少功能+版本+运行时；厂商/租户可先占位） | 1 人日 |
| **S4** | golden 回归 + 超时/限额用例 | 同输入 golden 输出一致；超时与超限仍失败且码稳定 | 1–2 人日 |

**合计约 4–6 人日。** 调用点仅上述 2 个业务实现类（外加委托后的测试夹具）。

### 与 B1 的依赖

- B2 **可先于**完整 qualityops 应用层落地端口与 LocalProcessAdapter。
- 种子表 / `qo_module_version` 等属 **B1 表族**（V190+）；无表时 S3 可用测试夹具或临时配置，但合入主干前须落在 `migration-common`。
- 五维登记模型以 B1 为准；B2 负责执行路由与适配器边界。

### 风险

- **R3**：`warnings` 枚举与 `parserVersion` 是隐式契约；S3/S4 必须值不变，否则 knowledge 下游断裂。
- 沙箱路径 macOS/Linux 分裂：生产基线 Linux；集中代码时**不得放宽**，收紧须经安全审查（S-05）。
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
- 迁移期不**放宽** sandbox 行为与超时/限额数值；收紧须经安全审查并附回归（S-05）。
- 不写 B3–B6 正文；不 commit / push；不改业务代码（本文仅为文档）。

---

## 验收清单（文档级；实现阶段对照）

### 端口合入前硬条件（测试审查）

- 合入前必须通过 **golden** 回归与 **超时/限额** 用例（见 S4）。
- `parserVersion` 与 `warnings` 相关取值须与迁移前**字节级不变**（不得改拼写、枚举字面量或序列化形状）。
- **沙箱不得放宽**：Linux（生产基线）与 macOS（仅开发）路径集中进适配器；任何 diff 对照「平台基线表」审；收紧须经安全审查并附回归（S-05）。
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

### 端口安全验收（实现 PR 必勾）

- [ ] S-01：`exec_rejects_cross_tenant_input_ref`、`exec_rejects_cross_space_input_version`、`exec_ignores_client_supplied_tenant_id`、`route_tenant_mismatch_returns_403`（红变绿真实用例）。
- [ ] S-02：`module_version_rejects_argv_fields`、`tenant_admin_cannot_register_local_process`、`unknown_recipe_id_fails_closed`；ArchUnit/grep：ProcessBuilder 参数只来自常量 recipe 表。
- [ ] M3：`new ProcessBuilder` 仅在 `capability.adapter..`，白名单仅 2 例外（只减不增）。
- [ ] M2：三条依赖方向 ArchUnit 绿；material↔knowledge freeze 基线已提交。
- [ ] S-03：`limits_request_cannot_exceed_module_default`、`limits_request_can_tighten`。
- [ ] S-10：`exec_rejects_module_version_not_enabled_for_tenant`、`registry_list_hides_other_tenant_private_versions`、`support_session_cannot_execute_or_publish_quality_ops`。
- [ ] 版本生命周期：`deprecated_version_keeps_published_config_running`、`deprecated_version_rejects_new_binding`、`deprecated_version_no_auto_switch`、`retire_requires_permission_and_audit`。
- [ ] S-09：`execution_error_response_has_no_stderr_or_path`。
- [ ] S-05：Linux 沙箱探针（默认 CI Linux job）：`socket.connect` 失败、读 `/etc/passwd` 失败、写 job 外失败、fork 炸弹被 TasksMax 截断、超 MemoryMax OOM 映射稳定码、root → `PARSER_ROOT_FORBIDDEN`。
- [ ] **S-12（PR4 必验）**：`timeout_kills_cgroup_unit_no_residual`——超时/取消后 `systemctl --user list-units 'dreamcore-parser-*'` 为空；**进程组/unit 不随父进程退出**场景（先强杀 Python launcher）同样无残留；信号量在 unit 结束后才释放。
- [ ] S-08：`child_env_allowlist_only`；日志脱敏用例；gitleaks 必过。

---

### 安全复核补充验收（PR 标注）
- [ ] S-07：`attempt_audit_fields_present`、`qo_audit_event_rejects_update_delete`（PR3/PR5）
- [ ] S-10：上列四条 support-session 端口用例（PR4a/PR5）
- [ ] S-13：五条 token 用例（PR 8a，model-agent 启用前置）
- [ ] S-14：五条基线用例（PR4b）；S-12 容器三条（PR7 前）

## 参考

- [`ADR-B1-首版边界-新包与只读上游.md`](./ADR-B1-首版边界-新包与只读上游.md)（只读上游=`UpstreamReadPort`、五维、attempt 锁定、`simulated` 默认）
- [`FOLLOWUP-B1B2-质量性能硬约束-20261030.md`](./FOLLOWUP-B1B2-质量性能硬约束-20261030.md)（§1 资源硬限原文）
- [`02-目标分层.md`](./02-目标分层.md) §2 · [`01-现状盘点.md`](./01-现状盘点.md) §1.3
- 安全审查：`/workspace/security-review/ADR-B1-B2-安全审查.md`；处理表 [`安全必改处理表-S01-S16.md`](./安全必改处理表-S01-S16.md)
- 仓内：`apps/api/.../knowledge/DocumentParser.java`、`LocalDocumentParser.java`、`LocalTableCalculator.java`
