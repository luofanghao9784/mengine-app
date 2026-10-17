-- Fixed ancestry spans platform adjustments and re-contributed enterprise variations.
-- Origin/dependency rows are append-only application facts, not user-editable mappings.
CREATE VIEW experience_general_direct_closure AS
 WITH RECURSIVE bindings(version_id,general_version_id) AS (
  SELECT version_id,general_version_id FROM experience_general_dependencies
  UNION SELECT d.version_id,b.general_version_id FROM experience_automatic_dependencies d JOIN bindings b ON b.version_id=d.dependency_version
 ) SELECT * FROM bindings;
CREATE VIEW general_experience_version_edges AS
 SELECT version_id,base_version FROM general_experience_version_dependencies
 UNION
 SELECT o.version_id,d.general_version_id FROM general_experience_origins o
 JOIN experience_general_direct_closure d ON d.version_id=o.source_version;
CREATE VIEW general_experience_ancestry AS
 WITH RECURSIVE ancestors(version_id,base_version) AS (
  SELECT id,id FROM general_experience_versions
  UNION SELECT a.version_id,d.base_version FROM ancestors a JOIN general_experience_version_edges d ON d.version_id=a.base_version
 ) SELECT * FROM ancestors;
CREATE OR REPLACE VIEW experience_general_dependency_closure AS
 SELECT DISTINCT d.version_id,a.base_version general_version_id FROM experience_general_direct_closure d
 JOIN general_experience_ancestry a ON a.version_id=d.general_version_id;

CREATE FUNCTION general_experience_dependencies_enabled(tenant uuid,target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM general_experience_ancestry a
 JOIN general_experience_versions v ON v.id=a.base_version JOIN general_experience_entries e ON e.id=v.entry_id
 WHERE a.version_id=target AND (e.status<>'AVAILABLE' OR NOT tenant_general_experience_enabled(tenant,e.id)))
$$;
CREATE OR REPLACE FUNCTION general_experience_available(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM general_experience_versions v JOIN general_experience_entries e ON e.id=v.entry_id
  WHERE v.id=target AND e.status='AVAILABLE' AND e.published_version=v.id AND v.method IS NOT NULL) THEN RETURN false; END IF;
 IF NOT general_experience_dependencies_enabled(NULL,target) THEN RETURN false; END IF;
 RETURN general_experience_history_readable(target);
END $$;
-- Readability remains source-bound and ignores reversible use switches. Publishing does not.
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('generalization_source_available(uuid)'::regprocedure);
 IF strpos(definition,'IF EXISTS(SELECT 1 FROM experience_general_dependency_closure WHERE version_id=target) THEN RETURN false; END IF;')=0 THEN RAISE EXCEPTION 'missing temporary contribution fence'; END IF;
 EXECUTE replace(definition,'IF EXISTS(SELECT 1 FROM experience_general_dependency_closure WHERE version_id=target) THEN RETURN false; END IF;','');
END $$;
CREATE FUNCTION generalization_source_current(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE tenant uuid;
BEGIN
 IF NOT generalization_source_available(target) THEN RETURN false; END IF;
 SELECT tenant_id INTO tenant FROM experience_generalization_sources WHERE version_id=target;
 RETURN experience_general_dependencies_current(tenant,target);
END $$;
-- Direct task reads require the current selected version; inherited bases stay pinned on normal updates.
CREATE OR REPLACE VIEW general_experience_task_roots AS
 SELECT r.task_id,r.attempt_number,v.entry_id,v.id version_id,r.invalidated,a.base_version=r.version_id require_current
 FROM task_general_experience_reads r JOIN general_experience_ancestry a ON a.version_id=r.version_id
 JOIN general_experience_versions v ON v.id=a.base_version
 UNION
 SELECT r.task_id,r.attempt_number,v.entry_id,v.id,false,false FROM task_context_reads r
 JOIN experience_general_dependency_closure d ON r.kind='EXPERIENCE' AND d.version_id::text=r.version_key
 JOIN general_experience_versions v ON v.id=d.general_version_id;

DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('experience_intake_available(uuid)'::regprocedure);
 IF strpos(definition,'tenant_general_experience_enabled(i.tenant_id,s.entry_id)')=0 THEN RAISE EXCEPTION 'missing proposal usage check'; END IF;
 EXECUTE replace(definition,'tenant_general_experience_enabled(i.tenant_id,s.entry_id)','general_experience_dependencies_enabled(i.tenant_id,s.version_id)');
 definition:=pg_get_functiondef('invalidate_pending_general_suggestions(uuid,uuid,boolean)'::regprocedure);
 IF strpos(definition,'s.entry_id=entry')=0 THEN RAISE EXCEPTION 'missing proposal fence'; END IF;
 EXECUTE replace(definition,'s.entry_id=entry','(s.entry_id=entry OR (include_adjustments AND EXISTS(SELECT 1 FROM general_experience_ancestry ga JOIN general_experience_versions gv ON gv.id=ga.base_version WHERE ga.version_id=s.version_id AND gv.entry_id=entry)))');
 definition:=pg_get_functiondef('erase_general_adjustment_descendants()'::regprocedure);
 IF strpos(definition,'general_experience_version_dependencies d JOIN dependencies')=0 THEN RAISE EXCEPTION 'missing erasure closure'; END IF;
 EXECUTE replace(definition,'general_experience_version_dependencies d JOIN dependencies','general_experience_version_edges d JOIN dependencies');
END $$;

-- A stop is permanent for pending contributions, but never erases already admitted history.
CREATE FUNCTION fence_pending_general_contributions() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry uuid; tenant uuid;
BEGIN
 IF TG_TABLE_NAME='general_experience_entries' THEN
  IF NEW.status<>'STOPPED' OR NEW.status=OLD.status THEN RETURN NULL; END IF;
  entry:=NEW.id; tenant:=NULL;
 ELSE
  IF NEW.enabled THEN RETURN NULL; END IF;
  entry:=NEW.entry_id; tenant:=NEW.tenant_id;
 END IF;
 UPDATE experience_generalization_sources s SET state='SOURCE_UNAVAILABLE',error_code='GENERALIZATION_SOURCE_CHANGED',updated_at=clock_timestamp()
 WHERE s.state IN ('QUEUED','RUNNING','RETRY_WAIT','QUALIFIED') AND (tenant IS NULL OR s.tenant_id=tenant)
 AND EXISTS(SELECT 1 FROM experience_general_dependency_closure d JOIN general_experience_versions v ON v.id=d.general_version_id WHERE d.version_id=s.version_id AND v.entry_id=entry);
 RETURN NULL;
END $$;
CREATE TRIGGER general_contribution_stop AFTER UPDATE OF status ON general_experience_entries FOR EACH ROW EXECUTE FUNCTION fence_pending_general_contributions();
CREATE TRIGGER general_contribution_tenant_stop AFTER INSERT OR UPDATE OF enabled ON tenant_general_experience_usage FOR EACH ROW EXECUTE FUNCTION fence_pending_general_contributions();
