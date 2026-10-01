ALTER TABLE conversation_tasks DROP CONSTRAINT conversation_tasks_status_check;
ALTER TABLE conversation_tasks ADD CONSTRAINT conversation_tasks_status_check CHECK(status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','INTERRUPTED','PAUSED','WAITING_INPUT','WAITING_CAPABILITY','PARTIAL','RESULT_UNKNOWN'));
ALTER TABLE conversation_tasks DROP CONSTRAINT agent_execution_class;
ALTER TABLE conversation_tasks ADD CONSTRAINT agent_execution_class CHECK((mode='SOURCE_LOOKUP' AND execution_class IS NULL) OR (mode='AGENT' AND (execution_class IS NOT NULL OR status IN ('WAITING_CAPABILITY','PAUSED','CANCELLED'))));
ALTER TABLE conversation_tasks ADD COLUMN wait_reason varchar(64);
ALTER TABLE conversation_tasks ADD COLUMN required_input varchar(1000);
ALTER TABLE conversation_tasks ADD COLUMN supplemental_input varchar(12000) NOT NULL DEFAULT '';
ALTER TABLE conversation_tasks ADD COLUMN resume_state varchar(20);
ALTER TABLE conversation_tasks ADD COLUMN reconciliation_required boolean NOT NULL DEFAULT false;

CREATE TABLE conversation_attempts (
 task_id uuid NOT NULL REFERENCES conversation_tasks(id), attempt_number integer NOT NULL CHECK(attempt_number>0),
 attempt_id uuid UNIQUE, input varchar(16000) NOT NULL, status varchar(20) NOT NULL CHECK(status IN ('RUNNING','SUCCEEDED','FAILED','CANCELLED','INTERRUPTED','PAUSED','WAITING_INPUT','WAITING_CAPABILITY','PARTIAL','RESULT_UNKNOWN','QUEUED')),
 started_at timestamptz, finished_at timestamptz, provenance varchar(32) NOT NULL CHECK(provenance IN ('RECORDED','LEGACY_CURRENT_ONLY')),
 snapshot jsonb NOT NULL DEFAULT '{}', execution_policy varchar(40), allowed_tools jsonb,
 reconciliation_code varchar(64), reconciled_at timestamptz,
 PRIMARY KEY(task_id,attempt_number), CHECK(jsonb_typeof(snapshot)='object')
);
-- Only the surviving current attempt is known. Do not manufacture erased historical attempts or start times.
INSERT INTO conversation_attempts(task_id,attempt_number,attempt_id,input,status,finished_at,provenance,snapshot)
 SELECT id,attempt,lease_token,prompt,status,finished_at,'LEGACY_CURRENT_ONLY',to_jsonb(t)-'lease_token'-'lease_until'
 FROM conversation_tasks t WHERE attempt>0;

ALTER TABLE conversation_sources ADD COLUMN attempt_number integer NOT NULL DEFAULT 0;
UPDATE conversation_sources s SET attempt_number=t.attempt FROM conversation_tasks t WHERE t.id=s.task_id;
ALTER TABLE conversation_sources DROP CONSTRAINT conversation_sources_pkey;
ALTER TABLE conversation_sources ADD PRIMARY KEY(task_id,attempt_number,chunk_id);
ALTER TABLE conversation_artifacts ADD COLUMN attempt_number integer NOT NULL DEFAULT 0;
UPDATE conversation_artifacts a SET attempt_number=t.attempt FROM conversation_tasks t WHERE t.id=a.task_id;

CREATE TABLE conversation_tool_receipts (
 task_id uuid NOT NULL, attempt_number integer NOT NULL, sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 8),
 name varchar(64) NOT NULL, status varchar(16) NOT NULL CHECK(status IN ('STARTED','succeeded','failed')),
 received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(task_id,attempt_number,sequence), FOREIGN KEY(task_id,attempt_number) REFERENCES conversation_attempts(task_id,attempt_number)
);
ALTER TABLE agent_attempt_usage DROP CONSTRAINT agent_attempt_usage_status_check;
ALTER TABLE agent_attempt_usage ADD CONSTRAINT agent_attempt_usage_status_check CHECK(status IN ('RUNNING','SUCCEEDED','FAILED','CANCELLED','INTERRUPTED','PAUSED','WAITING_INPUT','WAITING_CAPABILITY','PARTIAL','RESULT_UNKNOWN'));
