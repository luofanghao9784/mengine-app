-- Acknowledging a historical failure never rewrites its execution outcome.
ALTER TABLE engine_diagnostic_archives DROP CONSTRAINT engine_diagnostic_archives_record_kind_check;
ALTER TABLE engine_diagnostic_archives ADD CONSTRAINT engine_diagnostic_archives_record_kind_check
 CHECK (record_kind IN ('TASK','KNOWLEDGE','COMPANY_ITEM','COMPANY_ATTEMPT','SCENE','GOVERNANCE','COLLECTION'));

CREATE VIEW engine_unarchived_collections AS
 SELECT r.* FROM collection_runs r WHERE NOT EXISTS (
 SELECT 1 FROM engine_diagnostic_archives a WHERE a.tenant_id=r.tenant_id AND a.record_kind='COLLECTION' AND a.record_id=r.id
 AND a.record_stamp=jsonb_build_array(r.status,r.reason,r.finished_at)::text);
