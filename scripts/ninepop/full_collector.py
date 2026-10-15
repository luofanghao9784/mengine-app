#!/usr/bin/env python3
"""Bounded complete MySQL snapshots for operator-installed 9POP projections.

The planning read only sizes pages. Every published count, schema and page is
read again inside ONE repeatable-read, read-only transaction. Concurrent growth
beyond the plan aborts the entire export, never publishes a truncated table.
"""
import argparse,hashlib,json,os,re,stat,subprocess,uuid,tempfile,resource
from pathlib import Path
MAX_ROWS=100000
MAX_BYTES=64*1024*1024
MAX_CELLS=2000000
PAGE_SIZE=1000
IDENTIFIER=re.compile(r'^[a-z][a-z0-9_]{0,63}$')

def private(path):
    p=Path(path);st=p.lstat()
    if not stat.S_ISREG(st.st_mode) or st.st_mode&0o077 or st.st_uid not in (0,os.getuid()):raise ValueError('Private deployment file required')
    return json.loads(p.read_text())

def projections(value,tenant):
    if value.get('tenantId')!=tenant or value.get('contractVersion')!='1.0':raise ValueError('Projection tenant mismatch')
    tables=value.get('tables',[])
    if not 1<=len(tables)<=100:raise ValueError('Projection table limit')
    seen=set()
    for t in tables:
        n=t.get('name','');cols=t.get('columns',[])
        if t.get('access') not in (None,'owner-only'):raise ValueError('Unsupported access policy')
        if not IDENTIFIER.fullmatch(n) or n in seen or not 1<=len(cols)<=100 or len(set(cols))!=len(cols) or any(not isinstance(c,str) or not IDENTIFIER.fullmatch(c) for c in cols):raise ValueError('Invalid fixed projection')
        if any(c not in cols for c in t.get('allowEmptyColumns',[])):raise ValueError('Unknown empty-string policy column')
        seen.add(n)
    return tables

def query(config,statements):
    def bound_output():resource.setrlimit(resource.RLIMIT_FSIZE,(MAX_BYTES,MAX_BYTES))
    # Limit the child output on disk before reading it into memory; a large
    # source value or error cannot allocate an unbounded capture buffer.
    with tempfile.TemporaryFile() as output,tempfile.TemporaryFile() as error:
        r=subprocess.run(['/usr/bin/mysql','--default-character-set=utf8mb4','--connect-timeout=8','-h127.0.0.1','-u'+config['username'],'9pop_v2','-N','-B','--raw'],input=';\n'.join(statements)+';\n',env={'PATH':'/usr/bin:/bin','MYSQL_PWD':config['password'],'LANG':'C.UTF-8'},stdout=output,stderr=error,text=True,timeout=40,preexec_fn=bound_output)
        if r.returncode or output.tell()>MAX_BYTES:raise ValueError('Source query failed or exceeded capacity')
        output.seek(0)
        return [json.loads(line) for line in output]

def begin():
    return ["SET SESSION MAX_EXECUTION_TIME=15000","SET SESSION time_zone='+08:00'","SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ","SET SESSION TRANSACTION READ ONLY","START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY","SELECT JSON_OBJECT('kind','snapshot','readOnly',@@session.transaction_read_only,'readAt',DATE_FORMAT(NOW(6),'%Y-%m-%d %H:%i:%s.%f'))"]

def metadata(t):
    n=t['name'];cols=','.join("'"+c+"'" for c in t['columns'])
    return [f"SELECT JSON_OBJECT('kind','count','table','{n}','rows',COUNT(*)) FROM `{n}`",f"SELECT JSON_OBJECT('kind','schema','table',c.TABLE_NAME,'column',c.COLUMN_NAME,'type',c.COLUMN_TYPE,'nullable',c.IS_NULLABLE,'comment',c.COLUMN_COMMENT,'key',c.COLUMN_KEY,'engine',t.ENGINE) FROM information_schema.COLUMNS c JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME WHERE c.TABLE_SCHEMA='9pop_v2' AND c.TABLE_NAME='{n}' AND c.COLUMN_NAME IN ({cols}) ORDER BY c.ORDINAL_POSITION"]

def inspect(items,tables):
    if not items or items[0].get('kind')!='snapshot' or items[0].get('readOnly')!=1:raise ValueError('Read-only transaction required')
    result={};cells=0
    for t in tables:
        n=t['name'];counts=[x['rows'] for x in items if x.get('kind')=='count' and x.get('table')==n]
        schema={x['column']:x for x in items if x.get('kind')=='schema' and x.get('table')==n}
        if len(counts)!=1 or not isinstance(counts[0],int) or not 0<=counts[0]<=MAX_ROWS or set(schema)!=set(t['columns']) or any(x['engine']!='InnoDB' for x in schema.values()):raise ValueError('Incomplete or unsupported source')
        pk=[c for c in t['columns'] if schema[c]['key']=='PRI']
        if not pk:raise ValueError('Stable primary key required')
        cells+=counts[0]*len(schema)
        if cells>MAX_CELLS:raise ValueError('Snapshot cell capacity exceeded')
        result[n]={'count':counts[0],'schema':schema,'pk':pk}
    return result

def export_sql(tables,plan):
    sql=begin()
    for t in tables:
        n=t['name'];sql+=metadata(t);p=plan[n]
        # One spare page tolerates small concurrent growth; the in-snapshot count
        # remains authoritative. A shrink yields empty trailing pages, not rows.
        for page in range((p['count']+PAGE_SIZE-1)//PAGE_SIZE+1):
            order=','.join('`'+k+'`' for k in p['pk']);values=','.join('CAST(`'+c+'` AS CHAR)' for c in t['columns'])
            sql.append(f"SELECT JSON_OBJECT('kind','row','table','{n}','page',{page},'values',JSON_ARRAY({values})) FROM `{n}` ORDER BY {order} LIMIT {PAGE_SIZE} OFFSET {page*PAGE_SIZE}")
    return sql+['ROLLBACK']

def assemble(config,tables,items):
    current=inspect(items,tables);sid=str(uuid.uuid4());rows={};definitions=[];proofs={}
    for t in tables:
        n=t['name'];p=current[n];values=[x for x in items if x.get('kind')=='row' and x.get('table')==n]
        if len(values)!=p['count']:raise ValueError('Source changed beyond page plan or incomplete export')
        keys=set();page_counts=[];output=[]
        for i,x in enumerate(values):
            if x.get('page')!=i//PAGE_SIZE or len(x['values'])!=len(t['columns']) or any(v is not None and not isinstance(v,str) for v in x['values']):raise ValueError('Invalid page or values')
            row=dict(zip(t['columns'],x['values']));key=tuple(row[c] for c in p['pk'])
            if any(v is None or v=='' for v in key) or key in keys:raise ValueError('Duplicate/missing stable key')
            keys.add(key);output.append(row)
            if i%PAGE_SIZE==0:page_counts.append(0)
            page_counts[-1]+=1
        rows[n]=output
        definitions.append({**({'access':'owner-only'} if t.get('access')=='owner-only' else {}),'name':n,'comment':t.get('description','9POP获准固定投影；全历史只读一致性取数；保留源单位与状态'),'columns':[{**({'allowEmpty':True} if c in t.get('allowEmptyColumns',[]) else {}),'name':c,'type':p['schema'][c]['type'],'nullable':p['schema'][c]['nullable']=='YES','primary':c in p['pk'],'comment':p['schema'][c]['comment']} for c in t['columns']]})
        proofs[n]={'snapshotId':sid,'expectedRows':p['count'],'pageSize':PAGE_SIZE,'pageCounts':page_counts,'primaryKey':p['pk'],'sha256':hashlib.sha256(json.dumps(output,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()}
    return {'contractVersion':'2.0','tenantId':config['tenantId'],'snapshot':{'id':sid,'readOnly':True,'isolation':'REPEATABLE READ','readAt':items[0]['readAt'],'timeZone':'Asia/Shanghai','coverageThrough':None},'tables':definitions,'rows':rows,'proofs':proofs}

def collect(path):
    c=private(path)
    if c['host']!='127.0.0.1' or c['database']!='9pop_v2':raise ValueError('Only installed local 9POP source is supported')
    tables=projections(private(c['projectionFile']),c['tenantId'])
    plan_sql=begin()
    for t in tables:plan_sql+=metadata(t)
    plan=inspect(query(c,plan_sql+['ROLLBACK']),tables)
    return assemble(c,tables,query(c,export_sql(tables,plan)))

def main():
    p=argparse.ArgumentParser();p.add_argument('--config',required=True);a=p.parse_args()
    try:
        result=json.dumps(collect(a.config),ensure_ascii=False,separators=(',',':'))
        if len(result.encode())>MAX_BYTES:raise ValueError('Output capacity exceeded')
        print(result)
    except Exception:raise SystemExit('NINEPOP_COMPLETE_SOURCE_FAILED')
if __name__=='__main__':main()
