# 梦擎 · 后端架构 follow-up2（安全必改 + S-07 定稿 + ADR-B8 · 相对 #13）

> 基线：origin/main `a2a41d5`（含 #13 `8df9868`）。纯文档 PR，不改业务代码。ADR-B8 摘要见 [ADR-B8-README.md](./ADR-B8-README.md)。

| 文件 | 本轮 |
| --- | --- |
| [ADR-B1-首版边界-新包与只读上游.md](./ADR-B1-首版边界-新包与只读上游.md) | **已改**：新增「安全边界」（S-01/S-04/S-07/S-10、Live 空数据）、「安全审查问题答复 Q1–Q3」；租户维改授权边界；UpstreamReadPort 全限定名；命名表加 capability/upstream 包 |
| [ADR-B2-统一Capability执行端口.md](./ADR-B2-统一Capability执行端口.md) | **已改**：新增「包结构与依赖方向（M2/M3）」「安全决策 S-01–S-12」（含 Linux 平台基线表）「端口安全验收」；tenantId 移出请求体；白名单代码硬编码 |
| [02-目标分层.md](./02-目标分层.md) | **已改**：端口签名、白名单、依赖方向、Linux 基线 |
| [04-风险与ADR提纲.md](./04-风险与ADR提纲.md) | **轻改**：R8/R9 |
| [安全必改处理表-S01-S16.md](./安全必改处理表-S01-S16.md) | **改名并扩至 S-16**：按安全复核逐行改状态，补 S-13–S-16 |
| [S-07-real模式权限码与审计字段-定稿.md](./S-07-real模式权限码与审计字段-定稿.md) | **新增**：S-07 定稿（安全 + 架构逻辑已双签，有条件已并入） |
| [实施计划同步要点.md](./实施计划同步要点.md) | **新增**：供实施计划引用 |
| [ADR-B8-第四端边界-统一agent管理平台.md](./ADR-B8-第四端边界-统一agent管理平台.md) / [ADR-B8-README.md](./ADR-B8-README.md) | **新增**：第四端边界（架构逻辑有条件通过，条件已并入） |
| 01 / 03 / FOLLOWUP 附录 | 未改 |

## 相对 #13 的变更摘要

1. **S-01 P0**：tenant/space 只来自认证上下文；`tenantId` 不进请求体，端口 `execute(ExecutionScope, req)`；`inputRef` 为签发句柄；`EXECUTION_SCOPE_MISMATCH`。
2. **S-02 P0（显式修正 #12/#13）**：删除「白名单改为由 ModuleVersion 注册」；白名单/配方**代码硬编码**，数据与登记不能改；ModuleVersion 只引用 `recipeId`；仅 platform 登记 + 双人审批。
3. **S-03** limits 只能收紧；**S-05** 不得放宽、收紧须经安全审 + Linux 生产基线表（macOS 仅开发）；**S-06** model-agent 八项启用前置；**S-07** real 权限码建议名 + 审计（actor、traceId、inputHash），待安全草案后定稿；**S-08** 密钥决策 + BYOK 预留首版不开放；**S-10** 租户维 = 授权边界。
4. **S-04** UpstreamReadPort 强制 `TenantScope` + 只读数据源；**S-09/S-11/S-12** 进验收或 backlog，S-12 残留 unit 进 PR4 必验。
5. **M2/M3**：`com.dreamcore.workspace.capability`、`com.dreamcore.workspace.upstream.UpstreamReadPort`；三条依赖方向；ProcessBuilder 仅 `capability.adapter..`，例外仅 2 类。
6. DQ 裁定：总部支持会话对 qualityops 只读（执行/发布强制拒绝）；ModuleVersion 废弃=可跑+禁新绑+不自动切，强制下线单独操作需权限码+审计。
7. 代拍：首版 Live 空数据；Q1–Q3 只读核实答复。

## 安全复核修订（2026-10-30，截止 11:00 北京时间）
S-04 用例分到 PR3/PR6 + 只读截止；S-07 定稿；S-13 attempt 独立 token（PR 8a，model-agent 前置）；S-10 `sessionKind`；S-02 机制在 PR2 定；S-14 基线补列 + ADR-B7；S-11 PR0 必需；S-15 WeKnora 已核实 + `:35` fail closed（PR6）；S-16 待定项挂 PR/日期；角色术语分 DB/展示。

## 自检
- 无环、无跨层：qualityops→capability/upstream 单向；agentregistry→capability 单向；适配器不鉴权只收 `ExecutionScope` ✓
- 一实体一写入方：ModuleVersion 登记/下线/全局启用=第四端 `AGENT_ADMIN`；租户开关/调试/发布=tenant-admin；`qo_audit_event` 只追加 ✓
- 三文档术语一致（followup2 / ADR-B8 / 实施计划）：`QUALITY_OPS_*`、`AGENT_ADMIN`、PR 5b、PR 8a、ADR-B7、`sessionKind` ✓
- 引用已对 main `a2a41d5` 复核 ✓

## 双签后修订（2026-10-30，DQ 定直接写入）
- S-07：S1 审计必填加 `enterprise_function`、重新计数为全域必填 19 项；S2 `actor_realm` 四域 + 按域必填 `tenant_id`/`space_id` + `target_tenant_id` + CHECK 草案 + `audit_realm_tenant_consistency`；S3 拆 `QUALITY_OPS_MODULE_ENABLE_GLOBAL/_TENANT`、`QUALITY_OPS_LIMITS_CEILING/_TIGHTEN` + 两条越权用例；R5 措辞；审计事件统一 `QUALITY_OPS_` 前缀。
- 安全条件：Q-E MEMBER 默认不授 dry + `member_without_grant_dry_run_forbidden`；AGENT_ADMIN 跨租户诊断读入审计（`target_tenant_id`）；`/api/v1/system/info` 收到登录后挂 PR7；PR6 复合外键建议（`knowledge_remote_index(tenant_id, knowledge_base_id)` → `knowledge_index_targets`，P2 不阻塞）。
- ADR-B8 同期修订见 `ADR-B8-第四端边界-统一agent管理平台.md`（B1–B3 + 四条建议）。

## DQ 并入（后端答复采纳，2026-10-30）
- S-07 §3：`qo_audit_event` 只追加实现——uuid 主键、`occurred_at` 微秒截断、`(tenant_id, occurred_at)` 索引、应用账号只授 INSERT/SELECT、BEFORE UPDATE OR DELETE RAISE（先例实为 V109/V115；V55 仅提供 RAISE 触发器风格）；PR3 验收与用例 12 对齐。
- ADR-B8 §D8-2 / §D8-4 / §5：第四端独立会话表 `agent_platform_accounts`/`agent_platform_sessions`（V55 先例：跨域触发器、级联吊销、复用公共令牌哈希与 CSRF），表名〔PR 时与后端开发确认〕。
