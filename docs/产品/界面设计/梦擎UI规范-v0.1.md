# 梦擎 UI 规范 v0.1

> **目标落点（入库路径）**：`docs/产品/界面设计/梦擎UI规范-v0.1.md`  
> **本轮状态**：**第三轮 · 按第二轮拍板修订**（本地于 `/workspace/agent-tools/dreamcore-ui-round2/`；**本助手不 push**；推仓由总监/云端另开）  
> **执笔**：梦擎·UI体验执行助手  
> **日期**：2026-10-29（Asia/Shanghai）  
> **依据**：首轮盘点 + 总监第一/二轮拍板（同系统异表面 / IA / P0 / Demo·Live·token / §6 真源 theme.css）

---

## 文档说明

| 项 | 内容 |
| --- | --- |
| 适用范围 | workspace / tenant-admin / platform-admin 三端；主任务流画报→会话→原生 |
| 非范围 | 本轮不引入 antd/MUI/shadcn；不拆 `packages/ui`；不改运行时代码 |
| 章节标记 | **【已拍板】** / **【已拍板·基于 theme.css】** 正文生效；**【待定】** / **【待定·提纲占位】** 仅占位（§8–13 已补拟写要点，数值未当真源） |
| 关联 | DEC-130；2026-10-27 原生对齐；智能画报卡片规范；首轮审计 `dreamcore-ui-audit-2026-10-29.md` |

---

## 完整目录

1. [品牌与表面（D / D′）](#1-品牌与表面d--d) · **【已拍板】**  
2. [组件策略 Keep / Converge / New](#2-组件策略-keep--converge--new) · **【已拍板】**  
3. [信息架构：画报 → 会话 Deck → 原生同壳](#3-信息架构画报--会话-deck--原生同壳) · **【已拍板】**  
4. [P0 / P1 页面范围](#4-p0--p1-页面范围) · **【已拍板】**  
5. [Demo / Live 边界与 Token 门禁](#5-demo--live-边界与-token-门禁) · **【已拍板】**  
6. [设计 Token（色 / 字 / 间距 / 半径 / 阴影）](#6-设计-token色--字--间距--半径--阴影) · **【已拍板·基于 theme.css】**  
7. [交互态词典](#7-交互态词典) · **【已拍板·初稿提纲】**  
8. [壳层规范（Workspace Topbar / Admin Sidebar）](#8-壳层规范workspace-topbar--admin-sidebar) · **【待定·提纲占位】**  
9. [控件规范（Button / Field / Modal / …）](#9-控件规范button--field--modal--) · **【待定·提纲占位】**  
10. [复合模式（Deck / Composer / 阅读层 / 决策卡 / …）](#10-复合模式deck--composer--阅读层--决策卡--) · **【待定·提纲占位】**  
11. [内容模式（画报卡 / 消息 / 原生结论优先）](#11-内容模式画报卡--消息--原生结论优先) · **【待定·提纲占位】**  
12. [无障碍与动效](#12-无障碍与动效) · **【待定·提纲占位】**  
13. [文案语气](#13-文案语气) · **【待定·提纲占位】**  
14. [附录](#14-附录) · 含下线清单

---

## 1. 品牌与表面（D / D′）

**【已拍板】**

### 1.1 定位一句话

三端是 **同设计系统、同组件基元、异表面主题与壳层范式**——「**同系统异表面**」。

- **不要**把 workspace 改成管理端侧栏。  
- **不要**让管理端退回冷玻璃以「强行一家」。  
- **要统一**：token 命名、控件态、圆角阶梯、反馈文案语气、空状态模式。

### 1.2 表面分工（DEC-130）

| 表面 | 风格名 | 气质 | 入口 |
| --- | --- | --- | --- |
| workspace | **D 克制版** | 冷柔浅色、毛玻璃、**单一靛蓝**强调；类型标签中性灰；关键数字纯墨；渐变流光**仅** Composer 等「AI 在场」 | workspace · `data-surface=workspace` |
| tenant-admin / platform-admin | **D′ 梦核日光** | 暖色画布、香槟金 + 霜蓝光晕；香槟=梦核/处理，品牌蓝=操作，琥珀=输出，珊瑚=异常；标题/大数字衬线 | AdminShell · `admin-theme.css` |

### 1.3 色温策略

- **D / D′ 色温保持有意分化**（一眼可区分工作空间 vs 管理端）。  
- 分化不构成「两套组件库」；共享 `src/shared/theme.css` + 表面覆盖。  
- 产品名：梦擎（工作空间）/ 梦核引擎 Mengine（管理与引擎语境）——细则 **【待定】** 写入品牌小节扩写。

---

## 2. 组件策略 Keep / Converge / New

**【已拍板】**

| 策略 | 对象 | 说明 |
| --- | --- | --- |
| **Keep** | `src/shared/ui` 基元；lucide-react；CSS 变量主题；AdminShell；LiveConversationDeck | 已验证；符合「无大库」选择 |
| **Converge** | 硬编码色/字号/半径/阴影 → token；Demo↔Live 边界；Button 变体与 `.button`；原生独立页 vs 内嵌；空状态/表格/表单密度；`:root` 24 vs workspace 22 | 治理第一优先 |
| **New** | 本文档；控件态词典；Deck 卡类型目录；三端壳层规范；可选 Story/预览页；`--grid-gap` | **先文档+示例**，再考虑拆包 |
| **Avoid（本阶段）** | 引入 **antd / MUI / shadcn** 整库；立刻拆 `packages/ui` | 允许只借鉴「模式」不引进依赖 |

本阶段：**不引入大库；不拆 packages/ui。**

---

## 3. 信息架构：画报 → 会话 Deck → 原生同壳

**【已拍板】**

```
画报 Briefing ──发起/携带上下文──▶ 会话 Conversation（Deck）
                                      │
                                      ├─ 普通任务会话卡
                                      └─ 原生会话卡 Native（同壳异内容）
```

| 模式 | 心智 | 主路径 | 打断 |
| --- | --- | --- | --- |
| Briefing | 读与发现 | `briefing-live` 杂志网格 + 阅读层 | 弱 |
| Conversation | 问与交付 | `conversation` Deck + Composer | 中 |
| Native | 委托与盯进度 | **同 Deck 内嵌** Native* | 强但克制（仅需你时顶栏） |

### 3.1 路由与遗留

| 项 | 定稿 |
| --- | --- |
| 主路径 | 原生会话 **只做 deck 内嵌** |
| `/native-conversations` | **写入本季下线清单**（附录 D）；本轮仅文档标注；真下线/重定向等总监另派工程 |
| Demo 页 | 见 §5；评审默认不看 |

### 3.2 跨模式跳转

- 画报阅读层 → 会话：携带 `briefing-context`；会话侧上下文条默认在 **Composer 上方**（第二轮拍板③）。  
- 列表：原生行合并进空间分组，与普通会话同行。  
- Deck 默认展示形态：**页面**；overlay 保留可切换（第二轮拍板②）。  
- pending 时列表 **不允许**只读预览其他会话（第二轮拍板④）。

### 3.3 「需你」顶栏（原生）

多条待处理时：**汇总一行 +「去处理」定位第一条**（第二轮拍板④）。

---

## 4. P0 / P1 页面范围

**【已拍板】**

### 4.1 P0（线框已交付 · 第三轮已定数值）

| 页面 | 线框文件 |
| --- | --- |
| 画报首页（推荐网格 + 顶栏） | `wireframe-briefing-home.md` |
| 会话工作页（Deck + Composer + 结果卡） | `wireframe-conversation-deck.md` |
| 原生会话（同 Deck + 过程折叠 + 决策卡 + 成果分页） | `wireframe-native-conversation.md` |

### 4.2 P1（只排队，不并行铺开）

- 画报阅读层 → 发起会话（跨模式细标注）  
- 会话列表（原生行合并、空间分组）细稿  
- 企业管理壳样板页  
- 总台概览 / 登录卡  

### 4.3 P2（更后）

- 引擎仪表盘全屏特例  
- 资料库 / 附件阅读  
- 能力中心 design 预览与产品对齐  

线框格式：Markdown（ASCII/mermaid + 标注）；**暂不强制 Figma**。像素级 Live 对照暂缓除非发现冲突。

---

## 5. Demo / Live 边界与 Token 门禁

**【已拍板 · 本轮仅文档约定，不改代码】**

### 5.1 Demo / Live

| 规则 | 说明 |
| --- | --- |
| **评审默认只看 Live** | 画报 `src/briefing-live/*`；会话 `src/conversation/*`；原生 `src/native-conversation/*` 内嵌路径 |
| Demo / 历史 | `src/pages/Briefing.tsx`、`pages/Conversation.tsx`、根 `App.tsx` 等 —— **不作为** UI 验收依据 |
| 设计评审检查单 | 打开页前面问：「是 Live 吗？」；截图需标明路径 |
| 工程后续（非本轮） | 隔离演示入口或加显式「Demo」标识 —— 另立项 |

### 5.2 Token 门禁（文档约定）

| 规则 | 说明 |
| --- | --- |
| **新样式走 token** | 颜色、字号、半径、阴影、状态色优先 `theme.css` / 表面覆盖变量 |
| 禁止 | 在新 PR 中新增与 token 平行的硬编码色板「临时值」而不登记例外 |
| 状态色 | 原生与全局提醒/出错/完成使用 `--state-warn|error|ok`（及 soft） |
| 清扫 | 存量硬编码属 Converge 批次，不在本规范 v0.1 一次清完 |
| 门禁落地 | ESLint/Stylelint 等 **待工程排期**；本轮只约定原则 |

### 5.3 实现锚点（只读）

- `src/shared/theme.css` —— **v0.1 Token 真源**（含 `:root` 与 `[data-surface=workspace]`）  
- `src/admin/admin-theme.css` —— D′ 管理端表面覆盖  
- ~~`src/workspace/workspace-theme.css`~~ —— **仓库中不存在**；workspace 覆盖写在 `theme.css` 内  
- `src/shared/ui.tsx`

---

## 6. 设计 Token（色 / 字 / 间距 / 半径 / 阴影）

**【已拍板·基于 theme.css】**

> **真源路径**：`src/shared/theme.css`（现行仓库 main）  
> **表面覆盖**：workspace → 同文件 `:root[data-surface='workspace']`；管理端 → `src/admin/admin-theme.css`  
> **本轮**：文档整理 + 拍板约定（`--grid-gap: 12px`、圆角 22 同族）；**不改业务代码**  
> **读取日期**：2026-10-29（Asia/Shanghai）

### 6.0 读取范围与分层

| 层 | 选择器 / 文件 | 作用 |
| --- | --- | --- |
| 基线 | `:root`（`theme.css`） | 四字阶、默认色、半径、状态色、控件基元 |
| Workspace · D | `:root[data-surface='workspace']` | 冷柔画布、单一靛蓝、玻璃、会话卡圆角 **22** |
| Admin · D′ | `admin-theme.css`（`tenant-admin` / `platform-admin` / `headquarters-support`） | 暖白画布、香槟/霜蓝、衬线标题与大数字 |
| 基元类 | `.button` / `.icon-button` / `.badge` / `.modal` / `.field` / `.empty-state` / `.topbar` | 与 token 配套的共享样式 |

### 6.1 色板

#### 6.1.1 语义角色（跨表面同名）

| 变量 | `:root` 默认 | workspace 覆盖 | 用途 |
| --- | --- | --- | --- |
| `--canvas` | `#f8fbff` | `#f6f7fa` | 页画布 |
| `--ink` | `#2d3744` | `#191b2e` | 主墨 |
| `--ink-2` / `--muted` / `--text-secondary` | `#5f7283` | `#4f5368` | 次要文案 |
| `--ink-3` | `#8290a2` | `#8b8fa3` | 更弱 / 已读等 |
| `--line` | `#e6ecf1` | `rgb(25 27 46 / 8%)` | 分割线 |
| `--soft` | `#f5f8fa` | `rgb(25 27 46 / 4%)` | 浅底 |
| `--accent` | `#1769e0` | `#2f6fe0` | 主强调（workspace 单一靛蓝） |
| `--accent-hover` | `#1056bd` | `#2459c4` | 强调悬停 |
| `--accent-text` | `#ffffff` | （继承） | 实心按钮字 |
| `--accent-soft` | `#edf3ff` | `rgb(47 111 224 / 8%)` | 淡强调底 |
| `--selected` | `#e4eeff` | `rgb(47 111 224 / 10%)` | 列表选中底 |
| `--blue-ink` | `#1759bd` | `#2459c4` | 选中字 / 链接强调 |
| `--surface` | `#fff` | `rgb(255 255 255 / 70%)` | 玻璃面 |
| `--surface-raised` | `#fff` | `#fff` | 抬升面 |
| `--card-edge` / `--glass-edge` | `#e4e8ee` | 玻璃白边 | 卡缘 |
| `--card-shadow` | `0 5px 20px #1e355b0b` | inset 高光 + `0 8px 30px rgb(30 50 90 / 6%)` | 卡阴影 |

#### 6.1.2 状态色（跨表面共享 · 勿硬编码）

| 变量 | 值 | 用途 |
| --- | --- | --- |
| `--state-warn` | `#9a5b10` | 需你处理、费用提醒线 |
| `--state-warn-soft` | `rgb(196 128 32 / 12%)` | warn 浅底 |
| `--state-error` | `#a14e4e` | 失败 / 出错 |
| `--state-error-soft` | `rgb(161 78 78 / 9%)` | error 浅底 |
| `--state-ok` | `#2f7a4f` | 完成点缀（不常驻顶栏） |

#### 6.1.3 Admin · D′ 补充（`admin-theme.css`）

| 变量 / 语义 | 约值 | 用途 |
| --- | --- | --- |
| `--canvas` | `#f5f3ee` | 暖色画布 + 香槟/霜蓝径向 |
| `--ink` / `--text` | `#1d1b17` | 暖墨 |
| `--accent` / `--blue` | `#3f63c9` | 操作蓝 |
| `--champagne` | `#c99a45` | 梦核 / 处理 |
| `--gold` | `#b8752a` | 输出 |
| `--coral` | `#e0594b` | 异常 |
| `--panel` / `--panel-edge` / `--panel-shadow` | 暖白毛玻璃 | 管理面板 |
| `--title-serif` / `--num-serif` | Noto Serif SC 等 | 标题与大数字 |

色温 **有意分化**（§1）；不要求与 workspace 同色相。

### 6.2 字阶

| 变量 | 值 | 典型用法 |
| --- | --- | --- |
| `--font-caption` | **12px** | 元信息、badge、small |
| `--font-body` | **14px** | 正文、按钮、输入 |
| `--font-heading` | **16px** | h2、顶栏标题 |
| `--font-display` | **24px** | h1、展示级 |

字栈（`:root`）：`Inter, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif`。  
字重：标题/strong ≈ **550**；按钮常规 450、primary 550。  
行高：`p` ≈ 1.75；`h1` 1.4；`h2`/`h3` 1.5。  
Admin 大数字可用衬线 36–40px（表面例外，非四字阶替换）。

### 6.3 间距阶梯

| 阶 | 值 | 出处 / 用途 |
| --- | --- | --- |
| 微 | 4–7px | badge padding、icon gap、chip 微距 |
| 紧 | **8px** | `.row` gap、顶栏 actions gap、field 内 gap |
| **网格** | **`--grid-gap: 12px`【已定·待写入 theme】** | 画报杂志网格；第二轮拍板① |
| 段 | 12–16px | `.between` gap 12；模态/字段外距 |
| 块 | 18–24px | `.field` margin、modal padding 24 |
| 空状态 | padding 55×20；min-height 250；icon 盒 57 | `.empty-state` |

**布局宽度**：内容居中参考 1600px（`.topbar` padding 公式）；`--sidebar-width: 108px`；`--preview-width: 370px`；`--topbar-row-height: 80px`；`--card-header-height: 48px`（header padding block 8 / inline 20）。

> **拍板落地**：在 `theme.css` 的 `:root`（或 workspace 块）增加 `--grid-gap: 12px`；画报网格消费该变量。本轮 **只约定，不改代码**。

### 6.4 半径阶梯 · **【已定·22 同族】**

| Token / 类 | 值 | 用途 |
| --- | --- | --- |
| badge | 5px | `.badge` |
| icon-button | **7px** | `.icon-button` |
| `--radius` | **8px** | `.button`、输入框 |
| `--radius-panel` | **12px** | Composer / 面板级 |
| empty-icon | 14px | 空状态图标盒 |
| modal | 16px | `.modal` |
| **`--conversation-card-radius`** | **22px**（workspace） | **Deck / 会话卡 / 画报卡同族**【已定】 |
| admin sidebar | 22px | 管理端侧栏圆角（D′） |
| 胶囊 | 999px | 分段/头像钮 |

**圆角 22 阶梯约定（第二轮拍板①）**

1. 画报卡圆角 = **22px**，与 Deck/会话卡同族，**不再**采用讨论稿 24px 画报例外。  
2. workspace 真源已是 `--conversation-card-radius: 22px`。  
3. **冲突见 §6.7**：`:root` 默认仍为 **24px**。

### 6.5 阴影与玻璃

| 项 | workspace | 说明 |
| --- | --- | --- |
| `--card-shadow` | inset 高光 + 轻外影 | 卡抬升 |
| `--glass-blur` | `blur(28px) saturate(1.5)` | 毛玻璃 |
| modal 影 | `0 24px 100px #20394b24` | 对话框 |
| nav-link 影 | `0 2px 10px #2636470d` | 轨图标钮 |
| Admin `--panel-shadow` | inset + `0 10px 36px rgb(60 48 20 / 6%)` | D′ 面板 |
| Composer glow | 渐变流光边 | **唯一**强「AI 在场」；模式约定非通用色 token |

画布背景：workspace / admin 均为多层 `radial-gradient` + `--canvas`，`background-attachment: fixed`。

### 6.6 动效时长

| 项 | 值 |
| --- | --- |
| 按钮 transition | **0.16s**（background / border / color / box-shadow） |
| nav / label | **160ms ease** |
| `prefers-reduced-motion: reduce` | 全局关闭非必要 transition；`scroll-behavior: auto` |
| disabled | `opacity: 0.46`；`cursor: default` |
| focus-visible（button/a） | `outline: 2px solid var(--accent); offset 3px` |
| focus（input 等） | outline 2px `#a1bff0`、offset 1、边 `#709fe8` —— **硬编码，见 §6.7** |

### 6.7 与拍板数值的冲突 / 未入 token 硬编码（Converge）

| 项 | 现状 | 拍板 / 规范 | 处置 |
| --- | --- | --- | --- |
| `--conversation-card-radius` | `:root` = **24px**；workspace = **22px** | 画报+Deck **22 同族** | **冲突已标**：工程 Converge 时收敛基线；评审以 workspace **22** 为准 |
| `--grid-gap` | **theme.css 中不存在** | **12px** 已定 | 文档约定；待写入 theme 并让网格消费 |
| 画报讨论稿 24px 圆角 | 旧规范稿 | 废止为例外 | 以本 §6 + 线框为准 |
| `.button.danger` 色 | 硬编码 `#a14e4e` / 边 `#edd4d4` | 应对齐 `--state-error` | Converge |
| input:focus 色 | 硬编码 `#a1bff0` / `#709fe8` | 应对齐 accent 系 token | Converge |
| 杂志类型色 | `briefingMagazine.css` 内 `--magazine-*` 硬编码 | 可保留为内容色板，应登记或收敛 | Converge 候选 |
| `workspace-theme.css` | **路径不存在** | 审计曾写该路径 | 以 `theme.css` workspace 块为准 |

### 6.8 新样式门禁（重申 §5.2）

- 新 PR 颜色 / 字号 / 半径 / 阴影 / 状态色 **优先变量**。  
- 新增与 token 平行的硬编码色板须登记例外。  
- 存量清扫按 Converge 分批，不在 v0.1 一次清完。

---

## 7. 交互态词典

**【已拍板 · 初稿提纲】** —— 色温可随表面变，**态名与行为跨端统一**。

### 7.1 原则

1. 同一控件在 D 与 D′ 上 **态集合一致**（hover / focus-visible / active / disabled / loading / selected / error）。  
2. 视觉可用表面色，但 **不得缺态**（例如管理端按钮无 focus 环）。  
3. `prefers-reduced-motion: reduce` 时关闭非必要过渡（theme 已有全局原则）。

### 7.2 态定义提纲

| 态 | 行为要点 | 视觉要点（跨表面） |
| --- | --- | --- |
| **default** | 可点 | 基色；边 `line` 或实心 primary |
| **hover** | 指针设备 | 底 `soft` / `accent-hover`；勿大幅跳亮度 |
| **focus-visible** | 键盘 | `outline: 2px solid accent; offset 3px`（或输入类 offset 1 + 边强调） |
| **active / pressed** | 按下 | 略压或 selected 级反馈；短时 |
| **selected** | 列表/分栏当前项 | `--selected` 底 + `--blue-ink` 或表面等价；忌高饱和整块 |
| **disabled** | 不可用 | `opacity ≈ 0.46`；`cursor: default`；不响应点击 |
| **loading / pending** | 请求中 | 按钮内 spinner 或文案；**Composer 发送→停止**；配合 RequestGuard |
| **error** | 校验/失败 | `--state-error`；协助文案；可重试 |
| **warn** | 需你处理/费用线 | `--state-warn`；非错误 |
| **ok / success** | 完成点缀 | `--state-ok`；不滥用常驻 |

### 7.3 复合态（提纲）

| 模式 | 要点 |
| --- | --- |
| RequestGuard | pending 时禁切会话/切页；**禁只读预览其他会话**（已定） |
| 过程折叠 | 默认收；运行中示当前步 |
| 决策卡 | 仅待处理卡强调；完成后一行灰字 |
| 需你顶栏 | 无事 0 高；多条时 **汇总一行 +「去处理」定位第一条**（已定） |
| 空状态 | Empty + Lucide；短标题+说明+可选 CTA |
| 赞踩 | 原生仅末轮；桌面悬停显现 |

### 7.4 待扩写（仍属词典，细节待定）

- 表格行 hover/选中密度（管理端）  
- Toast / 内联错误谁优先  
- 拖拽态（画报关注视图）  

---

## 8. 壳层规范（Workspace Topbar / Admin Sidebar）

**【待定·提纲占位】** —— 下列为拟写子节 / 要点，**非已拍板正文**；尺寸以 §6 / Live 线框为准，本章不定新数值。

> **骨架事实（来自盘点，待回填）**：Workspace = Topbar + 场景；Admin = 左侧导航 + 标题/操作 Portal；管理端窄屏断点约 761px（以 Live 为准，本章不另定断点）。

### 拟写要点

1. **8.1 Workspace Topbar**：品牌/空间切换、场景导航、右侧账户与次要动作；与 `--topbar-row-height` 的关系（只引用 §6，不定新高）。  
2. **8.2 Admin Sidebar（D′）**：侧栏宽度语义（引用 `--sidebar-width`）、分组、当前项 selected 态（对齐 §7）；香槟/品牌蓝分工只复述 §1，不定新色。  
3. **8.3 Admin 标题 / 操作 Portal**：页头标题槽与右侧操作槽的职责切分；与 workspace 顶栏「异表面同系统」对照。  
4. **8.4 窄屏 / 抽屉**：workspace 列表抽屉 vs admin 侧栏折叠；触点与关闭约定（细节待拍板）。  
5. **8.5 引擎全屏特例**：是否单列「返回约定」；与 P2 引擎仪表盘的边界（见 §4.3）。  
6. **8.6 三端壳层对照表**：同系统异表面一页速查（Keep 壳范式，不统一成一种壳）。  
7. **仍开放**：移动端抽屉交互细则；引擎顶栏返回是否写入本章或附录。

---

## 9. 控件规范（Button / Field / Modal / …）

**【待定·提纲占位】** —— 拟写目录；变体命名与密度待拍板。基元锚点：`src/shared/ui` + `.button` / `.icon-button` / `.modal` / `.field` / `.badge`（§6.0）。

### 拟写要点

1. **9.1 Button**：primary / secondary / ghost / danger 四级命名草案；态全集对齐 §7；danger 色 Converge 指向 `--state-error`（§6.7）。  
2. **9.2 IconButton**：尺寸阶与 `--radius` / icon-button 7px 的引用关系；工具栏密度。  
3. **9.3 Field / Input**：标签、协助文案、error 态；focus 硬编码色列入 Converge（§6.7），本章不定替代色值。  
4. **9.4 Modal / Dialog**：圆角 16、影引用 §6；确认 / 破坏性确认与「非全屏挡 pending」边界（见会话线框 RequestGuard）。  
5. **9.5 Badge / Chip**：角标与建议 chip；caption 字阶；胶囊 999 与 8px 圆角分工。  
6. **9.6 EmptyState**：结构（图标盒 + 短标题 + 说明 + 可选 CTA）；padding 引用 `.empty-state`（§6.3）。  
7. **9.7 管理端修饰**：`.admin-control` 与 workspace 基元对齐表（D′ 色温覆盖，态名不减）。  
8. **仍开放**：表格行控件密度；Toast 与内联错误优先级（与 §7.4 合流）。

---

## 10. 复合模式（Deck / Composer / 阅读层 / 决策卡 / …）

**【待定·提纲占位】** —— 定稿形态为「模式目录 + 链到 P0 线框」；已拍板行为只引用 §3 / 线框「已定」，本章不重定数值。

### 拟写要点

1. **10.1 Deck（LiveConversationDeck）**：默认 **页面** 形态；overlay 可切换（§3.2）；卡头 / 卡圆角 22 同族（引用 §6.4）。  
2. **10.2 Composer**：唯一强 glow「AI 在场」；`--radius-panel`；发送↔停止；与原生同壳对齐。  
3. **10.3 画报上下文条**：默认挂 **Composer 上方**（§3.2）；有 `briefing-context` 才出现；回跳阅读层/画报。  
4. **10.4 阅读层（ReadingDialog）**：从画报卡进入；发起会话携带上下文；与「已有会话是否跳过阅读层」开放项的边界。  
5. **10.5 决策卡 +「需你」顶栏**：待处理强调 / 完成后灰字；多条时 **汇总一行 +「去处理」定位第一条**（§3.3）。  
6. **10.6 过程折叠行**：默认收；文案形态「处理过程 · N 步」；运行中示当前步（§7.3）。  
7. **10.7 RequestGuard / Pager / Portal 标题槽**：pending 禁切会话与禁只读预览；成果分页；Admin Portal 槽位是否单列。  
8. **仍开放**：Deck 卡类型完整目录；overlay 切换入口文案与动效是否写入 §12。

---

## 11. 内容模式（画报卡 / 消息 / 原生结论优先）

**【待定·提纲占位】** —— 内容层规范；几何已定项只交叉引用，不在本章另立色板/半径真源。

### 拟写要点

1. **11.1 画报卡规格**：四种标准占位（1×1 / 2×1 等，以卡片规范 2026-09-24 + 线框为准）；**圆角 22**、**`--grid-gap` 12** 引用 §6 / 画报线框。  
2. **11.2 角标与类型色**：角标无障碍名称；杂志类型色 `--magazine-*` 为 Converge 候选（§6.7），本章可列登记原则不定新色。  
3. **11.3 消息气泡 / 结果卡**：用户/助手区分；建议 chip；结果卡与 Deck 卡同族圆角关系（引用线框，开放项不拍板）。  
4. **11.4 原生结论优先**：先结论、后过程、要你时才打断（10-27 对齐）；工具/思考进过程折叠。  
5. **11.5 赞 / 踩**：仅末轮；桌面悬停显现（§7.3）。  
6. **11.6 跨模式携带字段**：`briefing-context` 最小字段清单（卡身份、摘要、依据）——内容契约，待产品确认。  
7. **仍开放**：「已有会话」是否允许跳过阅读层（画报线框仍开放）；结果卡内嵌预览密度。

---

## 12. 无障碍与动效

**【待定·提纲占位】** —— 在 theme 已有原则之上扩写检查单；时长数值以 §6.6 为准，本章不定新曲线表。

### 拟写要点

1. **12.1 焦点**：`focus-visible` 环（button/a）与 input focus 差异；Converge 前评审以「可见焦点」为底线（§6.6 / §7）。  
2. **12.2 读屏 / `sr-only`**：角标名称、图标按钮可访问名、决策卡状态宣告。  
3. **12.3 `prefers-reduced-motion`**：全局关闭非必要 transition；`scroll-behavior`（§6.6）；Composer glow 是否降级为静态边（待定）。  
4. **12.4 触屏等价**：悬停才显现的赞踩 / 次要动作在触屏上的常驻或长按策略（§7.4 相关）。  
5. **12.5 动效例外**：引擎仪表盘全屏动效是否豁免；须显式登记，默认不豁免。  
6. **12.6 对比与状态色**：warn/error/ok 不仅靠色相（须有文案或图标）；D / D′ 各自验收。  
7. **仍开放**：完整键盘路径（Deck 卡带、阅读层）；焦点陷阱与 Modal。

---

## 13. 文案语气

**【待定·提纲占位】** —— 产品中文 UI 语气；已见诸线框的固定短语先收录为「现行」，完整对照表待拍板。

### 拟写要点

1. **13.1 总则**：短句、状态明确、避免内部代号上屏；中文 UI 优先。  
2. **13.2 原生固定短语（现行·来自线框）**：「去处理」；「处理过程 · N 步」；需你汇总一行；完成后决策 → 一行灰字。  
3. **13.3 空状态句式**：短标题 + 一行说明 + 可选 CTA（对齐 EmptyState）；三端各给 1–2 例（待写）。  
4. **13.4 错误 / 失败句式**：可重试优先；配合 `--state-error`；与 Toast vs 内联的职责（待与 §7.4 对齐）。  
5. **13.5 按钮动词**：发送 / 停止、发起会话、回画报、去处理——动词表与禁用时文案。  
6. **13.6 品牌称谓**：梦擎（工作空间）/ 梦核引擎 Mengine（管理与引擎）——细则仍待品牌小节（§1.3）。  
7. **仍开放**：费用提醒 / warn 线文案模板；Demo 页是否统一加「演示」前缀（工程另项，§5）。

---

## 14. 附录

### A. Token 速查（workspace 生效值 · 与 §6 一致）

| 变量 | 约值 |
| --- | --- |
| `--font-caption/body/heading/display` | 12 / 14 / 16 / 24 |
| `--accent`（workspace） | `#2f6fe0` |
| `--canvas`（workspace） | `#f6f7fa` |
| `--ink`（workspace） | `#191b2e` |
| `--radius` / `--radius-panel` | 8 / 12 |
| `--conversation-card-radius`（workspace） | **22px** |
| `--grid-gap`（约定） | **12px**（待写入 theme） |
| `--card-header-height` | 48px |
| `--state-warn/error/ok` | `#9a5b10` / `#a14e4e` / `#2f7a4f` |

### B. 关键源文件

- `src/shared/theme.css`（真源）  
- `src/admin/admin-theme.css`  
- `src/shared/ui.tsx`  
- 风格决策 `docs/产品/原型/style-directions/README.md`  
- 首轮审计 `/workspace/agent-tools/dreamcore-ui-audit-2026-10-29.md`

### C. 修订记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v0.1 审阅稿 | 2026-10-29 | 目录齐全；①–⑤与交互态提纲、Demo/Live·token 门禁写入；§6 待定 |
| v0.1 第三轮 | 2026-10-29 | §6 全文基于 theme.css；①–④落入 IA/线框/附录；下线清单；冲突表 |
| v0.1 提纲补丁 | 2026-10-29 | §8–13 补「提纲占位」（仍【待定】；不编造未拍板数值当真源）；§1–7 未改 |

### D. 本季下线清单（文档标注 · 第二轮拍板④）

| 项 | 状态 | 本轮 | 工程 |
| --- | --- | --- | --- |
| `/native-conversations` + `NativeConversations.tsx` | 遗留 · **入本季下线清单** | 仅文档 | 真下线/重定向 **等总监另派**；本助手不改代码 |

主路径：原生会话 **仅** Deck 内嵌。

### E. 第二轮拍板对照

| # | 拍板 | 落点 |
| --- | --- | --- |
| ① | 画报卡圆角 22；`--grid-gap` 12 | 线框画报 §4.2；规范 §6.3–6.4 |
| ② | Deck 默认 **页面**；overlay 可切换 | 线框会话 §4.4；规范 §3.2 |
| ③ | 上下文条默认 Composer 上方 | 线框会话 §7；规范 §3.2 |
| ④ | 需你汇总一行+去处理第一条；`/native-conversations` 入下线清单；pending 禁只读预览 | 线框原生 §7/§11；规范 §3.1/§3.3/附录 D |
| ⑤ | Token 真源 `theme.css`；扩写 §6；老板批准前不推仓 | 本文件 §6；本助手不 push |

---

*梦擎 UI 规范 v0.1 · 第三轮本地稿 · 本助手不推仓*
