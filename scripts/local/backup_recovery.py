"""Offline current-state reconciliation and explicitly authorized local activation."""
import hashlib
import json
from pathlib import Path
import uuid
import backup
import trial

COVERAGE = trial.WORKSPACE / 'contracts/local-backup/coverage.json'
CONTROL_TABLES = [
    'accounts', 'platform_roles', 'tenants', 'tenant_memberships', 'workspace_members', 'workspaces',
    'tenant_governance', 'governance_initial_designations', 'governance_capabilities', 'governance_handovers', 'governance_security_stops',
    'profile_entries', 'profile_versions', 'business_sources', 'business_source_config_versions',
    'experience_entries', 'experience_versions', 'ongoing_plans', 'ongoing_plan_versions', 'content_lifecycle',
    'evaluation_assets', 'evaluation_asset_versions', 'evaluation_issues', 'method_families', 'method_versions',
    'method_releases', 'method_adoptions', 'recommendation_settings',
    'retention_policy_versions', 'retention_cases', 'retention_case_versions', 'retention_case_scopes',
    'object_lifecycle', 'object_lifecycle_scopes', 'object_lifecycle_scope_items', 'operation_retention_windows',
    'departure_executions', 'departure_export_grants', 'departure_materials',
    'feedback_entries', 'feedback_versions', 'feedback_source_versions',
    'task_plan_checks', 'task_preference_saves', 'conversation_plan_commands', 'publication_preferences',
    'briefing_layouts', 'briefing_layout_moves', 'briefing_card_preferences', 'briefing_card_moves', 'briefing_generation_policies',
    'feedback_adjustment_threads', 'feedback_adjustment_messages', 'adjustment_task_dependencies',
    'publication_forward_batches', 'publication_forward_receipts',
]


# This Java cleanup has no SQL migration; changing its scope/fields requires reviewing the offline mirror.
IMPLEMENTATIONS = ('apps/api/src/main/java/com/dreamcore/workspace/departure/DepartureResidualCleanup.java',)

def implementation_hashes():
    return {name:hashlib.sha256((trial.WORKSPACE/name).read_bytes()).hexdigest() for name in IMPLEMENTATIONS}


def catalog_hash(sql):
    # Exclude Flyway's own implementation table, whose metadata differs from the synthetic fixture.
    return sql("""COPY (SELECT kind,name,definition FROM (
      SELECT 'column' kind,c.relname||'.'||a.attname name,
        a.attnum::text||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'') definition
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
        LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
        WHERE n.nspname='public' AND c.relkind IN('r','p','v','m') AND c.relname<>'flyway_schema_history' AND a.attnum>0 AND NOT a.attisdropped
      UNION ALL SELECT 'constraint',c.relname||'.'||x.conname,pg_get_constraintdef(x.oid)||':'||x.convalidated::text
        FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname<>'flyway_schema_history'
      UNION ALL SELECT 'view',c.relname,pg_get_viewdef(c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('v','m')
      UNION ALL SELECT 'function',p.proname||':'||pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN('f','p')
      UNION ALL SELECT 'trigger',c.relname||'.'||t.tgname,pg_get_triggerdef(t.oid)||':'||t.tgenabled::text FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
      UNION ALL SELECT 'index',indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename<>'flyway_schema_history'
    ) metadata ORDER BY kind,name,definition) TO STDOUT""", True)


def coverage(sql):
    expected = json.loads(COVERAGE.read_text())
    if expected.get('implementationHashes')!=implementation_hashes():
        backup.fail('当前正文清理实现尚未核对恢复适配；保持隔离，不能仅凭相同迁移版本开放。')
    backup.check_migrations(sql)
    if expected['migrations'] != backup.migrations():
        backup.fail('当前迁移未全部纳入恢复控制对象清单；保持隔离，不自动忽略新增模块。')
    tables = sql("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").splitlines()
    if tables != expected['tables']:
        backup.fail('数据库存在未纳入恢复清单的表或缺少已知表；保持隔离。')
    # PostgreSQL 18 deparses a few equivalent CHECK/index expressions differently after pg_restore.
    # Both fingerprints are from clean migration/dump/restore fixtures, never learned from user databases.
    if catalog_hash(sql) not in expected['catalogHashes']:
        backup.fail('数据库列、约束、视图或执行函数不在已核验结构内；保持隔离。')
    return hashlib.sha256(backup.canonical(expected)).hexdigest()


def quarantine(sql):
    # This executes in the private, offline database before any application can start.
    # A stopped worker is not evidence that an external side effect failed or succeeded.
    sql("""BEGIN;
    DELETE FROM spring_session_attributes; DELETE FROM spring_session; DELETE FROM phone_challenges;
    UPDATE invitations SET status='REVOKED' WHERE status='PENDING';
    UPDATE governance_handovers SET status='CANCELLED' WHERE status='PENDING';
    UPDATE accounts SET status='DISABLED',password_hash='!RECOVERY_DISABLED!',credential_version=credential_version+1;
    UPDATE tenants SET status='SUSPENDED';
    UPDATE tenant_memberships SET status='DISABLED',role='MEMBER';
    DELETE FROM platform_roles; DELETE FROM governance_capabilities; DELETE FROM workspace_members;
    DELETE FROM governance_initial_designations;
    UPDATE tenant_governance SET owner_id=NULL;
    UPDATE profile_versions SET status='WITHDRAWN' WHERE status IN ('ACTIVE','PROPOSED');
    UPDATE business_sources SET status='PAUSED';
    UPDATE business_source_submissions SET status='WITHDRAWN';
    UPDATE experience_entries SET status='WITHDRAWN',published_version=NULL WHERE status='PUBLISHED';
    UPDATE ongoing_plans SET status='PAUSED',execution_epoch=execution_epoch+1,next_due=NULL,
      retry_requested=false,runtime_state='NEEDS_ATTENTION',reason='RECOVERY_QUARANTINE'
      WHERE status NOT IN ('STOPPED','EXPIRED');
    UPDATE ongoing_plan_runs SET status='INTERRUPTED',error_code='RECOVERY_QUARANTINE',finished_at=now()
      WHERE status IN ('QUEUED','RUNNING');
    UPDATE briefing_generation_policies SET enabled=false,epoch=epoch+1,revision=revision+1,reason='RECOVERY_QUARANTINE';
    UPDATE briefing_generation_batches SET status='CANCELLED',reason='RECOVERY_QUARANTINE',finished_at=now()
      WHERE status IN ('QUEUED','RUNNING','WAITING_DATA','WAITING_RESOURCE','WAITING_CAPABILITY');
    DELETE FROM briefing_reading_snapshots;
    UPDATE conversation_tasks SET reconciliation_required=reconciliation_required OR status='RUNNING',
      status=CASE WHEN status='RUNNING' THEN 'RESULT_UNKNOWN' ELSE 'PAUSED' END,
      lease_token=NULL,lease_until=NULL,wait_reason='RECOVERY_QUARANTINE',revision=revision+1
      WHERE status IN ('QUEUED','RUNNING','WAITING_INPUT','WAITING_CAPABILITY','PARTIAL','PAUSED');
    UPDATE conversation_tasks SET lease_token=NULL,lease_until=NULL;
    UPDATE conversation_attempts SET status='RESULT_UNKNOWN',finished_at=now() WHERE status='RUNNING';
    UPDATE agent_attempt_usage SET status='RESULT_UNKNOWN',finished_at=now(),receipt_until=now() WHERE status='RUNNING';
    UPDATE knowledge_runs SET status='CANCELLED',lease_token=NULL,lease_until=NULL,finished_at=now()
      WHERE status IN ('QUEUED','RUNNING');
    UPDATE content_cleanup_jobs SET state='FAILED',lease_token=NULL,lease_until=NULL,error_code='RECOVERY_QUARANTINE'
      WHERE state IN ('QUEUED','CLEANING');
    COMMIT;""")
    if has_table(sql,'task_plan_checks'):
        # Explicit even for an already stopped plan: no old accepted check is executable after restore.
        sql("UPDATE task_plan_checks SET state='CANCELLED' WHERE state='PENDING'")
    if has_table(sql, 'export_batches'):
        sql("""BEGIN;
        UPDATE export_batches b SET removed_bytes=removed_bytes+(SELECT coalesce(sum(octet_length(content)),0) FROM export_archive_chunks c WHERE c.batch_id=b.id),
          state=CASE WHEN state IN('EXPIRED','REVOKED','REMOVED') THEN state ELSE 'REVOKED' END,
          lease_token=NULL,lease_until=NULL,cleanup_state='COMPLETE',cleanup_reason='RECOVERY',
          cleaned_at=coalesce(cleaned_at,now()),error_code='EXPORT_RECOVERY_DISABLED';
        DELETE FROM export_archive_chunks;
        UPDATE export_batch_items SET title=NULL,archive_path=NULL,sha256=NULL,
          state=CASE WHEN state IN('PENDING','WRITING') THEN 'FAILED' ELSE state END,error_code='EXPORT_RECOVERY_DISABLED';
        COMMIT;""")
    if has_table(sql, 'method_adoptions'):
        sql("UPDATE method_adoptions SET status='STOPPED'; UPDATE method_families SET published_version=NULL")
    if has_table(sql, 'evaluation_assets'):
        sql("UPDATE evaluation_assets SET status='WITHDRAWN'")
    if has_table(sql, 'recommendation_settings'):
        sql('UPDATE recommendation_settings SET enabled=false')
    if has_table(sql,'departure_archive_chunks'):
        sql("""BEGIN;
        UPDATE departure_export_parts p SET removed_bytes=removed_bytes+(SELECT coalesce(sum(octet_length(content)),0) FROM departure_archive_chunks c WHERE c.part_id=p.id),
          state='REVOKED',lease_token=NULL,lease_until=NULL,cleanup_state='COMPLETE',cleaned_at=coalesce(cleaned_at,now()),error_code='EXPORT_RECOVERY_DISABLED';
        DELETE FROM departure_archive_chunks;
        UPDATE departure_export_sets SET state='REVOKED';
        UPDATE departure_export_items SET filename=NULL,sha256=NULL,state='FAILED',error_code='EXPORT_RECOVERY_DISABLED';
        DELETE FROM departure_export_grants;
        COMMIT;""")


def json_rows(sql, query):
    raw = sql("SELECT coalesce(json_agg(x),'[]'::json)::text FROM (" + query + ") x")
    if len(raw.encode()) > 8 * 1024**2:
        backup.fail('当前状态证据超过本地恢复上限；保持隔离，不截断证据。')
    return json.loads(raw)


def has_table(sql, table):
    return sql("SELECT to_regclass('public." + table + "') IS NOT NULL") == 't'


def current_evidence(sql):
    hashes = {}
    for table in CONTROL_TABLES:
        if not has_table(sql, table):
            continue
        hashes[table] = {'rows': int(sql(f'SELECT count(*) FROM {table}')),
                        'sha256': sql(f'COPY (SELECT to_jsonb(t)::text FROM {table} t ORDER BY to_jsonb(t)::text) TO STDOUT', True)}
    # No business bodies or old credential hashes are written to evidence files.
    result = {'capturedAt': backup.now().isoformat(), 'transaction': int(sql('SELECT txid_current()')),
            'controls': hashes,
            'materials': json_rows(sql, """SELECT m.id::text,coalesce(l.state,'ACTIVE') AS state,
                EXISTS(WITH RECURSIVE parents AS (
                    SELECT id,parent_id FROM material_folders WHERE id=m.folder_id
                    UNION SELECT f.id,f.parent_id FROM material_folders f JOIN parents p ON f.id=p.parent_id)
                    SELECT 1 FROM parents p JOIN content_lifecycle a ON a.object_kind='FOLDER' AND a.object_id=p.id WHERE a.state IN('PURGING','PURGED')) AS ancestor_deleted,
                EXISTS(SELECT 1 FROM active_materials a WHERE a.id=m.id) AS active
                FROM materials m LEFT JOIN content_lifecycle l ON l.object_kind='MATERIAL' AND l.object_id=m.id"""),
            'lifecycle': json_rows(sql, 'SELECT * FROM content_lifecycle'),
            'folders': json_rows(sql, 'SELECT id::text FROM material_folders'),
            'versions': json_rows(sql, "SELECT id::text,material_id::text,object_id::text,tenant_id::text,workspace_id::text,sha256,size_bytes FROM material_versions"),
            'deletedObjects': json_rows(sql, "SELECT DISTINCT object_id::text FROM content_cleanup_blobs WHERE deleted_at IS NOT NULL"),
            'scrubbedExperiences': json_rows(sql, "SELECT id::text FROM experience_versions WHERE scrubbed"),
            'scrubbedFeedback': json_rows(sql, "SELECT id::text FROM feedback_entries WHERE scrubbed")}

    if has_table(sql, 'evaluation_asset_versions'):
        result['scrubbedEvaluations'] = json_rows(sql, 'SELECT id::text FROM evaluation_asset_versions WHERE scrubbed')
    return result


def quoted_id(value):
    return "'" + str(uuid.UUID(value)) + "'::uuid"


def purge_material(sql, material):
    target = quoted_id(material)
    extra = ''
    if has_table(sql, 'export_batches'):
        extra += f'SELECT scrub_export_material({target});'
    if has_table(sql, 'evaluation_assets'):
        extra += f'SELECT scrub_evaluation_material({target}); SELECT scrub_evaluation_task(task_id) FROM recovery_tasks;'
    if has_table(sql, 'feedback_adjustment_messages'):
        extra += f'SELECT scrub_adjustment_material({target});'
    if has_table(sql, 'publication_forward_batches'):
        extra += f'SELECT scrub_forwarding_material_version(id) FROM material_versions WHERE material_id={target};'
    # Include grants that influenced a response without being cited, all attempts and indirect reads.
    sql(f"""BEGIN;
    CREATE TEMP TABLE recovery_tasks ON COMMIT DROP AS
      SELECT task_id FROM conversation_sources s JOIN knowledge_chunks c ON c.id=s.chunk_id WHERE c.material_id={target}
      UNION SELECT task_id FROM conversation_originals WHERE material_id={target}
      UNION SELECT task_id FROM conversation_agent_grants g JOIN knowledge_chunks c ON c.id=g.chunk_id WHERE c.material_id={target}
      UNION SELECT task_id FROM feedback_task_sources s JOIN material_versions v ON v.id=s.version_id WHERE v.material_id={target}
      UNION SELECT task_id FROM task_context_materials s JOIN material_versions v ON v.id=s.version_id WHERE v.material_id={target};
    SELECT scrub_experience_material({target}); SELECT scrub_feedback_material({target}); SELECT scrub_task_context_material({target});
    {extra}
    UPDATE experience_versions v SET content='{{}}',search_terms='{{}}',tags='{{}}',scrubbed=true
      WHERE access_mode='SOURCE_BOUND' AND EXISTS(SELECT 1 FROM experience_evidence e JOIN recovery_tasks t ON t.task_id=e.task_id WHERE e.version_id=v.id);
    UPDATE experience_uses SET conditions='',adjustments='',context_key='purged:'||id::text
      WHERE task_id IN(SELECT task_id FROM recovery_tasks) OR version_id IN(SELECT id FROM experience_versions WHERE scrubbed);
    UPDATE experience_feedback SET note='' WHERE use_id IN(SELECT id FROM experience_uses WHERE task_id IN(SELECT task_id FROM recovery_tasks) OR version_id IN(SELECT id FROM experience_versions WHERE scrubbed));
    UPDATE conversation_tasks SET prompt='内容已按来源生命周期清理',supplemental_input='',reply=NULL,
      required_input=NULL,public_query=NULL,web_sources='[]',skills='[]',error_code='SOURCE_REMOVED',lease_token=NULL,lease_until=NULL
      WHERE id IN(SELECT task_id FROM recovery_tasks);
    UPDATE conversations SET title='来源内容已清理' WHERE id IN(SELECT conversation_id FROM conversation_tasks WHERE id IN(SELECT task_id FROM recovery_tasks));
    UPDATE conversation_attempts SET input='内容已按来源生命周期清理',snapshot='{{}}' WHERE task_id IN(SELECT task_id FROM recovery_tasks);
    UPDATE conversation_artifacts SET content=''::bytea,filename='removed',sha256='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' WHERE task_id IN(SELECT task_id FROM recovery_tasks);
    UPDATE private_document_versions SET title='内容已清理',body='' WHERE document_id IN(SELECT id FROM private_documents WHERE source_task_id IN(SELECT task_id FROM recovery_tasks));
    DELETE FROM private_document_exports WHERE document_id IN(SELECT id FROM private_documents WHERE source_task_id IN(SELECT task_id FROM recovery_tasks));
    UPDATE feedback_entries SET scrubbed=true,snapshot='{{}}' WHERE task_id IN(SELECT task_id FROM recovery_tasks) OR scrubbed;
    UPDATE feedback_versions SET assessment='{{}}' WHERE feedback_id IN(SELECT id FROM feedback_entries WHERE scrubbed);
    UPDATE feedback_actions SET receipt='{{}}' WHERE feedback_id IN(SELECT id FROM feedback_entries WHERE scrubbed);
    UPDATE task_context_reviews SET conditions='',adjustments='',scrubbed=true WHERE task_id IN(SELECT task_id FROM recovery_tasks);
    UPDATE knowledge_chunks SET content='',locator='REMOVED' WHERE material_id={target};
    UPDATE knowledge_runs SET warnings='' WHERE material_id={target};
    UPDATE material_versions SET filename='removed' WHERE material_id={target};
    UPDATE materials SET name='removed-'||id::text WHERE id={target};
    UPDATE business_source_submissions SET note='',status='WITHDRAWN' WHERE id IN(SELECT s.submission_id FROM business_source_versions s JOIN material_versions v ON v.id=s.version_id WHERE v.material_id={target});
    INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state)
      SELECT tenant_id,workspace_id,'MATERIAL',id,'PURGING' FROM materials WHERE id={target}
      ON CONFLICT(object_kind,object_id) DO UPDATE SET state='PURGING',changed_at=now();
    COMMIT;""")


def apply_current(sql, root, evidence):
    current = {row['id']: row for row in evidence['materials']}
    local = json_rows(sql, 'SELECT id::text FROM materials')
    purged, unavailable, files_removed = [], [], []
    deleted_objects = {row['object_id'] for row in evidence['deletedObjects']}
    current_versions = {row['id']: row for row in evidence['versions']}
    # Missing or rewritten immutable versions are not silently treated as the same safe content.
    mismatched = {row['material_id'] for row in json_rows(sql, 'SELECT id::text,material_id::text,object_id::text,tenant_id::text,workspace_id::text,sha256,size_bytes FROM material_versions')
                  if current_versions.get(row['id']) != row or row['object_id'] in deleted_objects}
    current_lifecycle = {(row['object_kind'], row['object_id']): row for row in evidence['lifecycle']}
    folders = {row['id'] for row in evidence['folders']}
    for row in json_rows(sql, 'SELECT * FROM content_lifecycle'):
        # Never re-create bytes that were already absent from the snapshot. Otherwise current lifecycle wins,
        # including an explicit restore in the authority; old purge deadlines must not delete it later.
        if row['state'] in ('PURGED', 'PURGING'):
            continue
        latest = current_lifecycle.get((row['object_kind'], row['object_id']))
        if latest:
            fields = ('state','revision','changed_by','changed_at','trashed_at','purge_after','purge_job_id')
            sql('UPDATE content_lifecycle SET '+','.join(k+'='+literal(latest[k]) for k in fields)+
                ' WHERE object_kind='+literal(row['object_kind'])+' AND object_id='+quoted_id(row['object_id']))
        elif ((row['object_kind']=='MATERIAL' and row['object_id'] in current) or (row['object_kind']=='FOLDER' and row['object_id'] in folders)):
            sql("UPDATE content_lifecycle SET state='ACTIVE',trashed_at=NULL,purge_after=NULL,purge_job_id=NULL WHERE object_kind="+literal(row['object_kind'])+' AND object_id='+quoted_id(row['object_id']))
    for row in json_rows(sql, 'SELECT id::text,tenant_id::text,workspace_id::text FROM material_folders'):
        latest = current_lifecycle.get(('FOLDER',row['id']))
        if (latest and latest['state']!='ACTIVE') or row['id'] not in folders:
            state = latest['state'] if latest else 'PURGED'
            sql('INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state,purge_after) VALUES('+','.join(literal(v) for v in (row['tenant_id'],row['workspace_id'],'FOLDER',row['id'],state,latest['purge_after'] if latest else None))+
                ') ON CONFLICT(object_kind,object_id) DO UPDATE SET state=EXCLUDED.state,purge_after=EXCLUDED.purge_after')
            if state=='PURGED':
                sql("UPDATE material_folders SET name='removed-'||id::text WHERE id="+quoted_id(row['id']))
    for material in local:
        identity = material['id']
        state = current.get(identity)
        if state is None or state['state'] in ('PURGING', 'PURGED') or state['ancestor_deleted'] or identity in mismatched:
            purge_material(sql, identity)
            for row in json_rows(sql, f'SELECT object_id::text FROM material_versions WHERE material_id={quoted_id(identity)}'):
                deleted_objects.add(row['object_id'])
            purged.append(identity)
        elif not state['active']:
            deadline = current_lifecycle.get(('MATERIAL',identity),{}).get('purge_after')
            sql(f"""INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state)
                SELECT tenant_id,workspace_id,'MATERIAL',id,'TRASHED' FROM materials WHERE id={quoted_id(identity)}
                ON CONFLICT(object_kind,object_id) DO UPDATE SET state='TRASHED',changed_at=now() WHERE content_lifecycle.state NOT IN ('PURGING','PURGED')""")
            if deadline is not None:
                sql('UPDATE content_lifecycle SET purge_after='+literal(deadline)+" WHERE object_kind='MATERIAL' AND object_id="+quoted_id(identity))
            unavailable.append(identity)
    # Preserve the current original trash anchor and the policy revision that actually decided it.
    # A later policy setting is not grounds to recalculate an existing object's deadline.
    for latest in current_lifecycle.values():
        fields=('revision','changed_by','changed_at','trashed_at','purge_after','purge_job_id','retention_policy_revision')
        sql('UPDATE content_lifecycle SET '+','.join(k+'='+literal(latest[k]) for k in fields if k in latest)+
            ' WHERE object_kind='+literal(latest['object_kind'])+' AND object_id='+quoted_id(latest['object_id'])+
            " AND state NOT IN ('PURGING','PURGED')")
    for value in sorted(deleted_objects):
        identity = str(uuid.UUID(value))
        path = root / 'objects' / (identity + '.blob')
        if path.exists() or path.is_symlink():
            backup.regular(path)
            path.unlink()
            files_removed.append(identity)
        sql(f"UPDATE content_cleanup_blobs SET deleted_at=coalesce(deleted_at,now()) WHERE object_id={quoted_id(identity)}")
    # Only report PURGED after every original was actually removed; failure remains isolated/PURGING.
    for identity in purged:
        sql(f"UPDATE content_lifecycle SET state='PURGED',changed_at=now() WHERE object_kind='MATERIAL' AND object_id={quoted_id(identity)}")
    for row in evidence['scrubbedExperiences']:
        sql(f"UPDATE experience_versions SET content='{{}}',search_terms='{{}}',tags='{{}}',scrubbed=true WHERE id={quoted_id(row['id'])}")
    for row in evidence['scrubbedFeedback']:
        identity = quoted_id(row['id'])
        sql(f"UPDATE feedback_entries SET scrubbed=true,snapshot='{{}}' WHERE id={identity}; UPDATE feedback_versions SET assessment='{{}}' WHERE feedback_id={identity}; UPDATE feedback_actions SET receipt='{{}}' WHERE feedback_id={identity}")
    for row in evidence.get('scrubbedEvaluations', []):
        sql(f"UPDATE evaluation_asset_versions SET scrubbed=true,content='{{}}' WHERE id={quoted_id(row['id'])}")
    sql("UPDATE experience_uses SET conditions='',adjustments='',context_key='purged:'||id::text WHERE version_id IN(SELECT id FROM experience_versions WHERE scrubbed); UPDATE experience_feedback SET note='' WHERE use_id IN(SELECT u.id FROM experience_uses u JOIN experience_versions v ON v.id=u.version_id WHERE v.scrubbed)")
    quarantine(sql)
    return {'purgedMaterials': purged, 'unavailableMaterials': unavailable, 'removedObjects': files_removed}


def reconcile(root, current_root, key_path):
    root, current_root = trial.directory(root), trial.directory(current_root)
    if root.resolve() == current_root.resolve():
        backup.fail('恢复副本不能核验自己。')
    key = backup.signing_key(key_path)
    record = backup.signed_read(root / 'restore.json', key)
    if record.get('state') not in ('QUARANTINED', 'CURRENT_STATE_CHECKED_QUARANTINED') or record.get('format') != backup.FORMAT:
        backup.fail('恢复隔离记录不兼容。')
    snapshot = record['snapshot']
    if record.get('recoveryDirectory') != str(root.resolve()):
        backup.fail('恢复记录不属于此目录。')
    if snapshot['schemaHash'] != backup.schema_hash() or snapshot['migrations'] != backup.migrations():
        backup.fail('快照与当前恢复适配器结构不一致；保持隔离。')
    with backup.owned_lock(current_root), backup.owned_lock(root):
        with backup.offline_database(current_root) as (_, __, current_sql):
            identity = backup.source_identity(current_root, key_path, current_sql)
            if identity['instanceId'] != snapshot['sourceInstanceId']:
                backup.fail('当前证据属于其他原实例；保持隔离。')
            coverage_hash = coverage(current_sql)
            evidence = current_evidence(current_sql)
            if evidence['transaction'] < snapshot['sourceTransaction']:
                backup.fail('权威数据库早于原快照；不能据此恢复权限或内容。')
            # Keep the original instance locked/offline throughout comparison and mutation.
            with backup.offline_database(root) as (_, __, sql):
                coverage(sql)
                applied = apply_current(sql, root, evidence)
                import backup_lifecycle
                applied['methodHeads']=backup_lifecycle.method_heads(sql,current_sql)
                applied['objects']=backup_lifecycle.objects(sql,current_sql)
                applied['versionBodies']=backup_lifecycle.version_bodies(sql,current_sql)
                applied['feedback']=backup_lifecycle.feedback(sql,current_sql)
                applied['taskWork']=backup_lifecycle.task_work(sql,current_sql)
                applied['adjustments']=backup_lifecycle.adjustments(sql,current_sql)
                applied['forwarding']=backup_lifecycle.forwarding(sql,current_sql)
                applied['operations']=backup_lifecycle.operations(sql,current_sql)
                applied['departures']=backup_lifecycle.departures(sql,current_sql)
                applied['residual']=backup_lifecycle.residual(sql,current_sql)
                closed = sql("SELECT (SELECT count(*) FROM accounts WHERE status='ACTIVE')+(SELECT count(*) FROM tenants WHERE status='ACTIVE')+(SELECT count(*) FROM platform_roles)+(SELECT count(*) FROM workspace_members)+(SELECT count(*) FROM governance_capabilities)+(SELECT count(*) FROM conversation_tasks WHERE status IN('QUEUED','RUNNING'))+(SELECT count(*) FROM ongoing_plans WHERE status='ACTIVE')+(SELECT count(*) FROM knowledge_runs WHERE status IN('QUEUED','RUNNING'))")
                if closed != '0':
                    backup.fail('恢复实例隔离检查失败；不得开放。')
            changed = [table for table, value in evidence['controls'].items() if snapshot['tables'].get(table) != value]
            report = {'format': backup.FORMAT, 'snapshotId': snapshot['snapshotId'], 'sourceInstanceId': identity['instanceId'],
                      'coverageHash': coverage_hash, 'checkedAt': backup.now().isoformat(), 'current': evidence,
                      'changedControlTables': changed, 'applied': applied, 'allAuthorizationClosed': True,
                      'automaticOldTaskExecutionEnabled': False, 'reopeningSupported': False}
            backup.signed_write(root / 'current-state-evidence.json', report, key)
            record.update({'state': 'CURRENT_STATE_CHECKED_QUARANTINED', 'checkedAt': report['checkedAt'],
                           'evidenceHash': hashlib.sha256(backup.canonical(report)).hexdigest()})
            backup.signed_write(root / 'restore.json', record, key)
    return {'status': 'current_state_checked_quarantined', 'changedControlTables': changed,
            'purgedMaterials': len(applied['purgedMaterials']), 'removedObjects': len(applied['removedObjects']),
            'reopeningSupported': False}


def literal(value):
    if value is None:
        return 'NULL'
    if type(value) is bool:
        return 'true' if value else 'false'
    return "'" + str(value).replace("'", "''") + "'"


def password_hash(password):
    # Must match identity/PasswordConfiguration.java; compatibility is tested separately.
    import secrets
    salt = secrets.token_bytes(16)
    encoded = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 600_000, 32)
    return '{pbkdf2-sha256-v1}' + (salt + encoded).hex()


def reopen_current(sql, current_sql, root):
    """Only current-authorized intersections are reopened; unsupported identities remain disabled."""
    import secrets
    accounts = {x['id']: x for x in json_rows(current_sql, "SELECT id::text,email,phone FROM accounts WHERE status='ACTIVE'")}
    local_accounts = json_rows(sql, 'SELECT id::text,email,phone FROM accounts')
    eligible = {x['id'] for x in local_accounts if x == accounts.get(x['id'])}
    current_spaces = {x['id']: x for x in json_rows(current_sql, 'SELECT id::text,tenant_id::text,owner_id::text,kind FROM workspaces')}
    local_spaces = json_rows(sql, 'SELECT id::text,tenant_id::text,owner_id::text,kind FROM workspaces')
    valid_spaces = {x['id'] for x in local_spaces if current_spaces.get(x['id']) == x}
    # Private ownership is itself a read grant. Do not leave an old private owner active after a changed/missing mapping.
    blocked_private_owners = {x['owner_id'] for x in local_spaces if x['kind'] == 'PERSONAL' and x['id'] not in valid_spaces}
    eligible -= blocked_private_owners
    tenant_versions = {x['id']:x['management_version'] for x in json_rows(current_sql, "SELECT id::text,management_version FROM tenants WHERE status='ACTIVE'")}
    current_tenants = set(tenant_versions)
    local_tenants = {x['id'] for x in json_rows(sql, 'SELECT id::text FROM tenants')}
    tenants = current_tenants & local_tenants
    held_tenants = retention_holds(sql, current_sql)
    tenants -= held_tenants
    members = {(x['tenant_id'], x['account_id']): x for x in json_rows(current_sql, "SELECT tenant_id::text,account_id::text,role,management_version FROM tenant_memberships WHERE status='ACTIVE'")
               if x['tenant_id'] in tenants and x['account_id'] in eligible}
    local_members = {(x['tenant_id'],x['account_id']) for x in json_rows(sql, 'SELECT tenant_id::text,account_id::text FROM tenant_memberships')}
    members = {key:value for key,value in members.items() if key in local_members}
    if has_table(current_sql,'departure_executions'):
        stopped_members={(x['tenant_id'],x['target_account_id']) for x in json_rows(current_sql,"SELECT tenant_id::text,target_account_id::text FROM departure_executions WHERE kind='MEMBER_OFFBOARD' AND state<>'CANCELLED'")}
        members={key:value for key,value in members.items() if key not in stopped_members}
    grants = [x for x in json_rows(current_sql, 'SELECT tenant_id::text,workspace_id::text,account_id::text,can_maintain FROM workspace_members')
              if (x['tenant_id'], x['account_id']) in members and x['workspace_id'] in valid_spaces]
    governance = json_rows(current_sql, 'SELECT tenant_id::text,owner_id::text,revision FROM tenant_governance')
    capabilities = json_rows(current_sql, 'SELECT id::text,tenant_id::text,account_id::text,workspace_id::text,capability,granted_by::text FROM governance_capabilities')
    grant_keys = {(x['tenant_id'], x['workspace_id'], x['account_id']) for x in grants}
    known_accounts = {x['id'] for x in local_accounts}
    credentials = []
    statements = ['BEGIN']
    departure_guards=has_table(sql,'departure_executions')
    if departure_guards:
        # Offline verified-current copy is not ordinary reactivation. Restore only already-current identities;
        # effective facts still gate all business/private access and limit the explicit export window.
        statements.append("DO $$ BEGIN IF (SELECT count(*) FROM pg_trigger WHERE (tgrelid='tenants'::regclass AND tgname='departure_tenant_activation' OR tgrelid='tenant_memberships'::regclass AND tgname='departure_member_activation') AND tgenabled='O')<>2 THEN RAISE EXCEPTION 'RESTORE_DEPARTURE_GUARDS_NOT_ENABLED'; END IF; END $$")
        statements += ['ALTER TABLE tenants DISABLE TRIGGER departure_tenant_activation',
                       'ALTER TABLE tenant_memberships DISABLE TRIGGER departure_member_activation']
    for identity in sorted(eligible):
        password = secrets.token_urlsafe(24)
        statements.append(f"UPDATE accounts SET status='ACTIVE',password_hash={literal(password_hash(password))},credential_version=credential_version+1 WHERE id={quoted_id(identity)}")
        credentials.append({'accountId': identity, 'email': accounts[identity]['email'], 'phone': accounts[identity]['phone'], 'password': password})
    for identity in sorted(tenants):
        statements.append(f"UPDATE tenants SET status='ACTIVE',management_version={int(tenant_versions[identity])} WHERE id={quoted_id(identity)}")
    for (tenant,account), row in members.items():
        statements.append(f"UPDATE tenant_memberships SET status='ACTIVE',role={literal(row['role'])},management_version={int(row['management_version'])} WHERE tenant_id={quoted_id(tenant)} AND account_id={quoted_id(account)}")
    for row in json_rows(current_sql,'SELECT id::text,management_version FROM workspaces'):
        if row['id'] in valid_spaces:
            statements.append(f"UPDATE workspaces SET management_version={int(row['management_version'])} WHERE id={quoted_id(row['id'])}")
    for row in grants:
        statements.append('INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES(' + ','.join(literal(row[k]) for k in ['tenant_id','workspace_id','account_id','can_maintain']) + ')')
    for row in governance:
        statements.append(f"UPDATE tenant_governance SET revision={int(row['revision'])} WHERE tenant_id={literal(row['tenant_id'])}")
        if (row['tenant_id'],row['owner_id']) in members:
            statements.append(f"UPDATE tenant_governance SET owner_id={literal(row['owner_id'])},revision={int(row['revision'])} WHERE tenant_id={literal(row['tenant_id'])}")
    local_invites={row['id']:row for row in json_rows(sql,"SELECT id::text,tenant_id::text,accepted_by::text FROM invitations WHERE status='ACCEPTED'")}
    current_invites={row['id']:row for row in json_rows(current_sql,"SELECT id::text,tenant_id::text,accepted_by::text FROM invitations WHERE status='ACCEPTED'")}
    for row in json_rows(current_sql,'SELECT * FROM governance_initial_designations'):
        invite=local_invites.get(row['invitation_id'])
        if (invite and invite==current_invites.get(invite['id']) and (row['tenant_id'],invite['accepted_by']) in members
                and row['designated_by'] in known_accounts):
            statements.append('INSERT INTO governance_initial_designations('+','.join(row)+') VALUES('+','.join(literal(v) for v in row.values())+')')
    for row in capabilities:
        if (row['tenant_id'],row['account_id']) in members and row['granted_by'] in known_accounts and (row['workspace_id'] is None or (row['tenant_id'],row['workspace_id'],row['account_id']) in grant_keys):
            fields = ['id','tenant_id','account_id','workspace_id','capability','granted_by']
            statements.append('INSERT INTO governance_capabilities('+','.join(fields)+') VALUES('+','.join(literal(row[k]) for k in fields)+')')
    current_platform = {x['account_id'] for x in json_rows(current_sql, 'SELECT account_id::text FROM platform_roles')}
    platform = current_platform & eligible
    for identity in sorted(platform):
        statements.append(f"INSERT INTO platform_roles VALUES({quoted_id(identity)},'PLATFORM_ADMIN')")
    if not platform:
        # An explicitly activated local recovery may bootstrap operations, never tenant membership or content rights.
        identity, password = str(uuid.uuid4()), secrets.token_urlsafe(24)
        email = 'recovery-' + identity + '@example.invalid'
        statements.append(f"INSERT INTO accounts(id,email,display_name,password_hash) VALUES({quoted_id(identity)},{literal(email)},'本地恢复平台管理员',{literal(password_hash(password))})")
        statements.append(f"INSERT INTO platform_roles VALUES({quoted_id(identity)},'PLATFORM_ADMIN')")
        credentials.append({'accountId': identity, 'email': email, 'password': password, 'localRecoveryPlatformOnly': True})
        platform.add(identity)
    if departure_guards:
        statements += ['ALTER TABLE tenants ENABLE TRIGGER departure_tenant_activation',
                       'ALTER TABLE tenant_memberships ENABLE TRIGGER departure_member_activation']
        statements.append("DO $$ BEGIN IF (SELECT count(*) FROM pg_trigger WHERE (tgrelid='tenants'::regclass AND tgname='departure_tenant_activation' OR tgrelid='tenant_memberships'::regclass AND tgname='departure_member_activation') AND tgenabled='O')<>2 THEN RAISE EXCEPTION 'RESTORE_DEPARTURE_GUARDS_NOT_ENABLED'; END IF; END $$")
    statements.append('COMMIT')
    sql(';\n'.join(statements)+';')
    platform_credential = next(x for x in credentials if x['accountId'] in platform)
    trial.private_write(root/'accounts.json', {'restored': True, 'platform': platform_credential, 'recovered': credentials,
        'note': '仅本地私有凭据。均为恢复时生成的新密码；旧会话失效，旧任务与计划未自动重启。'})
    return {'accountsEnabled': len(eligible), 'membershipsEnabled': len(members), 'sharedGrantsEnabled': len(grants),
            'privateOwnersHeld': len(blocked_private_owners), 'heldTenantIds': sorted(held_tenants), 'oldCredentialsRestored': False}


def retention_holds(sql, current_sql):
    """A preparation case is not an offboarding/exit receipt. Missing current control references hold scope."""
    if not has_table(sql, 'retention_cases'):
        return set()
    accounts = {x['id'] for x in json_rows(sql, 'SELECT id::text FROM accounts')}
    spaces = {(x['tenant_id'],x['id']) for x in json_rows(sql, 'SELECT tenant_id::text,id::text FROM workspaces')}
    held = set()
    for row in json_rows(current_sql, 'SELECT tenant_id::text,changed_by::text FROM retention_policy_versions'):
        if row['changed_by'] not in accounts:
            held.add(row['tenant_id'])
    cases = {x['id']:x for x in json_rows(current_sql, 'SELECT id::text,tenant_id::text,created_by::text,target_account_id::text FROM retention_cases')}
    for row in cases.values():
        if row['created_by'] not in accounts or row['target_account_id'] is not None and row['target_account_id'] not in accounts:
            held.add(row['tenant_id'])
    for row in json_rows(current_sql, 'SELECT case_id::text,changed_by::text FROM retention_case_versions'):
        if row['changed_by'] not in accounts:
            held.add(cases[row['case_id']]['tenant_id'])
    for row in json_rows(current_sql, 'SELECT tenant_id::text,workspace_id::text FROM retention_case_scopes'):
        if (row['tenant_id'],row['workspace_id']) not in spaces:
            held.add(row['tenant_id'])
    return held


def sync_retention(sql, current_sql, held):
    if not has_table(sql, 'retention_cases'):
        return
    tenants = {x['id'] for x in json_rows(sql, 'SELECT id::text FROM tenants')} - held
    # Synchronize control metadata and its actual current audit versions, never alter material deadlines
    # or infer that ASSESSED means an account was disabled or a company has exited.
    statements = ['BEGIN']
    for tenant in sorted(tenants):
        identity = quoted_id(tenant)
        statements += [f'DELETE FROM retention_case_versions WHERE case_id IN(SELECT id FROM retention_cases WHERE tenant_id={identity})',
                       f'DELETE FROM retention_case_scopes WHERE case_id IN(SELECT id FROM retention_cases WHERE tenant_id={identity})',
                       f'DELETE FROM retention_cases WHERE tenant_id={identity}',
                       f'DELETE FROM retention_policy_versions WHERE tenant_id={identity}']
    cases = {x['id']:x['tenant_id'] for x in json_rows(current_sql, 'SELECT id::text,tenant_id::text FROM retention_cases')}
    for table in ('retention_policy_versions','retention_cases','retention_case_scopes','retention_case_versions'):
        for row in json_rows(current_sql, 'SELECT * FROM '+table):
            tenant = row.get('tenant_id') or cases[row['case_id']]
            if tenant not in tenants:
                continue
            values = [literal(json.dumps(v,ensure_ascii=False) if isinstance(v,(list,dict)) else v) for v in row.values()]
            statements.append('INSERT INTO '+table+'('+','.join(row)+') VALUES('+','.join(values)+')')
    statements += ['COMMIT']
    sql(';\n'.join(statements)+';')



def reopen_configurations(sql, current_sql):
    """Re-enable only exact retained configuration versions that are effective NOW in the authority."""
    counts={'profiles':0,'experiences':0,'sources':0,'methodAdoptions':0}
    def keyed(db,table,exclude=()):
        rows=json_rows(db,'SELECT * FROM '+table)
        return {str(x['id']):{k:v for k,v in x.items() if k not in exclude} for x in rows}
    local=keyed(sql,'profile_versions',('status',))
    for row in json_rows(current_sql,"SELECT v.* FROM profile_versions v JOIN profile_entries e ON e.id=v.entry_id AND e.revision=v.revision WHERE v.status='ACTIVE' AND (to_jsonb(v)->>'scrubbed') IS DISTINCT FROM 'true' AND object_is_active('PROFILE_VERSION',v.id) AND (v.expires_at IS NULL OR v.expires_at>now())"):
        value={k:v for k,v in row.items() if k!='status'}
        if local.get(row['id'])==value:
            sql(f"UPDATE profile_versions SET status='ACTIVE' WHERE id={quoted_id(row['id'])}")
            counts['profiles']+=1
    local_sources=keyed(sql,'business_sources',('status',))
    for row in json_rows(current_sql,"SELECT * FROM business_sources WHERE status='ACTIVE'"):
        if local_sources.get(row['id'])=={k:v for k,v in row.items() if k!='status'}:
            sql(f"UPDATE business_sources SET status='ACTIVE' WHERE id={quoted_id(row['id'])}")
            counts['sources']+=1
    local_submissions=keyed(sql,'business_source_submissions',('status',))
    for row in json_rows(current_sql,"SELECT * FROM business_source_submissions WHERE status='ACTIVE'"):
        if local_submissions.get(row['id'])=={k:v for k,v in row.items() if k!='status'}:
            sql(f"UPDATE business_source_submissions SET status='ACTIVE' WHERE id={quoted_id(row['id'])}")
    local_versions=keyed(sql,'experience_versions')
    current_versions=keyed(current_sql,'experience_versions')
    local_entries=keyed(sql,'experience_entries',('status','published_version'))
    for row in json_rows(current_sql,"SELECT * FROM experience_entries WHERE status='PUBLISHED'"):
        version=row['published_version']
        if (local_entries.get(row['id'])=={k:v for k,v in row.items() if k not in ('status','published_version')}
                and version in local_versions and local_versions[version]==current_versions.get(version) and not local_versions[version]['scrubbed']):
            sql(f"UPDATE experience_entries SET status='PUBLISHED',published_version={quoted_id(version)} WHERE id={quoted_id(row['id'])}")
            counts['experiences']+=1
    if has_table(sql,'evaluation_assets'):
        local_assets=keyed(sql,'evaluation_assets',('status',))
        local_versions=keyed(sql,'evaluation_asset_versions');current_versions=keyed(current_sql,'evaluation_asset_versions')
        for row in json_rows(current_sql,"SELECT * FROM evaluation_assets WHERE status='ACTIVE'"):
            if local_assets.get(row['id'])=={k:v for k,v in row.items() if k!='status'}:
                versions=[v for v in local_versions.values() if v['asset_id']==row['id'] and v['revision']==row['revision']]
                if versions and not versions[0]['scrubbed'] and current_versions.get(versions[0]['id'])==versions[0]:
                    sql(f"UPDATE evaluation_assets SET status='ACTIVE' WHERE id={quoted_id(row['id'])}")
        current_issues=keyed(current_sql,'evaluation_issues')
        for identity,row in keyed(sql,'evaluation_issues').items():
            if current_issues.get(identity)!=row:
                sql(f"UPDATE evaluation_issues SET scrubbed=true,title='恢复时当前状态未对齐',impact='',next_action='' WHERE id={quoted_id(identity)}")
                sql(f"UPDATE evaluation_issue_events SET note='' WHERE issue_id={quoted_id(identity)}")
    if has_table(sql,'method_adoptions'):
        local_versions=keyed(sql,'method_versions');current_versions=keyed(current_sql,'method_versions')
        active_versions={r['id'] for r in json_rows(current_sql,"SELECT id FROM method_versions WHERE object_is_active('METHOD_VERSION',id)")}
        compatible={identity for identity,row in local_versions.items() if current_versions.get(identity)==row and not row.get('scrubbed',False) and identity in active_versions}
        # Restoring an already-effective adoption is not a new adopt/rollback request. A newer standard
        # revision or evidence retention alone must not revoke current authority's adoption. The method
        # and release identity must still match exactly; never replay a release/adoption event.
        local_comparisons=keyed(sql,'method_comparisons');current_comparisons=keyed(current_sql,'method_comparisons')
        matching_comparisons={identity for identity,row in local_comparisons.items() if current_comparisons.get(identity)==row}
        current_releases={row['version_id']:row for row in json_rows(current_sql,'SELECT * FROM method_releases')}
        compatible &= {row['version_id'] for row in json_rows(sql,'SELECT * FROM method_releases')
                       if current_releases.get(row['version_id'])==row and row['comparison_id'] in matching_comparisons}
        for row in json_rows(current_sql,'SELECT id::text,published_version::text FROM method_families WHERE published_version IS NOT NULL'):
            if row['published_version'] in compatible:
                sql(f"UPDATE method_families SET published_version={quoted_id(row['published_version'])} WHERE id={quoted_id(row['id'])}")
        local_adoptions=keyed(sql,'method_adoptions')
        for row in json_rows(current_sql,"SELECT * FROM method_adoptions WHERE status='ACTIVE'"):
            previous=local_adoptions.get(row['id'])
            if previous and row['version_id'] in compatible and all(row[k]==previous[k] for k in ('tenant_id','workspace_id')):
                sql(f"UPDATE method_adoptions SET status='ACTIVE',revision={int(row['revision'])},version_id={quoted_id(row['version_id'])},actor_id={quoted_id(row['actor_id'])} WHERE id={quoted_id(row['id'])} AND EXISTS(SELECT 1 FROM accounts WHERE id={quoted_id(row['actor_id'])})")
                counts['methodAdoptions']+=1
    # Recipient preferences use current facts; old hidden/read positions are not task completion.
    if has_table(sql,'recommendation_settings'):
        sql('DELETE FROM recommendation_settings')
        for row in json_rows(current_sql,'SELECT * FROM recommendation_settings'):
            sql("INSERT INTO recommendation_settings(tenant_id,actor_id,revision,enabled,updated_at) SELECT "+','.join(literal(row[k]) for k in ('tenant_id','actor_id','revision','enabled','updated_at'))+" WHERE EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id="+literal(row['tenant_id'])+" AND account_id="+literal(row['actor_id'])+")")
    # Publication follows are current personal preferences, never restored as an old subscription.
    # Conversation plan commands are immutable receipts. Quarantine pauses all plans/tasks; receipts
    # cannot execute commands, and their referenced plans are reconciled against current authority.
    if has_table(sql,'publication_preferences'):
        sql('DELETE FROM publication_preferences')
        for row in json_rows(current_sql,'SELECT * FROM publication_preferences'):
            sql("INSERT INTO publication_preferences(tenant_id,actor_id,material_id,pinned,revision,updated_at) SELECT "+','.join(literal(row[k]) for k in ('tenant_id','actor_id','material_id','pinned','revision','updated_at'))+" WHERE EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id="+literal(row['tenant_id'])+" AND account_id="+literal(row['actor_id'])+") AND EXISTS(SELECT 1 FROM active_materials WHERE id="+literal(row['material_id'])+")")
    # Restore content-card preferences only from current facts. Generation remains paused;
    # old queued batches and receipts must never resurrect background work.
    if has_table(sql,'briefing_card_preferences'):
        sql('UPDATE briefing_card_preferences SET hidden=true,pinned=false')
        for row in json_rows(current_sql,'SELECT p.*,p.focus_position::text AS exact_focus_position FROM briefing_card_preferences p'):
            sql(f"UPDATE briefing_card_preferences SET hidden={literal(row['hidden'])},pinned={literal(row['pinned'])},size={literal(row['size'])},revision={int(row['revision'])},focus_position={literal(row['exact_focus_position'])} WHERE task_id={quoted_id(row['task_id'])} AND owner_id={quoted_id(row['owner_id'])}")
    sql('UPDATE briefing_preferences SET hidden=true,pinned=false')
    layouts=has_table(sql,'briefing_layouts')
    for row in json_rows(current_sql,'SELECT p.*'+(',p.focus_position::text AS exact_focus_position' if layouts else '')+' FROM briefing_preferences p'):
        # Preserve numeric(30,12) exactly; a JSON float would collapse adjacent positions.
        position=',focus_position='+literal(row['exact_focus_position']) if layouts else ''
        sql(f"UPDATE briefing_preferences SET hidden={literal(row['hidden'])},pinned={literal(row['pinned'])},size={literal(row['size'])},revision={int(row['revision'])}"+position+f" WHERE conversation_id={quoted_id(row['conversation_id'])} AND owner_id={quoted_id(row['owner_id'])}")
    if layouts:
        # Preference triggers run during quarantine/reopening. Keep the current order and advance
        # its CAS fence past both histories; historical move receipts are facts, never commands.
        for row in json_rows(current_sql,'SELECT * FROM briefing_layouts'):
            sql("UPDATE briefing_layouts SET revision=GREATEST(revision,"+str(int(row['revision']))+")+1,updated_at=now() WHERE tenant_id="+quoted_id(row['tenant_id'])+' AND owner_id='+quoted_id(row['owner_id']))
    return counts


def require_activation(root):
    """Called by trial.start before any process starts; a marker alone never opens the instance."""
    try:
        pointer = trial.private_read(root/'activation-key.json')
        key_path = Path(pointer['keyPath'])
        if not key_path.is_absolute() or key_path.resolve().is_relative_to(root.resolve()):
            raise ValueError()
        record = backup.signed_read(root/'restore.json', backup.signing_key(key_path))
        if record.get('state') != 'ACTIVATED' or record.get('activationDirectory') != str(root.resolve()) or record.get('activationSchema') != record.get('snapshot',{}).get('schemaHash'):
            raise ValueError()
        current_migrations={row['version']:row for row in backup.migrations()}
        if any(current_migrations.get(row['version'])!=row for row in record['snapshot']['migrations']):
            raise ValueError()
        evidence = backup.signed_read(root/'current-state-evidence.json', backup.signing_key(key_path))
        if hashlib.sha256(backup.canonical(evidence)).hexdigest() != record.get('evidenceHash') or evidence.get('reopeningSupported') is not True:
            raise ValueError()
        # A copied config/marker cannot authorize a different restored PostgreSQL cluster.
        control = root/'postgres/global/pg_control'
        backup.regular(control)
        output = __import__('subprocess').check_output([backup.pg('pg_controldata'), str(root/'postgres')], env={**trial.clean_environment(),'LC_ALL':'C'},text=True)
        line = next(x for x in output.splitlines() if x.startswith('Database system identifier:'))
        if line.split(':',1)[1].strip() != record.get('activationCluster'):
            raise ValueError()
        if json.loads(COVERAGE.read_text())['migrations'] != backup.migrations():
            raise ValueError()
        return record
    except (trial.TrialError, OSError, ValueError, KeyError, TypeError, StopIteration):
        backup.fail('此目录仍为隔离恢复实例或开放凭证已失效；先用原权威实例完成显式 activate。')


def activate(root, current_root, key_path):
    root,current_root=trial.directory(root),trial.directory(current_root)
    if root.resolve()==current_root.resolve(): backup.fail('恢复副本不能授权自己。')
    key=backup.signing_key(key_path)
    record=backup.signed_read(root/'restore.json',key)
    if record.get('state') not in ('QUARANTINED','CURRENT_STATE_CHECKED_QUARANTINED'):
        backup.fail('实例不在待开放隔离状态；不能重复激活或重置正在使用的凭据。')
    snapshot=record['snapshot']
    if record.get('recoveryDirectory')!=str(root.resolve()) or backup.now()>=backup.datetime.fromisoformat(snapshot['expiresAt']):
        backup.fail('恢复目录不匹配或原快照已过期；不能借待开放副本延长有效期。')
    if snapshot['schemaHash']!=backup.schema_hash() or snapshot['migrations']!=backup.migrations():
        backup.fail('当前版本没有覆盖此恢复快照；保持隔离。')
    with backup.owned_lock(current_root),backup.owned_lock(root):
        with backup.offline_database(current_root) as (_,__,current_sql):
            identity=backup.source_identity(current_root,key_path,current_sql)
            if identity['instanceId']!=snapshot['sourceInstanceId']: backup.fail('当前证据来自其他实例。')
            covered=coverage(current_sql)
            evidence=current_evidence(current_sql)
            if evidence['transaction']<snapshot['sourceTransaction']: backup.fail('当前权威实例早于快照。')
            with backup.offline_database(root) as (_,__,sql):
                coverage(sql)
                applied=apply_current(sql,root,evidence)
                import backup_lifecycle
                applied['methodHeads']=backup_lifecycle.method_heads(sql,current_sql)
                applied['objects']=backup_lifecycle.objects(sql,current_sql)
                applied['versionBodies']=backup_lifecycle.version_bodies(sql,current_sql)
                applied['feedback']=backup_lifecycle.feedback(sql,current_sql)
                applied['taskWork']=backup_lifecycle.task_work(sql,current_sql)
                applied['adjustments']=backup_lifecycle.adjustments(sql,current_sql)
                applied['forwarding']=backup_lifecycle.forwarding(sql,current_sql)
                applied['operations']=backup_lifecycle.operations(sql,current_sql)
                applied['departures']=backup_lifecycle.departures(sql,current_sql)
                reopened=reopen_current(sql,current_sql,root)
                sync_retention(sql,current_sql,set(reopened['heldTenantIds']))
                reopened['effectiveConfigurations']=reopen_configurations(sql,current_sql)
                applied['residual']=backup_lifecycle.residual(sql,current_sql)
                cluster=sql('SELECT system_identifier::text FROM pg_control_system()')
                if sql("SELECT (SELECT count(*) FROM conversation_tasks WHERE status IN('QUEUED','RUNNING'))+(SELECT count(*) FROM ongoing_plans WHERE status='ACTIVE')+(SELECT count(*) FROM knowledge_runs WHERE status IN('QUEUED','RUNNING'))+(SELECT count(*) FROM spring_session)")!='0':
                    backup.fail('旧执行或会话未被封闭；保持隔离。')
            report={'format':backup.FORMAT,'snapshotId':snapshot['snapshotId'],'sourceInstanceId':identity['instanceId'],
                    'checkedAt':backup.now().isoformat(),'coverageHash':covered,'current':evidence,'applied':applied,
                    'reopened':reopened,'reopeningSupported':True,'automaticOldTaskExecutionEnabled':False}
            backup.signed_write(root/'current-state-evidence.json',report,key)
            trial.private_write(root/'activation-key.json',{'keyPath':str(key_path.resolve())})
            record.update({'state':'ACTIVATED','activatedAt':report['checkedAt'],'activationDirectory':str(root.resolve()),
                           'activationCluster':cluster,'activationSchema':backup.schema_hash(),'reopeningSupported':True,
                           'evidenceHash':hashlib.sha256(backup.canonical(report)).hexdigest()})
            # Last write is the opening fence. Any earlier failure leaves a quarantined marker.
            backup.signed_write(root/'restore.json',record,key)
    require_activation(root)
    return {'status':'activated','automaticOldExecution':False,**reopened}


def rotate_pending(root, key_path):
    import shutil
    root=trial.directory(root)
    record=backup.signed_read(root/'restore.json',backup.signing_key(key_path))
    if record.get('recoveryDirectory')!=str(root.resolve()) or record.get('format')!=backup.FORMAT:
        backup.fail('恢复目录来源未核验，轮转不删除。')
    if record.get('state')=='ACTIVATED':
        return False  # A formally opened instance is business data, not an expiring backup bundle.
    if record.get('state') not in ('QUARANTINED','CURRENT_STATE_CHECKED_QUARANTINED'):
        backup.fail('未知恢复状态，轮转不删除。')
    if backup.now()<backup.datetime.fromisoformat(record['snapshot']['expiresAt']):
        return False
    allowed={'postgres','objects','restore.json','config.json','database.json','accounts.json','supervisor.lock','current-state-evidence.json','activation-key.json'}
    if {p.name for p in root.iterdir()}-allowed or (root/'postgres/postmaster.pid').exists():
        backup.fail('恢复目录包含额外内容或可能运行的数据库，轮转不删除。')
    with backup.owned_lock(root):
        shutil.rmtree(root)
    return True
