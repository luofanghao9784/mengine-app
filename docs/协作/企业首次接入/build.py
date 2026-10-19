#!/usr/bin/env python3
"""从流程与独立 handoff 生成无外部依赖的只读看板。"""
import argparse,json,re
from pathlib import Path
root=Path(__file__).resolve().parent
parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
flow=json.loads((root/'flow.json').read_text()); development={}; task_ids=set();nodes=set()
statuses={'待核查','待确认','待开发','开发中','待验证','阻塞','已完成','不需开发'}
for stage in flow['stages']:
    for node in flow['walkthroughs'][stage['id']]['steps']:
        nid=node['nodeId'];assert re.fullmatch(r'ONB-\d{2}-\d{2}',nid) and nid not in nodes,nid;nodes.add(nid)
        text=(root/'handoffs'/f'{nid}.md').read_text();blocks=re.findall(r'```json\s*\n(.*?)\n```',text,re.S);assert len(blocks)==1,nid
        d=json.loads(blocks[0]);assert d['nodeId']==nid,nid
        assert 'owner' not in d,f'{nid} 只在 tasks 中登记负责人，不再设置节点级 owner'
        for field in ['updatedBy','updatedAt','implementation','validation','deployment']:
            assert isinstance(d[field],str) and d[field],(nid,field)
        from datetime import datetime
        assert datetime.fromisoformat(d['updatedAt']).tzinfo is not None,nid
        assert d['implementation'] in {'未开始','开发中','实现完成','不需开发'}
        assert d['validation'] in {'未验证','验证中','验证通过','验证失败'}
        assert d['deployment'] in {'未部署','已部署','不涉及部署'}
        assert 1<=d['flowRevision']<=flow['revision']
        assert isinstance(d['blockers'],list)
        for t in d['tasks']:
            assert t['id'] not in task_ids and t['id'].startswith(nid+'-'),t['id'];task_ids.add(t['id'])
            assert t['status'] in statuses,t['id']
            assert t.get('workstream') in {'business','system'},f"{t['id']} 必须明确归入业务对接或系统开发"
            assert isinstance(t.get('classificationReason'),str) and t['classificationReason'].strip(),f"{t['id']} 缺少分类依据"
            assert isinstance(t['dependsOn'],list) and isinstance(t['evidence'],list)
            for field in ['title','area','owner','acceptance']:assert t[field],(nid,field)
            if t['status'] in {'已完成','不需开发'}:assert t['evidence'],f"{t['id']} 必须记录完成证据或无需开发依据"
            review=t.get('implementationReview')
            if review is not None:
                assert t['workstream']=='system',f"{t['id']} 代码核查仅用于系统开发任务"
                assert review['result'] in {'代码已实现','新基线已有','部分实现','待核实'},t['id']
                assert isinstance(review['surfaces'],list) and review['surfaces'],t['id']
                assert set(review['surfaces'])<={'总台','企业端','员工端','部署工具','服务层'},t['id']
                for field in ['summary','limitations','checkedBy']:
                    assert isinstance(review[field],str) and review[field].strip(),(t['id'],field)
                assert datetime.fromisoformat(review['checkedAt']).tzinfo is not None,t['id']
                assert re.fullmatch(r'[0-9a-f]{40}',review['baseline']),t['id']
                assert Path(review['report']).name==review['report'] and (root/review['report']).is_file(),t['id']
                assert isinstance(review['sourceFiles'],list) and review['sourceFiles'],t['id']
                for source in review['sourceFiles']:
                    path=Path(source)
                    assert not path.is_absolute() and '..' not in path.parts and (root.parents[2]/path).is_file(),(t['id'],source)
                assert isinstance(review['tests'],list) and t['evidence'],t['id']
        if d['implementation']=='实现完成':assert all(t['status'] in {'已完成','不需开发'} for t in d['tasks']),nid
        development[nid]=d
assert {p.stem for p in (root/'handoffs').glob('*.md')}==nodes,'存在孤立 handoff：删除节点前明确迁移或归档方式'
for d in development.values():
    for t in d['tasks']:
        assert all(dep in task_ids and dep!=t['id'] for dep in t['dependsOn']),t['id']
graph={t['id']:t['dependsOn'] for d in development.values() for t in d['tasks']};done=set()
def visit(k,stack):
    assert k not in stack,'任务依赖存在循环'
    if k in done:return
    for dep in graph[k]:visit(dep,stack|{k})
    done.add(k)
for k in graph:visit(k,set())
def js(v):return json.dumps(v,ensure_ascii=False).replace('<','\\u003c')
s=(root/'template.html').read_text()
for token,v in [('__STAGES__',flow['stages']),('__WALKTHROUGHS__',flow['walkthroughs']),('__DEVELOPMENT__',development),('__REVISION__',flow['revision'])]:s=s.replace(token,js(v))
assert not re.search(r'__(?:STAGES|WALKTHROUGHS|DEVELOPMENT|REVISION)__',s)
s=s.replace('__DAILY_WORK__',js((root/'daily-work.html').read_text()))
assert '__DAILY_WORK__' not in s
review=json.loads((root/'daily-review.json').read_text())
assert len({row['id'] for row in review['rows']})==len(review['rows'])
for row in review['rows']:
    assert 0 <= row['phase'] <= 5
    for source in row['sources']:
        path=root.parents[2]/source['path']
        assert path.is_file() and 1 <= source['line'] <= len(path.read_text().splitlines())
s=s.replace('__DAILY_REVIEW__',js(review))
assert '__DAILY_REVIEW__' not in s
briefing=json.loads((root/'briefing-flow.json').read_text())
assert len(briefing['nodes'])==7 and len({n['id'] for n in briefing['nodes']})==7
for n in briefing['nodes']:
    assert (root.parents[2]/n['source']).is_file()
s=s.replace('__BRIEFING_FLOW__',js(briefing))
assert '__BRIEFING_FLOW__' not in s
out=root/'index.html'
if args.check:assert out.exists() and out.read_text()==s,'看板已过期，请运行 build.py 并一并提交 index.html'
else:out.write_text(s)
print(f'{len(nodes)} 个节点，{len(task_ids)} 项任务；'+('生成一致' if args.check else '已生成 index.html'))
