"""Offline recovery of optional company labels and their fixed inference provenance."""
import backup


def stop_pending(sql):
    import backup_recovery as recovery
    if not recovery.has_table(sql, 'company_inference_runs'):
        return
    # CANCELLED items are rediscovered by the runtime. FAILED items remain terminal.
    sql("""BEGIN;
    UPDATE company_inference_runs SET state='CANCELLED',fenced=true,lease_until=now(),finished_at=now()
      WHERE state='RUNNING';
    UPDATE company_analysis_attempts SET state='CANCELLED',finished_at=now(),error_code='RECOVERY_QUARANTINE'
      WHERE state IN ('CLAIMED','DISPATCHED');
    UPDATE company_analysis_items SET state='FAILED',error_code='RECOVERY_QUARANTINE',updated_at=now()
      WHERE state IN ('QUEUED','RUNNING','RETRY_WAIT','CANCELLED') OR
        state='SUCCEEDED' AND EXISTS(SELECT 1 FROM company_inference_runs r WHERE r.id=run_id AND r.fenced);
    COMMIT;""")


def revalidate(sql):
    import backup_recovery as recovery
    if not recovery.has_table(sql, 'company_inference_runs'):
        return
    # A suspended tenant temporarily hides retained information; suspension alone does not erase
    # successful inference. Real authority fences are synchronized even for suspended tenants.
    sql("""BEGIN;
    UPDATE company_inference_runs r SET fenced=true FROM tenants t
      WHERE t.id=r.tenant_id AND t.status='ACTIVE' AND r.state='SUCCEEDED' AND NOT r.fenced
      AND NOT company_inference_readable(r.id);
    UPDATE profile_versions v SET status='WITHDRAWN'
      WHERE v.status='ACTIVE' AND NOT company_profile_readable(v.id)
      AND EXISTS(SELECT 1 FROM tenants t WHERE t.id=v.tenant_id AND t.status='ACTIVE');
    UPDATE company_analysis_items SET state='FAILED',error_code='RECOVERY_QUARANTINE',updated_at=now()
      WHERE state='SUCCEEDED' AND EXISTS(SELECT 1 FROM company_inference_runs r WHERE r.id=run_id AND r.fenced);
    COMMIT;""")


def synchronize(sql, current_sql):
    import backup_recovery as recovery
    import backup_experience
    if not recovery.has_table(sql, 'company_inference_runs'):
        return {}
    sql = backup_experience.isolated_sql(sql)
    rows, literal, uid = recovery.json_rows, recovery.literal, recovery.quoted_id
    def keyed(db, table, key='id', projection='*'):
        return {r[key]:r for r in rows(db, 'SELECT '+projection+' FROM '+table)}
    def same(old, latest, ignored=()):
        if latest is None or {k:v for k,v in old.items() if k not in ignored}!={k:v for k,v in latest.items() if k not in ignored}:
            backup.fail('企业信息恢复的固定版本、分析依据或归属不一致；保持隔离。')
    runs, current_runs = (keyed(db,'company_inference_runs',projection='*,group_revisions::text AS exact_revisions') for db in (sql,current_sql))
    tags, current_tags = (keyed(db,'company_information_tags','profile_id') for db in (sql,current_sql))
    suggestions, current_suggestions = (keyed(db,'company_information_suggestions') for db in (sql,current_sql))
    profiles, current_profiles = (keyed(db,'profile_entries') for db in (sql,current_sql))
    versions, current_versions = (keyed(db,'profile_versions') for db in (sql,current_sql))
    for identity, old in runs.items():
        latest = current_runs.get(identity)
        same(old,latest,('state','lease_until','fenced','finished_at','group_revisions'))
        if old['state']=='SUCCEEDED' and latest['state']!='SUCCEEDED':
            backup.fail('企业信息恢复的完成回执不一致；保持隔离。')
    for identity, old in tags.items():
        same(old,current_tags.get(identity),('origin','human_protected'))
        same(profiles[identity],current_profiles.get(identity),('revision','kind','entry_key'))
    company_versions = {k:v for k,v in versions.items() if v['entry_id'] in tags}
    for identity, old in company_versions.items():
        latest = current_versions.get(identity)
        erased = old.get('scrubbed') or latest is not None and latest.get('scrubbed')
        same(old,latest,('status',)+(('value','provenance','scrubbed') if erased else ()))
    for identity, old in suggestions.items():
        latest = current_suggestions.get(identity)
        erased = old['scrubbed'] or latest is not None and latest['scrubbed']
        same(old,latest,('state','revision','target_id')+(('scrubbed','label','meaning') if erased else ()))
        missing_applied_target = old['target_id'] is None and latest['target_id'] not in profiles and old['state']==latest['state']=='APPLIED'
        if old['target_id']!=latest['target_id'] and not ((old['state']=='PENDING' and latest['state']=='APPLIED') or missing_applied_target):
            backup.fail('企业信息恢复的建议目标变化无法核对；保持隔离。')
    # All fixed dependency edges must match for retained successful versions/runs/suggestions.
    for table, owner, owners in (
        ('company_inference_inputs','run_id',set(runs)),
        ('company_suggestion_evidence','suggestion_id',set(suggestions)),
        ('company_profile_inferences','version_id',set(company_versions)),
    ):
        before = [r for r in rows(sql,'SELECT * FROM '+table) if r[owner] in owners]
        after = [r for r in rows(current_sql,'SELECT * FROM '+table) if r[owner] in owners]
        import json
        if sorted(json.dumps(r,sort_keys=True) for r in before)!=sorted(json.dumps(r,sort_keys=True) for r in after):
            backup.fail('企业信息恢复的固定来源集合不一致；保持隔离。')
    attempts, current_attempts = (keyed(db,'company_analysis_attempts','run_id') for db in (sql,current_sql))
    for identity, old in attempts.items():
        if old['state']=='RETURNED':
            same(old,current_attempts.get(identity))

    inputs = {r['chunk_id'] for r in rows(sql,'SELECT chunk_id FROM company_inference_inputs')}
    projection = "id,tenant_id,workspace_id,material_id,version_id,run_id,ordinal,locator,method,content='' AS erased,encode(sha256(convert_to(content,'UTF8')),'hex') content_hash"
    chunks, current_chunks = (keyed(db,'knowledge_chunks',projection=projection) for db in (sql,current_sql))
    for identity in inputs:
        old, latest = chunks[identity], current_chunks.get(identity)
        erased = old['erased'] or latest is not None and latest['erased']
        same(old,latest,('erased','content_hash','locator') if erased else ())

    result = {'runs':len(runs),'tags':len(tags),'groups':0,'scrubbedSuggestions':0,'unavailableHeads':0,'unavailableTargets':0}
    statements = ['BEGIN']
    for identity in inputs:
        if current_chunks[identity]['erased'] and not chunks[identity]['erased']:
            statements.append(f"UPDATE knowledge_chunks SET content='',locator='REMOVED' WHERE id={uid(identity)}")
    tenants = {r['id'] for r in rows(sql,'SELECT id FROM tenants')}
    for group in rows(current_sql,'SELECT * FROM company_information_groups'):
        if group['tenant_id'] in tenants:
            statements.append('INSERT INTO company_information_groups('+','.join(group)+') VALUES('+','.join(literal(v) for v in group.values())+') ON CONFLICT(tenant_id,field) DO UPDATE SET revision=EXCLUDED.revision,manually_cleared=EXCLUDED.manually_cleared,protect_new_inferences=EXCLUDED.protect_new_inferences')
            result['groups']+=1
    for identity, old in runs.items():
        if current_runs[identity]['fenced']:
            statements.append(f'UPDATE company_inference_runs SET fenced=true WHERE id={uid(identity)}')
    for identity, old in tags.items():
        latest = current_tags[identity]
        head = current_profiles[identity]['revision']
        if not any(v['entry_id']==identity and v['revision']==head and not v.get('scrubbed') for v in company_versions.values()):
            result['unavailableHeads']+=1
        statements.append(f"UPDATE profile_entries SET revision={int(head)},kind={literal(current_profiles[identity]['kind'])} WHERE id={uid(identity)}")
        statements.append(f"UPDATE company_information_tags SET origin={literal(latest['origin'])},human_protected={literal(latest['human_protected'])} WHERE profile_id={uid(identity)}")
    for identity, old in company_versions.items():
        if current_versions[identity].get('scrubbed') and not old.get('scrubbed'):
            statements.append(f"SELECT scrub_lifecycle_object('PROFILE_VERSION',{uid(identity)})")
    for identity, old in suggestions.items():
        latest = current_suggestions[identity]
        target = latest['target_id']
        if target is not None and target not in profiles:
            target = None
            result['unavailableTargets']+=1
        erase = ''
        if latest['scrubbed'] and not old['scrubbed']:
            erase = ",label='',meaning='',scrubbed=true"
            result['scrubbedSuggestions']+=1
        statements.append(f"UPDATE company_information_suggestions SET state={literal(latest['state'])},revision={int(latest['revision'])},target_id={literal(target)}::uuid{erase} WHERE id={uid(identity)}")
    # Current revocation must not be interpreted by discover() as permission for an old retry.
    statements.append("UPDATE company_analysis_items SET state='FAILED',error_code='RECOVERY_QUARANTINE',updated_at=now() WHERE state='SUCCEEDED' AND EXISTS(SELECT 1 FROM company_inference_runs r WHERE r.id=run_id AND r.fenced)")
    statements.append('COMMIT')
    sql(';\n'.join(statements)+';')
    return result
