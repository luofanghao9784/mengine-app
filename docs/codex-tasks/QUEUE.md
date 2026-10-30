# 待拆 CT 队列（对照实施计划 · 架构逻辑 2026-10-30）

基线：origin/main `f82a579`（随 main 滚动）。已有 CT-000～005、007、008（执行单）；CT-006 为 Mac 预览落地。一单一 PR。实施计划：`/workspace/agent-tools/dreamcore-backend-impl-plan-v0/实施计划.md`；main 同步见 `docs/architecture/backend-v0/实施计划同步要点.md`。

## 日节奏（老板定 · 2026-10-30）

> **并行日切片（三轨 · 2026-10-30）**：四端演示 \| 能力契约 \| CI → [`并行日切片计划-20261030.md`](并行日切片计划-20261030.md) · [Notion](https://app.notion.com/p/40966c386fbf8198989ec102a22ae8b0)


**每日目标**：当天结束时，老板 Mac 上须有**可运行、可点开**的预览增量（本机 `127.0.0.1` 可访问的新能力或修复），而不是只合文档/只绿 CI。

**日切片原则**：
1. 业务 CT（CT-011～023）拆成「当日可演示」小片：每片有独立验收（打开某页/跑通某主路径），禁止单日吞整条大 PR。
2. 门禁/纯文档可并行，但**不得挤掉**当日预览增量。
3. 写执行单时在抬头标明「日切片：YYYY-MM-DD / 可演示点：…」。


## 编制·架构例行

- **日偏离**（2026-10-30 老板）：每个工作日对照计划写偏差与纠偏 → Notion「日偏离检查」。
- **仓名**：正式 **`luofanghao9784/mengine-app`**（非 fork；旧仓已归档）。

## 编制·前端开发（老板加岗 · 2026-10-30）

**岗责**：梦擎·前端开发（正式岗 id=`ec838a2d-d838-48cd-a789-e1af1424a7f3`；**勿派重复岗**）负责**全部四端**前端——员工端 `/workspace/`、企业管理端 `/tenant-admin/`、总台 `/platform-admin/`、第四端 `/agent-admin/`（对齐 ADR-B8）。

**硬性 6 条**（执行单与日切片一律遵守）：
1. **已有页可改功能**：现有页面允许改功能；**风格 / 动效 / 交互勿偏离该现页**；改动仍挂在已有路由/壳上，先打开预览现页再改；禁止另起无关空壳。
2. **无页仿 tenant-admin**：尚无对应现页时，**必须仿** 企管端 `tenant-admin` 的风格与交互（含动效），把交互做好；第四端有壳后跟 `agent-admin` 与 ADR-B8 路由表。
3. **日可见预览**：每个前端日切片结束须在 Mac `127.0.0.1` **可点开**看到增量（写清 URL）。
4. **Codex 自跑**：前端片由正式岗前端开发在老板 Mac 用 Codex 自跑落地（总负责人不代跑）；开跑前暂停令自查。
5. **机审 + 人审 / 非作者 1203**：合入前 Codex 机审第一道；人审第二道；审查号 `luofanghao1203` Approve（暂挂时该号 Comment；**同账号方案 A 已废**）。
6. **四端 UI 文案人话（老板硬性 2026-10-30）**：四端界面可见文案一律**易懂中文白话**；**禁止**在 UI 上裸用 `seed` / `capability` / `Capability` / `Grant` / `admission` 等术语。须用中文白话，或「中文（英文术语）」括号解释。规范由**产品 + UX**落 Notion（当前对照：[体验落部 · UX](https://app.notion.com/p/40966c386fbf8142b0bbcb16d1876e8f)、[Agent管理去黑话 · 可演示口径](https://app.notion.com/p/40966c386fbf81f3a2e3e1822ae6a9b9)；正式「文案/用词」页由产品+UX续落）。前端执行单须**引用上述规范**。规范页未齐前，执行单仍写本条硬性，并自检禁止裸术语。明日改界面日切片**全端对照**执行。

审查配人（前端可见改动）：**发布验收 + 质量性能**；触及 agent-admin 边界/五维登记时加 **架构逻辑**；登录/会话/cookie 加 **安全审查**。

### 今日焦点（2026-10-30）

| 序 | 编号 | 日切片目标（可点开） | 优先级 |
|---|---|---|---|
| 1 | **CT-006** | Mac 预览落地：本机按 CT-005/006 起得起、四端可点开 | **今日第一**（脚本侧多已合；验收点开） |
| 2 | **CT-008** | paths-ignore 已合 main；确认纯 docs PR skipped | 今日第二（门禁） |
| 3 | **前端·F1** | agent-admin「模型能力 / Agent 注册」Demo 占位→可演示实装（日切片见下） | **今日前端第一** |
| — | CT-024 及后端大片 | 不抢预览带宽；按日后排 | 排队 |

### 近几日建议切片（可调）

| 日序 | 焦点 | 可演示 URL（Mac 预览，端口以 `preview-health` / start 输出为准，下称 `{P}`） |
|---|---|---|
| **D0 今晚 / D+1** | **前端·F1** agent-admin 能力注册壳：现 Demo「空谷无界」占位 → 可点开 **模型能力 / Agent 登记** 列表空态+「登记第一个实现」按钮（对齐 ADR-B8 §验页；挂 **CT-020** 前端片 / 衔接 **CT-018**） | `http://127.0.0.1:{P}/agent-admin/` → `#view=functions`；`#view=capability-registry`（`&tab=catalog`） |
| D+1 | **前端·F2** / **CT-020-F2** 能力注册→主流程（catalog 种子/空态 + 登记面板骨架）；禁止假数据冒充 Live；执行单 `CT-020-F2-capability-registry-main-path.md` | `http://127.0.0.1:{P}/agent-admin/#view=functions` → `#view=capability-registry&tab=catalog`（点「登记第一个实现」开面板） |
| D+2 | **前端·F3** / **CT-020-F3** versions / grants 只读子视图（写按钮 disabled + 文案）；执行单 `CT-020-F3-versions-grants-readonly.md`；**#5/`fd99aba` 已合，执行单合入后可派实现** | `…&tab=versions`；`…&tab=grants` |
| D+2～3 | CT-012 起步 或 CT-013 契约五分片骨架（后端） | 契约/ArchUnit 绿（非页面则写命令验收） |
| D+3 | CT-014 迁移空表可查 | DB 只读确认 `qo_*` |
| D+4 | **前端·F4** + CT-015：端口健康后，registry 页对上真实只读 API（有则接、无则保持空态） | `http://127.0.0.1:{P}/agent-admin/#view=capability-registry&tab=catalog` 且网络面板见 `/api/agent-admin/v1/…`（401/空列表均可演示，禁止静默假数据） |
| … | 按 QUEUE 实施计划节下排 | **每片必须写清可演示 URL** |

> 首版 Mac 预览：**Demo 免登浏览可接受**（只读、标 Demo）；出现写入或对外网前补登录墙（CT-018 切片）。见架构逻辑 2026-10-30 建议。

业务/前端 CT 正式拆片时：从下表再拆成 CT-01x-a/b 或 **CT-020-Fx**，**仍一单一 PR**，并回写本 QUEUE「日切片」节。

## 可立刻写（纯 docs / 门禁）— 优先

| 建议编号 | 短标题 | 对应计划/出处 | 类型 | 依赖 | 建议审查人 | 优先级 |
|---|---|---|---|---|---|---|
| **CT-008** | 纯 docs PR paths-ignore 跳过 API/前端/契约重门禁 | 门禁工程债（#25 类）；非实施计划关键路径，但阻塞纯文档合入纪律 | 门禁 workflow | 无；合入宜选 main 门禁绿窗 | 质量性能 + 架构逻辑 | **P0** |
| **CT-028** | trial `MENGINE_API_URL`→动态 scene（vite `/mengine-api`） | 2026-10-30 漏斗验收债；bounce 免手改 | 预览脚本 | CT-006 落地后 | 质量性能 + 发布验收 | **P1** |
| **CT-029** | 废止同账号方案 A（流程 v1.3.5） | 审查号 `luofanghao1203`；纯 docs | 流程 | — | 质量性能 + 发布验收 | **P0**（门禁） |
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
| CT-003 | NativeAutomaticContinuity #208 测试契约（**迁 mengine-app**；10-31 12:00 前开 PR） |
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
| CT-006 | Mac 预览落地 | **今日第一**；分支/执行单见 CT-005/006 |
| CT-008 | 纯 docs path-filter / paths-ignore | 今日第二；workflow 由老板跑本单时推 |
| CT-024 | TaskContext 慢测/lease（#7 ④/⑥） | 待写执行单 |
| CT-025 | Mac 实测（交付） | 编号冻结，避免撞号；执行单待写 |
| CT-026 | 后端 wiki 基线红 backlog | 编号冻结，避免撞号；执行单待写 |
| CT-027-A | Demo/脏代码清理日切片（无冲突可删） | 执行单已写；须留正式预览包 |
| CT-027-B | Mac 正式预览合成包（`scripts/preview/**`） | **须保留**；与 A 对仗，勿删 |
| CT-029 | 废止同账号方案 A / 流程 v1.3.5 | 勿与 CT-028（mengine preview）撞号 |
| CT-030 | CI 省钱 paths 分流 + 缩 macos 矩阵 | 防下月额度烧光；执行单已写 |
| CT-020-F2 | agent-admin 能力注册→主流程（F1 壳上 catalog 种子/空态+登记面板） | 执行单已合；**实现 #5/`fd99aba` 已合 main** |
| CT-020-F3 | versions/grants 只读子视图 | **执行单本 PR**；#5 已合后可派实现 |
| CT-031 | CT-013 五分片 OpenAPI 骨架落盘（并行轨②） | **执行单本 PR** |
| CT-032 | CI spending 限额/告警（并行轨③） | **落地文档本 PR** → [`ci-spending-limits-20261030.md`](ci-spending-limits-20261030.md)；Billing 待老板点按；自托管→CT-033 |

