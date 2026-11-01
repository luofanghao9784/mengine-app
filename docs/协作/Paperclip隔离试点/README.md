# Paperclip AI 公司隔离试点（Issue #100）

本次授权：Paperclip 管理公司，Codex/OpenCode 承担研发执行，GitHub 保留独立质量门禁。用户已明确选择先完成本机试点与 Draft PR，再审核云资源报价。本单不是恢复历史业务调度的授权。

2026-11-01 追加实施已完成独立订阅登录、带本地补丁的两任务真实编码/独立 QA 接续、权限与暂停守卫、原生数据库恢复验证。当前仍暂停并解绑执行岗位凭据。完整结果与未通过项以[当前报告](MENGINE-PAPERCLIP-PILOT-ACCEPTANCE.md)为准，初次盘点留在[阶段一快照](MENGINE-PAPERCLIP-PILOT-ACCEPTANCE-PHASE1.md)。

## 运行边界

本机采用独立源码副本、独立安装目录、独立 Paperclip 数据目录与空合成工作目录。19 个逻辑岗位全部暂停：原 16 个研发组织模板，加客户成功、市场增长、商业运营。调度关闭、无任务导入、无模型凭据、无 GitHub 写入连接器、无外部业务连接器。Paperclip 的 `budgetMonthlyCents=0` 不作为硬预算保险；本阶段依赖不启动 Agent、不接入凭据与外部写工具。

上段是初始/收尾的默认安全状态；真实模型演练曾在用户订阅授权下临时关联独立登录目录并启用两个执行岗位，结束后恢复。现在已有 7 条本轮合成任务审计记录（2 Done、5 Cancelled），不要重跑首次初始化来清空或替代这些记录。

[计划配置](../../../config/paperclip-pilot/plan.json) 是本试点的输入格式，不冒充上游可直接导入的公司格式。[seed.py](../../../scripts/paperclip-pilot/seed.py) 将它转换为固定版本真实 REST API 请求，创建公司后先暂停，再创建岗位并逐一暂停。初始化中途出错保留状态供对账；重跑只补缺失岗位，发现异名公司、重复岗位或活动岗位则拒绝。

初始化属于用户已批准的岗位模板建设：只在这个暂停公司中短暂允许 Board 直接创建模板，并在 `finally` 中重新开启新岗位审批门禁。所有 Agent 都没有创建岗位或技能的权限。该过程不适用于已有业务公司。

保留 #98 的 OpenHands 历史与 #99 的原生 DQ 调度器。本单不修改它们，不建立第二个历史任务调度权威。正式主分支、历史 `.ai/TASKS.json`、旧队列、UNKNOWN、在途 Issue/PR 均不可由新公司模板覆盖。原 R01–R26、G01–G05、产品、UX、安全和两人审验收标准继续有效，缺失原件时标记未取得。

## 复现本机试点

需要 Node >=24.11、Python >=3.9；本轮使用的实际版本与安装结果见[验收报告](MENGINE-PAPERCLIP-PILOT-ACCEPTANCE.md)。固定 Paperclip `2026.1023.0`，上游提交 `1b4c803816e82b0265c8422e1a804327a7ed8c54`。不使用 `latest`，不自动升级。运行时依赖锁文件位置见报告。

以下从仓库根目录运行。`<runtime>`、`<state>`、`<synthetic-workspace>` 替换为本任务独立绝对路径；不要使用其他试点或业务实例目录。

```sh
python3 scripts/paperclip-pilot/seed.py --plan config/paperclip-pilot/plan.json
python3 scripts/paperclip-pilot/test_seed.py
mkdir -p <runtime>
cp config/paperclip-pilot/runtime/package*.json <runtime>/
npm ci --prefix <runtime> --legacy-peer-deps --no-audit --no-fund
python3 scripts/paperclip-pilot/run_local.py --runtime <runtime>/node_modules/.bin/paperclipai --state <state> --port 43100
```

本轮 npm 11 默认阻止依赖安装脚本，首次启动因此未能初始化内嵌数据库。已检查 `@embedded-postgres/darwin-arm64@18.1.0-beta.16` 的脚本与 17 条链接均限制在该包 native 目录，随后仅在此包目录手动执行 `node scripts/hydrate-symlinks.js`，`native/bin/initdb --version` 返回 PostgreSQL 18.1。其他被阻止的依赖安装脚本未批量放行；OpenCode 执行尚未验证。其他平台须重新核验对应包，不能照搬 Mac 路径。

启动器仅以前台方式运行，不注册系统服务。新状态目录创建私有标记，非空且无标记时拒绝使用；清理继承环境中的模型、GitHub 和云凭据，关闭遥测、浏览器自动打开和心跳调度。首次使用上游 `onboard --yes --bind loopback --no-install-service`；后续使用同一数据目录 `run --no-repair`。如端口被占用，启动失败而不停止其他服务。内嵌 PostgreSQL 默认端口也须在启动前确认空闲；本轮为 54329。

另开终端，先创建空合成目录，然后执行：

```sh
python3 scripts/paperclip-pilot/seed.py --plan config/paperclip-pilot/plan.json --apply --base-url http://127.0.0.1:43100 --workspace <synthetic-workspace>
```

API 会将所有环境变量值统一脱敏，连空值也不例外。因此只通过 API 不能证明密钥为空。[verify_local.mjs](../../../scripts/paperclip-pilot/verify_local.mjs) 使用只读数据库事务做补充验证，只输出计数与布尔值。数据库凭据通过私有环境变量 `PAPERCLIP_PILOT_DB_PASSWORD` 提供，不进入代码或报告：`node scripts/paperclip-pilot/verify_local.mjs <runtime> <synthetic-workspace父目录>/uncredentialed-codex-home`。该脚本仅支持本轮本机内嵌数据库端口 54329，不能用于生产。

演练后核验须带期望任务数和最少运行数：`node scripts/paperclip-pilot/verify_local.mjs <runtime> <empty-codex-home> 7 9`。不会因已有历史记录而初始化、删表或归零。

## 真实模型与本地补丁的复现边界

用户选择了 ChatGPT 订阅，并在官方浏览器完成独立登录。凭据在私有 `work/paperclip-codex-login-100`，不复制主 Codex 的 auth/config，不放入公司模板或配置包。`config/paperclip-pilot/codex-profiles/` 只保存无凭据模板；将 `@PILOT_WORKSPACE@` 替换为新合成目录的绝对路径。该模板针对本轮 macOS 开发工具路径，Linux 必须另验。

上游默认 ACP，本轮明确使用 `engine=cli` 才执行经过验证的 `--profile` 权限合同。不要再叠加旧的 `--sandbox`/`sandbox_mode` 覆盖命名权限，也不要开启 bypass。客户端工具网络仅允许本机 Paperclip API，订阅模型请求由 CLI 的认证层处理。

本轮原版遗漏首次 QA 的补投，必须先审查并显式应用 `config/paperclip-pilot/patches/runtime.patch`。在本任务服务已停止时运行：

```sh
python3 scripts/paperclip-pilot/patch_runtime.py --runtime <runtime>
python3 scripts/paperclip-pilot/patch_runtime.py --runtime <runtime> --apply
python3 scripts/paperclip-pilot/run_local.py --runtime <runtime>/node_modules/.bin/paperclipai --state <state> --event-dispatch --allow-recovery-patch
```

`--event-dispatch` 启用原生事件/恢复扫描，岗位定时唤醒仍关闭；只在明确的两任务演练范围使用。`run_trial.py` 是有界的准备、观察与收尾工具，不另实现任务调度：初次 kickoff 之后的 QA 与后继任务由 Paperclip 原生机制推进。它拒绝未知既有任务；继续同一合成试点要先核对执行端终态，再使用 `--resume-from`；新一轮要先保留并取消本轮失败任务，再以 `--preserved-receipt` 精确核对旧 ID。不能用它导入历史业务任务。

```sh
python3 scripts/paperclip-pilot/run_trial.py --codex <runtime>/node_modules/.bin/codex --login-home <private-login-home> --workspace <synthetic-workspace> --receipt <private-receipt.json>
```

只允许 2 个角色、2 条合成任务，新运行停止观察阈值 8、单次 180 秒配置、总观察 12 分钟；结束时暂停公司和两角色、解绑凭据，保留任务、费用与失败记录。运行观察存在轮询窗口，不是服务端硬准入上限；运行阈值/超时停止路径仍需专项故障注入，不将配置存在视为验收。示例代码与 18 项测试位于 `scripts/paperclip-pilot/sample-budget/`。

当前启动已去掉 `--event-dispatch`，保留 `--allow-recovery-patch`。回退补丁须停服务后运行 `patch_runtime.py --runtime <runtime> --revert`，再不带补丁许可启动；原始/补丁 SHA 都不匹配时拒绝覆盖。本轮已实际回退并重新应用，原生调度开启时的暂停守卫也有 25 秒真实观察。

`recovery_check.mjs <runtime> <new-private-backup-dir> pg_dump` 只用于该独立本机数据库，需通过私有环境传入数据库凭据及明确的 `PAPERCLIP_PG_DUMP_PATH`/`PAPERCLIP_PSQL_PATH`。它创建新恢复库，拒绝原库覆盖；保留失败恢复库以供核对，不自动删除。JavaScript 引擎的亚毫秒精度问题仍未修补，自动备份回退策略尚未验收。

启动器的本机 `local_trusted` 模式无登录，必须仅监听回环地址。它不适用于直接暴露云端；云端候选须改用 authenticated/private、私网访问、受限系统账号及独立执行隔离，并验收未认证访问被拒绝。代码仓库目录隔离不等于系统权限隔离。

## 公司职责与分期

| 领域 | 本阶段配置 | 后续实际启用的条件 |
|---|---|---|
| 产品与研发 | 16 岗位层级与暂停配置；带补丁的两条真实任务完成 | 24 Skill 逐项核对迁移、多可写 worktree 与云端实测 |
| 独立质量 | QA、可靠性、安全三岗；两轮独立模型 QA 已留痕 | GitHub 真实 CI 与非作者人审、产品/UX验收仍需完成 |
| 平台运维 | SRE 角色及内部检查职责 | 监控、故障、备份恢复、停止回执、日志脱敏与重启实测 |
| 客户成功 | 工单分类、FAQ、培训草稿职责 | 明确客户数据权限、知识来源、渠道授权；先只读，不发送回复 |
| 市场增长 | 内容草稿、SEO、获客分析职责 | 明确事实审核、发布渠道与已批准内容计划；不投放广告 |
| 商业运营 | 订阅、收入、留存分析职责 | 真实授权数据、指标口径与财务核对；支付、退款、合同、资金操作关闭 |

PostHog、Better Stack、Chatwoot、Stripe、n8n 均未接入，也未开通订阅。本阶段只定义接入边界；不得把岗位创建当成运营能力已交付。首次接入时须逐项审查真实读写权限，默认写入关闭或人工确认，不能只依赖提示词。

## 云端预算候选

用户将基础设施上限更新为每月 **$50，不含模型**。当前建议税前 $33.80 加 $16.20 预留，单主机、单开发槽、公开仓库免费标准 CI；完整规格、适用范围、来源和采购确认条件见 [云端报价](CLOUD-QUOTE-50USD.md)。未采购，旧 $200 方案只保留在阶段一历史快照。

## 正式切换与回退

正式切换前，必须取得历史任务原件、revision 与摘要；逐条核对旧执行端/暂停令/UNKNOWN。UNKNOWN 无确认不能重试，失联不能认定停止；旧平台已停且唯一认领机制实测后才允许接管。新试点任务不能借用旧任务 ID。

验收至少包含两条真实任务连续接续、重复事件防重、并发认领、停止确认、失联处理、重启恢复、预算阻断、独立审查、CI 失败阻止合并。必须保存任务/运行 ID、SHA、测试结果、审查结论、实际副作用与恢复证据。这里列出的目标尚未因配置存在而通过。

GitHub 已启用六项必需检查、管理员约束、过期审批撤销、最近推送独立审批及讨论解决。本 PR 新增独立 Paperclip CI 入口，完整复制原六项作业并自动核对一致性，不更改三个原工作流的路径过滤。GitHub Actions 与当前 PR 检查页为真实结果依据；pending/skipped 不等于成功，不得绕过保护。#68/#76 等修复候选留给原认领处理。本单不合并 Draft，非作者 `luofanghao1203` 的真实人审不能用本账号评论或机器检查替代。

本机回退：在启动终端 Ctrl-C 停止本任务进程；确认监听端口与内嵌数据库进程确已退出后，保留独立状态及日志供复核。无需恢复历史系统，因为没有接管或改写。不要删除其他 worktree、数据库或运行实例；本单配置不再需要时通过新的审查提交撤回。

## 用量审计与本机补账

`usage_audit.py --login-home <private-login-home> --output <audit.json>` 默认只读；只支持本暂停公司，按运行的准确 thread ID 和时间边界读取 provider usage 记录，不读取 auth.json 或导出对话。逐 response 去重，并核对关闭的 turn 边界和累计总量；缓存输入与推理输出不重复相加。

`node scripts/paperclip-pilot/reconcile_usage.mjs --runtime <runtime> --state <state> --audit <audit.json> --login-home <private-login-home> --output <repair.json>` 默认 dry-run。通过私有环境传入 `PAPERCLIP_PILOT_DB_PASSWORD`；显式 `--apply` 才补账。先做原生备份；未结账运行使用上游原生收据与结账服务，已结账少记项只追加差额，保留原单和任务状态。重跑已实际验证无新增记录。

当前 4 条取消运行已补齐，2 条早期 ACP 少记项追加差额，pending=0。**原版取消时实时用量采集仍有缺口；后续每轮试跑必须在暂停后再次审计补账，不能以本次追溯对平宣称该上游缺陷已修复。** 订阅包含用量不等于订阅发票或现金成本为零，订阅分摊与发票仍记未知；直接 CLI 连通性探测不在 Paperclip 的 9 条运行统计内。
