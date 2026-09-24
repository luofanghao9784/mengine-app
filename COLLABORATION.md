# 梦核工作空间 Git 协作规则

用户已于 2026-09-21 确认按 [Git 多人协作方案](docs/技术/Git多人协作方案-V0.1.md) 初始化。当前 Demo、三端业务、Spring Boot 平台、独立引擎与契约已收敛到同一主线；源码和历史目录归属见[统一版本记录](docs/交接/开发目录整合与统一版本-2026-09-24.md)。

## 仓库与成员

- 私有远端：[dimmm1125-coder/dreamcore-workspace](https://github.com/dimmm1125-coder/dreamcore-workspace)。
- 唯一长期主线：`main`。两组均可访问源码，按职责分工；没有长期 `system`、`engine` 或个人分支。
- 当前维护账号为 `dimmm1125-coder`。其他成员和双方负责人尚未提供，未发送邀请；`CODEOWNERS` 先登记维护账号，成员到位后替换为实际责任人。
- 主线保护实际结果见 [初始化记录](docs/交接/Git初始化与验证-2026-09-21.md)。本地钩子不等于服务器端强制保护。

## 首次克隆

新成员先阅读 [同事开发入组指南](docs/交接/同事开发入组指南.md)，完成本人账号邀请、认证、首次启动和任务分工。

使用 `.node-version` 指定的 Node.js，执行：

```bash
git clone https://github.com/dimmm1125-coder/dreamcore-workspace.git
cd dreamcore-workspace
npm run setup:git
npm ci
npm run build
npm test
npm run test:git
npx playwright install chromium
npm run test:e2e:konggu
```

`setup:git` 不需要 npm 依赖，仅写本仓库配置：`.githooks`、`pull.ff=only`、`push.default=simple`，不修改全局 Git。新克隆不会自动启用钩子，每位开发者都要执行。Windows 使用 Git for Windows 提供的 shell 运行钩子。

当前默认场景为“空谷无界”；通用场景 E2E 保留历史用途，不用旧样例替代当前场景验收。运行命令见 [README](README.md)。

## 开工与并行任务

2026-09-24 起，日常开发统一以主目录最新 `main` 为基准。旧模块分支和 worktree 仅供历史追溯，不继续串接新功能；任务完成后及时集成，避免再次形成多个长期候选版本。临时 worktree 中的资料、账号和验证记录在确认保存前不得随目录删除。

每次开工先检查 `git status --short --branch`、`git fetch origin` 和 `git worktree list`。任务注明目标、原需求编号、负责路径、契约依赖与验收；分别使用 `codex/platform/<任务号>-<主题>`、`codex/engine/<任务号>-<主题>`、`codex/contract/<任务号>-<主题>`。

干净目录单任务可直接从 `origin/main` 建任务分支。同机并行或已有未提交工作时使用独立 worktree，例如：

```bash
git branch --no-track codex/platform/WS-001-task-submit origin/main
git worktree add ../dreamcore-WS-001 codex/platform/WS-001-task-submit
```

每位开发者各自 clone；同机并行任务各有目录和分支。不得在同一可写目录并发切分支、暂存或提交。worktree 共用引用和配置，公共 Git 管理动作由维护者协调。

端口、数据库、队列、缓存与日志也按任务隔离。浏览器检查支持独立端口：

```bash
CI=true PLAYWRIGHT_PORT=5187 npm run test:e2e:konggu
```

CI 模式拒绝复用已有服务；端口冲突时换本任务端口，不关闭其他任务服务。普通 `npm run dev` 默认端口仍为 5173。

## 提交与集成

1. 在任务分支修改，尽早开 Draft PR；一个 PR 完成一项可核验工作，目录搬迁与业务变化分开。
2. 用 `git add -- <明确文件路径>`，不使用 `git add .`。提交前检查 `git diff --cached --stat`、`git diff --cached` 和 `git diff --cached --check`。
3. 推送任务分支并向 `main` 发起 PR。普通变化由非作者审查；跨引擎契约变化须有双方评审结论。人员尚未登记时由维护者记录评审责任，不编造审批。
4. 已启用的 CI 检查通过、解决讨论后默认 squash merge。远端 CI 尚未启用期间，实际执行本地检查并在 PR 记录结果，由审查人核验；不能填写“远端 CI 已通过”。主线变化或解决冲突后重跑受影响检查，不把旧提交检查当作最新提交证据。
5. 合入后删除已完成的任务分支；确认本地修改/提交已保存再移除 worktree，不清理其他任务目录。

未共享分支可 rebase，共享分支优先 merge 主线。主线不强推、不删除；集成后的错误用新提交或 revert 修复。代码合入不自动触发生产部署。

本地钩子默认拦截直接推送 `main`。首次创建，以及服务端保护不可用期间的人工集成，由维护者先核验完整差异与当前提交测试，再单次执行：

```bash
DREAMCORE_ALLOW_MAIN_PUSH=1 git push origin main
```

开关仍不能删除或非快进更新 `main`，不要设成长期环境变量。钩子可被绕过，不能承担访问控制职责。远端保护可用后以 PR 与服务器规则为准。

## 责任、检查与发布

现阶段 `src/`、`public/` 和前端测试由系统与前端侧维护。平台已在 `apps/api/`，独立引擎在 `engine/`，解析器在 `workers/parser/`，契约在 `contracts/`；保持各自构建和版本边界。契约、根依赖锁、CI、公共文档与部署配置由维护者整合，受影响方审查。

引擎通过版本化协议接入，不导入平台内部类或直接写业务表。`CODEOWNERS` 列出多个 owner 不表示必须双方批准，维护者需核验双方评审结论。

已准备的 CI 执行 Git 钩子测试、前端构建、单元测试与空谷 E2E，固定汇总检查名为 `CI`；远端启用与运行状态以初始化记录为准。后端/引擎/契约测试随代码加入，不能称为已验收。CI 使用合成资料，不使用生产凭据。

2026-09-22 因现有授权缺少 `workflow`，CI 提交 `66823c5` 保留在本地 `codex/ci/workflow-authorization` 分支，主线先进行普通代码协作。新任务从最新 `origin/main` 开始；此前基于该 CI 提交建立的分支，不应将未授权的工作流一起合入主线，具体接续见初始化记录。

部署另行记录版本。平台、引擎使用独立版本和产物，固定提交 SHA、产物摘要、协议与迁移版本；兼容升级和回退需要实际演练。

## 独立官网与文件边界

`website/` 为现有 Sites 独立仓库，主仓库忽略整个目录，不使用 submodule。普通克隆、构建、测试不需要官网。只有制作官网联动包时才需要获准的官网仓库。

已有官网权限者可在主仓库根目录执行：

```bash
git clone https://git.chatgpt-team.site/7b8fdb5c-8b75-45d5-8a49-ac40fc25d9fd/appgprj_6aaf8e229bb8819187919b60d3562130.git website
```

已有 `website/` 时不要覆盖；地址不授予访问权限，无法获取时联系维护者。官网依据自身 README 维护，本次不更新它的提交或部署。官网打包脚本在目录缺失时明确报错；单独工作台仍可打包。

不提交依赖、构建输出、运行缓存、客户原始数据或凭据。示例配置只放占位值；内部需求和历史成本文档保留在私有仓库，不因此成为对外材料。少量设计/调研图片及成本附件保留，本次无需 Git LFS。
