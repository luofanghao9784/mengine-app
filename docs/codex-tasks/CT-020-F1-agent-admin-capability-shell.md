# CT-020-F1 agent-admin 能力注册壳（模型能力 / Agent 登记 · 可演示增量）

状态：架构有条件可跑 · 质量 P1 修订 · 纯 docs 入库　｜　**正式岗** id=`ec838a2d-d838-48cd-a789-e1af1424a7f3`　｜　分支：`codex/ct-020-f1-agent-admin-capability-shell`　｜　**审查人（PR 后两人审）：发布验收 + 质量性能**（触及 ADR-B8 边界加 **架构逻辑**）　｜　基准：切单时最新 `origin/main`

> **日切片：2026-10-30 / 可演示点**：Mac 本机打开 `/agent-admin/#view=functions` 与 `/agent-admin/#view=capability-registry`（空态 +「登记第一个实现」按钮可见；风格仿 tenant-admin）。  
> **口径（QUEUE 现行硬性）**：已有页可改功能，风格/动效/交互勿偏离该现页；**无页必须仿** tenant-admin（含动效）。见 `docs/codex-tasks/QUEUE.md`「编制·前端开发」硬性 5 条（head `794bac4` 起）。  
> **挂靠**：QUEUE 前端·F1 / CT-020（PR 7a）前端首片；衔接 CT-018（PR 5b 登录与写入，本单**不做**）。  
> **总负责人不代跑**；老板在 Mac 自跑 Codex，整段粘贴下方③即可。

规格依据：`docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md`、`ADR-B8-README.md`；摸底：`docs/codex-tasks/摸底纪要-四端-20261030-前端F1.md`；契约提纲：`docs/architecture/契约分片-检查与能力.md`（OpenAPI 文件尚未落盘，勿臆造后端）。

> **脚注（路由名）**：ADR-B8 正文仍写 `#view=capability-admission`；**本 F1 以 QUEUE/DQ 的 `#view=capability-registry` 为准**，后续再改 ADR。

## ① 目标与范围

- **目标**：把第四端从「文档/预览留位」推进到 **可点开的 agent-admin 壳**：按企业端功能浏览（`#view=functions`）+ 能力/Agent 登记空态页（`#view=capability-registry`，默认 `tab=catalog`），按钮「登记第一个实现」可点出**占位登记面板或明确 disabled+说明**（本单不落真实写 API）。本地预览可演示，禁止假数据冒充 Live 已登记列表。
- **改哪些文件（允许）**：
  1. **新增** `agent-admin/index.html`（`data-surface="agent-admin"`，入口脚本对齐现有三端：走 `src/identity/main.tsx` 或 ADR 规定的壳装配方式；标题如「统一 Agent 管理 · 梦核工作空间」）
  2. **修改** `vite.config.ts`：`build.rollupOptions.input` **追加** `'agent-admin/index.html'`（勿删现有条目）
  3. **修改** `src/identity/main.tsx`：白名单加入 `agent-admin`；分支渲染第四端壳（`realm='agent'` 的 SessionProvider **可先挂上**；若 agent 会话 client 未就绪，本单允许「免登浏览壳」——页面可渲染，调用 `/api/agent-admin/v1/**` 失败时显式空态/401 文案，**禁止**用 mock 列表冒充成功）
  4. **修改** `src/identity/session.tsx`（及类型）：`realm` 增加 `'agent'` 分支骨架（独立 CHANGE_KEY；无后端时登录按钮可显示「后端未就绪」）；**禁止**把 agent 会话混进 customer/platform cookie 路径
  5. **新增** `src/features/agent-admin/`：路由表、壳布局、Functions 页、CapabilityRegistry 页（catalog 空态）、轻量 client（只读 GET 探测，失败→空态）
  6. **新增** `src/features/capability-admission/`（若本单把 A1 空态页放这里）：由 agent-admin 壳装配；**或**先全部放在 `src/features/agent-admin/` 内、目录注释标明后续可拆——二选一，优先少文件、边界清晰
  7. **样式**：复用/扩展 `src/admin/admin-theme.css` 选择器，使 `[data-surface='agent-admin']` 享受与 tenant-admin **同系** D′ 日光（暖白、侧栏、品牌蓝/香槟金语义）；可新增 `src/features/agent-admin/agent-admin.css` 做动效（过渡、空态入场），**视觉语言仿 tenant-admin，不得另起无关空壳皮肤**
  8. **可选最小**：`platform-admin` 导航加「统一 Agent 管理」外链 → `/agent-admin/`（同窗口；文案注明需单独登录）。不做则在 PR 说明「外链改 F2」
  9. **构建校验**：若存在 `scripts/verify-built-entries.mjs` 生产入口清单，**追加** `agent-admin`（与现有 workspace/tenant-admin/platform-admin 同级）
- **不做什么（非范围）**：
  - 不实现 CT-018：真实 `AGENT_ADMIN` 登录写入、四眼 RETIRE、授权写、准入测试跑通
  - 不改 `apps/api/**`、`engine/**`、Java 迁移、OpenAPI 定稿文件（可只读引用提纲）
  - 不改 workspace 空谷 Demo、不 import `src/demo/`
  - 不整页复制 tenant-admin 的**业务导航条目**（成员/资料/引擎等）；仿的是**壳与风格/交互**，路由跟 ADR-B8 / 本单 F1 URL
  - 不做 versions/grants 可写 UI（F3）；catalog 有种子 API 前只做空态（F2 再接列表）
  - 不修改 `docs/codex-tasks/QUEUE.md` 排队状态（本单为纯前端壳；QUEUE 现行硬性已对齐）
  - 禁止 gh issue create/comment；只允许 `gh pr create -R luofanghao9784/mengine`
  - 禁止假 Live：空列表不得填演示用假 ModuleVersion 冒充已从 API 加载成功

### 风格约束（老板原口径 · 强制）

| 情形 | 要求 |
|---|---|
| **无页（本单 agent-admin）** | **仿 tenant-admin**：侧栏+主区、日光主题、导航焦点/折叠、按钮与空态层次、适度动效与人机反馈（hover/focus/空态 CTA） |
| **已有页**（本单若只加 platform 外链） | 可改功能，**风格与交互勿偏离现页** |
| **QUEUE 引用** | 以 QUEUE「编制·前端开发」现行硬性为准（已有页勿偏现页；无页仿 tenant-admin） |

### 后端贴合点（只读对齐，本单不实现后端）

| 项 | 路径/约定 |
|---|---|
| ADR | `docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md`（D8-3 入口、D8-6 前端目录、D8-7 空态+「登记第一个实现」） |
| API 前缀 | `/api/agent-admin/v1/**`（cookie Path `/api/agent-admin/`；本单仅探测，401/网络失败→空态） |
| 契约提纲 | `docs/architecture/契约分片-检查与能力.md` §1；目标文件 `contracts/public-api/capability-registry.openapi.json`（**尚未存在**，勿编造字段写死假成功） |
| 企业端功能闭集（展示用文案） | 启用：`document-parse`、`table-compare`、`quality-check`；预留：`semantic-annotation`、`repair-suggestion`。F1：`functions` 页可列出闭集为**只读卡片**；仅 `quality-check` 卡片 CTA 指向 registry；其余标「只读种子/未启用登记」 |
| 权限码（文案级） | `QUALITY_OPS_MODULE_REGISTER` 等归 `AGENT_ADMIN`（S-07 定稿）；本单不调写接口 |

## ② 前置条件与分支名

- **⓪ 暂停令自查（第一步，优先级最高）**：开 Codex 前确认 DQ/总负责人**没有暂停令**；有或拿不准 → **立刻停**，问 DQ。暂停期间禁止任何 Codex。
- **依赖**：CT-006 预览脚本宜已可用（本机可起 web/api）；**不**阻塞于 CT-018。口径对齐 QUEUE 现行硬性（`794bac4` 起）。
- 正确仓：`~/Desktop/mengine-luofanghao9784`（origin=`luofanghao9784/mengine`）。禁止写上游。
- Codex 绝对路径见下。

```bash
# ⓪ 暂停令自查：无暂停令再继续
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine' || { echo 'ERROR: 错误 remote，停'; exit 1; }
git status   # 应 clean；否则 stash 见 README 固定步骤
git switch main && git pull
git switch -c codex/ct-020-f1-agent-admin-capability-shell
```

## ③ 完整 Codex 提示词

把下面整段交给 Codex（推荐 `$CODEX` + 模型 `gpt-6.1-sol`，思考强度 **medium**；sandbox/审批与组内既有 CT 一致）：

```
你在梦擎仓库分支 codex/ct-020-f1-agent-admin-capability-shell 上工作。基准 origin/main。只做本单范围。执行单全文：docs/codex-tasks/CT-020-F1-agent-admin-capability-shell.md。摸底：docs/codex-tasks/摸底纪要-四端-20261030-前端F1.md。ADR-B8：docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md。

【口径·强制】
- 老板：无页仿 tenant-admin；已有页可改功能但风格与交互勿偏离现页。
- 口径对齐 QUEUE「编制·前端开发」现行硬性：已有页可改功能但风格交互勿偏现页；无页必须仿 tenant-admin。
- 验收 URL：/agent-admin/#view=functions 与 /agent-admin/#view=capability-registry（可 &tab=catalog）。
- 第四端=平台级模型能力与 Agent 注册（ADR-B8），不是店员聊天机器人，不挂空谷 Demo。

【A. 入口】
1. 新增 agent-admin/index.html：lang=zh-CN；引入 /browser-compat.js；#root data-surface="agent-admin"；script type=module 指向与现端一致的 identity 入口（src/identity/main.tsx），除非你拆出更清晰的 AgentAdminApp 仍由 main 分支挂载。
2. vite.config.ts input 追加 'agent-admin/index.html'。
3. src/identity/main.tsx：白名单含 agent-admin；渲染 Agent 壳；SessionProvider realm 支持 'agent'（骨架即可）。
4. session.tsx：realm='agent' 骨架（独立 CHANGE_KEY）；无后端时允许免登看壳。

【B. 功能目录 src/features/agent-admin/】
1. 自有路由模块（D5）：解析 location.hash。支持：
   - #view=functions（默认首页）
   - #view=capability-registry，子 tab：catalog|versions|grants（F1 只要求 catalog 空态可点开；versions/grants 可显示「即将提供」或 disabled）
2. 壳布局仿 tenant-admin AdminShell：侧栏导航（企业端功能、能力登记）、主区、折叠、键盘焦点；主题挂 data-surface=agent-admin，复用 admin-theme.css 日光语义，可加轻动效。
3. functions 页：展示 EnterpriseFunction 闭集五卡（document-parse / table-compare / quality-check / semantic-annotation / repair-suggestion）。quality-check 可进 registry；其它标明只读种子或未启用，不可假装可登记。
4. capability-registry &tab=catalog：空状态文案清晰 + 主按钮「登记第一个实现」。点击：打开占位抽屉/对话框（字段只读说明或表单 disabled），写明「写入 API 待 CT-018 / PR 5b」；或按钮暂时 disabled 且旁注同样说明。禁止提交假成功。
5. client：对 /api/agent-admin/v1/ 只读探测（如 capabilities 列表）。401/404/网络错误 → 空态，UI 标明「尚未连接后端或未登录」，不得填假 ModuleVersion。

【C. 可选】platform-admin 导航加外链到 /agent-admin/（风格勿偏离现页）。verify-built-entries 若存在则登记 agent-admin。

【不许碰】
apps/api/**、engine/**、workers/parser 业务、dist/** 手改、docs/architecture/** 大改、QUEUE.md、.local/**、含口令提交、force push、reset --hard、直推 main、gh issue create/comment。
禁止 import src/demo/；禁止假 Live 列表。

【本地预览与验收】
export PREVIEW_HOME="$HOME/Library/Application Support/DreamcorePreview-ct006"
# 若预览已按 CT-006 起在 web 50832 / api 50831，直接用；否则用仓库 scripts/preview 起实例后以 preview-health / start 输出的 webUrl 为准，但仍须能在 127.0.0.1 打开下列 URL（端口以实测为准；执行单约定目标端口 web=50832 api=50831）：
# http://127.0.0.1:50832/agent-admin/
# http://127.0.0.1:50832/agent-admin/#view=functions
# http://127.0.0.1:50832/agent-admin/#view=capability-registry
# http://127.0.0.1:50832/agent-admin/#view=capability-registry&tab=catalog
开发态也可用：npm run dev 后打开对应路径（端口 5173）做样式核对，但日节点验收以 PREVIEW_HOME 预览为准。

必做检查：
- test -f agent-admin/index.html
- rg -n "agent-admin/index.html" vite.config.ts
- rg -n "agent-admin" src/identity/main.tsx
- npm run build   # 须包含 agent-admin 产物；失败则修到绿（本单引入的红必须清）
- 浏览器：两 view 可切换；空态+按钮可见；侧栏/主题接近 tenant-admin；无假数据列表

【做完输出】git diff --stat、关键 hunk、验收 URL 截图或文字说明、SKIP 清单（外链未做等）。
```

## ④ 推荐模型与思考强度

- 模型：`gpt-6.1-sol`
- 思考强度：**medium**（多文件壳+路由+主题，但无后端写逻辑）

## ⑤ 预计耗时

- Codex 落盘：30–50 分钟
- 本地 build + 预览点开：20–40 分钟

## ⑥ 跑完如何提交

```bash
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine' || exit 1
# 按实际改动暂存（勿 add 口令/.local）
git add agent-admin vite.config.ts src/identity src/features/agent-admin
git add src/features/capability-admission 2>/dev/null || true
git add src/admin/admin-theme.css src/platform scripts/verify-built-entries.mjs 2>/dev/null || true
git diff --cached --stat | grep -E 'apps/api|engine/src|workers/parser' && echo 'ERROR: 禁区' && exit 1
git commit -m "$(cat <<'EOM'
feat(agent-admin): CT-020-F1 第四端壳与能力登记空态可演示

无页仿 tenant-admin；#view=functions / capability-registry；写入待 CT-018。
EOM
)"
git push -u origin codex/ct-020-f1-agent-admin-capability-shell
gh pr create -R luofanghao9784/mengine --base main --head codex/ct-020-f1-agent-admin-capability-shell \
  --title "feat(agent-admin): CT-020-F1 能力注册壳可演示增量" \
  --body "## 摘要
agent-admin 入口 + functions / capability-registry 空态（仿 tenant-admin）。日切片可点开。

## 可演示
- http://127.0.0.1:50832/agent-admin/#view=functions
- http://127.0.0.1:50832/agent-admin/#view=capability-registry
- PREVIEW_HOME=~/Library/Application Support/DreamcorePreview-ct006

## 审查
- 两人审：发布验收 + 质量性能（边界加架构逻辑）
- 口径：QUEUE 现行硬性——无页仿 tenant-admin；已有页勿偏现页
- 勿自动合并

## 非范围
CT-018 登录写入、假 Live 数据、QUEUE 修改"
```

网页备用：https://github.com/luofanghao9784/mengine/compare/main...codex/ct-020-f1-agent-admin-capability-shell

## ⑦ 失败/卡住时怎么办

| 症状 | 动作 |
|---|---|
| remote 不是 luofanghao9784 | 立刻停；换正确仓 |
| 有暂停令 | 不开 Codex；问 DQ |
| build 因本单红 | 修到绿；禁止 skip/放宽 |
| 预览无 50832 | 查 `preview-health` / start 输出的实际 webUrl；仍须本机可点开两 URL；端口不一致时在 PR 写明实测端口 |
| API 401/404 | **预期**（CT-018 未到）；保持空态，勿造假数据 |
| 误改 QUEUE 或 apps/api | `git restore` 禁区；报 DQ |
| CONFLICT / push rejected | `git pull --rebase` 一次；仍失败停发 DQ |
| 禁止 | force push、`reset --hard`、直推 main、写上游、回报写口令、有暂停令仍开 Codex；禁止 gh issue |

回滚（未合入）：`git switch main && git branch -D codex/ct-020-f1-agent-admin-capability-shell`。

---

**DQ 审路径**：本文件 `docs/codex-tasks/CT-020-F1-agent-admin-capability-shell.md` + 摸底 `docs/codex-tasks/摸底纪要-四端-20261030-前端F1.md`。通过后交老板 Mac 粘贴③开跑。
