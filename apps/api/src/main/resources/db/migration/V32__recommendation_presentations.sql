-- Issued presentation metadata, not evidence that a person read or accepted content.
-- Keeps feedback attributable to the exact method/presentation shown, even after adoption changes.
CREATE TABLE recommendation_presentations (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id), actor_id uuid NOT NULL REFERENCES accounts(id),
 task_id uuid NOT NULL REFERENCES conversation_tasks(id), task_revision integer NOT NULL,
 attempt integer NOT NULL, fingerprint varchar(64) NOT NULL,
 method jsonb NOT NULL, presentation jsonb NOT NULL, settings_revision integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,actor_id,task_id,fingerprint)
);
CREATE INDEX recommendation_presentations_task ON recommendation_presentations(task_id);

ALTER TABLE feedback_entries DROP CONSTRAINT feedback_entries_presentation_version_check;
ALTER TABLE feedback_entries ADD CONSTRAINT feedback_entries_presentation_version_check
 CHECK(presentation_version IN ('task-v1','briefing-basic-v1','recommendation-v1'));
