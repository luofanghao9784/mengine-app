# 梦擎 · 后端架构 follow-up（相对 PR #12 · 本地，不推仓）

> 基线：已合 PR #12（`docs/architecture/backend-v0/` @ `d1cc40b`）。本目录为专家必改 follow-up 修订稿；**仍本地不推仓**，待总监开纯文档 PR。

| 文件 | 说明 |
| --- | --- |
| [01-现状盘点.md](./01-现状盘点.md) | 与 #12 同（本 follow-up 未改盘点事实） |
| [02-目标分层.md](./02-目标分层.md) | **已改**：ExecutionRequest 显式 `enterpriseFunction`；禁「仅按 moduleVersionId 路由」；`UpstreamReadPort`；model-agent/engine-http 同一适配器 |
| [03-首版闭环落点.md](./03-首版闭环落点.md) | 与 #12 同（本轮未改） |
| [04-风险与ADR提纲.md](./04-风险与ADR提纲.md) | **轻改**：UpstreamReadPort / B2 路由与硬限话术对齐 |
| [ADR-B1-首版边界-新包与只读上游.md](./ADR-B1-首版边界-新包与只读上游.md) | **已改**：功能码独立列、Capability≠功能码、attempt 锁定、UpstreamReadPort、首代码 PR 前自动断言、simulated 用例名、workflow 禁 continue-on-error |
| [ADR-B2-统一Capability执行端口.md](./ADR-B2-统一Capability执行端口.md) | **已改**：五维路由钉死、同一适配器、attempt 锁定、**资源硬限**（有界队列+信号量+失败码+超时叠加+job 清理） |
| [FOLLOWUP-B1B2-质量性能硬约束-20261030.md](./FOLLOWUP-B1B2-质量性能硬约束-20261030.md) | 质量性能专家正式条文附录（§1–§4）；B1/B2 正文已写入对应约束，不只链 |

## 相对 #12 的 8 点变更摘要

| # | 来源 | 落点 | 变更 |
| --- | --- | --- | --- |
| 1 | 架构逻辑 | `02` §2 + 分层图 | `ExecutionRequest` 显式 `enterpriseFunction`；删除「仅按 moduleVersionId 路由」；先功能+五维再 runtimeKind；`moduleVersionId` 可已解析或空 |
| 2 | 架构逻辑 | `ADR-B1` 五维原则 | 功能码**独立列**；`Capability` = 功能下**实现族**（≠ 功能码）；分层小表 |
| 3 | 架构逻辑 | `ADR-B1`「进行中 attempt 锁定」+ `ADR-B2` 同名小节 | 进行中 attempt 锁定 `moduleVersionId`；替换只影响新调度 |
| 4 | 架构逻辑 | `02` 依赖规则 / `ADR-B1` 修正 2 / `ADR-B2` 适配器表 | 应用层只依赖 `UpstreamReadPort`；Facade=适配器；`model-agent` 与 `engine-http` 首版**同一适配器实现** |
| 5 | 质量性能 §1 | `ADR-B2`「LocalProcessAdapter / 端口资源硬限」+ 验收勾选 | 有界队列 + 信号量；超限稳定失败码；禁无界排队；超时叠加；job 清理 |
| 6 | 质量性能 §2 | `ADR-B1` 可测性第 2 条 | qualityops **首个代码 PR** 前至少一条可执行自动断言（ArchUnit 或 CI grep） |
| 7 | 质量性能 §3 | `ADR-B1` 可测性第 3 条用例名表 | `simulated` 不得呈生产可用；保留附录用例 ID 语义（含补充别名勾选） |
| 8 | 质量性能 §4 | `ADR-B1` 可测性第 4 条 | 首个 qualityops/admission workflow **禁** `continue-on-error`；admission **禁** live/model |

未改业务代码；未 `git commit` / `push`。质量性能附录保留同目录供对照。
