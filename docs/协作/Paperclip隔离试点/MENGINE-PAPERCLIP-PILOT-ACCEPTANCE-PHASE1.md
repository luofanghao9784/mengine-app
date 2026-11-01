> 阶段一历史快照；后续结果见 [当前验证报告](MENGINE-PAPERCLIP-PILOT-ACCEPTANCE.md)。以下未接模型等表述仅描述首次盘点时刻。

# MENGINE Paperclip 本机试点验证报告

日期：2026-11-01（北京时间）。认领：[Issue #100](https://github.com/luofanghao9784/mengine-app/issues/100)。结论：**本机基础安装、暂停组织配置、重复初始化和正常停止后的恢复已验证；正式研发接管与云端无人值守验收未通过。**

用户选择先完成本机试点与 Draft PR，再审核云资源报价。本轮没有采购、云资源创建、生产写入、主分支推送或合并。

## 真实盘点

仓库为 `luofanghao9784/mengine-app`，独立克隆起点与收尾远端 main 均为 `d945af9235b07ecfbfc4990bd6c4ebae4324b769`。未复用或修改现有有未提交变更的工作目录。原有本地 Git 代理端口不可达，本次仅对独立克隆的网络命令临时关闭该代理，未改全局配置。

保留 [#98 OpenHands 云端试点](https://github.com/luofanghao9784/mengine-app/issues/98)；发现并避开 [#99 原生 DQ 隔离调度器](https://github.com/luofanghao9784/mengine-app/issues/99)。既有 PR 的失败/取消结果不能视为成功；没有尝试合并或修复其他认领。只读快照见 [开放 Issue](evidence/open-issues.json)、[开放 PR 与检查](evidence/open-prs.json)。这些是取样时刻的证据，后续状态以 GitHub 实时记录为准。

历史 `.ai/TASKS.json` revision 13 权威原件未取得，历史 UNKNOWN 的执行端停止回执未取得。仓库旧 `docs/codex-tasks/QUEUE.md` 及旧组织包不是替代权威；旧组织包的 revision 0 空模板未导入。本轮公司任务数为 0，原任务与暂停状态没有迁移。R01–R26/G01–G05 的完整原始验收证据尚未对账，不宣称满足。

[实时主分支保护快照](evidence/main-protection.json)确认六项必需检查、严格基线、管理员约束、一名独立审批者、过期审批撤销、最近推送独立审批和讨论解决要求均开启。本 PR 不调整保护或现有工作流。`luofanghao1203` 的非作者人审仍未发生；机审、配置与本机检查都不能代替它。

## 本机安装及实际结果

Paperclip 固定 `2026.1023.0`，上游 tag 提交 `1b4c803816e82b0265c8422e1a804327a7ed8c54`。环境为 macOS arm64、Node v24.22.1、npm 11.19.1、Python 3.9.6、内嵌 PostgreSQL 18.1。运行时直接依赖与完整锁文件位于 `config/paperclip-pilot/runtime/`，未加入梦擎业务依赖。

| 验证项 | 结果 | 真实证据及限制 |
|---|---|---|
| 固定版本安装 | PASS | 最终独立目录安装退出 0；完整锁文件在另一空目录执行 `npm ci --dry-run --legacy-peer-deps --ignore-scripts` 退出 0；未将 dry-run 当成第二次实际安装 |
| 服务与页面 | PASS | `/api/health` 返回 `ok`，主页 HTTP 200；实际浏览器显示暂停警告、19 paused、0 running、0 tasks、0 spend |
| 访问范围 | PASS（本机） | 实际监听 `127.0.0.1:43100`；local_trusted/private。未验收云端认证或公网访问安全 |
| 公司与岗位 | PASS（配置） | 1 个暂停公司、19 个暂停岗位；原 16 岗加客户成功/增长/商业运营；岗位创建与技能创建权限关闭，新岗位审批重新开启 |
| 执行器限制 | PASS（落库） | 显式关闭 bypass；只读执行参数、关闭网络参数及心跳/任务唤醒配置均经 API 读回。尚未启动 Codex/OpenCode 进程验证执行限制 |
| 凭据隔离 | PASS（本机静态） | 只读数据库事务确认 19 个岗位的模型密钥为空，均指向外部空 Codex home，auth.json 不存在；仅输出计数和布尔值 |
| 重复初始化 | PASS | 重跑返回完全相同公司与岗位 ID，仍为 19 岗、0 任务；补齐后重跑无创建或更新请求 |
| 正常停止与恢复 | PASS（有界范围） | 向本试点服务发送 SIGINT，执行端退出 0，API 与数据库监听均退出；以全新安装目录加载同一数据目录后，公司/岗位 ID 与暂停配置保持一致 |
| 安全拒绝检查 | PASS | 6 个本地检查覆盖远端/歧义地址、非空工作目录、异名或活动公司、重复岗位、调度/导入/唤醒、超预算和超并发配置拒绝；见[检查输出](evidence/safety-tests.txt) |
| 两条真实研发任务自动接续 | NOT TESTED | 未调用模型、未建立开发任务、未给 Agent GitHub 写入凭据；不能以模板创建代替编码闭环 |
| 重复事件/并发认领/停止竞态/失联 | NOT TESTED | 重复初始化不等于事件防重或执行租约验证；没有旧执行端回执 |
| 崩溃恢复、隔离备份恢复、RTO/RPO | NOT TESTED | 仅正常重启恢复已验证；上游自动备份配置存在不等于备份恢复验收 |
| 24 Skill、OpenCode、独立 QA/机审/人审 | NOT TESTED | 没有自动导入旧技能、运行真实编码或伪造独立审查 |
| 客服/分析/监控/增长/商业集成 | CONFIG ONLY | 有职责与权限边界；没有接入真实渠道、客户数据、支付或对外发布 |
| $200 云端硬预算及 7×24 | NOT TESTED | 已提供公开报价候选；未开通账户资源、未核对含税订单或实际 CI 用量，未部署云端 |

原始 API 统一脱敏环境变量，初版验证将脱敏值误当成空值，导致断言失败；已修正为 API 结构检查加本机数据库只读核验，没有关闭脱敏。[初始化读回](evidence/seed-after-restart.json)、[数据库布尔证据](evidence/local-db-verification.json)、[运行摘要及锁文件摘要](evidence/local-runtime.json)。`modelCalls=NOT_INVOKED` 另外由 `heartbeatRuns=0` 的数据库计数支持。

## 安装中遇到的实际失败

依赖下载曾停滞。中断后过早复用同一安装目录，旧安装进程的延迟清理移除了新依赖，已停止本试点服务、等待旧安装完全结束，改用全新 `paperclip-runtime-verified` 目录完成安装，保留同一公司数据。该问题已修复；没有把此前短暂的健康状态当作最终安装成功。

npm 11 阻止未批准的依赖安装脚本，初次内嵌数据库初始化失败。审阅后只执行了对应 PostgreSQL 包的链接恢复脚本，17 条链接均在该包 native 目录，随后 initdb 与真实服务启动成功。其他安装脚本未批量放行。

从中断安装得到的首份锁文件曾被 `npm ci` 拒绝，原因是缺失部分平台可选依赖；全新目录重新解析得到最终锁文件后，空目录 dry-run 已通过。报告及 PR 只交付最终锁文件，不交付失败锁文件。

## 当前入口、成本与回退

当前本机入口：[Paperclip Dashboard](http://127.0.0.1:43100/MEN/dashboard)。公司 ID：`5923bae1-b181-40f6-b060-e772fef05b8e`。它是前台本机进程，没有注册登录启动服务；Mac 关闭后不会继续运行。公司预算 UI 显示 Unlimited，**不是 $200 硬保险**；$200 是独立云基础设施预算，模型预算另行授权。本阶段靠全部暂停、无模型凭据与无写入连接器阻止运行，不能将此状态直接作为带凭据的无人值守配置启用。

最终安装目录为当前聊天工作目录下 `work/paperclip-runtime-verified`；数据为 `work/paperclip-state-100`；合成目录为 `work/paperclip-synthetic-100`。这些实际状态和私密文件不提交仓库。恢复启动、只读核验与云端 $200 候选明细见[操作说明](README.md)。模型、客服、监控等业务订阅均未采购。

回退仅需停止该试点进程并确认两端口退出，保留独立数据和日志；原任务系统没有被接管，无需迁回。配置撤回走新的审查提交，不删除其他 worktree 或原系统数据。

下一阶段必须先审核具体地域与含税报价，并补齐历史权威/UNKNOWN 回执，再在受限制执行环境中完成真实研发和故障验收。当前裁决：**允许审查本机试点 Draft；禁止据此恢复正式业务、合并主线、采购或部署生产。**
