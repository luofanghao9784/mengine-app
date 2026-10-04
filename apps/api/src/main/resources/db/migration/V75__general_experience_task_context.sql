-- Fixed cleaned-version references only. Never copy enterprise contribution identity into another tenant.
CREATE TABLE task_general_experience_reads (
 task_id uuid NOT NULL,attempt_number integer NOT NULL,entry_id uuid NOT NULL REFERENCES general_experience_entries(id),
 version_id uuid NOT NULL REFERENCES general_experience_versions(id),read_bits integer NOT NULL DEFAULT 0 CHECK(read_bits BETWEEN 0 AND 1023),
 invalidated boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(task_id,attempt_number,entry_id),FOREIGN KEY(task_id,attempt_number) REFERENCES conversation_attempts(task_id,attempt_number)
);
CREATE INDEX task_general_version ON task_general_experience_reads(version_id);
CREATE TABLE task_general_experience_reviews (
 id uuid PRIMARY KEY,task_id uuid NOT NULL,attempt_number integer NOT NULL,entry_id uuid NOT NULL REFERENCES general_experience_entries(id),
 version_id uuid NOT NULL REFERENCES general_experience_versions(id),request_id uuid NOT NULL,request_hash varchar(64) NOT NULL,
 decision varchar(24) NOT NULL CHECK(decision IN ('DIRECT','ADAPTED','UNKNOWN','NOT_APPLICABLE')),
 conditions varchar(1000) NOT NULL,adjustments varchar(1000) NOT NULL,scrubbed boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(task_id,attempt_number,request_id),FOREIGN KEY(task_id,attempt_number) REFERENCES conversation_attempts(task_id,attempt_number)
);
CREATE TABLE task_general_experience_fences (
 task_id uuid NOT NULL,attempt_number integer NOT NULL,PRIMARY KEY(task_id,attempt_number),
 FOREIGN KEY(task_id,attempt_number) REFERENCES conversation_attempts(task_id,attempt_number)
);
-- Select exact dependencies before calling recursive source checks.
CREATE OR REPLACE FUNCTION generalization_source_available(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE s experience_generalization_sources%ROWTYPE; dependency record; input_source uuid;
BEGIN
 SELECT * INTO s FROM experience_generalization_sources WHERE version_id=target AND state<>'SOURCE_UNAVAILABLE';
 IF NOT FOUND THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM tenants t JOIN tenant_memberships m ON m.tenant_id=t.id AND m.account_id=s.actor_id AND m.status='ACTIVE'
 JOIN accounts a ON a.id=m.account_id AND a.status='ACTIVE' JOIN workspaces w ON w.id=s.workspace_id AND w.tenant_id=t.id
 WHERE t.id=s.tenant_id AND t.status IN ('ACTIVE','SUSPENDED') AND ((w.kind='PERSONAL' AND w.owner_id=s.actor_id) OR EXISTS(SELECT 1 FROM workspace_members g WHERE g.workspace_id=w.id AND g.account_id=s.actor_id)))
 OR NOT departure_content_readable(s.actor_id,s.tenant_id,s.workspace_id) THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM experience_versions v JOIN experience_entries e ON e.id=v.entry_id
 WHERE v.id=target AND e.tenant_id=s.tenant_id AND e.workspace_id=s.workspace_id AND v.created_by=s.actor_id
 AND EXISTS(SELECT 1 FROM experience_admissions admission JOIN experience_analysis_runs run ON run.id=admission.run_id WHERE admission.version_id=v.id AND admission.outcome IN ('CREATED','UPDATED') AND run.execution_class='live' AND run.outcome='QUALIFIED')
 AND v.origin='AUTOMATIC' AND v.evaluation='AUTOMATIC_CHECKED' AND v.automatic_basis IS NOT NULL AND v.automatic_steps IS NOT NULL AND v.content->>'kind'='METHOD'
 AND NOT v.scrubbed AND NOT e.automation_stopped AND object_is_active('EXPERIENCE_VERSION',v.id)
 AND (s.state IN ('ADMITTED','DUPLICATE') OR (e.status='PUBLISHED' AND e.published_version=v.id))
 AND NOT EXISTS(SELECT 1 FROM experience_evidence r WHERE r.version_id=v.id AND NOT EXISTS(
 SELECT 1 FROM workspaces w WHERE w.id=r.source_workspace_id AND w.tenant_id=e.tenant_id
 AND ((w.kind='PERSONAL' AND w.owner_id=s.actor_id) OR (w.kind='SHARED' AND EXISTS(SELECT 1 FROM workspace_members g WHERE g.workspace_id=w.id AND g.account_id=s.actor_id)))
 AND ((r.kind='MATERIAL_VERSION' AND EXISTS(SELECT 1 FROM material_versions mv JOIN active_materials am ON am.id=mv.material_id WHERE mv.id=r.material_version_id AND mv.tenant_id=e.tenant_id AND mv.workspace_id=w.id))
 OR (r.kind='TASK' AND EXISTS(SELECT 1 FROM conversation_tasks task JOIN conversations c ON c.id=task.conversation_id WHERE task.id=r.task_id AND task.tenant_id=e.tenant_id AND task.workspace_id=w.id AND c.owner_id=s.actor_id AND EXISTS(SELECT 1 FROM readable_source_tasks rt WHERE rt.id=task.id))))))) THEN RETURN false; END IF;
 -- Traverse exact version dependencies, never use a latest-version replacement or inferred evidence basis.
 FOR dependency IN WITH RECURSIVE deps(id) AS(SELECT target UNION SELECT d.dependency_version FROM experience_automatic_dependencies d JOIN deps p ON p.id=d.version_id)
 SELECT v.id,v.scrubbed,v.origin FROM deps d JOIN experience_versions v ON v.id=d.id LOOP
  IF dependency.scrubbed OR NOT object_is_active('EXPERIENCE_VERSION',dependency.id) THEN RETURN false; END IF;
  IF dependency.origin='AUTOMATIC' AND NOT EXISTS(SELECT 1 FROM experience_automatic_sources a WHERE a.version_id=dependency.id) THEN RETURN false; END IF;
  FOR input_source IN SELECT a.source_id FROM experience_automatic_sources a WHERE a.version_id=dependency.id LOOP
   IF NOT experience_intake_available(input_source) THEN RETURN false; END IF;
  END LOOP;
 END LOOP;
 RETURN true;
END $$;

-- Stopping future adoption is distinct from erasing a prior derived result.
CREATE FUNCTION general_experience_history_readable(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE source uuid;
BEGIN
 SELECT o.source_version INTO source FROM general_experience_versions v JOIN general_experience_entries e ON e.id=v.entry_id
 JOIN general_experience_origins o ON o.version_id=v.id WHERE v.id=target AND v.method IS NOT NULL AND e.status IN ('AVAILABLE','STOPPED');
 IF NOT FOUND THEN RETURN false; END IF;
 RETURN generalization_source_available(source);
END $$;
CREATE FUNCTION task_general_experiences_readable(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE dependency record;
BEGIN
 -- Evaluate only actual edges. Calling source functions on unrelated rows can create false recursive scans.
 FOR dependency IN WITH RECURSIVE related(id) AS (
  SELECT target UNION SELECT e.source_task_id FROM dataset_task_edges e JOIN related r ON r.id=e.task_id
 ) SELECT g.version_id,g.invalidated FROM task_general_experience_reads g JOIN related r ON r.id=g.task_id LOOP
  IF dependency.invalidated OR NOT general_experience_history_readable(dependency.version_id) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
-- Active work also checks methods inherited through history or source-bound results.
CREATE FUNCTION task_general_experience_dependencies(target uuid) RETURNS TABLE(entry_id uuid,version_id uuid,invalidated boolean) LANGUAGE sql STABLE AS $$
 WITH RECURSIVE related(id) AS (SELECT target UNION SELECT e.source_task_id FROM dataset_task_edges e JOIN related r ON r.id=e.task_id)
 SELECT DISTINCT g.entry_id,g.version_id,g.invalidated FROM related r JOIN task_general_experience_reads g ON g.task_id=r.id
 JOIN conversation_tasks t ON t.id=target WHERE g.task_id<>target OR g.attempt_number=t.attempt
$$;
CREATE FUNCTION task_general_experiences_current(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE dependency record;
BEGIN
 FOR dependency IN SELECT * FROM task_general_experience_dependencies(target) LOOP
  IF dependency.invalidated OR NOT general_experience_available(dependency.version_id) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
-- Documents/artifacts also inherit the task fence through object lifecycle, including timed expiry.
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('object_is_active_internal(text,uuid,text[])'::regprocedure);
 IF strpos(definition,'IF k=''TASK'' THEN')=0 THEN RAISE EXCEPTION 'missing task lifecycle boundary'; END IF;
 definition:=replace(definition,'IF k=''TASK'' THEN','IF k=''TASK'' THEN
  IF NOT task_general_experiences_readable(target) THEN RETURN false; END IF;');
 EXECUTE definition;
END $$;
DO $$ DECLARE prior text; BEGIN
 prior:=regexp_replace(pg_get_viewdef('readable_source_tasks'::regclass,true), ';\s*$', '');
 EXECUTE 'CREATE OR REPLACE VIEW readable_source_tasks AS SELECT prior.id FROM ('||prior||') prior WHERE task_general_experiences_readable(prior.id)';
 prior:=regexp_replace(pg_get_viewdef('readable_feedback'::regclass,true), ';\s*$', '');
 EXECUTE 'CREATE OR REPLACE VIEW readable_feedback AS SELECT prior.id FROM ('||prior||') prior JOIN feedback_entries f ON f.id=prior.id WHERE f.kind=''PUBLICATION'' OR task_general_experiences_readable(f.task_id)';
END $$;
CREATE FUNCTION fence_general_experience_tasks() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 IF TG_TABLE_NAME='general_experience_entries' THEN
  IF (NEW.status,NEW.published_version) IS DISTINCT FROM (OLD.status,OLD.published_version) THEN
   INSERT INTO task_general_experience_fences(task_id,attempt_number)
   WITH RECURSIVE affected(id) AS (
    SELECT task_id FROM task_general_experience_reads WHERE entry_id=NEW.id
    UNION SELECT edge.task_id FROM dataset_task_edges edge JOIN affected a ON a.id=edge.source_task_id
   ) SELECT t.id,t.attempt FROM conversation_tasks t JOIN affected a ON a.id=t.id WHERE t.status='RUNNING' AND t.attempt>0
   ON CONFLICT DO NOTHING;
  END IF;
 ELSIF TG_TABLE_NAME='general_experience_versions' THEN
  IF NEW.method IS NULL AND OLD.method IS NOT NULL THEN
   UPDATE task_general_experience_reads SET invalidated=true WHERE version_id=NEW.id;
   FOR target IN WITH RECURSIVE affected(id) AS (
    SELECT task_id FROM task_general_experience_reads WHERE version_id=NEW.id
    UNION SELECT e.task_id FROM dataset_task_edges e JOIN affected a ON a.id=e.source_task_id
   ) SELECT id FROM affected ORDER BY id LOOP
    PERFORM scrub_lifecycle_object('TASK',target);
   END LOOP;
  END IF;
 ELSIF TG_TABLE_NAME='conversation_tasks' THEN
  IF NEW.error_code='OBJECT_REMOVED' THEN
   UPDATE task_general_experience_reviews SET conditions='',adjustments='',scrubbed=true WHERE task_id=NEW.id AND NOT scrubbed;
  END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER general_task_adoption_fence AFTER UPDATE OF status,published_version ON general_experience_entries FOR EACH ROW EXECUTE FUNCTION fence_general_experience_tasks();
CREATE TRIGGER general_task_source_erased AFTER UPDATE OF method ON general_experience_versions FOR EACH ROW EXECUTE FUNCTION fence_general_experience_tasks();
CREATE TRIGGER general_task_review_erased AFTER UPDATE OF error_code ON conversation_tasks FOR EACH ROW EXECUTE FUNCTION fence_general_experience_tasks();
