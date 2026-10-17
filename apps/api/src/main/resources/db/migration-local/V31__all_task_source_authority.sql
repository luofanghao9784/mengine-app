-- Every actual direct or indirect material read keeps current source authorization.
-- Source lifecycle is necessary but not sufficient: a still-active source can be revoked.
CREATE OR REPLACE VIEW readable_source_tasks AS
SELECT t.id FROM conversation_tasks t WHERE NOT EXISTS (
 SELECT 1 FROM (
  SELECT s.task_id,c.version_id FROM conversation_sources s JOIN knowledge_chunks c ON c.id=s.chunk_id
  UNION SELECT task_id,version_id FROM conversation_originals
  UNION SELECT g.task_id,c.version_id FROM conversation_agent_grants g JOIN knowledge_chunks c ON c.id=g.chunk_id
  UNION SELECT task_id,version_id FROM feedback_task_sources
  UNION SELECT task_id,version_id FROM task_context_materials
 ) dependency JOIN material_versions v ON v.id=dependency.version_id
 WHERE dependency.task_id=t.id AND NOT EXISTS (
  SELECT 1 FROM active_materials m JOIN workspaces w ON w.tenant_id=m.tenant_id AND w.id=m.workspace_id
  WHERE m.id=v.material_id AND m.tenant_id=t.tenant_id AND
   ((w.kind='PERSONAL' AND w.owner_id=t.requested_by) OR (w.kind='SHARED' AND EXISTS (
    SELECT 1 FROM workspace_members g WHERE g.tenant_id=w.tenant_id AND g.workspace_id=w.id AND g.account_id=t.requested_by)))
 )
);
