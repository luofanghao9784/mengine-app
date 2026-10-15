ALTER TABLE scene_metric_versions ADD COLUMN generation jsonb NOT NULL DEFAULT '{"origin":"MANUAL"}';
CREATE TABLE metric_generation_settings (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id), enabled boolean NOT NULL DEFAULT true,
 checked_at timestamptz, created_count integer NOT NULL DEFAULT 0, error_code text
);
CREATE TABLE metric_generation_keys (
 tenant_id uuid NOT NULL REFERENCES tenants(id), source_id text NOT NULL, candidate_key text NOT NULL,
 metric_id uuid NOT NULL REFERENCES scene_metrics(id), PRIMARY KEY(tenant_id,source_id,candidate_key)
);
CREATE TABLE metric_calculation_receipts (
 artifact_id uuid PRIMARY KEY REFERENCES conversation_artifacts(id) ON DELETE CASCADE, task_id uuid NOT NULL REFERENCES conversation_tasks(id) ON DELETE CASCADE,
 attempt_number integer NOT NULL, metric_id uuid NOT NULL, version integer NOT NULL,
 dataset_id uuid NOT NULL, snapshot_id uuid NOT NULL, plan_sha256 text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(metric_id,version) REFERENCES scene_metric_versions(metric_id,version)
);
CREATE TABLE metric_briefing_receipts (
 artifact_id uuid PRIMARY KEY REFERENCES conversation_artifacts(id) ON DELETE CASCADE, calculation_artifact_id uuid NOT NULL REFERENCES metric_calculation_receipts(artifact_id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX metric_calculation_metric ON metric_calculation_receipts(metric_id,created_at);
