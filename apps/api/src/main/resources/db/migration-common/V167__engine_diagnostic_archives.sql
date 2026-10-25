-- Operational acknowledgement is separate from immutable execution outcomes.
-- A later attempt/revision/timestamp has a different stamp and is visible again.
CREATE TABLE engine_diagnostic_archives (
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 record_kind text NOT NULL CHECK (record_kind IN ('TASK','KNOWLEDGE','COMPANY_ITEM','COMPANY_ATTEMPT','SCENE')),
 record_id uuid NOT NULL,
 record_stamp text NOT NULL,
 operation_id uuid NOT NULL,
 archived_at timestamptz NOT NULL DEFAULT now(),
 reason text NOT NULL,
 PRIMARY KEY (tenant_id,record_kind,record_id,record_stamp)
);

CREATE VIEW engine_unarchived_tasks AS
 SELECT t.* FROM conversation_tasks t WHERE NOT EXISTS (
 SELECT 1 FROM engine_diagnostic_archives a WHERE a.tenant_id=t.tenant_id AND a.record_kind='TASK' AND a.record_id=t.id
 AND a.record_stamp=jsonb_build_array(t.status,t.revision,t.attempt,t.finished_at)::text);

CREATE VIEW engine_unarchived_knowledge AS
 SELECT r.* FROM knowledge_runs r WHERE NOT EXISTS (
 SELECT 1 FROM engine_diagnostic_archives a WHERE a.tenant_id=r.tenant_id AND a.record_kind='KNOWLEDGE' AND a.record_id=r.id
 AND a.record_stamp=jsonb_build_array(r.status,r.generation,r.finished_at)::text);

CREATE VIEW engine_unarchived_company_items AS
 SELECT i.* FROM company_analysis_items i WHERE NOT EXISTS (
 SELECT 1 FROM engine_diagnostic_archives a WHERE a.tenant_id=i.tenant_id AND a.record_kind='COMPANY_ITEM' AND a.record_id=i.chunk_id
 AND a.record_stamp=jsonb_build_array(i.state,i.run_id,i.attempts,i.updated_at)::text);

CREATE VIEW engine_unarchived_company_attempts AS
 SELECT r.* FROM company_analysis_attempts r WHERE NOT EXISTS (
 SELECT 1 FROM engine_diagnostic_archives a WHERE a.tenant_id=r.tenant_id AND a.record_kind='COMPANY_ATTEMPT' AND a.record_id=r.run_id
 AND a.record_stamp=jsonb_build_array(r.state,r.finished_at)::text);

CREATE VIEW engine_unarchived_scenes AS
 SELECT r.* FROM scene_processing_runs r WHERE NOT EXISTS (
 SELECT 1 FROM engine_diagnostic_archives a WHERE a.tenant_id=r.tenant_id AND a.record_kind='SCENE' AND a.record_id=r.id
 AND a.record_stamp=jsonb_build_array(r.state,r.finished_at)::text);
