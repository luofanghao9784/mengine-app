# 乙 · 表面落点说明（已拍板 · 含员工端 B6/B7）

日期：2026-10-30 · 老板锁定乙 · 员工端首版含 B6+B7（不作后置）· 已定稿进仓

## 一句话
**platform = 能力登记与准入；tenant = 单模块调试、流程配置、运行记录与回退；workspace = 数据版本与问题只读（B6/B7）。**  
全程 Live，禁 Demo。

## 功能 × 表面

| 功能 | 表面 | data-surface | 契约分片 | 建议 feature | 禁止 |
| --- | --- | --- | --- | --- | --- |
| 能力目录 / 版本 / 准入测试 / 候选→可用 | platform | `platform-admin` | capability-registry | `capability-admission` | 读客户正文；挂 Demo |
| 单模块调试（获准样本） | tenant | `tenant-admin` | quality-check-run | `quality-ops` / debug | 自动发布；旧 governance 单页 id |
| 检查流程配置与版本发布/回退 | tenant | `tenant-admin` | **check-flow-config** | `quality-ops` / config | 放宽企业强制校验；分片名含 governance |
| 运行记录 / 失败重试 | tenant | `tenant-admin` | **check-run-log** | `quality-ops` / runs | 同 attempt 混多配置版本当正常 |
| 数据版本 / 问题只读（B6/B7） | **workspace** | `workspace` | **data-version-readonly** | `data-version`（或新路由模块） | 员工端发起 publish/debug；塞进旧 governance |

> ~~「治理结果只读挂 tenant，workspace 入口后置」~~ **已作废**。老板锁定员工端首版即含 B6+B7。

## 与 ADR
- D1：上述全部 Live，不得依赖 `src/demo` / 根 store。
- D3：新页**不要**并入或复用 `tenant-admin/governance` 旧 HTML 作为新系统 id；新 path / feature 用 `quality-ops` 等。
- D5：platform / tenant / workspace 各有路由模块职责。

## 权限提醒
平台能力登记权 ≠ 客户资料正文访问权。tenant 持调试/配置；workspace 员工只读本空间版本与问题。

## 开源
本轮不提名、不选型。
