# ADR：前端模块边界——演示内核与正式三端如何分家

| 字段 | 内容 |
| --- | --- |
| 状态 | **Proposed（供审阅）**。本 PR 供审阅；合并前决策仍可微调。 |
| 日期 | 2026-10-29 |
| 作者 | 梦擎·前端架构 |
| 审阅 | 梦擎重构总监（提纲已通过；D1–D5 倾向同意） |
| 依据 | [`docs/architecture/frontend-inventory.md`](./frontend-inventory.md)（已合入 main，PR #1） |
| UI 对齐 | 同系统异表面，以及 Demo / Live 边界。规范目标路径：[`docs/产品/界面设计/梦擎UI规范-v0.1.md`](../产品/界面设计/梦擎UI规范-v0.1.md)（该文件可能由并行 PR 新增，本文只写路径引用） |

---

## 上下文（Context）

产品所说的「三端」是三条身份域网页：工作空间 `workspace`、企业管理 `tenant-admin`、平台总台 `platform-admin`，外加总部支持 `headquarters-support`。这不是桌面、Web、移动三套应用。正式入口共用 `src/identity/main.tsx`，用 HTML 上的 `data-surface` 区分表面。仓库没有 Electron、Tauri、Capacitor 或 React Native 入口。手机是同一套 Vite 多页的窄屏与触摸适配。

[前端首轮架构盘点](./frontend-inventory.md)表明，挡住「可单独合并的前端重构」的不是缺路由库或状态库，而是模块边界没有立住：

1. **Demo 与 Live 共源。** 根目录演示内核（`model.ts`、`store.tsx`、`briefing*.ts` 等）与正式画报（`briefing-live`）、会话（`conversation`）通过 `src/components/` 交汇。演示模块自身存在文件级循环依赖。继续搬功能目录时，容易把 localStorage 演示状态拖进正式包，或把正式画报拆断。
2. **壳层同时拥有路由、布局与功能编排。** `identity/AccessApp.tsx`、`admin/TenantConsole.tsx`、`admin/prototype/SceneShell.tsx`、`conversation/Conversations.tsx` 等是千行级装配点。功能目录缺少稳定的「页面入口 + 路由描述」，外部只能直接 import 具体组件。
3. **正式目录强连通，`shared` 又知道会话。** `admin`、`identity`、`material`、`conversation`、`platform`、`operations` 互相引用。`shared` 反向依赖 `identity` 的登录会话。不先规定允许的依赖方向，目录搬迁只是把环换个路径。

UI 侧已约定「同系统异表面」与「Demo / Live 边界」。本 ADR 把该约定落成可强制执行的模块依赖规则与第一期落点，沿用盘点里的层名，不另起一套命名。

---

## 决策（Decision）

下列五项是本 ADR 采纳的决策，与盘点第 5 节的分层、路由边界和迁移顺序一致。总监对 D1–D5 的倾向均为同意。本 PR 供审阅；合并前决策仍可微调。微调只改条文，不推翻「依赖只允许向下，Live 不得依赖 Demo」。

### D1 — 正式（Live）代码禁止依赖演示（Demo）状态

- **决定：** Live 树不得 import Demo 状态、Demo store，或只服务演示的页面与对话框。
- **强制：** 导入检查放在 `tests/*.test.ts`，随根目录已有的 `npm test`（`node --experimental-strip-types --test tests/*.test.ts`）运行。清单以外的违规边使该测试失败。不另建门禁档位名称。
- **过渡：** 盘点时已经存在的违规边写入允许清单（allowlist），只禁止新增边。迁移删掉对应边之后，同一变更从清单删除该条。

### D2 — `shared` 不得知道会话

- **决定：** `shared` 只放无会话的按钮、弹层、手势、排版纯函数。
- **决定：** 会话，以及带登录失效处理的加载钩子，归入 `platform`。盘点时的 `useRemote` 在 `src/shared/admin.tsx`，迁移时从 `shared` 移入 `platform`。
- **强制：** `shared` 不得 import `identity`、`platform`、`features` 或 `demo`。`platform` 持有会话，因此 `shared` 也不能经由 `platform` 再拿到会话。导入检查与 D1 使用同一份允许清单：盘点时已经存在的违规边入清单，其后只删除、不新增。

### D3 — 企业管理 prototype / governance 第一期保留独立入口

- **决定：** 第一期保持 `tenant-admin/prototype/index.html` 与 `tenant-admin/governance/index.html` 为独立 HTML 入口。它们的页面不并入 `src/admin/TenantConsole.tsx`。
- **决定：** D5 落地时，这两个入口各自一份路由模块，只解析自己的 `location.hash`，不进入 `TenantConsole` 的视图联合类型。
- **理由：** 三套壳的信息架构与样式平行增长。第一期并壳会把分家做成合壳大改，超出本 ADR 范围。
- **后续：** 是否并壳另开 ADR，并单独做产品决策。本文件的落地顺序不包含并壳。

### D4 — 目录与用语对齐 UI「Demo / Live」

- **决定：** 演示内核物理迁入 `src/demo/`。迁入范围与盘点 §5.6 第 2 步相同：`src/store.tsx`、`src/model.ts`、`src/briefing*.ts`、`src/konggu*`、`src/pages/`。正式树称 Live，由 `app`、`features`、`shared`、`platform` 四层组成。
- **决定：** 文档、评审、PR 描述与 UI 规范统一使用 Demo / Live。目录名使用 `src/demo/` 与上述四层名。
- **交叉引用：** UI 书面规范的目标路径是 `docs/产品/界面设计/梦擎UI规范-v0.1.md`。该文件可能由并行 PR 新增，本文只写路径引用。

### D5 — 「异表面」第一期落点

- **决定：** 第一期继续用 HTML `data-surface` 区分表面。每个 surface 维护一份路由模块：输入 `location.hash`，输出可判别联合类型。壳组件只根据路由结果选择页面。
- **不做：** 第一期不把源码树大搬迁到 `app/<surface>/`。路由表稳定之前不引入 React Router。
- **演示：** Demo 继续使用自己的路径语法，放在 Demo 路由模块里，不与 Live 的 `view=…` 混用。

---

## 目标分层（Architecture）

依赖只允许向下。Live 不得依赖 Demo。

```text
app          各 HTML 壳：会话门闩、该端路由表、布局
  ↓
features/*   单业务的页面、路由描述、client、局部样式
  ↓
shared       无会话 UI 与纯函数        platform    fetch、CSRF、错误码、会话、契约入口
  ↓                                      ↓
（shared 不得 import platform / identity / features / demo）

demo         种子、store、pages、仅 Demo 使用的对话框
             ↑ 可以引用 shared 的纯组件
             ↑ Live（app / features / shared / platform）不得引用 demo
```

| 概念 | 含义 |
| --- | --- |
| Live | 经 `identity/main` 与 `data-surface` 进入的正式客户端树 |
| Demo | `src/demo/`。迁入前对应根目录种子、`store`、`pages`，以及绑定 DemoState 的组件 |
| 同系统异表面 | 同一 Live 代码库上的不同 surface 与路由表，不是多套产品线 |

`components/` 的拆分服从 D1 与 D2：

- 无演示类型的可复用件进入 `shared`。
- 绑定 `DemoState` 的组件进入 `demo`。
- 画报等 Live 与 Demo 共用的表现逻辑，先把纯函数和类型抽到 `shared` 或 `features/briefing` 的模型，再由两边引用这一层。两边不得再经 `src/briefing.ts` 或其余仍留在根目录的 `src/briefing*.ts` 间接共用。

---

## 强制手段（Enforcement）

本 PR 只写入规则。导入检查脚本与允许清单由紧随其后的纯脚本变更落地。该变更只增加脚本和清单，不改业务行为。

1. **导入检查脚本**按下面三条判定，命中清单外的边即失败：
   - Live 路径不得 import `src/demo/`。文件尚未迁入时，同样不得 import 根上的 `src/store.tsx`、`src/model.ts`、`src/briefing*.ts`、`src/konggu*`、`src/pages/`。
   - `shared` 不得 import `identity`、`platform`、`features` 或 `demo`。
   - 一个 feature 不得 import 另一个 feature 的页面文件。跨功能只走路由参数，或走 `shared` 里的纯类型。
2. **允许清单**记录盘点时已经存在的环与违规边。`npm test` 拒绝清单以外的新边。某条边从源码中消失后，同一变更必须从清单删除该条。
3. **挂载点：** 检查文件放在 `tests/` 下，文件名匹配 `*.test.ts`，由现有 `npm test` 执行。本 ADR 不新增门禁名称。命令、允许清单和复现方式见 [`dependency-cruiser.md`](./dependency-cruiser.md)。

本 ADR 不要求同一步修改业务行为。第一刀是本文，加上随后的检查脚本与允许清单。

---

## 后果（Consequences）

### 正向

- 搬目录时不再把 localStorage 的 Demo 状态拖进正式包。
- `shared` 可以按无会话组件复用。会话变更不穿透纯 UI。
- 架构评审与 UI 标注共用 Demo / Live 词汇。
- 企业管理的 prototype 与 governance 在第一期仍走各自的 HTML 入口，与 `TenantConsole` 分开。

### 代价与风险

- 物理搬家初期用薄再导出保住旧路径，短期内新旧路径并存。再导出只做转发，不在旧路径上加新逻辑。
- 画报和会话如果仍绑定根目录 `briefing*` 类型，必须先抽出纯模型，再断开 Demo 边。顺序颠倒会把正式画报再次绑回演示模块。
- prototype 与 governance 保留独立入口。产品与 UI 需要知道：企业表面在工程上仍是多个 HTML 入口。

### 回退

- 若审阅结论是不合并，本 ADR 不入库。已合入 main 的盘点文档继续作为调研记录保留。
- 若合并前只调整 D3–D5 的条文，直接修订本文件并在 PR 说明中写明改了哪一条。不另开题目。本 PR 供审阅；合并前决策仍可微调。分层方向不在微调范围内被推翻。

---

## 落地顺序（本 ADR 覆盖的决策范围）

对应盘点 §5.6 的前两步。第 3 步及之后仍按该节执行，不在本文写成新的决策。

1. 本文随本 PR 提交审阅。本 PR 供审阅；合并前决策仍可微调。合并后的下一份变更只增加导入检查与允许清单，不改业务行为。本 PR 不包含该脚本。
2. 把 `src/store.tsx`、`src/model.ts`、`src/briefing*.ts`、`src/konggu*` 与 `src/pages/` 迁入 `src/demo/`。旧路径保留只做转发的再导出。这一步不修改正式代码的 import。
3. 其后按盘点 §5.6 第 3–8 步执行。本 ADR 不追加决定：抽出 `platform` 传输层；拆 `components/`；在盘点点名的 `news`、`plans`、`documents` 中取一个叶子功能做路由样板；再拆壳上的路由；然后迁移画报、资料与会话；最后处理 `site/` 的深引用和重复舞台。

---

## 明确不做（Out of scope）

- 引入 React Router、全局状态库，或把前端拆成多个 npm 包。
- 合并企业管理的三套视觉壳（prototype、governance、主控制台）。
- 修改 `apps/api`、`engine`、`workers/parser`。
- 为移动端或桌面端 App 新建工程。
- 改变业务功能行为。本 ADR 与第一刀只动模块边界、文档和导入门禁。

---

## 待办清单（Status checklist）

- [x] [`docs/architecture/frontend-inventory.md`](./frontend-inventory.md) 已合入 main（PR #1）
- [x] 总监同意 D1–D5 倾向。本 PR 供审阅；合并前决策仍可微调
- [x] 本文随本 PR 进入审阅
- [ ] 审阅通过后合并本 ADR
- [x] 导入检查与允许清单已入库（`tests/frontend-boundaries.test.ts`、`config/frontend-boundary-allowlist.cjs`）。`npm test` 拒绝清单外的边。操作说明见 [`dependency-cruiser.md`](./dependency-cruiser.md)。该变更不改业务代码
- [ ] `docs/产品/界面设计/梦擎UI规范-v0.1.md` 入库后，核对本文交叉引用仍指向该路径

---

## 参考

- [`docs/architecture/frontend-inventory.md`](./frontend-inventory.md)（已合入 main，PR #1）
- [`docs/产品/界面设计/梦擎UI规范-v0.1.md`](../产品/界面设计/梦擎UI规范-v0.1.md)（目标路径；该文件可能由并行 PR 新增，本文只写路径引用）
- [`docs/技术/多端架构与技术栈确认-V0.1.md`](../技术/多端架构与技术栈确认-V0.1.md)
- [`docs/技术/三端架构与管理权限-V0.1.md`](../技术/三端架构与管理权限-V0.1.md)
