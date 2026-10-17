-- Explicit enterprise/workspace binding. No default enterprise and no cross-enterprise fallback.
CREATE TABLE scene_bindings (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
 workspace_id uuid NOT NULL, connection_id uuid NOT NULL UNIQUE,
 maintainer_id uuid NOT NULL REFERENCES accounts(id),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE scene_asset_links (
 tenant_id uuid NOT NULL REFERENCES scene_bindings(tenant_id), source_id text NOT NULL,
 kind varchar(16) NOT NULL CHECK(kind IN ('TABLE','DOCUMENT','KNOWLEDGE')),
 target_id uuid NOT NULL, revision text NOT NULL, metadata jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,source_id,kind), UNIQUE(tenant_id,target_id,kind)
);
CREATE TABLE scene_processing_runs (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES scene_bindings(tenant_id),
 actor_id uuid NOT NULL REFERENCES accounts(id),operation text NOT NULL,
 state varchar(16) NOT NULL CHECK(state IN ('RUNNING','SUCCEEDED','FAILED')),
 created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,error_code text
);
CREATE INDEX scene_runs_tenant ON scene_processing_runs(tenant_id,created_at DESC);
