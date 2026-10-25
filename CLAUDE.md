# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

梦擎（DreamCore）是企业内部 AI 工作台：员工上传资料、与 AI 对话、生成画报；企业管理员管人和权限；平台方管企业本身。

## 架构总览

四个运行时进程 + 一套契约，全部在本仓库内：

| 部分 | 位置 | 职责 |
|---|---|---|
| 平台 API | `apps/api`（Spring Boot / Java 21 / Maven） | 身份、权限、业务规则、状态机；唯一能访问数据库的一方 |
| 引擎 | `engine/`（Node 24 / TypeScript） | 任务编排、模型调用、工具循环；**没有数据库账号** |
| 前端 | `src/` + `workspace/` `tenant-admin/` `platform-admin/` `site/`（Vite + React） | 三个入口共用一套构建产物，按路径区分身份域 |
| 解析器 | `workers/parser`（Python，`sandbox-exec` 内运行） | 文档解析与 OCR；只读解析器目录与当次任务目录 |
| 契约 | `contracts/`（OpenAPI + JSON Schema） | 平台↔引擎↔前端的接口事实来源 |

### 两条主链路

**资料接入**（上传 → 可检索）

```
上传 → 对象存储(原件) + material_versions(sha256) → knowledge_runs(PENDING)
     → 后台 worker 领取 → 沙箱解析(parse.py / docling_parse.py)
     → knowledge_chunks(带 locator 出处) → [可选] WeKnora 索引
```

**会话执行**（提问 → 回答）

```
POST /conversations → conversation_tasks(状态机) → AgentTaskService(组装已授权上下文)
  → EngineGateway(HTTP) → engine /internal/v1/agent-results → harness 循环
      ↘ 需要资料时：引擎带任务令牌回调平台 /internal/v1/agent-access/{task}/…
                   平台用授权 SQL 圈出可读分块 → 返回 → 模型继续
  → conversation_tool_receipts(逐次回执) → 回复 + 引用
```

### 平台内部分层

- **两套身份域**：客户域 `/api/v1/auth`、总台域 `/api/platform-admin/v1/auth`，独立 Cookie，互不代入
- **权限在 SQL 里**：`library_mask`、`file_dataset_readable`、`headquarters_permission_actor` 等函数在查询时求值，不在 Java 里做可见性分支
- **状态机**：`conversation_tasks`、`knowledge_runs`、`briefing_generation_batches` 各自有状态与重试；`PARTIAL` 是正常终态
- **幂等**：写接口普遍带 `requestId`，重复提交返回首次结果

### 改代码前必须知道的不变式

1. **可见性由数据库函数决定**，接口层再校验一次；不要在 Java 里另写一套范围判断
2. **引擎不直连数据库**，只能通过 `/internal/v1/agent-access/{task}/…` 回调，令牌绑定单个任务
3. **解析器不可信输入隔离**：禁网、限 CPU/文件大小/输出大小；上传文件永远当可疑物处理
4. **状态以数据库为准**，模型自述"完成"不算；回执与产物哈希才是依据
5. **治理数据集强制固定计划**：画报任务里 `fixedPlanOnly` 为真，只能用 `scene_metrics` 已发布指标的 executionRequest，不能自行改聚合/分组/日期
6. **画报有三道闸**：证据预算（数据集查找 ≤3 次）、数字必须服务端算（`compare_dataset` 产出 `calculationArtifactId` + sha256）、编辑质量校验（不合格直接 422 打回）

### 数据库

- Flyway 迁移在 `apps/api/src/main/resources/db/migration-common/`，**只增不改**；新版本号先到认领 Issue 登记，避免两人撞号
- 集成测试用一次性 PG 集群（`scripts/with-test-postgres.py`），不碰任何已有数据库

## 常用命令

首次本地启动（工具链、构建、模型配置、故障排查）见 **[本地启动指南](docs/交接/本地启动指南.md)**。

```bash
# 构建
npm run build                 # 前端 + tsc 类型检查
npm run build:engine          # 引擎
./apps/api/mvnw -B -f apps/api/pom.xml -DskipTests package    # 后端 jar

# 测试
npm test                      # 前端/脚本单测（node --test）
npm run test:contracts        # 契约测试
npm run test:engine           # 引擎测试
npm run test:api              # 后端全部测试（自带一次性 PG）

# 单个后端测试（同样走一次性 PG）
export POSTGRES_BIN=/path/to/postgresql-18/bin
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml test -Dtest=ClassName

# 本地实例（端口 54029；工作区根目录另有 run-trial.sh 打包了同样参数）
export JAVA_HOME=/path/to/jdk-21
export PATH="$JAVA_HOME/bin:/path/to/node-24/bin:$PATH"
export POSTGRES_BIN=/path/to/postgresql-18/bin
npm run trial:start -- --live --model-config .local/model-private/deepseek.json --phone-local --enable-live
npm run trial:status

# 模型连通性自检（会产生一次真实调用）
npm run model:smoke -- --config .local/model-private/deepseek.json
```

工具链不在仓库内；没有时按启动指南自行准备。

## 协作规则

两位维护者都不写代码、主要靠 AI，部署权只在 `luofanghao9784` 一方。

- **权威规则**：[docs/协作/协同规范.md](docs/协作/协同规范.md)（`AGENTS.md` 给 Codex、`CLAUDE.md` 给 Claude Code，三处需同步）
- **认领**：先到 GitHub Issues 搜重，再开「认领：<任务>」Issue 并指派自己，开出才算认领
- **不直接推 `main`**：开任务分支 → PR（链上 Issue）→ 对方审阅后合并 → 关 Issue、删分支
- **`main` 必须随时能跑**：合并前构建通过 + 关键路径本地验证
- **生产只读可、写不可**：部署、改配置、改数据、重启服务只由部署负责人执行；只读核验需先获授权，且不输出凭据内容
- **密钥不进对话**：只提路径（`.local/model-private/`、`.local/trial/accounts.json`、SSH 接入包），不写入会提交的文件
- **一次只做一件事**，完成后在 `docs/变更记录/` 写一条（模板 `_模板.md`）

## 容易踩的坑

- `npm run build` 会跑 `tsc --noEmit`，前端类型错误会直接挡住构建；构建后还有 `verify-built-entries.mjs` 检查产物入口
- 后端测试必须走 `with-test-postgres.py`，直接 `mvn test` 没有 `DATABASE_URL` 会失败
- 本地 `.local/` 全是私有运行数据与密钥，已被 `.gitignore` 覆盖；提交前确认 `git status` 里没有它
- 端口：首次启动时自动分配并写入 `.local/trial/config.json`（本机当前 Web 54029 / API 54028 / DB 54027），重启不变；**引擎端口每次启动随机**
- PDF 未嵌入字体时可能抽不出文字；docling 单页约 13 秒，沙箱单次解析上限 75 秒
