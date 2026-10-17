-- Explicit, exact-version maintenance only. Existing versions are never automatically queued.
ALTER TABLE profile_versions ADD COLUMN scrubbed boolean NOT NULL DEFAULT false;
ALTER TABLE method_versions ADD COLUMN scrubbed boolean NOT NULL DEFAULT false;
UPDATE profile_versions SET scrubbed=true WHERE value='' AND provenance='';
DO $$ DECLARE prior text; BEGIN
 SELECT pg_get_viewdef('lifecycle_object_sources'::regclass,true) INTO prior;
 EXECUTE 'CREATE OR REPLACE VIEW lifecycle_object_sources AS '||rtrim(prior,'; '||chr(10))||'
 UNION ALL SELECT ''PROFILE_VERSION''::varchar(24),v.id,e.tenant_id,e.workspace_id,
  CASE WHEN e.scope=''PERSONAL'' THEN e.account_id WHEN w.kind=''PERSONAL'' THEN w.owner_id END,NULL::varchar(24),NULL::uuid,v.created_at
  FROM profile_versions v JOIN profile_entries e ON e.id=v.entry_id LEFT JOIN workspaces w ON w.id=e.workspace_id
 UNION ALL SELECT ''METHOD_VERSION''::varchar(24),v.id,NULL::uuid,NULL::uuid,NULL::uuid,NULL::varchar(24),NULL::uuid,v.created_at FROM method_versions v';
END $$;
CREATE TRIGGER lifecycle_new_profile_version AFTER INSERT ON profile_versions FOR EACH ROW EXECUTE FUNCTION register_lifecycle_object('PROFILE_VERSION');
CREATE TRIGGER lifecycle_new_method_version AFTER INSERT ON method_versions FOR EACH ROW EXECUTE FUNCTION register_lifecycle_object('METHOD_VERSION');

-- Only real retention dependencies block ordinary maintenance, not historical IDs or lineage alone.
CREATE FUNCTION lifecycle_version_blockers(k text, target uuid) RETURNS text[] LANGUAGE sql STABLE AS $$
 SELECT coalesce(array_agg(code ORDER BY code),ARRAY[]::text[]) FROM (
  SELECT 'PROFILE_CURRENT' code WHERE k='PROFILE_VERSION' AND EXISTS(
   SELECT 1 FROM profile_versions v JOIN profile_entries e ON e.id=v.entry_id
   WHERE v.id=target AND e.revision=v.revision AND v.status IN('ACTIVE','PROPOSED') AND NOT v.scrubbed AND (v.expires_at IS NULL OR v.expires_at>now()))
  UNION ALL SELECT 'PROFILE_TASK_DEPENDENCY' WHERE k='PROFILE_VERSION' AND EXISTS(
   SELECT 1 FROM profile_versions v JOIN task_context_reads r ON r.kind='PROFILE' AND r.reference_id=v.entry_id AND r.version_key=v.revision::text
   JOIN conversation_tasks t ON t.id=r.task_id WHERE v.id=target AND t.error_code IS DISTINCT FROM 'OBJECT_REMOVED'
    AND NOT EXISTS(SELECT 1 FROM object_lifecycle l WHERE l.kind='TASK' AND l.object_id=t.id AND l.state='PURGED'))
  UNION ALL SELECT 'METHOD_CURRENT' WHERE k='METHOD_VERSION' AND EXISTS(SELECT 1 FROM method_families f WHERE f.head_version=target OR f.published_version=target)
  UNION ALL SELECT 'METHOD_ACTIVE_ADOPTION' WHERE k='METHOD_VERSION' AND EXISTS(SELECT 1 FROM method_adoptions a WHERE a.version_id=target AND a.status='ACTIVE')
  UNION ALL SELECT 'METHOD_COMPARISON_DEPENDENCY' WHERE k='METHOD_VERSION' AND EXISTS(
   SELECT 1 FROM method_comparisons c WHERE c.baseline_version=target AND (
    EXISTS(SELECT 1 FROM method_families f WHERE f.head_version=c.candidate_version)
    OR EXISTS(SELECT 1 FROM method_releases r WHERE r.comparison_id=c.id AND (
      EXISTS(SELECT 1 FROM method_families f WHERE f.published_version=r.version_id)
      OR EXISTS(SELECT 1 FROM method_adoptions a WHERE a.version_id=r.version_id AND a.status='ACTIVE')))))
 ) reasons;
$$;
-- Existing recursive gate continues through this wrapper, including profile reads fixed by entry/revision.
ALTER FUNCTION object_is_active_internal(text,uuid,text[]) RENAME TO object_is_active_v39;
CREATE FUNCTION object_is_active_internal(k text,target uuid,visited text[]) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT object_is_active_v39(k,target,visited)
 AND (k<>'PROFILE_VERSION' OR EXISTS(SELECT 1 FROM profile_versions v WHERE v.id=target AND NOT v.scrubbed))
 AND (k<>'METHOD_VERSION' OR EXISTS(SELECT 1 FROM method_versions v WHERE v.id=target AND NOT v.scrubbed))
 AND NOT EXISTS(SELECT 1 FROM task_context_reads r WHERE k='TASK' AND r.task_id=target AND r.kind='PROFILE'
  AND NOT EXISTS(SELECT 1 FROM profile_versions v WHERE v.entry_id=r.reference_id AND v.revision::text=r.version_key AND object_is_active_v39('PROFILE_VERSION',v.id,array_append(visited,k||':'||target::text)) AND NOT v.scrubbed));
$$;
-- Low-level erasure is shared by online cleanup and authoritative restore. Online callers check
-- blockers first. Restore reconciles current task/family/adoption authority before replaying erasure.
ALTER FUNCTION scrub_lifecycle_object_internal(text,uuid,text[]) RENAME TO scrub_lifecycle_object_v39;
CREATE FUNCTION scrub_lifecycle_object_internal(k text,target uuid,visited text[]) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF k NOT IN('PROFILE_VERSION','METHOD_VERSION') THEN PERFORM scrub_lifecycle_object_v39(k,target,visited);RETURN;END IF;
 IF (k||':'||target::text)=ANY(visited) THEN RETURN;END IF;
 INSERT INTO object_lifecycle(kind,object_id,tenant_id,workspace_id,owner_id,parent_kind,parent_id,original_anchor)
 SELECT kind,object_id,tenant_id,workspace_id,owner_id,parent_kind,parent_id,original_anchor FROM lifecycle_object_sources
 WHERE kind=k AND object_id=target ON CONFLICT(kind,object_id) DO NOTHING;
 IF k='PROFILE_VERSION' THEN
  UPDATE profile_versions SET value='',provenance='',scrubbed=true WHERE id=target;
 ELSE
  UPDATE method_versions SET configuration='{}'::jsonb,rationale='',scrubbed=true WHERE id=target;
 END IF;
 UPDATE object_lifecycle SET state='PURGED',revision=revision+1,completed_at=coalesce(completed_at,now()),changed_at=now(),error_code=NULL WHERE kind=k AND object_id=target AND state<>'PURGED';
END $$;
CREATE FUNCTION version_body_tombstone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='profile_versions' THEN
  IF OLD.scrubbed AND (NOT NEW.scrubbed OR NEW.value<>'' OR NEW.provenance<>'') THEN RAISE EXCEPTION 'profile version body cannot be resurrected';END IF;
  IF NEW.value='' AND NEW.provenance='' THEN NEW.scrubbed:=true;END IF;
 ELSE
  IF OLD.scrubbed AND (NOT NEW.scrubbed OR NEW.configuration<>'{}'::jsonb OR NEW.rationale<>'') THEN RAISE EXCEPTION 'method version body cannot be resurrected';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER profile_version_tombstone BEFORE UPDATE ON profile_versions FOR EACH ROW EXECUTE FUNCTION version_body_tombstone();
CREATE TRIGGER method_version_tombstone BEFORE UPDATE ON method_versions FOR EACH ROW EXECUTE FUNCTION version_body_tombstone();
