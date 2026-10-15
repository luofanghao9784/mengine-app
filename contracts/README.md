# 平台、引擎与客户端契约

M1-A1 先实现可实际验证的运行状态契约；不为尚未实现的资料或任务接口伪造成功响应。

| 路径 | 内容 |
| --- | --- |
| `public-api/openapi.json` | OpenAPI 3.1，当前仅平台运行状态及 502/503 错误 |
| `public-api/identity.openapi.json`、`identity.ts`、`platform-admin.ts`、`tenant-admin.ts` | M2-A1 身份/租户、M2-B2 总台与 M2-B3 企业管理、M2-C1 维护授权接口和前端 DTO；Cookie 会话、CSRF、幂等、权限与错误约定 |
| `public-api/material.openapi.json`、`material.ts` | M2-C1 目录、原件上传、不可变版本、资料列表和受控下载；1.1.0 增加文稿发布标记；解析见 knowledge API |
| `public-api/knowledge.openapi.json`、`knowledge.ts` | M3-A1 解析批次、关键词检索和固定引用 |
| `public-api/conversation.openapi.json`、`conversation.ts` | M4-A1 私人会话、本地资料任务、取消/重试与恢复游标 |
| `public-api/document.openapi.json`、`document.ts` | M6-A1 私人文稿、不可变版本、Word/PDF 导出和明确共享发布；1.1.0 |
| `public-api/briefing.openapi.json`、`briefing.ts` | M5-A1 私人会话成果画报、日期回看与持久偏好；1.0.0 |
| `engine-api/agent-results.schema.json`、`original-access.schema.json` | Agent 1.4 任务请求/结果、原件 1.3 元信息及内部读取契约 |
| `engine-api/source-results.schema.json` | 本地引擎来源结果请求/响应，不包含模型生成内容 |
| `public-api/*.schema.json` | 平台响应与错误的 JSON Schema 2020-12 |
| `public-api/system.ts` | 前端类型及运行时检查，不将 TypeScript 类型等同于网络验证 |
| `engine-api/capabilities.schema.json` | 独立引擎版本与能力声明 |
| `fixtures/` | 无企业真实数据的契约样例 |

Schema 的 `https://dreamcore.invalid/…` 是本地登记标识，不是生产域名或需要请求的服务器。校验器预先登记引用，不联网拉取 schema。

`contractVersion=1.0` 表示本次握手约定；`engineVersion` 是独立引擎产物版本。当前允许 `runtimeMode=contract-only` 和空能力列表，或经服务间密钥启用的 `local-retrieval / source-lookup`。未配置组件保持 `not-configured`。Agent 新模式及 Harness 状态见下文；扩展时共同更新契约、适配与测试，再启用新模式。

平台真实连接响应标记 `dataSource=live`；显式 Demo 客户端标记 `demo`。相同结构服务不同开发场景，HTTP 客户端拒绝服务端返回的 Demo 数据。网络失败、非成功状态、格式/版本错误不回退 Demo。运行信息只有配置元信息，不包含企业资料、账号或凭据。

## 下一切片的业务契约要求

身份、租户与可见空间元信息已在 M2-A1 实现，见[平台说明](../apps/api/README.md)。M2-C1 已接原件资料和版本，资料解析、任务等继续按下列要求在对应切片交付：

- 企业、用户、空间身份由服务端校验；空间归属与可读取资料范围分别表达。
- 资料使用稳定 ID 与版本 ID；原件、衍生解析、引用和历史成果保留来源关系，更新不改变旧引用。
- 任务至少携带请求/幂等身份、发起主体、任务目标、授权资料句柄及固定引擎版本；客户端自报 ID 不产生权限。
- 任务接受与成功分开，排队、运行、待补充/确认、取消中、成功/失败/取消须基于真实执行记录；具体状态机在任务切片实现。
- 事件有顺序及恢复游标；取消、重试、版本冲突和撤权有明确结果，重复提交不重复发布。
- 画报返回结构化内容、来源、时间、受众与继续会话入口，页面布局和动画独立于协议。

校验：仓库根执行 `npm run test:contracts`；真实进程与浏览器连通检查按[工程验证记录](../docs/交接/DEV-001工程基线与验证-2026-09-22.md)构建后执行 `npm run test:foundation`。当前已提供经过权限验证的原件、版本、本地解析检索、私人会话与本地任务接口；Harness/本地工具已通过平台 Agent 合成联调；真实云模型仍待验收。

M4-A1 第三切片：会话 OpenAPI 1.1.0 添加 AGENT、执行类别、回复和私有产物；独立 `engine-api/agent-results.schema.json` 定义平台↔引擎任务结果。能力协议增加 agent-verification/agent-live 与 agent-task，运行信息分别标记 verification/configured，未配置保持原值。尝试凭证只经内部请求及固定平台回调传递，不进入公开任务或模型消息。精确生命周期、回调和替换要求见[技术说明](../docs/技术/M4-A1模型网关与平台Agent边界.md)。

M4-A1 第七切片：会话 OpenAPI 1.3.0 增加可选 originals 提交与必需的 Task.originals 元信息；Agent 1.3 增加实际读取 originalIds、list_originals/read_original 回执。内部原件接口只接收 versionId，尝试身份/企业/空间取自平台；读取列表不授予额外访问。Agent 1.2 不再接受，需按[升级说明](../docs/技术/M4-A1原件授权与版本边界.md)配套部署。来源/能力 1.0 保持不变。

M4-A1 第八切片：Agent 协议升级 1.4，新增 process_original 回执，平台核对验证环境、已激活能力和原件读取事实。原件回调 1.3、公开会话 API 1.3.0 不变。受限配方错误代码沿现有任务 errorCode 返回，详见[边界](../docs/技术/M4-A1完整文件处理配方边界.md)。

M5-A1 首个切片：画报 API 1.0.0、会话 API 1.4.0（成功历史任务定位）和 V11。平台由成功任务生成私人投影，偏好写入保持 CSRF/幂等/乐观版本，读取仍执行当前权限。引擎 0.8.0、Agent 1.4 不变，见[技术边界](../docs/技术/M5-A1会话成果画报边界.md)。

M6-A1 首个切片新增文稿 API 1.0.0 / V12；保存绑定 requestId 和 expectedRevision，重试返回该请求版本。客户端不能传所有者/正文来伪造原回复或解除来源。导出按确切版本授权、校验长度和摘要；已有会话/画报/引擎协议不变，见[文稿边界](../docs/技术/M6-A1个人文稿与导出边界.md)。


M6-A1 第二切片：文稿/资料 API 1.1.0 / V13 增加明确发布、本人发布历史及资料版本 origin。发布生成独立企业副本，写入要求目标维护权与必要来源权，读取按目标空间授权；重复请求返回固定回执，明确更新使用 expectedMaterialVersion。具体去重范围、字段/权限及回退见[共享边界](../docs/技术/M6-A1共享发布与企业版本边界.md)。引擎协议保持不变。


M6-A1 第三切片：引擎 0.9.0 / file-processing 1.1.0 增加 CSV 统计 XLSX 文件；既有 Agent 1.4 产物、公开 API 和 V13 不变。配方报告兼容增加 workbook 摘要，CSV 统计向模型提供计算摘要和产物元信息，平台仍校验完整字节。无需将引擎排版类引入业务平台，见[边界](../docs/技术/M6-A1Excel统计成果边界.md)。


M6-A1 第四切片新增 [企业动态 Activity API 1.0.0](public-api/activity.openapi.json) / [类型](public-api/activity.ts)。数据仅为当前可见共享资料的已提交版本，游标翻页，目标版本下载复用资料 API。无私人会话/来源投影或管理旁路；V14 仅加索引，引擎 0.9.0 / Agent 1.4 不变。见[动态边界](../docs/技术/M6-A1企业动态边界.md)。


M7-A1 第二切片：新增认证 `GET /internal/v1/runtime` / [Runtime 1.0](engine-api/runtime.schema.json)，发布版本与 sourceLookup/agentTask/platformCallbacks 协议独立声明。平台派发前检查实际任务模式并发送 `X-Dreamcore-Engine-Version`，新版引擎执行前检查，平台写回也绑定版本。旧 capability/system-info、Agent 1.4/来源 1.0/回调 1.3 不变。0.9.0 只支持显式、限定版本的过渡映射，不兼容新版声明不回退；详见[升级说明](../docs/技术/M7-A1引擎升级与回退边界.md)。


M7-A1 第三切片新增 [Operations API 1.0.0](public-api/operations.openapi.json) / [类型](public-api/operations.ts)。总台全平台/指定企业和企业管理员本企业均为只读汇总，窗口按任务创建时间选择，状态与存储来自同一查询快照。成功 Agent 回执分 live/verification、显示 Token 覆盖率；失败消耗未完整计量，不用于账单或额度。异常仅固定类型和数量，不投影私人内容、任务/会话/成员标识。业务数据库 V14、引擎/内部任务协议不变，见[边界](../docs/技术/M7-A1运行概览边界.md)。

M7-A1 第七切片：新增 [Model Usage 1.0](engine-api/model-usage.schema.json)，回调声明 1.4，Agent 请求/结果仍 1.4。Operations 1.1.0 必需字段 `attemptUsage` 按尝试开始时间汇总，仅覆盖 V15 新记录，旧 `models` 不相加；平台和管理端配套升级。新平台兼容旧引擎回调 1.3，新引擎拒绝缺失计量握手的旧平台。详见[计量边界](../docs/技术/M7-A1模型尝试计量与执行限制.md)。


企业信息自动整理：`engine-api/company-analysis.schema.json` 定义独立可选 `1.0` 协议的固定任务输入、运行描述及结构化结果；读取与取消回执必须携带服务间认证。模型候选不能直接改写企业信息，由平台按当前权限、固定原文及人工保护核验。`public-api/profile.openapi.json` 1.3.0 增加客户域只读 `/company-information/analysis`，输出当前企业的持久计数和真实完成时间，不返回原始资料或模型内容。部署未启用、未知调用用量及结果不明分别表达，不将其替换为成功或零费用。失败恢复和限制见[五批实施记录](../docs/交接/管理端五批实施记录-2026-10-04.md)。


数据快照比较：可选 `datasetComparisonVersion:1.0` 在已有 `datasetContextVersion:1.0` 基础上启用 `compare_dataset`；[计算契约](engine-api/dataset-comparison.schema.json)规定当前尝试固定快照、实际列名与平台完整十进制结果。调用前须有已授权读取记录。`briefing-delivery` 增加 `briefing-dataset-v1`，必需 `datasetSource` 与 `datasetBasis`，材料来源 `source` 为 null；旧文件/文本卡允许这两个字段缺省或 null。来源行数与比较纳入/排除行数必须相符，采集时间不替代业务覆盖时间。无新迁移，旧平台不声明能力时新引擎隐藏该工具；自动生成的数据库选数不在本切片完成范围。


自动画报来源接续：系统 SELECTED 批次可在 bootstrap 返回 `selectedDatasets`，数据库工具只读取该批固定快照；普通所选文件任务仍拒绝数据库。新快照触发沿既有画报节奏，与取数频率独立。`briefing-text-v1` 的可选 `datasetSource` 现在允许实际已读快照元信息，`datasetBasis` 仍须缺省或 null；文本依据不代表执行汇总计算。原件 DATA 卡继续拒绝数据库来源混用。V67 固定系统选择并覆盖入队前后失效及清理，详见[实施记录](../docs/交接/管理端五批实施记录-2026-10-04.md)。

治理指标执行（2026-10-16）：task_context 的 governedMetrics.items 增加 executionRequest，包含已获权固定快照、metricId/version 及固定 SUMMARY 参数。引擎省略 null 参数后原样调用 compare_dataset，不得自选聚合、分组或日期。治理来源无已发布且人工核实的计划返回 METRIC_DEFINITION_REQUIRED，参数不符返回 METRIC_PLAN_MISMATCH；普通非治理文件不要求指标编号。指标 ID/version 必须成对提供，版本为正整数，计算回执必须回显完全相同请求。DATA 卡片须具备本次任务的指标计算回执。详见 [第三批交接](../docs/交接/治理指标统一执行第三批-2026-10-16.md)。这是后端强制约束，不把模型提供的“已治理”说明视为凭证。
