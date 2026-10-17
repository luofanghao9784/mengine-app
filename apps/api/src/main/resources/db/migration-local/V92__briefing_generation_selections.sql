-- A confirmed multi-card selection is a bounded queue; legacy single-type triggers still coalesce.
ALTER TABLE briefing_generation_batches ADD COLUMN selection_id uuid, ADD COLUMN selection_index integer;
ALTER TABLE briefing_generation_batches ADD CONSTRAINT briefing_selection_shape CHECK (
  (selection_id IS NULL AND selection_index IS NULL) OR
  (selection_id IS NOT NULL AND selection_index IS NOT NULL AND selection_index BETWEEN 0 AND 5)
);
DROP INDEX briefing_generation_active;
CREATE UNIQUE INDEX briefing_generation_active ON briefing_generation_batches(tenant_id,owner_id,workspace_id,(coalesce(business_type,'AUTO')))
WHERE selection_id IS NULL AND status IN ('QUEUED','RUNNING','WAITING_DATA','WAITING_RESOURCE','WAITING_CAPABILITY');
CREATE UNIQUE INDEX briefing_selection_member ON briefing_generation_batches(tenant_id,owner_id,selection_id,selection_index) WHERE selection_id IS NOT NULL;
