# Issue #99 独立技术验收记录

日期：2026-11-01。评估者：Codex 原生子 Agent `independent_acceptance`，不是实现作者。只读代码；仅在本报告及 `.local/dq-independent/` 写入合成证据。未操作 Git、生产、历史队列或其他任务实例。本报告不构成 `luofanghao1203` GitHub 人审。

## 裁决与适用范围

允许作为默认暂停的隔离试点候选继续准备 Draft；**不接受正常业务研发或无人值守工程能力已完成的声明**。本轮证明的是新队列机制与合成技能场景响应；业务暂停、历史权威未取得、外部审核及真实原生执行桥接仍是后续门禁。

SQLite `receipt`、SHA、actor 校验属于本机可信操作者的结构化记账，不认证文件内容、Git 对象存在、GitHub reviewer 身份、真实子 Agent 已停止或“真实”测试执行（见 `queue.py:42`、`:222`、`:235`、`:277`）。同一用户可换 actor 字符串，因此本地 actor 分离不能替代独立安全身份。`run_pilot.py` 中三个审核角色是明确标注的合成模拟，不是三个独立 Agent 或人类批准。

## 固定输入与实际检查

`scripts/dq/queue.py` SHA256：`df326be2161ee448aa2912dedb315f23c034cded29ecf40dae740cff96be9d72`。

`scripts/dq/run_pilot.py` SHA256：`9f607c941553ccd8168215e32d8b1b643fe0d3083b17272273a7c4effa5a7273`。

- `python3 -m unittest discover -s tests/dq -v`：退出0，13/13通过，约1.66秒；涵盖实际跨进程争抢、SIGKILL与重开、stop/claim竞争、STOPPING超时、依赖/门禁与追加事件。本轮是我实际独立运行，不只转述作者结果。
- 独立 `.local/dq-independent/probe.py`：退出0，5/5组通过；默认PAUSED与业务scope拒绝、STOPPING过期UNKNOWN占槽、重开DB租约到期UNKNOWN且旧worker不可完成/心跳、同actor/错SHA门禁拒绝并等待三门禁后才领取依赖、`.ai/TASKS.json`拒绝且外来文件未改变。
- 独立15进程争抢15条合成任务：15个进程均退出0，恰3次领取成功、3个不同任务、occupied=3。临时DB及claim token仅存在私有 `.local` 合成目录，报告不输出token。
- 初读发现STOPPING generation与expiry筛选不相等的缺口并通知作者；当前`:167`显式覆盖STOPPING的`generation+1`，独立探针和回归均通过。此为并行工作中及时修正，不把尚未验证版本列作通过。

## 8项专业Skill实际场景

以下每项均已显式读取对应 `SKILL.md` 正文，按原始pilot-cases输入实际产出评审/设计结果。结果通过表示该合成请求满足列出的行为预期，不代表Skill自动发现、15岗原生角色全部加载、浏览器执行或业务端到端通过。

### SK17 · `dq-qa-behavior`

Skill SHA256：`9bb9fd5d670749da37d5b760cc5cecd17fedff773d0682754d7ebff14e57ef06`。输入：合成发布按钮测试仅查元素存在，接口返回500仍显示成功。设计最小测试。

最小行为回归需包含成功和失败两条。成功：合成已授权员工在所属空间提交一次发布，断言接口返回真实成果ID/版本，刷新后能读取同一成果且只新增一条；不可只断言按钮存在。失败：接口500后页面保留草稿并显示“暂时无法发布”，不得出现成功提示、成果ID或清空输入，按钮允许用户明确再试而不自动重发。另用无发布权但有读取权的合成员工断言403且零成果。当前没有提供页面/接口实现，产出为可执行验收设计，不冒称浏览器或真实发布已通过。

结论：PASS_SCENARIO_RESPONSE；合成场景；未证明自动发现/重载或完整专业工程实现。

### SK18 · `dq-queue-recovery`

Skill SHA256：`6189f84deb6d75a95fc83aba13d6310d998ef33fc9aa19301fb4963e38e8d9b6`。输入：合成worker执行中被kill，租约到期。调度器把任务Ready并立即重跑。审查并给验证步骤。

该自动重跑方案阻断。kill后任务只能在租约到期变UNKNOWN，保持原attempt/事件与占槽，暂停新领取；先按真实执行/副作用回执对账，不能直接改Ready。旧worker即使随后返回，也因attempt token/generation不匹配被拒绝。已独立跑默认暂停、stop→过期UNKNOWN、重开DB→UNKNOWN、不重复enrol、旧heartbeat/finish拒绝探针；五组通过。作者13项机制测试中真实SIGKILL/重开/租约用例亦由我独立运行通过。当前回执仍由本地可信DQ提交，不证明真实Codex进程已退出。

结论：PASS_SCENARIO_RESPONSE；合成场景；未证明自动发现/重载或完整专业工程实现。

### SK19 · `dq-performance-probe`

Skill SHA256：`7758ae6a02d5c24e12ef9122208029b288e337e30267a9c21506c4e6b32f24d6`。输入：合成环境关闭后台任务后CPU低，团队声称高负载性能验收通过。给判断和最小合成测量。

低CPU仅证明后台关闭后的空闲健康，不接受高负载验收。最小试点测量固定当前queue.py摘要、15条合成Ready任务、15个独立进程同时claim，记录成功数、重复领取、占槽和执行时长；已真实测得15进程全部退出0、恰3次claim成功、3个唯一任务、occupied=3（约0.032秒整段工具耗时，仅本机短测）。这证明原子领取限流，不能推导模型吞吐、长运行P95或业务CPU表现。若后续做性能比较需固定机器/后台开关、重复批次和任务规模，保留原超时与断言。

结论：PASS_SCENARIO_RESPONSE；合成场景；未证明自动发现/重载或完整专业工程实现。

### SK20 · `dq-security-review`

Skill SHA256：`d0afdfd24c22d51b2dee38f3e3a521cadfbed387f5b288b01f1467f26d71bbf3`。输入：合成tenantId由前端传入，缓存仅按query做key。指出跨企业风险与必要反例。

存在跨企业访问与缓存泄漏风险。tenant身份必须由服务端有效会话/成员资格解析，body tenantId只能作受权目标并与当前企业匹配；缓存key至少绑定有效企业、空间/对象、当前权限代际及来源版本，缓存命中后仍执行权限检查。合成反例：企业A/B使用同query；A填充缓存后B请求只能看到B获权结果；A伪造B tenantId应403且不得写入或返回B数据；A撤权后旧缓存不可继续命中。当前仅有方案输入，未提供实际接口/缓存实现，不能声称隔离已动态通过。队列SQLite actor名/receipt摘要只是本地attestation，不承担此权限边界。

结论：PASS_SCENARIO_RESPONSE；合成场景；未证明自动发现/重载或完整专业工程实现。

### SK21 · `dq-local-operations`

Skill SHA256：`5af8024cc16cbdb84cc87ae335488713374af7c0c75f461e0280b3828eaf6e12`。输入：合成预览端口被另一任务占用，启动器计划kill占用PID再启动。给处置。

拒绝kill另一任务PID。先只读核对占用端口、工作目录、PID/父进程和数据目录归属；本任务选择空闲回环端口及独立数据目录，启动器对冲突明确失败，不抢占原实例。停止仅针对本任务已核定的进程组，随后确认退出与端口释放；无法确认则UNKNOWN。该场景为处置演练，未启动/终止任何其他任务服务；不会用kill命令本身作为成功证据。

结论：PASS_SCENARIO_RESPONSE；合成场景；未证明自动发现/重载或完整专业工程实现。

### SK22 · `dq-release-gate`

Skill SHA256：`e66a64c4699baa19df3e6d82a3d4734f88bea0cdaa19ab5959bb067dea9c0bd6`。输入：候选head=B，测试绿属于A；B的API cancelled，作者评论“批准”。可否放行？

不放行。A的绿不能覆盖head=B；B的API cancelled不是通过；作者评论“批准”不构成非作者审核。候选保持Draft，取得B相应tree上的完整适用CI、QA/安全/产品结论及1203非作者放行后才可裁决。真实对照当前历史#76 API cancelled与#97尚无PR-triggered workflow记录，均不能继承其他SHA绿。本报告是独立Agent技术审查，不能替代1203 GitHub身份的人审，也未执行合并或发布。

结论：PASS_SCENARIO_RESPONSE；合成场景；未证明自动发现/重载或完整专业工程实现。

### SK23 · `dq-technical-handoff`

Skill SHA256：`ea369e30416371e54169cf71b9e32848c974cf1c646c2d04bb4ad71a6a1b3243`。输入：旧交接写main=A、任务完成；当前PR未合且head=B。给交接修正规则。

保留原交接“当时main=A/当时任务完成”的日期语义，新增当前核对段：来源为实时GitHub PR/branch和执行回执，head=B仍未合入；分别记录代码准备、实际测试、PR、部署和业务验收状态，缺证据明确UNKNOWN。当前历史.ai/TASKS.json未取得，不能创建新文件补写“完成”或以旧QUEUE接管权威；记录来源缺口与下一只读对账动作。修正交接不触发重跑、合并、部署或恢复业务暂停。

结论：PASS_SCENARIO_RESPONSE；合成场景；未证明自动发现/重载或完整专业工程实现。

### SK24 · `dq-growth-experiment`

Skill SHA256：`d1d7cbbb5d571800299ee501289cc067e5bd725d727a0a421ad2f68cbfd90de8`。输入：合成目标提升员工AI草稿复用。团队建议以后台任务数为成功指标并自动发客户邮件。给实验方案。

仅设计内部实验：目标为已使用草稿能力且获权共享的员工，假设更清楚的来源/适用空间提示能提高可复用成果比例。主指标是获权共享草稿被其他员工成功打开并明确采用的比例，辅以7日再次使用率、质量反馈与发布失败率；后台任务数只能是成本/活动指标。先以合成数据和内部原型走查，无新增外发；样本数量及真实参与者须在执行前由产品确认现有授权范围。出现越权、误导发布或负反馈上升即停止。客户邮件、买量、真实数据采集与未验收能力承诺均不在本任务内；尚未运行真实增长实验。

结论：PASS_SCENARIO_RESPONSE；合成场景；未证明自动发现/重载或完整专业工程实现。

## 明确未验证/未放行

未验证15个岗位的原生自动发现和全部实际工程任务；本子 Agent 仅证明其8个Skill显式正文加载后的合成场景行为。新增有界只读原生CLI桥接，其假CLI协议测试不证明真实原生执行；未建立跨聊天/桌面关闭后的常驻原生Agent调度服务，确定性sha256续接也不代表代码研发自动续接。未验证当前候选远端CI、1203审核、生产部署或客户验收。未取得历史 `.ai/TASKS.json` revision13与其当前执行端对账，不能恢复或重领UNKNOWN。未运行真实企业数据/模型性能压测或增长外发。

回退范围限本试点分支和新本地队列：保持PAUSED；先停止本试点领取，取得实际执行停止回执再处理其Worktree/队列；不能删除或重置历史状态。真实执行端回执未取得时保持UNKNOWN占槽，不以清库恢复运行。

## 原生桥接与发现的独立追加复核

本节覆盖后来新增的 `run_native.py`、15项假CLI协议测试、原生发现脚本和轻量CI。前述13项检查属于初版时间点；最终独立执行 `python3 -m unittest discover -s tests/dq -v` 退出0，**28/28通过**，约4.37秒。测试不调用付费模型；假CLI只证明本地驱动契约。`python3 scripts/dq-team/validate.py` 亦由我实际执行退出0（15岗/24技能/24场景）。

发现的三项集成/停止问题均已由作者修正并由我定向复核：原生岗位名与文件名不同，现按manifest解析文件并确认TOML中的真实name；原生source SHA原只检查格式，现要求真实Git顶层、命名非main分支、HEAD精确匹配且工作树无未提交内容；本地CLI退出或缺少start日志不能证明远端未开始，现只有Popen从未成功可确认未启动，实际启动后的失败/超时保持STOPPING，租约后UNKNOWN并占槽。

原生worker的单会话子Agent上限为1，配合queue最多3执行槽，避免3个CLI各spawn3造成9路执行。正常DQ项目配置仍为最多3个子Agent。成功执行也必须观察root最新turn完成，以及已spawn子Agent的绑定终态，才允许转REVIEW；child被followup/resume重新启动或报告running时会撤销旧terminal证据。没有终态的模型JSON不能释放执行槽。模型输出pass=true本身不会写QA/security/product gate，执行结果最多到REVIEW，绝不自动DONE或人审放行。

只读原生发现脚本只发initialize、initialized、skills/list、config/read，无thread/start或turn/start；输出已做白名单筛选。复核root保存的实际原生发现结果，exact_enabled_repo_skills=true、project_agent_layer_enabled_cap_3=true，确认24项技能均enabled、repo范围、精确属于本Worktree，并核对未禁用的本项目agents配置上限3。此可证明原生发现成功，**不能证明15个岗位全部被调用**。

新增 `.github/workflows/dq-pilot-gate.yml` 静态审查：仅PR/手动触发、contents:read、ubuntu标准runner、5分钟上限、cancel-in-progress:false；只执行标准库配置验证与合成机制测试，不含模型调用、密钥、部署或新增外部服务。未安装actionlint，未自行dispatch，远端真实执行结果待DQ固定提交后读取；不能将静态审查写成CI已通过。

最终复核文件摘要如下；后续若这些字节改变，结论须按改动重新核对。当前追加复核未发现阻止默认暂停试点Draft提交的剩余P1；真实CLI/原生子Agent调用尚待DQ固定版本后执行，不纳入本节通过结论。

- `scripts/dq/queue.py`：`d05e64843492c6800e2f6eccd26e2805318c834bcd34df72bfb76b80e17dd7d9`。
- `scripts/dq/run_native.py`：`c7bcb9545cdc272ab84172f2351228392d86c416f99eb3baba879171e1ff3c98`。
- `scripts/dq-team/native_discovery.py`：`d8dd90887601213406a5175733f9365f3e5c85f87a632968da07bf22ba15ade2`。
- `.github/workflows/dq-pilot-gate.yml`：`1366d6379ee807a1dc18e98e6775133d43c9ef15daeb83c69a9e1a169bbd79c9`。

## 有界原生续接watch的独立追加复核

新增 `watch_native.py` 与3条机制测试已只读审查，并实际运行 `python3 -m unittest discover -s tests/dq -v`：退出0，**31/31通过**，约4.54秒。其显式 `--execute` 才能启动，不调用pilot-resume、不修改业务暂停，不写任何审核gate。运行窗口最长3600秒、最多24条任务，轮询间隔受限；正常窗口/数量结束或遇PAUSED/UNKNOWN后保持PAUSED。任务失败或停止仍依赖原生bridge的保守停止与租约语义，不能借watch绕过终态确认。

新增测试用真实独立进程提交三个合成review gate，watch在同一进程内等待约0.15秒后自动领取依赖任务：first=DONE、second=REVIEW，gate总数恰3；watch没有替第二项写gate，退出后PAUSED。默认暂停和空窗口不创建工作、不调用模型的两条反例亦通过。该实证证明**持久队列等待外部审核后自动续接的机制**，采用确定性native stand-in，不能称两个真实模型工程任务已端到端完成。

静态复核未发现阻止默认暂停Draft提交的P1。窗口需显式启动且依赖当前进程存活；未安装常驻服务，不证明Mac关闭后的持续研发。真实原生执行、原始事件解析与远端CI仍分别以DQ固定候选的实际回执为准。

- `scripts/dq/watch_native.py` SHA256：`1e9f264311c429acf507d46e9084a6daaf7b7207f773afc2c08ff99e369f6086`。
- `tests/dq/test_watch.py` SHA256：`173386ad3a647a6e6db8e78a04ef04c2f6bd9fb4578395ab97c573387deaef01`。
