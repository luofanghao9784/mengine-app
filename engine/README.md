# 梦核引擎工程基线

本目录独立安装、构建和运行，不导入平台源码或访问业务数据库。当前 HTTP 服务 `0.11.0` 提供本地来源适配，以及显式配置后可用的 Agent 任务与百炼/DeepSeek 独立模型适配。Harness 已与平台/网页任务合成联调；真实云模型与自进化算法仍未验收。

使用 `.node-version` 对应的 Node 24.20.0，在本目录执行：

```bash
npm ci --ignore-scripts
npm run build
npm test
npm start
```

默认监听 `127.0.0.1:18182`，可设置 `ENGINE_HOST` 和 `ENGINE_PORT`；退出处理 SIGINT/SIGTERM。HTTP 入口需要安装锁定的 Node 生产依赖，本地执行后端还需 macOS、Python 3、系统 `sandbox-exec` / `otool`。打包时须保留 `workers/` 和第三方许可。

- `GET /healthz`：进程存活。
- `GET /internal/v1/capabilities`：返回协议 `1.0` 与引擎版本；没有至少 32 字符 `TASK_ENGINE_TOKEN` 时，仍为 `contract-only` 和空能力列表。
- 配置密钥后声明 `local-retrieval / source-lookup`。`POST /internal/v1/source-results` 需要同一 Bearer 密钥，最多 8 KiB 请求，接收 taskId/attemptId 与至多 10 个来源 ID；只原样返回来源和确定性的结果代码，不生成回答。
- 未实现的 GET 返回 404，其他操作返回 405。新模式的授权、错误格式与结果归属均有自动检查。

平台需显式启用 `TASK_ENABLED=true` 并配置同一密钥及 `ENGINE_BASE_URL`。本地三端启动器自动为所属进程创建随机密钥与独立端口；无需把密钥写入仓库或文档。

## Harness 与工具环境原型

`src/runtime/ports.ts` 定义本项目的模型、工具和结果类型，`harness.ts` 显式装配真实 `@deepseek-ai/dsh-*` 核心包 `0.1.5-rc.2` 及 Cordis `4.0.2`。不加载 `sdk-minimal` 默认配置、CLI、用户目录插件、Shell、自动重试或 JSONL 持久化。

- `runHarness` 每次创建独立上下文，只注册本任务授予的工具，限制模型调用次数、工具次数、输出和总时间。未提供 `ModelPort` 直接返回配置错误，没有默认模型、API Key 或测试回复回退。当前模型端口仅覆盖文本及工具循环，DeepSeek 非流式非 thinking 适配及可为空的 token 用量已实现；token 流与推理内容回放待完成。
- `createTaskTools` 只接受调用方已授权的文件副本；`read_input` 按句柄读取，明确允许代码执行时才加入 `run_javascript`。没有权限查询、数据库连接、安装包、联网或发布成果工具。`AgentTasks` 通过平台回调落实逐步授权、运行中检查及取消传播。
- `LocalNodeSandbox` 是 macOS 本地验证后端，单任务私有目录、输入只读、输出独立、OS 默认拒绝网络和其他数据目录，清空继承环境；取消/超时杀死实际进程组后清理临时目录。没有沙箱时拒绝执行。不是云端生产隔离方案，也没有提供总内存/总磁盘硬配额。
- 结果来自实际工具执行，带文件内容和 SHA-256。模型完成一轮不代表业务任务完成；平台已处理小产物私有保存和来源验证，正式成果编辑、共享和发布后续实现。

在 macOS 上复验（默认测试 Python 为 `/opt/homebrew/bin/python3`，可用 `DREAMCORE_TEST_PYTHON` 指定绝对路径）：

```bash
npm ci --ignore-scripts
npm run test:runtime
npm run licenses:check
```

测试模型仅定义于 `tests/`，用固定脚本指令验证真实 Harness 调度、工具结果、取消和隔离；不访问云模型、不产生模型费用，也不证明模型理解能力。其他操作系统跳过 macOS 执行检查，不视为已验证当地隔离能力。

依赖完整版本及完整性摘要见 `package-lock.json`；18 个 Harness 包通过 overrides 固定为同一版本，避免 npm 预发布依赖混装；许可全文见 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md)。升级后执行 `npm run licenses:write` 并重验同一组任务。

具体证据及后续接入关口见 [Harness 与沙箱验证](../docs/交接/M4-A1-Harness与隔离执行验证-2026-09-23.md)。现有公开能力仍遵守 [版本化协议](../contracts/engine-api/source-results.schema.json)，平台保持任务、权限和数据所有权。

## Agent HTTP 与配置

`POST /internal/v1/agent-results` 使用共享服务密钥，接收 taskId/attemptId/prompt，按[Agent 协议](../contracts/engine-api/agent-results.schema.json)返回经过实际执行的结果。未配置返回 MODEL_NOT_CONFIGURED，不回退测试回答。`AGENT_MODEL_PROVIDER=off` 默认；配置 `bailian` 时需北京业务空间 ID、已适配模型快照和 API Key，配置 `deepseek` 时需明确模型与 API Key；两者均需平台可信地址，参考 [.env.example](.env.example)。平台另需 `AGENT_TASK_MODE=live`。不应在未确认资料范围与额度前开启。

当前正式入口开放资料检索与可信能力发现/启用；按任务明确公开输入和配置可开放公开搜索/阅读；本地测试构造器可开放沙箱，但 live 类别拒绝代码工具配置。能力接口新增 agent-live/agent-verification、source-lookup/agent-task；configured 不是云模型已验收。当前通过 taskBootstrap 提供最小上下文，并可按需调用 task_context(history) 读取权限内的有界私人会话历史；不一次性注入全部历史。

仓库根 `npm run test:agent` 验证完整浏览器链路；`npm test` 验证引擎 HTTP、模型响应、取消和 sandbox。实际来源、限制和升级边界见[技术记录](../docs/技术/M4-A1模型网关与平台Agent边界.md)。

## 可信能力与公开网页

`catalog/` 的自有指南及 manifest 随引擎发布，版本与 SHA 固定；不从任务或用户目录安装代码。`AGENT_PUBLIC_WEB_ENABLED=false` 默认；设为 true 后才可按平台任务授权使用公开工具。`AGENT_SEARCH_ENDPOINT` 可指定已配置且启用 JSON 的 HTTPS SearXNG `/search`，未配置时只支持用户指定的公开 HTTPS 网址。无模型配置仍不会运行 Agent。引擎和平台均需开启，环境示例不会自动加载。

HTTP Agent 协议现为 1.4（第八切片）；来源检索协议仍 1.0。能力包版本可在既有契约内独立更新。目录、网络边界、升级顺序和剩余候选安装见[第四切片边界](../docs/技术/M4-A1可信目录与公开检索边界.md)。

## 候选工具与 Linux 验证后端

第五切片加入小型 npm 候选包准入、离线试验和当前任务复用，详见[候选边界](../docs/技术/M4-A1候选工具隔离试验边界.md)。第六切片以 `DockerSandbox` 实现同一 `PackageSandbox`，支持专用 Linux rootless Docker，不要求前端或平台换接口；报告按实际后端标记隔离类型。

构建镜像及环境配置见[Linux 运行说明](../docs/技术/M4-A1-Linux隔离执行与回收边界.md)。在本目录执行 `npm run test:executor` 是显式真实环境检查，包含约一分钟的崩溃回收等待；默认 `npm test` 无需 Docker，使用受控 Unix socket 夹具检查 Docker 配置与失败边界，同时保留既有 macOS 验证。根目录 `npm run test:agent` 在配置 Linux 执行器后跑完整网页链路。

独立回收命令 `node scripts/reap-executions.mjs --watch` 必须使用与被服务执行器一致的 socket/scope；`--once` 供单次维护。不可作为随引擎一起退出的子进程。Linux 后端仍只开放验证注入，正式入口未开放 live 代码执行；不把普通 OCI 容器视为完成云端多租户安全验收。

## 任务选定原件（第七切片）

`list_originals` / `read_original` 通过平台尝试凭证获取用户明确选定的历史版本；模型只得到元信息与输入句柄。`run_javascript.inputHandles` 显式选择已加载输入，省略时仍仅处理检索片段。选定原件后 search_sources 也只检索这些确切版本；候选 INI 配方仍保持原片段范围。没有存储路径或数据库访问权限，取消/撤权沿既有授权检查中断执行。

验证默认最多 3 份原件，单份 256 KiB / 总共 512 KiB；原预算各 8 次模型/工具、25 秒不变。正式入口仍不启用原件/代码执行。传输二进制字节不等于已支持所有格式，输出正文仍可能进入模型上下文。Agent 1.3 强制返回 originalIds，必须与平台读取事实一致；平台需升级 V10 和对应服务。独立升级与回退边界见[技术说明](../docs/技术/M4-A1原件授权与版本边界.md)。`npm test` 含原件校验与撤权测试，根 `npm run test:agent` 含完整 CSV 浏览器链路，本批实测执行后端为 macOS。

## 完整文件处理配方（第八切片）

file-processing 1.0.0 激活后开放 process_original，使用已读取原件的 versionId 和受限参数，在同一 TaskSandbox 执行内置 CSV 统计/文稿提取。实际结果与处理报告保持私人，失败代码经平台白名单传至页面。Agent 1.4 新增该工具回执；原件回调仍 1.3。限制、升级及格式边界见[技术说明](../docs/技术/M4-A1完整文件处理配方边界.md)，不新增依赖或放开正式代码执行。


## Excel 统计成果（M6-A1）

file-processing 1.1.0 的 csv_summary 在相同 TaskSandbox 生成 XLSX 汇总/来源口径，同时保留 JSON 与处理报告。发布内置的模块作为只读输入导入，无运行依赖新增。完整文件留在内部产物回执，modelOutput 将 CSV 配方的计算摘要和文件元信息送入模型，文本提取保持原有行为。引擎 0.9.0，Agent 1.4 和公开业务协议不变；旧平台可按既有产物接口下载，独立升级边界见[技术说明](../docs/技术/M6-A1Excel统计成果边界.md)。

`npm run test:engine` 包含标准 ZIP/XML 读取验证（需要 Python 3）及真实 macOS 沙箱测试；根目录 `npm run test:agent` 覆盖完整网页下载。检查记录见[交接](../docs/交接/M6-A1Excel统计成果验证-2026-09-24.md)，本次未重新运行 Linux 实机。

## 百炼适配（第九切片）

`AGENT_MODEL_PROVIDER=bailian` 明确选择北京专属空间；`AGENT_BAILIAN_WORKSPACE_ID` 不接受任意 URL，`AGENT_MODEL_NAME` 使用经过适配的固定快照。默认仍 off。共同消息校验与各自地址/模式分离，禁止自动 fallback。根目录 `npm run model:check` 不发请求，仅检查配置，退出码 0/1/2 分别为配置合法/关闭/配置不合法，不代表 Key 可用。具体步骤见[首轮验收](../docs/交接/百炼接入准备与首轮验收.md)。

M7-A1 第七切片：平台回调升级 1.4，Agent 1.4 不变。模型调用前必须在平台登记，取消后仅有界补报用量元数据；新引擎必须搭配 V15 平台，平台保留旧引擎 1.3 回调兼容并标明未计量。见[计量与限制](../docs/技术/M7-A1模型尝试计量与执行限制.md)。

## 本机真实模型配置入口（2026-10-01）

本项目已提供 `npm run model:configure`（隐藏输入）、`npm run model:check:local`（零请求）、`npm run model:smoke`（一次64输出token上限的合成内容真实请求）及 `npm run trial:start:live`。smoke 可加 `-- --tools` 验证两轮工具回放，失败不重试。启动使用本工作树私有配置；普通试用仍默认 off。专用Key尚未准备，云端真实验收未完成，详见[配置与验收指南](../docs/交接/真实模型本机验收-2026-10-01.md)。


## 经验提炼与自动核验（B4 内部协议 1.0）

可选 `/internal/v1/experience/runtime` 与 `/internal/v1/experience/results` 使用同一服务间认证及编译固定的引擎版本。POST 接收最多 8 段固定输入（每段 8000 字符、标明是否完整）、最多 5 个获权的现有经验版本及部署侧提供的敏感值。GET `/results/{run}/{lease}` 恢复原回执，DELETE 取消该次执行。没有客户直接调用接口、来源授权工具、网络/命令执行或发布工具。完整格式见[内部契约](../contracts/engine-api/experience-analysis.schema.json)。

每次最多提炼一个方法或正常跳过，随后用新模型实例和新 Harness 会话重新读取原始依据、现有经验及候选。两阶段各最多 6 次模型调用、16 次工具调用、45 秒；每实例最多 2 个经验任务并发。两个会话使用同一配置的模型，独立指上下文和调用分开，不声称是两个不同供应商或独立客观效果评测。检查来源支持、复用价值、适用边界、隐私和新增价值；未知或不通过不得返回可用候选。用户评分、模型回复和任务成功状态不能直接证明业务正确性。执行依据需要实际执行记录，反馈纠正还须关联被纠正的内容。

候选的可展示字段另有敏感值和常见标识符检查，处理 Unicode 宽字符及常见零宽混淆；这是附加围栏，不把正则表达式或一次模型判断等同于完整脱敏保证。原文引用只作为内部依据，**不得把整个回执转发给企业/总台页面或通用经验库**。QUALIFIED 仅表示本次自动检查通过，`admitted` 恒为 false；平台必须再查当前授权、来源版本、执行类别和现有经验冲突，实际准入另行提交。

SKIPPED、REJECTED 与 FAILED/CANCELLED 分开，均不返回候选正文；没有待人工审核状态。真实用量按两个阶段记录，未知 token 保持 null。相同 run/lease 的输入变化拒绝；并发重放共用同一次执行。完成回执在内存保留 10 分钟，进程重启会丢失，平台只能查询原回执，不能因此重新执行未知请求。平台已接入默认关闭的持久派发器（`EXPERIENCE_ANALYSIS_ENABLED=false`）；引擎运行时本身不会扫描来源，只有平台显式派发才会调用模型。自动准入与页面仍在后续实施。

本地验证使用实际 Harness 和合成 ModelPort，未调用真实提供商，不证明真实提炼/脱敏质量：

```bash
npm --prefix engine test
./apps/api/mvnw -f apps/api/pom.xml -q -Dtest=ExperienceAnalysisRuntimeTest,ExperienceAnalysisHarnessIT test
npm run test:contracts
```

## 通用经验清洗与独立核验（B4 内部协议 1.0，工程准备）

引擎 `0.17.0` 新增可选 `/internal/v1/experience-generalization/runtime`、POST `/results` 及 GET/DELETE `/results/{run}/{lease}`，复用服务间认证和编译版本围栏。输入限定为一个获权、固定版本的已核验方法及敏感值列表，不接受原任务、完整会话、附件或来源链接字段。具体结构见[契约](../contracts/engine-api/experience-generalization.schema.json)。平台派发器已按实际来源、权限和原核验账本执行检查；总库页面及任务按需检索采用已接通；采用记录不代表业务效果已获证明。

CLEAN 提炼清洗，PRIVACY 以新 Harness 会话对照原方法与清洗结果，QUALITY 再以新会话只读取清洗后的方法。第三阶段没有原文读取工具，上下文不含企业/来源标识、敏感值列表或前两阶段历史。每阶段最多 6 次模型、12 次工具、45 秒；该运行时最多 2 个并行任务。三个会话使用同一配置的模型，不声称供应商独立或客观业务评测。

所有文本字段须通过已知敏感值和常见标识符检查；隐私检查另覆盖组合识别、来源支持、必要条件保留和依据性质，通用质量检查覆盖复用性、边界、清晰度、依据诚实性和可识别细节。不明或失败不形成可用方法。不能保留意义的私有经验正常跳过，不转成人工审核。

仅 QUALIFIED 回执包含清洗后的 `method`，其他结果不含方法正文；检查只返回有限枚举，不返回原文引用、自由文本评价或来源详细信息。回执本身仍含内部运行身份，**不得整包展示或存入公开总库**。平台必须复核当前来源/权限、live 证据性质和版本冲突后再准入，`admitted` 始终 false。使用默认模型配置不会主动扫描或自动发送任务；平台已接通持久队列、自动总库准入与来源撤回；检索采用与两端页面尚待接通。

每次 run/lease 固定输入，相同请求复用同次执行，变更输入拒绝；已完成回执保留 10 分钟，未知只查询不重放。新 Java 运行时校验三阶段与全部检查、身份/版本、原依据类型、额外私有字段及敏感值。真实用量缺失保持 null。`npm run test:engine` 和 `./apps/api/mvnw -f apps/api/pom.xml -q -Dtest=ExperienceGeneralizationRuntimeTest,ExperienceAnalysisRuntimeTest test` 覆盖合成实际 Harness 与真实本机 HTTP。没有付费模型调用；正则与合成检查不等于真实隐私/质量验收。


通用贡献工作线程默认由 `EXPERIENCE_GENERALIZATION_ENABLED=false` 关闭；与企业内部积累开关分开。来源必须具备记录下来的自动核验依据类别和步骤结构，旧版本缺失时不猜测回填。原方法固定输入只在执行时按权限重建；持久账本保存身份、摘要与清洗结果，准入/失效后清除暂存结果。来源撤回、私有资格、资料回收与离职等会清除总库派生正文，恢复原权限不复活旧贡献。平台传输与数据库联调见[五批记录](../docs/交接/管理端五批实施记录-2026-10-04.md)。


### 通用经验任务上下文（0.18.0）

平台 `/check` 显式提供 `generalExperienceVersion=1.0` 且上下文桥可用时，1.5 任务才得到 `general_experience_search/read/use` 动作；旧平台和 1.4 任务不增加入口。任务规则升为 1.4.0。检索仍为按需选择，无匹配不阻止独立工作。

- 检索只返回清洗方法的三条有界摘要，并立即登记确切总库版本依赖。读取每页最多三个完整步骤，以步骤索引 offset/nextOffset 翻页；限制、适用条件和依据性质完整保留，不能据此取得贡献企业资料或工具权限。仅选定文件的任务不开放通用经验。
- 每次回调重新执行原任务授权与当前版本围栏；完整读取全部步骤后才可声明 DIRECT/ADAPTED 采用，调整采用必须提供具体调整说明。模型给出的适用性判断与采用记录属于当前私人任务，业务效果始终 UNKNOWN，不是质量评分、发布或外部业务动作。
- 停用或改版会永久阻断已读取旧版本的当前运行尝试，恢复不重放；已完成历史结果在真实来源有效时保留。来源实际撤回/清理会沿确切版本清理任务及其历史、成果和后续提炼依赖，私有采用说明也被清理。企业来源和内部上送身份不返回给其他企业。
- 新 V75 登记任务读取/采用及围栏。读取与原上下文共用每次尝试 32 个引用、8 次适用性记录上限；同请求键重复返回原记录，内容改变拒绝。当前完成任务消费和依赖传播，企业本地补充/反馈、停用本企业使用及总台维护操作仍需后续接入。
