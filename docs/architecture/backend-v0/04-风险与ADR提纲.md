# 风险与 ADR 提纲（v0）

## 风险
| # | 风险 | 级别 | 缓解 |
| --- | --- | --- | --- |
| R1 | 新闭环误挂到 MaterialGovernance/evaluation 旧入口，语义永久缠死 | 高 | ADR-B1；ArchUnit 禁止依赖 |
| R2 | material↔knowledge 循环依赖被 qualityops 加深 | 高 | 只读 Facade 单向依赖 |
| R3 | parserVersion/warnings 隐式契约在槽位迁移中被破坏 | 中 | golden 回归；值不变 |
| R4 | 迁移目录三分，新表放错 profile | 中 | 统一放 migration-common |
| R5 | 五分片契约仓内缺失，前端约 57 个手写 client 漂移 | 高 | 契约先行 PR + 生成类型 |
| R6 | governance 一词三义，新码被误命名 | 中 | lint/命名规范 |
| R7 | api jar 打包 engine 文件，形成构建耦合 | 低 | 本轮只登记 |

## ADR 提纲
**ADR-B1 首版边界：新包/新路径/新表，material 与 knowledge 只作只读上游 —— 立场：修正后采纳**
- 采纳理由：旧体系里没有一套同时具备可替换模块、三态分列和配置版本（见 01 §3b）。在旧体系上改，迁移和语义成本都会更高。
- 修正 1：parse 不是纯只读。过渡期内解析仍写 `knowledge_runs/chunks`，只是改由 CapabilityExecutionPort 执行。所以应该说「knowledge 的**数据**对 qualityops 只读，knowledge 的**执行路径**进入槽位」。
- 修正 2：只读必须走 `MaterialKnowledgeReadFacade`（查询接口），禁止跨包直接 SQL，禁止引用内部类。
- 修正 3：MaterialGovernance 的规则可以**复制**成首个 in-process 模块，但不能调用旧服务。
- 边界条件：(a) qualityops 不写 material/knowledge 表；(b) 新路由、新表、新包名都不含 governance；(c) 当 Foundation 需要读新结果时，由 Foundation 读 qo_*，而不是 qo 回写旧表；(d) 如果上游版本模型变了（inputVersionId 语义变化），要重开本 ADR。
- 推翻条件：如果证明旧 knowledge_runs 必须承载 quality-check 步（同一个队列），就改为扩展队列。

**ADR-B2 统一 Capability 执行端口**：ProcessBuilder 收敛进适配器；按 moduleVersionId 路由；engine-http 预留。（首个建议落地的 ADR）

**ADR-B3 「检查·发布·问题」语义收敛**：qualityops 是唯一规范语义；旧四套冻结并标注用途；methods 是否演进成 capability-registry 留到二期评估（判据：字段同构度、准入测试是否可复用）。

**ADR-B4 三态分列存储与状态机**：runStatus / qualityVerdict / publishStatus 分列；isStale 独立；不加 withdrawn。

**ADR-B5 契约先行**：五个分片入 contracts，再由契约生成前后端类型；具体生成工具本轮不锁定（候选 openapi-generator，理由：OpenAPI 官方组织维护、多语言长期使用）。

**ADR-B6 迁移目录与编号**：新表统一放 migration-common，从 V190 起。
