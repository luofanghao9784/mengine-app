# 待拆 CT 队列（对照实施计划 · 架构逻辑 2026-10-30）

基线：origin/main `42cdfd8`（#7 已合；#25/CT-007 已合）。已有 CT-000～005、007；CT-006 为 Mac 预览落地（远端分支 `docs/ct-006-mac-preview-land`，编号占用）。编号从 **CT-008** 起；#7 遗留质量债另占 **CT-024**。一单一 PR。实施计划正文在 `/workspace/agent-tools/dreamcore-backend-impl-plan-v0/实施计划.md`；main 同步见 `docs/architecture/backend-v0/实施计划同步要点.md`。

## 可立刻写（纯 docs / 门禁）— 优先

| 建议编号 | 短标题 | 对应计划/出处 | 类型 | 依赖 | 建议审查人 | 优先级 |
|---|---|---|---|---|---|---|
| **CT-008** | 纯 docs PR paths-ignore 跳过 API/前端/契约重门禁 | 门禁工程债（#25 类）；非实施计划关键路径，但阻塞纯文档合入纪律 | 门禁 workflow | 无；合入宜选 main 门禁绿窗 | 质量性能 + 架构逻辑 | **P0** |
| CT-009 | `dependency-cruiser.md`「无 workflow」过时描述修正 | 实施计划 §0/§5「交付运维文档修正 PR」 | 纯文档 | 无 | 质量性能 + 发布验收 | P2 |
| CT-010 | ADR-B7 Linux 容器 parser 沙箱（文档入库） | 实施计划 §8 裁定9、§11.6/11.11；S-05/S-12/S-14 容器路径 | 纯文档 | 系统架构+安全审查出草稿 | 架构逻辑 + 安全审查（+质量性能） | P1（4b/PR7 前置） |


> CT-008 合入：可援引上方「合入例外」；本单新引入红仍 P0 必清。

## 实施计划关键路径（尚未有 CT）

| 建议编号 | 短标题 | 对应计划 PR/阶段 | 类型 | 依赖 | 建议审查人 | 优先级 |
|---|---|---|---|---|---|---|
| CT-011 | PR 0b 一键启动工程化（trial:up / 构建依赖） | PR 0b | 门禁/脚本（偏运维） | PR 0（#7，已合） | 质量性能 + 架构逻辑；涉暴露面加安全审查 | P1 |
| CT-012 | PR 1 ArchUnit 依赖断言 + G5 workflow hygiene | PR 1；G4/G5；M2/M3；S-02 白名单冻结 | 测试契约 / 业务代码（test） | PR 0 | 架构逻辑 + 质量性能；安全审查（ProcessBuilder） | P0（首个 qualityops 代码前） |
| CT-013 | PR 2 契约五分片 + enterpriseFunction + S-07 契约面 | PR 2；G3/G6；S-01/S-02/S-07/S-10 契约 | 测试契约 / 契约文档 | PR 0（计划已裁「PR2 只依赖 PR0」）；S-07 已定稿 | 架构逻辑 + 质量性能 + 安全审查 | P0 |
| CT-014 | PR 3 V190+ `qo_*` 迁移（tenant_id、审计只追加） | PR 3；S-04/S-07 迁移验收 | 业务代码（migration） | PR 1+2 | 架构逻辑 + 质量性能 + 安全审查；交付运维介入演练 | P0 |
| CT-015 | PR 4a CapabilityExecutionPort + LocalProcessAdapter | PR 4a；B2 S1/S2/S4；S-01/S-10 端口用例 | 业务代码 | PR 3、PR 1；硬限默认值已给 | 架构逻辑 + 质量性能 + 安全审查 | P0 |
| CT-016 | PR 4b 资源硬限 + ModuleVersion 种子 + S-12/S-14 | PR 4b；S-03/S-12/S-14 | 业务代码 | PR 4a；**ADR-B7 已合** | 架构逻辑 + 质量性能 + 安全审查 | P0 |
| CT-017 | PR 5 pii-regex/v1 闭环（check→publish） | PR 5；S-07/S-10 端点 | 业务代码 | PR 4b | 架构逻辑 + 质量性能 + 安全审查 | P0 |
| CT-018 | PR 5b 第四端登录与写入后端（ADR-B8） | PR 5b；S-07 越权用例 | 业务代码 | PR 5 | 架构逻辑 + 质量性能 + 安全审查 | P0 |
| CT-019 | PR 6 data-version 只读 API + S-15 WeKnora | PR 6；S-04/S-15 | 业务代码 | PR 5 | 架构逻辑 + 质量性能 + 安全审查 | P1 |
| CT-020 | PR 7a 前端最小接入 A1–A5（含第四端前端） | PR 7a | 业务代码（前端） | PR 5b + PR 6 | 发布验收 + 质量性能；架构逻辑可选 | P1 |
| CT-021 | PR 7 四端远程预览部署 | PR 7；S-08 轮换等 | 门禁/运维/部署 | PR 7a、PR 0b、ADR-B7 | 安全审查 + 发布验收 + 质量性能 | P1 |

## 首版外 / 后置

| 建议编号 | 短标题 | 对应 | 类型 | 依赖 | 建议审查人 | 优先级 |
|---|---|---|---|---|---|---|
| CT-022 | PR 8a attempt 独立随机 token（S-13） | S-13；model-agent 启用前置 | 业务代码 | 不在 PR0–7；早于任何 model-agent 启用 | 安全审查 + 架构逻辑 + 质量性能 | P1（启用前必清） |
| CT-023+ | model-agent / engine-http 启用（B2 S-06 八项） | 实施计划明确不在首版 | 业务代码 | CT-022 + S-06 法务等 | 安全审查 + 架构逻辑 + 质量性能 | P2（首版后） |
| （收口） | C-03/C-04 等临时项拆除 | 实施计划 §11.3 | 业务代码 | 对应拆除点 | 按改动面配人 | P2 |

## 已有 CT 覆盖（不重复拆）

| 已有 | 覆盖 |
|---|---|
| CT-000 / CT-004 | PR 0（#7）workflow 补丁（已合 main） |
| CT-001 / CT-002 | #230 / 生命周期微秒（已合） |
| CT-003 | NativeAutomaticContinuity #208 测试契约（待执行） |
| CT-005 / CT-006 | Mac 本机预览与落地 |
| CT-007 | 审批流程整改纯文档（#25，已合 main `42cdfd8`） |

## 合入例外（总负责人拍板 · 2026-10-30，队列级口径）

> **本单未改动路径上的基线已知红，经 PR 正文举证与 main 同源后不挡合入；本单新引入红仍挡。**

- 适用于：CT-008 等「改动面窄、但仍触发全量门禁」的 PR；亦适用于后续同类门禁/纯文档单（须在该 PR 正文举证，不可口头）。
- 不适用于：本 diff 改过的路径上新出现的红；无法举证 main 同源的红；用 `continue-on-error` / 放宽断言制造的假绿。
- 与 CT-007「不允许带红合入」关系：CT-007 禁的是**带着未处理红强行合**；本例外把「未改路径 + 已举证的 main 基线红」从「本单必须清的红」中划出，仍要求本单新引入红清零 + 两人审留痕。
- CT-008 草稿已写入例外：① 鸡生蛋/合入例外联动、⑥ PR 正文「基线已知红举证表」+ 合入条件、⑦ 基线红症状行；路径 `/workspace/agent-tools/CT-008-draft-docs-path-filter.md`，正式名 `docs/codex-tasks/CT-008-docs-path-filter.md`。

## #7 遗留质量债（**不并入 #25 / CT-007**）

> DQ 要求：`TaskContext 慢测/lease（#7 ④/⑥）` 必须单列进待拆队列，**不要**写进 #25（CT-007 已合，且属流程文档，不含本债）。

| 建议编号 | 短标题 | 对应计划/出处 | 类型 | 依赖 | 建议审查人 | 优先级 |
|---|---|---|---|---|---|---|
| **CT-024** | TaskContext 慢测/lease（#7 ④/⑥） | #7 定性：`GeneralExperienceTaskContextIntegrationTest` ~701s + `TASK_ACCESS_DENIED`（P1-backlog TBD-004）；CT-004 context 分片已合（只拆片不治慢因）；实施计划 §11.7/4b 验收「worker lease > 120s」 | 测试性能 / 质量债（慢测根因 + lease 压测门槛） | CT-004 已合；与 TBD-001～005 并行，**不**并入 CT-007/#25 | 质量性能（主）+ 架构逻辑；涉 `TASK_ACCESS_DENIED` 加安全审查 | **P1** |

范围提示（写正式 CT 时拆清，本队列只立项）：
1. **慢测**：按 surefire/逐用例耗时定位 TaskContext（及同 context 片 PublicationFeedback）数百秒主因（锁等待 / 轮询 / parser·OCR / 共享库膨胀），给出可验收的削时或拆类方案；**禁止**只靠调大 timeout。
2. **lease**：落实 4b 前压测记录要求的 worker lease > 120s（parse/table-compare 并发场景），证据进 PR；与 CT-016（PR 4b）验收衔接，本单可先出测量与门槛，不提前做 4b 业务。
3. **`TASK_ACCESS_DENIED`**：TBD-004 本地/CI 现象栈帧定位；权限修复另单或并入本单须安全审查点头。

## 备选 B（context 红修红 CT）

除上方 **CT-024**（TaskContext 慢测/lease）已立项外：其余 TBD-001～003/005 等「context 红」修红 CT 在只读、不跑 CI 前提下仍不能单独立项复现步骤。**交质量性能**跟 TBD；**不要**塞进 #25/CT-007。

## 编号冻结（DQ 2026-10-30）
| 编号 | 用途 | 状态 |
|---|---|---|
| CT-008 | 纯 docs path-filter / paths-ignore | 本 PR 入库执行单；workflow 由老板跑本单时推 |
| CT-024 | TaskContext 慢测/lease（#7 ④/⑥） | 待写执行单 |
| CT-025 | Mac 实测（交付） | 编号冻结，避免撞号；执行单待写 |
| CT-026 | 后端 wiki 基线红 backlog | 编号冻结，避免撞号；执行单待写 |

