# 首发技能上游准备目录

这是开发准备资料，不是引擎当前可执行目录。五项来源锁定于 `sources.lock.json`，首批只保存 PPT 与 Web 的原始包及许可，其他三项仅登记固定源码信息。所有条目的 `runtimeEnabled` 必须为 false。

- `upstream/pptx-generator/`：MiniMax 原始 Skill、引用文档及仓库许可/致谢，按上游路径保留。
- `upstream/web-dashboard/`：Anthropic 原始 web-artifacts-builder 全目录，包含原始压缩素材及脚本；本轮未执行。
- 三个 candidate 不随此目录拷贝上游内容。个人空间整理的目录许可仍待核实。

在仓库根运行 `node scripts/skills/verify-sources.mjs` 校验 14 份本地源文件的长度和 SHA256。校验器不联网、不执行脚本，也不批准运行这些包。修改上游文件会失败；产品适配应另建受控适配目录，保留原包及修改记录。

上游锁定仅覆盖 Skill 源码，不等于其 npm/Python 依赖已经锁定。运行依赖、中文字体、渲染器、代码隔离、预算及成果上传在任务书 S1 中实现。不得直接执行原 init/install 脚本成为生产启动方式。

任务书：[技能中心与会话调用](../../docs/技术/技能中心与会话调用-开发任务书-V0.1.md)。

PPT 运行适配版已另建于 `engine/catalog/pptx-generator/`，使用受控 render_presentation 配方。此处原包继续保持 runtimeEnabled=false，来源锁验证不替代适配包的运行能力门槛。实施与限制见 [PPT 交接](../../docs/交接/PPT固定渲染与成果生成-2026-10-12.md)。
