-- Reading permission is independent of output location; fixed selections and revocation fences remain required.
CREATE OR REPLACE FUNCTION guard_briefing_dataset_selection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.task_id,NEW.batch_id,NEW.dataset_id,NEW.snapshot_id) IS DISTINCT FROM
     (OLD.task_id,OLD.batch_id,OLD.dataset_id,OLD.snapshot_id) OR OLD.invalidated AND NOT NEW.invalidated THEN
   RAISE EXCEPTION 'Fixed briefing dataset selection cannot change';
  END IF;
 ELSIF NOT EXISTS(
  SELECT 1 FROM briefing_generation_batches b JOIN conversation_tasks t ON t.id=b.task_id
  JOIN business_datasets d ON d.tenant_id=t.tenant_id
  JOIN dataset_snapshots s ON s.dataset_id=d.id AND s.id=NEW.snapshot_id
  JOIN workspace_members g ON g.tenant_id=d.tenant_id AND g.workspace_id=d.workspace_id AND g.account_id=t.requested_by
  WHERE b.id=NEW.batch_id AND t.id=NEW.task_id AND d.id=NEW.dataset_id
   AND b.owner_id=t.requested_by AND b.tenant_id=t.tenant_id AND b.workspace_id=t.workspace_id
   AND departure_content_readable(t.requested_by,d.tenant_id,d.workspace_id)
   AND t.source_scope='SELECTED' AND t.status='QUEUED' AND d.status='ACTIVE' AND NOT d.scrubbed AND NOT s.scrubbed
 ) THEN RAISE EXCEPTION 'Briefing dataset selection is not granted';
 END IF;
 RETURN NEW;
END $$;
