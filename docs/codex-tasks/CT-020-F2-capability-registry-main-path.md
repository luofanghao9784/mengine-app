# CT-020-F2 agent-admin 能力注册→主流程（catalog 种子/空态 + 登记面板骨架）

状态：架构已裁可跑 · 待 docs 入库后交老板 Mac Codex　｜　**正式岗** id=`ec838a2d-d838-48cd-a789-e1af1424a7f3`　｜　分支：`codex/ct-020-f2-capability-registry-main-path`　｜　**审查人（PR 后两人审）：发布验收 + 质量性能**（触及 ADR-B8 边界加 **架构逻辑**）　｜　基准：切单时最新 `origin/main`（须含 F1 `8428d1b`）

> **日切片：2026-10-30 / 可演示点**：Mac 本机打开 `/agent-admin/#view=functions` → `#view=capability-registry&tab=catalog`：catalog **登记种子**（`quality-check` 可进登记；`document-parse`/`table-compare` 只读种子）与 **Live 空态**分明；点「登记第一个实现」打开**登记主路径面板**（表单骨架，提交 disabled /「写 API 未就绪（CT-018）」）。禁止假 Live 列表。  
> **口径（QUEUE 现行硬性）**：已有页**可改功能**，风格/动效/交互勿偏离该现页（本单改 F1 已合的 agent-admin）；无新端入口。见 `docs/codex-tasks/QUEUE.md`「编制·前端开发」硬性 5 条。  
> **挂靠**：QUEUE 前端·F2 / CT-020；**叠在 F1 壳之上**；衔接 CT-018（本单**不做**登录写入）。  
> **总负责人不代跑**；老板在 Mac 自跑 Codex，整段粘贴下方③即可。Codex 尽量用；本岗可直接起草，不等总监排版过手。

规格依据：`docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md`（D8-3 / D8-6 / D8-7）；F1 执行单：`docs/codex-tasks/CT-020-F1-agent-admin-capability-shell.md`；摸底：`docs/codex-tasks/摸底纪要-四端-20261030-前端F1.md`；契约提纲：`docs/architecture/契约分片-检查与能力.md`（OpenAPI 文件尚未落盘，勿臆造后端字段冒充成功）。

> **脚注（路由名）**：ADR-B8 正文仍写 `#view=capability-admission`；**本 F2 继续以 QUEUE/DQ 的 `#view=capability-registry` 为准**。  
> **脚注（种子 ≠ Live）**：本单「种子」= 前端闭集**登记种子说明卡**（企业端功能启用值），明确标「登记种子 / 只读种子」；**不是** API 返回的 `ModuleVersion` Live 列表。无 OpenAPI 定稿、无真实列表响应时，**禁止**编造假 Live 成功行。


### 架构已裁（2026-10-30，本岗；DQ 可覆）

1. **种子一律前端静态闭集卡**（本稿如此）；**不等**后端 ModuleVersion 种子 API。后端种子 API 另片（F4/CT-015 方向）。
2. **登记 UI**：抽屉或居中对话框均可，**Codex 自选**，须仿 tenant-admin 同系交互；验收不绑一种控件。
3. **深链**：可选 `…&tab=catalog&register=1` 打开面板；**不挡** V1–V5；有则加测，无则从按钮进入即可。

## ① 目标与范围

- **目标**：在 **已合 F1 壳**（`8428d1b`）上做出老板定的「**能力注册→主流程**」**日可演示**闭环：  
  `functions` → `capability-registry`（`tab=catalog`）→ 看清 **种子 vs Live 空态** → 「登记第一个实现」进入可演示的**登记主路径**（面板/抽屉内表单骨架）。仍不落真实写 API、不做 CT-018 登录写入。
- **相对 F1 的增量边界（只做这些）**：
  1. **catalog 分区**：在 `#view=capability-registry&tab=catalog` 把主区拆成两块（同页上下或左右均可，风格跟现 agent-admin / tenant-admin）：  
     - **登记种子区**：至少展示三个启用企业端功能种子卡——`quality-check`（可登记 / CTA）、`document-parse`（只读种子）、`table-compare`（只读种子；可旁注 Linux「运行时不可用」文案，勿做成可写）。预留功能码（`semantic-annotation` / `repair-suggestion`）可一行「未启用」或不展示，勿假装可登记。  
     - **Live 已登记实现区**：明确空态（「尚无 Live 已登记实现」+ 连接状态沿用 F1 `probeCapabilities`）；**禁止**用演示假 `ModuleVersion` 填满冒充 API 成功。  
  2. **「登记第一个实现」可点开主路径**：按钮**可点**（相对 F1 的整钮 disabled）→ 打开抽屉/对话框「登记实现」面板；关闭可回 catalog。  
  3. **表单骨架（只读/占位，不提交成功）**：  
     - `enterpriseFunction`：**固定** `quality-check`（只读展示，不可改成其他功能码）  
     - `modelVendor`（或文案等价 vendor）：占位输入/下拉，无后端校验  
     - `runtimeKind`：占位，默认示意 `in-process`（可 disabled 选项）  
     - 可选占位：`capabilityKey` / `moduleVersion` 文案框（如示意 `pii-regex` / `v1`），**勿**声称已写入  
     - **提交按钮**：`disabled`，旁注或按钮文案明确「写 API 未就绪（CT-018）」；禁止 toast「登记成功」、禁止假 POST  
  4. **只读探测**：保留/微调 F1 `probeCapabilities`（`GET /api/agent-admin/v1/capabilities`）。`ok+json` 仅更新连接态文案；**若响应体有可解析列表且字段与提纲明显一致**，可只读渲染，并标「来自只读 API」；解析失败 / 401 / 404 / 非 JSON / 空数组 → Live 区显式空态。无 OpenAPI 定稿时**不要**臆造字段映射写死假成功行。  
  5. **functions 页衔接**：`quality-check` 卡 CTA 仍指向 `#view=capability-registry&tab=catalog`；可选在 catalog 种子卡上提供「从本种子登记」深链打开同一登记面板（`enterpriseFunction` 仍锁 `quality-check`）。  
  6. **样式**：改 `src/features/agent-admin/agent-admin.css`（及必要时极小 JSX 结构）；**勿偏离**现 agent-admin / tenant-admin 日光壳（侧栏、面板圆角、badge、焦点环、动效）。
- **改哪些文件（允许）**：
  - `src/features/agent-admin/AgentAdminApp.tsx`（主；可拆小组件同目录，如 `CatalogPanel.tsx` / `RegisterDrawer.tsx`）
  - `src/features/agent-admin/agent-admin.css`
  - `src/features/agent-admin/client.ts`（只读探测增强允许；禁止写方法假装成功）
  - `src/features/agent-admin/routes.ts`（若需 query 如 `register=1` 打开面板；可选）
  - **禁止**为本单新建第四端入口或改 vite/main 白名单（F1 已完成）
- **不做什么（非范围）**：
  - 不实现 CT-018：真实 `AGENT_ADMIN` 登录写入、四眼 RETIRE、授权写、准入测试跑通
  - 不改 `apps/api/**`、`engine/**`、Java 包名 `com.dreamcore.*`、迁移、OpenAPI 定稿文件
  - 不改 `/mengine-api`、`MENGINE_*` 标识；远程/本地路径保持 **mengine-app**
  - 不做 F3：versions/grants 可写或完整只读表（tab 可继续「即将提供」）
  - 不做 F4：强制对接真实列表契约（有则顺带只读，无则空态）
  - 不 import `src/demo/`；不挂空谷 Demo
  - 不修改本执行单范围外的 QUEUE 大段；本 docs PR 仅允许同步 F2 日切片行 / 编号冻结一行
  - 禁止 gh issue create/comment；只允许 `gh pr create -R luofanghao9784/mengine-app`
  - **禁止假 Live**：空 Live 列表不得填演示用假 ModuleVersion 冒充已从 API 加载成功；种子卡必须视觉/文案上与 Live 区分

### 风格约束（老板原口径 · 强制）

| 情形 | 要求 |
|---|---|
| **已有页（本单）** | agent-admin 已有壳：**可改功能**；风格/动效/交互**勿偏离**现 F1 页与 tenant-admin 同系 |
| **QUEUE 引用** | 「编制·前端开发」硬性 5 条；正式岗 id=`ec838a2d-d838-48cd-a789-e1af1424a7f3` |

### 后端贴合点（只读对齐，本单不实现后端）

| 项 | 路径/约定 |
|---|---|
| ADR | D8-3 入口 `/agent-admin/`；D8-6 目录与全 Live；D8-7 首版演示登记闭环**只用** `quality-check`；`document-parse`/`table-compare` 只读种子 |
| API 前缀 | `/api/agent-admin/v1/**`（本单仅 GET 探测/可选只读列表；写待 CT-018） |
| 契约 | `docs/architecture/契约分片-检查与能力.md`；目标 `contracts/public-api/capability-registry.openapi.json` **尚未存在** |
| 企业端功能 | 启用：`document-parse`、`table-compare`、`quality-check`；预留：`semantic-annotation`、`repair-suggestion` |

## ② 前置条件与分支名

- **⓪ 暂停令自查（第一步，优先级最高）**：开 Codex 前确认 DQ/总负责人**没有暂停令**；有或拿不准 → **立刻停**，问 DQ。暂停期间禁止任何 Codex。
- **依赖**：F1 已合 main（`8428d1b` / PR #36）；CT-006 预览宜可用；**不**阻塞于 CT-018。
- 正确仓：`~/Desktop/mengine-app-luofanghao9784`（origin=`luofanghao9784/mengine-app`）。禁止写上游 / 旧归档仓。
- Java 包名 `com.dreamcore.*`、路径 `/mengine-api`、`MENGINE_*` **勿改**。

```bash
# ⓪ 暂停令自查：无暂停令再继续
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || { echo 'ERROR: 错误 remote，停'; exit 1; }
git status   # 应 clean；否则 stash 见 README 固定步骤
git switch main && git pull
git log -1 --oneline | grep -q .  # 确认含 F1：git merge-base --is-ancestor 8428d1b HEAD
git merge-base --is-ancestor 8428d1b HEAD || { echo 'ERROR: main 缺少 F1 8428d1b，停'; exit 1; }
git switch -c codex/ct-020-f2-capability-registry-main-path
```

## ③ 完整 Codex 提示词

把下面整段交给 Codex（推荐 `$CODEX` + 模型 `gpt-6.1-sol`，思考强度 **medium**；sandbox/审批与组内既有 CT 一致）：

```
你在梦擎仓库分支 codex/ct-020-f2-capability-registry-main-path 上工作。基准 origin/main（须已含 F1 8428d1b）。只做本单范围。执行单全文：docs/codex-tasks/CT-020-F2-capability-registry-main-path.md。ADR-B8：docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md（D8-3/D8-6/D8-7）。F1 参考：docs/codex-tasks/CT-020-F1-agent-admin-capability-shell.md。现网壳：src/features/agent-admin/*、agent-admin/index.html。

【口径·强制】
- QUEUE 硬性：已有页可改功能，风格/动效/交互勿偏离现 agent-admin（仿 tenant-admin 同系）。
- 正式前端岗 id=ec838a2d-d838-48cd-a789-e1af1424a7f3。
- 验收主 URL：/agent-admin/#view=capability-registry&tab=catalog；主流程从 #view=functions 点进。
- 第四端=平台级模型能力与 Agent 注册（ADR-B8），不是店员聊天机器人，不挂空谷 Demo。
- 种子 ≠ Live：登记种子是前端闭集说明卡；禁止假 ModuleVersion 冒充 API Live 成功列表。
- 首版演示登记闭环只用 quality-check；document-parse / table-compare 只读种子。
- 不写后端；提交按钮必须 disabled 或明确「写 API 未就绪（CT-018）」。
- 勿改 com.dreamcore.*、/mengine-api、MENGINE_*；远程是 luofanghao9784/mengine-app。

【A. catalog：种子 / 空态分明】
1. 打开并理解现有 AgentAdminApp.tsx：F1 已有 functions 五卡、registry tabs、catalog 空态 + disabled「登记第一个实现」、probeCapabilities。
2. 在 tab=catalog 主区改为：
   - 「登记种子」区块：quality-check（可登记）、document-parse（只读种子）、table-compare（只读种子）。badge/文案必须能一眼区分。
   - 「Live 已登记实现」区块：默认显式空态文案（尚无 Live 已登记实现 / 尚未连接后端等，跟 probe 状态）。禁止塞假列表。
3. versions/grants 保持「即将提供」，本单不深化。

【B. 登记主路径面板】
1. 「登记第一个实现」改为可点击，打开抽屉或对话框（仿 tenant-admin 面板层次与动效）。
2. 表单骨架字段：
   - enterpriseFunction：固定显示 quality-check（只读）
   - modelVendor：占位
   - runtimeKind：占位，默认示意 in-process
   - 可选 capabilityKey / version 占位
3. 主提交按钮 disabled；可见说明「写 API 未就绪（CT-018）」。禁止假 POST、禁止成功 toast。
4. 可关闭面板回到 catalog；URL 可用 hash/query 记录打开态（可选，如 register=1），刷新行为合理即可。

【C. client】
- 保留 GET /api/agent-admin/v1/capabilities 探测。
- 失败→Live 空态；成功且可安全解析列表才只读展示并标注来源；否则空态。无 OpenAPI 定稿勿臆造字段写死假成功。

【D. 风格】
- 只改 src/features/agent-admin/**（及必要同目录新文件）。复用 admin-theme / 现 agent-admin.css 语义色与圆角。
- 勿另起无关皮肤；勿大改侧栏信息架构。

【不许碰】
apps/api/**、engine/**、workers/parser 业务、dist/** 手改、docs/architecture/** 大改、.local/**、含口令提交、force push、reset --hard、直推 main、gh issue create/comment。
禁止 import src/demo/；禁止假 Live 列表；禁止实现真实写入。
勿改 Java 包名 dreamcore、/mengine-api、MENGINE_*。

【本地预览与验收】
export PREVIEW_HOME="$HOME/Library/Application Support/DreamcorePreview-ct006"
# 预览 web 目标 50832 / api 50831；以 preview-health / start 实际 webUrl 为准：
# http://127.0.0.1:50832/agent-admin/#view=functions
# http://127.0.0.1:50832/agent-admin/#view=capability-registry&tab=catalog
开发态可用 npm run dev（5173）核对样式；日节点验收以 PREVIEW_HOME 预览为准。

必做检查：
- npm run build   # 本单引入的红必须清
- 浏览器主路径：functions → catalog → 看见种子与 Live 空态分明 → 点「登记第一个实现」→ 面板打开且提交 disabled/CT-018 文案
- 网络面板：无假成功写请求；GET 失败时 UI 仍为空态而非假列表
- rg 确认未引入 src/demo、未改 apps/api

【做完输出】git diff --stat、关键 hunk、验收 URL 与可演示步骤文字、SKIP 清单。
```

## ④ 推荐模型与思考强度

- 模型：`gpt-6.1-sol`
- 思考强度：**medium**（在已有壳上加分区 + 抽屉表单，无后端写逻辑）
- **预计耗时**：Codex 落盘 25–45 分钟；本地 build + 预览点开 15–30 分钟

## ⑤ 验收标准

日可演示（Mac `127.0.0.1`，端口以预览实测为准；约定目标 web=`50832`）：

| # | 标准 | 如何验 |
|---|---|---|
| V1 | 主路径可点 | 打开 `http://127.0.0.1:50832/agent-admin/#view=functions` → 点 quality-check「查看能力登记」→ 到达 catalog |
| V2 | 种子 / 空态分明 | `http://127.0.0.1:50832/agent-admin/#view=capability-registry&tab=catalog` 同时可见：登记种子卡（含可登记的 quality-check + 只读种子）与 Live 空态区；无假 Live 行 |
| V3 | 登记主路径面板 | 点「登记第一个实现」→ 面板/抽屉打开；`enterpriseFunction=quality-check` 固定；vendor/runtimeKind 占位可见 |
| V4 | 不写后端 | 提交按钮 disabled 或文案含「写 API 未就绪（CT-018）」；无成功写入、无假 POST |
| V5 | 探测失败仍诚实 | API 401/404/网络失败时 Live 区为空态文案，不填假列表 |
| V6 | 风格不漂 | 仍为 agent-admin / tenant-admin 同系日光壳；侧栏可切换 functions ↔ registry |
| V7 | build 绿（本单范围） | `npm run build` 通过；本单新引入红必须清 |

备用开发态：`http://127.0.0.1:5173/agent-admin/#view=capability-registry&tab=catalog`（仅样式核对，不以代替预览验收）。

## ⑥ 跑完如何提交

```bash
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || exit 1
# 按实际改动暂存（勿 add 口令/.local）
git add src/features/agent-admin
git diff --cached --stat | grep -E 'apps/api|engine/src|workers/parser|com/dreamcore' && echo 'ERROR: 禁区' && exit 1
git commit -m "$(cat <<'EOM'
feat(agent-admin): CT-020-F2 能力注册主路径（种子/空态+登记面板骨架）

F1 壳之上：catalog 种子与 Live 空态分明；登记面板可演示；写入待 CT-018。
EOM
)"
git push -u origin codex/ct-020-f2-capability-registry-main-path
gh pr create -R luofanghao9784/mengine-app --base main --head codex/ct-020-f2-capability-registry-main-path \
  --title "feat(agent-admin): CT-020-F2 能力注册→主流程可演示增量" \
  --body "## 摘要
在 F1 壳上完成能力注册→主流程：catalog 登记种子/Live 空态分明 +「登记第一个实现」面板骨架（写 API 待 CT-018）。

## 可演示
- http://127.0.0.1:50832/agent-admin/#view=functions
- http://127.0.0.1:50832/agent-admin/#view=capability-registry&tab=catalog
- PREVIEW_HOME=~/Library/Application Support/DreamcorePreview-ct006

## 审查
- 两人审：发布验收 + 质量性能（边界加架构逻辑）
- 正式岗 id=ec838a2d-d838-48cd-a789-e1af1424a7f3
- 口径：已有页可改功能，风格勿偏现 agent-admin
- 勿自动合并

## 非范围
CT-018 登录写入、假 Live 数据、versions/grants 可写、OpenAPI 臆造"
```

网页备用：https://github.com/luofanghao9784/mengine-app/compare/main...codex/ct-020-f2-capability-registry-main-path

## ⑦ 禁止操作 / 失败卡住

| 症状 | 动作 |
|---|---|
| remote 不是 luofanghao9784/mengine-app | 立刻停；换正确仓 |
| 有暂停令 | 不开 Codex；问 DQ |
| main 无 F1 `8428d1b` | 停；先确认 F1 已合 |
| build 因本单红 | 修到绿；禁止 skip/放宽 |
| 预览无 50832 | 查 preview-health / start 实际 webUrl；PR 写明实测端口 |
| API 401/404 | **预期**；Live 空态，勿造假数据 |
| 误改 apps/api / dreamcore 包名 / mengine-api | `git restore` 禁区；报 DQ |
| CONFLICT / push rejected | `git pull --rebase` 一次；仍失败停发 DQ |

**硬禁止**：
- `git push --force` / `-f` / `--force-with-lease`、`git reset --hard`、直推 `main`、写上游
- 假 Live 列表、假登记成功、import `src/demo/`
- 实现 CT-018 写入 / 改 Java `com.dreamcore.*` / 改 `/mengine-api` 或 `MENGINE_*`
- `gh issue create/comment`；回报或提交含口令
- 有暂停令仍开 Codex

回滚（未合入）：`git switch main && git branch -D codex/ct-020-f2-capability-registry-main-path`。

---

**DQ 审路径**：本文件 `docs/codex-tasks/CT-020-F2-capability-registry-main-path.md` + QUEUE F2 行。通过后交老板 Mac 粘贴③开跑（或正式前端岗自跑）。
