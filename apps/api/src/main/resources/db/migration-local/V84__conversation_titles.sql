-- Auxiliary title work has its own identity, budget and lifecycle; it never changes task state.
CREATE TABLE conversation_titles (
 conversation_id uuid PRIMARY KEY REFERENCES conversations(id),
 request_id uuid NOT NULL UNIQUE,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 actor_id uuid NOT NULL REFERENCES accounts(id),
 source_task_id uuid NOT NULL REFERENCES conversation_tasks(id),
 fallback_title text NOT NULL,
 state varchar(16) NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','RUNNING','GENERATED','FAILED','UNKNOWN','REVOKED','SUPERSEDED')),
 model_name varchar(80), input_tokens bigint, output_tokens bigint,
 created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
 CHECK ((input_tokens IS NULL AND output_tokens IS NULL) OR (input_tokens >= 0 AND output_tokens >= 0))
);
CREATE INDEX conversation_titles_pending ON conversation_titles(created_at) WHERE state='QUEUED';
