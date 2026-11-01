# Paperclip AI 公司隔离试点（Issue #100）

本次授权：Paperclip 管理公司，Codex/OpenCode 承担研发执行，GitHub 保留独立质量门禁。用户已明确选择先完成本机试点与 Draft PR，再审核云资源报价。本单不是恢复历史业务调度的授权。

## 运行边界

本机采用独立源码副本、独立安装目录、独立 Paperclip 数据目录与空合成工作目录。19 个逻辑岗位全部暂停：原 16 个研发组织模板，加客户成功、市场增长、商业运营。调度关闭、无任务导入、无模型凭据、无 GitHub 写入连接器、无外部业务连接器。Paperclip 的 `budgetMonthlyCents=0` 不作为硬预算保险；本阶段依赖不启动 Agent、不接入凭据与外部写工具。

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

启动器的本机 `local_trusted` 模式无登录，必须仅监听回环地址。它不适用于直接暴露云端；云端候选须改用 authenticated/private、私网访问、受限系统账号及独立执行隔离，并验收未认证访问被拒绝。代码仓库目录隔离不等于系统权限隔离。

## 公司职责与分期

| 领域 | 本阶段配置 | 后续实际启用的条件 |
|---|---|---|
| 产品与研发 | 16 岗位的层级与暂停配置，Codex 适配器限制参数 | 两条新的低风险真实任务，隔离工作区、证据与自动接续；24 Skill 逐项核对迁移 |
| 独立质量 | QA、可靠性、安全三岗 | 模型审查与人审分别留痕，真实 CI 通过，保留产品/UX验收 |
| 平台运维 | SRE 角色及内部检查职责 | 监控、故障、备份恢复、停止回执、日志脱敏与重启实测 |
| 客户成功 | 工单分类、FAQ、培训草稿职责 | 明确客户数据权限、知识来源、渠道授权；先只读，不发送回复 |
| 市场增长 | 内容草稿、SEO、获客分析职责 | 明确事实审核、发布渠道与已批准内容计划；不投放广告 |
| 商业运营 | 订阅、收入、留存分析职责 | 真实授权数据、指标口径与财务核对；支付、退款、合同、资金操作关闭 |

PostHog、Better Stack、Chatwoot、Stripe、n8n 均未接入，也未开通订阅。本阶段只定义接入边界；不得把岗位创建当成运营能力已交付。首次接入时须逐项审查真实读写权限，默认写入关闭或人工确认，不能只依赖提示词。

## 云端预算候选

以下是 2026-11-01 公开报价与预算预留，不是已批准采购，也不是含税锁价。

| 项目 | 美元/月 | 依据 |
|---|---:|---|
| 控制节点 4 GiB / 2 vCPU | 24 | DigitalOcean Basic Regular 公开价 |
| 开发执行节点 16 GiB / 8 vCPU | 96 | 同上；2 个开发槽为上限目标，负载尚未实测 |
| 两节点每周基础备份 | 24 | 两节点月费 120 的 20% |
| 额外存储/日志/监控预留 | 10 | 预算占位，待选择地域及实际用量 |
| GitHub CI / macOS 测试预留 | 20 | 预算占位，未核实账户剩余额度及硬限制 |
| 税费/汇率/用量缓冲 | 26 | 预算占位，超出即阻止采购 |
| 合计 | 200 | 模型费独立且未授权；不包含梦擎正式生产系统扩容 |

价格来源：[Droplets](https://www.digitalocean.com/pricing/droplets)、[备份价格](https://docs.digitalocean.com/products/backups/details/pricing/)。开通前须取得地域、税、流量、备份、CI 的实际账户报价，总额不超过 $200；厂商账单告警不等于硬停止。不得自动购买、扩容或以关闭备份补差额。模型预算必须另行设置，不能从基础设施 $200 推导模型授权。

## 正式切换与回退

正式切换前，必须取得历史任务原件、revision 与摘要；逐条核对旧执行端/暂停令/UNKNOWN。UNKNOWN 无确认不能重试，失联不能认定停止；旧平台已停且唯一认领机制实测后才允许接管。新试点任务不能借用旧任务 ID。

验收至少包含两条真实任务连续接续、重复事件防重、并发认领、停止确认、失联处理、重启恢复、预算阻断、独立审查、CI 失败阻止合并。必须保存任务/运行 ID、SHA、测试结果、审查结论、实际副作用与恢复证据。这里列出的目标尚未因配置存在而通过。

GitHub 已启用六项必需检查、管理员约束、过期审批撤销、最近推送独立审批及讨论解决。本 PR 不更改 CI；main 上既有路径过滤可能使纯试点变更的部分检查不触发，pending/skipped 不等于成功，不得绕过保护。#68/#76 等修复候选留给原认领处理。本单不合并 Draft，非作者 `luofanghao1203` 的真实人审不能用本账号评论或机器检查替代。

本机回退：在启动终端 Ctrl-C 停止本任务进程；确认监听端口与内嵌数据库进程确已退出后，保留独立状态及日志供复核。无需恢复历史系统，因为没有接管或改写。不要删除其他 worktree、数据库或运行实例；本单配置不再需要时通过新的审查提交撤回。
