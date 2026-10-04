-- Private feedback/proposals against a fixed cleaned method. Only checked outputs become local methods.
CREATE TABLE general_experience_suggestions (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,workspace_id uuid NOT NULL,actor_id uuid NOT NULL,
 entry_id uuid NOT NULL REFERENCES general_experience_entries(id),version_id uuid NOT NULL REFERENCES general_experience_versions(id),
 intent varchar(24) NOT NULL CHECK(intent IN ('FEEDBACK','ADAPTATION')),content jsonb,
 finished boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES tenant_memberships(tenant_id,account_id)
);
CREATE UNIQUE INDEX general_suggestion_pending ON general_experience_suggestions(tenant_id,workspace_id,actor_id,entry_id) WHERE NOT finished;
ALTER TABLE experience_intake_sources ALTER COLUMN kind TYPE varchar(32);
ALTER TABLE experience_intake_sources ADD COLUMN general_suggestion_id uuid REFERENCES general_experience_suggestions(id);
ALTER TABLE experience_intake_sources DROP CONSTRAINT experience_intake_sources_kind_check;
ALTER TABLE experience_intake_sources DROP CONSTRAINT experience_intake_sources_check;
ALTER TABLE experience_intake_sources ADD CHECK(kind IN('TASK','FEEDBACK','ADJUSTMENT','GENERAL_SUGGESTION'));
ALTER TABLE experience_intake_sources ADD CHECK(
 (kind='TASK' AND task_id IS NOT NULL AND source_id=task_id AND feedback_id IS NULL AND adjustment_id IS NULL AND general_suggestion_id IS NULL)
 OR (kind='FEEDBACK' AND feedback_id IS NOT NULL AND source_id=feedback_id AND adjustment_id IS NULL AND general_suggestion_id IS NULL)
 OR (kind='ADJUSTMENT' AND adjustment_id IS NOT NULL AND source_id=adjustment_id AND id=adjustment_id AND task_id IS NULL AND feedback_id IS NULL AND general_suggestion_id IS NULL)
 OR (kind='GENERAL_SUGGESTION' AND general_suggestion_id IS NOT NULL AND source_id=general_suggestion_id AND id=general_suggestion_id AND task_id IS NULL AND feedback_id IS NULL AND adjustment_id IS NULL));
CREATE TABLE experience_general_dependencies (
 version_id uuid NOT NULL REFERENCES experience_versions(id),general_version_id uuid NOT NULL REFERENCES general_experience_versions(id),
 PRIMARY KEY(version_id,general_version_id)
);
-- Include inherited local adjustments without copying, replacing or relinking their original evidence.
CREATE VIEW experience_general_dependency_closure AS
 WITH RECURSIVE bindings(version_id,general_version_id) AS (
  SELECT version_id,general_version_id FROM experience_general_dependencies
  UNION SELECT d.version_id,b.general_version_id FROM experience_automatic_dependencies d JOIN bindings b ON b.version_id=d.dependency_version
 ) SELECT * FROM bindings;
CREATE FUNCTION experience_general_dependencies_readable(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE dependency uuid;
BEGIN
 FOR dependency IN SELECT general_version_id FROM experience_general_dependency_closure WHERE version_id=target LOOP
  IF NOT general_experience_history_readable(dependency) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
CREATE FUNCTION experience_general_dependencies_current(tenant uuid,target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE dependency record;
BEGIN
 FOR dependency IN SELECT v.id,e.id entry_id,e.status FROM experience_general_dependency_closure d JOIN general_experience_versions v ON v.id=d.general_version_id JOIN general_experience_entries e ON e.id=v.entry_id WHERE d.version_id=target LOOP
  IF dependency.status<>'AVAILABLE' OR NOT general_experience_history_readable(dependency.id) OR NOT tenant_general_experience_enabled(tenant,dependency.entry_id) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
-- Preserve all existing TASK/FEEDBACK/ADJUSTMENT source rules through the original function identity.
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('experience_intake_available(uuid)'::regprocedure);
 IF strpos(definition,'public.experience_intake_available(')=0 THEN RAISE EXCEPTION 'missing intake definition'; END IF;
 EXECUTE replace(definition,'public.experience_intake_available(','public.experience_intake_available_before_general(');
END $$;
CREATE OR REPLACE FUNCTION experience_intake_available(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE i experience_intake_sources%ROWTYPE; s general_experience_suggestions%ROWTYPE; a experience_adjustments%ROWTYPE;
BEGIN
 SELECT * INTO i FROM experience_intake_sources WHERE id=target AND state='PENDING';
 IF NOT FOUND THEN RETURN false; END IF;
 IF i.kind<>'GENERAL_SUGGESTION' THEN
  IF NOT experience_intake_available_before_general(target) THEN RETURN false; END IF;
  IF i.kind='ADJUSTMENT' THEN
   SELECT * INTO a FROM experience_adjustments WHERE id=i.adjustment_id;
   IF NOT a.finished AND NOT experience_general_dependencies_current(i.tenant_id,a.version_id) THEN RETURN false; END IF;
  END IF;
  RETURN true;
 END IF;
 SELECT * INTO s FROM general_experience_suggestions WHERE id=i.general_suggestion_id;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM tenants t JOIN tenant_memberships m ON m.tenant_id=t.id AND m.account_id=i.owner_id AND m.status='ACTIVE'
  JOIN accounts acct ON acct.id=m.account_id AND acct.status='ACTIVE' JOIN workspaces w ON w.id=i.workspace_id AND w.tenant_id=t.id AND w.kind='SHARED'
  JOIN workspace_members g ON g.workspace_id=w.id AND g.tenant_id=w.tenant_id AND g.account_id=i.owner_id
  WHERE t.id=i.tenant_id AND t.status IN ('ACTIVE','SUSPENDED')) OR NOT departure_content_readable(i.owner_id,i.tenant_id,i.workspace_id) THEN RETURN false; END IF;
 IF NOT s.finished AND (s.content IS NULL OR NOT general_experience_available(s.version_id) OR NOT tenant_general_experience_enabled(i.tenant_id,s.entry_id)
  OR NOT EXISTS(SELECT 1 FROM governance_capabilities g WHERE g.tenant_id=i.tenant_id AND g.account_id=i.owner_id AND g.workspace_id=i.workspace_id AND g.capability='EXPERIENCE_MAINTAIN')) THEN RETURN false; END IF;
 RETURN general_experience_history_readable(s.version_id);
END $$;
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('object_is_active_internal(text,uuid,text[])'::regprocedure);
 IF strpos(definition,'IF k=''TASK'' THEN')=0 THEN RAISE EXCEPTION 'missing lifecycle boundary'; END IF;
 EXECUTE replace(definition,'IF k=''TASK'' THEN','IF k=''EXPERIENCE_VERSION'' AND NOT experience_general_dependencies_readable(target) THEN RETURN false; END IF;
 IF k=''TASK'' THEN');
END $$;
-- Direct model references follow current publication. Local versions remain pinned across normal general updates.
CREATE VIEW general_experience_task_roots AS
 SELECT task_id,attempt_number,entry_id,version_id,invalidated,true require_current FROM task_general_experience_reads
 UNION
 SELECT r.task_id,r.attempt_number,v.entry_id,v.id,false,false FROM task_context_reads r
 JOIN experience_general_dependency_closure d ON r.kind='EXPERIENCE' AND d.version_id::text=r.version_key
 JOIN general_experience_versions v ON v.id=d.general_version_id;
CREATE FUNCTION task_general_experience_dependency_status(target uuid) RETURNS TABLE(entry_id uuid,version_id uuid,invalidated boolean,require_current boolean) LANGUAGE sql STABLE AS $$
 WITH RECURSIVE related(id) AS (SELECT target UNION SELECT e.source_task_id FROM dataset_task_edges e JOIN related r ON r.id=e.task_id)
 SELECT g.entry_id,g.version_id,bool_or(g.invalidated),bool_or(g.require_current) FROM related r JOIN general_experience_task_roots g ON g.task_id=r.id
 JOIN conversation_tasks t ON t.id=target WHERE g.task_id<>target OR g.attempt_number=t.attempt GROUP BY g.entry_id,g.version_id
$$;
CREATE OR REPLACE FUNCTION task_general_experience_dependencies(target uuid) RETURNS TABLE(entry_id uuid,version_id uuid,invalidated boolean) LANGUAGE sql STABLE AS $$
 SELECT entry_id,version_id,invalidated FROM task_general_experience_dependency_status(target)
$$;
CREATE OR REPLACE FUNCTION task_general_experiences_current(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE dependency record; tenant uuid;
BEGIN
 SELECT tenant_id INTO tenant FROM conversation_tasks WHERE id=target;
 FOR dependency IN SELECT * FROM task_general_experience_dependency_status(target) LOOP
  IF dependency.invalidated OR NOT tenant_general_experience_enabled(tenant,dependency.entry_id) THEN RETURN false; END IF;
  IF dependency.require_current THEN
   IF NOT general_experience_available(dependency.version_id) THEN RETURN false; END IF;
  ELSIF NOT general_experience_history_readable(dependency.version_id) OR NOT EXISTS(SELECT 1 FROM general_experience_entries e WHERE e.id=dependency.entry_id AND e.status='AVAILABLE') THEN RETURN false;
  END IF;
 END LOOP;
 RETURN true;
END $$;
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('fence_general_experience_tasks()'::regprocedure);
 IF strpos(definition,'SELECT task_id FROM task_general_experience_reads WHERE entry_id=NEW.id')=0 THEN RAISE EXCEPTION 'missing global task fence'; END IF;
 EXECUTE replace(definition,'SELECT task_id FROM task_general_experience_reads WHERE entry_id=NEW.id','SELECT task_id FROM general_experience_task_roots WHERE entry_id=NEW.id AND (NEW.status<>OLD.status OR require_current)');
 definition:=pg_get_functiondef('fence_tenant_general_experience_tasks()'::regprocedure);
 IF strpos(definition,'SELECT task_id FROM task_general_experience_reads WHERE entry_id=NEW.entry_id')=0 THEN RAISE EXCEPTION 'missing tenant task fence'; END IF;
 EXECUTE replace(definition,'SELECT task_id FROM task_general_experience_reads WHERE entry_id=NEW.entry_id','SELECT task_id FROM general_experience_task_roots WHERE entry_id=NEW.entry_id');
END $$;
CREATE FUNCTION invalidate_pending_general_suggestions(entry uuid,tenant uuid,include_adjustments boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE experience_intake_sources i SET state='SOURCE_UNAVAILABLE',reason='SOURCE_CHANGED',invalidated_at=now()
 FROM general_experience_suggestions s WHERE i.general_suggestion_id=s.id AND s.entry_id=entry AND NOT s.finished AND (tenant IS NULL OR s.tenant_id=tenant) AND i.state='PENDING';
 IF include_adjustments THEN
 UPDATE experience_intake_sources i SET state='SOURCE_UNAVAILABLE',reason='SOURCE_CHANGED',invalidated_at=now()
 FROM experience_adjustments a WHERE i.adjustment_id=a.id AND NOT a.finished AND (tenant IS NULL OR a.tenant_id=tenant) AND i.state='PENDING'
 AND EXISTS(SELECT 1 FROM experience_general_dependency_closure d JOIN general_experience_versions v ON v.id=d.general_version_id WHERE d.version_id=a.version_id AND v.entry_id=entry);
 END IF;
END $$;
CREATE FUNCTION fence_general_suggestions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='general_experience_entries' THEN
  IF (NEW.status,NEW.published_version) IS DISTINCT FROM (OLD.status,OLD.published_version) THEN PERFORM invalidate_pending_general_suggestions(NEW.id,NULL,NEW.status<>'AVAILABLE'); END IF;
 ELSIF TG_TABLE_NAME='tenant_general_experience_usage' THEN
  IF NOT NEW.enabled THEN PERFORM invalidate_pending_general_suggestions(NEW.entry_id,NEW.tenant_id,true); END IF;
 ELSIF TG_TABLE_NAME='general_experience_versions' THEN
  IF NEW.method IS NULL AND OLD.method IS NOT NULL THEN
   UPDATE experience_intake_sources i SET state='SOURCE_UNAVAILABLE',reason='SOURCE_CHANGED',invalidated_at=now()
   FROM general_experience_suggestions s WHERE i.general_suggestion_id=s.id AND s.version_id=NEW.id AND i.state='PENDING';
  END IF;
 ELSIF TG_TABLE_NAME='governance_capabilities' THEN
  IF OLD.capability='EXPERIENCE_MAINTAIN' THEN
   UPDATE experience_intake_sources i SET state='SOURCE_UNAVAILABLE',reason='AUTHORITY_CHANGED',invalidated_at=now()
   FROM general_experience_suggestions s WHERE i.general_suggestion_id=s.id AND NOT s.finished AND s.tenant_id=OLD.tenant_id AND s.workspace_id=OLD.workspace_id AND s.actor_id=OLD.account_id AND i.state='PENDING';
  END IF;
 ELSIF TG_TABLE_NAME='experience_intake_sources' THEN
  IF NEW.kind='GENERAL_SUGGESTION' AND NEW.state='SOURCE_UNAVAILABLE' THEN UPDATE general_experience_suggestions SET finished=true,content=NULL WHERE id=NEW.general_suggestion_id; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER general_suggestions_entry AFTER UPDATE OF status,published_version ON general_experience_entries FOR EACH ROW EXECUTE FUNCTION fence_general_suggestions();
CREATE TRIGGER general_suggestions_usage AFTER INSERT OR UPDATE OF enabled ON tenant_general_experience_usage FOR EACH ROW EXECUTE FUNCTION fence_general_suggestions();
CREATE TRIGGER general_suggestions_body AFTER UPDATE OF method ON general_experience_versions FOR EACH ROW EXECUTE FUNCTION fence_general_suggestions();
CREATE TRIGGER general_suggestions_authority AFTER DELETE OR UPDATE ON governance_capabilities FOR EACH ROW EXECUTE FUNCTION fence_general_suggestions();
CREATE TRIGGER general_suggestions_intake AFTER UPDATE OF state ON experience_intake_sources FOR EACH ROW EXECUTE FUNCTION fence_general_suggestions();

-- Local adaptations are not independent contributions. Do not recirculate them as new general assets
-- until general-to-general provenance and recursive stop propagation are implemented.
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('generalization_source_available(uuid)'::regprocedure);
 IF strpos(definition,'SELECT * INTO s FROM experience_generalization_sources')=0 THEN RAISE EXCEPTION 'missing generalization boundary'; END IF;
 EXECUTE replace(definition,'SELECT * INTO s FROM experience_generalization_sources','IF EXISTS(SELECT 1 FROM experience_general_dependency_closure WHERE version_id=target) THEN RETURN false; END IF;
 SELECT * INTO s FROM experience_generalization_sources');
END $$;
