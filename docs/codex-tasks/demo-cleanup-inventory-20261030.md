# Demo / 脏代码清理清单（架构逻辑 · 只读）

- 日期：2026-10-30（Asia/Shanghai）
- 扫描基线：`/workspace/dreamcore`（已 `git fetch origin main`；工作树当时在 `docs/queue-frontend-slices`，路径以仓内现文件为准）
- 老板口径：演示用 / Demo / 脏数据 / 无用代码一律删；**须保留** CT-027-B 正式预览合成包与正式 mock 边界
- **安全标**：2026-10-30 安全审查已对 §三/§四签字（同意日1不动冲突；日切片可跑）
- **须留 / 可删理由以** [`/workspace/security-review/清理边界-安全意见.md`](/workspace/security-review/清理边界-安全意见.md) **为准**；架构仅补路径展开与「Live 仍引用」冲突标注
- 范围：代码与脚本；`docs/**` 中仅作说明的假路径**不当代码删**（本表不列 docs 删除项）
- 建议取值：`须保留` / `可删` / `待安全标` / `冲突待架构×安全`

## 汇总

| 建议 | 条数（路径行） |
| --- | ---: |
| 须保留 | 20 |
| 可删 | 26 |
| 安全已标（原待标） | 4（须留壳/须留/可删分支/架构细分） |
| 冲突·日1禁止 | 5（安全同意） |

> 条数为下表「路径」行（目录行算 1 条）；`src/store.tsx` / `src/model.ts` / `src/main.tsx` 在「可删」与「冲突」各出现一次：意图可删，但须先解 Live 边。细文件删改另开日切片。

---

## 一、须保留（误删 = P0 / 正式预览与安全边界）

| 路径 | 建议 | 理由 | 备注 |
| --- | --- | --- | --- |
| `scripts/preview/preview-common.sh` | 须保留 | 安全：正式预览合成包；只听 127.0.0.1、`QUALITY_OPS_REAL_ENABLED=false` | **CT-027-B** 正式预览合成包（仓内无独立 CT-027-B 执行单文件；按安全「正式预览合成包」对齐本目录） |
| `scripts/preview/preview-doctor.sh` | 须保留 | 同上；预览环境探测 | CT-027-B |
| `scripts/preview/preview-install.sh` | 须保留 | 同上；实例目录与 secrets 0700/0600 | CT-027-B |
| `scripts/preview/preview-start.sh` | 须保留 | 同上；绑 127.0.0.1、parser 默认 off、穿透检测 | CT-027-B |
| `scripts/preview/preview-stop.sh` | 须保留 | 同上 | CT-027-B |
| `scripts/preview/preview-health.sh` | 须保留 | 同上；四端 + actuator 暴露面 + 仅 127.0.0.1 签字条件 | CT-027-B |
| `scripts/preview/preview-uninstall.sh` | 须保留 | 同上；卸载前备份 | CT-027-B |
| `scripts/preview/preview-seed-accounts.py` | 须保留 | 安全：账号 bootstrap **脚本机制**须留（口令只写 secrets，不打印）；非正式业务假种子 | CT-027-B；勿删脚本，可清本地 `seed-accounts.json` 临时值 |
| `scripts/local/trial.py` | 须保留 | 预览 start 依赖；本机实例编排 | 与 CT-006/CT-027-B 链路 |
| `.gitignore`（含 `.local/`、`secrets/` 忽略） | 须保留 | 安全：密钥目录忽略规则；清理不得删 | 只清本地临时 key，不改规则 |
| `apps/api/**/identity/**` 及会话/cookie/`platform_roles`/`memberships` 相关 | 须保留 | 安全：认证与会话 | 路径通配；清理 PR 触及须安全必审 |
| 带 `tenant_id`/`space_id` 的迁移、查询谓词、`ExecutionScope`、跨租户负向测试 | 须保留 | 安全：租户/空间隔离 | 同上 |
| Env/secret 注入、模型 key / bridge key **加载代码**、htpasswd/`PREVIEW_*` **配置模板（无口令值）** | 须保留 | 安全：密钥与凭据机制 | 不含 `.local/**` 内真实口令文件 |
| Capability 执行端口、parser 白名单、沙箱 fail-closed | 须保留 | 安全：执行端口 / parser |  |
| `identity_audit`、拟建 `qo_audit_event` 及拒 UPDATE/DELETE 触发器 | 须保留 | 安全：审计 |  |
| 跨租户拒绝 / real 须授权 / 支持会话只读等具名负向测试 | 须保留 | 安全：越权/沙箱负向测试 | 正式测试夹具 |
| `contracts/fixtures/*.json`（如 `dataset-briefing.json` 等） | 须保留 | 正式契约/预览合成应答夹具；标「正式测试夹具」 | site/demo mock 引用其一，夹具本身保留 |
| `tests/fixtures/**`、`engine/tests/fixtures/**`、`apps/api/src/test/**` 合成账号与夹具 | 须保留 | 正式契约/集成测试夹具（合成邮箱与口令仅测试） | 标「正式测试夹具」；非 Demo 页 |
| `workspace/index.html`、`tenant-admin/index.html`、`platform-admin/index.html` 及 Live `src/identity/main.tsx` 入口 | 须保留 | 安全：正式三端静态入口；预览 health 签字面 | 勿与根 `index.html` Demo 入口混淆 |
| `scripts/draft-storage-fixture.ts` | 须保留 | Playwright 旅程用正式测试夹具（配额失败模拟） | 标「正式测试夹具」 |

---

## 二、可删（占位 Demo / 假数据 / 废弃通道）

| 路径 | 建议 | 理由 | 备注 |
| --- | --- | --- | --- |
| `index.html`（仓库根） | 可删 | 安全：根路径演示内核入口；正式预览不应部署 | 删时须同步改 `vite.config.ts` 多页入口，避免配置回退（安全红线 §3） |
| `src/main.tsx`（`DemoBootstrap` / `/native-conversations` 特例） | 可删 | 安全：DemoBootstrap 根演示启动 | Live 走 `src/identity/main.tsx`；native 特例须确认迁到 Live 入口后再删 |
| `src/ninepop/Bootstrap.tsx`（`DemoBootstrap`） | 可删 | 安全：DemoBootstrap；同源可调真实 API |  |
| `src/kongguSources.ts`（`enterprise-ai-demo-konggu-v1`） | 可删 | 安全：仅 Demo 的 localStorage 键 |  |
| `src/kongguSeed.ts` / `src/kongguStorage.ts` / `src/kongguResearch.ts` / `src/kongguBriefing.ts` / `src/kongguReply.ts` | 可删 | 安全：Demo 专用 seed 业务行；假经营数据 | **不当** CT-027-B 正式预览包 |
| `src/store.tsx`（`useDemo` / Konggu localStorage） | 可删 | 安全：仅服务 Demo 的 store | 须先切断 `src/components/**` 对 `useDemo` 的边（见冲突节） |
| `src/model.ts` 中仅 `DemoState` 与演示模型 | 可删 | 同上（整文件是否可删取决于 Live 是否仍 import） | 若 Live 仍引用 → 先抽类型再删，见冲突 |
| `src/pages/**`（Briefing/Library/Conversation/Workspace/Tools/Colleagues） | 可删 | ADR：仅被演示使用的 pages |  |
| `src/workspaceExamples.ts` | 可删 | Demo 工作空间示例升级逻辑 | 确认无 Live 引用后删 |
| `src/colleagues.ts`（Demo 协作） | 可删 | 仅 Demo 协作模拟 |  |
| `scripts/package-demo.py` | 可删 | 旧「空谷」转发 ZIP 打包；非正式预览 CT-027-B | 与 `docs/交接/Demo转发与启动.md` 说明对应，文档本身不删代码 |
| `scripts/serve-demo.mjs` | 可删 | 旧转发包静态服；非正式 preview-start | `package.json` script `demo` 一并去掉 |
| `scripts/package-website-demo.py` / `scripts/serve-website-demo.mjs` | 可删 | 官网 Demo 打包/服；非 Mac 正式预览 |  |
| `package.json` → `"demo"` / `"demo:9pop"` 脚本与包名 `enterprise-ai-workspace-demo`（改名另议） | 可删（脚本） | 指向上述废弃 Demo 启动 | 包名重命名非本清单强制 |
| `scripts/ninepop/private-data.ts`（`/__private-demo/`） | 可删 | 安全：本地私有演示数据通道 |  |
| `scripts/ninepop/start.mjs` 及仅服务 `__private-demo` 的九朴 Demo 启动链 | 可删 | 同上 | `ninepop` 下采集/治理脚本若仍服务正式接入 → 勿整目录删，见待安全标 |
| `test-data/ninepop-20261021/**`（含 `ninepop-dev.tar.gz`） | 可删 | 安全：客户样例/假明细；预览用空数据 | 删前确认无正式验收 CI 引用 |
| `src/ninepop/adapter.ts` 等仅 Demo 适配（`boss.9pop.top` 演示基址） | 可删 | 盘点：演示适配不当正式客户端基址 | 若采集链路仍用 → 待安全标 |
| `site/demo/index.html` | 可删 | 离线装 mock 再挂 Live 客户端的占位 Demo 页 |  |
| `site/src/demo/boot.ts` / `mock-api.ts` / `isolation.ts` | 可删 | 合成接口 + 浏览器状态隔离；占位 Demo | 正式夹具 JSON 保留在 `contracts/fixtures` |
| `scripts/meizu/generate_demo.py` / `scripts/meizu/create_demo_cards.py` | 可删 | 合成美租演示材料生成 |  |
| `scripts/local/seed_meizu_demo.py` | 可删 | Demo 租户业务行种子（非账号 bootstrap 机制） | 对比：`preview-seed-accounts.py` 须留 |
| `scripts/local/seed_admin_merge_acceptance.py` 中纯演示业务行（若有） | 可删 | Demo 专用 seed 业务行 | 若属正式验收账号编排 → 待安全标 |
| `src/briefingExamples.ts` / `src/briefingV2Examples.ts` | 可删 | 仅演示用示例卡片数据 |  |
| 依赖 Konggu key 的 e2e：`tests/e2e/konggu.spec.ts`、`briefing-*.spec.ts`（写 `enterprise-ai-demo-konggu-v1` 者）、`tests/konggu.test.ts`、`tests/e2e/ninepop.spec.ts`（`__private-demo`） | 可删 | 随 Demo 内核/私有通道一并退役 | 正式 Live e2e 保留 |
| `tests/ninepop-import.test.ts`（测 `__private-demo`） | 可删 | 同上 |  |

---

## 三、安全标（原「待安全标」· 2026-10-30 安全签字）

| 路径 | 安全标 | 理由 | 备注 |
| --- | --- | --- | --- |
| `scripts/ninepop/**`（除已可删的 `private-data.ts` / Demo `start.mjs`） | **架构细分** | 非认证/租户/执行端口整树不由安全拦；服务正式接入的采集/governance **须留** | 若含 SSH/口令/连接串 → 凭据禁入库、清理不得改写进仓 |
| `src/admin/prototype/**`、`tenant-admin/prototype/**` | **须留壳** | ADR D3 第一期独立入口；整树不删 | 非正式根 Demo 内核 |
| `src/admin/prototype/SceneShell.tsx` 无企业时演示时钟 | **可删演示分支，留壳** | 占位演示逻辑 | 日2+；日1不动 prototype 整树 |
| `agent-admin` health 留位（仓内尚无正式目录） | **须留** | 正式预览合成相关 | 改建归 F1；日1勿动 |

---

## 四、冲突（安全同意 · 日1禁止动）

安全 2026-10-30：全部同意架构建议——**日1禁止动**；先抽 Live 边 / 迁 `/native-conversations` 到 identity 后再开日2。`evolution-demo` / `engine-demo` **不是**安全须留，只是 Live 仍引用；抽纯函数改名即可，勿整删断 Live。

| 路径 | 安全标 | 理由 | 备注 |
| --- | --- | --- | --- |
| `src/operations/engine-stage/evolution-demo.ts`（及 site 副本） | **日1禁止**；日2+ 抽纯函数改名 | Live `EngineStage3D`/`scene` 仍 import；非安全须留 | 勿整删 |
| `src/operations/engine-demo.ts`（及 site 副本） | **日1禁止**；日2+ 抽纯函数改名 | Live/`busyDemo` 仍引用；非安全须留 | 勿整删 |
| `src/briefing*.ts`/`.css`（除 Examples）与绑 `useDemo` 的 `src/components/**` | **日1禁止** | 须先抽 shared/briefing-live | 日2 |
| `src/store.tsx` / `src/model.ts`（切断 Live 边前） | **日1禁止** | 大量 components/pages 依赖 | 日2 |
| `src/main.tsx` 中 `/native-conversations` | **日1：未迁则 SKIP 整文件** | 迁到 identity/Live 后再删 | 安全同意日切片 SKIP 口径 |

---

## 五、明确不在「可删代码」之列

| 对象 | 说明 |
| --- | --- |
| `docs/**` 交接/产品中的 Demo 说明、假路径举例 | 文档；不按代码删 |
| `.local/**`、htpasswd、bridge key **文件内容** | 不得入库；只删本地临时预览 key，不删加载代码与 gitignore |
| `--bootstrap-admin` / `preview-seed-accounts.py` | 机制保留 |
| CT-027-B = `scripts/preview/**`（+ `trial.py` 预览链路） | 正式预览合成包，**须保留** |

---

## 六、建议日切片（一句话）

**日切片**：先卸根 Demo 入口与 Konggu/ninepop 私有通道及 `package-demo`/`serve-demo`（不动 `scripts/preview/**` 与正式三端入口），保证 `preview-start` → `preview-health` 仍只听 127.0.0.1 且 workspace / tenant-admin / platform-admin（及留位 agent-admin）可开；evolution-demo / 根 briefing 与 components 的 Live 边另开「抽 shared 再删」切片，冲突项须架构×安全签字后再动。

---

## 七、依据摘要

- 老板：演示/脏数据删；CT-027-B 预览合成包与正式 mock 边界留
- 安全意见：`/workspace/security-review/清理边界-安全意见.md`
- ADR：`docs/architecture/ADR-前端模块边界-演示与正式分家.md`
- 盘点：`docs/architecture/frontend-inventory.md`
