-- Native, source-bound model jobs. Waiting does not own a process lease or a DB transaction.
CREATE TABLE governance_model_jobs (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 actor_id uuid NOT NULL REFERENCES accounts(id),
 kind text NOT NULL CHECK(kind IN ('DATASET','MATERIAL')),
 source_id uuid NOT NULL,
 request_id uuid NOT NULL,
 source_name text NOT NULL,
 basis_hash text NOT NULL,
 input jsonb NOT NULL,
 state text NOT NULL CHECK(state IN ('WAITING_MODEL','VALIDATING','DRAFT_READY','STALE','FAILED')),
 revision integer NOT NULL DEFAULT 1,
 response_hash text,
 output jsonb,
 executor text,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,actor_id,request_id)
);
CREATE UNIQUE INDEX governance_pending_source ON governance_model_jobs(tenant_id,actor_id,kind,source_id) WHERE state IN ('WAITING_MODEL','VALIDATING');
CREATE INDEX governance_job_tenant ON governance_model_jobs(tenant_id,actor_id,created_at);
CREATE TABLE governance_model_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 job_id uuid NOT NULL REFERENCES governance_model_jobs(id),
 state text NOT NULL,
 revision integer NOT NULL,
 code text,
 created_at timestamptz NOT NULL DEFAULT now()
);
