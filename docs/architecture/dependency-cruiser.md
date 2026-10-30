# 前端依赖门禁

决策在 [ADR：前端模块边界](./ADR-前端模块边界-演示与正式分家.md)。本文只说明门禁怎么跑、三条规则对应哪一款、允许清单怎么改。

## 怎么跑

`npm test` 会跑 `tests/frontend-boundaries.test.ts`。只跑这一项：

```bash
npm run depcruise
```

失败时进程退出码非零。门禁跟 `npm test` 走。仓库已有 `.github/workflows/frontend-gate.yml`（指向 main 的 PR 触发，其中「B · npm test」步骤）与 `.github/workflows/contracts-engine-gate.yml`；depcruise 随 frontend-gate 的 `npm test` 在 CI 中执行，无需单独挂 job。

不要把不带参数的 `npx depcruise src` 当作门禁。它只应用 `.dependency-cruiser.cjs` 里的禁止规则，不读允许清单，干净工作区也会把存量边报成错误。dependency-cruiser 自带的 baseline 还会比较导入种类和原始说明符，和「只认 from → to」不是同一条边，所以允许清单没有塞进 `knownViolations`。

## 规则

| 规则名 | ADR | 拦住什么 |
| --- | --- | --- |
| `d1-live-not-to-demo` | D1 | Live 不得 import `src/demo/`。演示目录还没迁走时，也不得 import 根上的 `src/store.tsx`、`src/model.ts`、`src/briefing*.ts`、`src/konggu*`、`src/pages/` |
| `d2-shared-not-session` | D2 | `src/shared/**` 不得 import `identity`、`platform`、会话模块、`features`、`demo` |
| `feature-not-to-foreign-page` | 强制手段第 3 条 | 一个 feature 不得 import 另一个 feature 的页面文件 |

`src/briefing*.ts` 只匹配仓库根上的文件，不包含 `src/briefing-live/`。

D2 的实现比目录名单更紧一点：`shared` 只能依赖自己和外部包。这样在 `src/features/` 出现之前，`shared` 也不能去 import `material`、`conversation`、`native-conversation` 或其他业务目录。现状进清单的是 `shared` → `identity`。

不算 Live 起点、因此可以继续引用演示内核的，是演示文件自己，加上演示壳 `src/main.tsx`、`src/App.tsx`、`src/ninepop/`，以及仍和演示内核成环、但还不在 D4 迁入名单里的 `libraryModel.ts`、`colleagues.ts`、`workspaceExamples.ts`。

页面文件是业务目录里、文件名以 `Page`、`Home`、`Console`、`Panel`、`App`、`Library`、`Documents`、`Conversations`、`Activity`、`Plans`、`Briefing`、`Recommendations`、`Publication` 或 `TaskReadingBody` 结尾的 `.tsx`，且文件名不以 `use` 开头。同一 feature 内部引用自己的页面允许。目前覆盖 feature 根目录和再下一层（`native-conversation/chat`）。

壳层不在「feature 互引」的起点里。D5 之前它们本来就要装配页面：整个 `identity/`、`platform/`，以及 `admin/TenantConsole.tsx`、`admin/PlatformConsole.tsx`、`admin/AdminShell.tsx`、`admin/prototype/SceneShell.tsx`、`admin/prototype/main.tsx`、`admin/governance/main.tsx`。新增壳入口时改 `.dependency-cruiser.cjs` 里的 `SHELL_ENTRIES`，并在下面「后续收紧」补一句。

## 允许清单

文件是 `config/frontend-boundary-allowlist.cjs`。分组注释和每条的 `comment` 标了对应条款。

- 删掉一条 import 时，同一变更删掉清单里的那一条。漏删，测试会打印 `from -> to` 并失败。
- 新的 Live→Demo、shared→会话、feature 页面互引不要追加进清单。改依赖方向。
- 规则误伤壳层装配时，改 `SHELL_ENTRIES` 或页面文件名规则，不要把壳的边倒进清单。

## 复现一条失败

探针文件不要提交。

Live 依赖 Demo：

```ts
// src/identity/boundary-probe.ts
export { useDemo } from '../store';
```

`shared` 依赖会话：

```ts
// src/shared/boundary-probe.ts
export { useSession } from '../identity/session';
```

然后运行 `npm run depcruise`。输出应点名 `d1-live-not-to-demo` 或 `d2-shared-not-session` 以及这两个文件。确认失败后删掉探针。

## 解析

本仓库的 TypeScript 是 7。dependency-cruiser 18 只把 `typescript` 7 以前的编译器当成可用转译器，所以配置使用 `parser: "swc"`，由 `@swc/core` 解析 `.ts` / `.tsx`，包括 `import type`。

## 后续收紧

- `libraryModel.ts`、`colleagues.ts`、`workspaceExamples.ts` 还不是 D1 的目标。`conversationDeck.ts` 是 Live 和 Demo 共用的纯函数，也不是。正式代码新增对这几个根文件的依赖，当前不会失败。
- 只查直接 import。`components` → `libraryModel` → `model` 这种传递边不会因为第二跳被 D1 拦住。
- 页面规则不覆盖 `ReadingDialog` 这类名字不属于上面后缀的跨 feature 组件，也不覆盖比 `feature/子目录/文件` 更深的页面文件。
- ADR 架构表里的「`platform` 不 import 页面」还没有单独的规则。
- 壳直接挂页面，等 D5 的路由模块落地后再收紧。
- `site/` 对主仓的深引用不在本门禁里。
- 没有加 Knip。多入口下存量未使用导出很多，默认开启会让 `npm test` 失败。需要时单独做，并先用 warn 或分入口，不要和这次门禁混在一次改动里。
