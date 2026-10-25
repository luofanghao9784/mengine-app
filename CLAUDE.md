# 梦擎工作空间 · AI 协作规则

企业内部 AI 工作台。代码仓库 `dreamcore-workspace/`，另有两份说明文档在上一级目录。

## 必读

| 场景 | 先读 |
|---|---|
| 任何会话开始 | `../续接说明.md`（现状、缺口、路径） |
| 开发流程 | `docs/协作/VIBE-CODING-工作流程.md` |
| 仓库规则 | `AGENTS.md`、`COLLABORATION.md` |
| 业务/架构 | `../梦擎功能全景-非技术版.html`、`../梦擎架构与数据流程.html` |

## 五条硬规则

1. **一次只做一件事。** 多个改动分开做、分开提交。
2. **先读后写。** 不确定现有实现时先看代码，不猜、不臆造接口。
3. **不碰线上。** 服务器 `121.40.44.117` 上任何写操作，必须用户明确说"改服务器"才执行。
4. **密钥不进对话。** 凭据只提路径（`.local/model-private/`、`.local/trial/accounts.json`、SSH 接入包），不输出内容、不写入会提交的文件。
5. **说清验证方式。** 每次改动都要告诉用户"怎么确认它真的生效"。

## 风险分级

- **L0 只读**：随时可做
- **L1 本地改动**：说清目的即可动手，必须本地验证
- **L2 部署**：必须用户明确要求，且先说清回滚方案
- **L3 数据/权限/密钥**：单独确认，先备份

## 两人协作

两位维护者都不写代码、主要靠 AI，**只有当前用户持有线上部署权**。详见 `docs/协作/协同规范.md`。

1. **先认领再动手**：超过"看看代码"的改动，先在 `docs/协作/任务看板.md` 加一行并推送，推送成功才算认领。
2. **不直接推 `main`**：开任务分支（`feat/xxx`、`fix/xxx`），推送后开 PR，由对方合并。
3. **`main` 必须随时能跑**：合并前构建通过 + 关键路径本地验证。
4. **各自独立克隆**，不共用目录、不共用 `.local/`，模型 Key 各人各一把。
5. **部署只由用户本人执行**，AI 不得连接服务器做写操作。

## 常用命令

```bash
# 本地实例（本地 trial，端口 54029）
/Users/luofanghao/Desktop/mengine/run-trial.sh \
  --live --model-config .local/model-private/deepseek.json --phone-local --enable-live

# 构建
npm run build            # 前端 + 类型检查
npm run build:engine     # 引擎
./apps/api/mvnw -B -f apps/api/pom.xml -DskipTests package   # 后端

# 检查
npm test                 # 单元测试
npm run test:api         # 后端集成测试
npm run trial:status     # 本地实例状态
```

工具链在 `../tools/`（JDK 21、Node 24、Python 3.12、PostgreSQL 18）。`node`/`java` 不在系统 PATH，需自行加：

```bash
export PATH="/Users/luofanghao/Desktop/mengine/tools/node-v24.20.0-darwin-arm64/bin:/Users/luofanghao/Desktop/mengine/tools/jdk-21.0.13+9/Contents/Home/bin:$PATH"
```

## 提交

- 一次一件事，类型用 `feat`/`fix`/`docs`/`refactor`/`chore`
- 说明**为什么**改，不只是改了什么
- 不提交 `.local/`、密钥、构建产物
- 单主线 `main`，不并行开 worktree（除非用户明确要求）

## 完成后

在 `docs/变更记录/` 写一条记录（模板 `_模板.md`），涉及现状变化时同步更新 `../续接说明.md`。

## 已知缺口（不要当成 bug 去修）

- 治理版本未接入画报计算（两条平行链）
- 经验库、联网搜索、WeKnora 语义检索默认关闭
- PDF 未嵌入字体的场景可能抽取失败
