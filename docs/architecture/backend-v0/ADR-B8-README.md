# ADR-B8 第四端边界——统一 agent 管理平台（已裁定、架构逻辑有条件通过，条件已并入）

- 主稿：`ADR-B8-第四端边界-统一agent管理平台.md`
- 作者：梦擎·系统架构｜基线 main `a2a41d5`｜纯文档：不改业务代码
- 审阅：专家·架构逻辑 + 测试审查联签；安全审查；交付运维；发布验收

## 状态
**已裁定；专家·架构逻辑有条件通过（2026-10-30），B1–B3 必改与四条建议已并入**。

## 决策摘要
1. 第四端 = 五维登记与实现生命周期（登记、版本、准入、授权、deprecated/强制下线）**唯一写入口**；租户调试/配置/发布/运行仍在 tenant-admin；平台账号与租户开通（含授予 `AGENT_ADMIN`）仍在 platform-admin。
2. **〔DQ 已定〕A1 整体迁入第四端，编号仍为 A1；platform-admin 只留外链。**
3. **〔DQ 已定〕`AGENT_ADMIN` 与 `PLATFORM_ADMIN` 独立，互不包含。** 独立 cookie `DREAMCORE_AGENT`（Path `/api/agent-admin/`）、独立安全链、`realm='agent'`；会话无租户，不构造 `ExecutionScope`；总部支持会话不能进入。
4. **〔DQ 已定〕页面 `/agent-admin/`，API `/api/agent-admin/v1/**`。**
5. **〔DQ 已定〕第四端登录与写入后端单列 PR 5b**（安全审查、架构逻辑、测试审查必审）。
6. 后端新顶层包 `com.dreamcore.workspace.agentregistry`，单向依赖 `capability`（只读 `CapabilityCatalogPort`）；qualityops 不依赖它；ArchUnit R-B8-1…7。
7. `enterpriseFunction`（按实施计划 PR2 取值清单）：启用 `document-parse`、`table-compare`、`quality-check`；预留不启用 `semantic-annotation`、`repair-suggestion`。首版演示登记闭环只用 `quality-check`；另两个启用值以种子只读可见，`table-compare` 在 Linux 标不可用。**已确认**（架构逻辑）
8. 权限主体：`QUALITY_OPS_MODULE_REGISTER`、`QUALITY_OPS_MODULE_RETIRE`、`QUALITY_OPS_MODULE_ENABLE_GLOBAL`、`QUALITY_OPS_LIMITS_CEILING` 归 `AGENT_ADMIN`；RETIRE 四眼（两个不同 `AGENT_ADMIN`），演示需两个账号——与 `./S-07-real模式权限码与审计字段-定稿.md` 一致。
9. 前端全 Live，`agent-admin/index.html` + `src/features/agent-admin/`。

## 仍待他方定（非 DQ）
depcruise `agent-admin-isolated` 是否首版加（测试审查）；`deploy-plan.md:89/:114` 补第四端（交付运维）。

## 引用复核（定稿轮，对 main `a2a41d5` 逐条 `sed -n`）
修正 13 处：`PlatformIdentity.java:41-44`→`:42-44`；`:30-32` 拆为 `:30`/`:32`；`PlatformSecurity` 补 `:31`/`:33`；`IdentityService` 补 `:119`；角色清单事实补源码行（`PlatformStaffService.java:33/:95/:96-97/:138`、`PlatformIdentity.java:60/:181`、`IdentityService.java:172`）；新增 `WorkAudienceService.java:43`（DB 角色 vs 展示角色）、`SupportAccess.java:26`；必验页文档补 `:56`；契约分片 `:28-29` 拆分；审查流程 v1.1 路径改为 store `dreamcore-qa/`；`vite.config.ts:8-16` 保留并注明 `site/vite.config.ts:18` 为官网构建；实施计划基线行 `:573`→`:599-600`。其余引用（main.tsx、session.tsx、AccessApp.tsx、index.html、架构文档、deploy-plan）核对无误。

## 对实施计划的影响（基线 28 人日）
ADR-B8 文档 PR +0.5；PR1 +0.25；PR2 +0.5；**PR 5b +3**；PR7a +1；PR7 +0.25 → **+5.5**。关键路径 …5 → 5b → 6…（或 5b ∥ 6）。总计见实施计划 §11.12a（含安全复核增量 +2.5，合计 36；S-13 PR 8a 另 +1 首版外）。

## 自检
- 无环、无跨层：agentregistry → capability 单向；qualityops ↛ agentregistry；前端 agent-admin 不 import 其他端 feature ✓
- 一实体一写入方：登记/版本/准入/下线/全局启用仅第四端；租户开关/调试/发布仅 tenant-admin ✓
- 三文档术语一致（ADR-B8 / followup2+S-07 定稿 / 实施计划）：`AGENT_ADMIN`、`QUALITY_OPS_*`、ADR-B7、PR 5b、`enterpriseFunction` 五值 ✓
- 引用已全部复核 ✓

## 架构逻辑审后修订（2026-10-30）
- B1：`qo_capability_tenant_grant (tenant_id, enterprise_function) WHERE is_default` 部分唯一索引；无 default → `CAPABILITY_DEFAULT_NOT_CONFIGURED`；用例 `grant_single_default_per_tenant_function`、`resolve_without_default_fails_closed`（§D8-5）。
- B2：D8-1 补「本租户启停（仅限已授权版本）」行，与 `CapabilityTenantGrant` 两实体各一写者（§D8-1）。
- B3：登记表清单 + 写者包、CI grep 门禁、读侧只走 `CapabilityCatalogPort`（§D8-4）。
- 建议①`engine-http` 不对外；②`ENTERPRISE_FUNCTION_NOT_ENABLED` + `enterpriseFunction_reserved_notEnabled`；③`agentregistry.security` 归 Api 层；④推翻条件 3 联动 S-07。
- `enterpriseFunction` 闭集：已确认。
- DQ 并入：第四端会话新建独立表 `agent_platform_accounts`/`agent_platform_sessions`（不加 realm 列；V55 先例），表名〔PR 时与后端开发确认〕。
