CREATE TABLE task_dataset_reads (
 task_id uuid NOT NULL, attempt_number integer NOT NULL, dataset_id uuid NOT NULL,
 snapshot_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(task_id,attempt_number,dataset_id),
 FOREIGN KEY(task_id,attempt_number) REFERENCES conversation_attempts(task_id,attempt_number),
 FOREIGN KEY(dataset_id,snapshot_id) REFERENCES dataset_snapshots(dataset_id,id)
);
CREATE INDEX task_dataset_snapshot_lookup ON task_dataset_reads(snapshot_id);
CREATE TABLE task_dataset_fences (
 task_id uuid NOT NULL, attempt_number integer NOT NULL, reason varchar(40) NOT NULL,
 PRIMARY KEY(task_id,attempt_number),
 FOREIGN KEY(task_id,attempt_number) REFERENCES conversation_attempts(task_id,attempt_number)
);
-- Explicit inheritance for a source-bound experience or a feedback correction.
CREATE TABLE dataset_task_inheritance (
 task_id uuid NOT NULL REFERENCES conversation_tasks(id), source_task_id uuid NOT NULL REFERENCES conversation_tasks(id),
 PRIMARY KEY(task_id,source_task_id), CHECK(task_id<>source_task_id)
);
CREATE INDEX dataset_inheritance_source ON dataset_task_inheritance(source_task_id);
CREATE INDEX dataset_history_source ON task_context_reads(reference_id,task_id) WHERE kind='HISTORY';
CREATE INDEX dataset_discussion_source ON briefing_discussions(source_task_id,conversation_id);
CREATE VIEW dataset_task_edges AS
 SELECT task_id,source_task_id FROM dataset_task_inheritance
 UNION SELECT task_id,reference_id FROM task_context_reads WHERE kind='HISTORY'
 UNION SELECT task_id,source_task_id FROM adjustment_task_dependencies
 UNION SELECT t.id,d.source_task_id FROM conversation_tasks t JOIN briefing_discussions d ON d.conversation_id=t.conversation_id;
CREATE FUNCTION task_dataset_sources(target uuid) RETURNS TABLE(snapshot_id uuid) LANGUAGE sql STABLE AS $$
 WITH RECURSIVE related(id) AS (
  SELECT target UNION SELECT edge.source_task_id FROM dataset_task_edges edge JOIN related r ON r.id=edge.task_id
 ) SELECT DISTINCT d.snapshot_id FROM task_dataset_reads d JOIN related r ON r.id=d.task_id
$$;
CREATE FUNCTION task_datasets_readable(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(
  SELECT 1 FROM task_dataset_sources(target) ref JOIN dataset_snapshots s ON s.id=ref.snapshot_id
  JOIN business_datasets d ON d.id=s.dataset_id CROSS JOIN conversation_tasks t
  WHERE t.id=target AND (d.tenant_id<>t.tenant_id OR d.status<>'ACTIVE' OR d.scrubbed OR s.scrubbed OR
    NOT EXISTS(SELECT 1 FROM workspace_members g WHERE g.tenant_id=d.tenant_id AND g.workspace_id=d.workspace_id AND g.account_id=t.requested_by))
 )
$$;
-- Briefly revoking and then restoring access cannot revive the same in-flight attempt.
CREATE FUNCTION fence_task_dataset_access() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='workspace_members' THEN
  IF TG_OP='DELETE' OR (NEW.tenant_id,NEW.workspace_id,NEW.account_id) IS DISTINCT FROM (OLD.tenant_id,OLD.workspace_id,OLD.account_id) THEN
   INSERT INTO task_dataset_fences(task_id,attempt_number,reason)
   SELECT t.id,t.attempt,'DATASET_ACCESS_REVOKED' FROM conversation_tasks t
   WHERE t.tenant_id=OLD.tenant_id AND t.requested_by=OLD.account_id AND t.status='RUNNING' AND t.attempt>0
    AND EXISTS(SELECT 1 FROM task_dataset_sources(t.id) ref JOIN dataset_snapshots s ON s.id=ref.snapshot_id JOIN business_datasets d ON d.id=s.dataset_id WHERE d.workspace_id=OLD.workspace_id)
   ON CONFLICT DO NOTHING;
  END IF;
 ELSE
  IF NEW.status='WITHDRAWN' AND OLD.status<>'WITHDRAWN' THEN
   INSERT INTO task_dataset_fences(task_id,attempt_number,reason)
   SELECT t.id,t.attempt,'DATASET_WITHDRAWN' FROM conversation_tasks t
   WHERE t.tenant_id=NEW.tenant_id AND t.status='RUNNING' AND t.attempt>0
    AND EXISTS(SELECT 1 FROM task_dataset_sources(t.id) ref JOIN dataset_snapshots s ON s.id=ref.snapshot_id WHERE s.dataset_id=NEW.id)
   ON CONFLICT DO NOTHING;
  END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER task_dataset_permission_fence AFTER DELETE OR UPDATE ON workspace_members FOR EACH ROW EXECUTE FUNCTION fence_task_dataset_access();
CREATE TRIGGER task_dataset_withdrawal_fence AFTER UPDATE OF status ON business_datasets FOR EACH ROW EXECUTE FUNCTION fence_task_dataset_access();
DO $$ DECLARE prior text; BEGIN
 prior:=regexp_replace(pg_get_viewdef('readable_source_tasks'::regclass,true), ';\s*$', '');
 EXECUTE 'CREATE OR REPLACE VIEW readable_source_tasks AS SELECT prior.id FROM ('||prior||') prior WHERE task_datasets_readable(prior.id)';
 prior:=regexp_replace(pg_get_viewdef('readable_feedback'::regclass,true), ';\s*$', '');
 EXECUTE 'CREATE OR REPLACE VIEW readable_feedback AS SELECT prior.id FROM ('||prior||') prior JOIN feedback_entries f ON f.id=prior.id WHERE f.kind=''PUBLICATION'' OR task_datasets_readable(f.task_id)';
END $$;

-- Erasure follows actual source dependencies, including private derived caches.
CREATE FUNCTION scrub_dataset_derived_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 IF NEW.scrubbed AND NOT OLD.scrubbed THEN
  FOR target IN WITH RECURSIVE affected(id) AS (
   SELECT r.task_id FROM task_dataset_reads r WHERE r.snapshot_id=NEW.id
   UNION SELECT e.task_id FROM dataset_task_edges e JOIN affected a ON a.id=e.source_task_id
  ) SELECT id FROM affected ORDER BY id LOOP
   PERFORM scrub_lifecycle_object_internal('TASK',target,ARRAY[]::text[]);
  END LOOP;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER dataset_derived_scrub AFTER UPDATE OF scrubbed ON dataset_snapshots FOR EACH ROW EXECUTE FUNCTION scrub_dataset_derived_content();
