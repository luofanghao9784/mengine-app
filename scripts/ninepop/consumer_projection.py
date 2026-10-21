"""Build local, fixed-purpose consumer projections from an approved deployment bundle.

Caller supplies trusted deployment scopes, never model/request arguments. This
module does not publish, authorize accounts, or change original datasets.
"""
import copy
import hashlib
import collections
import consumer_history as hist
import reviewed_tables as reviewed
import history_scope as scope
import scoped_materials as materials


MODULE_TOPICS = {'04':'finance_sensitive','06':'finance_sensitive','07':'finance_sensitive',
                 '08':'salary','09':'finance_sensitive','10':'finance_sensitive','11':'dividend',
                 '12':'service','14':'service','15':'service'}

def topic_for(table, module):
    topic = reviewed.ADAPTERS.get(table,(None,))[0]
    if not topic:
        if module not in MODULE_TOPICS: raise ValueError('No reviewed consumer topic')
        topic = MODULE_TOPICS[module]
    if table == 'trial_course_commission_entries': topic = 'salary'
    return 'finance_sensitive' if topic == 'finance' else topic

def topic_readers(topic, manager, leaders, owner):
    if topic not in {'service','salary','dividend','finance_sensitive'}:
        raise ValueError('No reviewed consumer audience')
    return sorted(set([owner,manager] if topic=='service' else list(leaders)+[manager] if topic=='salary' else leaders))


def build(rows, tables, snapshots, tenant, base_policies, spaces, store_names,
          leaders, owner, metadata):
    asof = min(s['readAt'] for s in snapshots)
    bundle = {'tenantId':tenant,'completeHistory':True,'asOf':asof,'rows':rows}
    history = hist.CourseHistory(bundle,tenant)
    pol = reviewed.policies(base_policies)
    out = []; isolated = {}
    approved = {t:[c['name'] for c in d['columns']] for t,d in tables.items()}
    forbidden={'file_ids','primary_file_id','file_id','url','download_url','password_hash','phone','email'}
    def add(table,purpose,store,records,columns,topic):
     if not records:return
     if not set(columns)<=set(approved[table]) or forbidden&set(columns):raise ValueError('Unapproved projection')
     space=next(s for s in spaces if s['name']==store_names[store]);manager=space['owner']
     readers=topic_readers(topic,manager,leaders,owner)
     name='c_'+hashlib.sha256((table+'|'+purpose+'|'+store).encode()).hexdigest()[:20]
     definition=copy.deepcopy(tables[table]);definition['name']=name;definition['access']='owner-only';definition['columns']=[c for c in definition['columns'] if c['name'] in columns]
     definition['comment']=table+' / '+purpose+' / '+store+'；2026-10-21固定用途投影，独立批次读取，不重算历史金额'
     data=[{c:r[c] for c in columns} for r in records]
     hist.index(data)
     out.append({'name':name,'sourceTable':table,'purpose':purpose,'store':store,'topic':topic,'readers':readers,'workspaceId':space['id'],'definition':definition,'rows':data})
    # Existing five datasets retain their original versions and metrics.
    skip={'full_orders','payment_orders','t_course_refund_records','payslips','dividend_periods'}
    # These source tables require dedicated purpose, time, or resource adapters.
    special=set(materials.HISTORICAL)|set(materials.REFERENCES)|set(reviewed.BLOCKERS)|{'members','staffs','coaches','store_roles','stores','session_records','member_store_transfers','member_store_transfer_commission_reserves','announcement_visibility_scopes'}
    for table in tables:
     if table in skip or table in special:continue
     module=metadata[table]['module']
     if module=='07':continue # full-enterprise financial readers use the unchanged raw dataset, avoiding repeated debt snapshots
     topic=topic_for(table,module)
     scopes=scope.resolve(table,rows,pol)
     key=pol.get(table,{}).get('key','id')
     if key!='id':continue # preserve source keys; need separate non-id projection adapter
     for store in store_names:
      selected=[r for r in rows[table] if scopes.get(r[key])=={store}]
      cols=[c for c in approved[table] if c not in forbidden]
      add(table,'reviewed_store',store,selected,cols,topic)
     isolated[table]=sum(not scopes.get(r[key]) for r in rows[table])
    for purpose,(table,topic,col,cols) in reviewed.PURPOSES.items():
     for store in store_names:
      projected=reviewed.project_purpose(purpose,bundle,approved,'actor',store,{'actor':{topic:[store]}},tenant)
      add(table,purpose,store,projected,cols,topic)
    for table,(topic,at,cols) in materials.HISTORICAL.items():
     if table=='coach_level_history':
      proved=set()
      for store in store_names:
       selected=[r for r in rows[table] if hist.level_used_by_store(r,rows['session_records'],store)]
       proved.update(r['id'] for r in selected);add(table,'salary_period_basis',store,selected,cols,'salary')
      isolated[table]=len(rows[table])-len(proved)
      continue
     selected=collections.defaultdict(list);missing=0
     for row in rows[table]:
      result=None
      if table in {'member_courses','member_course_events','member_self_leave_requests','course_experience_officer_assignments','special_course_entitlements'}:
       proof=history.resolve(row['id'] if table=='member_courses' else row.get('member_course_id'),asof if table in materials.SNAPSHOT_TABLES else row.get(at),row.get('member_id'))
       result=proof['store'] if proof else None
      elif table=='member_contract_events':
       proof=history.resolve_member(row['member_id'],row['created_at']);result=proof['store'] if proof else None
      elif table=='payroll_commission_rate_locks':result=hist.salary_month_scope(row,rows['payslips'],store_names)
      elif table=='special_course_usage_records':
       parents=[s for s in rows['session_records'] if s['id']==row['session_record_id'] and s['member_id']==row['member_id'] and s['member_course_id']==row['member_course_id'] and s['business_date']==row['business_date']]
       result=parents[0]['teaching_store_id'] if len(parents)==1 else None
      elif table in {'member_store_transfer_courses','member_store_transfer_settlements'}:
       parents=[s for s in rows['member_store_transfers'] if s['id']==row['transfer_id'] and s['status'] in ['effective','reversed'] and s.get('effective_at') and hist.point(s['effective_at'])<=hist.point(asof)]
       result=parents[0]['source_store_id'] if len(parents)==1 else None
       topic='finance_sensitive'
      elif table=='member_store_transfer_reversals':
       result=row['restore_store_id'] if row['status']=='effective' and row.get('applied_at') and hist.point(row['applied_at'])<=hist.point(asof) else None
      # coach_level_history and contract events require explicit period records; no current-store fallback.
      if result in store_names:selected[result].append(row)
      else:missing+=1
     isolated[table]=missing
     for store,records in selected.items():add(table,'historical',store,records,cols,topic)
    # Minimal company metadata is separately confirmed for all eight named readers.
    for table,cols in materials.MINIMAL_METADATA.items():
     if not rows[table]:continue
     for store in store_names:
      add(table,'minimal_reference',store,rows[table],cols,'service')
      manager=next(s['owner'] for s in spaces if s['name']==store_names[store]);out[-1]['readers']=sorted(set(list(leaders)+[manager]))
    return out, isolated, asof
