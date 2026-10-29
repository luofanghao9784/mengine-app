# 梦擎 · 后端架构首版草稿 v0（本地，不推仓）

| 文件 | 说明 |
| --- | --- |
| [01-现状盘点.md](./01-现状盘点.md) | 模块边界、依赖、耦合、契约缺口、七套语义对照、对入口清单的核实 |
| [02-目标分层.md](./02-目标分层.md) | 分层图、Capability 执行端口（覆盖 parser 直调，成本约 4–6 人日）、新表、语义收敛 |
| [03-首版闭环落点.md](./03-首版闭环落点.md) | 五步落点表、最小纵切 |
| [04-风险与ADR提纲.md](./04-风险与ADR提纲.md) | 风险 R1–R7、ADR-B1～B6 提纲；**B3–B6 仍仅提纲** |
| [ADR-B1-首版边界-新包与只读上游.md](./ADR-B1-首版边界-新包与只读上游.md) | **正文**：修正后采纳新包/新路径/新表；只读上游修正条款；`qualityops`↔`quality-ops`↔`qo_`；调试默认 `simulated`；**模型能力与企业端功能登记原则（五维）** |
| [ADR-B2-统一Capability执行端口.md](./ADR-B2-统一Capability执行端口.md) | **正文**：CapabilityExecutionPort + LocalProcessAdapter；含 LocalTableCalculator；S1–S4；预留 model-agent；**五维路由/验收** |

基线：`/workspace/dreamcore` main @3325b6e。未改业务代码，未 commit 或 push。开源工具只列候选，不锁定。

待总负责人批纯文档 PR 后再推仓（01–04 + B1 + B2）。
