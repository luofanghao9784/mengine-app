-- Large artifacts use a bounded, attempt-scoped staging channel; legacy inline limits remain.
ALTER TABLE conversation_artifacts ADD COLUMN transferred boolean NOT NULL DEFAULT false;
ALTER TABLE conversation_artifacts DROP CONSTRAINT conversation_artifacts_content_check;
ALTER TABLE conversation_artifacts ADD CONSTRAINT conversation_artifacts_content_check
 CHECK (octet_length(content) <= CASE WHEN transferred THEN 20971520 ELSE 65536 END);
CREATE TABLE conversation_artifact_transfers (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
 task_id uuid NOT NULL, attempt_id uuid NOT NULL, attempt_number integer NOT NULL,
 client_key uuid NOT NULL, filename varchar(80) NOT NULL, media_type varchar(100) NOT NULL,
 expected_bytes integer NOT NULL CHECK(expected_bytes BETWEEN 1 AND 20971520),
 sha256 char(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 received_bytes integer NOT NULL DEFAULT 0 CHECK(received_bytes>=0 AND received_bytes<=expected_bytes),
 content bytea NOT NULL DEFAULT '', state varchar(16) NOT NULL DEFAULT 'UPLOADING' CHECK(state IN ('UPLOADING','READY','PUBLISHED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '1 hour',
 UNIQUE(task_id,attempt_id,client_key),
 FOREIGN KEY(tenant_id,workspace_id,task_id) REFERENCES conversation_tasks(tenant_id,workspace_id,id),
 FOREIGN KEY(task_id,attempt_number) REFERENCES conversation_attempts(task_id,attempt_number),
 FOREIGN KEY(attempt_id) REFERENCES conversation_attempts(attempt_id),
 CHECK((state='PUBLISHED' AND octet_length(content)=0) OR (state<>'PUBLISHED' AND octet_length(content)=received_bytes))
);
CREATE UNIQUE INDEX artifact_transfer_filename ON conversation_artifact_transfers(task_id,attempt_id,lower(filename));
CREATE INDEX artifact_transfer_expiry ON conversation_artifact_transfers(expires_at);
