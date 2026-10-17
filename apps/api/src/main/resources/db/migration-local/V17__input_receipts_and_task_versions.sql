-- New upload requests have an exact immutable receipt. Historical request targets alone
-- cannot identify a version and are deliberately not backfilled by guessing.
CREATE TABLE material_upload_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id), request_id uuid NOT NULL,
 tenant_id uuid NOT NULL, workspace_id uuid NOT NULL, material_id uuid NOT NULL, version_id uuid NOT NULL,
 PRIMARY KEY(actor_id,request_id),
 FOREIGN KEY(actor_id,request_id) REFERENCES identity_requests(actor_id,request_id),
 FOREIGN KEY(tenant_id,workspace_id,material_id,version_id) REFERENCES material_versions(tenant_id,workspace_id,material_id,id)
);
CREATE TABLE conversation_task_material_versions (
 tenant_id uuid NOT NULL, workspace_id uuid NOT NULL, task_id uuid NOT NULL, attempt_id uuid NOT NULL,
 material_id uuid NOT NULL, version_id uuid NOT NULL, run_id uuid NOT NULL,
 PRIMARY KEY(task_id,attempt_id,material_id),
 FOREIGN KEY(tenant_id,workspace_id,task_id) REFERENCES conversation_tasks(tenant_id,workspace_id,id),
 FOREIGN KEY(tenant_id,workspace_id,material_id,version_id,run_id) REFERENCES knowledge_runs(tenant_id,workspace_id,material_id,version_id,id)
);
-- Existing grants supply trustworthy evidence only when they agree on both versions.
INSERT INTO conversation_task_material_versions(tenant_id,workspace_id,task_id,attempt_id,material_id,version_id,run_id)
SELECT DISTINCT g.tenant_id,g.workspace_id,g.task_id,g.attempt_id,c.material_id,c.version_id,c.run_id
FROM conversation_agent_grants g JOIN knowledge_chunks c ON c.id=g.chunk_id
WHERE NOT EXISTS (
 SELECT 1 FROM conversation_agent_grants other JOIN knowledge_chunks x ON x.id=other.chunk_id
 WHERE other.task_id=g.task_id AND other.attempt_id=g.attempt_id AND x.material_id=c.material_id
 AND (x.version_id<>c.version_id OR x.run_id<>c.run_id)
);
