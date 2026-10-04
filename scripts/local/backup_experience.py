"""Offline recovery adapters for automatic experience assets. Never used by application requests."""
import backup

# Only availability checks caused by temporary authorization changes are suspended. Actual source
# erasure, immutable-version guards, foreign keys, session revocation and execution fences stay on.
ISOLATION_TRIGGERS = (
    ('accounts', 'experience_intake_account'),
    ('tenant_memberships', 'experience_intake_membership'),
    ('workspace_members', 'experience_intake_workspace'),
    ('accounts', 'generalization_account_changed'),
    ('tenants', 'generalization_tenant_changed'),
    ('tenant_memberships', 'generalization_tenant_member_changed'),
    ('workspace_members', 'generalization_membership_changed'),
    ('workspaces', 'generalization_workspace_owner_changed'),
    ('experience_entries', 'generalization_entry_changed'),
    ('object_lifecycle', 'generalization_lifecycle_changed'),
    ('departure_executions', 'generalization_departure_changed'),
    ('content_lifecycle', 'generalization_material_state_changed'),
    ('materials', 'generalization_material_scope_changed'),
    ('tenant_memberships', 'company_member_fence'),
    ('workspace_members', 'company_space_fence'),
    ('content_lifecycle', 'company_material_lifecycle_fence'),
)


def isolated_sql(sql):
    """Each call restores its named triggers before COMMIT; failures roll back both data and DDL.

    Only the private offline restore connection may use this adapter, after coverage validation.
    No persistent disabled trigger, application bypass flag, or customer-facing setting is created.
    """
    import backup_recovery as recovery
    if getattr(sql, '_experience_recovery_isolation', False):
        return sql
    if not recovery.has_table(sql, 'experience_generalization_sources'):
        return sql
    expected = ','.join(f"('{table}','{trigger}')" for table, trigger in ISOLATION_TRIGGERS)
    assertion = f"""DO $$ BEGIN IF EXISTS(SELECT 1 FROM (VALUES {expected}) AS expected(table_name,trigger_name)
      LEFT JOIN pg_trigger t ON t.tgrelid=to_regclass('public.'||expected.table_name) AND t.tgname=expected.trigger_name
      WHERE t.oid IS NULL OR t.tgenabled<>'O' OR t.tgisinternal)
      THEN RAISE EXCEPTION 'RECOVERY_EXPERIENCE_FENCES_NOT_ENABLED'; END IF; END $$;"""
    disable = '\n'.join(f'ALTER TABLE public.{table} DISABLE TRIGGER {trigger};' for table, trigger in ISOLATION_TRIGGERS)
    enable = '\n'.join(f'ALTER TABLE public.{table} ENABLE TRIGGER {trigger};' for table, trigger in ISOLATION_TRIGGERS)

    def execute(query, fingerprint=False):
        body = query.strip()
        # Existing adapters use one explicit outer transaction. Preserve that atomic scope.
        if body.startswith('BEGIN;'):
            if not body.endswith('COMMIT;'):
                backup.fail('离线恢复事务边界不完整；保持隔离。')
            body = body[len('BEGIN;'):-len('COMMIT;')].strip()
        # Deferred published-version FKs must be checked before changing trigger DDL again.
        # This is the same completed mutation boundary that COMMIT would validate.
        return sql('BEGIN;\n' + assertion + '\n' + disable + '\n' + body.rstrip(';')
                   + ';\nSET CONSTRAINTS ALL IMMEDIATE;\n' + enable + '\n' + assertion + '\nCOMMIT;', fingerprint)
    execute._experience_recovery_isolation = True
    return execute


def stop_pending(sql):
    """Keep admitted provenance; permanently close unfinished processing rather than replay it."""
    import backup_recovery as recovery
    if not recovery.has_table(sql, 'experience_generalization_sources'):
        return
    sql("""BEGIN;
    UPDATE experience_intake_sources i SET state='SOURCE_UNAVAILABLE',reason='RECOVERY_QUARANTINE',invalidated_at=now()
      WHERE i.state='PENDING' AND NOT EXISTS(SELECT 1 FROM experience_automatic_sources s WHERE s.source_id=i.id);
    UPDATE experience_analysis_runs r SET invalidated=true,candidate=NULL,review=NULL,evidence=NULL,
      state=CASE WHEN state IN ('CLAIMED','DISPATCHED') THEN 'CANCELLED' ELSE state END,
      code='RECOVERY_QUARANTINE',finished_at=coalesce(finished_at,now())
      WHERE NOT EXISTS(SELECT 1 FROM experience_admissions a WHERE a.run_id=r.id AND a.outcome IN ('CREATED','UPDATED'));
    UPDATE experience_analysis_items i SET state='SOURCE_UNAVAILABLE',error_code='RECOVERY_QUARANTINE',updated_at=now()
      WHERE i.state IN ('QUEUED','RUNNING','RETRY_WAIT','QUALIFIED')
      AND NOT EXISTS(SELECT 1 FROM experience_admissions a WHERE a.run_id=i.run_id AND a.outcome IN ('CREATED','UPDATED'));
    UPDATE experience_generalization_sources SET state='SOURCE_UNAVAILABLE',error_code='RECOVERY_QUARANTINE',updated_at=now()
      WHERE state IN ('QUEUED','RUNNING','RETRY_WAIT','QUALIFIED');
    UPDATE general_experience_adjustments SET state='UNAVAILABLE',error_code='RECOVERY_QUARANTINE',updated_at=now()
      WHERE state IN ('QUEUED','RETRY_WAIT','RUNNING','UNCERTAIN','PUBLISHING');
    COMMIT;""")


def revalidate(sql):
    """After current authorization/configuration is rebuilt, invalidate unsupported retained assets."""
    import backup_recovery as recovery
    if not recovery.has_table(sql, 'experience_generalization_sources'):
        return
    sql("""BEGIN;
    UPDATE experience_intake_sources SET state='SOURCE_UNAVAILABLE',reason='SOURCE_CHANGED',invalidated_at=now()
      WHERE state='PENDING' AND NOT experience_intake_available(id);
    UPDATE experience_generalization_sources SET state='SOURCE_UNAVAILABLE',error_code='GENERALIZATION_SOURCE_CHANGED',updated_at=now()
      WHERE state<>'SOURCE_UNAVAILABLE' AND NOT generalization_source_available(version_id);
    COMMIT;""")


def synchronize(sql, current_sql):
    """Apply current controls to retained exact assets; never import new bodies or replay actions."""
    import json
    import backup_recovery as recovery
    if not recovery.has_table(sql, 'experience_generalization_sources'):
        return {}
    sql = isolated_sql(sql)
    rows = recovery.json_rows
    literal, uid = recovery.literal, recovery.quoted_id
    def keyed(db, table):
        # Compare JSONB bodies exactly in PostgreSQL, without Python float rounding.
        columns = {'experience_versions':('content','automatic_steps'), 'general_experience_versions':('method',)}.get(table, ())
        extra = ''.join(",encode(sha256(convert_to("+column+"::text,'UTF8')),'hex') AS exact_"+column for column in columns)
        return {r['id']: r for r in rows(db, 'SELECT *'+extra+' FROM ' + table)}
    local_entries, current_entries = (keyed(db, 'experience_entries') for db in (sql, current_sql))
    local_versions, current_versions = (keyed(db, 'experience_versions') for db in (sql, current_sql))
    local_general, current_general = (keyed(db, 'general_experience_entries') for db in (sql, current_sql))
    local_methods, current_methods = (keyed(db, 'general_experience_versions') for db in (sql, current_sql))

    def unchanged(old, current, ignored=()):
        if current is None or {k:v for k,v in old.items() if k not in ignored} != {k:v for k,v in current.items() if k not in ignored}:
            backup.fail('恢复经验固定版本或来源依赖与当前依据不一致；保持隔离，不覆盖原文或改写依据。')

    for identity, old in local_entries.items():
        unchanged(old, current_entries.get(identity), ('revision','latest_number','status','published_version','updated_at','automation_stopped'))
    for identity, old in local_general.items():
        unchanged(old, current_general.get(identity), ('revision','status','published_version','updated_at'))
        head = current_general[identity]['published_version']
        if head is not None:
            unchanged({'entry_id': identity}, {'entry_id': current_methods.get(head, {}).get('entry_id')})
    for identity, old in local_versions.items():
        latest = current_versions.get(identity)
        erased = old['scrubbed'] or latest is not None and latest['scrubbed']
        unchanged(old, latest, ('content','search_terms','tags','scrubbed','automatic_steps','exact_content','exact_automatic_steps') if erased else ())
    for identity, old in local_methods.items():
        latest = current_methods.get(identity)
        unchanged(old, latest, ('method','exact_method') if old['method'] is None or latest is not None and latest['method'] is None else ())

    # Compare the entire edge set of each retained version, including any added/removed edge.
    # Normal publication adds a new version; it cannot rewrite an older version's fixed basis.
    def edges(db, table, column):
        grouped = {}
        for row in rows(db, 'SELECT * FROM ' + table):
            grouped.setdefault(row[column], set()).add(json.dumps(row, sort_keys=True))
        return grouped
    for table, column, versions in (
        ('experience_evidence','version_id',local_versions),
        ('experience_automatic_sources','version_id',local_versions),
        ('experience_automatic_dependencies','version_id',local_versions),
        ('experience_general_dependencies','version_id',local_versions),
        ('general_experience_origins','version_id',local_methods),
        ('general_experience_version_dependencies','version_id',local_methods),
    ):
        local_edges, current_edges = (edges(db, table, column) for db in (sql, current_sql))
        if any(local_edges.get(version,set()) != current_edges.get(version,set()) for version in versions):
            backup.fail('恢复经验固定版本或来源依赖与当前依据不一致；保持隔离，不覆盖原文或改写依据。')

    current_intakes = keyed(current_sql, 'experience_intake_sources')
    local_intakes = keyed(sql, 'experience_intake_sources')
    current_sources = {r['version_id']:r for r in rows(current_sql,'SELECT * FROM experience_generalization_sources')}
    local_sources = {r['version_id']:r for r in rows(sql,'SELECT * FROM experience_generalization_sources')}
    for identity, old in local_intakes.items():
        unchanged(old, current_intakes.get(identity), ('state','reason','checked_at','invalidated_at'))
    for identity, old in local_sources.items():
        unchanged(old, current_sources.get(identity), ('state','attempts','run_id','next_attempt_at','error_code','updated_at'))

    for table in ('experience_adjustments','general_experience_suggestions'):
        current = keyed(current_sql, table)
        for old in rows(sql, 'SELECT * FROM '+table):
            unchanged(old, current.get(old['id']), ('content','finished'))
    # Published platform adjustments keep their fixed accepted proposal and phase proof.
    current_adjustments = keyed(current_sql, 'general_experience_adjustments')
    accepted_adjustments = rows(sql, 'SELECT a.* FROM general_experience_adjustments a WHERE EXISTS(SELECT 1 FROM general_experience_version_dependencies d WHERE d.adjustment_id=a.id)')
    phase_ids = set()
    for old in accepted_adjustments:
        unchanged(old, current_adjustments.get(old['id']))
        phase_ids.update((old['extraction_run'],old['run_id']))
    proof_columns = 'id,proposal_id,phase,job_hash,engine_version,execution_class,outcome,stages::text,created_at'
    current_proofs = {r['id']:r for r in rows(current_sql,'SELECT '+proof_columns+' FROM general_experience_adjustment_runs')}
    for old in rows(sql,'SELECT '+proof_columns+' FROM general_experience_adjustment_runs'):
        if old['id'] in phase_ids:
            unchanged(old, current_proofs.get(old['id']))

    # Accepted proof is immutable. Extra later duplicate observations do not become new evidence.
    for table, key, query in (
        ('experience_admissions','run_id',"SELECT * FROM experience_admissions WHERE outcome IN ('CREATED','UPDATED')"),
        ('general_experience_admissions','run_id',"SELECT * FROM general_experience_admissions WHERE outcome='CREATED'"),
    ):
        current = {r[key]:r for r in rows(current_sql, query)}
        for old in rows(sql, query):
            unchanged(old, current.get(old[key]))
    for run_table, admission_table, columns, outcomes in (
        ('experience_analysis_runs','experience_admissions','id,source_id,tenant_id,job_hash,manifest::text,engine_version,execution_class,outcome,stages::text,created_at',"('CREATED','UPDATED')"),
        ('experience_generalization_runs','general_experience_admissions','id,source_id,tenant_id,job_hash,engine_version,execution_class,outcome,stages::text,created_at',"('CREATED')"),
    ):
        query = 'SELECT '+','.join('r.'+column for column in columns.split(','))+' FROM '+run_table+' r WHERE EXISTS(SELECT 1 FROM '+admission_table+' a WHERE a.run_id=r.id AND a.outcome IN '+outcomes+')'
        current_runs = {r['id']:r for r in rows(current_sql, query)}
        for old in rows(sql, query):
            unchanged(old, current_runs.get(old['id']))

    result = {'localControls':0,'generalControls':0,'usageControls':0,'unavailableHeads':0,
              'sourceTombstones':0,'versionTombstones':0,'eventsCopied':0,'eventsOutsideSnapshot':0}
    statements = ['BEGIN']
    # Irreversible erasure wins over controls. Never reconstruct a body absent from either side.
    for identity, old in local_intakes.items():
        latest = current_intakes[identity]
        if latest['state']=='SOURCE_UNAVAILABLE' and old['state']!='SOURCE_UNAVAILABLE':
            statements.append(f"UPDATE experience_intake_sources SET state='SOURCE_UNAVAILABLE',reason='SOURCE_CHANGED',invalidated_at=coalesce(invalidated_at,now()) WHERE id={uid(identity)}")
            result['sourceTombstones']+=1
    for identity, old in local_versions.items():
        if current_versions[identity]['scrubbed'] and not old['scrubbed']:
            statements.append(f"SELECT scrub_lifecycle_object('EXPERIENCE_VERSION',{uid(identity)})")
            result['versionTombstones']+=1
    for identity, old in local_sources.items():
        if current_sources[identity]['state']=='SOURCE_UNAVAILABLE' and old['state']!='SOURCE_UNAVAILABLE':
            statements.append(f"UPDATE experience_generalization_sources SET state='SOURCE_UNAVAILABLE',error_code='GENERALIZATION_SOURCE_CHANGED',updated_at=now() WHERE version_id={uid(identity)}")
            result['sourceTombstones']+=1
    for identity, old in local_methods.items():
        if current_methods[identity]['method'] is None and old['method'] is not None:
            statements.append(f"UPDATE general_experience_versions SET method=NULL WHERE id={uid(identity)}")
            result['versionTombstones']+=1
    for identity, old in local_entries.items():
        latest = current_entries[identity]
        fields = ('revision','latest_number','updated_at','automation_stopped')
        statements.append('UPDATE experience_entries SET '+','.join(k+'='+literal(latest[k]) for k in fields)+f' WHERE id={uid(identity)}')
        result['localControls']+=1
        if latest['published_version'] is not None and latest['published_version'] not in local_versions:
            result['unavailableHeads']+=1
    for identity, old in local_general.items():
        latest = current_general[identity]
        head = latest['published_version']
        if head is not None and head not in local_methods:
            head = None
            result['unavailableHeads']+=1
        # A currently erased retained head is never advertised as AVAILABLE, even on repeated sync.
        statements.append(f"UPDATE general_experience_entries SET revision={int(latest['revision'])},updated_at={literal(latest['updated_at'])},"
            f"published_version={literal(head)}::uuid,status=CASE WHEN {literal(head)}::uuid IS NOT NULL AND EXISTS(SELECT 1 FROM general_experience_versions WHERE id={literal(head)}::uuid AND method IS NULL) THEN 'WITHDRAWN' ELSE {literal(latest['status'])} END WHERE id={uid(identity)}")
        result['generalControls']+=1
    tenants = {r['id'] for r in rows(sql, 'SELECT id FROM tenants')}
    # Missing current row means the current default (enabled), not an invented stop or audit event.
    statements.append('DELETE FROM tenant_general_experience_usage')
    for row in rows(current_sql, 'SELECT * FROM tenant_general_experience_usage'):
        if row['tenant_id'] in tenants and row['entry_id'] in local_general:
            statements.append('INSERT INTO tenant_general_experience_usage('+','.join(row)+') VALUES('+','.join(literal(v) for v in row.values())+')')
            result['usageControls']+=1
    accounts = {r['id'] for r in rows(sql, 'SELECT id FROM accounts')}
    for table, key, entries, versions in (
        ('experience_events', 'id', local_entries, local_versions),
        ('general_experience_management_events', 'id', local_general, local_methods),
        ('tenant_general_experience_usage_events', 'request_id', local_general, local_methods),
    ):
        event_key = lambda r: (r.get('tenant_id'),r[key])
        local_events = {event_key(r):r for r in rows(sql, 'SELECT * FROM '+table)}
        current_events = {event_key(r):r for r in rows(current_sql, 'SELECT * FROM '+table)}
        for identity, old in local_events.items():
            unchanged(old, current_events.get(identity))
        for identity, row in current_events.items():
            if identity in local_events:
                continue
            if (row['entry_id'] not in entries or row['actor_id'] not in accounts
                    or row.get('tenant_id') is not None and row['tenant_id'] not in tenants
                    or row.get('version_id') is not None and row['version_id'] not in versions):
                result['eventsOutsideSnapshot']+=1
                continue
            statements.append('INSERT INTO '+table+'('+','.join(row)+') VALUES('+','.join(literal(v) for v in row.values())+')')
            result['eventsCopied']+=1
    statements.append('COMMIT')
    sql(';\n'.join(statements)+';')
    return result
