# 待拆 CT 队列（对照实施计划 · 架构逻辑 2026-10-30）

基线：origin/main `f82a579`（随 main 滚动）。已有 CT-000～005、007、008（执行单）；CT-006 为 Mac 预览落地。一单一 PR。实施计划：`/workspace/agent-tools/dreamcore-backend-impl-plan-v0/实施计划.md`；main 同步见 `docs/architecture/backend-v0/实施计划同步要点.md`。

## 日节奏（老板定 · 2026-10-30）

> **两周完整主路径（三轨 · 2026-10-31～11-13）；D1 号钉：CT-003 + **CT-038**（人话）+ CT-034；**CT-020-F4 保留只读 API****：老板接受两周倒排；必须保写通/登录隔离/企业侧已开通/现网冒烟 → [`两周日切片-三轨并行-20261031.md`](两周日切片-三轨并行-20261031.md) · [Notion](https://app.notion.com/p/40966c386fbf81359ac9db4536479da8)
>
> **并行日切片（旧三轨 · 2026-10-30，契约/CI 仍可对照）**：四端演示 \| 能力契约 \| CI → [`并行日切片计划-20261030.md`](并行日切片计划-20261030.md) · [Notion](https://app.notion.com/p/40966c386fbf8198989ec102a22ae8b0)
>
> **两周指针（补）**：**CT-034-P1 已合** main `022768b`（#22），**CT-035 已合** `bd06caf`（#21）。**CT-034-A 实现已合** main `75ab17a` / #30（执行单 #28；平台全局 `qo_capability` 落库并 201，表无 `tenant_id`，迁移 V191）。**CT-039 实现已合** main `701c3ca` / #31（`GET /api/tenant-admin/v1/opened-capabilities`；生产 Empty adapter 空列表）。**#35 接真已合** `7fa4946`（企业侧消费该读口；生产 adapter 仍空）。开通真源仍靠 **CT-040** 写口，合入后由读口接；测试可对照授权表。**开通写** = **CT-040** → [`CT-040-agent-admin-grant-tenant-opened.md`](CT-040-agent-admin-grant-tenant-opened.md)（把已登记的企业功能授权给某租户；不是再登记目录；企业读仍归 CT-039；授权表迁移 **V193+**，不占 V191/V192）。D4～D5 登录隔离执行单仍是 [`CT-035-agent-admin-login-tenant-isolation.md`](CT-035-agent-admin-login-tenant-isolation.md)。后端四裁仍有效：写口 `/api/agent-admin`；`DREAMCORE_AGENT` 独立链；未登录写 401 人话；不得恢复 permitAll。OpenAPI `enterpriseFunction` 闭集、`additionalProperties:false`，未知字段 400。**CT-037 已合** `1d847e6` / #32 → [`CT-037-prod-mount-desktop-mobile-smoke.md`](CT-037-prod-mount-desktop-mobile-smoke.md)（D9～D14）。


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
6. **四端 UI 文案人话（老板硬性 2026-10-30）**：四端界面可见文案一律**易懂中文白话**；**禁止**在 UI 上裸用 `seed` / `capability` / `Capability` / `Grant` / `admission` 等术语。须用中文白话，或「中文（英文术语）」括号解释。规范由**产品 + UX**落 Notion。**主规范**：[《全端文案规范》](https://www.notion.so/40966c386fbf8120aaefc0290f9dedb8)；对照补充：[体验落部 · UX](https://app.notion.com/p/40966c386fbf8142b0bbcb16d1876e8f)、[Agent管理去黑话 · 可演示口径](https://app.notion.com/p/40966c386fbf81f3a2e3e1822ae6a9b9)。前端执行单须**同时引用主规范 + 对照页**。agent-admin 人话替换：**明日可开写执行单**（口径=总负责人定稿「**AI 功能**」，非本事/花名册；引《全端文案规范》+ 去黑话对照）；**今晚不开跑实现**；与 CT-003 迁仓并行。

### 后端写接口硬性

与上方前端硬性 1–6 分列，编号从 1 起，不并入、不改写那六条。

1. **CT-034 类 stub：`CapabilityRegistryStubSecurity`（或等价）permitAll+csrf disable 仅允许无副作用 stub；任何落库/A 档前必须删除并换正式鉴权+CSRF，否则架构/安全 P0 打回。** **CT-034-P1 已合** main `022768b`（#22）：开放链已删；未登录写 **401 人话**；有会话无 CSRF **403**；已登录未落库时曾是 501。口径仍见 [`CT-034-register-save-write-api-thin.md`](CT-034-register-save-write-api-thin.md)「架构已裁」第 5 条与 [`CT-034-P1-stub-security-replace-auth-csrf.md`](CT-034-P1-stub-security-replace-auth-csrf.md)。**A 档实现已合** main `75ab17a` / #30 → [`CT-034-A-register-persist-201.md`](CT-034-A-register-persist-201.md)。落库后禁止恢复 `permitAll`。开通给企业的写口另见 [`CT-040-agent-admin-grant-tenant-opened.md`](CT-040-agent-admin-grant-tenant-opened.md)，不是把目录表改成带租户。

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
| CT-035 | 第四端正式登录 + 租户隔离（D4～D5 · L1–L4） | **已合** main `bd06caf` / #21 → [`CT-035-agent-admin-login-tenant-isolation.md`](CT-035-agent-admin-login-tenant-isolation.md) |
| CT-034-P1 | 替换登记 Stub 开放链（鉴权+CSRF） | **已合** main `022768b` / #22 → [`CT-034-P1-stub-security-replace-auth-csrf.md`](CT-034-P1-stub-security-replace-auth-csrf.md)；不再挡住 A 档 |
| CT-034-A | 登记目录落库并 201（平台全局；验收句 W1 起步） | **实现已合** main `75ab17a` / #30（执行单 `fdc22fe` / #28）→ [`CT-034-A-register-persist-201.md`](CT-034-A-register-persist-201.md)。表 `qo_capability` 无 `tenant_id`，迁移 **V191**。企业读归 CT-039；开通写归 CT-040 |
| CT-036 | 企业侧/工作台消费已开通（两周 D6～D8 · 验收句 E1–E4） | **骨架已出** → [`CT-036-enterprise-consume-opened-capability.md`](CT-036-enterprise-consume-opened-capability.md)；诚实空态壳 `#25`/`7e21bc0` 已合。读口已由 CT-039 `#31` 合入。**#35 接真已合** `7fa4946`（前端消费读口；生产 adapter 仍空；材料提交未接通）。开通写归 **CT-040**。真名单未合 |
| CT-039 | 企业侧「本租户已开通」只读（钉死 CT-036【待补-读口】） | **实现已合** main `701c3ca` / #31（执行单 #29 → [`CT-039-tenant-opened-capabilities-readonly.md`](CT-039-tenant-opened-capabilities-readonly.md)）。`GET /api/tenant-admin/v1/opened-capabilities`；生产 Empty adapter 恒空列表。**#35 接真已合** `7fa4946`。开通真源仍靠 **CT-040** 写口，合入后由读口接。测试可对照授权表。禁第四端 grants。投影若仍自建则 **V192+**（勿占 V191，也勿与 CT-040 的 V193+ 抢号） |
| CT-037 | 现网挂载 + 桌面/手机冒烟（两周 M4 · D9～D14 · 轨 C） | **已合** `1d847e6` / #32 → [`CT-037-prod-mount-desktop-mobile-smoke.md`](CT-037-prod-mount-desktop-mobile-smoke.md)。对照 `701c3ca`；其后 **#35 接真已合** `7fa4946`。CT-034-A / CT-035 / CT-034-P1 / CT-039 实现已合（M3-b 接口空列表可勾）。CT-040 未合、页面保存按钮未合则清单【待合】 |
| CT-040 | 第四端「开通给企业」写口（授权表带 tenant_id） | **执行单本 PR** → [`CT-040-agent-admin-grant-tenant-opened.md`](CT-040-agent-admin-grant-tenant-opened.md)。`POST /api/agent-admin/v1/tenants/{tenantId}/grants`；不是登记目录，不是企业读口。GET list/grants 仍可未实现。迁移 **V193+**（避 V191、V192）。重复开通钉死 **200 幂等且不覆盖** |

