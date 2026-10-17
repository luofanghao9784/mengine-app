-- Tenant-wide future use control. Never changes the global asset or removes completed history.
CREATE TABLE tenant_general_experience_usage (
 tenant_id uuid NOT NULL REFERENCES tenants(id),entry_id uuid NOT NULL REFERENCES general_experience_entries(id),
 enabled boolean NOT NULL,revision integer NOT NULL CHECK(revision>0),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,entry_id)
);
CREATE TABLE tenant_general_experience_usage_events (
 tenant_id uuid NOT NULL REFERENCES tenants(id),request_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES accounts(id),
 entry_id uuid NOT NULL REFERENCES general_experience_entries(id),version_id uuid NOT NULL REFERENCES general_experience_versions(id),
 expected_revision integer NOT NULL,enabled boolean NOT NULL,revision integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,request_id)
);
CREATE FUNCTION tenant_general_experience_enabled(tenant uuid,entry uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM tenant_general_experience_usage u WHERE u.tenant_id=tenant AND u.entry_id=entry AND NOT u.enabled)
$$;
CREATE OR REPLACE FUNCTION task_general_experiences_current(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE dependency record; tenant uuid;
BEGIN
 SELECT tenant_id INTO tenant FROM conversation_tasks WHERE id=target;
 FOR dependency IN SELECT * FROM task_general_experience_dependencies(target) LOOP
  IF dependency.invalidated OR NOT general_experience_available(dependency.version_id)
   OR NOT tenant_general_experience_enabled(tenant,dependency.entry_id) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
CREATE FUNCTION fence_tenant_general_experience_tasks() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT NEW.enabled THEN
  INSERT INTO task_general_experience_fences(task_id,attempt_number)
  WITH RECURSIVE affected(id) AS (
   SELECT task_id FROM task_general_experience_reads WHERE entry_id=NEW.entry_id
   UNION SELECT edge.task_id FROM dataset_task_edges edge JOIN affected a ON a.id=edge.source_task_id
  ) SELECT t.id,t.attempt FROM conversation_tasks t JOIN affected a ON a.id=t.id
  WHERE t.tenant_id=NEW.tenant_id AND t.status='RUNNING' AND t.attempt>0
  ON CONFLICT DO NOTHING;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER tenant_general_use_fence AFTER INSERT OR UPDATE OF enabled ON tenant_general_experience_usage
 FOR EACH ROW EXECUTE FUNCTION fence_tenant_general_experience_tasks();
