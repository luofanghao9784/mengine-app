#!/usr/bin/env python3
"""Fixed 9POP order/payment/refund projection for the native source scheduler.

Requires a deployment-owned 0600 config and a column-scoped SELECT-only MySQL
account on the same server. Never accepts SQL or source fields from a request.
"""
import argparse,json,os,stat,subprocess
from pathlib import Path

COLUMNS = {'full_orders': ['id', 'member_course_id', 'store_id', 'payment_method', 'total_amount_cents', 'paid_amount_cents', 'current_receivable_amount_cents', 'receivable_stage', 'order_status', 'confirmed_at', 'deleted_at', 'created_at', 'updated_at'], 'payment_orders': ['id', 'full_order_id', 'member_course_id', 'store_id', 'payment_type', 'expected_amount_cents', 'paid_amount_cents', 'channel', 'confirmation_source', 'channel_reconciliation_status', 'status', 'confirmed_at', 'finance_checked_at', 'created_at', 'updated_at'], 't_course_refund_records': ['id', 'approval_request_id', 'member_course_id', 'store_id', 'selected_refund_strategy', 'paid_amount_cents', 'system_refund_amount_cents', 'retained_actual_revenue_cents', 'actual_refund_payout_cents', 'store_expense_impact_cents', 'finance_treatment', 'status', 'processing_mode', 'applied_at', 'paid_at', 'settled_at', 'created_at', 'updated_at']}

def collect(config):
    p=Path(config);st=p.lstat()
    if not stat.S_ISREG(st.st_mode) or st.st_mode&0o077 or st.st_uid not in (0,os.getuid()):raise ValueError('Private deployment config required')
    c=json.loads(p.read_text())
    if c['host']!='127.0.0.1' or c['database']!='9pop_v2':raise ValueError('Only the explicitly installed local 9POP source is supported')
    statements=["SET SESSION MAX_EXECUTION_TIME=15000","SET SESSION time_zone='+08:00'","SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ","SET SESSION TRANSACTION READ ONLY","START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY","SELECT JSON_OBJECT('kind','snapshot','readOnly',@@session.transaction_read_only,'readAt',NOW())"]
    for table,fields in COLUMNS.items():
        statements.append("SELECT JSON_OBJECT('kind','schema','table',TABLE_NAME,'column',COLUMN_NAME,'type',COLUMN_TYPE,'nullable',IS_NULLABLE,'comment',COLUMN_COMMENT,'key',COLUMN_KEY) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='9pop_v2' AND TABLE_NAME='"+table+"' AND COLUMN_NAME IN ("+','.join("'"+f+"'" for f in fields)+") ORDER BY ORDINAL_POSITION")
        statements.append("SELECT JSON_OBJECT('kind','row','table','"+table+"','values',JSON_ARRAY("+','.join('CAST(`'+f+'` AS CHAR)' for f in fields)+")) FROM `"+table+"` ORDER BY id LIMIT 10001")
    statements.append('ROLLBACK')
    r=subprocess.run(['/usr/bin/mysql','--default-character-set=utf8mb4','--connect-timeout=8','-h127.0.0.1','-u'+c['username'],'9pop_v2','-N','-B','--raw'],input=';\n'.join(statements)+';',env={'PATH':'/usr/bin:/bin','MYSQL_PWD':c['password'],'LANG':'C.UTF-8'},capture_output=True,text=True,timeout=55)
    if r.returncode or len(r.stdout.encode())>20*1024*1024:raise ValueError('Source query failed or exceeded bounded output')
    items=[json.loads(l) for l in r.stdout.splitlines()]
    if not items or items[0].get('readOnly')!=1:raise ValueError('Source read-only verification failed')
    tables=[];rows={}
    for table,fields in COLUMNS.items():
        schema={x['column']:x for x in items if x.get('kind')=='schema' and x.get('table')==table}
        if set(schema)!=set(fields):raise ValueError('Required source columns unavailable')
        tables.append({'name':table,'comment':'9POP固定投影；金额保留分；以源状态和部署口径解释','columns':[{'name':n,'type':schema[n]['type'],'nullable':schema[n]['nullable']=='YES','primary':schema[n]['key']=='PRI','comment':schema[n]['comment']} for n in fields]})
        values=[x['values'] for x in items if x.get('kind')=='row' and x.get('table')==table]
        if len(values)>10000 or any(len(v)!=len(fields) for v in values):raise ValueError('Source table exceeded bounds')
        rows[table]=[dict(zip(fields,v)) for v in values]
    return {'contractVersion':'1.0','tenantId':c['tenantId'],'readAt':items[0]['readAt'],'coverageThrough':None,'tables':tables,'rows':rows}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);args=parser.parse_args()
    try:print(json.dumps(collect(args.config),ensure_ascii=False))
    except Exception:raise SystemExit('NINEPOP_DEPLOYMENT_SOURCE_FAILED')
if __name__=='__main__':main()
