# CT-020-F3 agent-admin versions / grants 子视图只读 UI

状态：架构已裁可跑 · 待 docs 入库后交老板 Mac Codex　｜　**正式岗** id=`ec838a2d-d838-48cd-a789-e1af1424a7f3`　｜　分支：`codex/ct-020-f3-versions-grants-readonly`　｜　**审查人（PR 后两人审）：发布验收 + 质量性能**（触及 ADR-B8 边界加 **架构逻辑**）　｜　基准：切单时最新 `origin/main`（须含 F1 `8428d1b` + F2 实现 `fd99aba` / #5）

> **✅ #5 已合 `fd99aba`，执行单合入后可派前端实现**（依赖：F1 壳 + F2 实现 catalog 种子/空态 + 登记面板骨架）。  
> **日切片：待派工日 / 可演示点**：Mac 本机打开 `#view=capability-registry&tab=versions` 与 `&tab=grants`：子视图可切换；列表只读空态或骨架表；**写按钮 disabled + 文案**（写 API 未就绪 / CT-018）。禁止假 Live 行。  
> **口径（QUEUE 现行硬性）**：已有页**可改功能**，风格/动效/交互勿偏离现 agent-admin（F1+F2）；无新端入口。正式岗 id=`ec838a2d-d838-48cd-a789-e1af1424a7f3`。  
> **挂靠**：QUEUE 前端·F3 / CT-020；并行轨①；叠在 F2 之上。体验交 UX（专职）；本单不写体验结论主责。  
> **总负责人不代跑**；老板/正式前端岗在 Mac 自跑 Codex。Codex 尽量用。

规格依据：`docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md`（D8-3 tabs：`catalog|versions|admission-tests|grants`；本 F3 只做 **versions + grants**）；F2：`docs/codex-tasks/CT-020-F2-capability-registry-main-path.md`；契约：`docs/architecture/契约分片-检查与能力.md`（OpenAPI 骨架见 CT-031，本单**不**臆造字段冒充成功）。

> **脚注（路由名）**：ADR-B8 正文仍写 `#view=capability-admission`；**本 F3 继续以 QUEUE/DQ 的 `#view=capability-registry` 为准**。  
> **脚注（admission-tests）**：`&tab=admission-tests` 本单**不深化**（可继续「即将提供」）；写入/四眼/准入跑通属 CT-018，禁止本单实现。

### 架构已裁（2026-10-30，本岗；DQ 可覆）

1. **只读 UI**：versions / grants 做可切换子视图 + 只读空态/骨架表；写操作一律 disabled + 明确文案。
2. **无假数据**：禁止演示假 ModuleVersion / Grant 行冒充 API Live；有只读探测且可安全解析时才只读渲染并标注来源。
3. **实现派工**：#5 已合 `fd99aba`；**本执行单合入 docs 后即可派前端实现**（仍须暂停令自查）。

## ① 目标与范围

- **目标**：在 **已合 F1+F2** 壳上做出「versions / grants」**日可演示**只读子视图：tab 可切、主区只读、写按钮 disabled + 文案。仍不落真实写 API、不做 CT-018。
- **相对 F2 的增量边界（只做这些）**：
  1. **`&tab=versions`**：可切换进入；主区展示「版本」只读空态或骨架表头（如 moduleVersion / admissionStatus / enterpriseFunction 列名占位即可）；无 OpenAPI 定稿时**禁止**填假行。写/退役/准入变更按钮 **disabled**，文案含「写 API 未就绪（CT-018）」或等价。
  2. **`&tab=grants`**：可切换进入；主区展示「租户授权」只读空态或骨架表头（如 tenant / enterpriseFunction / default 占位）；写/设默认按钮 **disabled** + 同上文案。禁止假 Grant 行。
  3. **tab 切换**：侧栏或页内 tabs 在 `catalog` ↔ `versions` ↔ `grants` 可点；hash 同步（`&tab=`）；刷新保持当前 tab。
  4. **catalog / 登记面板**：保持 F2 行为；本单不改登记提交语义（仍 disabled / CT-018）。
  5. **只读探测（可选增强）**：可沿用 F2 `probeCapabilities`；失败→空态；成功可解析且字段与提纲明显一致才只读渲染并标「来自只读 API」。勿臆造字段映射。
  6. **样式**：只改 `src/features/agent-admin/**`；**勿偏离**现 agent-admin / tenant-admin 同系。
- **改哪些文件（允许）**：
  - `src/features/agent-admin/AgentAdminApp.tsx`（及同目录小组件，如 `VersionsPanel.tsx` / `GrantsPanel.tsx`）
  - `src/features/agent-admin/agent-admin.css`
  - `src/features/agent-admin/client.ts`（只读探测增强允许；禁止写方法假装成功）
  - `src/features/agent-admin/routes.ts`（tab 解析如需）
  - **禁止**新建第四端入口或改 vite/main 白名单
- **不做什么（非范围）**：
  - 本 docs 未合入前勿抢跑实现分支（执行单合入后可派）
  - 不实现 CT-018：登录写入、四眼 RETIRE、授权写、准入测试跑通
  - 不做 `&tab=admission-tests` 深化（可仍「即将提供」）
  - 不改 `apps/api/**`、`engine/**`、`com.dreamcore.*`、迁移、OpenAPI 定稿（OpenAPI 骨架归 CT-031）
  - 不改 `/mengine-api`、`MENGINE_*`；远程保持 **mengine-app**
  - 不 import `src/demo/`；不挂空谷 Demo
  - 禁止假 Live / 假成功 toast / 假 POST
  - 禁止 gh issue create/comment；只允许 `gh pr create -R luofanghao9784/mengine-app`
  - 体验结论主责交 UX；本单只保证可切换 + 只读 + disabled 文案可验收

### 风格约束（强制）

| 情形 | 要求 |
|---|---|
| **已有页（本单）** | 可改功能；风格/动效/交互**勿偏离**现 F1+F2 agent-admin 与 tenant-admin 同系 |
| **QUEUE** | 「编制·前端开发」硬性 5 条；正式岗 id=`ec838a2d-d838-48cd-a789-e1af1424a7f3` |

### 后端贴合点（只读对齐，本单不实现后端）

| 项 | 路径/约定 |
|---|---|
| ADR | D8-3 tabs；D8-5 Grant；API `/api/agent-admin/v1/**` |
| 契约 | 提纲 + CT-031 骨架；无定稿勿臆造写死假成功 |
| 企业端功能 | 启用闭集不变；首版演示仍偏 `quality-check` |

## ② 前置条件与分支名

- **⓪ 暂停令自查（第一步，优先级最高）**：开 Codex 前确认 DQ/总负责人**没有暂停令**；有或拿不准 → **立刻停**，问 DQ。
- **依赖**：F1 `8428d1b` + F2 实现 `#5` / `fd99aba` 已在 main。切分支前用 `git merge-base --is-ancestor fd99aba HEAD` 自检。
- 正确仓：`~/Desktop/mengine-app-luofanghao9784`（origin=`luofanghao9784/mengine-app`）。
- Java 包名 `com.dreamcore.*`、`/mengine-api`、`MENGINE_*` **勿改**。

```bash
# ⓪ 暂停令自查：无暂停令再继续
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || { echo 'ERROR: 错误 remote，停'; exit 1; }
git status
git switch main && git pull
git merge-base --is-ancestor 8428d1b HEAD || { echo 'ERROR: 缺 F1'; exit 1; }
git merge-base --is-ancestor fd99aba HEAD || { echo 'ERROR: 缺 F2 #5 fd99aba'; exit 1; }
git switch -c codex/ct-020-f3-versions-grants-readonly
```

## ③ 完整 Codex 提示词

把下面整段交给 Codex（推荐 `$CODEX` + 模型 `gpt-6.1-sol`，思考强度 **medium**）：

```
你在梦擎仓库分支 codex/ct-020-f3-versions-grants-readonly 上工作。基准 origin/main（须已含 F1 8428d1b 与 F2 #5 fd99aba）。只做本单范围。执行单全文：docs/codex-tasks/CT-020-F3-versions-grants-readonly.md。ADR-B8：docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md（D8-3/D8-5）。F2 参考：docs/codex-tasks/CT-020-F2-capability-registry-main-path.md。现网壳：src/features/agent-admin/*。

【口径·强制】
- QUEUE 硬性：已有页可改功能，风格/动效/交互勿偏离现 agent-admin。
- 正式前端岗 id=ec838a2d-d838-48cd-a789-e1af1424a7f3。
- 验收 URL：/agent-admin/#view=capability-registry&tab=versions 与 &tab=grants。
- 只读：写按钮必须 disabled +「写 API 未就绪（CT-018）」类文案；禁止假 Live、假 POST、成功 toast。
- 勿改 com.dreamcore.*、/mengine-api、MENGINE_*；远程 luofanghao9784/mengine-app。
- 体验结论交 UX；本单保证可切换与只读可验收即可。

【A. tabs】
1. 打开 AgentAdminApp：确认 F2 catalog 种子/空态 + 登记面板仍在。
2. 让 versions、grants 从「即将提供」变为可进入的只读子视图；admission-tests 可仍「即将提供」。
3. hash `&tab=` 与 UI 同步；刷新保持 tab。

【B. versions 只读】
- 空态或骨架表头（勿假行）。
- 任何写/退役/变更按钮 disabled + CT-018 文案。

【C. grants 只读】
- 空态或骨架表头（勿假 Grant）。
- 写/设默认按钮 disabled + CT-018 文案。

【D. client】
- 只读探测失败→空态；成功可安全解析才只读展示并标注来源；无 OpenAPI 定稿勿臆造字段。

【E. 风格】
- 只改 src/features/agent-admin/**。复用现 css / admin-theme。勿另起皮肤。

【不许碰】
apps/api/**、engine/**、workers/parser 业务、dist/** 手改、docs/architecture/** 大改、.local/**、口令、force push、reset --hard、直推 main、gh issue。
禁止 import src/demo/；禁止实现真实写入；禁止深化 admission-tests 写入。

【本地预览与验收】
export PREVIEW_HOME="$HOME/Library/Application Support/DreamcorePreview-ct006"
# 目标 web 50832 / api 50831；以 preview-health 实际 webUrl 为准：
# http://127.0.0.1:50832/agent-admin/#view=capability-registry&tab=versions
# http://127.0.0.1:50832/agent-admin/#view=capability-registry&tab=grants
npm run build
浏览器：catalog↔versions↔grants 可切；两 tab 只读；写钮 disabled；无假列表；网络无假写请求。

【做完输出】git diff --stat、关键 hunk、验收 URL、SKIP 清单。
```

## ④ 推荐模型与思考强度

- 模型：`gpt-6.1-sol`
- 思考强度：**medium**（在 F2 壳上加两只读 tab，无后端写逻辑）
- **预计耗时**：Codex 20–40 分钟；build + 预览点开 15–25 分钟

## ⑤ 验收标准

日可演示（Mac `127.0.0.1`，端口以预览为准；约定目标 web=`50832`）：

| # | 标准 | 如何验 |
|---|---|---|
| V1 | versions 可进 | `http://127.0.0.1:50832/agent-admin/#view=capability-registry&tab=versions` 主区为只读空态/骨架，非死链 |
| V2 | grants 可进 | 同上 `&tab=grants` |
| V3 | tab 切换 | catalog ↔ versions ↔ grants 可点；刷新保持 tab |
| V4 | 写禁用 | 两 tab 内写类按钮 disabled，文案含「写 API 未就绪」或 CT-018 |
| V5 | 无假 Live | 无演示假版本/授权行冒充 API 成功 |
| V6 | F2 不回退 | catalog 种子/空态 + 登记面板骨架仍可用 |
| V7 | build 绿（本单范围） | `npm run build`；本单新引入红必须清 |

备用开发态：`http://127.0.0.1:5173/agent-admin/#view=capability-registry&tab=versions`（仅样式核对）。

## ⑥ 跑完如何提交

```bash
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || exit 1
git add src/features/agent-admin
git diff --cached --stat | grep -E 'apps/api|engine/src|workers/parser|com/dreamcore' && echo 'ERROR: 禁区' && exit 1
git commit -m "$(cat <<'EOM'
feat(agent-admin): CT-020-F3 versions/grants 只读子视图

F2 之上：versions/grants 可切换只读；写按钮 disabled（CT-018）。
EOM
)"
git push -u origin codex/ct-020-f3-versions-grants-readonly
gh pr create -R luofanghao9784/mengine-app --base main --head codex/ct-020-f3-versions-grants-readonly \
  --title "feat(agent-admin): CT-020-F3 versions/grants 只读子视图" \
  --body "## 摘要
F2 壳上 versions/grants 只读可切换；写按钮 disabled（CT-018）。

## 可演示
- http://127.0.0.1:50832/agent-admin/#view=capability-registry&tab=versions
- http://127.0.0.1:50832/agent-admin/#view=capability-registry&tab=grants

## 审查
- 两人审：发布验收 + 质量性能（边界加架构逻辑）
- 正式岗 id=ec838a2d-d838-48cd-a789-e1af1424a7f3
- 勿自动合并

## 非范围
CT-018 写入、admission-tests 深化、假 Live、OpenAPI 臆造"
```

网页备用：https://github.com/luofanghao9784/mengine-app/compare/main...codex/ct-020-f3-versions-grants-readonly

## ⑦ 禁止操作 / 失败卡住

| 症状 | 动作 |
|---|---|
| main 缺 `fd99aba` | 立刻停；先 pull 含 #5 的 main |
| remote 不是 mengine-app | 立刻停 |
| 有暂停令 | 不开 Codex；问 DQ |
| build 因本单红 | 修到绿；禁止 skip |
| 预览端口非 50832 | 以实测 webUrl 为准；PR 写明 |
| API 401/404 | **预期**；空态，勿造假 |
| 误改 apps/api / dreamcore / mengine-api | `git restore`；报 DQ |
| CONFLICT / push rejected | `git pull --rebase` 一次；仍失败停发 DQ |

**硬禁止**：
- 本执行单未合 docs 前抢跑实现（合入后可派）
- `git push --force` / `-f` / `--force-with-lease`、`git reset --hard`、直推 `main`
- 假 Live、假成功、import `src/demo/`、实现 CT-018 写入
- 改 `com.dreamcore.*` / `/mengine-api` / `MENGINE_*`
- `gh issue create/comment`；含口令提交
- 有暂停令仍开 Codex

回滚（未合入）：`git switch main && git branch -D codex/ct-020-f3-versions-grants-readonly`。

---

**DQ 审路径**：本文件 + QUEUE F3 行。**#5 已合**；本执行单合入 docs 后即可交老板/前端岗 Mac 粘贴③开跑。
