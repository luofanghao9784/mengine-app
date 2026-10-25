-- Only explicit native-execution jobs are dispatched. Existing drafts are preserved.
CREATE TABLE governance_model_dispatch (
 job_id uuid PRIMARY KEY REFERENCES governance_model_jobs(id),
 executor text NOT NULL CHECK(executor IN ('CODEX','SYSTEM_MODEL')),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','WAITING_MODEL','RUNNING','SUCCEEDED','FAILED','STALE')),
 lease_token uuid, lease_until timestamptz, next_attempt timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0, error_code text, model_name text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE governance_knowledge_drafts (
 id uuid PRIMARY KEY,job_id uuid NOT NULL REFERENCES governance_model_jobs(id),
 tenant_id uuid NOT NULL REFERENCES tenants(id),actor_id uuid NOT NULL REFERENCES accounts(id),
 ordinal integer NOT NULL,title text NOT NULL,body text NOT NULL,citations jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(job_id,ordinal)
);
