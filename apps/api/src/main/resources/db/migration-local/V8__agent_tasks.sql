ALTER TABLE conversation_tasks DROP CONSTRAINT conversation_tasks_mode_check;
ALTER TABLE conversation_tasks ADD CONSTRAINT conversation_tasks_mode_check CHECK(mode IN ('SOURCE_LOOKUP','AGENT'));
ALTER TABLE conversation_tasks ALTER COLUMN prompt TYPE varchar(2000);
ALTER TABLE conversation_tasks ADD COLUMN execution_class varchar(20) CHECK(execution_class IN ('live','verification'));
ALTER TABLE conversation_tasks ADD COLUMN reply varchar(16000);
ALTER TABLE conversation_tasks ADD COLUMN model_name varchar(80);
ALTER TABLE conversation_tasks ADD COLUMN model_calls integer;
ALTER TABLE conversation_tasks ADD COLUMN token_usage jsonb;
ALTER TABLE conversation_tasks ADD COLUMN tool_receipts jsonb;
ALTER TABLE conversation_tasks ADD CONSTRAINT agent_execution_class CHECK((mode='AGENT')=(execution_class IS NOT NULL));
CREATE TABLE conversation_agent_grants (
 tenant_id uuid NOT NULL, workspace_id uuid NOT NULL, task_id uuid NOT NULL, attempt_id uuid NOT NULL, chunk_id uuid NOT NULL,
 PRIMARY KEY(task_id,attempt_id,chunk_id),
 FOREIGN KEY(tenant_id,workspace_id,task_id) REFERENCES conversation_tasks(tenant_id,workspace_id,id),
 FOREIGN KEY(tenant_id,workspace_id,chunk_id) REFERENCES knowledge_chunks(tenant_id,workspace_id,id)
);
CREATE TABLE conversation_artifacts (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL, task_id uuid NOT NULL,
 filename varchar(80) NOT NULL, sha256 char(64) NOT NULL, content bytea NOT NULL CHECK(octet_length(content)<=65536),
 FOREIGN KEY(tenant_id,workspace_id,task_id) REFERENCES conversation_tasks(tenant_id,workspace_id,id)
);
CREATE INDEX conversation_artifact_task ON conversation_artifacts(task_id);
