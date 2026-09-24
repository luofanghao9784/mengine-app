ALTER TABLE material_versions ADD CONSTRAINT material_version_scope UNIQUE(tenant_id,workspace_id,material_id,id);
CREATE TABLE knowledge_runs (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL, workspace_id uuid NOT NULL, material_id uuid NOT NULL, version_id uuid NOT NULL,
 generation integer NOT NULL CHECK(generation>0), requested_by uuid NOT NULL REFERENCES accounts(id),
 status varchar(16) NOT NULL CHECK(status IN ('QUEUED','RUNNING','READY','PARTIAL','FAILED','UNSUPPORTED','CANCELLED')),
 parser_version varchar(64), warnings text NOT NULL DEFAULT '', attempts integer NOT NULL DEFAULT 0,
 lease_token uuid, lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 FOREIGN KEY(tenant_id,workspace_id,material_id,version_id) REFERENCES material_versions(tenant_id,workspace_id,material_id,id),
 UNIQUE(version_id,generation), UNIQUE(tenant_id,workspace_id,material_id,version_id,id)
);
CREATE INDEX knowledge_queue ON knowledge_runs(status,created_at) WHERE status IN ('QUEUED','RUNNING');
CREATE TABLE knowledge_chunks (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL, material_id uuid NOT NULL, version_id uuid NOT NULL,
 run_id uuid NOT NULL, ordinal integer NOT NULL CHECK(ordinal>=0), locator varchar(180) NOT NULL,
 method varchar(8) NOT NULL CHECK(method IN ('TEXT','TABLE','OCR')), content text NOT NULL CHECK(length(content)<=4000),
 FOREIGN KEY(tenant_id,workspace_id,material_id,version_id,run_id) REFERENCES knowledge_runs(tenant_id,workspace_id,material_id,version_id,id),
 UNIQUE(run_id,ordinal)
);
CREATE INDEX knowledge_chunk_scope ON knowledge_chunks(tenant_id,workspace_id,version_id,run_id);
