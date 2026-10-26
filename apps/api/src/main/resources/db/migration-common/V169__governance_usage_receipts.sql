-- Metadata only. One reservation per engine idempotency key, including uncertain outcomes.
CREATE TABLE governance_model_usage (
 job_id uuid NOT NULL REFERENCES governance_model_jobs(id),
 revision integer NOT NULL CHECK(revision > 0),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 execution_class text NOT NULL CHECK(execution_class IN ('live','unknown','verification')),
 state text NOT NULL CHECK(state IN ('PENDING','RETURNED','UNKNOWN')),
 dispatch_token uuid,
 model_name text,
 model_calls bigint CHECK(model_calls BETWEEN 0 AND 100),
 input_tokens bigint CHECK(input_tokens BETWEEN 0 AND 100000000),
 output_tokens bigint CHECK(output_tokens BETWEEN 0 AND 100000000),
 started_at timestamptz DEFAULT now(),
 reported_at timestamptz,
 PRIMARY KEY(job_id,revision),
 CHECK((input_tokens IS NULL)=(output_tokens IS NULL))
);
CREATE INDEX governance_model_usage_tenant_time ON governance_model_usage(tenant_id,started_at);

-- Old dispatches have no verified call start time or token receipts. A job can be retried
-- across months, so its creation/update time must not assign these calls to a month.
INSERT INTO governance_model_usage(job_id,revision,tenant_id,execution_class,state,model_name,started_at,reported_at)
 SELECT j.id,j.revision,j.tenant_id,CASE WHEN d.executor='SYSTEM_MODEL' THEN 'live' ELSE 'unknown' END,
 'UNKNOWN',d.model_name,NULL,d.updated_at FROM governance_model_jobs j JOIN governance_model_dispatch d ON d.job_id=j.id
 WHERE d.attempts>0 AND d.state IN ('SUCCEEDED','FAILED','STALE');
