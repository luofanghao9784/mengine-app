# 梦擎工作空间

企业 AI 办公系统：员工通过 AI 会话处理工作，在工作空间内共享资料、分析与成果。系统包含客户端、企业管理端、平台总台，以及可独立运行的业务 API、模型引擎和资料解析器。

本 README 维护当前开发与运行入口。更新日期：**2026-10-28**。代码合并、合成验证、本地真实模型运行和生产上线分别记录；仓库更新不代表生产环境已升级。

## 当前能力与边界

| 模块 | 已实现能力 | 使用边界 |
|---|---|---|
| 三端与权限 | 手机号登录、企业及空间管理、资料授权、运行与用量查看 | 企业隔离与内容权限由服务端核验；管理权限不自动等于内容读取权限 |
| AI 会话与成果 | 有依据的资料问答、工作任务、画报、文稿与成果交付 | 真实模型、搜索及可选服务需独立配置；界面可见不等于服务已接通 |
| 数据基座 | 固定来源部署、完整快照采集、逐批接收依据、模型口径标注与语义检查 | 当前版本需模型审阅和程序检查共同通过；来源业务事实与模型判断分开记录 |
| 知识星链 | 汇集数据基座 AI 可用的结构化数据、非结构化资料及共享上传派生知识 | 当前模型审阅、版本与来源权限共同准入；企业背景参考不直接计为已发布知识 |
| 自动分析 | 来源更新触发、稳定口径复用、经营洞察分组后全局综合和受控格式纠正 | 依赖已启用配置、岗位目标及当前有效来源；模型失败保留真实执行状态 |
| DH 原生会话 | 历史与事件续传、发送/停止/回答/审批、资料引用、子任务进展和资料选择器 | 使用独立运行配置；各类后台接口与实际前端接线分别验收，完整范围以交接清单为准 |

近期接续与验收：

- [模型治理与知识来源统一实施](docs/交接/模型治理与知识来源统一实施-2026-10-28.md)

- [采集与知识生成架构修复](docs/技术/采集与知识生成架构修复-实施计划.md)
- [全数据集 AI 经营知识](docs/交接/全数据集AI经营知识-2026-10-27.md)
- [画报与引擎异常恢复](docs/交接/引擎异常核对与画报调用恢复-2026-10-27.md)
- [原生会话前端及后续验收清单](docs/交接/给Codex：原生会话审阅验收与B4-B8.md)
- [正式域名上线交接](docs/交接/ICP备案通过与正式域名上线交接-2026-10-27.md)

模型治理自动调度复用 `AUTOMATIC_DATASET_KNOWLEDGE_TENANTS` 企业许可和 `dreamcore.governance.dispatch-enabled` 调度开关，不会自动扩大到所有企业。失败或结果不明的付费调用需要显式重试。

本地真实数据规模及各次验证结果见对应记录，不把某次快照条数作为系统固定状态。历史阶段说明见 [README 历史快照](docs/归档/README历史快照-2026-10-27.md)、[交接目录](docs/交接/)和[变更记录](docs/变更记录/)。

## 开始开发

先读 [AGENTS.md](AGENTS.md)、[开发启动说明](docs/交接/开发启动说明.md)、[本地启动指南](docs/交接/本地启动指南.md)及[产品需求基线](docs/产品/产品需求基线-V0.1.md)。模型和 Harness 的产品选型与开发代理选型独立。

环境要求：Node.js **24.20.0**（以 [.node-version](.node-version) 为准）、JDK **21**、Python **3.9+**、PostgreSQL **18**。资料解析依赖按解析器说明安装；不同主机的环境路径自行配置。

```bash
git clone https://github.com/dimmm1125-coder/dreamcore-workspace.git
cd dreamcore-workspace
npm run setup:git
npm ci
npm --prefix engine ci
npm run trial:build
```

`trial:build` 构建前端、引擎及 API JAR，不运行后端测试。构建输出分别位于 `dist/`、`engine/dist/`、`apps/api/target/`。已有克隆应先检查工作目录和任务分支，再拉取更新。

## 本地启动

确保 JDK、Node、PostgreSQL 工具在当前终端可用；按[本地启动指南](docs/交接/本地启动指南.md)配置 `JAVA_HOME`、`PATH` 和 `POSTGRES_BIN`。

```bash
# 无云模型：初始化并运行本地三端
npm run trial:start

# 查看状态与停止；停止后保留实例数据
npm run trial:status
npm run trial:stop
```

启动器打印实际端口与私有账号文件位置。使用打印出的地址，三端路径为：

| 入口 | 路径 |
|---|---|
| 客户端 | `/workspace/` |
| 企业管理端 | `/tenant-admin/` |
| 平台总台 | `/platform-admin/` |

根路径及开发预览含历史 Demo，不将其作为真实三端业务验收入口。`npm run dev` 只启动前端开发服务器，完整服务请使用三端启动器。

### 真实模型与可选功能

模型私有配置放在 `.local/model-private/`，文件权限为 `600`。使用自己的凭据和当前克隆的绝对路径；配置格式见[本地启动指南](docs/交接/本地启动指南.md)。

```bash
npm run model:check:local -- --config .local/model-private/deepseek.json
npm run trial:start -- --live --model-config .local/model-private/deepseek.json --phone-local --enable-live
```

`--phone-local` 使用本地手机号验证流程，不发送真实短信；模型配置检查不等于云端调用成功。既有实例继续使用创建时的目录和配置，不能通过另建实例替代原账号和数据。需要后台自动工作时，按实例交接配置 `--automatic-work` 及对应私有开关；不要仅为“打开所有功能”自动启用收费调用或外部采集。

资料解析按 [解析器说明](workers/parser/README.md)准备，可使用 `npm run setup:parser`。数据采集、经营知识、PPT、检索和 DH 等能力有独立前提，按对应交接记录配置；恢复测试备份时不自动重连真实模型或外部来源。

## 验证命令

按改动范围选择检查；测试数据使用隔离环境，不将单项通过表述为全链路或生产验收。

```bash
npm run build                 # 前端类型检查、构建与入口验证
npm test                      # 前端及共享逻辑单测
npm run build:engine          # 引擎构建
npm run test:engine            # 引擎测试及许可证检查
npm run test:api               # 独立 PostgreSQL 中的后端测试与打包
npm run test:contracts         # 契约检查
npm run test:trial-safety      # 本地启动与恢复安全检查
```

沙箱测试需要实际可用的 Python 绝对路径；非默认安装位置可运行 `DREAMCORE_TEST_PYTHON="$(command -v python3)" npm run test:engine`。

浏览器测试按任务选择 `npm run test:e2e` 或专项脚本。首次运行需安装浏览器：`npx playwright install chromium`。专项测试与已知限制记录在 [docs/变更记录](docs/变更记录/)和 [docs/交接](docs/交接/)；真实 SDK、合成模型和真实云模型的证据分别保留。

## 目录与维护入口

| 目录 | 内容 |
|---|---|
| `src/` | React / TypeScript 前端与三端共用组件 |
| `apps/api/` | Spring Boot 业务平台、权限、资料、任务及数据库迁移 |
| `engine/` | 模型、Harness、工具及原生运行时适配 |
| `workers/parser/` | 独立资料解析器 |
| `contracts/` | 跨端与运行时接口契约 |
| `scripts/`、`tests/` | 启动、检查、部署辅助与验证 |
| `docs/产品/`、`docs/技术/` | 需求、架构与开发决策 |
| `docs/交接/`、`docs/变更记录/` | 当前接续、变更与实际验收记录 |
| `.local/` | 被 Git 忽略的本机凭据、数据库、业务资料和验证产物 |

独立美租采集端不属于本仓库，分别维护代码、来源会话、调度和配置；接入契约见[数据基座部署协议](docs/技术/数据基座部署协议与字段解释.md)。官网若位于独立仓库，按其自身规则维护，不加入主仓库。

## 协作与发布

遵循 [协同规范](docs/协作/协同规范.md)：先在 GitHub Issue 认领并指派自己，使用任务分支和 PR；用户明确授权合并时按依赖顺序处理。`main` 保持可构建，合并前检查冲突及相关关键路径，备注实际验证范围。

每位维护者使用独立克隆、独立 `.local/` 和自己的模型凭据。提交前按明确路径暂存，不提交密钥、Cookie、业务原始数据、数据库备份或运行日志。生产上线与回退按独立授权和部署交接执行，代码合并不自动部署。

备份与恢复命令见[本地启动指南](docs/交接/本地启动指南.md)及历史说明；生产恢复需保留新产生的业务数据，不使用旧备份直接覆盖。开发资料与 Obsidian 知识库分开维护。

### 原生会话后端切片验证（B4–B8）

在已安装 engine 依赖的本地开发目录执行：

```sh
npm --prefix engine run test:native
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml -Dtest=NativeMetadataIntegrationTest,NativeSkillsIntegrationTest,NativeAttachmentsIntegrationTest,NativeSchedulesIntegrationTest,NativePluginsIntegrationTest test
```

真实浏览器 + Colima + 合成模型命令与证据见[原生验收记录](docs/变更记录/2026-10-27-原生会话真实SDK浏览器验收.md)。B4 调度在配置 `dreamcore.native.web-url` 后启用；平台必须能执行 Node 与 `engine/scripts/native-schedule-rules.mjs`，可用 `dreamcore.native.schedule-rules` 指定绝对路径。后台只使用当前已配置运行环境；不配置原生环境时不启动模型或调度。B4–B8 新增接口见[清单附录 D–H](docs/技术/DH原生会话前端对齐清单.md)，这些后端接口不等于对应前端已经接线。
