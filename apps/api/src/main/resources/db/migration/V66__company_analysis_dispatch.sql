CREATE TABLE company_analysis_items (
 chunk_id uuid PRIMARY KEY REFERENCES knowledge_chunks(id), tenant_id uuid NOT NULL REFERENCES tenants(id),
 state varchar(16) NOT NULL CHECK(state IN ('QUEUED','RUNNING','SUCCEEDED','RETRY_WAIT','FAILED','UNKNOWN','CANCELLED')),
 run_id uuid REFERENCES company_inference_runs(id), attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 error_code varchar(64)
);
CREATE INDEX company_analysis_queue ON company_analysis_items(state,next_attempt_at,tenant_id);
CREATE TABLE company_analysis_attempts (
 run_id uuid PRIMARY KEY REFERENCES company_inference_runs(id), tenant_id uuid NOT NULL REFERENCES tenants(id),
 state varchar(16) NOT NULL CHECK(state IN ('CLAIMED','DISPATCHED','RETURNED','FAILED','UNKNOWN','CANCELLED')),
 engine_version varchar(64), model_name varchar(200), model_calls integer,
 input_tokens bigint, output_tokens bigint,
 created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 error_code varchar(64),
 CHECK(model_calls IS NULL OR model_calls BETWEEN 0 AND 8),
 CHECK(input_tokens IS NULL OR input_tokens>=0), CHECK(output_tokens IS NULL OR output_tokens>=0)
);
CREATE UNIQUE INDEX company_analysis_one_tenant ON company_analysis_attempts(tenant_id) WHERE state IN ('CLAIMED','DISPATCHED');
CREATE VIEW company_analysis_current_chunks AS
 SELECT c.id,c.tenant_id FROM knowledge_chunks c JOIN knowledge_runs r ON r.id=c.run_id
 JOIN materials m ON m.id=c.material_id JOIN material_versions v ON v.id=c.version_id
 WHERE v.number=m.current_version AND r.generation=(SELECT max(x.generation) FROM knowledge_runs x WHERE x.version_id=c.version_id)
 AND company_chunk_eligible(c.id);
