# DQ 隔离研发试点

本次范围由用户于 2026-11-01 明确授权，认领 [#99](https://github.com/luofanghao9784/mengine-app/issues/99)，作者与负责人账号为 `luofanghao9784`。仅在新隔离 Worktree 建设、合成测试与提交 Draft PR；原业务暂停保留。本文不解除暂停、不接管旧队列、不授权部署、采购或自动合并。

## 接管审计

审计时间：2026-11-01（北京时间）。本地初始目录 `/Users/luofanghao/mengine-app` 位于 `main`，干净，SHA `d945af9235b07ecfbfc4990bd6c4ebae4324b769`。GitHub PR #76 的实时 base 与其一致；随后单次连接避开失效代理，`git ls-remote origin refs/heads/main` 与 fetch 再次确认相同 SHA。未修改本机代理或全局配置。

本轮隔离目录 `/Users/luofanghao/.codex/worktrees/dq-team-pilot/mengine-app`，分支 `feat/dq-team-pilot-99`。原 main 目录保留。岗位配置不会自动安装到用户全局目录，也不回写 main。

审计时 GitHub 搜索返回 22 个开放 PR、29 个开放 Issue（不含随后新建的 #99）。以下为当时实读的状态，不是长期实时看板。

| 工作 | 实际状态与处理 |
| --- | --- |
| 历史 `.ai/TASKS.json` revision 13 | 本地 `.ai/` 不存在，远端 main 文件读取 404；[#98](https://github.com/luofanghao9784/mengine-app/issues/98) 明确要求另行对账。未知原所在执行端、未取得实际权威内容，不能创建替代文件或恢复任务。 |
| 暂停 | [CT 索引 §3.6](../codex-tasks/README.md#36-暂停令优先级最高) 规定不确定按暂停；[#96](https://github.com/luofanghao9784/mengine-app/issues/96) 只载明云端单项恢复且不触本地。本次用户例外只覆盖隔离建设。 |
| [#76](https://github.com/luofanghao9784/mengine-app/pull/76) | Draft，head `3e450e72660eda88498d4719e17f84a7a335f380`。API workflow `41158561952` cancelled；契约/引擎 `41158561934` 和前端 `41158561960` success。前端入口 `test:e2e:frontend` 实为 SKIP，不推定完整回归通过。 |
| [#97](https://github.com/luofanghao9784/mengine-app/pull/97) | Draft，叠加 #76，head `f5026fd0d047c2a5e6679b3bf37b8f4c2fcf344f`；所用 PR workflow 查询未返回本 head 运行，不能继承父 head 的绿。 |
| [#53](https://github.com/luofanghao9784/mengine-app/pull/53)、[#54](https://github.com/luofanghao9784/mengine-app/pull/54)、[#60](https://github.com/luofanghao9784/mengine-app/pull/60)、[#93](https://github.com/luofanghao9784/mengine-app/pull/93) | 均开放且未合并；#53/#54 非 Draft，#60/#93 Draft。保留原依赖链，不取为本任务起点。 |
| [#89](https://github.com/luofanghao9784/mengine-app/issues/89)、[#91](https://github.com/luofanghao9784/mengine-app/issues/91) | API 取消片诊断与 Native 队列隔离已认领，不重新执行。 |
| [#94](https://github.com/luofanghao9784/mengine-app/issues/94)、[#95](https://github.com/luofanghao9784/mengine-app/issues/95)、[#96](https://github.com/luofanghao9784/mengine-app/issues/96) | 恢复诊断、前端回归/依赖审计、锁文件修复已有责任方，不重复改动对应文件或 workflow。 |
| [#98](https://github.com/luofanghao9784/mengine-app/issues/98) | OpenHands 云端迁移试点只登记，未指派；本次 Codex 本地试点不替代、不启动其资源开通或迁移。 |

公开 Issue/PR 只能证明认领和交付记录，不能证明原执行进程已退出。历史 UNKNOWN、远端任务是否仍运行、正式暂停令全文与原权威队列均保持待核实；不会将它们导入本次 Ready 队列。

## 权威与运行边界

旧 CT 文档与交接是上下文，GitHub 认领是协作占用依据，原执行端才拥有实际执行回执。本次新 SQLite 账本只负责 #99 的新试点任务；不与产品自身 AI 任务数据库或旧 `.ai` 队列混用。任何后续正式接管必须先核对旧执行端、原队列版本及 UNKNOWN，取得相应授权并防止双平台执行。

DQ 负责派发、核验与 Git。执行岗位不自选业务任务、不递归委派。不同独立可写任务分配独立 Worktree，当前单个建设任务内的配置与调度器实现仅按互不重叠路径并行。原生 Agent 上限为每会话 3 个子 Agent，持久队列另外限制最多 3 个未确认结束的执行尝试；二者不是跨所有电脑的分布式锁。

控制面默认暂停，业务始终禁止；试点恢复只能运行新建的合成任务。任务提交、领取、执行返回、审核与完成分别记录。UNKNOWN 不自动重试；租约过期不代表进程停止，停止请求也不代表停止成功。确认不到退出则保留不确定状态与占用，不自动启动下一份可能重复的工作。

本地账本和岗位提示词不是防恶意代码的访问控制服务。本次可信 DQ 本地协调器核对调用者、执行回执与真实证据；不能以某个 JSON 的 actor 字段认证 GitHub 审查身份，不能以测试回执文件替代真实 CI。生产/凭据/模型费用边界由原权限与人工发布规则继续执行。

## 验收层次

配置检查证明文件数量、映射和语法；原生加载检查证明当前安装版本接受相应配置；技能实任务证明在指定样例下可按其工作。三者均不证明完整产品工程能力。

本次低风险工程任务就是 #99 的调度器建设：Issue 认领→隔离分支→实现→实质机制测试→独立 QA/安全/产品复核→固定提交→Draft PR。自动续接与故障恢复先在独立合成账本验证；真实模型/原生工具与合成 worker 的证据分别记录。GitHub CI、新候选 SHA 的非作者人审、正常业务产品验收仍必须另有真实回执，不自动补写通过。

结果与操作命令由 [验收报告](DQ试点验收报告.md) 和 [独立审查](dq-evidence/independent-review.md) 记录。验收失败时保留 Draft 与业务暂停；只有本轮隔离试点通过也不能自动恢复旧业务研发。

## 回退与后续启用

暂停新领取，确认所有执行端结束；无法确认则保留 UNKNOWN 和证据，不删除数据库。保留任务账本、事件和独立审查文件后，可关闭本次协调器。由于未合并或部署，原 main 与业务运行配置无需回滚。需要删除 Worktree 时使用应用归档保存恢复快照，不直接清理未提交内容。

本地电脑关机后，本地进程不会继续研发。本次不安装自动开机服务、不购买云主机、不启动 #98；常驻运行、云端迁移及正式业务恢复都不能从本次授权推定。调度器在其实际运行且授权有效期间受控自动续接，不要求用户逐单发送“继续”。

## 官方接口依据

依据当前 [OpenAI 原生子 Agent 文档](https://learn.chatgpt.com/docs/agent-configuration/subagents)：项目角色采用 `.codex/agents/*.toml`，每个包含 `name`、`description`、`developer_instructions`；并发采用 `[agents].max_concurrent_threads_per_session`。自定义角色继承父权限，配置不会产生独立只读沙箱。本机实测版本为 `codex-cli 0.165.0-alpha.1.2`；旧模型或旧配置示例不是本次接口依据。
