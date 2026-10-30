# CT-027-A Demo/脏代码清理 · 日切片 1（可粘贴 Codex）

状态：可跑（安全已签字 · 2026-10-30）｜分支：`codex/ct-027-a-demo-dirty-cleanup-day1`｜审查：安全审查 + 架构逻辑（触及 identity/密钥路径加安全必审）｜基准：`origin/main`

> **清单**：`docs/codex-tasks/demo-cleanup-inventory-20261030.md`（对齐安全意见；§三/§四已安全标）  
> **本片只删「可删」且无 Live 边冲突的项**；冲突节与「待安全标」**禁止动**。  
> **须留**：`scripts/preview/**`、`scripts/local/trial.py`、正式三端入口、`.gitignore` 密钥忽略、正式测试夹具、账号 bootstrap 脚本。  
> 删完验收：`preview-start` → `preview-health` 仍只听 `127.0.0.1`，workspace / tenant-admin / platform-admin 可开。

## ① 目标与范围

- **目标**：卸根 Demo 内核入口、Konggu/九朴私有演示通道、废弃 package/serve-demo、site/demo 占位、meizu 演示种子与仅测 Demo 的 e2e；预览正式包不动。
- **改/删（允许，按序）**：
  1. 根 `index.html`、`src/main.tsx`（若仍仅 DemoBootstrap——**若含 `/native-conversations` 且未迁走则本片跳过该文件**，只删纯 Demo 引用链）、`src/ninepop/Bootstrap.tsx`
  2. Konggu 链：`src/konggu*.ts`、`src/workspaceExamples.ts`、`src/colleagues.ts`、`src/briefingExamples.ts`、`src/briefingV2Examples.ts`（**不含**非 Examples 的 briefing 实现若仍被 Live 引用）
  3. `src/pages/**`（确认仅 Demo 使用后整树删）
  4. `scripts/package-demo.py`、`serve-demo.mjs`、`package-website-demo.py`、`serve-website-demo.mjs`；`package.json` 去掉 `"demo"` / `"demo:9pop"` 脚本
  5. `scripts/ninepop/private-data.ts`、仅 `__private-demo` 的 `scripts/ninepop/start.mjs`（**勿整删** `scripts/ninepop/**`）
  6. `test-data/ninepop-20261021/**`（确认无 CI 引用）
  7. `site/demo/**`、`site/src/demo/**`
  8. `scripts/meizu/generate_demo.py`、`create_demo_cards.py`、`scripts/local/seed_meizu_demo.py`
  9. Demo-only e2e：`tests/e2e/konggu.spec.ts`、`tests/konggu.test.ts`、`tests/e2e/ninepop.spec.ts`、`tests/ninepop-import.test.ts`，以及写 `enterprise-ai-demo-konggu-v1` 的 `briefing-*.spec.ts`（**仅**确认仅测 Demo 者）
  10. `vite.config.ts`：去掉根 `index.html` 多页入口（保留三端 + 已有条目）；同步 `scripts/verify-built-entries.mjs` 若存在
- **不做什么**：
  - **禁止**改/删 `scripts/preview/**`、`preview-seed-accounts.py`、`scripts/local/trial.py`
  - **禁止**动冲突项：`evolution-demo.ts`、`engine-demo.ts`、`src/store.tsx`/`src/model.ts`（未切断 Live 边前）、`src/components/**` 抽边、`src/briefing*.ts` 非 Examples、`src/admin/prototype/**`、`scripts/ninepop/**` 采集/governance 整树
  - 不改 `apps/api/**`、identity、密钥加载、`.gitignore` 忽略规则
  - 不删 `contracts/fixtures/**`、`tests/fixtures/**`、正式三端 `*/index.html`
  - 不上 agent-admin 改建（归 CT-020-F1）

## ② 前置

```bash
# ⓪ 暂停令自查
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine' || exit 1
git switch main && git pull
git switch -c codex/ct-027-a-demo-dirty-cleanup-day1
```

## ③ 完整 Codex 提示词

```
你在分支 codex/ct-027-a-demo-dirty-cleanup-day1。基准 origin/main。执行单：对照 /workspace 若无则按本提示「日切片1」范围。清单原则：须留 scripts/preview/** 与正式三端；可删根 Demo/Konggu/private-demo/package-demo/site-demo/meizu 演示种子；冲突项一律不动。

【A. 删前 grep】
对每条拟删路径 rg 确认无 Live 入口（src/identity、src/admin/TenantConsole、PlatformConsole、operations 非 demo 名文件）硬依赖。若有依赖 → 跳过该路径并列入 SKIP，勿强删。

【B. 允许删除（无依赖才删）】
- 根 index.html；vite 去掉该 input
- src/ninepop/Bootstrap.tsx；src/kongguSources.ts kongguSeed.ts kongguStorage.ts kongguResearch.ts kongguBriefing.ts kongguReply.ts
- src/workspaceExamples.ts colleagues.ts briefingExamples.ts briefingV2Examples.ts
- src/pages/**（仅 Demo）
- scripts/package-demo.py serve-demo.mjs package-website-demo.py serve-website-demo.mjs；package.json 去 demo/demo:9pop
- scripts/ninepop/private-data.ts；仅 __private-demo 的 start.mjs（勿删 ninepop 其余）
- test-data/ninepop-20261021/**
- site/demo/** site/src/demo/**
- scripts/meizu/generate_demo.py create_demo_cards.py；scripts/local/seed_meizu_demo.py
- tests/e2e/konggu.spec.ts tests/konggu.test.ts tests/e2e/ninepop.spec.ts tests/ninepop-import.test.ts；仅测 Konggu key 的 briefing e2e

【C. 条件跳过】
- src/main.tsx：若仍含 /native-conversations 且未迁 identity → 本片不删该文件，只去掉纯 DemoBootstrap 可拆部分；拆不动则 SKIP
- src/store.tsx / src/model.ts / evolution-demo / engine-demo / prototype / ninepop 采集 → 禁止

【D. 不许碰】
scripts/preview/**、preview-seed-accounts.py、trial.py、apps/api/**、.gitignore 密钥规则、contracts/fixtures、三端 index.html、force push、直推 main、口令入库

【E. 验收】
- npm run build 绿（本单引入红必须清）
- 若本机有预览：preview-health 三端 200、仅 127.0.0.1；agent-admin 留位日志可保留
- 输出：git diff --stat、SKIP 清单、验收说明
```

## ④ 模型：`gpt-6.1-sol`　⑤ 强度：**medium**　⑥ 预计：Codex 40–70 分钟 + build/预览 20–40 分钟

## ⑥ 提交（摘）

```bash
git add -A
git diff --cached --stat | grep -E 'scripts/preview/|apps/api|\.gitignore' && echo ERROR && exit 1
git commit -m "chore: CT-027-A day1 卸根 Demo/Konggu/private-demo（保留正式预览包）"
git push -u origin codex/ct-027-a-demo-dirty-cleanup-day1
gh pr create -R luofanghao9784/mengine --base main --head codex/ct-027-a-demo-dirty-cleanup-day1 \
  --title "chore: CT-027-A Demo/脏代码清理日切片1" \
  --body "对照 demo-cleanup-inventory；须留 scripts/preview；冲突项未动。审查：安全+架构。"
```

## ⑦ 失败

有暂停令停；误碰 preview/api → restore；冲突路径被引用 → SKIP 报 DQ；禁止 force/`reset --hard`。
