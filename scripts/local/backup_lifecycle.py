"""Current authoritative object/operation lifecycle reconciliation, without replaying business actions."""
import json
import backup
import backup_recovery as recovery

KINDS={'TASK','DOCUMENT','ARTIFACT','EXPERIENCE_VERSION','FEEDBACK_VERSION','EVALUATION_VERSION','EVALUATION_RUN','EXPORT_CACHE','PROFILE_VERSION','METHOD_VERSION'}


def values(row):
    return ','.join(recovery.literal(json.dumps(v,ensure_ascii=False) if isinstance(v,(dict,list)) else v) for v in row.values())


def method_heads(sql,current_sql):
    """An old snapshot head is not a current dependency or permission to reopen a method."""
    if not recovery.has_table(sql,'method_families'):return {'retained':0,'cleared':0}
    current={r['id']:r for r in recovery.json_rows(current_sql,'SELECT id,head_version FROM method_families')}
    latest_versions={r['id']:r for r in recovery.json_rows(current_sql,"SELECT * FROM method_versions WHERE object_is_active('METHOD_VERSION',id)")}
    retained_versions={r['id']:r for r in recovery.json_rows(sql,'SELECT * FROM method_versions')}
    result={'retained':0,'cleared':0}
    for old in recovery.json_rows(sql,'SELECT id,head_version FROM method_families'):
        head=current.get(old['id'],{}).get('head_version')
        version=latest_versions.get(head)
        if version is None or version.get('scrubbed',False) or retained_versions.get(head)!=version:
            head=None
        # Publication/active adoption are reopened separately, against exact current evidence.
        sql('UPDATE method_families SET head_version='+recovery.literal(head)+'::uuid,published_version=NULL WHERE id='+recovery.quoted_id(old['id']))
        result['retained' if head else 'cleared']+=1
    return result


def version_bodies(sql,current_sql):
    """A current irreversible body tombstone is authoritative even before lifecycle bookkeeping."""
    result={'profiles':0,'methods':0}
    for table,kind,columns,key in (
            ('profile_versions','PROFILE_VERSION','id,tenant_id,entry_id,revision,created_at','profiles'),
            ('method_versions','METHOD_VERSION','id,family_id,number,created_at','methods')):
        if not recovery.has_table(sql,table):continue
        current={r['id']:r for r in recovery.json_rows(current_sql,'SELECT '+columns+' FROM '+table+' WHERE scrubbed')}
        for old in recovery.json_rows(sql,'SELECT '+columns+' FROM '+table):
            if current.get(old['id'])==old:
                sql('SELECT scrub_lifecycle_object('+recovery.literal(kind)+','+recovery.quoted_id(old['id'])+')')
                result[key]+=1
    return result


def objects(sql,current_sql):
    if not recovery.has_table(sql,'object_lifecycle'):
        return {'matched':0,'isolated':0,'purged':0}
    rows=lambda db,query:recovery.json_rows(db,query)
    current_sources={(x['kind'],x['object_id']):x for x in rows(current_sql,'SELECT * FROM lifecycle_object_sources')}
    local_sources={(x['kind'],x['object_id']):x for x in rows(sql,'SELECT * FROM lifecycle_object_sources')}
    current={(x['kind'],x['object_id']):x for x in rows(current_sql,'SELECT * FROM object_lifecycle')}
    local={(x['kind'],x['object_id']):x for x in rows(sql,'SELECT * FROM object_lifecycle')}
    if {key[0] for key in (*current_sources,*local_sources,*current,*local)}-KINDS:
        backup.fail('恢复发现尚未适配的独立对象种类；保持隔离。')
    known_tenants={x['id'] for x in rows(sql,'SELECT id::text FROM tenants')}
    known_accounts={x['id'] for x in rows(sql,'SELECT id::text FROM accounts')}
    known_spaces={x['id'] for x in rows(sql,'SELECT id::text FROM workspaces')}
    result={'matched':0,'isolated':0,'purged':0}
    mapping={}
    to_purge=[]
    for key,source in local_sources.items():
        latest=current.get(key)
        old=local.get(key)
        if (source!=current_sources.get(key) or (old is not None and latest is None)
                or (latest and (latest['tenant_id'] is not None and latest['tenant_id'] not in known_tenants
                    or latest['workspace_id'] is not None and latest['workspace_id'] not in known_spaces
                    or latest['owner_id'] is not None and latest['owner_id'] not in known_accounts))):
            # An unmapped object is retained privately, without inventing evidence that it was deleted.
            fields={k:v for k,v in source.items() if k not in ('parent_kind','parent_id')}
            fields.update({'parent_kind':source['parent_kind'],'parent_id':source['parent_id'],'state':'ISOLATED','policy_pending':False})
            sql('INSERT INTO object_lifecycle('+','.join(fields)+') VALUES('+values(fields)+") ON CONFLICT(kind,object_id) DO UPDATE SET state=CASE WHEN object_lifecycle.state='PURGED' THEN 'PURGED' ELSE 'ISOLATED' END,policy_pending=false")
            result['isolated']+=1
            continue
        if latest is None:
            continue  # The same legacy object exists in both authorities; no invented automatic retention.
        row=dict(latest)
        if old:
            row['id']=old['id']
            if old['state']=='PURGED':row['state']='PURGED'
        fields=[k for k in row if k not in ('id','kind','object_id')]
        sql('INSERT INTO object_lifecycle('+','.join(row)+') VALUES('+values(row)+') ON CONFLICT(kind,object_id) DO UPDATE SET '+','.join(k+'=EXCLUDED.'+k for k in fields))
        mapping[latest['id']]=row['id']
        result['matched']+=1
        if row['state'] in ('PURGE_PENDING','PURGE_FAILED','PURGED'):
            to_purge.append(key)
    # Current scope fences apply even when discovery was incomplete at the snapshot. Expiry never resumes work.
    for row in rows(current_sql,'SELECT * FROM object_lifecycle_scopes'):
        if row['tenant_id'] not in known_tenants:
            continue
        if row['owner_id'] is not None and row['owner_id'] not in known_accounts:
            continue  # No retained object/account can belong to this entirely new owner.
        sql('INSERT INTO object_lifecycle_scopes('+','.join(row)+') VALUES('+values(row)+') ON CONFLICT(execution_id) DO UPDATE SET '+','.join(k+'=EXCLUDED.'+k for k in row if k!='execution_id'))
        # Rebuild the authoritative links for this scope; old uncorrelated scopes retain their restrictive fence.
        sql('DELETE FROM object_lifecycle_scope_items WHERE execution_id='+recovery.quoted_id(row['execution_id']))
        for item in rows(current_sql,'SELECT * FROM object_lifecycle_scope_items WHERE execution_id='+recovery.quoted_id(row['execution_id'])):
            if item['object_record'] in mapping:
                item['object_record']=mapping[item['object_record']]
                sql('INSERT INTO object_lifecycle_scope_items('+','.join(item)+') VALUES('+values(item)+')')
    for row in rows(current_sql,'SELECT * FROM object_lifecycle_events'):
        if row['object_record'] in mapping and (row['actor_id'] is None or row['actor_id'] in known_accounts):
            row['object_record']=mapping[row['object_record']]
            sql('INSERT INTO object_lifecycle_events('+','.join(row)+') VALUES('+values(row)+') ON CONFLICT DO NOTHING')
    for kind,identity in to_purge:
        sql('SELECT scrub_lifecycle_object('+recovery.literal(kind)+','+recovery.quoted_id(identity)+')')
        result['purged']+=1
    return result


def operations(sql,current_sql):
    if not recovery.has_table(sql,'operation_retention_windows'):
        return {'windows':0,'alreadyRemoved':0}
    tasks={x['id'] for x in recovery.json_rows(sql,'SELECT id::text FROM conversation_tasks')}
    result={'windows':0,'alreadyRemoved':0}
    for row in recovery.json_rows(current_sql,'SELECT * FROM operation_retention_windows'):
        if row['task_id'] not in tasks:continue
        fields=[k for k in row if k!='id']
        sql('INSERT INTO operation_retention_windows('+','.join(row)+') OVERRIDING SYSTEM VALUE VALUES('+values(row)+') ON CONFLICT(id) DO UPDATE SET '+','.join(k+'=EXCLUDED.'+k for k in fields))
        result['windows']+=1
        if row['state']=='COMPLETE':
            sql('DELETE FROM conversation_events WHERE task_id='+recovery.quoted_id(row['task_id'])+' AND seq<='+str(int(row['through_event']))+' AND created_at<='+recovery.literal(row['original_anchor']))
            sql("DELETE FROM identity_audit WHERE tenant_id="+recovery.quoted_id(row['tenant_id'])+' AND target_id='+recovery.quoted_id(row['task_id'])+
                " AND action IN('TASK_COMPLETE','TASK_FAILED','TASK_CANCELLED','TASK_INTERRUPTED','TASK_SUCCEEDED','TASK_START') AND outcome='SUCCESS' AND created_at<="+recovery.literal(row['original_anchor']))
            result['alreadyRemoved']+=1
    # Imported current receipts can refer to events after the old snapshot. Never reuse those identities.
    sql("SELECT setval(pg_get_serial_sequence('operation_retention_windows','id'),GREATEST(coalesce((SELECT max(id) FROM operation_retention_windows),1),(SELECT last_value FROM operation_retention_windows_id_seq)),true)")
    sql("SELECT setval(pg_get_serial_sequence('conversation_events','seq'),GREATEST(coalesce((SELECT max(through_event) FROM operation_retention_windows),1),(SELECT last_value FROM conversation_events_seq_seq)),true)")
    return result


def feedback(sql,current_sql):
    """Do not reopen an old active opinion after an authoritative edit/withdrawal.

    Only compare identities, source IDs and digests. New private assessment text is not
    imported into an old backup. Publication feedback is never joined to the author's task.
    """
    query="""SELECT f.id,f.tenant_id,f.workspace_id,f.actor_id,f.kind,f.task_id,
      f.task_revision,f.attempt,f.presentation_version,f.presentation_revision,
      f.publication_id,f.material_version_id,f.material_version,f.revision,f.scrubbed,
      v.id version_id,v.status,encode(sha256(convert_to(v.assessment::text,'UTF8')),'hex') assessment_digest,
      coalesce((SELECT json_agg(s.version_id ORDER BY s.version_id)
        FROM feedback_source_versions s WHERE s.feedback_id=f.id),'[]') sources
      FROM feedback_entries f JOIN feedback_versions v ON v.feedback_id=f.id AND v.revision=f.revision"""
    current={x['id']:x for x in recovery.json_rows(current_sql,query)}
    result={'matched':0,'isolated':0}
    for old in recovery.json_rows(sql,query):
        if old['scrubbed']:continue
        if old==current.get(old['id']):
            result['matched']+=1
            continue
        identity=recovery.quoted_id(old['id'])
        sql("""INSERT INTO object_lifecycle(kind,object_id,tenant_id,workspace_id,owner_id,parent_kind,parent_id,original_anchor,state,policy_pending)
          SELECT kind,object_id,tenant_id,workspace_id,owner_id,parent_kind,parent_id,original_anchor,'ISOLATED',false
          FROM lifecycle_object_sources WHERE kind='FEEDBACK_VERSION'
            AND object_id IN(SELECT id FROM feedback_versions WHERE feedback_id="""+identity+")\n"
          "ON CONFLICT(kind,object_id) DO UPDATE SET state=CASE WHEN object_lifecycle.state='PURGED' THEN 'PURGED' ELSE 'ISOLATED' END,policy_pending=false")
        result['isolated']+=1
    return result


def task_work(sql,current_sql):
    """Preserve task-token receipts, never replay plan checks or preference writes."""
    result={'scrubbedTasks':0,'pendingChecksCancelled':0,'dispatchUnavailable':0}
    if not recovery.has_table(sql,'task_plan_checks'):return result
    # Reasons may quote a task's source. Match its immutable receipt identity and current erasure.
    query="""SELECT id,tenant_id,owner_id,task_id,attempt_number,plan_id,execution_epoch,
      request_id,request_hash,accepted_revision,check_at,created_at,scrubbed,encode(sha256(convert_to(reason,'UTF8')),'hex') reason_digest
      FROM task_plan_checks"""
    current={x['id']:x for x in recovery.json_rows(current_sql,query)}
    states={x['id']:x for x in recovery.json_rows(current_sql,'SELECT id,state,dispatched_task_id FROM task_plan_checks')}
    tasks={x['id'] for x in recovery.json_rows(sql,'SELECT id FROM conversation_tasks')}
    scrub=set()
    for old in recovery.json_rows(sql,query):
        latest=current.get(old['id'])
        if not old['scrubbed'] and (old!=latest or latest['scrubbed']):scrub.add(old['task_id'])
        shape=lambda row:{k:v for k,v in row.items() if k not in ('scrubbed','reason_digest')}
        if latest is not None and shape(old)==shape(latest):
            state=states[old['id']]
            if state['state']=='DISPATCHED':
                target=state['dispatched_task_id'] if state['dispatched_task_id'] in tasks else None
                sql("UPDATE task_plan_checks SET state='DISPATCHED',dispatched_task_id="+recovery.literal(target)+"::uuid WHERE id="+recovery.quoted_id(old['id']))
                if target is None:result['dispatchUnavailable']+=1
            elif state['state']=='CANCELLED':
                sql("UPDATE task_plan_checks SET state='CANCELLED' WHERE id="+recovery.quoted_id(old['id']))
    for task in scrub:sql('SELECT scrub_task_work_task('+recovery.quoted_id(task)+')')
    result['scrubbedTasks']=len(scrub)
    result['pendingChecksCancelled']=int(sql("WITH removed AS(UPDATE task_plan_checks SET state='CANCELLED' WHERE state='PENDING' RETURNING 1) SELECT count(*) FROM removed"))
    # task_preference_saves is immutable enum/evidence-digest metadata; the actual profiles are
    # independently reconciled against current authority, never reconstructed from these receipts.
    return result


def adjustments(sql,current_sql):
    """Adjustment messages are explicit task inputs, independent of later opinion edits.

    Compare immutable origin/digests only. A changed or missing source mapping is not
    permission to replay an old message; current physical erasure must erase old bytes.
    """
    result={'matched':0,'isolated':0,'scrubbed':0}
    if not recovery.has_table(sql,'feedback_adjustment_messages'):return result
    query="""SELECT m.id,m.thread_id,m.ordinal,m.task_id,m.feedback_version_id,m.source_target,
      m.history_task_ids,m.created_at,m.scrubbed,
      encode(sha256(convert_to(m.snapshot::text,'UTF8')),'hex') snapshot_digest,
      encode(sha256(convert_to(m.request_text,'UTF8')),'hex') request_digest,
      t.tenant_id,t.owner_id,t.card_kind,t.card_id,t.conversation_id,
      coalesce((SELECT json_agg(d ORDER BY d.source_task_id)
        FROM adjustment_task_dependencies d WHERE d.task_id=m.task_id),'[]') dependencies,
      coalesce((SELECT json_agg(s.version_id ORDER BY s.version_id)
        FROM feedback_task_sources s WHERE s.task_id=m.task_id),'[]') material_sources
      FROM feedback_adjustment_messages m JOIN feedback_adjustment_threads t ON t.id=m.thread_id"""
    current={x['id']:x for x in recovery.json_rows(current_sql,query)}
    for old in recovery.json_rows(sql,query):
        latest=current.get(old['id'])
        if old['scrubbed']:continue
        if latest is not None and latest['scrubbed']:
            sql("SELECT scrub_lifecycle_object('TASK',"+recovery.quoted_id(old['task_id'])+')')
            result['scrubbed']+=1
        elif old==latest:
            result['matched']+=1
        else:
            sql("""INSERT INTO object_lifecycle(kind,object_id,tenant_id,workspace_id,owner_id,parent_kind,parent_id,original_anchor,state,policy_pending)
              SELECT kind,object_id,tenant_id,workspace_id,owner_id,parent_kind,parent_id,original_anchor,'ISOLATED',false
              FROM lifecycle_object_sources WHERE kind='TASK' AND object_id="""+recovery.quoted_id(old['task_id'])+"""
              ON CONFLICT(kind,object_id) DO UPDATE SET state=CASE WHEN object_lifecycle.state='PURGED' THEN 'PURGED' ELSE 'ISOLATED' END,policy_pending=false""")
            result['isolated']+=1
    return result


def forwarding(sql,current_sql):
    """Keep accepted/opened facts, without resending or importing missing recipients."""
    result={'matched':0,'scrubbed':0,'openedFacts':0}
    if not recovery.has_table(sql,'publication_forward_batches'):return result
    query="""SELECT b.id,b.tenant_id,b.sender_id,b.publication_id,b.material_version_id,
      b.request_id,b.request_hash,b.accepted_at,b.scrubbed,
      encode(sha256(convert_to(b.note,'UTF8')),'hex') note_digest,
      coalesce((SELECT json_agg(jsonb_build_object('id',r.id,'recipient_id',r.recipient_id) ORDER BY r.id)
        FROM publication_forward_receipts r WHERE r.batch_id=b.id),'[]') recipients
      FROM publication_forward_batches b"""
    current={x['id']:x for x in recovery.json_rows(current_sql,query)}
    opened={x['id']:x for x in recovery.json_rows(current_sql,'SELECT id,batch_id,recipient_id,opened_at FROM publication_forward_receipts')}
    for old in recovery.json_rows(sql,query):
        latest=current.get(old['id'])
        # Unknown origin/changed recipient lists cannot become a reconstructed delivery.
        if not old['scrubbed'] and old!=latest:
            sql("UPDATE publication_forward_batches SET note='',scrubbed=true WHERE id="+recovery.quoted_id(old['id']))
            result['scrubbed']+=1
        elif old==latest:
            result['matched']+=1
        for recipient in old['recipients']:
            fact=opened.get(recipient['id'])
            if fact is not None and fact['batch_id']==old['id'] and fact['recipient_id']==recipient['recipient_id']:
                sql('UPDATE publication_forward_receipts SET opened_at='+recovery.literal(fact['opened_at'])+'::timestamptz WHERE id='+recovery.quoted_id(recipient['id']))
                result['openedFacts']+=1
    return result


def departures(sql,current_sql):
    if not recovery.has_table(sql,'departure_executions'):
        return {'executions':0,'exportGrants':0}
    rows=lambda db,query:recovery.json_rows(db,query)
    tenants={x['id'] for x in rows(sql,'SELECT id::text FROM tenants')}
    accounts={x['id'] for x in rows(sql,'SELECT id::text FROM accounts')}
    memberships={(x['tenant_id'],x['account_id']) for x in rows(sql,'SELECT tenant_id::text,account_id::text FROM tenant_memberships')}
    spaces={(x['tenant_id'],x['id']) for x in rows(sql,'SELECT tenant_id::text,id::text FROM workspaces')}
    executions=[x for x in rows(current_sql,'SELECT * FROM departure_executions') if x['tenant_id'] in tenants]
    for row in executions:
        if row['requested_by'] not in accounts or row['target_account_id'] is not None and row['target_account_id'] not in accounts:
            backup.fail('当前离职/退出守卫引用快照中缺失的身份；保持隔离，不伪造负责人或撤权事实。')
    # Release only an explicitly cancelled current execution before inserting a successor for the same scope.
    executions.sort(key=lambda row:row['state']!='CANCELLED')
    known={row['id'] for row in executions}
    for row in executions:
        sql('INSERT INTO departure_executions('+','.join(row)+') VALUES('+values(row)+') ON CONFLICT(id) DO UPDATE SET '+','.join(k+'=EXCLUDED.'+k for k in row if k!='id'))
    sql('DELETE FROM departure_export_grants')
    result={'executions':len(executions),'exportGrants':0}
    for row in rows(current_sql,"SELECT g.* FROM departure_export_grants g JOIN departure_executions e ON e.id=g.execution_id WHERE e.state='EXPORT_WINDOW' AND e.deadline>now()"):
        if row['execution_id'] in known and (row['tenant_id'],row['account_id']) in memberships and (row['tenant_id'],row['workspace_id']) in spaces:
            sql('INSERT INTO departure_export_grants('+','.join(row)+') VALUES('+values(row)+')')
            result['exportGrants']+=1
    for row in rows(current_sql,'SELECT * FROM departure_events'):
        if row['execution_id'] not in known:continue
        if row['actor_id'] is not None and row['actor_id'] not in accounts:
            backup.fail('当前退出事件身份无法可靠关联，保持隔离。')
        sql('INSERT INTO departure_events('+','.join(row)+') VALUES('+values(row)+') ON CONFLICT DO NOTHING')
    for row in rows(current_sql,'SELECT * FROM departure_materials'):
        if row['execution_id'] not in known:continue
        sql('INSERT INTO departure_materials('+','.join(row)+') VALUES('+values(row)+') ON CONFLICT(execution_id,object_kind,object_id) DO UPDATE SET '+','.join(k+'=EXCLUDED.'+k for k in row if k not in ('execution_id','object_kind','object_id')))
    # Handover is audit evidence, not a command to transfer owners or source credentials during restore.
    for row in rows(current_sql,'SELECT * FROM departure_handovers'):
        if (row['tenant_id'],row['workspace_id']) not in spaces:continue
        if any(row[k] not in accounts for k in ('from_account_id','to_account_id','actor_id')):
            continue
        sql('INSERT INTO departure_handovers('+','.join(row)+') VALUES('+values(row)+') ON CONFLICT DO NOTHING')
    return result


def residual(sql,current_sql):
    """Mirror the confirmed deadline-only DepartureResidualCleanup scope before reopening the API."""
    if not recovery.has_table(sql,'departure_executions'):return {'scopes':0,'rows':0}
    tenants={x['id'] for x in recovery.json_rows(sql,'SELECT id::text FROM tenants')}
    current=recovery.json_rows(current_sql,"SELECT tenant_id::text,target_account_id::text FROM departure_executions WHERE state IN('CLEANING','COMPLETE') AND stop_complete AND deadline<=clock_timestamp()")
    result={'scopes':0,'rows':0}
    removed="内容已按退出期限清理"
    for execution in current:
        tenant,owner=execution['tenant_id'],execution['target_account_id']
        if tenant not in tenants:continue
        t,a=recovery.literal(tenant),recovery.literal(owner)
        def private(alias,column):return alias+'.tenant_id='+t+('' if owner is None else ' AND '+alias+'.'+column+'='+a)
        def workspace(alias):return alias+'.tenant_id='+t+('' if owner is None else " AND EXISTS(SELECT 1 FROM workspaces w WHERE w.id="+alias+".workspace_id AND w.tenant_id="+alias+".tenant_id AND w.kind='PERSONAL' AND w.owner_id="+a+')')
        def update(table,assignment,condition):
            while True:
                n=int(sql('WITH changed AS(UPDATE '+table+' SET '+assignment+' WHERE ctid IN(SELECT x.ctid FROM '+table+' x WHERE '+condition+' LIMIT 100) RETURNING 1) SELECT count(*) FROM changed'))
                result['rows']+=n
                if n==0:break
        if recovery.has_table(sql,'task_plan_checks'):
            while True:
                n=int(sql('SELECT scrub_task_work_scope('+t+'::uuid,'+a+'::uuid)'))
                result['rows']+=n
                if n==0:break
        if recovery.has_table(sql,'publication_forward_batches'):
            while True:
                n=int(sql('SELECT scrub_forwarding_scope('+t+'::uuid,'+a+'::uuid)'))
                result['rows']+=n
                if n==0:break
        profile="EXISTS(SELECT 1 FROM profile_entries e WHERE e.id=x.entry_id AND e.tenant_id="+t+('' if owner is None else " AND coalesce(e.account_id,(SELECT w.owner_id FROM workspaces w WHERE w.id=e.workspace_id AND w.tenant_id=e.tenant_id AND w.kind='PERSONAL'))="+a)+')'
        update('profile_versions',"value='',provenance='',status='WITHDRAWN'",profile+" AND (x.value<>'' OR x.provenance<>'' OR x.status<>'WITHDRAWN')")
        update('profile_entries',"entry_key='removed-'||id::text","x.tenant_id="+t+('' if owner is None else " AND coalesce(x.account_id,(SELECT w.owner_id FROM workspaces w WHERE w.id=x.workspace_id AND w.tenant_id=x.tenant_id AND w.kind='PERSONAL'))="+a)+" AND x.entry_key<>'removed-'||x.id::text")
        update('ongoing_plans',"goal='"+removed+"',purpose='',query='',status='STOPPED',runtime_state='IDLE',notify=false,retry_requested=false,next_due=NULL",private('x','owner_id')+" AND (x.goal<>'"+removed+"' OR x.purpose<>'' OR x.query<>'' OR x.status<>'STOPPED' OR x.notify OR x.retry_requested OR x.next_due IS NOT NULL)")
        plans='EXISTS(SELECT 1 FROM ongoing_plans p WHERE p.id=x.plan_id AND '+private('p','owner_id')+')'
        update('ongoing_plan_versions',"configuration=configuration||jsonb_build_object('goal','"+removed+"','purpose','','query','')",plans+" AND (x.configuration->>'goal' IS DISTINCT FROM '"+removed+"' OR x.configuration->>'purpose' IS DISTINCT FROM '' OR x.configuration->>'query' IS DISTINCT FROM '')")
        receipts='EXISTS(SELECT 1 FROM identity_requests r JOIN ongoing_plans p ON p.id=r.target_id WHERE r.actor_id=x.actor_id AND r.request_id=x.request_id AND '+private('p','owner_id')+')'
        update('ongoing_plan_receipts',"receipt=jsonb_set(receipt,'{configuration}',coalesce(receipt->'configuration','{}'::jsonb)||jsonb_build_object('goal','"+removed+"','purpose','','query',''))",receipts+" AND (x.receipt#>>'{configuration,goal}' IS DISTINCT FROM '"+removed+"' OR x.receipt#>>'{configuration,purpose}' IS DISTINCT FROM '' OR x.receipt#>>'{configuration,query}' IS DISTINCT FROM '')")
        update('business_sources',"name='"+removed+"',description='',status='PAUSED'",workspace('x')+" AND (x.name<>'"+removed+"' OR x.description<>'' OR x.status<>'PAUSED')")
        update('business_source_config_versions',"settings=settings||jsonb_build_object('name','"+removed+"','description','')",'EXISTS(SELECT 1 FROM business_sources b WHERE b.id=x.source_id AND '+workspace('b')+") AND (x.settings->>'name' IS DISTINCT FROM '"+removed+"' OR x.settings->>'description' IS DISTINCT FROM '')")
        update('business_source_submissions',"note=''",workspace('x')+" AND x.note<>''")
        update('conversations',"title='"+removed+"'",private('x','owner_id')+" AND x.title<>'"+removed+"'")
        update('conversation_tasks','public_query=NULL',private('x','requested_by')+' AND x.public_query IS NOT NULL')
        update('knowledge_runs',"warnings=''",workspace('x')+" AND x.warnings<>''")
        update('document_publications',"filename='removed'",workspace('x')+" AND x.filename<>'removed'")
        update('recommendation_presentations',"presentation='{}'::jsonb",private('x','actor_id')+" AND x.presentation<>'{}'::jsonb")
        update('recommendation_settings','enabled=false',private('x','actor_id')+' AND x.enabled')
        update('recommendation_receipts',"receipt=jsonb_set(receipt,'{enabled}','false'::jsonb)",'EXISTS(SELECT 1 FROM identity_requests r WHERE r.actor_id=x.actor_id AND r.request_id=x.request_id AND r.target_id='+t+('' if owner is None else ' AND r.actor_id='+a)+") AND x.receipt->>'enabled'='true'")
        update('evaluation_issues',"title='内容已清理',impact='',next_action='',scrubbed=true",workspace('x')+" AND (NOT x.scrubbed OR x.title<>'内容已清理' OR x.impact<>'' OR x.next_action<>'')")
        update('evaluation_issue_events',"note=''",'EXISTS(SELECT 1 FROM evaluation_issues i WHERE i.id=x.issue_id AND '+workspace('i')+") AND x.note<>''")
        # quarantine already physically removed every old temporary export chunk and sensitive manifest field.
        result['scopes']+=1
    return result
