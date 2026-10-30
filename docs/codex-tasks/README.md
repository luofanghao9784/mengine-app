# 梦擎 Codex 执行单（docs/codex-tasks）

> 本目录是给老板在 OpenAI Codex 里自己跑业务代码修复用的「执行单」。一单 = 一个 PR。组内成员只写执行单，不直接改业务代码。
> 执行单写好直接交老板执行，不等专家预审；审查放在老板开出 PR 之后（**两人审，P0/P1 都拦**，见第 3 节；2026-10-30 起按 CT-007）。
> 待拆队列与**日节奏**见 [`QUEUE.md`](QUEUE.md)（每日目标=Mac 本机可点开增量；今日焦点 **CT-006 → CT-008**；前端日切片优先 **agent-admin 模型能力/Agent 注册**（见 QUEUE））。
> 代码行号基准：`origin/main` = `a2a41d5`（2026-10-30 核对）。main 前进后行号可能偏移，Codex 提示词里同时给了方法名/代码片段，以片段为准。

## 1. 总索引

| 编号 | 标题 | 对应 PR/问题 | 审查人（两人审，2026-10-30 起） | 状态 | 依赖顺序 |
|---|---|---|---|---|---|
| CT-000 | [PR #7 补 build:engine 步骤](CT-000-pr7-build-engine-workflow.md) | PR #7（workflow，老板账号推，因组内令牌无 workflow 权限） | 质量性能 + 架构逻辑 | 已合入（随 #7） | 第 1 |
| CT-004 | [PR #7 API·Postgres 作业分 4 片 + 上传 surefire 报告](CT-004-pr7-api-shards-surefire-upload.md) | PR #7 整套 90 分钟超时、无报告产物（workflow，老板账号推） | 质量性能 + 架构逻辑 | 已合入（随 #7） | 第 2 |
| CT-005 | [Mac 本机预览脚本 + smoke workflow + 账号种子](CT-005-mac-preview.md) | Mac 预览首版（DQ 裁定 v0.2；附录规格） | 安全审查 + 发布验收 + 质量性能（规格） | 已文档（附录规格）；落地改走 CT-006 | CT-004 合入后 |
| CT-006 | [Mac 预览落地（脚本/种子/smoke 入库）](CT-006-mac-preview-land.md) | CT-005 附录真正入库（DQ 裁定 A–D；#23） | 质量性能 + 发布验收 | 待执行（PR #23） | CT-005 文档合入后；依赖 CT-007 口径 |
| CT-001 | [简报生成：全部来源未就绪时写回具体等待原因（#230 回归，:340）](CT-001-pr7-native-continuity-340-fix.md) | #230（3a29ed3）回归 | 架构逻辑 + 质量性能 | 已合入（#22） | 第 3（与 CT-002 可并行） |
| CT-002 | [生命周期时间戳对齐 Postgres 微秒精度](CT-002-api-lifecycle-micros-truncation.md) | ProfileMethodLifecycle 3 例 + FeedbackAdjustment 1 例 | 架构逻辑 + 质量性能 | 已合入（#21） | 第 3（与 CT-001 可并行） |
| CT-007 | [审批流程整改（合入硬闸门/两人审/体验验收/周偏离检查/暂停令优先）](CT-007-review-process-hardening.md) | 老板经 DQ 批准（2026-10-30） | 质量性能 + 发布验收 | 已合入（#25） | 纯文档 |
| CT-008 | [纯 docs paths-ignore 免跑重门禁](CT-008-docs-path-filter.md) | 三 workflow paths-ignore | 质量性能 + 架构逻辑 | 待执行（workflow 老板推） | 无；见 QUEUE |
| CT-028 | [预览 vite `/mengine-api` → 动态 scene 口](CT-028-preview-mengine-api-url.md) | trial web_env 缺 MENGINE_API_URL；bounce 手改债 | 质量性能 + 发布验收 | 待执行（纯文档） | CT-006 落地后 |
| CT-029 | [废止同账号方案 A · 流程 v1.3.5](CT-029-end-scheme-a-review-account.md) | 审查号 1203；同账号 Comment 代闸门废止 | 质量性能 + 发布验收 | 本 PR | — |
| CT-030 | [CI 省钱 paths 分流](CT-030-ci-cost-paths.md) | Actions 额度防烧光；补 paths + 缩 macos | 质量性能 + 发布验收 | 已合 main `#40` | CT-008 已合 |
| CT-024 | TaskContext 慢测/lease（#7 ④/⑥） | #7 遗留质量债 | 质量性能 + 架构逻辑 | 待写执行单 | 见 [QUEUE](QUEUE.md) |
| CT-025 | Mac 实测（交付） | 编号冻结 | 发布验收 + 质量性能 | 待写 | 见 QUEUE |
| CT-026 | 后端 wiki 基线红 backlog | 编号冻结 | 质量性能 + 架构逻辑 | 待写 | 见 QUEUE |
| （模板） | [Codex 机审提示（可粘贴）](CODEX-REVIEW-PROMPT.md) | 每个业务/流程 PR 合入前第一道 | — | 即日生效 | 随 CT-007 |
| CT-003 | [NativeAutomaticContinuity 测试契约按 #208 修订（只改测试）](CT-003-native-continuity-208-test-contract.md) | #208（865ccdc）漏改测试 | 架构逻辑 + 质量性能 | 待执行 | 第 6（#7 合入后） |

### 1.1 执行顺序（已定；全程不用 force push）
1. **CT-000**：推到 #7 分支，补 build:engine。
2. **CT-004**：紧接着推到 #7 分支，分 4 片并上传 surefire 报告（不调大超时）。
3. **CT-001、CT-002**：各自从 main 切分支、开 PR、审查后合入 main（历史：当时单审；现行合入条件见第 3 节）。验收用「老板 Mac 本地绿 + 附 surefire 报告」，因为 main 上还没有 API CI。
4. **#7 同步 main**：首选 PR #7 页面底部的 **Update branch** 按钮，点旁边下拉箭头选 **Update with merge commit**，**不要选 Update with rebase**（rebase 会改写分支历史）。命令行备选：
   ```bash
   cd ~/mengine-app && git status
   git fetch origin && git switch cursor/api-postgres-gate-1c11 && git pull
   git merge origin/main
   git push
   ```
   （`git merge` 若报 CONFLICT：停下发 DQ。）
5. **#7 合入**（历史，已发生）：#7 当时按降档令带已知红合入。**2026-10-30 起废止「带已知红合入」，以后任何 PR 不允许带红合入**（CT-007，见第 3 节合入硬闸门）。
6. **CT-003**：#7 合入后从最新 main 切；PR 自带 API CI，在 Actions 上验证「连续两次绿」。

### 1.2 （已删除）
原「已知红（#7 合入时允许存在）」条款已于 2026-10-30 按 CT-007 删除：**以后不允许带红合入**。#7 合入时遗留的红项转入 `P1-backlog-20261030.md`「等级待定」一节跟踪。


### 1.3 部署预览
| 编号 | 说明 |
|---|---|
| CT-005 | 附录规格（已文档）；落地改走 CT-006。 |
| CT-006 | 老板 Mac 本机预览脚本 / 种子 / `macos-preview-smoke.yml` **入库**（无 brew 写死；workflow 进落地 PR；审查=质量性能 + 发布验收）。依赖：CT-005 文档已合入。 |

## 2. 状态取值
`待执行`（已交老板）→ `执行中`（老板在跑 Codex）→ `PR 已开`（写上 PR 号）→ `已合入` ；异常：`卡住`（已把输出发 DQ）、`待定`（有外部阻塞，写明原因）、`作废`。

## 3. 审查流程（两人审，2026-10-30 起，CT-007；取代降档令「单审、只拦 P0」）
**⓪ 暂停令自查（优先级最高）** → 写执行单 → 直接交老板 → 老板跑 Codex（CT-000 不用）→ 老板本地测试 → 老板开 PR → CI 全绿 → **① Codex 机审**（老板 Mac，模板 `CODEX-REVIEW-PROMPT.md`，结论贴 PR Comment）→ **② 人审**（质量性能 + 发布验收等，参考机审，拦 P0+P1；体验与方向由人定）→ 非作者留痕（审查号 `luofanghao1203` Approve；Approve 暂挂时该号 Comment「放行/可合」；**禁止** 9784 同账号代闸门）→ 合入人合前自查 → 合入 → 本索引更新状态。

### 3.1 合入硬闸门（缺一不可）
1. 该 PR 的 CI **全绿**（红、取消、超时都不算绿）。**不允许带红合入**，原 1.2「带已知红合入」条款已删除。**例外（总负责人 2026-10-30）**：本单未改动路径上的基线已知红，经 PR 正文举证 main 同源后不挡合入；本单新引入红仍挡。
2. 至少一名**非作者**在 GitHub 上提交正式 **Approve review**；口头说的或消息里写的「可以合」**都不算**。
3. 不升级 GitHub Pro、不开分支保护，靠纪律执行：**合入人合前自查**以上两条，并在合入说明里写明 CI run 链接和 Approve 人。
4. **审查账号**：非作者留痕/Approve 使用 **`luofanghao1203`**（与开 PR 的 `luofanghao9784` 分离）。作者不得 Approve 自己的 PR。
5. **同账号方案 A 已废（2026-10-30，CT-029）**：禁止用开 PR 同账号 Comment 代闸门。闸门目标为 1203 Approve；发闸门接通前暂用 **1203** Comment「放行/可合」。纯文档 PR 两人审仍为**质量性能 + 发布验收**；拦 P0+P1。

CT-030：门禁单一 paths，已取代 CT-008 同事件 ignore。

### 3.2 Codex 机审（第一道，即日）
- 每个**业务/流程 PR** 合入前，在老板 Mac 用 Codex 机审（见 [`CODEX-REVIEW-PROMPT.md`](CODEX-REVIEW-PROMPT.md)）。
- **流程/执行单类 docs PR 仍须机审**（含 CT-007 自身）；仅错别字/标点超短 docs 可免，且 PR 须注明「免机审：仅错别字/标点」。
- 机审结论可贴 PR Comment；人审合入闸门为非作者 **`luofanghao1203` Approve**（暂挂时该号 Comment）。
- **人审是第二道**：质量性能 + 发布验收参考机审，拦 P0+P1；体验与方向仍由人定。机审不能单独放行。
- 架构偏离检查可让 Codex 对照 ADR 标边界，**结论由架构逻辑签字**。

### 3.3 两人审，P0 和 P1 都拦
- 每个 PR 至少两名在岗审查人：**架构逻辑 / 质量性能 / 安全审查 / 发布验收**。「测试审查」已停用，不再担任审查人。
- 按类型配人：后端、契约、架构类 = 架构逻辑 + 质量性能；涉及认证、租户隔离、密钥、执行端口、parser 时**另加安全审查**；CI、workflow、脚本 = 质量性能 + 架构逻辑；前端、预览、体验 = 发布验收 + 质量性能。
- **P0 和 P1 都拦合入**；只有 P2 记待办，不挡合入。作者不审自己的 PR。
- 能交给 CI 自动检查的仍交 CI，但 CI 绿不能代替两人审。

### 3.4 体验验收
- 发布验收负责**体验走查**（前端、预览、四端可见改动）；体验问题可以拦合入。

### 3.5 每日偏离检查（日偏离）
- 架构逻辑**每个工作日**对照计划 / ADR / 路线图 / QUEUE，写偏差与纠偏，落入 Notion「日偏离检查」（部门=梦擎）；可先让 Codex 标候选，**结论由架构逻辑签字**后经 DQ 报总负责人。原周偏离废止。
- 正式仓 **`luofanghao9784/mengine-app`**（非 fork）。

### 3.6 暂停令优先级最高
- 任何人在老板 Mac 开 Codex 前，先确认当前**没有暂停令**；暂停期间**禁止任何 Codex 启动**。拿不准就当作有暂停令，先问 DQ。
- 每份 CT 的第 ② 节第一步必须是这条自查（见第 5 节模板）。

## 4. 命名规则
`CT-NNN-<英文短名>.md`：NNN 三位递增编号，永不复用；英文短名用小写加连字符，说明改什么。分支名统一 `codex/ct-NNN-<英文短名>`。

## 5. 每份执行单的固定格式（七节，缺一不可）
1. **目标与范围**：要修什么、改哪些文件、**不做什么**。
0. **抬头**：状态、分支、审查人（**两人**，按 3.3 配人）。前端片须写正式岗 id=`ec838a2d-d838-48cd-a789-e1af1424a7f3`（勿派重复岗）。
   - 前端硬性（QUEUE 现行 6 条）：已有页**可改功能**但风格/动效/交互勿偏现页；**无页必须仿** tenant-admin；日可见预览 URL；Codex 自跑；机审+人审/非作者 1203；**四端 UI 文案人话**（禁裸 seed/capability/Capability/Grant/admission；中文白话或括号解释；引用产品+UX Notion 文案规范页，页未就绪仍自检）。
2. **前置条件与分支名**：**第一步为「⓪ 暂停令自查」**（见 3.6）；依赖哪单先合；完整 git 步骤（见下方「固定 git 步骤」）。
3. **完整 Codex 提示词**：一个代码块，可整段粘贴；含背景根因、文件与行号、修法、专家约束、**不许碰的文件清单**、验收标准、必跑测试命令、禁止事项（skip/@Disabled/放宽断言/调大超时）、做完输出什么。
4. **推荐模型与思考强度**（low/medium/high）并说明理由。
5. **预计耗时**（Codex 运行 + 本地测试）。
6. **跑完如何提交**：测试命令与通过样子、git add/commit（确切信息）、push、`gh pr create` 完整命令、网页备用链接、PR 描述模板。
7. **失败/卡住时怎么办**：症状 → 动作；何时停下把哪些输出发给 DQ。

### 固定 git 步骤（每单照此写，替换 `<分支名>`）
```bash
# ⓪ 暂停令自查（优先级最高）：确认 DQ/总负责人当前没有暂停令；有或拿不准 → 不开 Codex，停下问 DQ
# ① 进仓库
cd ~/mengine-app
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
# ⑧ 开 PR（或网页：https://github.com/luofanghao9784/mengine-app/compare/main...<分支名>）
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
cd ~ && git clone https://github.com/luofanghao9784/mengine-app.git
cd ~/mengine-app && git status
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
cd ~/mengine-app
python3 scripts/with-test-postgres.py ./apps/api/mvnw -B -f apps/api/pom.xml -Dtest=FoundationModelReviewProjectionTest test
```
最后应看到 `Tests run: 8, Failures: 0, Errors: 0, Skipped: 0` 和 `BUILD SUCCESS`。
若报 `Missing initdb; install PostgreSQL 18 and set POSTGRES_BIN if needed.`：重新执行 6.4 的 export。

### 6.5 Codex 使用方式（三种任选）
- **交互式（推荐）**：在仓库目录执行 `codex -m <模型名>`，进入后输入 `/model` 可选模型与推理强度（low/medium/high 等），然后粘贴执行单第 ③ 节提示词。`/permissions` 可设置是否允许 Codex 自动运行命令；建议允许在仓库内编辑和运行测试命令。
- **非交互**：`codex exec -m <模型名> "$(cat 提示词文件)"`（官方文档有 `codex exec` 用法）；推理强度在 `~/.codex/config.toml` 配置，键名以官方文档为准（常见写法 `model_reasoning_effort = "high"`，未在上述页面核实）。
- **替代路径**：本机装不了 JDK/Postgres 时，可让 Codex 只改代码不跑测试，推分支开 PR 后由 GitHub Actions 验证——但目前 main 上**没有**跑 API 测试的 workflow（`api-postgres-gate.yml` 只在 PR #7 上），所以这条路暂时拿不到测试结果，需先告知 DQ。Codex 云端任务（Codex cloud）也可用，环境配置以官方文档为准，云端需能装 JDK21 与 Postgres18。

模型名：官方模型页当前列出 `gpt-6.1-sol`（Plus/Pro 等计划的推荐默认）、`astra`系列（最难任务）、`gpt-6.1-terra`、`gpt-6-luna`。可用模型取决于账号计划，以 `/model` 里实际看到的为准。
