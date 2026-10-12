-- Private graph metadata only; text remains in the existing private task lifecycle.
CREATE TABLE wiki_graphs (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), actor_id uuid NOT NULL REFERENCES accounts(id),
 task_id uuid NOT NULL UNIQUE REFERENCES conversation_tasks(id), conversation_id uuid NOT NULL REFERENCES conversations(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wiki_graph_inputs (
 graph_id uuid NOT NULL REFERENCES wiki_graphs(id), article_id uuid NOT NULL REFERENCES wiki_articles(id),
 revision integer NOT NULL, PRIMARY KEY(graph_id,article_id),
 FOREIGN KEY(article_id,revision) REFERENCES wiki_article_versions(article_id,revision)
);
CREATE INDEX wiki_graph_owner ON wiki_graphs(tenant_id,actor_id,created_at DESC,id);
-- Traverse retained task dependencies too, so history cannot resurrect an invalid graph.
CREATE FUNCTION wiki_graph_current(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH RECURSIVE dependencies(id) AS (
  SELECT target UNION SELECT e.source FROM dependencies d CROSS JOIN LATERAL (
   SELECT reference_id source FROM task_context_reads WHERE task_id=d.id AND kind='HISTORY'
   UNION SELECT e.task_id FROM task_context_reads c JOIN experience_evidence e ON e.version_id::text=c.version_key AND e.kind='TASK' WHERE c.task_id=d.id AND c.kind='EXPERIENCE'
   UNION SELECT source_task_id FROM dataset_task_edges WHERE task_id=d.id
   UNION SELECT b.source_task_id FROM conversation_tasks t JOIN briefing_discussions b ON b.conversation_id=t.conversation_id WHERE t.id=d.id
  ) e
 ) SELECT NOT EXISTS (
 SELECT 1 FROM dependencies d JOIN wiki_graphs g ON g.task_id=d.id JOIN wiki_graph_inputs i ON i.graph_id=g.id
 JOIN wiki_articles a ON a.id=i.article_id JOIN wiki_article_versions v ON v.article_id=i.article_id AND v.revision=i.revision
 WHERE a.tenant_id<>g.tenant_id OR a.revision<>i.revision OR a.archived OR v.article IS NULL OR NOT EXISTS (
  SELECT 1 FROM active_materials m JOIN workspaces w ON w.id=m.workspace_id JOIN material_versions mv ON mv.material_id=m.id AND mv.number=m.current_version
  JOIN knowledge_runs r ON r.id=v.source_run_id AND r.version_id=mv.id
  WHERE m.id=a.material_id AND m.tenant_id=g.tenant_id AND m.in_library AND w.kind='SHARED' AND mv.id=v.source_version_id
  AND r.status IN ('READY','PARTIAL') AND NOT EXISTS(SELECT 1 FROM knowledge_runs newer WHERE newer.version_id=mv.id AND newer.generation>r.generation)
  AND (library_mask(g.actor_id,g.tenant_id,'MATERIAL',m.id)&1)=1
 ))
$$;
DO $$ DECLARE prior text; BEGIN
 prior:=regexp_replace(pg_get_viewdef('readable_source_tasks'::regclass,true), ';\s*$', '');
 EXECUTE 'CREATE OR REPLACE VIEW readable_source_tasks AS SELECT prior.id FROM ('||prior||') prior WHERE wiki_graph_current(prior.id)';
END $$;
