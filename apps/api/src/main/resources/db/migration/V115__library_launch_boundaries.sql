-- Independent ranges stop inherited allows; explicit ancestor denials always apply.
CREATE OR REPLACE FUNCTION library_projected_mask(actor uuid, tenant uuid, kind text, target uuid, moving_kind text DEFAULT NULL, moving_id uuid DEFAULT NULL, destination uuid DEFAULT NULL, force_inherit boolean DEFAULT false) RETURNS integer LANGUAGE plpgsql STABLE AS $$
DECLARE space uuid; current_kind text:=kind; current_id uuid:=target; parent uuid; w record; p record; g record;
 allowed integer:=0; denied boolean:=false; download_denied boolean:=false; depth integer:=0; permission uuid; inherit_allows boolean:=true;
BEGIN
 permission:=headquarters_permission_actor(actor,tenant);
 IF NOT EXISTS(SELECT 1 FROM tenant_memberships m JOIN accounts a ON a.id=m.account_id JOIN tenants t ON t.id=m.tenant_id
   WHERE m.tenant_id=tenant AND m.account_id=permission AND m.status='ACTIVE' AND a.status='ACTIVE' AND t.status='ACTIVE') THEN RETURN 0; END IF;
 IF kind='WORKSPACE' THEN space:=target;
 ELSIF kind='FOLDER' THEN SELECT workspace_id INTO space FROM material_folders WHERE tenant_id=tenant AND id=target;
 ELSIF kind='MATERIAL' THEN SELECT workspace_id INTO space FROM materials WHERE tenant_id=tenant AND id=target;
 ELSE RETURN 0; END IF;
 SELECT * INTO w FROM workspaces WHERE tenant_id=tenant AND id=space AND NOT archived;
 IF NOT FOUND OR NOT departure_content_readable(permission,tenant,space) THEN RETURN 0; END IF;
 IF w.kind='PERSONAL' THEN RETURN CASE WHEN w.owner_id=permission THEN 15 ELSE 0 END; END IF;
 IF NOT library_permissions_enabled(tenant) THEN
   SELECT * INTO g FROM workspace_members WHERE tenant_id=tenant AND workspace_id=space AND account_id=permission;
   RETURN CASE WHEN NOT FOUND THEN 0 WHEN g.can_maintain THEN 15 ELSE 5 END;
 END IF;
 LOOP
   depth:=depth+1; IF depth>34 THEN RETURN 0; END IF;
   SELECT * INTO p FROM library_policies WHERE tenant_id=tenant AND object_kind=current_kind AND object_id=current_id;
   FOR g IN SELECT a.* FROM library_grants a WHERE a.tenant_id=tenant AND a.object_kind=current_kind AND a.object_id=current_id AND
     ((a.principal_kind='ACCOUNT' AND a.principal_id=permission) OR (a.principal_kind='DEPARTMENT' AND EXISTS(
       SELECT 1 FROM library_department_members d WHERE d.tenant_id=tenant AND d.department_id=a.principal_id AND d.account_id=permission)))
     AND (a.role_department_id IS NULL OR EXISTS(SELECT 1 FROM library_department_members d WHERE d.tenant_id=tenant AND d.department_id=a.role_department_id AND d.account_id=permission))
   LOOP
     IF g.content='NONE' THEN denied:=true;
     ELSIF inherit_allows THEN allowed:=allowed | CASE WHEN g.content='EDIT' THEN 3 ELSE 1 END;
       IF g.manage_files THEN allowed:=allowed | 8; END IF;
     END IF;
     IF inherit_allows AND g.download='ALLOW' THEN allowed:=allowed | 4; END IF;
     IF g.download='DENY' THEN download_denied:=true; END IF;
   END LOOP;
   IF p.inherit=false AND NOT (coalesce(current_kind=moving_kind AND current_id=moving_id,false) AND force_inherit) THEN inherit_allows:=false; END IF;
   IF current_kind='WORKSPACE' THEN
     SELECT * INTO g FROM workspace_members WHERE tenant_id=tenant AND workspace_id=space AND account_id=permission;
     IF FOUND AND inherit_allows THEN allowed:=allowed | CASE WHEN g.can_maintain THEN 7 ELSE 5 END; END IF;
     EXIT;
   ELSIF current_kind=moving_kind AND current_id=moving_id THEN parent:=destination;
   ELSIF current_kind='MATERIAL' THEN SELECT folder_id INTO parent FROM materials WHERE tenant_id=tenant AND id=current_id;
   ELSE SELECT parent_id INTO parent FROM material_folders WHERE tenant_id=tenant AND id=current_id; END IF;
   current_kind:=CASE WHEN parent IS NULL THEN 'WORKSPACE' ELSE 'FOLDER' END;
   current_id:=coalesce(parent,space);
 END LOOP;
 IF denied OR (allowed & 1)=0 THEN RETURN 0; END IF;
 IF download_denied THEN allowed:=allowed & ~4; END IF;
 RETURN allowed;
END $$;

CREATE FUNCTION library_task_versions(target uuid) RETURNS TABLE(version_id uuid) LANGUAGE sql STABLE AS $$
 WITH RECURSIVE tasks(id) AS (
  SELECT target UNION
  SELECT dep.source FROM tasks t CROSS JOIN LATERAL (
   SELECT reference_id source FROM task_context_reads WHERE task_id=t.id AND kind='HISTORY'
   UNION SELECT e.task_id FROM task_context_reads c JOIN experience_evidence e ON e.version_id::text=c.version_key AND e.kind='TASK' WHERE c.task_id=t.id AND c.kind='EXPERIENCE'
   UNION SELECT source_task_id FROM dataset_task_edges WHERE task_id=t.id
   UNION SELECT d.source_task_id FROM conversation_tasks ct JOIN briefing_discussions d ON d.conversation_id=ct.conversation_id WHERE ct.id=t.id
  ) dep
 ) SELECT c.version_id FROM tasks t JOIN conversation_sources s ON s.task_id=t.id JOIN knowledge_chunks c ON c.id=s.chunk_id
 UNION SELECT o.version_id FROM tasks t JOIN conversation_originals o ON o.task_id=t.id
 UNION SELECT c.version_id FROM tasks t JOIN conversation_agent_grants g ON g.task_id=t.id JOIN knowledge_chunks c ON c.id=g.chunk_id
 UNION SELECT s.version_id FROM tasks t JOIN feedback_task_sources s ON s.task_id=t.id
 UNION SELECT s.version_id FROM tasks t JOIN task_context_materials s ON s.task_id=t.id
 UNION SELECT e.material_version_id FROM tasks t JOIN task_context_reads c ON c.task_id=t.id AND c.kind='EXPERIENCE' JOIN experience_evidence e ON e.version_id::text=c.version_key AND e.kind='MATERIAL_VERSION'
$$;
CREATE FUNCTION library_file_mask(actor uuid,tenant uuid,target uuid,visited uuid[] DEFAULT ARRAY[]::uuid[], moving_kind text DEFAULT NULL, moving_id uuid DEFAULT NULL, destination uuid DEFAULT NULL, force_inherit boolean DEFAULT false) RETURNS integer LANGUAGE plpgsql STABLE AS $$
DECLARE result integer; dependency record; source_mask integer;
BEGIN
 IF target=ANY(visited) OR cardinality(visited)>32 THEN RETURN 0; END IF;
 result:=library_projected_mask(actor,tenant,'MATERIAL',target,moving_kind,moving_id,destination,force_inherit);
 IF NOT library_permissions_enabled(tenant) OR result=0 THEN RETURN result; END IF;
 FOR dependency IN SELECT DISTINCT v.material_id FROM document_publications p
  JOIN private_documents d ON d.id=p.document_id
  CROSS JOIN LATERAL library_task_versions(d.source_task_id) s
  LEFT JOIN material_versions v ON v.id=s.version_id AND v.tenant_id=tenant
  WHERE p.tenant_id=tenant AND p.material_id=target LOOP
  IF dependency.material_id IS NULL OR NOT EXISTS(SELECT 1 FROM active_materials WHERE id=dependency.material_id AND tenant_id=tenant) THEN RETURN 0; END IF;
  source_mask:=library_file_mask(actor,tenant,dependency.material_id,array_append(visited,target),moving_kind,moving_id,destination,force_inherit);
  IF (source_mask&1)=0 THEN RETURN 0; END IF;
  IF (source_mask&4)=0 THEN result:=result & ~4; END IF;
 END LOOP;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION library_mask(actor uuid,tenant uuid,kind text,target uuid) RETURNS integer LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN kind='MATERIAL' THEN library_file_mask(actor,tenant,target) ELSE library_projected_mask(actor,tenant,kind,target) END
$$;
CREATE FUNCTION library_task_sources_allowed(actor uuid,tenant uuid,target uuid,download boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM library_task_versions(target) s LEFT JOIN material_versions v ON v.id=s.version_id AND v.tenant_id=tenant
 WHERE NOT EXISTS(SELECT 1 FROM active_materials m WHERE m.id=v.material_id AND m.tenant_id=tenant
 AND (library_mask(actor,tenant,'MATERIAL',m.id)&CASE WHEN download THEN 5 ELSE 1 END)=CASE WHEN download THEN 5 ELSE 1 END))
$$;
-- A durable intent is recorded before dispatch; outcome rows are append-only.
CREATE TABLE library_request_journal (
 id bigserial PRIMARY KEY, request_id uuid NOT NULL, actor_id uuid, tenant_id uuid,
 method varchar(12) NOT NULL, route text NOT NULL, phase varchar(24) NOT NULL,
 status integer, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION library_journal_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Library journal is append only'; END $$;
CREATE TRIGGER library_journal_immutable BEFORE UPDATE OR DELETE ON library_request_journal FOR EACH ROW EXECUTE FUNCTION library_journal_immutable();

CREATE FUNCTION library_effective_projected_mask(actor uuid,tenant uuid,kind text,target uuid,moving_kind text,moving_id uuid,destination uuid,force_inherit boolean) RETURNS integer LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN kind='MATERIAL' THEN library_file_mask(actor,tenant,target,ARRAY[]::uuid[],moving_kind,moving_id,destination,force_inherit)
 ELSE library_projected_mask(actor,tenant,kind,target,moving_kind,moving_id,destination,force_inherit) END
$$;
CREATE OR REPLACE FUNCTION library_task_readable(target uuid, visited uuid[] DEFAULT ARRAY[]::uuid[]) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE task record; discussion record;
BEGIN
 IF target=ANY(visited) OR cardinality(visited)>=32 THEN RETURN false; END IF;
 SELECT * INTO task FROM conversation_tasks WHERE id=target;
 IF NOT FOUND THEN RETURN false; END IF;
 IF NOT library_permissions_enabled(task.tenant_id) THEN RETURN false; END IF;
 IF NOT object_is_active('TASK',target) THEN RETURN false; END IF;
 IF NOT task_datasets_readable(target) OR NOT task_general_experiences_readable(target) THEN RETURN false; END IF;
 IF NOT library_task_sources_allowed(task.requested_by,task.tenant_id,target,false) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM task_context_reads r JOIN conversation_tasks source ON source.id=r.reference_id
   WHERE r.task_id=target AND r.kind='HISTORY' AND (source.tenant_id<>task.tenant_id OR NOT object_is_active('TASK',source.id))) THEN RETURN false; END IF;
 FOR discussion IN SELECT d.* FROM briefing_discussions d WHERE d.conversation_id=task.conversation_id LOOP
  IF NOT EXISTS(SELECT 1 FROM conversation_tasks source WHERE source.id=discussion.source_task_id
     AND source.tenant_id=task.tenant_id AND source.requested_by=task.requested_by
     AND source.revision=discussion.source_revision AND source.attempt=discussion.source_attempt AND source.status='SUCCEEDED')
     OR NOT library_task_readable(discussion.source_task_id,array_append(visited,target)) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION company_chunk_eligible(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM knowledge_chunks c JOIN knowledge_runs r ON r.id=c.run_id
 JOIN active_materials m ON m.id=c.material_id JOIN workspaces w ON w.id=m.workspace_id
 JOIN tenants t ON t.id=m.tenant_id
 WHERE c.id=target AND m.in_library AND w.kind='SHARED' AND t.status='ACTIVE' AND length(c.content)>0
 AND r.status IN ('READY','PARTIAL')
 AND EXISTS(SELECT 1 FROM tenant_memberships a WHERE a.tenant_id=t.id AND a.status='ACTIVE')
 AND NOT EXISTS(SELECT 1 FROM tenant_memberships a WHERE a.tenant_id=t.id AND a.status='ACTIVE'
   AND (library_mask(a.account_id,t.id,'MATERIAL',m.id)&1)=0))
$$;

DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('generalization_source_available(uuid)'::regprocedure);
 definition:=replace(definition,'mv.workspace_id=w.id','mv.workspace_id=w.id AND (library_mask(s.actor_id,e.tenant_id,''MATERIAL'',am.id)&1)=1');
 EXECUTE definition;
END $$;

DO $$ DECLARE fn record; definition text; prior text; BEGIN
 FOR fn IN SELECT oid FROM pg_proc WHERE pronamespace=current_schema()::regnamespace AND proname IN ('experience_intake_available','experience_intake_available_before_general','experience_intake_available_before_adjustment') LOOP
  definition:=pg_get_functiondef(fn.oid);
  definition:=replace(definition,'mv.workspace_id=w.id','mv.workspace_id=w.id AND (library_mask(headquarters_source_permission_actor(i.owner_id,i.tenant_id,i.id),e.tenant_id,''MATERIAL'',am.id)&1)=1');
  definition:=replace(definition,'v.access_mode=''INDEPENDENT_COPY'' OR','(v.access_mode=''INDEPENDENT_COPY'' AND NOT library_permissions_enabled(e.tenant_id)) OR');
  EXECUTE definition;
 END LOOP;
 prior:=regexp_replace(pg_get_viewdef('readable_feedback'::regclass,true), ';\s*$', '');
 EXECUTE 'CREATE OR REPLACE VIEW readable_feedback AS SELECT prior.id FROM ('||prior||') prior JOIN feedback_entries f ON f.id=prior.id
 WHERE NOT library_permissions_enabled(f.tenant_id) OR NOT EXISTS(SELECT 1 FROM feedback_source_versions s JOIN material_versions v ON v.id=s.version_id WHERE s.feedback_id=f.id AND (library_mask(f.actor_id,f.tenant_id,''MATERIAL'',v.material_id)&1)=0)';
END $$;
CREATE INDEX library_journal_request ON library_request_journal(request_id,id DESC);
CREATE INDEX library_journal_tenant ON library_request_journal(tenant_id,id DESC) WHERE phase='RECEIVED';

-- The legacy task view already enforces legacy source-space access. Avoid repeating
-- the new evaluator when the rollout is off, particularly in long history lists.
CREATE OR REPLACE FUNCTION library_task_materials_readable(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE t record;
BEGIN
 SELECT tenant_id,requested_by INTO t FROM conversation_tasks WHERE id=target;
 IF NOT FOUND THEN RETURN false; END IF;
 IF NOT library_permissions_enabled(t.tenant_id) THEN RETURN true; END IF;
 RETURN library_task_sources_allowed(t.requested_by,t.tenant_id,target,false);
END $$;
-- Evaluate one actual task before expanding its dependency graph. In particular,
-- avoid optimizer hashing the recursive readability view across unrelated tenants.
DO $$ BEGIN
 EXECUTE 'CREATE VIEW library_legacy_source_tasks AS ' || pg_get_viewdef('readable_source_tasks'::regclass,true);
END $$;
CREATE FUNCTION library_dispatch_task_readable(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE tenant uuid;
BEGIN
 SELECT tenant_id INTO tenant FROM conversation_tasks WHERE id=target;
 IF NOT FOUND THEN RETURN false; END IF;
 IF library_permissions_enabled(tenant) THEN RETURN library_task_readable(target); END IF;
 RETURN EXISTS(SELECT 1 FROM library_legacy_source_tasks WHERE id=target);
END $$;
CREATE OR REPLACE VIEW readable_source_tasks AS SELECT id FROM conversation_tasks WHERE library_dispatch_task_readable(id);
