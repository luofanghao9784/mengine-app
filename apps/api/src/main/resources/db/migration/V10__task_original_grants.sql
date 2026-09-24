ALTER TABLE material_versions ADD CONSTRAINT material_version_scope_id UNIQUE(tenant_id,workspace_id,material_id,id);
CREATE TABLE conversation_originals (
 tenant_id uuid NOT NULL, workspace_id uuid NOT NULL, task_id uuid NOT NULL,
 material_id uuid NOT NULL, version_id uuid NOT NULL,
 PRIMARY KEY(task_id,version_id), UNIQUE(task_id,material_id),
 UNIQUE(tenant_id,workspace_id,task_id,version_id),
 FOREIGN KEY(tenant_id,workspace_id,task_id) REFERENCES conversation_tasks(tenant_id,workspace_id,id),
 FOREIGN KEY(tenant_id,workspace_id,material_id,version_id) REFERENCES material_versions(tenant_id,workspace_id,material_id,id)
);
CREATE TABLE conversation_original_reads (
 tenant_id uuid NOT NULL, workspace_id uuid NOT NULL, task_id uuid NOT NULL, version_id uuid NOT NULL,
 attempt_id uuid NOT NULL, attempt_number integer NOT NULL CHECK(attempt_number>0),
 sha256 char(64) NOT NULL, read_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(task_id,attempt_id,version_id),
 FOREIGN KEY(tenant_id,workspace_id,task_id,version_id) REFERENCES conversation_originals(tenant_id,workspace_id,task_id,version_id)
);
