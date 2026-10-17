-- Replace the legacy source-space membership fence only for explicitly enabled tenants.
-- Keep lifecycle, dataset and general-experience checks and fixed briefing provenance.
CREATE FUNCTION library_task_readable(target uuid, visited uuid[] DEFAULT ARRAY[]::uuid[]) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE task record; discussion record;
BEGIN
 IF target=ANY(visited) OR cardinality(visited)>=32 THEN RETURN false; END IF;
 SELECT * INTO task FROM conversation_tasks WHERE id=target;
 IF NOT FOUND OR NOT object_is_active('TASK',target) THEN RETURN false; END IF;
 IF NOT task_datasets_readable(target) OR NOT task_general_experiences_readable(target) THEN RETURN false; END IF;
 IF EXISTS (
  SELECT 1 FROM (
   SELECT s.task_id,c.version_id FROM conversation_sources s JOIN knowledge_chunks c ON c.id=s.chunk_id
   UNION SELECT task_id,version_id FROM conversation_originals
   UNION SELECT g.task_id,c.version_id FROM conversation_agent_grants g JOIN knowledge_chunks c ON c.id=g.chunk_id
   UNION SELECT task_id,version_id FROM feedback_task_sources
   UNION SELECT task_id,version_id FROM task_context_materials
  ) dep LEFT JOIN material_versions v ON v.id=dep.version_id
  WHERE dep.task_id=target AND NOT EXISTS (
   SELECT 1 FROM active_materials m WHERE m.id=v.material_id AND m.tenant_id=task.tenant_id
   AND (library_mask(task.requested_by,task.tenant_id,'MATERIAL',m.id)&1)=1
  )
 ) THEN RETURN false; END IF;
 FOR discussion IN SELECT d.* FROM briefing_discussions d WHERE d.conversation_id=task.conversation_id LOOP
  IF NOT EXISTS(SELECT 1 FROM conversation_tasks source WHERE source.id=discussion.source_task_id
     AND source.tenant_id=task.tenant_id AND source.requested_by=task.requested_by
     AND source.revision=discussion.source_revision AND source.attempt=discussion.source_attempt AND source.status='SUCCEEDED')
     OR NOT library_task_readable(discussion.source_task_id,array_append(visited,target)) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
DO $$ DECLARE prior text; BEGIN
 prior:=regexp_replace(pg_get_viewdef('readable_source_tasks'::regclass,true), ';\s*$', '');
 -- Separate arms preserve predicate pushdown into the legacy view. A correlated
 -- EXISTS inside CASE can be hashed across all tasks and recurse through unrelated
 -- general-experience consumers while checking a single source task.
 EXECUTE 'CREATE OR REPLACE VIEW readable_source_tasks AS
 SELECT legacy.id FROM ('||prior||') legacy JOIN conversation_tasks t ON t.id=legacy.id WHERE NOT library_permissions_enabled(t.tenant_id)
 UNION ALL SELECT t.id FROM conversation_tasks t WHERE library_permissions_enabled(t.tenant_id) AND library_task_readable(t.id)';
END $$;
