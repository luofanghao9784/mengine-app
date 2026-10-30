# 梦擎 Codex 执行单（docs/codex-tasks）

> 本目录是给老板在 OpenAI Codex 里自己跑业务代码修复用的「执行单」。一单 = 一个 PR。组内成员只写执行单，不直接改业务代码。
> 执行单写好直接交老板执行，不等专家预审；审查放在老板开出 PR 之后（单审）。
> 代码行号基准：`origin/main` = `a2a41d5`（2026-10-30 核对）。main 前进后行号可能偏移，Codex 提示词里同时给了方法名/代码片段，以片段为准。

## 1. 总索引

| 编号 | 标题 | 对应 PR/问题 | 审查人（PR 后单审） | 状态 | 依赖顺序 |
|---|---|---|---|---|---|
| CT-000 | [PR #7 补 build:engine 步骤](CT-000-pr7-build-engine-workflow.md) | PR #7（workflow，老板账号推，因组内令牌无 workflow 权限） | 测试审查（CI 门禁） | 待执行 | 第 1 |
| CT-004 | [PR #7 API·Postgres 作业分 4 片 + 上传 surefire 报告](CT-004-pr7-api-shards-surefire-upload.md) | PR #7 整套 90 分钟超时、无报告产物（workflow，老板账号推） | 测试审查 | 待执行 | 第 2 |
| CT-005 | [Mac 本机预览脚本 + smoke workflow + 账号种子](CT-005-mac-preview.md) | Mac 预览首版（DQ 裁定 v0.2；workflow 老板推） | 安全审查（涉及密钥/认证） | 待执行 | CT-004 合入后 |
| CT-001 | [简报生成：全部来源未就绪时写回具体等待原因（#230 回归，:340）](CT-001-pr7-native-continuity-340-fix.md) | #230（3a29ed3）回归 | 架构逻辑 | 待执行 | 第 3（与 CT-002 可并行） |
| CT-002 | [生命周期时间戳对齐 Postgres 微秒精度](CT-002-api-lifecycle-micros-truncation.md) | ProfileMethodLifecycle 3 例 + FeedbackAdjustment 1 例 | 测试审查 | 待执行 | 第 3（与 CT-001 可并行） |
| CT-003 | [NativeAutomaticContinuity 测试契约按 #208 修订（只改测试）](CT-003-native-continuity-208-test-contract.md) | #208（865ccdc）漏改测试 | 测试审查 | 待执行 | 第 6（#7 合入后） |

### 1.1 执行顺序（已定；全程不用 force push）
1. **CT-000**：推到 #7 分支，补 build:engine。
2. **CT-004**：紧接着推到 #7 分支，分 4 片并上传 surefire 报告（不调大超时）。
3. **CT-001、CT-002**：各自从 main 切分支、开 PR、单审后合入 main。验收用「老板 Mac 本地绿 + 附 surefire 报告」，因为 main 上还没有 API CI。
4. **#7 同步 main**：首选 PR #7 页面底部的 **Update branch** 按钮，点旁边下拉箭头选 **Update with merge commit**，**不要选 Update with rebase**（rebase 会改写分支历史）。命令行备选：
   ```bash
   cd ~/dreamcore-workspace && git status
   git fetch origin && git switch cursor/api-postgres-gate-1c11 && git pull
   git merge origin/main
   git push
   ```
   （`git merge` 若报 CONFLICT：停下发 DQ。）
5. **#7 带已知红合入**：只剩 1.2 节的已知红时合入。该 workflow **暂不设为必需检查**，红项清零后再按 CT-004 的 4 个分片检查名设置。
6. **CT-003**：#7 合入后从最新 main 切；PR 自带 API CI，在 Actions 上验证「连续两次绿」。

### 1.2 已知红（#7 合入时允许存在）
详见 #7 描述「已知红」一节：https://github.com/luofanghao9784/dreamcore-workspace/pull/7
- CrossWorkspaceBriefing：选中的数据集 ID 不一致。
- WeKnora：KNOWLEDGE_INDEX_NOT_READY。
- LiveAnswer：SSE 用例 15s 超时。
- 另：GeneralExperienceTaskContext 的 TASK_ACCESS_DENIED 是**本地现象，待查**，不算已知红；在 CI 上出现时报 DQ。
- NativeAutomaticContinuity 5 例在 CT-003 合入前保持红，属于计划内。
- 仓库目前未开启 Issues，所以以上各项暂记在 #7 描述里；Issues 开启后再逐条转成 issue。
- **循环问题（已定）**：选方案 (a)。#7 带上述已知红合入，workflow 暂不设为必需检查，CT-003 在 #7 合入后到 CI 上验收。


### 1.3 部署预览
| 编号 | 说明 |
|---|---|
| CT-005 | 老板 Mac（Apple Silicon /opt/homebrew）本机预览脚本、`trial.py --parser`、账号种子；`macos-preview-smoke.yml` **由老板账号推**（Codex 不推 workflow）。依赖：CT-004 已合入。审查：安全审查。 |

## 2. 状态取值
`待执行`（已交老板）→ `执行中`（老板在跑 Codex）→ `PR 已开`（写上 PR 号）→ `已合入` ；异常：`卡住`（已把输出发 DQ）、`待定`（有外部阻塞，写明原因）、`作废`。

## 3. 审查流程（单审，老板降档令）
写执行单 → 直接交老板 → 老板跑 Codex（CT-000 不用）→ 老板本地测试 → 老板开 PR → **单审人**审查 → 合入 → 本索引更新状态。
- 每个 PR 只有一位最对口的审查人，写在各单抬头「审查人」栏，指老板开 PR 后的单审人。
- 安全审查只在改动涉及认证、租户隔离、密钥、执行端口时介入；CT-000～CT-004 都不涉及。**CT-005 涉及密钥/认证，PR 后由安全审查单审。**
- 只拦 P0（会造成错误结果、数据损坏、安全问题或违反执行单硬约束）；P1/P2 记待办，不挡合入。
- 能交给 CI 自动检查的不靠人审。

## 4. 命名规则
`CT-NNN-<英文短名>.md`：NNN 三位递增编号，永不复用；英文短名用小写加连字符，说明改什么。分支名统一 `codex/ct-NNN-<英文短名>`。

## 5. 每份执行单的固定格式（七节，缺一不可）
1. **目标与范围**：要修什么、改哪些文件、**不做什么**。
0. **抬头**：状态、分支、审查人（一位，PR 后单审）。
2. **前置条件与分支名**：依赖哪单先合；完整 git 步骤（见下方「固定 git 步骤」）。
3. **完整 Codex 提示词**：一个代码块，可整段粘贴；含背景根因、文件与行号、修法、专家约束、**不许碰的文件清单**、验收标准、必跑测试命令、禁止事项（skip/@Disabled/放宽断言/调大超时）、做完输出什么。
4. **推荐模型与思考强度**（low/medium/high）并说明理由。
5. **预计耗时**（Codex 运行 + 本地测试）。
6. **跑完如何提交**：测试命令与通过样子、git add/commit（确切信息）、push、`gh pr create` 完整命令、网页备用链接、PR 描述模板。
7. **失败/卡住时怎么办**：症状 → 动作；何时停下把哪些输出发给 DQ。

### 固定 git 步骤（每单照此写，替换 `<分支名>`）
```bash
# ① 进仓库
cd ~/dreamcore-workspace
# ② 确认干净：应看到 "nothing to commit, working tree clean"
git status
# ③ 回到 main 并更新
git switch main && git pull
# ④ 新建分支
git switch -c <分支名>
# ⑤ （Codex 跑完后）本地测试，见各单
# ⑥ 提交
git add apps/api
git commit -m "<确切 commit 信息>"
# ⑦ 推送
git push -u origin <分支名>
# ⑧ 开 PR（或网页：https://github.com/luofanghao9784/dreamcore-workspace/compare/main...<分支名>）
gh pr create --base main --head <分支名> --title "<标题>" --body-file /tmp/<编号>-pr.md
```
⑨ 常见出错：
- `git status` 显示有改动（`Changes not staged…` / `Untracked files…`）：先 `git stash push -u -m "ct-before"` 暂存，做完本单后回到原分支 `git stash pop` 取回。
- `git pull` 或 `git stash pop` 报 `CONFLICT`：不要自己解，执行 `git status` 截图/复制输出发给 DQ，停下。
- `git push` 被拒（`rejected` / `non-fast-forward`）：执行一次 `git pull --rebase`，再 `git push`；若仍失败或出现冲突，把报错原文发给 DQ，停下。
- **永远禁止**：`git push --force` / `-f` / `--force-with-lease`、`git reset --hard`、直接推 main。

## 6. 一次性通用准备（macOS，只做一次）

> Codex 相关内容来源：OpenAI 官方 Codex CLI 文档 <https://developers.openai.com/codex/cli>、模型页 <https://developers.openai.com/codex/models>（2026-10-30 查阅）。页面未写明的细节一律「以官方文档为准」。

### 6.1 安装工具
```bash
# Homebrew（若已有可跳过；以 https://brew.sh 官方为准）
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
# git、GitHub 命令行、Python3
brew install git gh python@3.12
# JDK 21（Temurin）
brew install --cask temurin@21
# PostgreSQL 18（测试脚本只需要它的 initdb/pg_ctl/psql 程序，不需要常驻服务）
brew install postgresql@18
# Codex CLI（官方安装脚本，同一命令也用于升级）
curl -fsSL https://chatgpt.com/codex/install.sh | sh
```
官方也提供 npm / Homebrew 安装方式，具体命令以官方文档为准。

### 6.2 登录
```bash
gh auth login          # 选 GitHub.com → HTTPS → 浏览器登录
codex                  # 首次运行选 "Sign in with ChatGPT"，登录后输入 /exit 退出
```

### 6.3 克隆仓库
```bash
cd ~ && git clone https://github.com/luofanghao9784/dreamcore-workspace.git
cd ~/dreamcore-workspace && git status
```

### 6.4 测试环境变量（每次开新终端都要执行，或写入 ~/.zshrc）
```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export POSTGRES_BIN="$(brew --prefix postgresql@18)/bin"
java -version          # 应显示 openjdk version "21...
"$POSTGRES_BIN/postgres" --version   # 应显示 postgres (PostgreSQL) 18.x
```
验证测试环境（随便跑一个小测试类，约 1–2 分钟）：
```bash
cd ~/dreamcore-workspace
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml -Dtest=FoundationModelReviewProjectionTest test
```
最后应看到 `Tests run: 8, Failures: 0, Errors: 0, Skipped: 0` 和 `BUILD SUCCESS`。
若报 `Missing initdb; install PostgreSQL 18 and set POSTGRES_BIN if needed.`：重新执行 6.4 的 export。

### 6.5 Codex 使用方式（三种任选）
- **交互式（推荐）**：在仓库目录执行 `codex -m <模型名>`，进入后输入 `/model` 可选模型与推理强度（low/medium/high 等），然后粘贴执行单第 ③ 节提示词。`/permissions` 可设置是否允许 Codex 自动运行命令；建议允许在仓库内编辑和运行测试命令。
- **非交互**：`codex exec -m <模型名> "$(cat 提示词文件)"`（官方文档有 `codex exec` 用法）；推理强度在 `~/.codex/config.toml` 配置，键名以官方文档为准（常见写法 `model_reasoning_effort = "high"`，未在上述页面核实）。
- **替代路径**：本机装不了 JDK/Postgres 时，可让 Codex 只改代码不跑测试，推分支开 PR 后由 GitHub Actions 验证——但目前 main 上**没有**跑 API 测试的 workflow（`api-postgres-gate.yml` 只在 PR #7 上），所以这条路暂时拿不到测试结果，需先告知 DQ。Codex 云端任务（Codex cloud）也可用，环境配置以官方文档为准，云端需能装 JDK21 与 Postgres18。

模型名：官方模型页当前列出 `gpt-6.1-sol`（Plus/Pro 等计划的推荐默认）、`astra`系列（最难任务）、`gpt-6.1-terra`、`gpt-6-luna`。可用模型取决于账号计划，以 `/model` 里实际看到的为准。
