-- Shared readers own private opinions about an independent, exact publication copy.
-- No task/document provenance is exposed or used as its authorization dependency.
ALTER TABLE feedback_entries ALTER COLUMN task_id DROP NOT NULL;
ALTER TABLE feedback_entries ADD COLUMN publication_id uuid REFERENCES document_publications(id);
ALTER TABLE feedback_entries ADD COLUMN material_version_id uuid REFERENCES material_versions(id);
ALTER TABLE feedback_entries ADD COLUMN material_version integer;
ALTER TABLE feedback_entries DROP CONSTRAINT feedback_entries_kind_check;
ALTER TABLE feedback_entries ADD CONSTRAINT feedback_entries_kind_check CHECK(kind IN('BRIEFING','TASK','PUBLICATION'));
ALTER TABLE feedback_entries ADD CONSTRAINT feedback_target_shape CHECK(
 (kind='PUBLICATION' AND task_id IS NULL AND task_revision=0 AND attempt=0 AND publication_id IS NOT NULL AND material_version_id IS NOT NULL AND material_version>0 AND presentation_version='recommendation-v1' AND presentation_revision>0)
 OR (kind IN('BRIEFING','TASK') AND task_id IS NOT NULL AND publication_id IS NULL AND material_version_id IS NULL AND material_version IS NULL));
CREATE UNIQUE INDEX publication_feedback_exact ON feedback_entries(actor_id,publication_id,material_version_id,presentation_version,presentation_revision) WHERE kind='PUBLICATION';
ALTER TABLE recommendation_presentations ALTER COLUMN task_id DROP NOT NULL;
ALTER TABLE recommendation_presentations ADD COLUMN publication_id uuid REFERENCES document_publications(id);
ALTER TABLE recommendation_presentations ADD COLUMN material_version_id uuid REFERENCES material_versions(id);
ALTER TABLE recommendation_presentations ADD CONSTRAINT presentation_target_shape CHECK(
 (task_id IS NOT NULL AND publication_id IS NULL AND material_version_id IS NULL)
 OR (task_id IS NULL AND publication_id IS NOT NULL AND material_version_id IS NOT NULL AND task_revision=0 AND attempt=0));
CREATE UNIQUE INDEX publication_presentation_exact ON recommendation_presentations(tenant_id,actor_id,material_version_id,fingerprint) WHERE material_version_id IS NOT NULL;

-- Only old task feedback inherits task lifecycle. Publication feedback inherits its source material.
CREATE OR REPLACE VIEW lifecycle_object_sources AS
 SELECT 'TASK'::varchar(24) kind,t.id object_id,t.tenant_id,t.workspace_id,c.owner_id,NULL::varchar(24) parent_kind,NULL::uuid parent_id,t.created_at original_anchor
 FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id
 UNION ALL SELECT 'DOCUMENT',d.id,d.tenant_id,d.workspace_id,d.owner_id,'TASK',d.source_task_id,d.created_at FROM private_documents d
 UNION ALL SELECT 'ARTIFACT',a.id,a.tenant_id,a.workspace_id,c.owner_id,'TASK',a.task_id,t.created_at FROM conversation_artifacts a JOIN conversation_tasks t ON t.id=a.task_id JOIN conversations c ON c.id=t.conversation_id
 UNION ALL SELECT 'EXPERIENCE_VERSION',v.id,e.tenant_id,e.workspace_id,CASE WHEN w.kind='PERSONAL' THEN w.owner_id END,NULL,NULL,v.created_at FROM experience_versions v JOIN experience_entries e ON e.id=v.entry_id JOIN workspaces w ON w.id=e.workspace_id
 UNION ALL SELECT 'FEEDBACK_VERSION',v.id,f.tenant_id,f.workspace_id,f.actor_id,CASE WHEN f.task_id IS NOT NULL THEN 'TASK' END,f.task_id,v.created_at FROM feedback_versions v JOIN feedback_entries f ON f.id=v.feedback_id
 UNION ALL SELECT 'EVALUATION_VERSION',v.id,a.tenant_id,a.workspace_id,CASE WHEN w.kind='PERSONAL' THEN w.owner_id END,NULL,NULL,v.created_at FROM evaluation_asset_versions v JOIN evaluation_assets a ON a.id=v.asset_id LEFT JOIN workspaces w ON w.id=a.workspace_id
 UNION ALL SELECT 'EVALUATION_RUN',r.id,r.tenant_id,r.workspace_id,CASE WHEN w.kind='PERSONAL' THEN w.owner_id END,NULL,NULL,r.created_at FROM evaluation_runs r LEFT JOIN workspaces w ON w.id=r.workspace_id
 UNION ALL SELECT 'EXPORT_CACHE',l.object_id,l.tenant_id,l.workspace_id,l.owner_id,l.parent_kind,l.parent_id,l.original_anchor FROM object_lifecycle l WHERE l.kind='EXPORT_CACHE';

CREATE OR REPLACE VIEW readable_feedback AS SELECT f.id FROM feedback_entries f
 JOIN feedback_versions current_version ON current_version.feedback_id=f.id AND current_version.revision=f.revision
 WHERE NOT f.scrubbed AND object_is_active('FEEDBACK_VERSION',current_version.id)
 AND NOT EXISTS(SELECT 1 FROM feedback_source_versions s JOIN material_versions v ON v.id=s.version_id WHERE s.feedback_id=f.id
 AND NOT EXISTS(SELECT 1 FROM active_materials m JOIN workspaces w ON w.id=m.workspace_id WHERE m.id=v.material_id
 AND ((w.kind='PERSONAL' AND w.owner_id=f.actor_id) OR (w.kind='SHARED' AND EXISTS(SELECT 1 FROM workspace_members g WHERE g.workspace_id=w.id AND g.tenant_id=w.tenant_id AND g.account_id=f.actor_id)))));
