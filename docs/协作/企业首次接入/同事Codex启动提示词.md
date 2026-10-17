# 同事 Codex 启动提示词

将下面整段发送给同事的 Codex；替换方括号中的身份与任务。如尚未选任务，保留“先列出可认领任务”。这不是邀请、账号授权或自动部署指令。

```text
你正在参与梦擎企业 AI 工作空间的节点协作开发。
仓库：https://github.com/dimmm1125-coder/dreamcore-workspace.git
我的协作署名：[填写真实姓名或稳定代号]
本次任务：[填写 ONB-xx-xx-FE / BE；未定则先列出可认领任务，不自行认领全部任务]

请先完成启动核查：
1. 使用本机项目的独立克隆。先读根目录 AGENTS.md、COLLABORATION.md，检查 git status、当前分支与远端。不使用另一位开发者的共享工作目录。
2. git fetch origin main。工作区干净且能够快进时执行 git pull --ff-only origin main；否则说明差异并安全处理，不 reset、不丢弃修改、不强推。
3. 阅读 docs/协作/企业首次接入/README.md 和 双方Codex协作约定.md，再读 flow.json 及目标 handoffs/ONB-xx-xx.md。初始任务是核查／候选调整，不是全部已批准开发。先读 docs/交接/代码基线整合与迁移兼容-2026-10-17.md，记录 git rev-parse HEAD。使用包含该整合记录的最新 origin/main；新库走默认迁移，旧本地库核对历史后才启用 migration-local。V150 起的新迁移只放 migration-common，认领时登记版本号。统一开发基线不代表线上版本已经更新。
4. 运行：
   python3 docs/协作/企业首次接入/build.py --check
   python3 -m http.server 5197 --bind 127.0.0.1 --directory docs/协作/企业首次接入
   浏览器打开 http://127.0.0.1:5197/ 。端口被占用先确认服务，不要误停；必要时用另一个空闲端口。节点右栏点击“查看开发详情”可查看任务和 handoff 链接。

认领和执行：
- 查看远端最新 owner、状态、依赖与共享文件范围；不抢占他人任务。
- 在对应 handoff 的唯一 JSON 块中填写任务 owner、节点协调人（如适用）、updatedBy、带时区 updatedAt 和真实状态，在正文补本次基线、拟改文件及接口约定。不要改 nodeId 或已有 task id。
- 先构建看板，将认领 handoff 与生成 index.html 按明确路径提交并推送；本提示词授权提交和推送本人该任务的认领记录及已授权范围的实现与交接，不授权生产部署。认领推送成功后才开始业务开发。冲突时先读对方记录并协调，不强推或覆盖认领。
- 先验证当前能力。无缺口标“不需开发”并填写 evidence；需要新增业务规则、权限或尚未确认方案时停在“待确认”，说明具体缺口和建议，不把候选直接当作已确认功能。
- 已授权任务持续完成实现、必要验证和交接；不要修改不相关代码，不夹带他人未提交文件。

维护开发状态：
- handoff 是状态唯一来源。更新 JSON 的任务状态、依赖、证据和独立的实现／验证／部署状态；正文写清已做、代码位置、命令与结果、剩余问题和下一步，并追加时间与更新人记录。
- 运行 build.py，再运行 build.py --check；不要直接编辑 index.html。
- 如需改流程内容，编辑 flow.json，涉及含义变化增加 revision 并追加 CHANGELOG.md；不把开发进度写进流程变更记录。
- Git 合并时先解决 flow.json、template.html 与 handoff，再重新生成 index.html。推送被拒绝先 fetch 检查，不 force。
- 交付汇报节点与任务 ID、验证、提交号、推送结果和接续事项。没有部署就明确写未部署，不将工具成功冒充业务验收。

先向我简要报告拉取结果、看板能否打开、目标任务是否可认领和是否存在共享文件冲突，然后按上述授权继续。不要主动联系另一位开发者或另一个 Codex 会话。
```
