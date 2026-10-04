"""Offline collected-data recovery. Deployment credentials/executables are never copied here."""
import backup


def stop_pending(sql):
    import backup_recovery as recovery
    if not recovery.has_table(sql, 'data_connections'):
        return
    sql("""BEGIN;
    UPDATE collection_runs SET status='INTERRUPTED',reason='RECOVERY_QUARANTINE',finished_at=now(),lease_token=NULL,lease_until=NULL
      WHERE status IN ('QUEUED','RUNNING');
    UPDATE collection_runs SET lease_token=NULL,lease_until=NULL;
    UPDATE data_connections SET auto_enabled=false,next_due=NULL,execution_epoch=execution_epoch+1,revision=revision+1,updated_at=now();
    INSERT INTO task_dataset_fences(task_id,attempt_number,reason)
      SELECT DISTINCT r.task_id,r.attempt_number,'RECOVERY_QUARANTINE'
      FROM task_dataset_reads r JOIN conversation_tasks t ON t.id=r.task_id AND t.attempt=r.attempt_number
      WHERE t.status IN ('QUEUED','RUNNING','WAITING_INPUT','WAITING_CAPABILITY','PARTIAL','PAUSED')
      ON CONFLICT DO NOTHING;
    COMMIT;""")


def synchronize(sql, current_sql):
    """Keep exact snapshot data, apply current deployment controls, never restart collection."""
    import backup_recovery as recovery
    import backup_experience
    if not recovery.has_table(sql, 'data_connections'):
        return {}
    sql = backup_experience.isolated_sql(sql)
    rows, literal, uid = recovery.json_rows, recovery.literal, recovery.quoted_id
    def keyed(db, table, projection='*'):
        return {row['id']:row for row in rows(db, 'SELECT '+projection+' FROM '+table)}
    def same(old, latest, ignored=()):
        if latest is None or {k:v for k,v in old.items() if k not in ignored}!={k:v for k,v in latest.items() if k not in ignored}:
            backup.fail('恢复采集数据的固定快照、权限范围或执行依据不一致；保持隔离，不改写原数据。')
    connections, current_connections = (keyed(db,'data_connections') for db in (sql,current_sql))
    datasets, current_datasets = (keyed(db,'business_datasets') for db in (sql,current_sql))
    projection = "id,tenant_id,connection_id,dataset_id,run_id,version,row_count,coverage_through,collected_at,scrubbed,encode(sha256(convert_to(data_rows::text,'UTF8')),'hex') rows_hash"
    snapshots, current_snapshots = (keyed(db,'dataset_snapshots',projection) for db in (sql,current_sql))
    runs, current_runs = (keyed(db,'collection_runs') for db in (sql,current_sql))
    for identity, old in connections.items():
        same(old,current_connections.get(identity),('name','route_label','access_summary','status','auto_enabled','frequency','daily_time','time_zone','next_due','revision','execution_epoch','updated_at'))
    for identity, old in datasets.items():
        latest = current_datasets.get(identity)
        removed = old['scrubbed'] or latest is not None and latest['scrubbed']
        ignored = ('name','description','status','current_snapshot') + (('scrubbed','dataset_key','column_names') if removed else ())
        same(old,latest,ignored)
        head = latest['current_snapshot']
        if head is not None:
            if current_snapshots.get(head,{}).get('dataset_id')!=identity:
                backup.fail('恢复采集数据的当前快照不属于原数据集；保持隔离。')
    for identity, old in snapshots.items():
        latest = current_snapshots.get(identity)
        removed = old['scrubbed'] or latest is not None and latest['scrubbed']
        same(old,latest,('scrubbed','rows_hash') if removed else ())
    for identity, old in runs.items():
        same(old,current_runs.get(identity),('status','reason','lease_token','lease_until','started_at','finished_at'))
        # A terminal successful snapshot run cannot silently lose its authoritative success receipt.
        if old['status']=='SUCCEEDED' and current_runs[identity]['status']!='SUCCEEDED':
            backup.fail('恢复采集数据的成功回执已变化；保持隔离。')
    completed = {r['id'] for r in rows(sql,"SELECT id FROM conversation_tasks WHERE status='SUCCEEDED'")}
    for table, key, ignored in (
        ('task_dataset_reads',('task_id','attempt_number','dataset_id'),()),
        ('dataset_task_inheritance',('task_id','source_task_id'),()),
        ('briefing_dataset_selections',('task_id','dataset_id'),('invalidated',)),
    ):
        latest = {tuple(r[k] for k in key):r for r in rows(current_sql,'SELECT * FROM '+table)}
        retained = rows(sql,'SELECT * FROM '+table)
        # A completed retained result must not lose a dependency added in the authority.
        # Unfinished attempts can have progressed after the backup; they remain interrupted.
        if {tuple(r[k] for k in key) for r in retained if r['task_id'] in completed} != {k for k,r in latest.items() if r['task_id'] in completed}:
            backup.fail('恢复采集数据的已完成任务依赖集合不一致；保持隔离。')
        for old in retained:
            same(old,latest.get(tuple(old[k] for k in key)),ignored)

    result = {'retainedSnapshots':len(snapshots),'scrubbedSnapshots':0,'datasets':len(datasets),
              'connections':len(connections),'unavailableHeads':0,'currentFences':0,'invalidatedSelections':0}
    statements = ['BEGIN']
    # Snapshot tombstones run first: their ordinary triggers erase source-bound derived content.
    for identity, old in snapshots.items():
        if current_snapshots[identity]['scrubbed'] and not old['scrubbed']:
            statements.append(f"UPDATE dataset_snapshots SET data_rows='[]'::jsonb,scrubbed=true WHERE id={uid(identity)}")
            result['scrubbedSnapshots']+=1
    for identity, old in datasets.items():
        latest = current_datasets[identity]
        if old['scrubbed']:
            continue  # The deployment guard forbids restoring or rewriting an erased dataset.
        if latest['scrubbed']:
            statements.append(f"UPDATE business_datasets SET name='内容已按退出期限清理',description='',dataset_key='removed-'||id::text,column_names='[\"已清理\"]'::jsonb,status='WITHDRAWN',scrubbed=true WHERE id={uid(identity)}")
            continue
        head = latest['current_snapshot']
        if head is not None and (head not in snapshots or snapshots[head]['scrubbed'] or current_snapshots[head]['scrubbed']):
            head = None
            result['unavailableHeads']+=1
        statements.append(f"UPDATE business_datasets SET name={literal(latest['name'])},description={literal(latest['description'])},status={literal(latest['status'])},current_snapshot={literal(head)}::uuid WHERE id={uid(identity)}")
    # Restored runtime capabilities are projected by the live adapter; only deployment labels/settings
    # are synchronized. Operators must deliberately enable a new schedule, with a fresh revision.
    for identity, old in connections.items():
        latest = current_connections[identity]
        settings = ','.join(k+'='+literal(latest[k]) for k in ('name','route_label','access_summary','status','frequency','daily_time','time_zone'))
        statements.append(f"UPDATE data_connections SET {settings},auto_enabled=false,next_due=NULL,updated_at=now() WHERE id={uid(identity)}")
        # A status transition has its own BEFORE trigger which assigns OLD.epoch+1.
        # Advance beyond both databases only after that trigger has run.
        statements.append(f"UPDATE data_connections SET revision=greatest(revision,{int(latest['revision'])})+1,execution_epoch=greatest(execution_epoch,{int(latest['execution_epoch'])})+1 WHERE id={uid(identity)}")
    attempts = {(r['task_id'],r['attempt_number']) for r in rows(sql,'SELECT task_id,attempt_number FROM conversation_attempts')}
    for row in rows(current_sql,'SELECT * FROM task_dataset_fences'):
        if (row['task_id'],row['attempt_number']) in attempts:
            statements.append('INSERT INTO task_dataset_fences('+','.join(row)+') VALUES('+','.join(literal(v) for v in row.values())+') ON CONFLICT DO NOTHING')
            result['currentFences']+=1
    selections = {(r['task_id'],r['dataset_id']) for r in rows(sql,'SELECT task_id,dataset_id FROM briefing_dataset_selections')}
    for row in rows(current_sql,'SELECT * FROM briefing_dataset_selections WHERE invalidated'):
        if (row['task_id'],row['dataset_id']) in selections:
            statements.append(f"UPDATE briefing_dataset_selections SET invalidated=true WHERE task_id={uid(row['task_id'])} AND dataset_id={uid(row['dataset_id'])}")
            result['invalidatedSelections']+=1
    statements.append('COMMIT')
    sql(';\n'.join(statements)+';')
    return result
