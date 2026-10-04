-- System-owned selections are fixed before a task is claimed; ordinary SELECTED tasks gain nothing.
CREATE TABLE briefing_dataset_selections (
 task_id uuid NOT NULL REFERENCES conversation_tasks(id),
 batch_id uuid NOT NULL REFERENCES briefing_generation_batches(id),
 dataset_id uuid NOT NULL, snapshot_id uuid NOT NULL,
 invalidated boolean NOT NULL DEFAULT false,
 PRIMARY KEY(task_id,dataset_id),
 FOREIGN KEY(dataset_id,snapshot_id) REFERENCES dataset_snapshots(dataset_id,id)
);
CREATE INDEX briefing_dataset_snapshot ON briefing_dataset_selections(snapshot_id);
CREATE FUNCTION guard_briefing_dataset_selection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.task_id,NEW.batch_id,NEW.dataset_id,NEW.snapshot_id) IS DISTINCT FROM
     (OLD.task_id,OLD.batch_id,OLD.dataset_id,OLD.snapshot_id) OR OLD.invalidated AND NOT NEW.invalidated THEN
   RAISE EXCEPTION 'Fixed briefing dataset selection cannot change';
  END IF;
 ELSIF NOT EXISTS(
  SELECT 1 FROM briefing_generation_batches b JOIN conversation_tasks t ON t.id=b.task_id
  JOIN business_datasets d ON d.tenant_id=t.tenant_id AND d.workspace_id=t.workspace_id
  JOIN dataset_snapshots s ON s.dataset_id=d.id AND s.id=NEW.snapshot_id
  JOIN workspace_members g ON g.tenant_id=d.tenant_id AND g.workspace_id=d.workspace_id AND g.account_id=t.requested_by
  WHERE b.id=NEW.batch_id AND t.id=NEW.task_id AND d.id=NEW.dataset_id
   AND b.owner_id=t.requested_by AND b.tenant_id=t.tenant_id AND b.workspace_id=t.workspace_id
   AND t.source_scope='SELECTED' AND t.status='QUEUED' AND d.status='ACTIVE' AND NOT d.scrubbed AND NOT s.scrubbed
 ) THEN RAISE EXCEPTION 'Briefing dataset selection is not granted';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER briefing_dataset_guard BEFORE INSERT OR UPDATE ON briefing_dataset_selections
 FOR EACH ROW EXECUTE FUNCTION guard_briefing_dataset_selection();
CREATE OR REPLACE FUNCTION task_dataset_sources(target uuid) RETURNS TABLE(snapshot_id uuid) LANGUAGE sql STABLE AS $$
 WITH RECURSIVE related(id) AS (
  SELECT target UNION SELECT edge.source_task_id FROM dataset_task_edges edge JOIN related r ON r.id=edge.task_id
 ), refs AS (
  SELECT d.task_id,d.snapshot_id FROM task_dataset_reads d
  UNION SELECT d.task_id,d.snapshot_id FROM briefing_dataset_selections d
 ) SELECT DISTINCT d.snapshot_id FROM refs d JOIN related r ON r.id=d.task_id
$$;
CREATE OR REPLACE FUNCTION task_datasets_readable(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM briefing_dataset_selections b WHERE b.task_id=target AND b.invalidated)
 AND NOT EXISTS(
  SELECT 1 FROM task_dataset_sources(target) ref JOIN dataset_snapshots s ON s.id=ref.snapshot_id
  JOIN business_datasets d ON d.id=s.dataset_id CROSS JOIN conversation_tasks t
  WHERE t.id=target AND (d.tenant_id<>t.tenant_id OR d.status<>'ACTIVE' OR d.scrubbed OR s.scrubbed OR
    NOT EXISTS(SELECT 1 FROM workspace_members g WHERE g.tenant_id=d.tenant_id AND g.workspace_id=d.workspace_id AND g.account_id=t.requested_by))
 )
$$;
CREATE FUNCTION fence_briefing_dataset_selection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='business_datasets' THEN
  IF NEW.status='WITHDRAWN' AND OLD.status<>'WITHDRAWN' THEN
   UPDATE briefing_dataset_selections b SET invalidated=true FROM conversation_tasks t
   WHERE b.task_id=t.id AND b.dataset_id=NEW.id AND t.status<>'SUCCEEDED';
  END IF;
 ELSE
  IF TG_OP='DELETE' OR (NEW.tenant_id,NEW.workspace_id,NEW.account_id) IS DISTINCT FROM (OLD.tenant_id,OLD.workspace_id,OLD.account_id) THEN
   UPDATE briefing_dataset_selections b SET invalidated=true FROM conversation_tasks t,business_datasets d
   WHERE b.task_id=t.id AND b.dataset_id=d.id AND t.tenant_id=OLD.tenant_id AND t.requested_by=OLD.account_id
    AND d.workspace_id=OLD.workspace_id AND t.status<>'SUCCEEDED';
  END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER briefing_dataset_withdrawal AFTER UPDATE OF status ON business_datasets
 FOR EACH ROW EXECUTE FUNCTION fence_briefing_dataset_selection();
CREATE TRIGGER briefing_dataset_permission AFTER DELETE OR UPDATE ON workspace_members
 FOR EACH ROW EXECUTE FUNCTION fence_briefing_dataset_selection();
CREATE OR REPLACE FUNCTION scrub_dataset_derived_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 IF NEW.scrubbed AND NOT OLD.scrubbed THEN
  FOR target IN WITH RECURSIVE affected(id) AS (
   SELECT task_id FROM (SELECT r.task_id FROM task_dataset_reads r WHERE r.snapshot_id=NEW.id
    UNION SELECT b.task_id FROM briefing_dataset_selections b WHERE b.snapshot_id=NEW.id) direct
   UNION SELECT e.task_id FROM dataset_task_edges e JOIN affected a ON a.id=e.source_task_id
  ) SELECT id FROM affected ORDER BY id LOOP
   PERFORM scrub_lifecycle_object_internal('TASK',target,ARRAY[]::text[]);
  END LOOP;
 END IF;
 RETURN NULL;
END $$;
