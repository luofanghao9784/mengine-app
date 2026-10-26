-- Native sessions are private. Runtime IDs and capabilities never confer enterprise access.
CREATE TABLE native_conversations (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), owner_id uuid NOT NULL REFERENCES accounts(id),
 workspace_id uuid NOT NULL REFERENCES workspaces(id), request_id uuid NOT NULL,
 legacy_conversation_id uuid REFERENCES conversations(id), state text NOT NULL DEFAULT 'ACTIVE' CHECK(state IN ('ACTIVE','STOPPED')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,owner_id,request_id)
);
CREATE TABLE native_conversation_grants (
 token_hash text PRIMARY KEY, session_id uuid NOT NULL REFERENCES native_conversations(id),
 expires_at timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT false
);
CREATE TABLE native_conversation_sources (
 session_id uuid NOT NULL REFERENCES native_conversations(id), version_id uuid NOT NULL REFERENCES material_versions(id),
 requires_download boolean NOT NULL DEFAULT false, PRIMARY KEY(session_id,version_id)
);
CREATE TABLE native_conversation_history (
 session_id uuid NOT NULL REFERENCES native_conversations(id), task_id uuid NOT NULL REFERENCES conversation_tasks(id),
 revision integer NOT NULL, attempt integer NOT NULL, PRIMARY KEY(session_id,task_id)
);
CREATE TABLE native_conversation_artifacts (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES native_conversations(id), request_id uuid NOT NULL,
 filename text NOT NULL, sha256 text NOT NULL, content bytea NOT NULL CHECK(octet_length(content)<=20971520),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(session_id,request_id)
);
CREATE TABLE native_conversation_publications (
 session_id uuid NOT NULL REFERENCES native_conversations(id), request_id uuid NOT NULL,
 artifact_id uuid NOT NULL REFERENCES native_conversation_artifacts(id), workspace_id uuid NOT NULL REFERENCES workspaces(id),
 material_id uuid NOT NULL REFERENCES materials(id), PRIMARY KEY(session_id,request_id)
);
CREATE INDEX native_conversation_owner ON native_conversations(tenant_id,owner_id,created_at);
CREATE INDEX native_conversation_grant_session ON native_conversation_grants(session_id);
