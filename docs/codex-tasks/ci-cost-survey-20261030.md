# CI 用量摸底（2026-10-30 · 架构逻辑）

背景：GitHub Actions 本月 Compute **$12/$12 已尽**；下月须防月初烧光。  
**质量 P0 修订**：同事件禁止 `paths`+`paths-ignore` 双写；CT-030 以**单一 paths** 替换 CT-008 ignore。

## 1. 现有 workflow 一览

| 文件 | name | 触发 | CT-008 现状 | jobs / matrix | timeout | 粗算并行 | 备注 |
|---|---|---|---|---|---|---|---|
| `api-postgres-gate.yml` | API · Postgres gate | `pull_request` → main | 现有 `paths-ignore` docs 三件套（**CT-030 将删除并改单一 paths**） | 1×**4 shards** | 90m/片 | **4** | 最重 |
| `frontend-gate.yml` | Frontend gate | `pull_request` → main | 同上 | 1 | 45m | 1 | build+unit+e2e |
| `contracts-engine-gate.yml` | Contracts · Engine gate | `pull_request` → main | 同上 | 1 | 30m | 1 | 双 npm ci |
| `macos-preview-smoke.yml` | macos-preview-smoke | 仅 `workflow_dispatch` | n/a | macos-14+15 | 45m×2 | 2 | 勿挂 push/PR；CT-030 缩单 OS |

额度耗尽时 run 常数秒 failure。额度恢复后，**前端-only 仍拉三门禁+API×4** 是烧额度主因。

## 2. 与 CT-008 / #29 差集

**CT-008 已做**：三门禁 `paths-ignore` → 纯 docs 可 skip。  
**差集（CT-030）**：

1. **无正向 paths** → 非 docs 的窄改动仍全开三门禁。（改法：单一 `paths`，删 ignore）  
2. **不可**在同事件叠加 paths+ignore（GitHub/质量 P0）。  
3. macos 双 OS 手动一次仍贵 → 默认单 OS。  
4. 三文件合并 = P2，本单不做。

## 3. 建议优先级

| 序 | 项 |
|---|---|
| P0 | 三门禁：**删 paths-ignore**，只留 `paths`（正向 + 可选 `!docs/**` `!*.md` `!**/*.md`） |
| P0 验收 | 纯 docs → 全 skip；只改前端 → 仅 frontend；只改 api → 仅 api |
| P1 | macos matrix 单 OS；保持仅 dispatch |
| P2 | 合并 workflow / 再砍 api shard（另单） |

## 4. 依据

仓内 workflows、CT-008 文档、`gh run list` 近样；质量 #40 打回意见。
