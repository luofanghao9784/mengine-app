# R18/R26：固定f142c9d的真实PG18有界执行证据

质量性能本轮实际执行，非历史单元结果。被测head `f142c9d6b871ebedac133569fc51cb961bbd940f`，parent `d34525c31d0a90c7429d626963153b53d6b5b214`，tree `c30bfa8a7779b71cee3cd8516c04acfbd63fa941`；独立worktree执行前后干净。实际核对该提交交接文档、完整observer补丁和探针源码。原4项纯单测本轮未重跑，也未用来充当PG证据。

## 实际命令与范围

被测入口argv（在固定源码仓库根目录的等价相对路径形式）：

```bash
python3 docs/codex-tasks/R18-R26-profile-facts.py \
  --expected-head f142c9d6b871ebedac133569fc51cb961bbd940f \
  --root /data/.openmausbot/task-workspaces/5d214d51-f70a-4414-a47a-2875fe562364/dc3deb62-952c-4ef5-b8f2-03d18a6b87b7/r18-r26-f142-validation/owned-synthetic/sample-001 \
  --max-tables 8 --seconds 30
```

实际外层使用同目录execute-probe.py，经runpy执行以上固定入口并透明记录subprocess.run子进程耗时、退出码；原参数、返回结果与异常均转发，不修改源码。实际wrapper/entry argv、完整已执行辅助源码及SHA256均在同目录JSON。运行时使用此前授权云端已有PG18.6，设置POSTGRES_BIN和该发行包必需的LD_LIBRARY_PATH；没有安装环境或切换电脑。新父目录及源/目标0700，profile和dump/错误文件0600，不读取既有trial/backup/key目录。

## 本次真实结果

样本命令退出 **0**，总耗时 **5.627907s**。版本探针initdb/pg_ctl/psql/pg_dump/pg_restore全部成功；真实默认178份迁移、dump和导入均执行。

| 阶段 | 秒 | 结果 |
|---|---:|---|
| migrations | 1.017167 | 子进程0 |
| pg_dump | 0.265107 | 子进程0 |
| pg_restore | 1.122226 | 子进程0 |
| facts migration_history | 0.036779 | 成功 |
| facts table_list | 0.032153 | 成功 |
| bounded_sample_end | 0.585939 | 8表上限触发，非自然30秒耗尽 |

启动/停库子进程实际记录：

| 库 | 操作 | 秒 | 退出码 |
|---|---|---:|---:|
| synthetic-source | initdb  | 0.615309 | 0 |
| synthetic-source | pg_ctl start | 0.114264 | 0 |
| synthetic-source | pg_ctl stop | 0.214518 | 0 |
| synthetic-restored | initdb  | 0.966406 | 0 |
| synthetic-restored | pg_ctl start | 0.114144 | 0 |
| synthetic-restored | pg_ctl stop | 0.214365 | 0 |

逐表样本（全部rows=0，因此不能代表真实资料排序/传输成本）：

| 表 | COPY秒 | COUNT秒 | rows |
|---|---:|---:|---:|
| accounts | 0.032268 | 0.032193 | 0 |
| adjustment_task_dependencies | 0.032233 | 0.032202 | 0 |
| agent_attempt_usage | 0.032326 | 0.032320 | 0 |
| agent_model_requests | 0.032356 | 0.032304 | 0 |
| agent_platform_accounts | 0.032195 | 0.032043 | 0 |
| agent_platform_sessions | 0.032239 | 0.032196 | 0 |
| analysis_computation_receipts | 0.032252 | 0.032109 | 0 |
| analysis_material_observations | 0.032240 | 0.032231 | 0 |

最慢已测COPY为agent_model_requests，0.032356s；最慢已测COUNT为agent_attempt_usage，0.032320s。差异很小，不构成业务慢表排行。下一项未测操作为 `table_copy(analysis_material_versions)`。

本次合成目标库按facts排除TRANSIENT后的参与表数N=297；完整facts理论需2N+2=596次SQL调用，本轮没有执行完整facts。每次样本的客户端时间包含psql进程启动、连接、SQL、结果传输/哈希以及Python带timeout等待的开销，不能当作服务端SQL执行时间，也不能从约32ms的空表样本直接证明180秒总耗时的根因。

## 预算语义及真实SQL失败传播

正常样本在第8张表COUNT后由SampleComplete结束，profile明确 `fullIntegrityVerified=false`、`activationAllowed=false`。退出0仅表示样本命令正常结束。真实pg_dump/pg_restore子步骤通过，不等于backup.restore完整签名/覆盖/适配/权威源路径通过。

另在本轮新建并已停库的synthetic-restored上短暂重启，仅做两个有界真实SQL负向检查，不重复迁移/dump/restore：

1. 提取该固定探针**原样observe函数体**，在真实COPY错误前受控设置其profile_started为31秒前；这是时钟/预算状态注入，不是自然等待超时。PG真实返回SQLSTATE42703、psql退出1，observer记录ok=false后不转为正常SampleComplete；facts抛出的对象与原CalledProcessError是同一对象。
2. 同样的真实PG错误，诊断observer另抛ObserverBudgetStop；facts仍保留原CalledProcessError对象。两项均只有一次COPY尝试，COUNT次数0，不返回部分facts、不记正常预算完成。验证驱动最终退出0，只代表这两个拒绝/传播期望通过，绝不把SQL子进程1当作SQL成功。

负向驱动首轮错误地要求psql -c退出码必须为3，断言退出1，原记录保留。修正驱动期望为“非零且SQLSTATE42703”后做上述两项检查；被测f142c9d源码未改。首次驱动断言失误不是产品失败，也没有用重复恢复或加预算掩盖。错误正文仅存0600私有日志，不在这里公开。

## 最终清理与身份

源/目标system identifier分别为 `7702695679450386645` / `7702695689955213564`，不同；二者均只启用私有Unix socket、TCP关闭。正常探针两个pg_ctl stop均退出0。SQL负向检查结束后再次实际核验：两个postmaster.pid均不存在、pg_ctl status均退出3且报告no server running、私有socket临时目录均已移除。数据库数据目录及dump按交接要求保留，不自行删除；这里的清理结论是停库与临时socket清理，不是删除持久证据目录。

## 结论边界

本轮补齐固定版本真实PG18有界成本样本、真实SQL错误传播及停库证据。没有扩大coverage、恢复/激活或删除权限，没有运行应用/worker、签名包或真实模型。R18完整恢复适配、权威源丢失灾备、reconcile/activate及R26可恢复卸载验收仍未完成。CT076已绿矩阵没有重跑；没有合并、部署、费用购买或本地Mac写入。
