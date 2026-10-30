# CT-032 CI spending 限额 / 告警（CT-030 之后）

状态：架构已裁可跑 · 待 docs 入库后交老板 Mac Codex　｜　分支：`codex/ct-032-ci-spending-limits`　｜　**审查人（PR 后两人审）：质量性能 + 发布验收**　｜　基准：切单时最新 `origin/main`（须含 CT-030 `2589476` / #41）

> **日切片：待派工日 / 可验收点**：仓内文档写清 Actions **月度预算/软限额与告警怎么查**；若账号侧可配 Spending limits / Email 告警则步骤可复制；**自托管闲置机 → CT-033，不挡本单**。  
> **挂靠**：并行轨③；摸底 `docs/codex-tasks/ci-cost-survey-20261030.md`；CT-030 单一 paths 已合。  
> Codex 尽量用。产品/UX 不审本单。

### 架构已裁（2026-10-30，本岗；DQ 可覆）

1. **本单以「文档化限额 + 可操作告警步骤」为主**；能在 `.github/` 用官方支持的轻量手段加提醒则加，**禁止**为省钱关掉必要门禁或 `continue-on-error` 假绿。
2. **不**引入自托管 runner（CT-033）；不合并三门禁；不调大 timeout；不破坏 CT-030「单一 paths、无同事件 paths-ignore」。
3. 预算数字以老板/发布在 PR 或本单修订的**明文上限**为准；执行单给**建议默认**，Codex 不得臆造私密账单数字当事实。

## ① 目标与范围

- **目标**：在 CT-030 已降触发面之后，补上 **spending 可见性与软闸门**：文档写清限额策略 +（可选）仓库/组织侧告警配置步骤，避免下月额度无声烧光。
- **改哪些文件（允许）**：
  1. **新建** `docs/codex-tasks/ci-spending-limits-20261030.md`（或同目录 `CI-SPENDING.md`）：  
     - 现状指针：CT-030 paths、三门禁、macos 仅 dispatch、摸底结论  
     - **建议软限额**（默认草案，可被发布改数）：例如「Actions 月支出告警阈值 = 计划额度 50% / 80%」；「纯 docs 必须 skip」「前端-only 不得触发 api 四片」纪律复述  
     - **告警怎么配**（GitHub.com → Settings → Billing / Spending limits；组织/用户 Actions 预算；邮件通知）。写清：需老板或有 Billing 权限账号点按；组员无权限则只文档化  
     - **运行纪律**：额度窗错开重业务；禁止无意义重跑 matrix；macos 勿改回 push/PR  
     - **CT-033 预告**：自托管/闲置机调研另单，本单不实施  
  2. 可选：`.github/workflows/` 仅当存在**官方且无副作用**的 usage 报告/提示手段；**默认不做**新重门禁。若加 workflow，必须 `workflow_dispatch` 或极窄 paths，且审查人同意。  
  3. 可选一句：`docs/codex-tasks/QUEUE.md` / `README.md`「CT-032：spending 文档已落」  
  4. 可选：在 `ci-cost-survey-20261030.md` 末加「后续见 CT-032 限额文」链接
- **不做什么**：
  - **不做 CT-033**：自托管 runner、闲置机回收/关机脚本、改 runner labels
  - 不删/放宽 api-postgres / frontend / contracts 必要检查
  - 不恢复同事件 `paths`+`paths-ignore` 双写（P0）
  - 不改业务源码、`com.dreamcore.*`、`/mengine-api`、`MENGINE_*`
  - 不 force push；不 `gh issue`

### 建议默认软限额（草案 · 发布可改）

| 项 | 建议 |
|---|---|
| 告警阈值 | 月度 Actions 支出 50%、80% 发邮件/Billing 告警（在 GitHub Billing UI 配置） |
| 硬停 | 以 GitHub Spending limit「Actions」开关为准；数值由老板定，文档留空位 `TBD_BY_OWNER` |
| 工程纪律 | 纯 docs skip；窄改动只打对应 gate；macos 仅手动；禁止无故全量重跑 |

## ② 前置条件与分支名

- **⓪ 暂停令自查**。
- **依赖**：CT-030 已合（`2589476` / #41）。Billing UI 配置若无权限 → 文档写步骤 + PR 标「待老板点按」，**不挡**文档合入。
- 仓：`~/Desktop/mengine-app-luofanghao9784`，origin=`luofanghao9784/mengine-app`。

```bash
# ⓪ 暂停令自查
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || exit 1
git status
git switch main && git pull
git merge-base --is-ancestor 2589476 HEAD || { echo 'ERROR: 缺 CT-030'; exit 1; }
git switch -c codex/ct-032-ci-spending-limits
```

## ③ 完整 Codex 提示词

```
你在分支 codex/ct-032-ci-spending-limits。基准 origin/main（含 CT-030 2589476）。执行单：docs/codex-tasks/CT-032-ci-spending-limits.md。
摸底：docs/codex-tasks/ci-cost-survey-20261030.md。CT-030：docs/codex-tasks/CT-030-ci-cost-paths.md。

【强制】
1. 新建 docs/codex-tasks/ci-spending-limits-20261030.md：写清 CT-030 之后的 spending 策略、建议 50%/80% 告警、Billing/Spending limits 点按步骤、工程纪律、CT-033 自托管另单不挡。
2. 硬停金额写 TBD_BY_OWNER，勿臆造真实账单美元数。
3. 默认不要新增会每次 PR 空烧的 workflow。若加，仅 dispatch 或极窄，且不破坏单一 paths。
4. 禁止：自托管 runner、continue-on-error 假绿、调大 timeout、paths+paths-ignore 双写、改业务代码、改 com.dreamcore.*、/mengine-api、MENGINE_*。
5. 远程 luofanghao9784/mengine-app。

【验收自检】
- 新文档存在且含：CT-030 指针、告警阈值、Billing 步骤、CT-033 另单、TBD_BY_OWNER
- rg 确认未引入自托管 runner 配置到 .github（本单范围）
- 三门禁 yml 若被改：仍无 paths-ignore 与 paths 同事件双写

【做完输出】diff --stat、文档路径、待老板 Billing 点按清单。
```

## ④ 推荐模型与思考强度

- 模型：`gpt-6.1-sol`
- 思考强度：**low**～**medium**（以文档为主）
- **预计耗时**：Codex 15–30 分钟；人眼核 10 分钟

## ⑤ 验收标准

| # | 标准 | 如何验 |
|---|---|---|
| V1 | 限额文档存在 | `test -f docs/codex-tasks/ci-spending-limits-20261030.md` |
| V2 | 含关键节 | 文内可见 CT-030、告警阈值、Billing/Spending、CT-033 另单、`TBD_BY_OWNER` |
| V3 | 不挡合入 | Billing 未点按也可合 docs；PR body 列「待老板配置」 |
| V4 | 无自托管落地 | diff 无 runner 接入/闲置机脚本（归 CT-033） |
| V5 | CT-030 纪律 | 未把 paths-ignore 加回同事件 |

## ⑥ 跑完如何提交

```bash
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || exit 1
git add docs/codex-tasks/ci-spending-limits-20261030.md
# 若改 survey / QUEUE 一句：一并 add
git commit -m "$(cat <<'EOM'
docs(ci): CT-032 spending 限额与告警文档

CT-030 后补预算可见性；自托管归 CT-033。
EOM
)"
git push -u origin codex/ct-032-ci-spending-limits
gh pr create -R luofanghao9784/mengine-app --base main --head codex/ct-032-ci-spending-limits \
  --title "docs(ci): CT-032 spending 限额/告警" \
  --body "## 摘要
文档化 Actions spending 软限额与 Billing 告警步骤；硬停金额 TBD_BY_OWNER。自托管→CT-033。

## 验收
- docs/codex-tasks/ci-spending-limits-20261030.md
- 待老板：GitHub Billing Spending limits / 邮件告警

## 审查
质量性能 + 发布验收
勿自动合并"
```

网页备用：https://github.com/luofanghao9784/mengine-app/compare/main...codex/ct-032-ci-spending-limits

## ⑦ 禁止操作 / 失败卡住

| 症状 | 动作 |
|---|---|
| 暂停令 | 停 |
| 无 Billing 权限 | 文档写步骤即可；PR 标待老板；不挡 |
| 误加自托管 | `git restore`；归 CT-033 |
| 破坏 CT-030 paths | 立刻恢复；报质量 |

**硬禁止**：假绿、双写 paths+ignore、自托管落地、改业务/Java 包名/`MENGINE_*`、force push、直推 main、`gh issue`。

回滚：`git switch main && git branch -D codex/ct-032-ci-spending-limits`。

---

**DQ 审路径**：本文件 + QUEUE CT-032 行。通过后交老板 Mac 粘贴③（Billing 点按可另附）。
