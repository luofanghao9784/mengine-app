# CT-088：预览脚本 Bash 3.2 标点变量边界修复

认领：https://github.com/luofanghao9784/mengine-app/issues/88 。固定基线为 #87 head `438a5be07af499cbed3b829a2db4f9cd022a95ad`，其base `b10900dfb3942323c9587b976a5b9cd51f4e7188`。本单替代当前不可读取的原本地执行单；不是声称恢复了其原文。

## 范围与执行

在独立云端克隆、任务分支 fix/preview-bash32-punctuation-88 执行，不接触现有云预览或用户本地Mac。普通文件编辑已实际完成，只将 stop14 的 `$INSTANCE）` 改为 `${INSTANCE}）`、start6 的 `$a（` 改为 `${a}（`、health11 的 `$c（` 改为 `${c}（`。保留原双引号、文案、set -euo pipefail、参数/权限/进程/残留检查与卸载路径；不加默认值，不改变控制流。新增本文档。

原Codex CLI 0.166.0已登录ChatGPT，但workspace-write命令启动前出现 `bwrap: Failed to make / slave: Operation not permitted`；该故障只阻该子进程，不代表普通文件/Git不可用。本轮使用已授权普通文件能力，不调整沙箱、不借审核身份提交。

## 已执行证据

真实GNU Bash 3.2.57(1)-release (x86_64-pc-linux-musl)来自Docker Official library/bash:3.2.57，仅提取本地可执行文件和所需库，不运行容器或服务。manifest sha256:1b5d0c83f6f3c7206c16af8f9f4ca08e3eba893c50a80a0ce8b23e7a865136af，manifest及层hash均核验。

对三个旧/新变量展开运行 `set -eu` 最小字符串探针：6次均退出0。原值synthetic逐字保留，分别输出synthetic）或synthetic（。这是Linux未复现，绝非修复前失败/后通过。musl与macOS构建及locale不同，不能据此声称原mac根因已证实。

对三个改后脚本分别执行真实旧Bash `-n` 和宿主Bash5.2.15 `-n`：6次均退出0，stdout/stderr为空。`git diff --check`退出0。未运行预览/数据库/安装卸载，未重跑业务测试。

## 非作者架构意见及边界

架构专家664a184e-9993-4fef-a57a-f73d9af124c3已独立只读固定基线start/stop/health/common：支持这三处大括号为语义保持的最小兼容修复，未发现方案P0阻塞。locale/系统补丁/字符分类仍是假设，Linux同版本不能替代macOS。stop的 A && die || log 中die执行exit1，故不在本补丁改写控制流。此为方案审查，不是固定新commit正式Approve或macOS验收。

## 发布及一次远程macOS复验

核验开发连接确为luofanghao9784；禁止使用1203审核身份。分支叠加#87，Draft PR只含三行替换和本文档，固定远端head/tree与本地暂存tree一致后再运行一次现有macos-preview-smoke workflow。不得重跑旧成功版本，不合main、不部署。未取得dispatch接口不得声称已触发。

远程CI（不是用户本地Mac）记录实际checkout SHA、BASH_VERSION、有效LANG/LC_ALL/LC_CTYPE。若现有workflow未输出locale，明确证据缺失，不冒称已记录；需要经DQ批准的最小日志补充或现有受控命令入口。用原字节旧/新探针区分是否在该环境复现；检查doctor/install/幂等/start/health/stop/uninstall含备份及残留检查各自结果。还应区分start禁止参数分支和health错误码分支是否实际覆盖，主链绿不能证明未走分支。保存原始日志和exit；取消/排队/失败均如实记录，不能用模型结束代表CI结束。

已知原macOS run41163854975由DQ报告Bash3.2.57、start/health通过，stop INSTANCE� unbound variable且uninstall同错；本轮未重取其完整日志，不把转述当新实跑。修复后新mac运行仍待执行。
