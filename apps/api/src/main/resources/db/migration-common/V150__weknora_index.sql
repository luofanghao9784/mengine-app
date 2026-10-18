-- Deployment-owned targets. No credentials or customer text are stored here.
CREATE TABLE knowledge_index_targets (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
 knowledge_base_id varchar(128) NOT NULL UNIQUE,
 enabled boolean NOT NULL DEFAULT false,
 CHECK (knowledge_base_id ~ '^[A-Za-z0-9_-]{1,128}$')
);
-- Keep remote handles after local content is erased so the worker can delete the copy.
CREATE TABLE knowledge_remote_index (
 id uuid PRIMARY KEY,
 chunk_id uuid UNIQUE REFERENCES knowledge_chunks(id) ON DELETE SET NULL,
 tenant_id uuid NOT NULL,
 material_id uuid NOT NULL, version_id uuid NOT NULL,
 knowledge_base_id varchar(128) NOT NULL,
 remote_id varchar(128),
 state varchar(24) NOT NULL DEFAULT 'QUEUED' CHECK (state IN
 ('QUEUED','UPLOADING','INDEXING','READY','FAILED','UNKNOWN','DELETE_PENDING','DELETING','DELETED')),
 lease_token uuid, lease_until timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 error_code varchar(64),
 UNIQUE(knowledge_base_id,remote_id)
);
CREATE INDEX knowledge_remote_index_queue ON knowledge_remote_index(state,next_attempt_at);
