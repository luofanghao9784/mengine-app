CREATE TABLE conversations (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,workspace_id uuid NOT NULL,owner_id uuid NOT NULL REFERENCES accounts(id),
 title varchar(100) NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id),UNIQUE(tenant_id,workspace_id,id)
);
CREATE INDEX conversation_owner ON conversations(tenant_id,owner_id,updated_at DESC);
CREATE TABLE conversation_tasks (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,workspace_id uuid NOT NULL,conversation_id uuid NOT NULL,
 requested_by uuid NOT NULL REFERENCES accounts(id),prompt varchar(200) NOT NULL,
 mode varchar(20) NOT NULL CHECK(mode='SOURCE_LOOKUP'),
 status varchar(20) NOT NULL CHECK(status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','INTERRUPTED')),
 revision integer NOT NULL DEFAULT 0,attempt integer NOT NULL DEFAULT 0,lease_token uuid,lease_until timestamptz,
 summary_code varchar(32),error_code varchar(64),engine_version varchar(64),
 created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
 FOREIGN KEY(tenant_id,workspace_id,conversation_id) REFERENCES conversations(tenant_id,workspace_id,id),
 UNIQUE(tenant_id,workspace_id,id)
);
CREATE UNIQUE INDEX conversation_one_active ON conversation_tasks(conversation_id) WHERE status IN ('QUEUED','RUNNING');
ALTER TABLE knowledge_chunks ADD CONSTRAINT knowledge_chunk_identity_scope UNIQUE(tenant_id,workspace_id,id);
CREATE TABLE conversation_sources (
 tenant_id uuid NOT NULL,workspace_id uuid NOT NULL,task_id uuid NOT NULL,chunk_id uuid NOT NULL,ordinal integer NOT NULL,
 PRIMARY KEY(task_id,chunk_id),FOREIGN KEY(tenant_id,workspace_id,chunk_id) REFERENCES knowledge_chunks(tenant_id,workspace_id,id),FOREIGN KEY(tenant_id,workspace_id,task_id) REFERENCES conversation_tasks(tenant_id,workspace_id,id)
);
CREATE TABLE conversation_events (
 seq bigserial PRIMARY KEY,tenant_id uuid NOT NULL,workspace_id uuid NOT NULL,conversation_id uuid NOT NULL,task_id uuid NOT NULL,
 kind varchar(32) NOT NULL,revision integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,workspace_id,conversation_id) REFERENCES conversations(tenant_id,workspace_id,id),
 FOREIGN KEY(tenant_id,workspace_id,task_id) REFERENCES conversation_tasks(tenant_id,workspace_id,id)
);
CREATE INDEX conversation_event_cursor ON conversation_events(conversation_id,seq);
