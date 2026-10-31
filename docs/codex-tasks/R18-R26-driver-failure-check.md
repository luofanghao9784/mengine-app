# 诊断驱动失败路径检查

本检查只执行抽取的诊断驱动外层错误处理，不执行数据库或测量体。保存下列代码到云端私有目录后用 python3 执行；检查进程成功退出0，三种被测路径均必须报告exit1。测试中的source是本次修正驱动完整快照，结果不表示PG通过。

```python
import ast,copy,json,tempfile,types,contextlib
from pathlib import Path
source="import os,sys,json,time,signal,secrets,subprocess\nfrom pathlib import Path\nsys.dont_write_bytecode=True\nos.umask(0o077)\nrepo=Path.cwd().resolve()\nexpected='f142c9d6b871ebedac133569fc51cb961bbd940f'\nassert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==expected\nassert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],text=True).strip()\nroot=Path(sys.argv[1]).absolute()\nassert not root.exists() and not root.is_symlink()\nassert root.parent.is_dir() and root.parent.stat().st_uid==os.getuid()\nassert root.parent.stat().st_mode & 0o077 == 0\nassert not root.resolve().is_relative_to(repo)\nassert not root.resolve().is_relative_to(Path('/home/user/mengine-preview'))\nroot.mkdir(mode=0o700)\nsys.path.insert(0,str(repo/'scripts/local'))\nimport backup,trial\ntrial.private_write(root/'database.json',{'password':secrets.token_urlsafe(32)})\nevents=[]; code=1; oldrun=subprocess.run\ndef record(phase,fn,rows=None):\n    started=time.monotonic()\n    try:\n        value=fn()\n    except BaseException as error:\n        events.append(dict(phase=phase,seconds=time.monotonic()-started,ok=False,errorType=type(error).__name__))\n        raise\n    events.append(dict(phase=phase,seconds=time.monotonic()-started,ok=True,rows=rows))\n    return value\ndef capped(*args,**kwargs):\n    kwargs['timeout']=min(kwargs.get('timeout',5),5)\n    if 'env' in kwargs:\n        kwargs['env']={**kwargs['env'],'PGOPTIONS':'-c statement_timeout=3500','PGCONNECT_TIMEOUT':'3'}\n    return oldrun(*args,**kwargs)\ndef expire(*_): raise TimeoutError('diagnostic SQL window exhausted')\noldhandler=signal.signal(signal.SIGALRM,expire)\ntry:\n    # Fresh diagnostic-only cluster; no application schema, migration history, bundles or signing keys.\n    with backup.offline_database(root,True) as (_,__,sql):\n        try:\n            subprocess.run=capped\n            signal.alarm(30)\n            record('fixture_table',lambda:sql('CREATE TABLE public.r18_cost_sample(id integer PRIMARY KEY,payload text NOT NULL,blob bytea NOT NULL)'))\n            for n in (1,128,1024):\n                record('fixture_insert_'+str(n),lambda n=n:sql(\"INSERT INTO public.r18_cost_sample SELECT i,repeat(md5(i::text),128),decode(repeat(md5((i+1)::text),128),'hex') FROM generate_series(1,\"+str(n)+\") i ON CONFLICT DO NOTHING\"),n)\n                checksum=record('copy_'+str(n),lambda:sql('COPY (SELECT to_jsonb(t)::text FROM public.r18_cost_sample t ORDER BY to_jsonb(t)::text) TO STDOUT',True),n)\n                count=int(record('count_'+str(n),lambda:sql('SELECT count(*) FROM public.r18_cost_sample'),n))\n                assert count==n and len(checksum)==64\n            # Three connection/process controls; not an empty-table facts rerun.\n            for i in range(3):\n                assert record('connection_control_'+str(i),lambda:sql('SELECT 1'))=='1'\n            code=0\n        finally:\n            signal.alarm(0)\n            subprocess.run=oldrun\n    assert not (root/'postgres/postmaster.pid').exists()\nexcept BaseException as error:\n    code=1\n    events.append({'phase':'failure','errorType':type(error).__name__})\nfinally:\n    signal.alarm(0); signal.signal(signal.SIGALRM,oldhandler)\n    subprocess.run=oldrun\n    stopped=False; clean=False; status_exit=None\n    try:\n        status=oldrun([backup.pg('pg_ctl'),'-D',str(root/'postgres'),'status'],env=trial.clean_environment(),capture_output=True,timeout=10)\n        status_exit=status.returncode\n        stopped=status_exit==3 and not (root/'postgres/postmaster.pid').exists()\n    except BaseException as error:\n        code=1\n        events.append({'phase':'final_status_failure','errorType':type(error).__name__})\n    try:\n        clean=not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],text=True).strip()\n    except BaseException as error:\n        code=1\n        events.append({'phase':'final_git_failure','errorType':type(error).__name__})\n    if not stopped or not clean: code=1\n    report={'source':expected,'exit':code,'events':events,'stopped':stopped,'statusExit':status_exit,'cleanAfter':clean,'fullRestoreVerified':False,'activationAllowed':False}\n    (root/'nonempty-evidence.json').write_text(json.dumps(report,indent=2))\nraise SystemExit(code)"
tree=ast.parse(source)
node=next(n for n in tree.body if isinstance(n,ast.Try))
# Execute actual outer handler/finalizer; replace only successful measurement body.
node=copy.deepcopy(node)
withnode=node.body[0]
withnode.body=ast.parse("code=0").body
node.body=[withnode,ast.parse("assert not (root/'postgres/postmaster.pid').exists()").body[0]]
module=ast.fix_missing_locations(ast.Module(body=[node],type_ignores=[]))
results=[]
for mode in ('context_exit','status_probe','git_probe'):
    with tempfile.TemporaryDirectory() as tmp:
        root=Path(tmp)
        class StopError(Exception): pass
        class ProbeError(Exception): pass
        @contextlib.contextmanager
        def offline(*args):
            yield (None,None,None)
            if mode=='context_exit': raise StopError()
        def run(*args,**kwargs):
            if mode=='status_probe': raise ProbeError()
            return types.SimpleNamespace(returncode=3)
        def output(*args,**kwargs):
            if mode=='git_probe': raise ProbeError()
            return ''
        signal=types.SimpleNamespace(SIGALRM=1,alarm=lambda _:None,signal=lambda *_:None)
        scope=dict(root=root,backup=types.SimpleNamespace(offline_database=offline,pg=lambda _: 'pg_ctl'),
          trial=types.SimpleNamespace(clean_environment=lambda:{}),signal=signal,
          subprocess=types.SimpleNamespace(run=run,check_output=output),
          oldrun=run,oldhandler=None,events=[],code=1,expected='fixed',json=json)
        exec(compile(module,'actual-outer-handler-and-finalizer','exec'),scope)
        report=json.loads((root/'nonempty-evidence.json').read_text())
        assert report['exit']==1
        phases=[x['phase'] for x in report['events']]
        assert ('failure' if mode=='context_exit' else 'final_status_failure' if mode=='status_probe' else 'final_git_failure') in phases
        if mode=='context_exit':
            assert report['stopped'] and report['cleanAfter']
            assert report['events'][0]['errorType']=='StopError'
        results.append(dict(case=mode,exit=report['exit'],phases=phases,reportWritten=True))
print(json.dumps(results))

```
