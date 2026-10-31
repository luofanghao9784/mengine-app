# R18/R26：三档非空单表与连接对照的实际PG18证据

本轮质量性能一次真实执行，非旧空表/单元检查复用。执行文档固定`57ed2b47659c627eb8358d2ebed9d0bd1dbeac86`，tree `c8275d238739b3d168eb17429b4264bd4bcce5c9`；源码固定`f142c9d6b871ebedac133569fc51cb961bbd940f`，tree `c30bfa8a7779b71cee3cd8516c04acfbd63fa941`。两份固定文档已实读、Git blob及源码SHA256在JSON。提取的nonempty.py代码SHA256为`9527776e34f6a0007b1605c4bb99cf79ab46d3b8561dae6f486ab1a371531665`，与执行单代码块原字节一致；与driver-failure-check内嵌快照去除首尾空白后相同，AST也相同。只编译/核对快照，没有把模拟失败检查当作本轮PG结果。

## 命令、环境、预算

在源码固定的独立干净worktree根目录执行：

```bash
PYTHONDONTWRITEBYTECODE=1 python3 <本轮0700私有父目录>/nonempty.py <同目录>/sample-new
```

nonempty.py完整源码来自[固定执行单](https://github.com/luofanghao9784/mengine-app/blob/57ed2b47659c627eb8358d2ebed9d0bd1dbeac86/docs/codex-tasks/R18-R26-timeout-next-step.md)。实际完整argv/cwd、已执行透明计时wrapper源码/hash、逐子进程返回码在同目录JSON；wrapper只观察subprocess.run耗时，不改原参数/返回值/异常，运行的提取代码未变。

使用原授权云端已有PostgreSQL18.6，沿用POSTGRES_BIN及该发行包LD_LIBRARY_PATH，没有换电脑、安装新环境或购买机器。新私有父目录/样本根均0700，提取代码/结果/数据库秘密文件均0600。没有读取或复用前次源库/目标库，也未运行迁移、dump、restore、8空表、CT076或CI。

测量窗口保持SIGALRM 30秒，SQL子进程5秒、statement_timeout3500ms、connect_timeout3秒。13个窗口内SQL子进程均实际验证这些限制，全部退出0。initdb/start/stop保持原120秒，最终status探针10秒；未加预算、强杀或改业务代码。没有发生失败或超时，所以没有重试。

## 实际结果

驱动和外层均退出 **0**；全程 **1.436773秒**，record阶段累计 **0.375490秒**（累计不等于精确窗口墙钟，且不含启动/停库）。只建一张无业务schema的r18_cost_sample，累计插入1/128/1024行；每行4096字符text、2048字节bytea。每档均核对真实COUNT等于档位及SHA256返回长度64；未输出行、凭据或摘要值。

| 行数 | fixture INSERT ms | COPY排序/传输/私有文件哈希 ms | COUNT ms | 三项子进程退出码 |
|---|---:|---:|---:|---:|
| 1 | 19.459 | 32.787 | 18.911 | 0 |
| 128 | 23.135 | 33.934 | 17.542 | 0 |
| 1024 | 53.124 | 75.622 | 19.067 | 0 |

建表 24.335ms，子进程0。三次SELECT 1连接/进程对照：**20.473ms, 18.286ms, 18.815ms**，均返回预期值、子进程0。它们不是空表facts重跑。

启动/停库实际子进程：

| 操作 | 秒 | 退出码 |
|---|---:|---:|
| initdb  | 0.615615 | 0 |
| pg_ctl  | 0.001144 | 0 |
| pg_ctl start | 0.114138 | 0 |
| pg_ctl stop | 0.114044 | 0 |
| pg_ctl status | 0.001423 | 3 |

## 清理与状态

原offline_database上下文正常退出；最终postmaster.pid不存在、pg_ctl status退出3，driver报告stopped=true。读取本轮postgres的postmaster.opts确认TCP关闭、私有Unix socket临时目录已移除。最终工作树干净，提取代码未变，结果证据存在。合成数据目录和证据保留，不删除原件或运行目录；本轮没有接管其他库或强杀进程。

## 结论边界

这一个合成表中，1024行COPY端到端时间高于1/128行，COUNT与三次连接对照相对稳定，支持本样本中数据量处理成本可观测。单档各一次，不代表统计稳定性或真实表分布；时间包含进程、连接、JSON生成/排序、传输、文件和哈希等，不能分离各自占比。COPY的私有文件等待路径与COUNT/SELECT1也不同，不能简单相减为服务端排序成本。

旧180秒预算覆盖整个测试类，不是restore独占180秒。原日志/manifest/原环境仍缺，本样本不能证明旧根因、真实慢表、完整恢复或R18/R26完成；fullRestoreVerified=false、activationAllowed=false。没有扩大coverage、激活或删除权限，没有合并/部署/本地Mac写入。下一步只有原现场日志/manifest到达后，按实际表及规模选一个真实schema合成代表，不无依据重跑297表或放宽时限。
