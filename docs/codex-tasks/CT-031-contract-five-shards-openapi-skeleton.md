# CT-031 契约五分片 OpenAPI 骨架落盘（对齐 CT-013 / ADR-B8）

状态：架构已裁可跑 · 待 docs 入库后交老板 Mac Codex　｜　分支：`codex/ct-031-contract-five-shards-openapi-skeleton`　｜　**审查人（PR 后两人审）：架构逻辑 + 质量性能**（契约面加 **安全审查** 一眼）　｜　基准：切单时最新 `origin/main`

> **日切片：待派工日 / 可验收点**：五文件落在 `contracts/public-api/`，可被现有契约工具/门禁路径命中或至少 `ls` + JSON 可解析；**不**宣称后端已实现。  
> **挂靠**：并行轨②；QUEUE CT-031；对齐 CT-013 / `docs/architecture/契约分片-检查与能力.md` / ADR-B8 **表面改 agent-admin**（capability-registry）。  
> **总负责人不代跑**；老板 Mac 自跑 Codex。Codex 尽量用。产品/UX 不审本单体验结论。

规格依据：`docs/architecture/契约分片-检查与能力.md`；`docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md` §D8-5；现有样例 `contracts/public-api/platform-directory.openapi.json`、`error.schema.json`。

### 架构已裁（2026-10-30，本岗；DQ 可覆）

1. **只落骨架**：OpenAPI 3.1 最小 `info` + `paths` 占位 + `components.schemas` 提纲字段；响应可先 501/占位 description；**禁止**编造已实现后端、假 example 冒充 Live。
2. **capability-registry 表面**：提纲旧写 platform → **按 ADR-B8 改为 agent-admin**；路径前缀 `/api/agent-admin/v1/...`（勿再写 `/api/platform-admin/v1/capabilities` 作主路径）。
3. **五分片名固定**（不得含 governance）：`capability-registry` · `quality-check-run` · `check-flow-config` · `check-run-log` · `data-version-readonly`。
4. **不改** `apps/api/**` 实现；不生成 TS client；不删既有 `governance*.openapi.json`（旧名另单，本单不碰）。

## ① 目标与范围

- **目标**：把 CT-013 五分片 **OpenAPI 骨架文件**落到 `contracts/public-api/`，字段/枚举跟提纲与 ADR-B8；便于前后端对齐与后续 CT-015/018，**当日命令可验收**。
- **改哪些文件（允许）**：
  1. 新建（若不存在）：
     - `contracts/public-api/capability-registry.openapi.json`
     - `contracts/public-api/quality-check-run.openapi.json`
     - `contracts/public-api/check-flow-config.openapi.json`
     - `contracts/public-api/check-run-log.openapi.json`
     - `contracts/public-api/data-version-readonly.openapi.json`
  2. 可选：`contracts/public-api/README.md` 增加五行索引指针（若文件已有则追加小节，勿大改）
  3. 可选一句：`docs/codex-tasks/QUEUE.md` / 本目录 README 状态（本 docs PR 已写则实现 PR **不必**再改 QUEUE）
- **每个骨架最低要求**：
  - `"openapi": "3.1.0"`
  - `info.title` / `info.version`（建议 `0.0.0-skeleton`）/ `info.description` 写明「骨架 · 后端未实现 · 勿当 Live」
  - 至少 1～3 条 `paths`（GET 列表或资源示意即可），`operationId` 稳定英文
  - `components.schemas` 放入提纲核心类型（可精简必填）；错误可 `$ref` `./error.schema.json` 或本地 Error 占位
  - **capability-registry** 另含 ADR-B8 三维：`enterpriseFunction`、`modelVendor`、`runtimeKind`；Grant 示意 schema；路径在 `/api/agent-admin/v1/**`
  - **quality-check-run / check-flow-config / check-run-log**：tenant 表面 `/api/tenant-admin/v1/quality-ops/...`（跟提纲）
  - **data-version-readonly**：workspace `/api/workspace/v1/data-versions...`（跟提纲）；含 `isStale`、`inputVersionId`
  - 枚举跟定稿：`admissionStatus`、`admissionTestVerdict`、`runStatus`、`qualityVerdict`（含 `pending`）、`publishStatus`、`executionMode` 等（见提纲命名对照表）
- **不做什么**：
  - 不实现 Java/控制器；不改迁移；不改前端去「接假成功」
  - 不臆造未在提纲/ADR 出现的业务字段当必填
  - 不改 `com.dreamcore.*`、`/mengine-api`、`MENGINE_*`
  - 不 force push；不 `gh issue`；远程 **mengine-app**
  - 文件名/目录名不得含 `governance`

## ② 前置条件与分支名

- **⓪ 暂停令自查**：有或拿不准 → 停，问 DQ。
- **依赖**：提纲与 ADR-B8 已在 main；**不**阻塞于 CT-020-F2/F3 前端；**不**阻塞于 CT-015 端口实现。
- 仓：`~/Desktop/mengine-app-luofanghao9784`，origin=`luofanghao9784/mengine-app`。

```bash
# ⓪ 暂停令自查
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || { echo 'ERROR: remote'; exit 1; }
git status
git switch main && git pull
# 五文件应尚不存在（若已存在则本单改为「对齐补全骨架」，勿覆盖成无关内容）
ls contracts/public-api | grep -E 'capability-registry|quality-check-run|check-flow-config|check-run-log|data-version-readonly' || true
git switch -c codex/ct-031-contract-five-shards-openapi-skeleton
```

## ③ 完整 Codex 提示词

```
你在分支 codex/ct-031-contract-five-shards-openapi-skeleton。基准 origin/main。执行单：docs/codex-tasks/CT-031-contract-five-shards-openapi-skeleton.md。
提纲：docs/architecture/契约分片-检查与能力.md。ADR-B8 D8-5：docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md。
样例风格：contracts/public-api/platform-directory.openapi.json、error.schema.json。

【强制】
1. 新建五份 OpenAPI 3.1 骨架 JSON（路径见执行单①），UTF-8，可被 python -m json.tool 解析。
2. capability-registry：表面 agent-admin；paths 前缀 /api/agent-admin/v1/…；含 enterpriseFunction、modelVendor、runtimeKind、CapabilityTenantGrant 示意；admissionStatus / admissionTestVerdict 独立。
3. 其余四分片：tenant quality-ops 与 workspace data-version 按提纲；命名不得含 governance。
4. info.description 必须写明「骨架/未实现」。禁止 example 数组冒充已实现 Live 业务数据。
5. 不改 apps/api、engine、src/features、Java com.dreamcore.*、/mengine-api、MENGINE_*。
6. 共享错误优先 $ref ./error.schema.json（若相对引用在仓内惯例不通，可本地精简 Error schema 并注明）。

【验收自检】
- ls 五文件存在
- 对每个文件：python3 -m json.tool <file> >/dev/null
- rg -n 'platform-admin/v1/capabilities' contracts/public-api/capability-registry.openapi.json → 应无主路径（agent-admin 为准）
- rg -n 'governance' 五文件 → 应无（文件名/ path id / operationId）
- 若仓内有契约校验脚本且对新增文件友好，可跑；失败且仅因「骨架未注册」→ PR 说明，勿为过关改业务代码

【做完输出】diff --stat、五路径列表、自检命令输出摘要、SKIP。
```

## ④ 推荐模型与思考强度

- 模型：`gpt-6.1-sol`
- 思考强度：**medium**（结构化 JSON，对照提纲，无运行时逻辑）
- **预计耗时**：Codex 25–45 分钟；JSON 校验 5–10 分钟

## ⑤ 验收标准

| # | 标准 | 如何验 |
|---|---|---|
| V1 | 五文件存在 | `ls contracts/public-api/{capability-registry,quality-check-run,check-flow-config,check-run-log,data-version-readonly}.openapi.json` |
| V2 | JSON 合法 | 各文件 `python3 -m json.tool` 退出 0 |
| V3 | 表面正确 | capability-registry 主路径为 `/api/agent-admin/v1/...`；描述含骨架/未实现 |
| V4 | 命名 | 五文件与 path/operationId **无** `governance` 分片名 |
| V5 | 范围 | diff 几乎只有 `contracts/public-api/*.openapi.json`（+可选 README 指针）；无 `apps/api` 业务实现 |
| V6 | 门禁（若触发） | 本单新引入契约红必须说明或清；基线已知红举证 |

## ⑥ 跑完如何提交

```bash
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || exit 1
git add contracts/public-api/capability-registry.openapi.json \
  contracts/public-api/quality-check-run.openapi.json \
  contracts/public-api/check-flow-config.openapi.json \
  contracts/public-api/check-run-log.openapi.json \
  contracts/public-api/data-version-readonly.openapi.json
# 若改了 README 指针：git add contracts/public-api/README.md
git diff --cached --stat | grep -E 'apps/api/src|engine/src|com/dreamcore' && echo 'ERROR: 禁区' && exit 1
git commit -m "$(cat <<'EOM'
docs(contracts): CT-031 五分片 OpenAPI 骨架（agent-admin 表面）

对齐 CT-013 提纲与 ADR-B8；骨架未实现，勿当 Live。
EOM
)"
git push -u origin codex/ct-031-contract-five-shards-openapi-skeleton
gh pr create -R luofanghao9784/mengine-app --base main --head codex/ct-031-contract-five-shards-openapi-skeleton \
  --title "docs(contracts): CT-031 契约五分片 OpenAPI 骨架" \
  --body "## 摘要
落盘五 OpenAPI 骨架；capability-registry 表面 agent-admin（ADR-B8）。未实现后端。

## 验收
\`\`\`bash
ls contracts/public-api/{capability-registry,quality-check-run,check-flow-config,check-run-log,data-version-readonly}.openapi.json
python3 -m json.tool contracts/public-api/capability-registry.openapi.json >/dev/null
\`\`\`

## 审查
架构逻辑 + 质量性能（安全一眼）
勿自动合并

## 非范围
Java 实现、前端接假 Live、governance 旧名清理"
```

网页备用：https://github.com/luofanghao9784/mengine-app/compare/main...codex/ct-031-contract-five-shards-openapi-skeleton

## ⑦ 禁止操作 / 失败卡住

| 症状 | 动作 |
|---|---|
| 暂停令 | 停；问 DQ |
| remote 错 | 停 |
| JSON 非法 | 修到 `json.tool` 绿 |
| 误写 platform-admin 作 capability 主路径 | 改回 agent-admin |
| 契约门禁因骨架报红 | PR 说明；勿改业务骗绿；问架构/质量 |
| 误改 apps/api | `git restore`；报 DQ |

**硬禁止**：臆造已实现后端；假 Live examples；改 `com.dreamcore.*` / `/mengine-api` / `MENGINE_*`；force push；直推 main；`gh issue`；含口令。

回滚：`git switch main && git branch -D codex/ct-031-contract-five-shards-openapi-skeleton`。

---

**DQ 审路径**：本文件 + QUEUE CT-031 行。通过后交老板 Mac 粘贴③。
