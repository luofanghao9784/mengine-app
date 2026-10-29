/**
 * 前端模块边界（ADR D1 / D2，以及 feature 页面互引）。
 *
 * 规则只描述「不允许的方向」。盘点时已经存在的边在
 * config/frontend-boundary-allowlist.cjs，测试会拒绝清单外的新边，
 * 也会拒绝清单里已经消失的边。
 *
 * 说明：docs/architecture/dependency-cruiser.md
 * 决策：docs/architecture/ADR-前端模块边界-演示与正式分家.md
 */

/** 迁入 src/demo/ 之前，这些路径就是演示内核（ADR D1 / D4）。 */
const DEMO_TARGETS = [
  '^src/demo/',
  '^src/store\\.tsx$',
  '^src/model\\.ts$',
  // 根上的 briefing*.ts(x)，不包含 src/briefing-live/。
  '^src/briefing(?!-)[^/]*\\.tsx?$',
  '^src/konggu[^/]*\\.tsx?$',
  '^src/pages/',
];

/**
 * 这些路径属于演示壳或演示内核，不是 Live 起点。
 * 它们互相引用 store / model / briefing 不算 Live→Demo。
 * libraryModel、colleagues、workspaceExamples 在盘点里和演示内核成环，
 * 但还不在 D4 的迁入清单上；先不把它们当成 Live，避免把演示内部边记成违规。
 * 正式代码新增对它们的依赖，本规则尚未覆盖，见文档「后续收紧」。
 */
const NOT_LIVE = [
  ...DEMO_TARGETS,
  '^src/ninepop/',
  '^src/main\\.tsx$',
  '^src/App\\.tsx$',
  '^src/libraryModel\\.ts$',
  '^src/colleagues\\.ts$',
  '^src/workspaceExamples\\.ts$',
];

/**
 * 还没有 src/features/。页面互引按今天的业务目录算 feature。
 * 壳层（identity、platform）和共享层不在这条规则的起点里：
 * 壳在 D5 之前本来就要装配各 feature 的页面。
 */
const NOT_A_FEATURE = 'shared|identity|platform|components|pages|demo|ninepop|data';

/** 页面文件：壳会挂的屏、面板，以及盘点点名的页面级互引。钩子（use*）不算页面。 */
const PAGE_FILE =
  '(?:Page|Home|Console|Panel|App|Library|Documents|Conversations|Activity|Plans|Briefing|Recommendations|Publication|TaskReadingBody)\\.tsx$';

// 拆成两条是因为嵌套量词会被 dependency-cruiser 的 safe-regex 拒绝。
// 一条覆盖 feature 根上的页面文件，一条覆盖再下一层（目前只有 native-conversation/chat）。
const FEATURE_PAGE = [
  `^src/(?!(?:${NOT_A_FEATURE})/)[^/]+/(?!use)[^/]*${PAGE_FILE}`,
  `^src/(?!(?:${NOT_A_FEATURE})/)[^/]+/[^/]+/(?!use)[^/]*${PAGE_FILE}`,
];

/** D5 之前仍由壳直接装配页面的入口。新增壳文件要在这里登记，并在文档写明。 */
const SHELL_ENTRIES = [
  '^src/admin/TenantConsole\\.tsx$',
  '^src/admin/PlatformConsole\\.tsx$',
  '^src/admin/AdminShell\\.tsx$',
  '^src/admin/prototype/SceneShell\\.tsx$',
  '^src/admin/prototype/main\\.tsx$',
  '^src/admin/governance/main\\.tsx$',
];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'd1-live-not-to-demo',
      comment:
        'ADR D1：Live 不得依赖 Demo。正式路径不得 import src/demo/，也不得新增对根上 store、model、briefing*、konggu*、pages 的依赖。',
      severity: 'error',
      from: {
        path: '^src/',
        pathNot: NOT_LIVE,
      },
      to: {
        path: DEMO_TARGETS,
      },
    },
    {
      name: 'd2-shared-not-session',
      comment:
        'ADR D2：shared 不得知道会话。shared 只依赖自身和外部包，因此不得 import identity、platform、会话模块（conversation / native-conversation）、features 或 demo，也不得 import 其他 src 业务目录。',
      severity: 'error',
      from: { path: '^src/shared/' },
      to: {
        path: '^src/',
        pathNot: '^src/shared/',
      },
    },
    {
      name: 'feature-not-to-foreign-page',
      comment:
        'ADR 强制手段第 3 条：一个 feature 不得 import 另一个 feature 的页面文件。跨功能走路由参数，或走 shared 里的纯类型。壳层装配不在本规则内。',
      severity: 'error',
      from: {
        path: `^src/(?!(?:${NOT_A_FEATURE})/)([^/]+)/`,
        pathNot: SHELL_ENTRIES,
      },
      to: {
        path: FEATURE_PAGE,
        // $1 是起点 feature 目录名。同一 feature 内部引用自己的页面允许。
        pathNot: '^src/$1/',
      },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    exclude: {
      path: '\\.(css|svg|png|jpe?g|gif|webp|woff2?|ttf|eot)$',
    },
    // 仓库的 TypeScript 是 7。dependency-cruiser 18 仍只把 typescript <7 当成可用转译器，
    // 所以这里用 swc 直接解析 TS/TSX（含 import type），不走 tsc。
    parser: 'swc',
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.d.ts'],
    },
    skipAnalysisNotInRules: true,
  },
};
