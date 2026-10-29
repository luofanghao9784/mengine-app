# 梦擎工作空间前端架构盘点（首轮）

日期：2026-10-29。状态：调研记录，不是已确认的重构决策。本轮只读代码与配置，不改业务、后端或引擎。

依据：仓库当前 `main` 工作区的 `package.json`、`vite.config.ts`、HTML 入口、`src/` 导入关系，以及既有 [多端架构与技术栈确认](../技术/多端架构与技术栈确认-V0.1.md)、[三端架构与管理权限](../技术/三端架构与管理权限-V0.1.md)。行数与导入次数是这次静态统计，后续改动会过时，引用时以当时文件为准。

## 结论

产品所说的「三端」是三条身份域网页，不是桌面、Web、移动三套应用。当前没有 Electron、Tauri、Capacitor 或 React Native 入口。员工客户端、企业管理端、平台总台（外加总部支持页）共用一次 Vite 构建，用不同 HTML 和 `data-surface` 区分；手机是同一套页面的窄屏和触摸适配。根路径 `/` 仍是本地演示（localStorage），`/workspace/` 才是接平台 API 的正式客户端。官网 `site/` 是第二个 Vite 应用，会直接引用主仓源码。

正式客户端的模块已经按业务目录切开，但依赖没有跟着切开：`admin`、`identity`、`material`、`conversation`、`platform`、`operations` 互相引用，`shared` 又回头依赖登录会话。演示内核（`src/` 根上的 `model.ts`、`store.tsx`、`briefing*.ts`）和正式画报、会话共用 `src/components/`。这是首轮重构要先立住的边界，而不是先换路由库或状态库。

## 1. 顶层结构与入口

仓库同时放平台 API（`apps/api`）、引擎（`engine/`）、解析器（`workers/parser`）、契约（`contracts/`）和前端。前端相关只有这些：

| 位置 | 角色 |
| --- | --- |
| `src/` | 主前端。演示、正式客户端、两个管理端、治理同步页都从这里进 |
| `index.html`、`workspace/`、`tenant-admin/`、`platform-admin/` | 主 Vite 的多页入口 |
| `public/` | `browser-compat.js`、`tenant-touch.js` 等不经打包的脚本 |
| `site/` | 独立 `package.json` 的官网、登录页和带模拟接口的演示 |
| `integrations/mengine-wiki/` | 旁路集成。依赖里有 Next，脚本只构建其 API，不在主前端构建图里 |

根目录 `package.json` 的前端命令是 `dev` / `build` / `preview`（Vite）和 `test`（`node --test tests/*.test.ts`）、`test:e2e`（Playwright）。没有 `electron`、`cap`、`tauri` 或 `react-native` 脚本。`npm run build` 是 `tsc --noEmit && vite build && node scripts/verify-built-entries.mjs`。校验脚本要求这些生产页的构建产物存在：`workspace`、`tenant-admin`、`tenant-admin/prototype`、`tenant-admin/governance`、`tenant-admin/support`、`platform-admin`。根路径演示页在 Vite 的 `input` 里，但不在这份生产入口清单里。

设备路线仍以 [多端架构与技术栈确认](../技术/多端架构与技术栈确认-V0.1.md) 为准：现阶段只做各系统浏览器里的网页；移动 App、桌面 App 是网页成熟之后的阶段，仓库里还没有对应工程。

### 1.1 主 Vite 入口

`vite.config.ts` 用一份配置打出多页，开发时代理 `/api` 到平台 API，并把 `/mengine-api` 限制成少量场景接口。各页入口如下。

| 页面 | HTML | 脚本入口 | 实际应用 |
| --- | --- | --- | --- |
| 本地演示 | `index.html` | `src/main.tsx` | 默认渲染 `src/ninepop/Bootstrap.tsx` → `src/App.tsx`（hash 路由 + `src/store.tsx`）。路径恰好是 `/native-conversations` 时改为动态加载 `src/native-conversation/NativeConversations.tsx` |
| 员工客户端 | `workspace/index.html` | `src/identity/main.tsx` | `#root[data-surface=workspace]`，客户域 Cookie |
| 企业管理 | `tenant-admin/index.html` | `src/identity/main.tsx` | `data-surface=tenant-admin`。页内还有写死的「治理成果同步」链接 |
| 总部支持 | `tenant-admin/support/index.html` | `src/identity/main.tsx` | `data-surface=headquarters-support`，走平台域会话，渲染 `src/platform/SupportApp.tsx` |
| 平台总台 | `platform-admin/index.html` | `src/identity/main.tsx` | `data-surface=platform-admin`，渲染 `src/platform/PlatformApp.tsx` |
| 企业端数据与知识 | `tenant-admin/prototype/index.html` | `src/admin/prototype/main.tsx` | 另一套壳 `SceneShell`，另载 `public/tenant-touch.js` |
| 治理同步 | `tenant-admin/governance/index.html` | `src/admin/governance/main.tsx` | 单文件页面，查询参数 `surface=platform` 时改打总台接口 |

`src/identity/main.tsx` 是正式三端加总部支持的唯一脚本入口。它按 `data-surface` 选择客户域或平台域 `SessionProvider`，再分到 `AccessApp`、`PlatformApp` 或 `SupportApp`。未知 surface 直接抛错。

手机没有单独入口。窄屏靠 CSS、`src/identity/drawer-slot.ts` 和 `public/tenant-touch.js`（只处理企业端原型里卡片手势，并写明不改桌面滚轮）。`workspace/index.html` 有 viewport，没有单独的移动 bundle。

测试夹具 `tests/fixtures/*/main.tsx` 是 Playwright 用的局部挂载，不是产品入口。

### 1.2 官网 Vite

`site/vite.config.ts` 把 `@dreamcore` 指到仓库根，再按路径引用主仓文件。入口：

| 页面 | HTML | 脚本 |
| --- | --- | --- |
| 官网 | `site/index.html` | `site/src/main.tsx` → `site/src/App.tsx` |
| 离线演示 | `site/demo/index.html` | `site/src/demo/boot.ts`：装上模拟接口后 `import('@dreamcore/src/identity/main.tsx')` |
| 三端登录 | `site/login/index.html`、`admin.html`、`platform.html` | `site/src/login/main.tsx`，样式和 `DreamcoreLogo`、`PasswordField`、`Button` 来自主仓 |

官网因此和主仓源码同版本耦合：主仓挪文件会直接弄坏 `site/` 的构建。`site/src/engine/engine-stage/scene.ts` 又是一份独立的 WebGL 舞台，与 `src/operations/engine-stage/scene.ts` 并列，注释写明是从原型移植，不是从主仓 import。

## 2. `src/` 模块地图

`src/` 下约 534 个 `.ts` / `.tsx` / `.css` 文件、约 14 万行（含样式）。样式单独约 107 个文件、4.1 万行。下面行数含该目录里的 CSS，用来看体积，不代表逻辑行。

| 目录 | 文件 | 行数量级 | 现在的职责 |
| --- | --- | --- | --- |
| `admin/` | 78 | 2.1 万 | 企业管理壳、总台控制台、Wiki、`prototype/` 数据知识工作台、`governance/` 同步页、`mengine/` 可视化 |
| （`src/` 根） | 34 | 1.6 万 | 演示状态、画报排版算法、空谷/9POP 种子、`App.tsx`、`styles.css` |
| `operations/` | 27 | 1.1 万 | 用量、存储、遥测、手写 WebGL 引擎舞台 |
| `components/` | 46 | 1.0 万 | 演示对话框和侧栏，以及正式画报/会话仍在用的卡片、手势 hook |
| `conversation/` | 41 | 0.9 万 | 正式会话列表、卡片叠放、实时回答 |
| `briefing-live/` | 59 | 0.9 万 | 正式智能画报 |
| `material/` | 25 | 0.9 万 | 正式资料库、上传队列、权限与治理提案 |
| `native-conversation/` | 24 | 0.6 万 | 原生会话；也被根路径 `/native-conversations` 单独挂载 |
| `identity/` | 30 | 0.6 万 | 登录会话、三端壳 `AccessApp`、跨端 hash |
| `platform/` | 15 | 0.3 万 | 总台登录壳、员工与设置、总部支持 |
| `tenant/` | 9 | 0.2 万 | 企业成员、空间、审计 |
| `shared/` | 18 | 0.2 万 | 按钮、布局、`useRemote`、请求锁、视图滚动记忆 |
| `pages/` | 6 | 0.3 万 | 只服务于演示 `App.tsx` 的页面 |
| 其余约 25 个目录 | 各 2–11 个文件 | 数百到 4 千行 | 技能、文稿、计划、经验、离职、保留、治理、评价、数据源等，多数是「一个面板 + `client.ts`」 |

根上体积最大的文件：`styles.css`（6247）、`conversation/Conversations.tsx`（1882）、`admin/prototype/SceneShell.tsx`（1444）、`operations/engine-stage/scene.ts`（1372）、`material/Library.tsx`（1293）、`departure/DeparturePanel.tsx`（1240）、`tenant/TenantAdminHome.tsx`（1214）、`components/Dialogs.tsx`（1052）、`identity/AccessApp.tsx`（836）。`admin/governance/main.tsx` 把类型、请求和整页 UI 写在同一个组件里。

### 2.1 谁依赖谁

静态 import 只统计跨目录的 TypeScript。外部包几乎只有 `react`、`lucide-react`、`react-dom` 和字体。业务依赖全在仓库内部。

正式客户端的读法：

```text
HTML
  → identity/main.tsx
      → identity/session.tsx          客户域或平台域会话
      → platform/PlatformApp | SupportApp
      → identity/AccessApp            工作空间与企业管理的页面开关
          → briefing-live、conversation、material、documents、plans、skills、profile
          → admin/TenantConsole、platform/PlatformHome、governance/ManagementHome
  → admin/TenantConsole、PlatformConsole
      → tenant、operations、material、experience、database、departure、native-conversation
```

演示客户端的读法：

```text
index.html → src/main.tsx → ninepop/Bootstrap → store.tsx + App.tsx
  → pages/* → components/* → 根目录 model.ts、briefing*.ts、libraryModel.ts
```

两条线在 `components/` 和根目录表现层模块交汇。`briefing-live` 引用 `components` 里的图表、披露、卡片尺寸和页签手势；这些文件再引用根上的 `briefingPresentation.ts`、`briefingTypography.ts`、`conversationDeck.ts`。`conversation` 的实况卡片同样引用 `components` 里的叠放 hook。演示侧栏和对话框则直接 `useDemo()`。所以「组件目录」既不是纯 UI，也不是某条产品线私有。

按导入次数，依赖最重的是：

- `admin` 出去最多：`shared`、`identity`、`operations`、`material`、`tenant`、`platform`、`profile`。
- `components` 有 84 处指向 `src/` 根（主要是 `store.tsx`、`briefing.ts`、`model.ts`、`libraryModel.ts`）。
- `briefing-live`、`conversation`、`material`、`identity`、`platform` 都同时依赖 `shared` 和 `identity`。
- `shared/admin.tsx`、`shared/useViewState.ts` 反向引用 `identity/session` 和 `identity/client`。共享层知道登录态。

双向依赖（两边都有 import）包括：`admin`↔`identity`、`admin`↔`operations`、`admin`↔`material`、`admin`↔`platform`、`admin`↔`tenant`、`identity`↔`conversation`、`identity`↔`material`、`identity`↔`shared`、`conversation`↔`briefing-live`、`components`↔根目录、`pages`↔根目录。把目录当成包的话，除 `export` 等叶子外，正式客户端几乎是一个强连通块。这不是一两个文件互引，而是壳层在组装功能、功能又把导航和会话类型引回壳层。

文件级循环在演示内核里很密：`model.ts`、`briefing.ts`、`briefingArticle.ts`、`briefingLayout.ts`、`kongguBriefing.ts`、`libraryModel.ts` 彼此相扣。正式代码里也能看到短环，例如 `material/Library.tsx`↔`documents/Documents.tsx`、`material/Library.tsx`↔`activity/Activity.tsx`，以及 `conversation/Conversations.tsx` 与 `briefing-live/TaskReadingBody.tsx`。

### 2.2 边界模糊的地方

1. **演示和正式客户端。** `pages/` 只被演示使用，目录名却像正式路由。正式画报在 `briefing-live/`，正式资料库在 `material/Library.tsx`，演示对应物在 `pages/Briefing.tsx`、`pages/Library.tsx`。根目录 30 多个 `briefing*` / `konggu*` 文件没有 `demo/` 前缀，和功能目录平级。
2. **`components/` 与 `shared/`。** `components/ui.tsx` 只是再导出 `shared/ui`。按钮的正式入口在 `shared`，大量演示组件仍从 `components/ui` 引入。活的手势和图表留在 `components/`，因为它们绑着根目录的画报类型。
3. **企业管理有三套壳。** `tenant-admin/index.html` 进 `AccessApp` → `admin/TenantConsole.tsx`（成员、空间、用量、资料）。`tenant-admin/prototype/index.html` 进 `SceneShell`（数据、知识、成员、角色，自带 hash）。`tenant-admin/governance/index.html` 再独立一套，而且总台用查询参数复用这同一页。三套都读企业会话，页面结构、样式和路由互不相通。
4. **总台壳跨了两层。** 登录在 `platform/PlatformApp.tsx`，登录后主体是 `admin/PlatformConsole.tsx`，遥测和用量又在 `operations/`。`identity/AccessApp.tsx` 在工作空间 surface 上也会挂出平台首页的入口判断。表面目录和运行时装配不一致。
5. **每个功能一个 `client.ts`，传输却在身份模块。** 约 57 个 `*client.ts` 调用 `identity/client.ts` 的 `createIdentityRequest`。路径字面量散落在约 30 个目录：客户 `/api/v1`、总台 `/api/platform-admin/v1`、企业管理 `/api/tenant-admin/v1` 都有。契约类型从 `contracts/public-api/` 手工 import，没有生成客户端，也没有按端分开的请求模块。
6. **路由没有路由模块。** 正式工作空间用 `location.hash` 查询参数（`tenant`、`view`、资源 id），解析写在 `identity/AccessApp.tsx` 和 `identity/navigation.ts`。管理壳在 `admin/AdminShell.tsx` 再听一次 `hashchange`。原型在 `admin/prototype/SceneShell.tsx` 和 `section-kit.tsx` 又听一次。演示 `App.tsx` 用另一套 hash 路径（`briefing/...`、`chat/...`）。没有 React Router，也没有集中路由表。
7. **状态也没有单独一层。** 正式数据是各面板 `useState` 加 `shared/admin.tsx` 的 `useRemote`（请求时顺带处理登录失效）。上传有 `material/UploadManager.tsx` 的 context。演示状态是 `store.tsx` 里整棵 `DemoState` 的 `structuredClone`，写入 `localStorage`。没有 Zustand、Redux 或请求缓存库。

`src/data/` 只有读模型辅助，不是数据层。`src/database/` 是企业数据库管理页，不是前端存储。

## 3. 依赖盘点

根包运行时依赖只有四项：`react`、`react-dom`（19.3）、`lucide-react`、`@fontsource/cormorant-garamond`。开发依赖是 Vite 8、TypeScript 7、`@vitejs/plugin-react`、Playwright、Prettier、Ajv。没有路由库、状态库、请求库、组件库或 CSS 框架。`tsconfig.json` 打开了 `strict`，没有路径别名；跨目录全靠相对路径。`allowImportingTsExtensions` 让一部分文件在 import 里写 `.ts` 后缀，另一部分不写，两套风格并存。

这不是「依赖过重」，而是重量都在源码里：

- 全局 `src/styles.css` 6247 行，加上各功能自己的 CSS，改一处视觉要同时看全局表和局部表。
- 手写 WebGL2 舞台（`operations/engine-stage/scene.ts`，约 1400 行）没有使用 three.js 等库，和 `site/` 里那份舞台重复。
- `lucide-react` 在根包是 `^1.47.0`，在 `site/` 是 `^1.54.0`。React 主版本对齐，图标包没有锁在同一版本。
- `integrations/mengine-wiki` 另依赖 Next 16、`react-markdown`，且 React 版本号与主仓不完全相同。它不参与 `npm run build`，但容易让人以为仓库有第二套主前端。

重复的是概念而不是 npm 包：两套画报（`pages/` + 根目录 `briefing*`，以及 `briefing-live/`）、两套资料库、三套企业管理壳、两份引擎舞台、两套登录（`identity/PhoneAuth.tsx` 与 `site/src/login/Login.tsx`，后者复用了前者的密码框）。

API 主机没有写死在业务客户端里。浏览器请求同源 `/api/...`，由 Vite 代理或部署层转到平台。`identity/client.ts` 约 390 行，前半是各域错误码的中文说明，后半才是带超时、CSRF 和契约校验的 `fetch` 封装。演示种子 `kongguResearch.ts`、`briefingMedia.ts` 和技能目录里有外站 URL，那是样例内容，不是运行时 API。`ninepop/adapter.ts` 出现 `https://boss.9pop.top/`，属于演示适配，不应当成正式客户端的基址。

## 4. 技术债

分级只看「会不会挡住一次可单独合并的前端重构」。P0 是现在就分不开模块；P1 是分模块时会反复绊倒；P2 是清理项，不先做也不挡住第一刀。

### P0

1. **演示内核和正式客户端共源。** 根目录 `model.ts` / `store.tsx` / `briefing*.ts` 存在文件级循环。正式 `briefing-live` 和 `conversation` 通过 `components/` 使用这批表现层模块。继续往功能目录搬文件，会把 localStorage 演示状态一起拖进正式包，或者把正式画报拆断。
2. **壳组件同时拥有路由、布局和功能编排。** `identity/AccessApp.tsx`、`admin/TenantConsole.tsx`、`admin/prototype/SceneShell.tsx`、`conversation/Conversations.tsx` 都是千行级装配点。功能目录对外没有稳定的「页面入口 + 路由描述」，外部只能 import 具体组件。
3. **身份、管理、资料、会话、总台、运行概览互相引用。** `shared` 依赖 `identity`，功能客户端也依赖 `identity`。不先规定允许的依赖方向，目录搬迁只是把环换个路径。

### P1

1. **至少四套 hash 监听**（演示 `App`、`AccessApp`、`AdminShell`、`SceneShell`/`section-kit`），外加 `identity/navigation.ts` 自己的参数白名单。跨端返回链接是字符串约定。换 History API 或加路由库之前，先要有一张每端一份的路由表，否则会把四套习惯迁进新库。
2. **HTTP 边界不完整。** 传输、登录错误和全部业务错误文案都在 `identity/client.ts`。约 57 个客户端各自拼路径、手写类型守卫。`contracts/` 是事实来源，前端没有从契约生成类型或路径。改一个错误码要改身份模块，改一个资源路径只改某个功能客户端，两处不对称。
3. **企业管理端三套 UI 并存**（控制台、prototype、governance 单页）。prototype 的样式（`glass-surface.css`、`scene-shell.css`）和 `admin/admin.css`、`tenant/TenantAdminHome.tsx` 平行增长。重构若只整理 `tenant/`，用户仍从另一个 HTML 进入另一套信息架构。
4. **`site/` 深 import 主仓，并复制 WebGL 舞台。** 主仓内部路径就是官网的公共 API。舞台有两份时，遥测模型改一处不会自动改另一处。
5. **测试护栏偏客户端解析和浏览器旅程，几乎不保护模块边界。** `tests/*.test.ts` 约 102 个，大量是 `*client` 的响应解析；`tests/e2e` 约 100 个 spec，覆盖三端不少流程。`shared/`、`components/`、`pages/`、路由壳没有成套单测。搬目录时现有测试能抓住协议解析和部分点击路径，抓不住「正式代码又 import 了演示 store」。

### P2

1. 全局 `styles.css` 与功能 CSS 并存，没有设计令牌层以外的样式边界（主题变量已在 `shared/theme.css`，页面样式仍大量写在全局文件）。
2. 没有路径别名，`../../` 使「这个文件属于哪一层」从 import 看不出来。`.ts` 后缀写或不写不统一。
3. `src/` 根上的演示文件没有收进 `demo/`，`pages/` 的名字像正式路由。
4. `VITE_LOCAL_FEATURE_ENTRIES` 用编译开关控制关注、计划和转发入口（`shared/feature-entries.ts`），和 hash 视图白名单是两套机制。
5. 手机能力是样式和一段全局触摸脚本，没有「设备能力」接口。以后做 App 时，上传、通知、安全区会直接碰 DOM。这与已确认的多端约定一致，只是现在还没有落点。
6. TypeScript `strict` 已开，`any` 很少（这次只在少数文件里看到个位数匹配）。类型债主要是契约类型和页面局部类型两套，不是缺少编译选项。`governance/main.tsx` 的内联类型是极端例子。
7. 生产入口校验不包含根路径演示页。演示仍进同一构建，是否对生产发布可见，需要单独说明，避免重构时误删或误暴露。

## 5. 重构建议草案

下面是可讨论的方向，不是本轮决定。不引入新的运行时框架，除非某一阶段证明现有 `fetch` + context 不够用。

### 5.1 分层

建议四层，外加一个隔离的演示树。依赖只能向下。

| 层 | 放什么 | 不能做什么 |
| --- | --- | --- |
| `app` | 每个 HTML 对应的壳：会话门闩、该端路由表、布局 | 不写资源请求细节，不引用演示 store |
| `features/<name>` | 一个业务的页面、路由描述、`client`、局部样式 | 不引用其他 feature 的页面组件；需要跨功能时走路由参数或 `shared` 里的纯类型 |
| `shared` | 无会话的按钮、弹层、手势、排版纯函数 | 不 import `identity`、`features`、演示状态 |
| `platform` | `fetch` 封装、CSRF、错误码表、会话 context、契约类型入口 | 不 import 页面 |
| `demo` | 现根目录种子、`store`、`pages`、只被演示使用的对话框 | 可以引用 `shared` 的纯组件；正式 `app` / `features` 不能引用 `demo` |

`components/` 拆开：无演示类型的（如 `Disclosure`、`DreamcoreLogo`、导航按钮）进 `shared`；绑 `DemoState` 的留在 `demo`；画报图表若正式和演示都要用，先把纯函数和类型从根目录抽到 `shared` 或 `features/briefing` 的模型文件，再让两边引用那一层，而不是继续引用 `src/briefing.ts`。

### 5.2 包结构

第一阶段不要拆 npm workspace，也不要给 `site/` 发私有包。先在 `src/` 里用目录和一条导入检查稳住边界。检查可以是一个小的 node 脚本：正式目录不得 import `demo` 或 `store.tsx`，`shared` 不得 import `identity`，feature 不得互相 import 页面文件。现有环先列成允许清单，只禁止新增边，这样每一刀都可以单独合并。

`site/` 改为只从明确的入口文件引用（例如将来的 `src/shared/public.ts` 和登录组件），不再写 `@dreamcore/src/...` 深路径。WebGL 舞台留一份，官网若要展示，引用主仓的舞台模块或接受「官网是静图」——二选一，不在本盘点里定。

`integrations/mengine-wiki` 保持在主前端重构之外。

### 5.3 路由边界

每个 surface 一份路由模块，输入 `location.hash`，输出可判别联合类型。`AccessApp`、`AdminShell`、`SceneShell` 只根据这个结果选页面。演示继续用自己的路径语法，放在 `demo` 路由模块里，不和 `view=briefing` 混用。跨端只允许 `identity/navigation.ts` 已有的那种白名单参数，不把整段 hash 当 URL 传递。

在路由表稳定之前，不引入 React Router。引入之后也应让路由库消费这份联合类型，而不是把路径字符串再散回组件。

### 5.4 状态边界

会话只放 `platform` 的 `SessionProvider`。服务器数据继续由功能内的加载 hook 持有；把 `useRemote` 从 `shared/admin.tsx` 挪到 `platform` 之后，`shared` 才能去掉对 `identity` 的依赖。上传队列留在资料 feature，通过 context 只向该功能的子树提供。演示的 `DemoState` 留在 `demo`，不进入正式壳。

现在没有跨页面缓存库。在出现「同一资源在多个功能里重复请求且必须一致」之前，不新增全局 store。

### 5.5 API 客户端边界

`createIdentityRequest` 留在 `platform`，只负责超时、中止、CSRF、未登录和契约不符。业务错误文案按域拆到对应 feature，或由契约错误码生成。每个 feature 的 `client.ts` 只描述自己的路径和响应守卫，路径前缀从该端的一个常量来（`/api/v1`、`/api/tenant-admin/v1`、`/api/platform-admin/v1`），不在组件里拼 `fetch`。

生成客户端可以后做。先把手写客户端的目录和前缀收拢，避免生成器把今天的环固化进 `generated/`。

### 5.6 迁移路径

每一步都保持 `npm run build` 和现有相关测试可跑，不在同一步改行为。

1. **把本盘点收成 ADR，并加上导入检查的允许清单。** 只新增脚本和文档。清单记录今天的环，CI 拒绝新的违规 import。没有这道门，后面的搬迁会边搬边长新环。
2. **给演示根文件加物理目录，用再导出保持旧路径。** 把 `store.tsx`、`model.ts`、`briefing*.ts`、`konggu*`、`pages/` 移入 `src/demo/`（或等价名字），原路径留薄再导出。正式代码的 import 先不变。这一步让「什么是演示」在树上可见。
3. **抽出 `platform` 传输层。** `identity/client.ts` 的 `fetch` 封装移到 `platform/http`，原文件再导出。错误文案可以暂留原处。`useRemote` 改为依赖 `platform` 的会话，而不是让 `shared` 引用 `identity`。
4. **从 `components/` 抽出正式代码真正用到的无状态组件到 `shared`。** 正式 feature 改为引用新路径。仍引用 `DemoState` 的文件留在演示侧。
5. **选一个叶子功能做样板。** `news`、`plans` 或 `documents` 体积小、已有 `client.ts`。给它补上路由描述，从 `AccessApp` 的条件分支改成查表。行为不变，用现有 e2e 看这条路径。
6. **再拆壳，而不是先拆最大页面。** 把 `AccessApp` 的 hash 解析移进工作空间路由模块；`TenantConsole` 的页切换移进企业端路由模块。prototype 与 governance 先只登记为「第三、第四入口」，不在同一步并进控制台，避免把三套信息架构合成一次大改。
7. **按样板迁移会话、资料库、正式画报。** 每迁移一个就删掉允许清单里对应的环。画报要等第 4 步的纯函数落地后再动，否则会再次绑回演示 `briefing.ts`。
8. **最后处理官网深引用和重复舞台。** 主仓路径稳定之后再改 `site/` 的 alias。在此之前冻结官网对新内部路径的引用即可。

不在这条路径里的事：换成 React Router、引入全局状态库、拆成多个 npm 包、为移动 App 建工程、合并企业管理三套视觉。它们都要等边界守住之后单独决定。

## 建议的下一份 ADR

题目：**前端模块边界：演示内核与正式三端如何分家**。

要回答的决定是：正式代码禁止依赖演示状态的规则、`shared` 是否允许知道会话、企业管理 prototype / governance 在第一期迁移里是保留为独立入口还是并入控制台。本盘点建议保留为独立入口，但那一项仍应在 ADR 里确认，因为它影响第 6 步的范围。
