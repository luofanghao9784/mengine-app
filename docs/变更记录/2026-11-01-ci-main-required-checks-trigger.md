# 2026-11-01 · main PR 必需检查始终触发

**改动级别**：L1 本地改动（仅 CI workflow）

## 改了什么

去掉三道指向 main 的 PR 门禁（API / 前端 / 契约·引擎）上的 `paths` 过滤，使分支保护要求的六项 status checks 对任意任务分支 PR 都会真实上报并执行；顺带把 `macos-preview-smoke` 的 `PREVIEW_HOME` 从非法的 job 级 `runner.temp` 挪到 step 初始化，消除 push 时 0 jobs 的失败噪音。

## 为什么改

`paths` 过滤让纯 docs / 协作配置类 PR（如 #106）整 workflow 不触发，保护规则仍等待「6 of 6 required status checks」，合并永久 BLOCKED。不以 skip 冒充通过。

## 影响范围

- 不改客户端、企业管理、总台、引擎或平台 API 的业务代码
- 不涉及数据库迁移
- 每个指向 `main` 的 pull request 都会真实跑六项门禁（负载高于原先按路径跳过）

## 怎么验证的

- [ ] 本单仅改 workflow YAML；未跑业务构建
- [ ] 打开面向 main 的 PR 后，六项 checks 出现并有 run URL（见交付报告）
- [ ] 线上验证（不涉及）

## 怎么回滚

还原三份 gate 的 `on.pull_request.paths` 与 macos `PREVIEW_HOME` 写法。

## 备注

与未合并的 #68/#76 触发意图一致；本单不含 #64 wiki/pnpm 安装与测试断言改动。branch protection 本环境 403 未直读，六项名称从 #68 正文与历史 PR statusCheckRollup 推断。相关：#105、#106、#67。
