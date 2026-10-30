# CI Spending 限额与告警（2026-10-30 · CT-032）

状态：文档已落 · **硬停 $10/月（老板口径 2026-10-30）**　｜　挂靠：并行轨③　｜　前置：**CT-030** 已合（`2589476` / #41）　｜　自托管：**CT-033**（另单，不挡本单）

> **目标**：在 CT-030 已降触发面之后，补上 **Actions spending 可见性与软闸门**，避免下月额度无声烧光。  
> 老板口径（2026-10-30）：硬停 **$10/月**；告警 **50% / 80%**；通知 = **`luofanghao9784` GitHub 账号登记邮箱**。真开限额仍须老板在 Billing UI 点开。产品/UX 不审本单。

## 1. 现状指针（CT-030 之后）

| 项 | 现态 | 出处 |
|---|---|---|
| 三门禁过滤 | **单一 `paths`**（无同事件 `paths-ignore`） | CT-030 / #41 `2589476`；质量 P0 |
| 纯 docs PR | 应 **skip** 三道重门禁 | CT-030 验收；摸底 §3 |
| 前端-only | 不得再拉 api×4 + contracts | CT-030 paths 分流 |
| macos-preview-smoke | **仅** `workflow_dispatch`；矩阵已缩单 OS | CT-030；勿改回 push/PR |
| 摸底结论 | 额度尽时 run 常数秒 failure；前端-only 全开是主因 | [`ci-cost-survey-20261030.md`](ci-cost-survey-20261030.md) |
| 执行单 | [`CT-032-ci-spending-limits.md`](CT-032-ci-spending-limits.md) | 本落地文档对应 CT |

**不在本单**：自托管 runner / 闲置机回收 → **CT-033**；合并三门禁 / 再砍 api shard → 另单。

## 2. 建议软限额（草案 · 发布可改）

| 项 | 建议默认 | 说明 |
|---|---|---|
| 告警阈值 | 月度 Actions 支出 **50%**、**80%** | 在 GitHub Billing / Spending limits UI 配邮件或 Billing 告警 |
| 硬停（Actions Spending limit） | **$10 / 月** | 老板口径已定；须在 Billing UI **打开** Actions spending limit 并填 **10 USD**；未点开则文档生效不代表已硬停 |
| 工程纪律（仓内） | 见 §4 | 与 UI 限额互补；不替代 Billing 硬停 |

> 发布验收可在 PR 或本文件修订行改告警百分比与硬停占位；改数须明文，勿口头。

## 3. 告警怎么配（需 Billing 权限 · 待老板点按）

组员无 Billing 权限时：**只按下列步骤文档化**；配置动作标「待老板点按」，**不挡**本 docs PR 合入。

### 3.1 个人 / 组织 Billing 入口

1. 打开 GitHub → 右上角头像 → **Settings**（或组织页 → **Settings**）。
2. 左侧 **Billing and plans**（或 **Billing**）→ 找到 **Spending limits** / **Actions** / **Packages** 相关区块。
3. 确认当前计费主体：个人账号 `luofanghao9784` 或所属组织（以老板实际付款主体为准）。

### 3.2 Actions 软告警（50% / 80%）

1. 在 **Spending limits**（或等价「预算 / 用量告警」）中找到 **GitHub Actions**。
2. 若 UI 提供「按用量百分比发邮件 / 通知」：设 **50%** 与 **80%** 两档（相对**当月计划额度或硬停上限**；以页面文案为准）。
3. 若仅支持「接近限额发邮件」单档：至少开一档，并在本文件修订注明实际档位；仍建议老板手工盯 50% 节点。
4. 通知邮箱 = **`luofanghao9784` GitHub 账号登记的主邮箱**（组织场景另确认 Billing email 可达同一人）。

### 3.3 Actions 硬停（金额 = **$10 / 月**）

1. 同一 Spending limits 页，打开 **Actions** 的 spending limit（硬停）开关（若尚未开）。
2. 填入月度硬停金额 **`10`（USD）**。
3. 保存后确认：硬停触发后新 run 会失败/拒收，属预期，**禁止**用 `continue-on-error` 假绿绕过。
4. **真开限额仍须老板 Billing 点开**（总负责人转）；仅合本文档不等于已硬停。

### 3.4 待老板点按清单（PR 合入后）

- [ ] 打开付款主体 Billing → Spending limits → Actions
- [ ] 配置 **50% / 80%**（或 UI 等价）邮件/Billing 告警
- [ ] 设定硬停金额 **$10 / 月** 并打开开关
- [ ] 确认通知发到 **`luofanghao9784` GitHub 账号邮箱**

## 4. 工程纪律（仓内 · 与 CT-030 一致）

1. **纯 docs** 必须能 skip 三道重门禁（验证 CT-030 paths；勿把业务路径误加回「等于全仓」）。
2. **窄改动只打对应 gate**：前端-only → 仅 frontend；api-only → 仅 api；contracts/engine → 仅 contracts。
3. **macos-preview-smoke** 保持仅 `workflow_dispatch`；**禁止**改回 `push` / `pull_request`。
4. **禁止无意义全量重跑** matrix / 同 SHA 连环 Re-run all jobs（额度窗错开重业务 PR）。
5. **禁止**同事件 `paths` + `paths-ignore` 双写（质量 **P0**）。
6. **禁止**为省钱：`continue-on-error` 假绿、关掉必要门禁、无故调大 `timeout-minutes`。
7. **禁止**本单引入自托管 runner / 改 runner labels（→ **CT-033**）。

## 5. CT-033 预告（不挡本单）

| 项 | 说明 |
|---|---|
| 主题 | 自托管 runner / 闲置机调研与（若拍板）接入 |
| 与本单关系 | **另单**；本落地 **不实施** runner、关机脚本、label 变更 |
| 触发条件 | 老板/发布确认 Billing 软闸门仍不够，或有稳定闲置机可托管 |

## 6. 可选后续（默认不做）

- **默认不新增**每次 PR 空烧的 workflow。
- 若日后需要「用量提醒脚本」：仅 `workflow_dispatch` 或极窄 paths，且须质量+发布同意；**不得**破坏 CT-030 单一 paths。
- 需要 yml 时：由总负责人 Cloud Agent / Mac Codex 另贴「yml 粘贴包」，不在本 PR 默认合入。

## 7. 验收对照（CT-032）

| # | 标准 | 本文件 |
|---|---|---|
| V1 | 限额文档存在 | 本路径 |
| V2 | CT-030 指针、告警阈值、Billing 步骤、CT-033 另单、硬停 **$10/月** | §1–§5 |
| V3 | Billing 未点按也可合 docs | §3.4 清单不挡合入 |
| V4 | 无自托管落地 | §5 / §4.7 |
| V5 | 未双写 paths+ignore | §4.5；本 PR 不改三门禁 yml |

---

**维护**：架构逻辑起草；发布可改软限额数字；质量审「无假绿 / 无双写 paths」。硬停 **$10/月** 已定口径；**UI 开关**仅老板/Billing 权限账号点开。
