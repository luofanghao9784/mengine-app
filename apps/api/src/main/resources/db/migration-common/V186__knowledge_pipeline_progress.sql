CREATE TABLE knowledge_pipeline_progress (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 source_id uuid NOT NULL,
 stage text NOT NULL CHECK(stage IN ('DEFINITION','KNOWLEDGE','INSIGHT')),
 state text NOT NULL CHECK(state IN ('WAITING','FAILED','SUCCEEDED')),
 reason text NOT NULL,
 input_revision text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 last_success_at timestamptz,
 PRIMARY KEY(tenant_id,source_id,stage)
);
