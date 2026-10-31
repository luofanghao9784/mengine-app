# R18/R26：原180秒超时证据与最小下一步（待DQ审后执行）

本提交仅诊断执行文档，未执行下列PG命令，不改变任何业务实现。沿用认领#94。执行端仅原授权云端PG18；禁止本地Mac、预览、生产、新费用、CI重跑、coverage放行、激活或删除源。

## 原现场证据及缺失

已直接读取[#93原执行摘要](https://github.com/luofanghao9784/mengine-app/pull/93#issuecomment-6539228018)、[准备单](https://github.com/luofanghao9784/mengine-app/pull/93#issuecomment-6539270438)，以及固定源码 tests/local/backup_migrations_test.py 与 scripts/local/backup.py。
源码内容绑定4415c11d7882db1968cadb5ff5d8e7a1acdd9f2d/tree5178fd8a2e56bce1b480ee4abe1706732872bf8e；当时本地HEAD元数据仍为1aac85b32d0186101713cee998b646734efc80b1。不能称为checkout4415的运行。

评论报告：178真实迁移/history、新枚举核验、create、verify已返回，restore在backup.py:375的facts调用内收到TimeoutError；Ran1 in181.802s/errors1，驱动exit1/181.882s。coverage未到，不算恢复负例通过。原完整traceback尚未取回，以上均是可定位评论摘要，未独立复核原日志实体。

运维本轮查阅已有记录返回的wrapper关键顺序：
```python
start=time.monotonic()
signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError('Synthetic check exceeded 180s')))
signal.alarm(180)
result=unittest.TextTestRunner(verbosity=2).run(
    unittest.defaultTestLoader.loadTestsFromTestCase(backup_migrations_test.ActualMigrationBackupTest))
signal.alarm(0)
```
这是等价展示而非原实体复刻。原shell记录先source ./toolchain-env.sh，然后RUN_BACKUP_DB_TESTS=1 PYTHONPATH=preview-bash32-fix/tests/local python3 -u -，stdout/stderr合并写 preview-bash32-evidence/migration-db-v2.log；结果写同目录migration-db-v2.result.json。180秒覆盖整个测试类，含初始化、178迁移、create全表摘要、dump、verify和restore，**不是restore单独用了180秒**。不重跑此整项。

查找结果：读取#93所有5条评论及固定tree，未找到原日志实体链接；自身历史搜索restore 180、180s、181.802未命中；运维报告其当前目录为空、所列任务目录下一层无该证据目录。不能据此称文件已删除。仍缺原绝对cwd、toolchain-env.sh的脱敏环境/当轮独立PG版本、完整日志及wrapper原实体、阶段时间戳、最后完成/在途SQL表名、manifest行数/非空表/字节规模。运维此前PG18.6工具链记录不足以证明当轮版本。

## 固定调用链与新证据边界

原测试先建默认谱系，再create(source,bundle,key)、verify、restore；restore先verify/拷贝/hash、initdb、pg_restore，之后facts，再coverage/对象/旧会话/quarantine。facts先历史核验、列public表，再逐表COPY JSON排序字节摘要与COUNT。每次SQL独立psql；COPY还含传输、临时文件及Python SHA256。因此N张参与表需2N+2次SQL。create也执行完整facts，不能只计算restore费用。

已读质量[dafe2362文档](https://github.com/luofanghao9784/mengine-app/blob/dafe2362fdb3c97cd719bd18902a3934a0267e9e/docs/codex-tasks/R18-R26-PG18-execution.md)及同版本JSON：受测f142c9d6b871ebedac133569fc51cb961bbd940f；迁移1.017167s、dump0.265107s、pg_restore1.122226s；8张空表截止0.585939s，总5.627907s/exit0。该新合成目标N=297，完整facts理论596次调用；它不是原现场manifest规模证据。新样本每COPY/COUNT约32ms是客户端总时间，不是服务端SQL时间，不能线性外推并宣布旧180秒根因。其下一未测操作analysis_material_versions也不能标成旧现场卡住表。

已证实：旧整体预算耗尽时处在restore摘要路径（摘要级证据）；新版本窄空表/错误传播可正常运行。待验证假设：多次客户端启动/连接的累计成本、非空JSON排序/bytea膨胀/传输哈希、原运行端资源或清理成本。尚无证据判定锁等待、具体慢表、PG故障或算法缺陷。

## 下一最小执行：一个非空合成表，三档数据量

先选原路径的COPY排序+COUNT+私有文件哈希，不再跑178迁移、dump、restore或已绿八空表。新单表无业务schema、无伪造flyway history；此样本只验证成本机制，不是产品恢复。1/128/1024行，每行4096字符text和2048字节bytea，最大原始payload约6MiB；公开输出仅档位、耗时、行数、错误类型，不输出行、口令、摘要值。表结构不代表真实表宽。

DQ审后质量执行：在已有独立干净checkout f142c9d下；把本节唯一python代码块保存到checkout外0700私有父目录的nonempty.py，0600。无需安装新工具，沿用已经验证的POSTGRES_BIN与所需库路径；不得打印环境。以下OUT_PARENT必须是执行者自有云端新0700目录，禁止填已有实例或预览。DOC_SHA为DQ收到的本执行单完整提交SHA，不用移动分支替代。

```bash
# 原授权云端独立checkout根目录；DOC_SHA和OUT_PARENT由执行岗设置完整值
test "$(git rev-parse HEAD)" = f142c9d6b871ebedac133569fc51cb961bbd940f || exit 1
test -z "$(git status --porcelain --untracked-files=all)" || exit 1
git show "${DOC_SHA}:docs/codex-tasks/R18-R26-timeout-next-step.md" > "${OUT_PARENT}/execution-plan.md"
python3 - "${OUT_PARENT}" <<'EXTRACT'
from pathlib import Path
import sys
p=Path(sys.argv[1])
text=(p/'execution-plan.md').read_text()
code=text.split('```python\n')[-1].split('\n```')[0]
compile(code,'nonempty.py','exec')
f=p/'nonempty.py'
assert not f.exists()
f.write_text(code);f.chmod(0o600)
EXTRACT
PYTHONDONTWRITEBYTECODE=1 python3 "${OUT_PARENT}/nonempty.py" "${OUT_PARENT}/sample-new"
# 立即记录上一命令退出码；不要以最后一条git命令覆盖它
```

预算：SQL测量窗口整体30秒；每子进程至多5秒，PG statement_timeout3500ms、connect3秒；超时异常必须失败，不把部分数据算通过。initdb/start/stop沿用原单操作120秒上限，30秒不代表整命令时限；不改变原180预算、不自动重复。退出0只表示三档严格行数、哈希形状、停库和干净状态满足；exit1包括SQL/超时/断言/清理失败。准备条件不满足也失败，不创建恢复凭据或产品入口。

```python
import os,sys,json,time,signal,secrets,subprocess
from pathlib import Path
sys.dont_write_bytecode=True
os.umask(0o077)
repo=Path.cwd().resolve()
expected='f142c9d6b871ebedac133569fc51cb961bbd940f'
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==expected
assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],text=True).strip()
root=Path(sys.argv[1]).absolute()
assert not root.exists() and not root.is_symlink()
assert root.parent.is_dir() and root.parent.stat().st_uid==os.getuid()
assert root.parent.stat().st_mode & 0o077 == 0
assert not root.resolve().is_relative_to(repo)
assert not root.resolve().is_relative_to(Path('/home/user/mengine-preview'))
root.mkdir(mode=0o700)
sys.path.insert(0,str(repo/'scripts/local'))
import backup,trial
trial.private_write(root/'database.json',{'password':secrets.token_urlsafe(32)})
events=[]; code=1; oldrun=subprocess.run
def record(phase,fn,rows=None):
    started=time.monotonic()
    try:
        value=fn()
    except BaseException as error:
        events.append(dict(phase=phase,seconds=time.monotonic()-started,ok=False,errorType=type(error).__name__))
        raise
    events.append(dict(phase=phase,seconds=time.monotonic()-started,ok=True,rows=rows))
    return value
def capped(*args,**kwargs):
    kwargs['timeout']=min(kwargs.get('timeout',5),5)
    if 'env' in kwargs:
        kwargs['env']={**kwargs['env'],'PGOPTIONS':'-c statement_timeout=3500','PGCONNECT_TIMEOUT':'3'}
    return oldrun(*args,**kwargs)
def expire(*_): raise TimeoutError('diagnostic SQL window exhausted')
oldhandler=signal.signal(signal.SIGALRM,expire)
try:
    # Fresh diagnostic-only cluster; no application schema, migration history, bundles or signing keys.
    with backup.offline_database(root,True) as (_,__,sql):
        try:
            subprocess.run=capped
            signal.alarm(30)
            record('fixture_table',lambda:sql('CREATE TABLE public.r18_cost_sample(id integer PRIMARY KEY,payload text NOT NULL,blob bytea NOT NULL)'))
            for n in (1,128,1024):
                record('fixture_insert_'+str(n),lambda n=n:sql("INSERT INTO public.r18_cost_sample SELECT i,repeat(md5(i::text),128),decode(repeat(md5((i+1)::text),128),'hex') FROM generate_series(1,"+str(n)+") i ON CONFLICT DO NOTHING"),n)
                checksum=record('copy_'+str(n),lambda:sql('COPY (SELECT to_jsonb(t)::text FROM public.r18_cost_sample t ORDER BY to_jsonb(t)::text) TO STDOUT',True),n)
                count=int(record('count_'+str(n),lambda:sql('SELECT count(*) FROM public.r18_cost_sample'),n))
                assert count==n and len(checksum)==64
            # Three connection/process controls; not an empty-table facts rerun.
            for i in range(3):
                assert record('connection_control_'+str(i),lambda:sql('SELECT 1'))=='1'
            code=0
        finally:
            signal.alarm(0)
            subprocess.run=oldrun
    assert not (root/'postgres/postmaster.pid').exists()
except BaseException as error:
    code=1
    events.append({'phase':'failure','errorType':type(error).__name__})
finally:
    signal.alarm(0); signal.signal(signal.SIGALRM,oldhandler)
    subprocess.run=oldrun
    stopped=False; clean=False; status_exit=None
    try:
        status=oldrun([backup.pg('pg_ctl'),'-D',str(root/'postgres'),'status'],env=trial.clean_environment(),capture_output=True,timeout=10)
        status_exit=status.returncode
        stopped=status_exit==3 and not (root/'postgres/postmaster.pid').exists()
    except BaseException as error:
        code=1
        events.append({'phase':'final_status_failure','errorType':type(error).__name__})
    try:
        clean=not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],text=True).strip()
    except BaseException as error:
        code=1
        events.append({'phase':'final_git_failure','errorType':type(error).__name__})
    if not stopped or not clean: code=1
    report={'source':expected,'exit':code,'events':events,'stopped':stopped,'statusExit':status_exit,'cleanAfter':clean,'fullRestoreVerified':False,'activationAllowed':False}
    (root/'nonempty-evidence.json').write_text(json.dumps(report,indent=2))
raise SystemExit(code)
```

清理：finally恢复原subprocess与alarm，原offline_database退出负责停库/清socket；必须同时postmaster.pid不存在、pg_ctl status3。保留新合成目录和0600证据，不能删源或强删运行目录；停库失败立即阻断并报DQ，不自行kill或重跑。最终记录完整命令argv、源码SHA/干净状态、PG版本、所有phase秒数与exit；不用聊天输出数据库/环境秘密。

判定：三档COPY随数据量上升且COUNT/连接控制稳定，才支持数据处理成本假设；COPY/COUNT与SELECT1均慢则先定位客户端/环境，不能宣布SQL排序根因；任一失败保留最后phase并停止，不加预算。全部很快只排除这一小剂量样本，不排除真实宽表或原整体多阶段累计。下一步只在原日志/manifest取回后，按实际最后表及数据量选择一个真实schema的合成代表表；不得无依据重跑297表。旧原始日志缺失仍单独保留，不能用本样本补造原现场。

## 本次驱动失败检查

仅执行Python模拟，不启动PG。检查从本执行单提取实际外层try/except/finally的AST，仅将测量体替换为成功code=0，注入上下文/状态/git失败；不复制另一个最终处理实现。三项检查进程整体exit0，表示拒绝期望通过：context_exit输出exit1/failure且stopped=true、cleanAfter=true；status_probe输出exit1/final_status_failure且报告存在；git_probe输出exit1/final_git_failure且报告存在。均未产生PG或完整恢复通过证据。完整复现检查见同目录R18-R26-driver-failure-check.md。
