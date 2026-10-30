# CT-020-F4 agent-admin 人话替换（总负责人补丁词）

状态：架构已裁可跑 · 待 docs 入库后交老板 Mac Codex　｜　**正式岗** id=`ec838a2d-d838-48cd-a789-e1af1424a7f3`　｜　分支：`codex/ct-020-f4-agent-admin-human-copy`　｜　**审查人（PR 后两人审）：发布验收 + 质量性能**（触及 ADR-B8 边界加 **架构逻辑**）　｜　基准：切单时最新 `origin/main`（须含 F1 `8428d1b` + F2 `#5`/`fd99aba`；F3 若已合则叠其上）

> **日切片：2026-10-31 / 可演示点**：Mac 本机打开 `/agent-admin/`：导航、分区、按钮均为总负责人**人话补丁词**（覆盖旧「店员花名册 / 本事」稿）；口径「**AI 功能**」。后三按钮灰。  
> **口径（QUEUE 硬性第 6 条）**：四端 UI 可见文案一律易懂中文白话；禁止裸用 `seed` / `capability` / `Capability` / `Grant` / `admission` 等术语。  
> **挂靠**：两周日切片 D1·轨 B；`docs/codex-tasks/两周日切片-三轨并行-20261031.md`；验收句 [两周主路径验收句](https://www.notion.so/40966c386fbf81ad97cff544bc2906ff)。  
> **总负责人不代跑**；老板/正式前端岗在 Mac 自跑 Codex。Codex 尽量用。

规格依据：

- [《全端文案规范》](https://www.notion.so/40966c386fbf8120aaefc0290f9dedb8)
- [Agent管理去黑话 · 可演示口径](https://app.notion.com/p/40966c386fbf81f3a2e3e1822ae6a9b9)
- `docs/codex-tasks/QUEUE.md`「编制·前端开发」**硬性第 6 条**
- ADR-B8：`docs/architecture/backend-v0/ADR-B8-第四端边界-统一agent管理平台.md`
- 叠壳：F1 / F2 /（可选 F3）执行单

> **脚注（路由）**：hash **不改**——仍用 `#view=functions`、`#view=capability-registry&tab=catalog|versions|grants`。只改**可见文案 / aria-label**，不改路由名、样式体系、探针逻辑、假 Live。  
> **脚注（覆盖）**：本单**必须**采用总负责人 Codex 补丁词；旧「店员花名册 / 本事」类文案一律替换，禁止回退。

### 架构已裁（2026-10-30 晚 / 2026-10-31 D1，本岗；DQ 可覆）

1. **只换人话**：可见中文与 aria；**不**改路由 hash、CSS 体系、`probeCapabilities` 行为、登记提交语义（仍不可真写）。
2. **补丁词强制**（照抄，勿自创花名册稿）：见下表。
3. **后三灰**：保存登记 / 上架功能 / 开通给企业 → `disabled`；`title` 可用「暂时不能保存/上架/开通（后台开通中）」。
4. **「登记实现方案」可点**：仍只打开既有登记面板（F2）；面板内提交钮文案改为「保存登记」且 **disabled**（与后三灰一致）。

### 总负责人补丁词（强制照抄）

| 位置 | 人话（必须） | 旧稿示例（须替换） |
|---|---|---|
| 导航 | **企业功能** / **功能上架** / **版本** / **企业开通** | 企业端功能 / 能力登记 / 版本管理 / 授权管理 |
| 分区 | **说明样例**｜**已上架** | 登记种子 / Live 已登记实现 |
| 按钮 | **登记实现方案** / **保存登记** / **上架功能** / **开通给企业**（**后三灰**） | 登记第一个实现 / 提交登记 / 登记版本… |
| 产品口径 | **AI 功能** | 本事 / 花名册 / 店员 |

### 映射建议（可见文案；路由不变）

| 路由 / 区域 | 人话 |
|---|---|
| `#view=functions` 侧栏/标题 | 企业功能 |
| `#view=capability-registry&tab=catalog` 侧栏或页签总称 | 功能上架 |
| `&tab=versions` | 版本 |
| `&tab=grants` | 企业开通 |
| catalog 种子区 | 说明样例 |
| catalog Live 区 | 已上架 |
| 打开登记面板按钮 | 登记实现方案 |
| 面板提交 | 保存登记（灰） |
| versions / grants 写类钮 | 上架功能 / 开通给企业（灰；或按页语义用对应灰钮，禁止启用） |

## ① 目标与范围

- **目标**：在已合 agent-admin 壳上完成**人话替换日可演示增量**：导航 / 分区 / 按钮符合补丁词；无黑话裸露；风格不漂；**不**接真写 API（写通属 CT-034+）。
- **增量边界（只做这些）**：
  1. 侧栏与主标题：`企业功能`、`功能上架`；页内 tab：`功能上架`（catalog）/ `版本` / `企业开通`。
  2. catalog：分区标题改为 `说明样例`｜`已上架`；去掉 UI 上裸 `seed` / `Live` / `capability`（可用括号解释一次，优先纯白话）。
  3. CTA：`登记实现方案`（可点开面板）；面板标题/说明同步人话；提交钮 `保存登记` 且 disabled。
  4. versions / grants：写类按钮改为 `上架功能` / `开通给企业`（或页内等价灰钮），**一律 disabled**；`title` 可用「暂时不能保存/上架/开通（后台开通中）」。
  5. 辅助文案：统一「AI 功能」口径；空态/探测失败仍诚实，禁止假已上架列表。
  6. 可选：`agent-admin/index.html` 的 `<title>` / 可见文案若含黑话则一并改。
- **改哪些文件（允许）**：
  - `src/features/agent-admin/**`（含 `AgentAdminApp.tsx`、`RegisterDialog.tsx`、同目录小组件、必要时极小 css 仅文案相关）
  - 必要时 `agent-admin/index.html` 可见文案 / aria
- **不做什么（非范围）**：
  - **不改**路由 hash、`routes.ts` 解析键名（内部仍可用 `functions` / `capability-registry`）
  - **不改**样式体系（颜色/圆角/动效）、探针逻辑、假 Live
  - 不实现写 API / 登录墙 / 四端登录（CT-034 / CT-035）
  - 不改 `apps/api/**`、`engine/**`、`com.dreamcore.*`、`/mengine-api`、`MENGINE_*`
  - 不 import `src/demo/`；不挂空谷 Demo
  - 禁止 gh issue；只允许 `gh pr create -R luofanghao9784/mengine-app`

### 风格约束（强制）

| 情形 | 要求 |
|---|---|
| 已有页 | 可改功能与文案；风格/动效/交互**勿偏离**现 agent-admin / tenant-admin |
| QUEUE | 硬性 5 条 + **第 6 条人话**；正式岗 id=`ec838a2d-d838-48cd-a789-e1af1424a7f3` |

## ② 前置条件与分支名

- **⓪ 暂停令自查（第一步，优先级最高）**：有或拿不准 → **立刻停**，问 DQ。
- **依赖**：F1 `8428d1b` + F2 `#5`/`fd99aba` 在 main；F3 若已合则一并 pull，本单不依赖 F3 写逻辑。
- 正确仓：`~/Desktop/mengine-app-luofanghao9784`（origin=`luofanghao9784/mengine-app`）。
- Java 包名 `com.dreamcore.*`、`/mengine-api`、`MENGINE_*` **勿改**。

```bash
# ⓪ 暂停令自查：无暂停令再继续
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || { echo 'ERROR: 错误 remote，停'; exit 1; }
git status   # 应 clean；否则 stash 见 README 固定步骤
git switch main && git pull
git merge-base --is-ancestor 8428d1b HEAD || { echo 'ERROR: 缺 F1 8428d1b'; exit 1; }
git merge-base --is-ancestor fd99aba HEAD || { echo 'ERROR: 缺 F2 #5 fd99aba'; exit 1; }
git switch -c codex/ct-020-f4-agent-admin-human-copy
```

## ③ 完整 Codex 提示词

把下面整段交给 Codex（推荐 `$CODEX` + 模型 `gpt-6.1-sol`（若本机已有 `gpt-5.3-codex` 亦可），思考强度 **high**；sandbox/审批与组内既有 CT 一致）：

```
你在梦擎仓库分支 codex/ct-020-f4-agent-admin-human-copy 上工作。基准 origin/main（须已含 F1 8428d1b 与 F2 #5 fd99aba）。只做本单范围。执行单全文：docs/codex-tasks/CT-020-F4-agent-admin-human-copy.md。

【规格必须打开对照】
- Notion《全端文案规范》https://www.notion.so/40966c386fbf8120aaefc0290f9dedb8
- 去黑话对照 https://app.notion.com/p/40966c386fbf81f3a2e3e1822ae6a9b9
- QUEUE 硬性第 6 条（docs/codex-tasks/QUEUE.md）
- 验收句 https://www.notion.so/40966c386fbf81ad97cff544bc2906ff
- 现网壳：src/features/agent-admin/*、agent-admin/index.html

【口径·强制·总负责人补丁词】
- 导航可见文案：企业功能 / 功能上架 / 版本 / 企业开通
- 分区：说明样例｜已上架
- 按钮：登记实现方案 / 保存登记 / 上架功能 / 开通给企业；后三个必须 disabled 灰；title 可用「暂时不能保存/上架/开通（后台开通中）」
- 产品口径：「AI 功能」（禁止「本事」「花名册」「店员」稿）
- 禁止 UI 裸用 seed / capability / Capability / Grant / admission；用白话或「中文（英文）」一次解释
- 正式前端岗 id=ec838a2d-d838-48cd-a789-e1af1424a7f3
- 勿改路由 hash（仍 #view=functions / #view=capability-registry&tab=…）；勿改样式体系；勿改探针逻辑；禁止假 Live / 假成功 toast / 假 POST
- 勿改 com.dreamcore.*、/mengine-api、MENGINE_*；远程 luofanghao9784/mengine-app

【A. 导航与标题】
1. 打开 AgentAdminApp.tsx / RegisterDialog.tsx：列出所有用户可见中文与 aria-label。
2. 侧栏/主标题：functions →「企业功能」；capability-registry →「功能上架」。
3. 页内 tabs：catalog→「功能上架」（或与侧栏一致的短名，须人话）；versions→「版本」；grants→「企业开通」。aria-label 同步人话。

【B. catalog 分区】
1. 「登记种子」→「说明样例」；去掉「种子」「Live」裸词。
2. 「Live 已登记实现」→「已上架」；空态改为白话（如「还没有已上架的实现」），探测失败仍诚实。
3. badge「只读种子 / 登记种子」改为白话（如「仅供查看」「可登记说明」），勿留 seed。

【C. 按钮】
1. 「登记第一个实现」/「从本种子登记」→「登记实现方案」（可点，仍只开面板）。
2. 面板内「提交登记」→「保存登记」且 disabled。
3. versions/grants 写类钮 →「上架功能」「开通给企业」（或该页等价灰钮）一律 disabled + title 如上。
4. functions 页 CTA「查看能力登记」→ 人话（如「去功能上架」），链到原 hash 不变。

【D. 其它可见文案】
- 介绍段、空态、disabled 旁注统一「AI 功能」口径；覆盖花名册/本事旧稿。
- 必要时改 agent-admin/index.html 的 title/可见文案。
- 内部变量名/路由枚举可保留英文；用户看不见即可。

【不许碰】
apps/api/**、engine/**、workers/parser 业务、dist/** 手改、docs/architecture/** 大改、.local/**、口令、force push、reset --hard、直推 main、gh issue。
禁止 import src/demo/；禁止实现真实写入；禁止改 hash 路由键；禁止大改 css 皮肤。

【本地预览与验收】
export PREVIEW_HOME="$HOME/Library/Application Support/DreamcorePreview-ct006"
# 目标 web 50832 / api 50831；以 preview-health 实际 webUrl 为准：
# http://127.0.0.1:50832/agent-admin/#view=functions
# http://127.0.0.1:50832/agent-admin/#view=capability-registry&tab=catalog
# http://127.0.0.1:50832/agent-admin/#view=capability-registry&tab=versions
# http://127.0.0.1:50832/agent-admin/#view=capability-registry&tab=grants
npm run build
浏览器目检：导航/分区/按钮=补丁词；后三灰；无 seed/capability 裸词；风格不漂；网络无假写。

【做完输出】git diff --stat、关键文案 hunk、验收 URL、SKIP 清单。
```

## ④ 推荐模型与思考强度

- 模型：`gpt-6.1-sol`（若本机可用 `gpt-5.3-codex` 亦可，二选一）
- 思考强度：**high**（文案映射面广，须严格照抄补丁词且不碰路由/样式）
- **预计耗时**：Codex 20–40 分钟；build + 预览点开 15–25 分钟

## ⑤ 可复制 git 步骤（跑完如何提交）

```bash
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
REPO="$HOME/Desktop/mengine-app-luofanghao9784"
cd "$REPO"
git remote get-url origin | grep -q 'luofanghao9784/mengine-app' || exit 1
# 按实际改动暂存（勿 add 口令/.local）
git add src/features/agent-admin
# 若改了入口文案：
# git add agent-admin/index.html
git diff --cached --stat | grep -E 'apps/api|engine/src|workers/parser|com/dreamcore' && echo 'ERROR: 禁区' && exit 1
git commit -m "$(cat <<'EOM'
feat(agent-admin): CT-020-F4 人话替换（总负责人补丁词）

导航/分区/按钮改为企业功能·功能上架·版本·企业开通与说明样例｜已上架；
保存/上架/开通灰置；口径 AI 功能。不改路由 hash 与写 API。
EOM
)"
git push -u origin codex/ct-020-f4-agent-admin-human-copy
gh pr create -R luofanghao9784/mengine-app --base main --head codex/ct-020-f4-agent-admin-human-copy \
  --title "feat(agent-admin): CT-020-F4 人话替换（补丁词）" \
  --body "## 摘要
agent-admin 可见文案按总负责人补丁词人话化；后三按钮灰；口径「AI 功能」。

## 可演示
- http://127.0.0.1:50832/agent-admin/#view=functions
- http://127.0.0.1:50832/agent-admin/#view=capability-registry&tab=catalog
- PREVIEW_HOME=~/Library/Application Support/DreamcorePreview-ct006

## 审查
- 两人审：发布验收 + 质量性能（边界加架构逻辑）
- 正式岗 id=ec838a2d-d838-48cd-a789-e1af1424a7f3
- 规范：《全端文案规范》+ 去黑话对照 + QUEUE 硬性第 6 条
- 勿自动合并

## 非范围
改路由 hash、样式体系、探针、写 API、登录、假 Live"
```

网页备用：https://github.com/luofanghao9784/mengine-app/compare/main...codex/ct-020-f4-agent-admin-human-copy

## ⑥ 验收标准

日可演示（Mac `127.0.0.1`，端口以预览为准；约定目标 web=`50832`）：

| # | 标准 | 如何验 |
|---|---|---|
| V1 | 导航人话 | 侧栏/标题可见「企业功能」「功能上架」；无「能力登记」主文案 |
| V2 | tab 人话 | catalog / versions / grants 可见为「功能上架」「版本」「企业开通」 |
| V3 | 分区人话 | catalog 同时见「说明样例」与「已上架」；无裸 `seed`/`Live` |
| V4 | 按钮人话+灰 | 「登记实现方案」可开面板；「保存登记」「上架功能」「开通给企业」disabled 灰 |
| V5 | 口径 | 可见文案为「AI 功能」方向；无本事/花名册/店员稿 |
| V6 | 路由/风格不漂 | hash 仍 `#view=functions` / `#view=capability-registry&tab=…`；日光壳不偏 |
| V7 | 诚实空态 | 无假已上架行；探测失败仍空态 |
| V8 | build 绿（本单范围） | `npm run build`；本单新引入红必须清 |

备用开发态：`http://127.0.0.1:5173/agent-admin/#view=capability-registry&tab=catalog`（仅样式/文案核对）。

## ⑦ 禁止操作 / 失败卡住

| 症状 | 动作 |
|---|---|
| remote 不是 luofanghao9784/mengine-app | 立刻停；换正确仓 |
| 有暂停令 | 不开 Codex；问 DQ |
| main 缺 F1/F2 | 停；先 pull 含 `8428d1b`/`fd99aba` 的 main |
| 自创花名册/本事文案 | 打回；改回补丁词 |
| 改了 hash 路由键 | `git restore` 路由相关；只留可见文案 |
| build 因本单红 | 修到绿；禁止 skip |
| 预览端口非 50832 | 以实测 webUrl 为准；PR 写明 |
| 误改 apps/api / dreamcore / mengine-api | `git restore`；报 DQ |
| CONFLICT / push rejected | `git pull --rebase` 一次；仍失败停发 DQ |

**硬禁止**：

- `git push --force` / `-f` / `--force-with-lease`、`git reset --hard`、直推 `main`、写上游
- 假已上架列表、假成功 toast、import `src/demo/`
- 实现写 API / 登录 / 改 `com.dreamcore.*` / `/mengine-api` / `MENGINE_*`
- 改路由 hash 语义、大改样式体系、改探针假成功
- `gh issue create/comment`；回报或提交含口令
- 有暂停令仍开 Codex

回滚（未合入）：`git switch main && git branch -D codex/ct-020-f4-agent-admin-human-copy`。

---

**DQ 审路径**：本文件 + QUEUE F4/人话行 + 两周日切片 D1。通过后交老板/前端岗 Mac 粘贴③开跑。
