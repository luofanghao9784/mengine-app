-- Only explicit lifecycle actions enroll existing assets. Reads/index rebuilds never renew deadlines.
CREATE TABLE content_lifecycle (
 tenant_id uuid NOT NULL, workspace_id uuid NOT NULL, object_kind varchar(16) NOT NULL CHECK(object_kind IN ('MATERIAL','FOLDER')),
 object_id uuid NOT NULL, state varchar(16) NOT NULL CHECK(state IN ('ACTIVE','TRASHED','PURGING','PURGED')),
 revision integer NOT NULL DEFAULT 1, changed_by uuid, changed_at timestamptz NOT NULL DEFAULT now(),
 trashed_at timestamptz, purge_after timestamptz, purge_job_id uuid,
 PRIMARY KEY(object_kind,object_id), FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id)
);
CREATE INDEX content_lifecycle_due ON content_lifecycle(purge_after) WHERE state='TRASHED';
CREATE TABLE content_cleanup_jobs (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL, object_kind varchar(16) NOT NULL,
 object_id uuid NOT NULL, requested_by uuid, state varchar(16) NOT NULL CHECK(state IN ('QUEUED','CLEANING','FAILED','COMPLETE')),
 revision integer NOT NULL DEFAULT 1, attempts integer NOT NULL DEFAULT 0, error_code varchar(64),
 lease_token uuid, lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id)
);
CREATE TABLE content_cleanup_materials (
 job_id uuid NOT NULL REFERENCES content_cleanup_jobs(id), material_id uuid NOT NULL REFERENCES materials(id),
 PRIMARY KEY(job_id,material_id)
);
CREATE TABLE content_cleanup_blobs (
 job_id uuid NOT NULL REFERENCES content_cleanup_jobs(id), object_id uuid NOT NULL, deleted_at timestamptz,
 PRIMARY KEY(job_id,object_id)
);
CREATE TABLE content_lifecycle_receipts (
 actor_id uuid NOT NULL, request_id uuid NOT NULL, receipt jsonb NOT NULL,
 PRIMARY KEY(actor_id,request_id), FOREIGN KEY(actor_id,request_id) REFERENCES identity_requests(actor_id,request_id)
);
CREATE VIEW active_material_folders AS
 WITH RECURSIVE visible AS (
  SELECT f.id FROM material_folders f WHERE f.parent_id IS NULL AND NOT EXISTS
   (SELECT 1 FROM content_lifecycle l WHERE l.object_kind='FOLDER' AND l.object_id=f.id AND l.state<>'ACTIVE')
  UNION ALL
  SELECT f.id FROM material_folders f JOIN visible p ON p.id=f.parent_id WHERE NOT EXISTS
   (SELECT 1 FROM content_lifecycle l WHERE l.object_kind='FOLDER' AND l.object_id=f.id AND l.state<>'ACTIVE')
 ) SELECT f.* FROM material_folders f JOIN visible v ON v.id=f.id;
CREATE VIEW active_materials AS
 SELECT m.* FROM materials m WHERE NOT EXISTS
  (SELECT 1 FROM content_lifecycle l WHERE l.object_kind='MATERIAL' AND l.object_id=m.id AND l.state<>'ACTIVE')
 AND (m.folder_id IS NULL OR EXISTS(SELECT 1 FROM active_material_folders f WHERE f.id=m.folder_id));
-- Include read grants even when the answer did not cite them.
CREATE VIEW readable_source_tasks AS SELECT t.id FROM conversation_tasks t WHERE
 NOT EXISTS(SELECT 1 FROM conversation_sources s JOIN knowledge_chunks c ON c.id=s.chunk_id WHERE s.task_id=t.id AND NOT EXISTS(SELECT 1 FROM active_materials m WHERE m.id=c.material_id))
 AND NOT EXISTS(SELECT 1 FROM conversation_originals o WHERE o.task_id=t.id AND NOT EXISTS(SELECT 1 FROM active_materials m WHERE m.id=o.material_id))
 AND NOT EXISTS(SELECT 1 FROM conversation_agent_grants g JOIN knowledge_chunks c ON c.id=g.chunk_id WHERE g.task_id=t.id AND NOT EXISTS(SELECT 1 FROM active_materials m WHERE m.id=c.material_id));
