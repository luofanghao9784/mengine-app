# CT-030 CI 省钱：单一 paths 分流 + 缩矩阵（下月防烧光）

状态：可跑（#40 质量打回已改）　｜　分支：`codex/ct-030-ci-cost-paths`　｜　审查人：**质量性能 + 发布验收**　｜　基准：切单时最新 `origin/main`

> **老板定案（2026-10-30）**：Actions 本月额度已尽；下月别月初烧光。方案1继续；**自托管 runner 中期、不进本单**。  
> **摸底**：`docs/codex-tasks/ci-cost-survey-20261030.md`  
> **质量 P0（必须）**：同一 `pull_request` 事件**禁止**同时写 `paths` + `paths-ignore`。本单以**单一 `paths`** 替换 CT-008 的 `paths-ignore`（删除 ignore 块）。勿让 Codex 双写。  
> **约束**：全面 Codex；老板 Mac 粘贴③落地；禁止 Grok 直写大段 yml。合入：审查号 `luofanghao1203` Approve（暂挂则该号 Comment；禁止 9784 同账号代闸门）。

## ① 目标与范围

- **目标**：三道 PR 重门禁改为**仅** `on.pull_request.paths`（正向业务路径；可选末尾 `!docs/**` / `!*.md` / `!**/*.md` 作排除）。**删除**同事件上的 `paths-ignore`。效果：纯 docs skip；只改前端仅 frontend；只改 api 仅 api。并缩短 macos 矩阵为单 OS。
- **改哪些文件**：
  1. `.github/workflows/api-postgres-gate.yml` — **删** `paths-ignore`；**只留** `paths:`（见下）
  2. `.github/workflows/frontend-gate.yml` — 同上
  3. `.github/workflows/contracts-engine-gate.yml` — 同上
  4. `.github/workflows/macos-preview-smoke.yml` — matrix 仅一档 Apple Silicon（建议 `macos-15`）；保持仅 `workflow_dispatch`；禁止 push/PR
  5. 可选：`docs/codex-tasks/README.md` / `QUEUE.md` 一句「CT-030：门禁单一 paths，已取代 CT-008 同事件 ignore」
- **不做什么**：
  - **禁止**同事件并存 `paths` + `paths-ignore`（P0）
  - 不引入自托管 runner；不合并三门禁为单文件；不调大 timeout；不加 continue-on-error；不 skip；不引入 dorny/paths-filter
  - 不改业务源码

### 建议 `paths`（唯一过滤；Codex 可按仓微调，不得无故扩大到「等于全仓」）

**api-postgres-gate.yml** — `pull_request` 下示例：
```yaml
on:
  pull_request:
    branches: [main]
    paths:
      - 'apps/api/**'
      - 'scripts/with-test-postgres.py'
      - 'scripts/local/**'
      - '.github/workflows/api-postgres-gate.yml'
      - 'apps/api/pom.xml'
      - 'package.json'
      - 'package-lock.json'
      - 'engine/package.json'
      - 'engine/package-lock.json'
      - '!docs/**'
      - '!*.md'
      - '!**/*.md'
```
（`package.json` 若过宽：收窄并在 PR 说明；**不要**为此加回 paths-ignore。）

**frontend-gate.yml**：
```yaml
    paths:
      - 'src/**'
      - 'workspace/**'
      - 'tenant-admin/**'
      - 'platform-admin/**'
      - 'agent-admin/**'
      - 'vite.config.ts'
      - 'playwright.config.ts'
      - 'tests/**'
      - 'scripts/verify-built-entries.mjs'
      - 'package.json'
      - 'package-lock.json'
      - '.node-version'
      - '.github/workflows/frontend-gate.yml'
      - '!docs/**'
      - '!*.md'
      - '!**/*.md'
```

**contracts-engine-gate.yml**：
```yaml
    paths:
      - 'contracts/**'
      - 'engine/**'
      - 'package.json'
      - 'package-lock.json'
      - 'engine/package.json'
      - 'engine/package-lock.json'
      - '.github/workflows/contracts-engine-gate.yml'
      - '!docs/**'
      - '!*.md'
      - '!**/*.md'
```

> **语义**：无 `paths-ignore`。纯 docs / 纯 md 不命中正向路径 → workflow **skipped**。只改 `src/features/agent-admin/**` → 仅 frontend。只改 `apps/api/**` → 仅 api。每个 `paths` 须含**自身 yml**。

## ② 前置

```bash
# ⓪ 暂停令自查
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || exit 1
git switch main && git pull
git switch -c codex/ct-030-ci-cost-paths
```

## ③ 完整 Codex 提示词

```
你在分支 codex/ct-030-ci-cost-paths。基准 origin/main。执行单：docs/codex-tasks/CT-030-ci-cost-paths.md。

【P0·强制】
1. 三道 gate（api-postgres / frontend / contracts-engine）的 on.pull_request：**删除全部 paths-ignore**；只保留单一 paths 列表（正向业务路径 + 可选 !docs/**、!*.md、!**/*.md）。禁止 paths 与 paths-ignore 同时出现在同一 pull_request 事件下。
2. 以 paths 替换 CT-008 的 ignore；不要「保留 ignore 再加 paths」。
3. 每个 paths 含自身 workflow yml。前端-only 不得触发 api 四片。
4. macos-preview-smoke：仅 workflow_dispatch；matrix.os 单一（macos-15）；禁止 push/pull_request。
5. 禁止：自托管 runner、调大 timeout、continue-on-error、skip、dorny/paths-filter、改业务源码、删 concurrency/permissions。

【验收自检】
- 解析三 yaml：均有 paths；均无 paths-ignore。
- 假想触发表：① 只改 docs/ → 三门禁全 skip；② 只改 src/features/agent-admin/ → 仅 frontend；③ 只改 apps/api/ → 仅 api。
- diff 几乎只有 .github/workflows/*.yml（+可选一句 docs）。

【做完输出】diff --stat、假想触发表、确认「无 paths-ignore」。
```

## ④ 模型：`gpt-6.1-sol`　⑤ 强度：**medium**　⑥ 预计：Codex 20–40 分 + 人眼核 15 分（额度尽时靠假想表）

## ⑥ 提交

```bash
cd "$REPO"
git add .github/workflows/api-postgres-gate.yml \
        .github/workflows/frontend-gate.yml \
        .github/workflows/contracts-engine-gate.yml \
        .github/workflows/macos-preview-smoke.yml
# 确认无 paths-ignore
rg -n 'paths-ignore' .github/workflows/api-postgres-gate.yml \
  .github/workflows/frontend-gate.yml \
  .github/workflows/contracts-engine-gate.yml && echo 'ERROR: 仍有 paths-ignore' && exit 1
git commit -m "$(cat <<'EOM'
ci(ct-030): 单一 paths 分流三门禁 + macos 单 OS（取代 paths-ignore）

纯 docs skip；前端-only 不拉 API 四片。禁止同事件 paths+paths-ignore。
EOM
)"
git push -u origin codex/ct-030-ci-cost-paths
gh pr create -R luofanghao9784/mengine-app --base main --head codex/ct-030-ci-cost-paths \
  --title "ci(ct-030): 单一 paths 分流门禁省 Actions" \
  --body "## 摘要
删除 paths-ignore；仅 paths（含 !docs 排除）。macos 单 OS。

## 假想触发
（粘贴 Codex 表）

## 审查
质量+发布；1203。"
```

## ⑦ 失败

| 症状 | 动作 |
|---|---|
| 仍双写 paths+ignore | P0 打回，删 ignore |
| paths 过窄漏跑 | 按审查补正向路径，仍勿加 ignore |
| 误加自托管/push 到 macos | P0 打回 |
| 额度尽无法真跑 | 靠假想表；正文注明 |
