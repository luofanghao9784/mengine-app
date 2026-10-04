#!/usr/bin/env python3
"""Deployment-owned 9POP aggregate reader. No arbitrary SQL, remote writes or model calls."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid

KEY = 'ninepop_daily_receipts_v1'
COLUMNS = ['营业日期', '门店', '已确认收款笔数', '已确认收款金额（分）', '其中待财务复核笔数', '其中待财务复核金额（分）']
# Original verified receipt semantics: pending finance is a SUBSET of receipts, not unpaid money.
# The deployment account is broad; READ ONLY applies to this session, not an account-level grant.
SQL = """
SET SESSION MAX_EXECUTION_TIME=15000;
SET SESSION time_zone='+08:00';
SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SET SESSION TRANSACTION READ ONLY;
START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY;
SET @cutoff=NOW();
SELECT JSON_OBJECT('readonly',@@session.transaction_read_only,'coverageThrough',DATE_FORMAT(CONVERT_TZ(@cutoff,'+08:00','+00:00'),'%Y-%m-%dT%H:%i:%sZ'));
SELECT JSON_ARRAY(period,name,CAST(payments AS CHAR),CAST(receipts AS CHAR),CAST(pending_count AS CHAR),CAST(pending_amount AS CHAR)) FROM (
SELECT DATE_FORMAT(p.confirmed_at,'%Y-%m-%d') AS period,s.id AS store_id,s.name,COUNT(*) AS payments,SUM(p.paid_amount_cents) AS receipts,SUM(p.status!='finance_confirmed') AS pending_count,SUM(IF(p.status!='finance_confirmed',p.paid_amount_cents,0)) AS pending_amount
FROM payment_orders p JOIN full_orders f ON f.id=p.full_order_id JOIN stores s ON s.id=p.store_id
WHERE f.deleted_at IS NULL AND f.order_status!='canceled'
AND p.status IN ('confirmed_pending_voucher','voucher_uploaded','finance_rejected','finance_confirmed')
AND p.confirmed_at>=DATE_SUB(DATE(@cutoff),INTERVAL 89 DAY) AND p.confirmed_at<@cutoff
GROUP BY DATE_FORMAT(p.confirmed_at,'%Y-%m-%d'),s.id,s.name
) AS aggregates ORDER BY period,store_id;
ROLLBACK;
"""


def remote_program():
    # Credentials never leave the existing server or appear in arguments/output.
    return '''import json,os,subprocess,sys
from pathlib import Path
try:
 d={}
 for line in Path('/etc/9pop-v2/9pop-v2.env').read_text().splitlines():
  if '=' in line and not line.lstrip().startswith('#'):
   k,v=line.split('=',1);d[k.strip()]=v.strip().strip("\\\"'")
 if d.get('NINEPOP_DB_USERNAME')!='ninepop':raise ValueError()
 r=subprocess.run(['mysql','--default-character-set=utf8mb4','-uninepop','-h127.0.0.1','9pop_v2','-N','-B','--raw'],input=''' + repr(SQL) + ''',env={**os.environ,'MYSQL_PWD':d['NINEPOP_DB_PASSWORD']},capture_output=True,text=True,timeout=25)
 if r.returncode or len(r.stdout.encode())>2097152:raise ValueError()
 lines=r.stdout.splitlines();meta=json.loads(lines[0]);rows=[json.loads(x) for x in lines[1:]]
 if meta['readonly']!=1:raise ValueError()
 print(json.dumps({'coverageThrough':meta['coverageThrough'],'rows':rows},ensure_ascii=False))
except Exception:
 print('NINEPOP_READ_FAILED',file=sys.stderr);sys.exit(1)
'''


def validate(request, config):
    if request.get('contractVersion') != '1.0' or request.get('tenantId') != config['tenantId'] or request.get('connectionId') != config['connectionId']:
        raise ValueError('scope')
    uuid.UUID(request['runId'])
    expected = [{'id': config['datasetId'], 'key': KEY, 'columns': COLUMNS}]
    if request.get('datasets') != expected:
        raise ValueError('datasets')
    if not re.fullmatch(r'[a-z_][a-z0-9_-]*@[a-zA-Z0-9.-]+', config['sshTarget']):
        raise ValueError('host')
    for key in ('tenantId','connectionId','datasetId'):
        uuid.UUID(config[key])


def collect(request, config):
    validate(request, config)
    result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=3', config['sshTarget'], 'sudo -n python3 -'], input=remote_program(),capture_output=True,text=True,timeout=40)
    if result.returncode or len(result.stdout.encode()) > 2097152:
        raise ValueError('source unavailable')
    data = json.loads(result.stdout)
    if not isinstance(data['rows'],list) or len(data['rows']) > 10000:
        raise ValueError('size')
    for row in data['rows']:
        if len(row)!=len(COLUMNS) or any(not isinstance(x,str) or len(x)>200 for x in row):raise ValueError('shape')
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',row[0]) or any(not re.fullmatch(r'\d+',x) for x in row[2:]):raise ValueError('value')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z',data['coverageThrough']):raise ValueError('coverage')
    return {'contractVersion':'1.0','snapshots':[{'datasetId':config['datasetId'],**data}]}


def main():
    os.umask(0o077)
    path=Path(sys.argv[1])
    if path.is_symlink() or not path.is_file() or path.stat().st_uid!=os.getuid() or path.stat().st_mode&0o077 or path.stat().st_size>16384:raise ValueError('private configuration')
    raw=sys.stdin.buffer.read(16385)
    if len(raw)>16384:raise ValueError('request size')
    result=collect(json.loads(raw),json.loads(path.read_text()))
    # stdout is the private process protocol, never a log or a terminal preview.
    sys.stdout.write(json.dumps(result,ensure_ascii=False))

if __name__=='__main__':
    try:main()
    except Exception:
        print('NINEPOP_COLLECTION_UNAVAILABLE',file=sys.stderr);sys.exit(1)
