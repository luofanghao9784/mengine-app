-- New attempts only. Historical usage is not reconstructed from final task state.
CREATE TABLE agent_attempt_usage (
 attempt_id uuid PRIMARY KEY, task_id uuid NOT NULL, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
 attempt_number integer NOT NULL CHECK(attempt_number>0),
 execution_class varchar(20) NOT NULL CHECK(execution_class IN ('live','verification')),
 status varchar(20) NOT NULL CHECK(status IN ('RUNNING','SUCCEEDED','FAILED','CANCELLED','INTERRUPTED')),
 metering_enabled boolean NOT NULL DEFAULT false,
 max_model_calls integer NOT NULL DEFAULT 8 CHECK(max_model_calls=8),
 max_output_tokens integer NOT NULL DEFAULT 2048 CHECK(max_output_tokens=2048),
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 receipt_until timestamptz NOT NULL DEFAULT now()+interval '120 seconds',
 UNIQUE(task_id,attempt_number), UNIQUE(task_id,attempt_id),
 FOREIGN KEY(tenant_id,workspace_id,task_id) REFERENCES conversation_tasks(tenant_id,workspace_id,id)
);
CREATE INDEX agent_usage_window ON agent_attempt_usage(tenant_id,started_at);
CREATE TABLE agent_model_requests (
 task_id uuid NOT NULL, attempt_id uuid NOT NULL, sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 8),
 max_output_tokens integer NOT NULL CHECK(max_output_tokens BETWEEN 1 AND 2048),
 outcome varchar(20) NOT NULL DEFAULT 'PENDING' CHECK(outcome IN ('PENDING','RETURNED','FAILED','CANCELLED')),
 input_tokens bigint, output_tokens bigint,
 started_at timestamptz NOT NULL DEFAULT now(), reported_at timestamptz,
 CHECK((input_tokens IS NULL)=(output_tokens IS NULL)),
 CHECK(input_tokens BETWEEN 0 AND 1000000 AND output_tokens BETWEEN 0 AND 1000000),
 PRIMARY KEY(attempt_id,sequence),
 FOREIGN KEY(task_id,attempt_id) REFERENCES agent_attempt_usage(task_id,attempt_id)
);
