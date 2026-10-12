-- Wiki drafts reuse private task output and lifecycle. This table stores no source/body copies.
CREATE TABLE wiki_learning_drafts (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 actor_id uuid NOT NULL REFERENCES accounts(id),
 material_id uuid NOT NULL REFERENCES materials(id),
 version_id uuid NOT NULL REFERENCES material_versions(id),
 run_id uuid NOT NULL REFERENCES knowledge_runs(id),
 task_id uuid NOT NULL UNIQUE REFERENCES conversation_tasks(id),
 conversation_id uuid NOT NULL REFERENCES conversations(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wiki_learning_owner ON wiki_learning_drafts(tenant_id,actor_id,created_at DESC,id);
