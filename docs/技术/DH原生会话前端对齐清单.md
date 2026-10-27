# DH 0.2.1 原生会话：梦擎前端对齐清单（#120）

2026-10-27 与用户逐项确认后整理。目标：把官方 DH 会话能力搬进梦擎自己的会话页（梦擎样式、手机与桌面布局），不再依赖官方独立窗口；企业身份、权限、预算、发布始终由平台决定。依据见 `DH-0.2.1-原生会话迁移.md` 末节“可复用接口核实”。

## 一、已确认的决定

| 事项 | 决定 |
|---|---|
| 执行前审批与权限 | 管理员统一定策略（例如默认只读资料、写入需审批）；员工只在审批出现时“同意 / 拒绝”，不能自行切换权限档位 |
| 模型选择 | 员工端不开放切换，只显示当前模型 |
| 定时任务 | 采用 DH 定时任务的规则与界面；到点由平台核对权限后按需唤醒运行环境；保留梦擎的企业保护（权限变化自动停、次数与预算上限、需要处理的提醒）与“资料更新时触发”；现有持续计划迁移过来 |
| 技能 | 企业技能库：梦擎技能中心作为技能来源，技能为 DH 说明书格式（`SKILL.md`），审核后上架；AI 在会话中自行从目录挑选加载，员工可 `/技能名` 调用；AI 发现缺技能时，员工可一键提交需求给管理员 |
| 插件 | 不开放员工或 AI 在线安装；改为“预装 + 企业私有插件市场”：部署方审核后打包进运行环境镜像，管理员在管理端开启 / 关闭（见第六节）。新的企业插件放到后期单独规划开发，不在本次范围 |
| 深色模式与字号 | 单独立项，不放进本次对齐 |
| 快捷键 | 只做新建会话、搜索会话、发送、停止 |
| 画报自动生成 | 不并入 DH 定时任务，保持现有带质量校验的流程 |

## 分工

- **Codex**：合并与主线验证；后端与引擎（第二节 B1–B8 全部）；运行环境镜像、预装插件与部署相关工作。
- **Claude**：全部界面，包括客户端会话页与列表、管理端的技能上架、插件开关、缺技能需求处理界面；前端需要的接口先以契约提案写在本文附录，由 Codex 定稿实现。
- 前端不等后端空转：按附录事件约定，先用合成事件做好各类卡片与交互并有单元测试，接口就绪后接通真实数据再做浏览器验收。

## 二、后端前提（交 Codex，前端各批依赖）

| 编号 | 内容 | 用途 |
|---|---|---|
| B1 | 会话事件转发：平台以 SDK 方式驱动运行时，按会话转发 `session.event`、`session.status`、`subagent.*` 给前端（SSE 或 WebSocket），支持断线续传与历史冷读取 | 所有渲染的基础 |
| B2 | 上行操作接口：发送消息（含引用资料）、回答 AI 提问、审批同意 / 拒绝、停止当前轮、计划审阅通过 / 退回；全部经平台鉴权后转给运行时 | 输入与交互 |
| B3 | 运行状态与预算：运行 / 空闲、当前轮耗时、已用费用与软硬阈值（来自桥接容器的预算台账，平台可读） | 状态与预算显示 |
| B4 | 定时唤醒：平台调度到点任务，核对员工与资料权限后启动运行环境、投递本次指令、完成后回收；记录每次执行回执 | 定时任务 |
| B5 | 技能下发：运行环境从平台读取已上架的企业技能（按企业、按员工可见范围），新增 / 下架即时生效 | 企业技能库 |
| B6 | 插件预装与开关：镜像内预装插件清单；管理端可按企业开启 / 关闭；运行时只加载已开启的 | 插件 |
| B7 | 附件：员工本地上传图片 / 文件进会话（进隔离工作目录，按私人资料处理） | 附件 |
| B8 | 会话元数据：标题（自动生成 + 可重命名）、置顶、按标题与内容搜索、待处理状态（等审批 / 等回答 / 计划待审阅） | 会话列表 |

## 三、第一批（做完即可不再依赖独立窗口）

| 功能 | 前端要做的 | 依赖 | 验收标准 |
|---|---|---|---|
| 对话流 | 用户 / AI 消息、思考过程可折叠、历史恢复与滚动位置 | B1 | 刷新或换设备后内容一致；不出现由前端拼造的消息 |
| 工具过程卡片 | 每次工具调用一张卡：名称、参数摘要、进行中 / 成功 / 失败、结果摘要，可展开 | B1 | 与运行时事件一一对应；资料类工具显示真实来源版本 |
| 运行状态、停止、继续 | 顶栏显示运行 / 空闲与预算进度；停止当前轮；停止后继续 | B1 B2 B3 | 状态与预算只来自平台回执，不用计时器或模型自述 |
| AI 向用户提问 | 选项 / 文本作答、跳过、倒计时 | B1 B2 | 回答经平台转交；超时行为与 DH 一致 |
| 执行前审批 | 审批卡：要做什么、影响哪些文件；同意 / 拒绝 | B1 B2 | 策略由管理员决定；员工无切换入口 |
| 输入框 | 发送、停止、引用梦擎资料（现有“添加资料”）、本地上传 | B2 B7 | 引用资料仍按员工权限核对 |
| 成果文件卡 | 一轮结束时列出交付 / 改动的文件，接到“私人成果 + 确认发布” | B1 | 只有平台回执的成果可下载与发布（已有） |
| 回复评价 | 赞 / 踩接入梦擎评价体系 | B2 | 与旧会话评价同一数据 |
| 会话列表必要项 | 重命名、搜索、置顶、待处理提示点（等审批 / 等回答 / 计划待审阅） | B8 | 待处理会话在列表和抽屉里醒目可见 |

## 四、第二批（长任务与效率）

| 功能 | 前端要做的 | 依赖 |
|---|---|---|
| 计划模式 | 计划卡片与审阅（通过 / 退回修改） | B1 B2 |
| 后台任务面板 | 进度、耗时、输出，可展开；与预算放在一起 | B1 B3 |
| 子任务查看 | 子任务列表、进展、用量；可停止（只读为主） | B1 B2 |
| 持续目标 | 设置、暂停、清除目标，显示进展 | B1 B2 |
| 工作流运行 | 多阶段流程逐层展开查看 | B1 |
| `@` 引用 | `@` 弹出梦擎资料库与旧会话 | B2 |
| `/` 技能与命令 | 列出企业技能库可用技能；只保留常用命令 | B2 B5 |
| 缺技能需求 | AI 提示缺少合适技能时，员工一键提交给管理员；管理端收件与处理 | B5 |
| 文件预览与工作文件 | 用梦擎资料卡阅读器预览会话工作文件（Markdown、PDF、表格、图片） | B1 |
| 密钥遮罩 | 粘贴的密钥 / 密码自动打码显示 | 无 |
| 基础快捷键 | 新建会话、搜索会话、发送、停止（待确认） | 无 |
| 定时任务 | DH 规则（一次性、间隔、每天、每周、cron）、编辑、执行记录、会话时钟标记；保留资料更新触发与企业保护；持续计划迁移 | B4 |

**第二批前端进度（2026-10-27）**：已完成界面与解析，等 B1–B3 接通后直接生效——
- 已做：“任务进展”卡片（持续目标、待办、后台任务、子任务、工作流、计划模式提示）；状态栏的待处理与进展摘要；计划审阅卡；`/` 技能菜单（数据位已留，等 B5 提供技能列表）；密钥遮罩；快捷键 ⌘/Ctrl+Shift+O 新建、Esc 停止本轮（Enter 发送已有；搜索等 B8）。
- 未做：目标的设置 / 暂停 / 清除与子任务停止（需要 B2 的对应操作）；后台任务输出查看、子任务进展与用量（需要 B1 转发子会话事件）；`@` 引用（B2）；缺技能需求（B5）；工作文件预览（B1）；定时任务（B4）。

## 五、会话列表对照（已核对代码）

| DH 能力 | 梦擎现状 | 处理 |
|---|---|---|
| 按工作区分组 | 有（按空间） | 沿用 |
| 删除 / 归档，运行中先确认 | 有（回收站、恢复、先停止再删除） | 沿用 |
| 运行中、未读标记 | 有 | 沿用 |
| 重命名、搜索、置顶 | 无 | 第一批补 |
| 待处理提示 | 无 | 第一批补 |
| 定时任务时钟标记 | 无 | 随定时任务补 |
| 复制会话、拖拽排序、复制 ID | 无 | 不做 |

## 六、插件：预装与开发

### 6.1 原生运行环境已自带（DH 标准能力，无需安装）

文件读写与搜索、在隔离沙箱内执行命令、Python / Node 代码运行、Office 文档技能（Word / Excel / PPT 撰写与操作）与转 PDF、待办计划、子任务、工作流、定时、向用户提问、交付文件、会话查询、持续目标。前端第一、二批即是让这些能力在梦擎页面里可见可用。

需注意：公网搜索与网页抓取（`tool-web`）依赖“受控公网工具”，目前未完成，暂不开放。

### 6.2 梦擎企业插件（已开发）

`enterprise_history`（旧会话上下文）、`enterprise_search`（获权资料检索）、`enterprise_read`（读取原件到隔离目录）、`enterprise_save`（保存为私人成果）。

### 6.3 新的企业插件

后期单独规划开发（用户 2026-10-27 决定），本次不做。

### 6.4 企业私有插件市场

沿用 DH 插件市场的索引格式，但索引只指向企业审核过的插件仓库。部署方审核后打包进镜像；管理员在管理端按企业开启 / 关闭；员工侧只看到“当前可用能力”，不能安装。官方 DH 插件市场里的插件也走这条审核路线引入。

## 七、不做

终端、内置浏览器（等受控公网工具完成后再议）、插件在线安装、员工切换模型、选择本地工作目录、思考过程翻译（外发合规风险）、DeepSeek 账号 / 遥测 / 品牌、执行轨迹（员工端；排障可放管理端）、多代理团队与语音输入（实验功能，后续再议）、会话的复制 / 拖拽排序 / 复制 ID。

## 八、推进顺序

1. Codex：B1、B2、B3（第一批的前提），同时 B8。
2. Claude：第一批前端，逐项对照验收标准自测；第一批验收后，原生会话默认在梦擎页内使用，独立窗口保留为备用入口一段时间。
3. Codex：B4、B5、B6、B7；Claude：第二批前端与管理端开关、技能上架、缺技能需求处理。
4. 新的企业插件后期单独规划。

## 附录 A：B1 事件约定（分组保留，平台定稿见附录 C）

转发内容即 DH `dsh-session` 的 `SessionEvent` 原样数据（0.2.1-rc.2 共 62 种，以 `KNOWN_SESSION_EVENT_TYPES` 为准），平台只做鉴权、按会话过滤与去除内部字段，不改写语义。前端第一批按以下分组渲染，其余类型在界面上忽略但不丢弃：

| 分组 | 事件类型 | 前端用途 |
|---|---|---|
| 轮次 | `turn/start` `turn/end` `step/start` `step/end` | 运行 / 空闲、每轮边界 |
| 消息 | `user/message` `assistant/message` `assistant/attempt` `system/message` `developer/message` | 对话流（system / developer 不显示） |
| 工具 | `tool/call` `tool/result` `tool/ptc-dispatch-start` `tool/ptc-dispatch` | 工具过程卡片 |
| 交互 | `approval/asked` `approval/decided` `approval/policy` | 审批卡、待处理提示 |
| 计划与待办 | `plan/mode` `todo/write` `goal/change` | 计划卡、待办、持续目标（第二批） |
| 成果 | `deliverables/presented` `workspace/changes` | 成果文件卡 |
| 后台与子任务 | `job/registered` `job/settled` `subagent/*` `tool-workflow/*` | 后台任务、子任务、工作流（第二批） |
| 会话 | `session/title` `model/selection` `permission/preset` `sandbox/mode` `schedule/change` | 标题、只读的模型与权限显示、定时 |
| 反馈 | `feedback/*` | 回复评价 |
| 维护 | `compaction/*` `llm/retry*` `image/offload` | 显示“正在整理上下文 / 重试中”提示 |

另需 `session.status`（整个智能体运行 / 空闲）与断线续传：前端带上最后收到的事件序号重连，平台从该序号之后补发。AI 提问以真实工具事件及附录 C 的 `question/asked`、`question/deadline`、`question/closed` 适配通知呈现；不虚构 DH SessionEvent 类型。

## 附录 B：第一批前端调用约定（B1–B3，后端差异已在附录 C 定稿）

前端第一批界面（`src/native-conversation/chat/`）已按下列形状实现，后端定稿时如有调整，前端随之修改。所有写操作都带 `requestId` 以便重试去重，并由平台按员工身份与会话授权核对后再转给运行时。

| 用途 | 建议接口 | 请求 / 返回 |
|---|---|---|
| 事件流（B1） | `GET /api/v1/tenants/{t}/native-conversations/{id}/events?after={seq}`（SSE） | 每条为 `{type, seq, time, data}`（DH `SessionEvent` 原样）；断线后带最后的 `seq` 续传 |
| 运行状态与预算（B3） | 同一事件流中的 `status` 消息，或 `GET …/{id}/status` | `{running, budget: {usedYuan, softYuan, hardYuan, elapsedMinutes}}` |
| 发送（B2） | `POST …/{id}/messages` | `{requestId, text, materials: [{materialId, versionId}]}` |
| 停止本轮（B2） | `POST …/{id}/turn/stop` | `{requestId}`（区别于现有“停止整个会话”的 `/stop`） |
| 回答提问（B2） | `POST …/{id}/questions/{callId}/answer` | `{requestId, answers: [{id, selected, custom?}]}`，空 `selected` 表示跳过 |
| 审批（B2） | `POST …/{id}/approvals/{approvalId}` | `{requestId, decision: 'ALLOW_ONCE' \| 'REJECT'}` |
| 回复评价（B2） | `POST …/{id}/feedback` | `{requestId, messageKey, value: 'up' \| 'down'}` |

前端在某个接口未提供时，对应按钮保持可见但不可用并说明原因，不模拟成功。

## 附录 C：B1–B3 后端定稿（2026-10-26，#120）

本节覆盖附录 A、B 中的提案差异；上述用户业务决定不变。本轮只实施 B1–B3 的第二节范围与附录 B，B4–B8 未因此完成。主线已合入前端 #139、#141；仍需按本节差异接线验收。实现、启动和验证见[后端记录](../变更记录/2026-10-26-DH原生会话B1-B3.md)。

### B1：持久事件与重连

- `GET …/{id}/events?after=0` 为 SSE。普通事件为 `event: message`，预算状态为 `event: status`；两者的 `data` 都是 `{type, seq, time, data, sessionId?, nativeSeq?, surfaceOp?, sourceEventSeqs?, ignorable?}`。
- `seq` 是平台按会话合并的游标，从 1 开始；根会话、子会话、交互及预算共同排序。原 DH 序号单独放 `nativeSeq`，不能拿子会话自己的序号重连。`time` 保留 DH 毫秒数，平台状态/交互使用 ISO 时间；前端须兼容两种格式。DH 的 `data`、`surfaceOp`、`sourceEventSeqs` 保留；内部 `request/header`、`system/message`、`developer/message` 的 `data` 为 `{redacted:true}`。
- 同时支持 `Last-Event-ID`，取其与 `after` 的较大值；每批最多 200 条，按序补齐。连接 25 秒后结束，由 EventSource 自动重连；每个账号最多 4 条连接。每批读取重新检查企业、本人、空间、既有资料来源与旧会话权限。
- `GET …/{id}/history?after=0&limit=200` 返回 `{items,hasMore}`，上限 500。这是平台数据库冷读取，停止运行环境后仍可读，不会启动模型。已撤权来源使历史也不可读。
- SDK 的 `session.status`、`subagent.started`、`subagent.finished` 独立保留。`session.status.data.status` 为 `running|idle`。
- `dsh-user-questions` 没有附录 A 假定的独立 SessionEvent 类型。保留真实 `tool/call`、`tool/result` 与迟到回答的 `user/message`，另由平台适配提供 `question/asked`（`callId,questions,timed`）、`question/deadline`（`callId,remainingMs,deadline`）、`question/closed`（`callId,outcome`）。`ASK_TIMED_OUT` 表示超时后仍可迟到作答，不代表跳过或批准。计划请求使用 `questions[].intent.kind='plan-review'`。
- 事件先写隔离桥接层持久 outbox，再镜像到平台；按 receipt key 去重。后端读取的是实际接收到的事件，不补造既有独立 Web 会话从未镜像的历史。

### B2：操作与回执

附录 B 的发送、停止、回答、审批路径与请求保留，补充如下：

| 操作 | 定稿 |
|---|---|
| 计划审阅 | `POST …/{id}/plans/{callId}/review`，`{requestId,decision:'APPROVE'|'REVISE',comment?}`；按运行时请求的具名批准选项映射，不能用普通消息冒充批准 |
| 操作成功 | `{accepted:true,messageId?}` 只表示运行时接收；工作是否完成仍看事件和成果回执 |
| 幂等 | requestId 为 UUID，在同一会话全部操作间唯一；同请求回放原回执，不同正文返回 `409 NATIVE_REQUEST_CONFLICT`；派发后超时/断连等不明结果返回 `409 NATIVE_OPERATION_OUTCOME_UNKNOWN`，不自动重派，先核对历史。不能换新 requestId 盲目重试 |
| 引用资料 | materials 最多 20 项；平台核对 materialId/versionId 对应关系及当前阅读权限，记录为后续授权依赖；运行时仍通过企业工具读资料，引用不授予下载权 |
| 回答/审批 | 只允许真实待处理 callId/approvalId；重复已结束交互不再执行。选项按原问题校验；`selected:[]` 且无 custom 才是跳过。审批仅一次允许/拒绝，不改变策略 |
| 评价 | `POST …/{id}/feedback` 同附录 B；messageKey 使用平台 **assistant/message 的 seq 十进制字符串**，不是 SDK 随机消息 ID。写入既有 feedback_entries/feedback_versions，kind=NATIVE，up/down 映射 ACHIEVED/NOT_ACHIEVED；不伪造旧任务。`GET …/{id}/feedback` 读取本会话评价。原任务反馈后续动作不能直接套用于 NATIVE |

SDK 0.2.1-rc.2 原生协议不包含回答/审批/停止方法。适配器使用官方 HarnessClient / HarnessSdkJsonRpcServer，扩展固定 `enterprise/*` 操作，调用同版本 agent.cancel、approval/request 和 userQuestions 服务；没有通用 RPC 透传。SDK profile 默认没有提问工具，适配器显式加载官方 timed ask_user_question。审批策略仍由部署 profile 决定，员工 API 不接受模型、工作目录或权限档位。

### B3：状态与预算

- `GET …/{id}/status` 返回 `{available,state,running?,budget?,executionClass?,seq?,time?,reason?}`；无运行回执时 `available:false, reason:'NO_RUNTIME_RECEIPT'`，不伪造费用 0。最后回执超过 10 秒或会话 STOPPED 时 `available:false`，保留最后观测值供说明，不当作当前状态。
- SSE `status.data` 为 `{running,executionClass,budget}`，桥接层每 2 秒更新。前端也须按 time 检查 10 秒新鲜度，并处理 SSE 断开；不能无限显示最后一次 running 为当前事实。
- `usedYuan` 是已结算费用；`reservedYuan` 包括在途与用量未知的保守预留；`occupiedYuan=usedYuan+reservedYuan` 才用于预算进度。软/硬成本阈值分别为 `softYuan/hardYuan`；日占用及上限为 `dailyUsedYuan/dailyHardYuan`。
- `elapsedMinutes` 为桥接层观测的当前/最近一轮耗时，空闲后冻结；`budgetElapsedMinutes` 为预算台账从首次预留开始的累计墙钟时间，继续会话不重置。时间软/硬上限为 `softMinutes/hardMinutes`。`blocked` 保留台账阻断原因。
- 预算只读取运行容器外的 SQLite 台账；员工和模型不能覆盖状态/预算消息。`executionClass=SYNTHETIC` 的模型不产生供应商账单，不用它证明真实费用结算。
- 当前授权最长 30 分钟，延续既有会话生命周期；自动唤醒与长期租约刷新属于 B4。本轮不自动部署或开启真实收费模型。

**前端接线进度（2026-10-27）**：已按本节接通历史 + 事件流续传、根会话过滤、发送 / 停止本轮 / 回答 / 审批 / 计划审阅 / 评价、question 通知、预算预留与 10 秒新鲜度、评价序号（见[变更记录](../变更记录/2026-10-27-原生会话前端接通B1-B3.md)）。真实 SDK 运行环境下的操作验收待在有容器环境的机器上完成。

### B1/B2 审阅修正（2026-10-27，V179）

冷历史只返回持久会话事件；两秒一次的 status 改为单行最新快照，SSE 按同一平台游标合并最新快照与持久事件。游标允许跳号；不得以连续整数推测丢消息。桥接 outbox 同样只保留最新状态，普通会话事件不丢弃。旧状态由迁移保留最后一份，再清理历史中的 status。

连接建立前可证明未派发（连接拒绝、连接超时或 DNS 失败）返回 `503 NATIVE_RUNTIME_NOT_DISPATCHED`，释放本次登记，允许**同一个 requestId**再试。派发后超时、未知断连、运行时拒绝与没有成功回执的操作仍不自动重派。前端沿已保存的 ID 重试即可，不能因 503 自行换号。
