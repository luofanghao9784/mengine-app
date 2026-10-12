CREATE TABLE wiki_insights (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),actor_id uuid NOT NULL REFERENCES accounts(id),
 mode varchar(16) NOT NULL CHECK(mode IN ('ANALYZE','GRAPH','RECOMMEND')),task_id uuid NOT NULL UNIQUE REFERENCES conversation_tasks(id),
 conversation_id uuid NOT NULL REFERENCES conversations(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wiki_insight_inputs (
 insight_id uuid NOT NULL REFERENCES wiki_insights(id),material_id uuid NOT NULL REFERENCES materials(id),
 version_id uuid NOT NULL REFERENCES material_versions(id),run_id uuid NOT NULL REFERENCES knowledge_runs(id),anchor boolean NOT NULL,
 PRIMARY KEY(insight_id,material_id)
);
CREATE INDEX wiki_insight_owner ON wiki_insights(tenant_id,actor_id,created_at DESC,id);
CREATE FUNCTION wiki_insight_current(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH RECURSIVE dependencies(id) AS (
  SELECT target UNION SELECT e.source FROM dependencies d CROSS JOIN LATERAL (
   SELECT reference_id source FROM task_context_reads WHERE task_id=d.id AND kind='HISTORY'
   UNION SELECT e.task_id FROM task_context_reads c JOIN experience_evidence e ON e.version_id::text=c.version_key AND e.kind='TASK' WHERE c.task_id=d.id AND c.kind='EXPERIENCE'
   UNION SELECT source_task_id FROM dataset_task_edges WHERE task_id=d.id
   UNION SELECT b.source_task_id FROM conversation_tasks t JOIN briefing_discussions b ON b.conversation_id=t.conversation_id WHERE t.id=d.id
  ) e
 ) SELECT NOT EXISTS(SELECT 1 FROM dependencies d JOIN wiki_insights g ON g.task_id=d.id JOIN wiki_insight_inputs i ON i.insight_id=g.id WHERE NOT EXISTS(
  SELECT 1 FROM active_materials m JOIN workspaces w ON w.id=m.workspace_id JOIN material_versions v ON v.material_id=m.id AND v.number=m.current_version JOIN knowledge_runs r ON r.id=i.run_id AND r.version_id=v.id
  WHERE m.id=i.material_id AND m.tenant_id=g.tenant_id AND m.in_library AND w.kind='SHARED' AND v.id=i.version_id AND r.status IN ('READY','PARTIAL')
  AND NOT EXISTS(SELECT 1 FROM knowledge_runs newer WHERE newer.version_id=v.id AND newer.generation>r.generation)
  AND (library_mask(g.actor_id,g.tenant_id,'MATERIAL',m.id)&1)=1
 ))
$$;
DO $$ DECLARE prior text; BEGIN
 prior:=regexp_replace(pg_get_viewdef('readable_source_tasks'::regclass,true), ';\s*$', '');
 EXECUTE 'CREATE OR REPLACE VIEW readable_source_tasks AS SELECT prior.id FROM ('||prior||') prior WHERE wiki_insight_current(prior.id)';
END $$;
