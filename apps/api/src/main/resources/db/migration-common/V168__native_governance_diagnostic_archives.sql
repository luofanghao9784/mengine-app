ALTER TABLE engine_diagnostic_archives DROP CONSTRAINT engine_diagnostic_archives_record_kind_check;
ALTER TABLE engine_diagnostic_archives ADD CONSTRAINT engine_diagnostic_archives_record_kind_check
 CHECK (record_kind IN ('TASK','KNOWLEDGE','COMPANY_ITEM','COMPANY_ATTEMPT','SCENE','GOVERNANCE'));

-- The cloud native-governance module is not installed in every local profile.
DO $$ BEGIN
 IF to_regclass('governance_model_jobs') IS NOT NULL THEN
  EXECUTE $view$
   CREATE VIEW engine_unarchived_governance_jobs AS
    SELECT r.* FROM governance_model_jobs r WHERE NOT EXISTS (
    SELECT 1 FROM engine_diagnostic_archives a WHERE a.tenant_id=r.tenant_id AND a.record_kind='GOVERNANCE' AND a.record_id=r.id
    AND a.record_stamp=jsonb_build_array(r.state,r.revision,r.updated_at)::text)
  $view$;
 END IF;
END $$;
