# DQ团队岗位与技能

本配置属于 Issue #99 的隔离试点。DQ为唯一主负责人，另外15个岗位由Codex原生子Agent按任务动态激活；项目配置最多3个并发子Agent。它不是16个常驻进程，也不意味着正常业务研发已恢复。

调度器需另行以事务保护跨进程执行任务上限；原生会话上限不能代替持久队列的并发保护。子Agent继承父会话模型和权限，岗位指令不是独立安全隔离。

## 岗位与专业技能

| 岗位 | 原生Agent名 | Skill |
|---|---|---|
| 产品 | `dq_product` | [dq-product-slice](../../.agents/skills/dq-product-slice/SKILL.md)、[dq-backlog-triage](../../.agents/skills/dq-backlog-triage/SKILL.md) |
| 体验 | `dq_ux` | [dq-ux-state-design](../../.agents/skills/dq-ux-state-design/SKILL.md)、[dq-plain-language-copy](../../.agents/skills/dq-plain-language-copy/SKILL.md) |
| 架构 | `dq_architect` | [dq-architecture-boundary](../../.agents/skills/dq-architecture-boundary/SKILL.md)、[dq-contract-review](../../.agents/skills/dq-contract-review/SKILL.md) |
| 技术负责人 | `dq_tech_lead` | [dq-implementation-plan](../../.agents/skills/dq-implementation-plan/SKILL.md)、[dq-code-review](../../.agents/skills/dq-code-review/SKILL.md) |
| 前端 | `dq_frontend` | [dq-frontend-change](../../.agents/skills/dq-frontend-change/SKILL.md)、[dq-accessibility-check](../../.agents/skills/dq-accessibility-check/SKILL.md) |
| 后端 | `dq_backend` | [dq-backend-change](../../.agents/skills/dq-backend-change/SKILL.md)、[dq-idempotency-check](../../.agents/skills/dq-idempotency-check/SKILL.md) |
| 引擎 | `dq_engine` | [dq-engine-integration](../../.agents/skills/dq-engine-integration/SKILL.md)、[dq-grounded-output](../../.agents/skills/dq-grounded-output/SKILL.md) |
| 数据 | `dq_data` | [dq-data-lineage](../../.agents/skills/dq-data-lineage/SKILL.md)、[dq-migration-review](../../.agents/skills/dq-migration-review/SKILL.md) |
| 质量 | `dq_qa` | [dq-qa-behavior](../../.agents/skills/dq-qa-behavior/SKILL.md)、[dq-queue-recovery](../../.agents/skills/dq-queue-recovery/SKILL.md) |
| 性能 | `dq_performance` | [dq-performance-probe](../../.agents/skills/dq-performance-probe/SKILL.md) |
| 安全 | `dq_security` | [dq-security-review](../../.agents/skills/dq-security-review/SKILL.md) |
| 运维 | `dq_operations` | [dq-local-operations](../../.agents/skills/dq-local-operations/SKILL.md) |
| 发布验收 | `dq_release` | [dq-release-gate](../../.agents/skills/dq-release-gate/SKILL.md) |
| 文档 | `dq_documentation` | [dq-technical-handoff](../../.agents/skills/dq-technical-handoff/SKILL.md) |
| 增长 | `dq_growth` | [dq-growth-experiment](../../.agents/skills/dq-growth-experiment/SKILL.md) |

DQ维护任务权威、Issue认领、Git/Worktree、公共契约、迁移编号、集成、停止控制及证据。专业岗只在派发范围执行，不递归委派、不独立领取队列；完成后回传DQ，由调度器原子选择下一条符合范围和依赖的Ready任务。

## 原生加载与兼容性

项目使用[Codex官方子Agent文档](https://learn.chatgpt.com/docs/agent-configuration/subagents)的项目级 `.codex/agents/*.toml` 与 `[agents].max_concurrent_threads_per_session=3`；每个岗位文件含 `name`、`description`、`developer_instructions`。未覆盖模型、凭据、全局配置或会话权限。

新会话或实际原生加载时核验这15个岗位和24个 `dq-*` Skill；现有 `deploy-data-foundation` 保留，项目Skill总数因而不是24。当前会话在生成这些文件前启动，不能把新文件存在当作它已经自动重新加载。

## 验证入口与证据分层

运行 `python3 scripts/dq-team/validate.py` 检查manifest、15岗、24技能及24个合成任务样例，输出逐文件SHA-256。该脚本仅接受本项目生成的受限TOML/YAML格式，不是通用解析器；不安装依赖。它不调用模型、不读凭据、不写状态。

[pilot-cases.json](../../scripts/dq-team/pilot-cases.json)包含24个专业实任务输入和行为验收标准，全部是只读合成场景。执行方必须加载对应 `SKILL.md` 后处理样例，记录原生agent/session、任务输入摘要、输出、判断和固定源码；样例中的 `NOT_RUN` 为不可变夹具状态，实际执行证据另外保存，不能改夹具为PASS冒充验收。

验证应分别报告：文件结构检查、Codex原生发现/加载、专业任务可用性、队列机制、真实工程闭环和非作者人审。24技能配置通过不代表这24项能力都已完成真实工程验收；合成审查通过也不代表生产部署、真实数据或客户验收。

本机CLI `0.165.0-alpha.1.2` 的 `codex --strict-config ... features list` 返回“不支持features命令”，该尝试未发起模型调用，也不算原生配置验证通过。实际加载证据由DQ后续验收报告记录。

## 暂停、质量与回退

本次用户只授权隔离建设、测试与Draft PR，业务暂停继续生效。历史 `.ai/TASKS.json` revision 13 尚未取得，不新建、覆盖或导入；UNKNOWN不得转Ready，不双平台重复认领。Issue #98的云端OpenHands工作独立保留。

所有岗位保留生产禁写、禁止自增付费资源、固定SHA门禁和独立审查。QA、安全、产品验收应有独立执行者及实际证据；模型审查不等于 `luofanghao1203` 的非作者人审放行，作者不能自批。

回退仅移除本PR新增 `.codex/`、`.agents/skills/dq-*` 和试点工具及文档，并恢复本PR对AGENTS的增量；不触碰现有Skill、历史任务、工作树或产品数据。若已有试点运行，先停派、确认执行者退出并保存状态与证据，再处理配置。
