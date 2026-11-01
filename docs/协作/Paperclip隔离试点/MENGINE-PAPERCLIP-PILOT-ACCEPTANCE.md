# MENGINE Paperclip 本机真实模型试点报告

更新：2026-11-01，北京时间。关联 [Issue #100](https://github.com/luofanghao9784/mengine-app/issues/100)、[Draft PR #101](https://github.com/luofanghao9784/mengine-app/pull/101)。

**结论：已接通用户授权的独立 ChatGPT 订阅登录；带明确本地补丁的 Paperclip 完成两条真实编码任务及两轮独立 QA，第二条由依赖解除自动接续。当前已暂停公司和全部 19 岗并解绑执行岗位凭据。云端无人值守、正式研发接管与经营系统接入尚未验收。**

本轮交付不是原版 Paperclip 无修改通过验收。原版的 ACP 执行失败、首次 QA 唤醒遗漏、成本核算阻断和 JavaScript 恢复精度差异均保留；未将失败任务改为成功。初始未接模型的盘点见[阶段一快照](MENGINE-PAPERCLIP-PILOT-ACCEPTANCE-PHASE1.md)。

## 执行范围与版本

- 仓库：`luofanghao9784/mengine-app`；开发基线 `d945af9235b07ecfbfc4990bd6c4ebae4324b769`。只推任务分支与 Draft PR，不合并、不修改生产、不采购。
- Paperclip：`2026.1023.0`，上游 `1b4c803816e82b0265c8422e1a804327a7ed8c54`；本机额外补丁及前后摘要在 `config/paperclip-pilot/patches/`。完整依赖锁保留。
- 实际执行 CLI：npm 安装的 `codex-cli 0.156.1`，显式 `engine=cli`；未使用本机全局登录。会话元数据观察到 `gpt-6-astra`；选择模型的最终权限与订阅额度仍由账户决定。
- 用户在官方浏览器完成独立订阅登录；auth.json 留在私有试点目录，不进仓库、报告、配置包或数据库恢复实例。
- 只有一个合成 Git 工作目录可写，QA 使用只读权限；两个任务顺序复用该目录。本轮没有验证多个可写 worktree 并行，也没有给模型 GitHub、云或生产凭据。

## 两条真实任务

| 任务 | 实际交付 | 审查与接续 |
|---|---|---|
| MEN-5 / `a3e38c21-f55d-445f-a4cc-cf4bdd0f9a7a` | 整数分为单位的基础设施预算计算器及边界测试 | 独立 QA Agent 执行检查并批准；executionState=completed / lastDecisionOutcome=approved |
| MEN-6 / `ebffcf64-e205-4d8c-9384-9b76114db41e` | 增加税费向上取整和费用预留，保留原调用行为 | 第一条批准后由原生依赖机制自动唤醒；第二轮独立 QA 批准，同样留下完成决策 |

只有 MEN-5 初次启动为人工 kickoff。随后 QA、第二条编码、第二轮 QA 的 invocationSource 均为 `automation`。本轮四个执行记录及时间见 [native-trial-runs.json](evidence/native-trial-runs.json)，完整状态观察、8 次新运行观察阈值、每次 180 秒配置及清理回执见 [native-two-task-trial.json](evidence/native-two-task-trial.json)。此前设置试点失败产生的 MEN-1～MEN-4 保留为 Cancelled，暂停守卫 MEN-7 也保留为 Cancelled。

两个编码执行因移交任务而记录为 `cancelled / issue_reassigned`，两个 QA 执行记录为 `succeeded`；**不能表述为四个进程全部正常退出**。代码、测试、QA 决策及后继任务均有独立证据。编码执行的 token/cost 回执不完整，不能把其中 0 token 或页面 $0.00 当作没有消耗额度或完整财务核算。

最终代码在 `scripts/paperclip-pilot/sample-budget/`。主执行者另外实际运行了全部 **18 项单元测试**，涵盖非法输入、布尔值拒绝、大整数精度、空输入、临界预算、税费取整及预留导致超限。该工具仅计算候选成本，不创建、购买或停止云资源。

## 实际权限与暂停验证

原生 Codex 命名权限配置采用根目录拒绝、最小系统读取、合成工作区授权，以及只允许本机 Paperclip API 的工具网络代理。编码岗可写，QA 岗只读。必须使用 CLI engine；不与旧的 `--sandbox` 配置混用。权限模板位于 `config/paperclip-pilot/codex-profiles/`。

六项真实系统检查通过：编码岗写试点目录成功，目录外合成标记读取失败，目录外写入失败已在初始检查观察；最终检查另确认登录目录合成标记读取失败、QA 写入失败、本机 API 成功、外部网络请求被拒绝。最终六项结果见 [permissions-actual.json](evidence/permissions-actual.json)。这些是本机实测，不代替 Linux 云主机或多租户隔离验收。

公司暂停后，在原生调度开启、间隔 10 秒时建立一条不可执行的合成任务，观察 25 秒：任务状态和更新时间均未改变，没有新运行。随后关闭该合成任务，保留审计记录。[暂停守卫证据](evidence/paused-company-guard.json)。这只是有界观察，不代表长期无人值守已验收。

结束时只读数据库核验：19 岗全部暂停，19 岗模型 API key 均为空且指向不带 auth.json 的空目录；7 条本轮任务、9 个 Paperclip 运行记录、0 个运行中/排队执行。独立订阅的凭据文件仍由用户保留在私有登录目录，但执行岗位已经解除关联。[最终状态](evidence/final-paused-db.json)。另有一次直接 CLI 连通性探测，不在这 9 个 Paperclip 运行之内。

## 原版失败及本地修正

1. **默认 ACP 与 CLI 权限不一致。** 原版适配器默认 ACP；其运行回执显示 persistent/approve-all，终端调用退出 134，未生成代码。已停止原试跑，核对终态与无代码副作用，只对明确的本轮恢复记录提交了执行端停止/未执行证据，随后显式固定 CLI。没有通过重置历史 UNKNOWN 或放宽权限解决。
2. **首次 QA 唤醒遗漏。** 编码 Agent 提交进入审查时，QA 首次唤醒因前一执行环境仍在清理而被跳过；原恢复逻辑在 QA 尚无任何运行时直接跳过，任务滞留 in_review。最小补丁补投当前仍待处理的首次审查，保留已有队列、权限、成本和运行准入检查；另外让暂停公司的任务不进入恢复扫描。原版失败后用新编号 MEN-5/MEN-6 验证，未靠主执行者手工唤醒 QA 或标记批准过关。
3. **成本门禁阻断。** 早期设置了 $2.50 的试点账面阈值，观察到预算/核算门禁阻断；原始错误还包括“completed runs await accounting”，不能只归因于实际花费超额，更不能视为订阅外账单。最终阶段不设虚构的订阅美元阈值，改用 8 次新运行停止观察阈值、每次 180 秒配置及 12 分钟观察窗口的有界试点；只发生 4 次该轮运行。观察守卫存在轮询窗口，不能视作服务端硬准入上限。实际超时/运行阈值触发、完整成本归集和账户额度耗尽恢复仍未验收。
4. **JavaScript 数据库恢复精度差异。** 原版 JavaScript 备份恢复后内容摘要不一致；四张代表性非空表中观察到 107 处时间字段差异，均在毫秒精度相同、亚毫秒不同。详见[诊断](evidence/javascript-recovery-precision-failure.json)。本轮没有修补该备份引擎，也没有用行数相同代替内容一致。

补丁为明确的本机试点修改，并非新上游正式版本。源码 patch、运行时 patch 与 SHA-256 清单均可审查；`patch_runtime.py` 拒绝未知内容并要求服务停止后更改。已经实际完成 **revert → 原始摘要核对 → apply → 补丁摘要核对**，并通过运行时 JS 语法检查。完整上游 TypeScript 构建/单元套件尚未运行；本轮验证依据是失败复现、真实原生流程、权限检查和恢复演练。

## 备份与恢复

采用本机已有 PostgreSQL 18.6 的原生 pg_dump/psql 工具，对内嵌 PostgreSQL 18.1 做备份，并恢复到同主机全新数据库。原库未被覆盖，恢复库未接入运行服务，也未启动模型。最终演练在真实任务完成之后执行，**277 张表的全部行内容摘要与原库一致，且原库前后摘要不变**。[恢复证据](evidence/native-recovery-after-trial.json)。原始备份包含私有运行状态，只留在权限受限的 work 目录，未随 PR/输出包公开。

这是同主机逻辑备份恢复，不包括新主机、完整实例私钥/文件恢复、运行中崩溃、RTO/RPO 或模型在途恢复。上游自动备份在原生工具不可用时可能退回上述 JavaScript 引擎，因此**自动备份策略和完整灾备仍未验收**；不能只因本次原生手动演练通过而接受它。

## 当前裁决与下一阶段

当前入口：[本机 Paperclip](http://127.0.0.1:43100/MEN/issues)。19 岗及公司均暂停，启动器已恢复默认关闭原生事件调度；仍为前台本机进程，不保证 Mac 关闭后继续运行。当前使用经过摘要核对的本地恢复补丁，启动需要明确 `--allow-recovery-patch`。补丁撤销和同目录恢复已经实测。

允许审查：本机订阅连接、CLI 权限、带补丁的两任务真实研发接续、独立 QA、18 项工具测试、暂停守卫、原生同机逻辑恢复。仍不允许据此恢复正式业务或合并主线。

尚未验收：历史 revision 13 原任务权威与 UNKNOWN 停止回执；24 Skill 的原件核对与实际迁移；OpenCode；多可写 worktree；跨主机恢复及真实在途故障；完整模型成本和限额策略；GitHub 六项必需检查与 `luofanghao1203` 非作者人审；真实客户、监控、增长、支付等连接器；Linux 云端和 7×24 运行。

原 #98 OpenHands 和 #99 原生 DQ 试点继续保留，未接管它们。模型凭据不因岗位模板存在而开放给全部岗位。云资源候选仍按[操作说明的 $200/月明细](README.md)审核，含税、地域、流量与 CI 账户实际报价尚未锁定，未经确认不采购；生产权限没有扩大。

官方依据：[Codex 认证](https://learn.chatgpt.com/docs/auth)、[命名权限配置](https://learn.chatgpt.com/docs/permissions)。权限配置为持续演进功能，云端必须重新实测，不能直接复制本机通过结论。
