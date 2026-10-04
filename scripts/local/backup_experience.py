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
