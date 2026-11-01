# DQ 隔离试点验收报告

日期：2026-11-01。认领 [#99](https://github.com/luofanghao9784/mengine-app/issues/99)。基线 `d945af9235b07ecfbfc4990bd6c4ebae4324b769`，独立分支 `feat/dq-team-pilot-99`。最终提交与 PR 以 GitHub Draft 的实际 head 为准，本文中的机制证据同时绑定文件摘要，避免报告引用自身提交的循环。

## 当前裁决

默认暂停的配置与本地机制试点已形成候选，正常业务研发保持暂停。不得宣称16岗24技能全工程验收、历史权威接管、无人值守生产研发或客户验收已完成。原生适配器仅允许只读试点审查，成功最多进入 REVIEW，不自行补写 QA/安全/产品 PASS。

## 分项结果

| 项目 | 已有证据 | 限制 |
| --- | --- | --- |
| 项目安全接管 | 本地/远端 main 核对、开放认领与 PR 审计；[操作说明](DQ隔离研发试点.md) | 历史 revision13 队列及原执行端状态未取得，UNKNOWN 不恢复 |
| 团队配置 | DQ 唯一主负责人，15个原生岗位，最大3并发；[岗位映射](DQ团队岗位与技能.md) | 不启动15个常驻进程；岗位提示词不是权限沙箱 |
| 24 Skill | manifest/受限语法检查通过；原生 `skills/list` 精确发现24个启用的 repo Skill；[发现记录](dq-evidence/native-discovery.json) | 发现不代表所有岗位均实际调用 |
| 24专业任务 | 逐项显式加载SKILL正文并处理合成输入，记录正文摘要/执行者/实际产出；[24项证据](dq-evidence/skill-use.json) | SK01–08由DQ、SK09–16由技能作者、SK17–24由独立Agent执行；不是24项产品实现测试 |
| 持久队列 | SQLite事务、唯一去重、依赖、3槽、租约与代际、追加事件、暂停与停止确认 | 只接收本次新pilot/synthetic；本机可信记账不认证GitHub身份 |
| 自动续接 | 有界确定性sha256 worker及原生watch；实际跨进程审核后，同一watch自动领取依赖任务 | 合成driver三审核人是模拟；原生driver不自批，watch窗口内等待独立门禁 |
| 异常恢复 | 实际SIGKILL/重启、跨进程抢占、过时回执、停止竞争、UNKNOWN不重跑测试 | UNKNOWN保留占槽；没有强行重排或清库恢复命令 |
| 独立审核 | [独立报告](dq-evidence/independent-review.md) 与实测记录 | 不是 `luofanghao1203` 正式人审 |
| CI | 新增 `DQ pilot gate`，只运行标准库配置/队列/假CLI契约测试，不调用模型或生产 | 远端实际结果待PR发布后读取；不代替原六项门禁，不修改它们 |
| 发布 | 仅准备Draft候选 | 未合并、未部署、未采购，不恢复业务 |

## 可运行入口

Python 3.9+，不新增依赖；在本试点分支根目录运行：

```bash
python3 scripts/dq-team/validate.py
python3 scripts/dq-team/native_discovery.py
python3 -m unittest discover -s tests/dq -v
python3 scripts/dq/queue.py --db .local/dq-pilot/queue.sqlite init
python3 scripts/dq/queue.py --db .local/dq-pilot/queue.sqlite status
python3 scripts/dq/queue.py --db .local/dq-pilot/queue.sqlite stop
python3 scripts/dq/queue.py --db .local/dq-pilot/queue.sqlite recover
```

`native_discovery.py` 只调用原生 app-server 的 initialize、skills/list、config/read，不创建会话或发起模型。`recover` 不清空任务，只在租约失效时转UNKNOWN并暂停。

`pilot-resume` 必须带本次授权记录 `{issue:99,scope:"isolated-pilot",receipt,sha256}`。该结构由可信DQ核对真实来源，本地JSON本身不创造授权。claim返回的token仅留本地私有目录，不写PR/共享日志。

`run_pilot.py` 是明确标注 synthetic 的机制驱动，只支持固定sha256操作。完整自动续接/中断测试由单元测试在一次性目录构造授权夹具，不需要用户手工分发任务，也不导入历史任务。

原生driver入口（仅明确获准的新只读试点任务，代码必须已提交且工作目录干净）：

```text
python3 scripts/dq/run_native.py --db <新试点账本> --worktree <隔离Worktree> --source-sha <当前HEAD完整SHA> --evidence-dir <该Worktree/.local/原生证据目录> --limit 1 --timeout 180 --execute
python3 scripts/dq/watch_native.py --db <新试点账本> --worktree <隔离Worktree> --source-sha <当前HEAD完整SHA> --evidence-dir <该Worktree/.local/原生证据目录> --duration 300 --limit 24 --execute
```

payload只允许 `operation=review-dq-pilot`，角色须在本次manifest，技能须位于本次Worktree。固定调用 `codex exec`、read-only、never审批、关闭apps/plugins/memories，忽略用户自定义配置但保留当前登录；本试点固定使用本机核实的 `gpt-6.1-sol / medium`。岗位文件本身仍继承父模型；适配器的显式模型选择与未来业务模型策略无关。未接入自定义付费provider。

`run_native.py`遇无Ready立即退出；`watch_native.py`在最长3600秒/24任务窗口内等待独立审核完成后选择下一Ready，窗口结束自动PAUSED，不安装常驻服务。每CLI最多1个子Agent，配合队列3个执行槽避免跨CLI放大并发。

模型返回由输出schema约束，仍只记实际执行证据，不证明其结论正确；必须看真实collaboration事件与所派子Agent最新终态，不能凭模型自述宣称派发成功。失败时停止新领取；CLI退出仅证明本地进程结束。只要CLI曾成功启动而无绑定原生终止回执，就保持STOPPING，租约过期转UNKNOWN，不以日志缺失推定未启动；只有本地进程从未启动才可确认未执行。

## 尚未放行

历史权威与暂停令全文对账、原生全部15岗位实际工程能力、正式代码研发自动续接、独立CI最终结果、1203人审、长期运行/断网/多机恢复、真实数据隔离与客户产品验收均不能从当前结果推定。正常业务暂停的解除另需明确授权；本次不重复要求用户批准已授权的隔离建设步骤。

## 证据与回退

共享证据位于 `dq-evidence/`；完整本地诊断、原生事件与私有队列保留在本Worktree `.local/`，不会提交token或凭据。实现与证据提交SHA由PR留痕，独立审查用文件SHA绑定其检查范围。后续代码修改仅对受影响项复验。

回退先暂停领取、确认实际执行结束，UNKNOWN保持不动；保存账本和日志再归档Worktree。原main、产品数据库、生产配置、原有Skill和历史队列均未修改，不需要生产回滚。
