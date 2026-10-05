#!/usr/bin/env python3
"""Bound deployment collector: four 9POP business archives, one read-only snapshot."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid

DEFINITIONS = {
 'ninepop_orders_v1': ('订单明细', '财务', ['订单ID','会员ID','会员姓名','门店','课程','支付方案','订单状态','应收阶段','订单金额（分）','已付金额（分）','当前应收（分）','创建时间','确认时间','删除时间'], "SELECT f.id,f.member_id,m.name,s.name,f.course_name,f.payment_method,f.order_status,f.receivable_stage,f.total_amount_cents,f.paid_amount_cents,f.current_receivable_amount_cents,f.created_at,f.confirmed_at,f.deleted_at FROM full_orders f LEFT JOIN members m ON m.id=f.member_id LEFT JOIN stores s ON s.id=f.store_id ORDER BY f.created_at,f.id"),
 'ninepop_payments_v1': ('收款明细', '财务', ['收款ID','订单ID','会员ID','门店','收款类型','应收金额（分）','实收金额（分）','渠道','确认来源','收款状态','确认时间','财务复核时间','创建时间'], "SELECT p.id,p.full_order_id,p.member_id,s.name,p.payment_type,p.expected_amount_cents,p.paid_amount_cents,p.channel,p.confirmation_source,p.status,p.confirmed_at,p.finance_checked_at,p.created_at FROM payment_orders p LEFT JOIN stores s ON s.id=p.store_id ORDER BY p.created_at,p.id"),
 'ninepop_members_v1': ('会员档案', '运营', ['会员ID','会员姓名','门店','主教练','销售教练','会员状态','档案类型','共创会员','创建时间','更新时间'], "SELECT m.id,m.name,s.name,c.name,sc.name,m.status,m.profile_type,m.is_co_create,m.created_at,m.updated_at FROM members m LEFT JOIN stores s ON s.id=m.store_id LEFT JOIN coaches c ON c.id=m.main_coach_id LEFT JOIN coaches sc ON sc.id=m.sales_coach_id ORDER BY m.created_at,m.id"),
 'ninepop_sessions_v1': ('课时明细', '运营', ['课时ID','会员ID','会员姓名','会员课程ID','归属门店','授课门店','教练','课程时间','营业日期','课时状态','有效状态','来源','作废时间'], "SELECT r.id,r.member_id,m.name,r.member_course_id,s.name,ts.name,c.name,r.session_datetime,r.business_date,r.status,r.effective_status,r.source_type,r.voided_at FROM session_records r LEFT JOIN members m ON m.id=r.member_id LEFT JOIN stores s ON s.id=r.home_store_id LEFT JOIN stores ts ON ts.id=r.teaching_store_id LEFT JOIN coaches c ON c.id=r.coach_id ORDER BY r.session_datetime,r.id")
}
MAX_BYTES = 20 * 1024 * 1024
MAX_CELLS = 1000000


def sql():
    statements = ["SET SESSION MAX_EXECUTION_TIME=15000", "SET SESSION time_zone='+08:00'", "SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ", "SET SESSION TRANSACTION READ ONLY", "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY", "SET @cutoff=NOW()", "SELECT JSON_OBJECT('readonly',@@session.transaction_read_only,'coverageThrough',DATE_FORMAT(CONVERT_TZ(@cutoff,'+08:00','+00:00'),'%Y-%m-%dT%H:%i:%sZ'))"]
    for key, (_, _, columns, query) in DEFINITIONS.items():
        # Projection is fixed in code. Every SQL NULL becomes an empty archive cell.
        projection, rest = query[7:].split(' FROM ', 1)
        fields = projection.split(',')
        assert len(fields) == len(columns)
        cells = ','.join("COALESCE(CAST(" + field + " AS CHAR),'')" for field in fields)
        statements.append("SELECT JSON_OBJECT('key','" + key + "','row',JSON_ARRAY(" + cells + ")) FROM " + rest)
    return ';\n'.join(statements) + ';\nROLLBACK;\n'


def remote_program():
    return '''import json,os,subprocess,sys
from pathlib import Path
try:
 d={}
 for line in Path('/etc/9pop-v2/9pop-v2.env').read_text().splitlines():
  if '=' in line and not line.lstrip().startswith('#'):
   k,v=line.split('=',1);d[k.strip()]=v.strip().strip("\\\"'")
 if d.get('NINEPOP_DB_USERNAME')!='ninepop':raise ValueError()
 r=subprocess.run(['mysql','--default-character-set=utf8mb4','-uninepop','-h127.0.0.1','9pop_v2','-N','-B','--raw'],input=''' + repr(sql()) + ''',env={**os.environ,'MYSQL_PWD':d['NINEPOP_DB_PASSWORD']},capture_output=True,text=True,timeout=90)
 if r.returncode or len(r.stdout.encode())>20971520:raise ValueError()
 lines=r.stdout.splitlines();meta=json.loads(lines[0]);rows={k:[] for k in ''' + repr(list(DEFINITIONS)) + '''}
 if meta['readonly']!=1:raise ValueError()
 for line in lines[1:]:
  item=json.loads(line);rows[item['key']].append(item['row'])
 print(json.dumps({'coverageThrough':meta['coverageThrough'],'datasets':rows},ensure_ascii=False))
except Exception:
 print('NINEPOP_READ_FAILED',file=sys.stderr);sys.exit(1)
'''


def validate(request, config):
    if request.get('contractVersion') != '1.0' or request.get('tenantId') != config['tenantId'] or request.get('connectionId') != config['connectionId']:
        raise ValueError('scope')
    for key in ('tenantId','connectionId'):
        uuid.UUID(config[key])
    uuid.UUID(request['runId'])
    if set(config['datasetIds']) != set(DEFINITIONS): raise ValueError('definitions')
    expected = {key: {'id': config['datasetIds'][key], 'key': key, 'columns': value[2]} for key,value in DEFINITIONS.items()}
    for value in expected.values(): uuid.UUID(value['id'])
    datasets=request.get('datasets')
    if not isinstance(datasets,list) or len(datasets)!=len(expected) or {d['key'] for d in datasets}!=set(expected) or any(d!=expected[d['key']] for d in datasets): raise ValueError('datasets')
    # Destination config cannot redirect this deployment reader to another host.
    if config.get('sshTarget') != 'ubuntu@139.155.42.35': raise ValueError('host')


def result(request, config, data):
    if set(data['datasets']) != set(DEFINITIONS): raise ValueError('result scope')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z',data['coverageThrough']): raise ValueError('coverage')
    cells=0
    for key, rows in data['datasets'].items():
        if not isinstance(rows,list) or len(rows)>100000: raise ValueError('size')
        for row in rows:
            if not isinstance(row,list) or len(row)!=len(DEFINITIONS[key][2]) or any(not isinstance(x,str) or len(x)>500 for x in row): raise ValueError('shape')
            cells+=len(row)
    if cells>MAX_CELLS: raise ValueError('cells')
    return {'contractVersion':'1.0','snapshots':[{'datasetId':d['id'],'rows':data['datasets'][d['key']],'coverageThrough':data['coverageThrough']} for d in request['datasets']]}


def collect(request, config):
    validate(request, config)
    process = subprocess.run(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=3',config['sshTarget'],'sudo -n python3 -'],input=remote_program(),capture_output=True,text=True,timeout=105)
    if process.returncode or len(process.stdout.encode())>MAX_BYTES: raise ValueError('source unavailable')
    return result(request,config,json.loads(process.stdout))


def main():
    os.umask(0o077)
    path=Path(sys.argv[1])
    if path.is_symlink() or not path.is_file() or path.stat().st_uid!=os.getuid() or path.stat().st_mode&0o077 or path.stat().st_size>16384: raise ValueError('private configuration')
    raw=sys.stdin.buffer.read(65537)
    if len(raw)>65536: raise ValueError('request size')
    sys.stdout.write(json.dumps(collect(json.loads(raw),json.loads(path.read_text())),ensure_ascii=False))

if __name__=='__main__':
    try: main()
    except Exception:
        print('NINEPOP_COLLECTION_UNAVAILABLE',file=sys.stderr);sys.exit(1)
