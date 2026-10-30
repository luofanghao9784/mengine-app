# CT-008 纯 docs PR 免跑重门禁（path-filter / paths-ignore）

状态：执行单已入库（纯文档 PR）；workflow 改动不在本 PR，由老板跑本单时推　｜　分支：`codex/ct-008-docs-path-filter`　｜　**审查人（两人审，按 CT-007 §3.3）：质量性能 + 架构逻辑**　｜　类型：门禁 workflow　｜　基准：origin/main `42cdfd8`（#7 已合；#25/CT-007 已合）

> 背景：三道 PR 门禁（`api-postgres-gate` / `frontend-gate` / `contracts-engine-gate`）均对指向 main 的 **全部** pull_request 触发，**无** `paths` / `paths-ignore` / `dorny/paths-filter`。纯文档 PR（如 #25）仍会跑 API·Postgres 90 分钟分片等重门禁；若 main 上存在与本 PR 无关的红，会挡住合入。本单只加 path-filter，不修业务红、不改测试。

## ① 目标与范围
- **目标**：在上述 **三个** workflow 的 `on.pull_request` 下增加 `paths-ignore`，使 **仅** 改文档类路径的 PR **跳过** 三道重门禁（GitHub 显示 skipped，不算红）。
- **建议 `paths-ignore` 清单**（三文件相同；勿扩大到业务源码）：
  ```yaml
  paths-ignore:
    - 'docs/**'
    - '*.md'
    - '**/*.md'
  ```
  含义：PR 的全部变更文件都落在上述模式内时，该 workflow 不调度；只要有任一文件不在清单内（如 `apps/**`、`engine/**`、`src/**`、`package.json`、`.github/workflows/**`、脚本等），门禁照常跑。
- **改动文件（只这 3 个）**：
  - `.github/workflows/api-postgres-gate.yml`
  - `.github/workflows/frontend-gate.yml`
  - `.github/workflows/contracts-engine-gate.yml`
- **可选同 PR 一行说明（不强制）**：在 `docs/codex-tasks/README.md` §3.1 合入硬闸门下加一句「纯 docs（仅命中上述 paths-ignore）时三道重门禁为 skipped，不算红；机审/人审仍按 CT-007」。若加此行，该 PR 同时改 workflow + docs → **仍会触发门禁**（因 workflow 不在 ignore 内），与「只改 workflow」行为一致。
- **不做什么**：
  - 不引入 `dorny/paths-filter` 第三方 Action（本单用原生 `paths-ignore` 即可）。
  - 不改 job 步骤、分片、timeout、permissions、concurrency。
  - 不改业务代码、测试、迁移、前端、engine。
  - 不修 #25 / context 分片等仓内红（交质量性能；见备选 B）。
  - 合入纪律按 CT-007 + **总负责人例外（2026-10-30）**：本单未改动路径上的基线已知红，经 PR 正文举证与 main 同源后不挡合入；本单新引入红仍挡。禁止 force push；不开/评 Issue；不写上游仓库。
  - **不把 `.github/workflows/**` 放进 paths-ignore**（改门禁本身必须仍跑门禁，避免无验证合入）。
- **鸡生蛋风险与合入例外（写明）**：本单 PR 自身改的是 workflow，**不会**被 paths-ignore 跳过，三道门禁仍会跑。若当时 main 上 API/前端/契约有与本改**无关**的基线红，**不要**为合本单而放宽断言 / continue-on-error / 改测试。按总负责人例外（README §3.1 / 2026-10-30）：在 PR 正文用举证表证明「红在未改路径上 + 与 main 同源」后可不挡合入；**本单新引入红仍挡**。质量性能清红可并行，不作为本单硬前置。

## ② 前置条件与分支名
- **⓪ 暂停令自查（CT-007，优先级最高）**：在老板 Mac 开 Codex / 推 workflow 前，确认 DQ/总负责人当前**没有**生效暂停令；有或拿不准 → **禁止启动 Codex、禁止推送**，停下问 DQ。
- **依赖**：无硬依赖其他未合 CT（CT-007/#25 已合 main `42cdfd8`）。合入不必死等 main 全绿；基线红走例外举证。仍建议避开「本单新改路径上刚引入红」的窗口。
- **workflow 推送权限**：组内令牌无 `workflow` scope，GitHub 拒绝改 `.github/workflows` 的推送。**必须由老板本人账号推**（必要时 `gh auth refresh -s workflow`）。Codex 只改本地文件，**不得**用组内账号 push 本分支（若 push 被拒属预期）。
```bash
# ⓪ 暂停令自查通过后再继续
cd ~/mengine
git status
# 应显示 nothing to commit, working tree clean
git switch main && git pull
git log --oneline -1
# 确认接近 42cdfd8 或更新的 main
git switch -c codex/ct-008-docs-path-filter
# 若用 Codex：codex -m gpt-6.1-sol ，/model 选 medium，粘贴第 ③ 节
# 若不用 Codex：按第 ③ 节「做法 B」手工改三文件
```

## ③ Codex 提示词（整段复制）
```text
你在 dreamcore-workspace 仓库。任务：给三道 PR 门禁加上 docs 类 paths-ignore，使「只改文档」的 PR 跳过重门禁。本单是门禁 workflow 变更。

【硬约束】
1. 只改下面 3 个文件，禁止碰其他任何路径：
   - .github/workflows/api-postgres-gate.yml
   - .github/workflows/frontend-gate.yml
   - .github/workflows/contracts-engine-gate.yml
2. 每个文件只改 on.pull_request 段：在现有
     on:
       pull_request:
         branches: [main]
   下增加（缩进与现有 YAML 一致，branches 下一层）：
     paths-ignore:
       - 'docs/**'
       - '*.md'
       - '**/*.md'
3. 禁止：改 jobs、steps、timeout、permissions、concurrency、矩阵分片；加 continue-on-error；加 || true；引入 dorny/paths-filter 或其他 Action；把 .github/** 或 apps/** 或 src/** 或 package.json 放进 paths-ignore；删除现有注释（可在 on 段上方加 1～2 行中文注释说明「纯 docs PR 跳过本门禁，见 CT-008」）。
4. 禁止 commit、push、gh、改 remote。做完只输出 diff。

【验收自检（本地）】
- git diff --stat 仅上述 3 文件，每个文件约 +4～6 行。
- 用 python 或手工确认：三文件均含相同的 paths-ignore 三行；branches: [main] 仍在。
- 不要跑 test:api / npm test（本单不改业务）。

【做完输出】
1. 三文件各自的 on: 完整片段（改后）；
2. git diff --stat 与完整 diff；
3. 一句话说明：纯 docs PR 将 skipped；改 apps/ 或 workflow 仍会跑。
```

### 做法 B：不用 Codex（手工 / 补丁，可选）
在每个 workflow 的 `pull_request:` → `branches: [main]` 后插入相同 `paths-ignore` 块（见①）。保存后 `git diff` 应只有 3 个 yml、无 Tab 缩进。

## ④ 推荐模型与思考强度
`gpt-6.1-sol`，**medium**。改动面机械、范围极小；high 无必要。也可用做法 B 完全不用 Codex。

## ⑤ 预计耗时
Codex 或手工 10–20 分钟；推送与开 PR 10 分钟；CI（本单仍会跑满三道门禁）约 90 分钟（API 分片）+ 前端/契约。若仅基线已知红：按⑥举证表写入 PR 正文，走总负责人例外，勿自行修红；本单新红则转质量性能清零后再合。

## ⑥ 跑完如何提交
**推送与开 PR 必须用老板账号**（含 workflow scope）。组内账号 push 若报 `refusing to allow ... workflow` 为预期，改老板账号执行下方命令。
```bash
cd ~/mengine
git diff --stat
# 只应出现三个 .github/workflows/*.yml
git diff -- .github/workflows/
# 每人眼核：仅增加 paths-ignore，无 continue-on-error、无删步骤
git add .github/workflows/api-postgres-gate.yml \
        .github/workflows/frontend-gate.yml \
        .github/workflows/contracts-engine-gate.yml
# 若同 PR 改了 README 一句说明：再 git add docs/codex-tasks/README.md
git commit -m "ci: 纯 docs PR paths-ignore 跳过 API/前端/契约重门禁（CT-008）"
# 老板账号：
git push -u origin codex/ct-008-docs-path-filter
```
开 PR：
```bash
cat > /tmp/ct-008-pr.md <<'PR'
## 背景
纯文档 PR（如流程/执行单）不应被 API·Postgres / 前端 / 契约重门禁挡住。核实 main 上三 workflow 均无 path-filter（CT-008 基线）。

## 改动
- 三 workflow 的 `on.pull_request` 增加 paths-ignore：`docs/**`、`*.md`、`**/*.md`
- 不改 jobs/步骤；不引入第三方 paths-filter Action

## 验收
- [ ] 另开（或随后）一个仅改 `docs/` 的探测 PR / 空提交验证：三门禁为 skipped
- [ ] 任意改 `apps/` 或 `src/` 的 PR：三门禁仍调度
- [ ] 本 PR 自身仍跑门禁（改了 workflow）
- [ ] 无 continue-on-error / || true；无放宽断言
- [ ] 若 CI 有红：填下方「基线已知红举证表」；本单新引入红必须清零

## 基线已知红举证表（总负责人例外 · 有红才填）
| 失败检查 / 用例 | 本 PR 是否改动其路径 | main 同源证据（run 链接或 commit） | 结论 |
|---|---|---|---|
| （例）api-postgres-gate / FooTest | 否（本 PR 仅 `.github/workflows/*` paths-ignore） | main 同名 job run … 同失败 | 基线红，不挡合入 |
| （本单新红则填） | 是 / 否 | — | **挡合入，须清零** |

## 审查
质量性能 + 架构逻辑（CI/workflow）。机审用 CODEX-REVIEW-PROMPT.md。
PR
gh pr create --base main --head codex/ct-008-docs-path-filter \
  --title "ci: 纯 docs PR paths-ignore 跳过重门禁（CT-008）" \
  --body-file /tmp/ct-008-pr.md
```
合入条件（CT-007 + 总负责人例外）：
1. 本单**新引入红**清零（红/取消/超时都不算绿）。
2. **未改路径**上的基线已知红：PR 正文举证表证明与 main 同源后**不挡**合入。
3. 非作者在岗审查留痕（Approve 账号未就绪前：正式 Comment「放行/可合」）。
4. 禁止 continue-on-error / 放宽断言制造假绿。

## ⑦ 失败/卡住时怎么办
| 症状 | 动作 |
|---|---|
| 暂停令存在/不明 | 不开 Codex、不推送，问 DQ |
| push 报 `refusing to allow ... workflow` | 换老板账号；`gh auth refresh -s workflow` 后重推 |
| `git status` 不干净 | `git stash push -u -m "ct-008-before"`，做完再 `stash pop`；冲突则停下发 DQ |
| diff 含 3 个 yml 以外文件 | `git checkout -- <误改路径>`，重做 |
| 本单 CI 仅因未改路径上的基线红失败 | **不要**改测试/加 continue-on-error；在 PR 正文填⑥举证表（main 同源 run/commit）→ 审查确认后可按例外合入；同时把链接抄送质量性能跟清红（非本单硬前置） |
| 审查打回 paths-ignore 过宽/过窄 | 按审查改清单后重推（仍老板账号） |
| 误把 workflows 加入 paths-ignore | 立刻改回；审查按 P0 打回 |

停下时发给 DQ：`git status`、`git log --oneline -3`、`git diff --stat`、报错原文或 CI run 链接。

**禁止**：force push（`--force`/`-f`/`--force-with-lease`）、`reset --hard`、直推 main、自己合自己的 PR、开或评论 Issue、写上游仓库、放宽断言、跳过测试、把本单新引入红当基线红蒙混合入（例外只覆盖「未改路径 + 已举证 main 同源」）。
