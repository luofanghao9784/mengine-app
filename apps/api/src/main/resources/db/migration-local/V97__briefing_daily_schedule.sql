-- Explicit owner enrollment, independent of legacy event-driven automation.
CREATE TABLE briefing_daily_schedules (
 policy_id uuid PRIMARY KEY REFERENCES briefing_generation_policies(id),
 enabled boolean NOT NULL DEFAULT true, revision integer NOT NULL DEFAULT 1,
 local_time time NOT NULL DEFAULT '09:00', zone varchar(40) NOT NULL DEFAULT 'Asia/Shanghai' CHECK(zone='Asia/Shanghai'),
 next_due timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE briefing_daily_runs (
 policy_id uuid NOT NULL REFERENCES briefing_daily_schedules(policy_id), local_day date NOT NULL,
 scheduled_for timestamptz NOT NULL, batch_id uuid NOT NULL REFERENCES briefing_generation_batches(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(policy_id,local_day)
);
CREATE TABLE briefing_flow_tasks (
 task_id uuid PRIMARY KEY REFERENCES conversation_tasks(id),
 policy_id uuid NOT NULL REFERENCES briefing_daily_schedules(policy_id), schedule_revision integer NOT NULL, column_hashes jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE briefing_flow_materials (
 task_id uuid NOT NULL REFERENCES briefing_flow_tasks(task_id),
 artifact_id uuid NOT NULL REFERENCES conversation_artifacts(id),
 version_id uuid NOT NULL REFERENCES analysis_material_versions(id), PRIMARY KEY(task_id,artifact_id)
);
CREATE TABLE briefing_material_uses (
 task_id uuid NOT NULL REFERENCES briefing_flow_tasks(task_id),
 artifact_id uuid PRIMARY KEY REFERENCES conversation_artifacts(id),
 material_id uuid NOT NULL REFERENCES analysis_materials(id),
 version_number integer NOT NULL, version_id uuid NOT NULL REFERENCES analysis_material_versions(id)
);
