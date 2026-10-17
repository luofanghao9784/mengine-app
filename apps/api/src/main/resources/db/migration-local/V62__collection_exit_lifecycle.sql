-- Collected business data follows the existing formal enterprise-exit deadline.
-- No new retention interval and no personal/member ownership of shared datasets.
ALTER TABLE business_datasets ADD COLUMN scrubbed boolean NOT NULL DEFAULT false;
ALTER TABLE dataset_snapshots ADD COLUMN scrubbed boolean NOT NULL DEFAULT false;
ALTER TABLE dataset_snapshots ADD CONSTRAINT scrubbed_dataset_has_no_rows CHECK(NOT scrubbed OR data_rows='[]'::jsonb);
ALTER TABLE departure_export_items DROP CONSTRAINT departure_export_items_kind_check;
ALTER TABLE departure_export_items ADD CONSTRAINT departure_export_items_kind_check
 CHECK(kind IN('MATERIAL_VERSION','EXPERIENCE_VERSION','DATASET_SNAPSHOT'));

CREATE OR REPLACE FUNCTION guard_dataset_deployment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.tenant_id,NEW.connection_id,NEW.workspace_id) IS DISTINCT FROM (OLD.tenant_id,OLD.connection_id,OLD.workspace_id) THEN
   RAISE EXCEPTION 'dataset scope is immutable';
  END IF;
  IF OLD.scrubbed AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'scrubbed dataset cannot be restored'; END IF;
  IF NEW.scrubbed THEN
   IF NEW.status<>'WITHDRAWN' OR NEW.name<>'内容已按退出期限清理' OR NEW.description<>'' OR
     NEW.dataset_key<>'removed-'||NEW.id::text OR NEW.column_names<>'["已清理"]'::jsonb OR
     EXISTS(SELECT 1 FROM dataset_snapshots s WHERE s.dataset_id=NEW.id AND NOT s.scrubbed) THEN
    RAISE EXCEPTION 'dataset cleanup is incomplete';
   END IF;
  ELSIF (NEW.dataset_key,NEW.column_names) IS DISTINCT FROM (OLD.dataset_key,OLD.column_names) THEN
   RAISE EXCEPTION 'dataset schema changes require a new identity';
  END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM workspaces WHERE tenant_id=NEW.tenant_id AND id=NEW.workspace_id AND kind='SHARED') THEN
  RAISE EXCEPTION 'deployed datasets require an explicit shared workspace';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION guard_dataset_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.tenant_id,NEW.connection_id,NEW.dataset_id,NEW.run_id,NEW.version,NEW.row_count,NEW.coverage_through,NEW.collected_at)
  IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.connection_id,OLD.dataset_id,OLD.run_id,OLD.version,OLD.row_count,OLD.coverage_through,OLD.collected_at) OR
  (OLD.scrubbed AND NOT NEW.scrubbed) OR (NOT NEW.scrubbed AND NEW.data_rows IS DISTINCT FROM OLD.data_rows) THEN
  RAISE EXCEPTION 'dataset snapshots are immutable except for irreversible cleanup';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dataset_snapshot_guard BEFORE UPDATE ON dataset_snapshots FOR EACH ROW EXECUTE FUNCTION guard_dataset_snapshot();

CREATE FUNCTION revoke_dataset_archives() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='business_datasets' THEN
  IF NEW.status='WITHDRAWN' OR NEW.scrubbed THEN PERFORM scrub_departure_object('DATASET_SNAPSHOT',NEW.id); END IF;
 ELSE
  IF NEW.scrubbed AND NOT OLD.scrubbed THEN PERFORM scrub_departure_object('DATASET_SNAPSHOT',NEW.dataset_id); END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER dataset_archive_fence AFTER UPDATE OF status,scrubbed ON business_datasets FOR EACH ROW EXECUTE FUNCTION revoke_dataset_archives();
CREATE TRIGGER snapshot_archive_fence AFTER UPDATE OF scrubbed ON dataset_snapshots FOR EACH ROW EXECUTE FUNCTION revoke_dataset_archives();
