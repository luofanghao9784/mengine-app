-- Immutable definitions, explicit publication and per-attempt retrieval provenance.
CREATE TABLE scene_metrics (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), source_id text NOT NULL,
 head_version integer NOT NULL CHECK(head_version>0), published_version integer,
 created_by uuid NOT NULL REFERENCES accounts(id), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id)
);
CREATE TABLE scene_metric_versions (
 metric_id uuid NOT NULL REFERENCES scene_metrics(id), version integer NOT NULL CHECK(version>0),
 definition jsonb NOT NULL, source_scope jsonb NOT NULL, source_dataset uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(metric_id,version)
);
ALTER TABLE scene_metrics ADD FOREIGN KEY(id,head_version) REFERENCES scene_metric_versions(metric_id,version) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE scene_metrics ADD FOREIGN KEY(id,published_version) REFERENCES scene_metric_versions(metric_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE scene_metric_events (
 id bigserial PRIMARY KEY, tenant_id uuid NOT NULL, metric_id uuid NOT NULL REFERENCES scene_metrics(id),
 version integer NOT NULL, action text NOT NULL CHECK(action IN ('DRAFT','PUBLISH','WITHDRAW')),
 actor_id uuid NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE task_metric_reads (
 task_id uuid NOT NULL REFERENCES conversation_tasks(id), attempt_number integer NOT NULL,
 metric_id uuid NOT NULL, version integer NOT NULL, dataset_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(task_id,attempt_number,metric_id),
 FOREIGN KEY(metric_id,version) REFERENCES scene_metric_versions(metric_id,version)
);
CREATE INDEX scene_metrics_tenant ON scene_metrics(tenant_id);
CREATE FUNCTION task_metric_dependencies(target uuid) RETURNS TABLE(metric_id uuid,version integer,dataset_id uuid) LANGUAGE sql STABLE AS $$
 WITH RECURSIVE related(id) AS (
  SELECT target UNION SELECT edge.source_task_id FROM dataset_task_edges edge JOIN related r ON r.id=edge.task_id
 ) SELECT DISTINCT m.metric_id,m.version,m.dataset_id FROM task_metric_reads m JOIN related r ON r.id=m.task_id
$$;
ALTER FUNCTION task_datasets_readable(uuid) RENAME TO task_datasets_readable_before_metrics;
CREATE FUNCTION task_datasets_readable(task uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT task_datasets_readable_before_metrics(task) AND NOT EXISTS (
  SELECT 1 FROM task_metric_dependencies(task) r CROSS JOIN conversation_tasks t
  JOIN scene_metrics m ON true JOIN scene_metric_versions v ON v.metric_id=m.id
  WHERE t.id=task AND m.id=r.metric_id AND v.version=r.version AND (
   m.tenant_id<>t.tenant_id OR m.published_version IS DISTINCT FROM r.version OR NOT EXISTS (
    SELECT 1 FROM scene_asset_links l WHERE l.tenant_id=m.tenant_id AND l.source_id=m.source_id AND l.kind='TABLE' AND l.active
     AND l.target_id=r.dataset_id AND scene_table_scope(l.metadata)=v.source_scope
     AND file_dataset_readable(t.requested_by,l.target_id)
   )
  )
 )
$$;
-- Withdrawal followed by republication must not revive an in-flight attempt.
CREATE FUNCTION fence_metric_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.published_version IS DISTINCT FROM NEW.published_version THEN
  INSERT INTO task_dataset_fences(task_id,attempt_number,reason)
   SELECT t.id,t.attempt,'METRIC_PUBLICATION_CHANGED' FROM conversation_tasks t
   WHERE t.tenant_id=NEW.tenant_id AND t.status='RUNNING' AND t.attempt>0
    AND EXISTS(SELECT 1 FROM task_metric_dependencies(t.id) r WHERE r.metric_id=NEW.id)
   ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END
$$;
CREATE TRIGGER scene_metric_publication_fence AFTER UPDATE ON scene_metrics FOR EACH ROW EXECUTE FUNCTION fence_metric_publication();
