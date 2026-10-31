# R18/R26 首批：迁移分类与摘要成本探针

## 状态与固定来源

认领 #94，独立分支 fix/r18-r26-recovery-diagnosis-94。
源 #93 head 4415c11d7882db1968cadb5ff5d8e7a1acdd9f2d，base 1aac85b32d0186101713cee998b646734efc80b1，tree 5178fd8a2e56bce1b480ee4abe1706732872bf8e。
[准备单](https://github.com/luofanghao9784/mengine-app/pull/93#issuecomment-6539270438)。

本批没有完成恢复适配、reconcile/activate、源丢失灾备或R26可恢复卸载验收。默认拒删/未知模块拒绝激活保持。没有改变coverage.json、schema/catalog指纹、签名、密钥、鉴权、恢复身份和产品入口。没有操作本地Mac、预览、生产、模型或CI，没有新增费用、合并或部署。

## 实际完成

1. 逐文件读取默认178份迁移SQL（migration134 + common44）。coverage49份文件名及其源码SHA256全部匹配。差额129 = V55–V139的85份 + common44。不是序号连续性推断。
2. [逐迁移分类表](R18-R26-migration-classification.md)和[完整JSON](R18-R26-migration-classification.json)：每项列版本/路径/Git blob、字面新增和变更表/函数/视图/触发器、恢复边界信号、现有适配模块的显式对象引用、候选处理原则。分类是盘点，非语义批准。动态DDL及传递依赖不得靠字符串匹配放行。
3. 最小代码差异仅给 backup.facts 增加可选observer；默认行为、每表COPY排序字节及SHA256、COUNT、历史核验、返回dict均保留。COPY失败/observer预算停止继续抛异常，绝不返回部分成功。restore原调用未传observer，所有门禁不动。
4. 新增4项纯单元检查实际退出0：结果与查询顺序一致；COPY失败不再COUNT且不泄露错误正文；observer中止不返回部分结果；SQL失败恰逢回调预算耗尽仍保留原SQL异常。它们是回调契约检查，不是模拟PG通过，更不是恢复验收。
5. [真实PG18有界探针](R18-R26-profile-facts.py)及[完整最小补丁](R18-R26-facts-observer.patch)已提供；Python语法和补丁应用检查已过。

## 成本证据与缺项

源码明确：facts先核验迁移和列举表，再对每个非TRANSIENT表各运行一次COPY排序摘要、一次COUNT；offline_database每次sql均启动独立psql。因此N个参与摘要的表需要2N+2次SQL调用，另有外层restore/objects/coverage开销。
准备单报告create返回297表；若该数是manifest参与摘要的N，则facts对应596次SQL调用。coverage表数组139、物理public表数量和manifest排除TRANSIENT后的表数口径不同，不能把139→297直接当成新增158表。
这证明重复启动与连接的成本来源，不证明它独占180秒。尚无逐表动态数据，不能填造慢表、行数、恢复退出码或把超时归给唯一函数。

当前会话仅挂载内置浏览器，没有授权新合成PG18命令执行目标。因此没有运行PG探针，也没有证明PG18二进制缺失。唯一缺项：由已授权云端执行端在新0700合成根目录运行下列命令并回传profile.jsonl及真实退出码；不要求老板一般确认、不切换其他电脑。

## 精确执行（不延长原restore，不跑整套）

只在现有授权云端独立副本执行，禁止 /home/user/mengine-preview/repo。不要使用现有trial/backup/key目录。将本提交完整SHA填入 --expected-head。根目录必须不存在，父目录是自己所有的0700目录、在checkout以外；不读取或复用任何现有数据库。
~~~bash
python3 docs/codex-tasks/R18-R26-profile-facts.py \
  --expected-head <本提交完整40位SHA> \
  --root <授权云端任务根目录>/r18-r26-new-synthetic \
  --max-tables 8 --seconds 30
~~~
用原执行端已具备的PG18工具；有需要时只设置该执行端自己的POSTGRES_BIN。不要重装环境或购买机器。命令由可保存长任务stdout/stderr/退出码的原执行器运行，不用会丢输出的短超时调用。

探针实际做：验证版本→新源cluster执行默认178迁移并建合成history→真实pg_dump→新目标cluster真实pg_restore→原facts算法前8表的逐COPY/COUNT测量。源与目标均新建、只用私有Unix socket、无TCP/应用/worker；不运行backup.restore/create/reconcile/activate，也不构造可用签名包或开放入口。它隔离的是restore内摘要阶段的成本，不代表完整签名恢复路径通过。
逐SQL诊断statement_timeout为3.5s、子进程timeout5s，最多8张表；30秒软预算在SQL边界停止，可能超出最多一个受限SQL操作及停止开销。迁移/dump/restore仍用既有offline_database单操作120秒上限，未上调；启动/停库沿用原安全行为。任一阶段失败保留失败阶段和错误类型，不能增加预算重复全套来掩盖。
profile.jsonl为0600，只含阶段、表名、秒数、COUNT行数、ok/errorType；不含SQL行、材料正文、口令、密钥或实际摘要。sql-private-errors.log仅合成数据且0600，不直接贴聊天。源/目标目录保留用于核查，不自行删除。
partial sample的fullIntegrityVerified永远false。SampleComplete仅表示诊断预算到达，不是数据完整性成功。退出0仅代表样本命令正常完成。退出后还须验证source/target的postmaster.pid均不存在，不能用源码假定stop成功。

真实输出回传：执行SHA/树/干净状态、命令argv、每阶段退出和耗时、每表COPY/COUNT秒数与rows、慢表top（仅已测样本）、被预算截断的下一步、源/目标身份分离与停止证据。不要输出凭据。
- COPY与COUNT都在空表上慢：优先核对进程/连接成本，可再取同样小样本与持久连接进行等价性设计评审；本批不改连接模型。
- COPY慢而COUNT快：对已测表做有界EXPLAIN/排序成本诊断；不得移除排序或更换摘要规范。
- pg_restore慢：先核对导入阶段，不把总超时归给facts。
- samples快但总facts慢：结合2N调用数估算仅作假说；追加选择少量未测表，不跑整套或放宽上限。
- 未进入facts或SQL失败：保留原退出码，先修该最早阶段；不得称恢复通过。

纯单元验收：
~~~bash
python3 -m unittest discover -s tests/local -p backup_facts_diagnostics_test.py -v
~~~
这条命令不启动PostgreSQL，不调用真实模型；不能替代上面真实probe。

## 后续模块顺序及独立审查边界

所有129项在完成对应正负测试前维持BLOCKED。已有适配的部分也需要与新增结构逐项复核。
0. **全程执行封闭合同先行且持续有效**：在所有模块适配期间，全部worker/调度/重试/外部调用入口都保持关闭，不能等第五步才封闭；任何未知模块继续拒绝激活。
1. 认证/租户/密钥边界：V55–57、V103–108、V135、V190–193。所有realm旧session/CSRF/邀请/验证码/grant失效；账户、租户、能力开通仅按当前外部权威裁剪；外部独立签名密钥不可从bundle复原为信任根。先审V190第四端会话及V193企业能力源，不能仅新增几条DELETE后放行整库。
2. 授权/删除与材料闭包：library/受众/归档/撤权、材料版本/原件/知识及远程索引；当前PURGED/撤回、blob删除证据必须优先，未知对象整次激活拒绝。
3. 经验祖先、派生正文与场景来源：逐版本裁剪原始和传递来源，不因快照旧状态恢复已停用祖先。
4. 原生会话/附件/插件/技能/路由：token/grant吊销；外部执行/检索/路由凭据不从旧配置自动启用。
5. 所有后台执行端口：collection、governance、company、briefing、native schedules及重试/回执。RUNNING按副作用不确定处理，不把旧READY/QUEUED/receipt当作重放授权；明确所有可执行状态封闭及租约失效。
6. 最后才审精确schema/catalog/JAR组合与coverage收录；不运行backup_coverage.py录指纹来绕过前五步。显式activate须再次取当前权威并通过独立审查/正负矩阵。

本首批只讨论“原权威源保留”的恢复。保留必须是独立可验证、足够新鲜且可取得当前撤权/删除事实的权威源，不能仅凭目录存在。源已丢失时无法用恢复副本给自己授权，现路径保持拒绝；灾备独立授权/审计/密钥托管另立边界，不自动进入本补丁。
安全审查重点仅认证realm、租户/能力、外部密钥/源身份及执行端口；架构审查此次诊断patch无门禁弱化、129分类依赖顺序和后续最小模块边界。都不代写整套业务恢复、不Approve自己的实现。

## 非作者审查后的诊断修正

架构发现失败事件回调可能在预算同时耗尽时抛出SampleComplete覆盖SQL异常。已双重修正：facts失败路径中的observer异常不替代原SQL异常；探针收到ok=false只记录而不触发正常预算结束。补针对性纯单元检查，保留错误且不再COUNT。此修正没有PG18实测，不把退出0当恢复通过。

安全审查明确：第四端agent_platform_sessions/独立凭据、V193当前企业能力关系、V171 grants/V183 ACTIVE/READY运行封闭均仍未适配；不能靠现有撤权触发器或仅停止conversation_tasks替代。全部继续被coverage拒绝，未出现已证实的激活越权。源丢失/源不可验证/当前证据不足仍拒绝。本次静态审查没有逐项完成178 SQL的恢复语义认证。
