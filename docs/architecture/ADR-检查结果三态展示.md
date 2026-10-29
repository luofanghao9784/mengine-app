# ADR 增补提纲：检查结果「三态」强制分开展示

日期：2026-10-30 · 作者：梦擎·前端架构  
状态：ADR 增补 · 已定稿进仓（纯文档）  
依据：Mengine 数据基座评审稿 §6；老板拍板乙；DQ 定稿用词

## 上下文
须分别记录并展示：
1. **运行态 `runStatus`**——程序是否跑完（等待/运行中/待人工确认/成功/失败/取消）
2. **质量结论 `qualityVerdict`**——数据是否满足本次使用要求（通过/不通过/待确认；契约枚举 `pending`）
3. **发布态 `publishStatus`**——哪个版本对用户可用（**未发布 / 已发布 / 已被新版本替代**）

**首版不做「已撤回 withdrawn」。**  
**过期不是第四态**：用独立布尔 **`isStale`**（数据版本相对上游/配置已陈旧），不得并入 publishStatus。

检查模块「运行成功」仍可能「质量不通过」→ **不得发布**；UI 不得笼统「全部完成」或「AI 已可用」。

## 决策草案
- **D-T1** Live 相关页（tenant `quality-ops` 调试/配置/运行记录，及 workspace 只读 B6/B7）必须**同时可见**三态（只读页至少展示质量+发布+过期），禁止合并成单一进度文案。
- **D-T2** `executionMode=simulated`（对偶 `real`，不用 live）时，质量与发布不得呈现为生产可用；须有明确「模拟」标识。
- **D-T3** 三态枚举以契约为准；前端只映射展示，不在客户端推导「可发布」。`isStale` 单独渲染。
- **D-T4** 仅 Live；**禁止** Demo 内核实现三态验收路径。
- **D-T5** platform 准入测试展示 `runStatus` + **`admissionTestVerdict`**，**不做**企业 `publishStatus`（无正文权）。

## 与乙表面
| 表面 | 三态出现位置 |
| --- | --- |
| platform | 准入：`runStatus` + `admissionTestVerdict` |
| tenant | `quality-ops`：调试 run、运行记录：完整三态 + executionMode |
| workspace | B6/B7（`data-version-readonly`）：质量/发布/`isStale`；员工端首版必做 |

## Out of scope
不实现拖拽编排；不改引擎；不开源选型；不做 withdrawn。

## 落地
1. 契约枚举定稿 → 2. UI 规范补「三态 + isStale」组件说明 → 3. `quality-ops` / workspace 只读页按枚举渲染。
