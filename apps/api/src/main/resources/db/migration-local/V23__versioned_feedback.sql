CREATE TABLE feedback_entries (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,workspace_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES accounts(id),
 kind varchar(12) NOT NULL CHECK(kind IN ('BRIEFING','TASK')),task_id uuid NOT NULL REFERENCES conversation_tasks(id),
 task_revision integer NOT NULL CHECK(task_revision>=0),attempt integer NOT NULL CHECK(attempt>=0),
 presentation_version varchar(32) NOT NULL CHECK(presentation_version IN ('briefing-basic-v1','task-v1')),
 presentation_revision integer NOT NULL CHECK(presentation_revision>=0),snapshot jsonb NOT NULL,
 revision integer NOT NULL DEFAULT 1,scrubbed boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id),
 UNIQUE(actor_id,kind,task_id,task_revision,attempt,presentation_version,presentation_revision)
);
CREATE TABLE feedback_versions (
 id uuid PRIMARY KEY,feedback_id uuid NOT NULL REFERENCES feedback_entries(id),revision integer NOT NULL,
 status varchar(12) NOT NULL CHECK(status IN ('ACTIVE','WITHDRAWN')),assessment jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(feedback_id,revision)
);
CREATE TABLE feedback_source_versions (
 feedback_id uuid NOT NULL REFERENCES feedback_entries(id),version_id uuid NOT NULL REFERENCES material_versions(id),
 PRIMARY KEY(feedback_id,version_id)
);
CREATE INDEX feedback_source_lookup ON feedback_source_versions(version_id);
CREATE TABLE feedback_actions (
 id uuid PRIMARY KEY,feedback_id uuid NOT NULL REFERENCES feedback_entries(id),feedback_revision integer NOT NULL,
 kind varchar(24) NOT NULL CHECK(kind IN ('PREFERENCE','CORRECTION','EXPERIENCE_CANDIDATE')),
 fingerprint varchar(64) NOT NULL,receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(feedback_id,feedback_revision,kind)
);
CREATE TABLE feedback_task_sources (
 task_id uuid NOT NULL REFERENCES conversation_tasks(id),version_id uuid NOT NULL REFERENCES material_versions(id),
 feedback_id uuid NOT NULL REFERENCES feedback_entries(id),PRIMARY KEY(task_id,version_id)
);
CREATE INDEX feedback_task_source_lookup ON feedback_task_sources(version_id);
CREATE VIEW readable_feedback AS SELECT f.id FROM feedback_entries f WHERE NOT f.scrubbed AND NOT EXISTS(
 SELECT 1 FROM feedback_source_versions s JOIN material_versions v ON v.id=s.version_id WHERE s.feedback_id=f.id
 AND NOT EXISTS(SELECT 1 FROM active_materials m WHERE m.id=v.material_id));
CREATE OR REPLACE VIEW readable_source_tasks AS SELECT t.id FROM conversation_tasks t WHERE
 NOT EXISTS(SELECT 1 FROM conversation_sources s JOIN knowledge_chunks c ON c.id=s.chunk_id WHERE s.task_id=t.id AND NOT EXISTS(SELECT 1 FROM active_materials m WHERE m.id=c.material_id))
 AND NOT EXISTS(SELECT 1 FROM conversation_originals o WHERE o.task_id=t.id AND NOT EXISTS(SELECT 1 FROM active_materials m WHERE m.id=o.material_id))
 AND NOT EXISTS(SELECT 1 FROM conversation_agent_grants g JOIN knowledge_chunks c ON c.id=g.chunk_id WHERE g.task_id=t.id AND NOT EXISTS(SELECT 1 FROM active_materials m WHERE m.id=c.material_id))
 AND NOT EXISTS(SELECT 1 FROM feedback_task_sources s JOIN material_versions v ON v.id=s.version_id WHERE s.task_id=t.id AND NOT EXISTS(SELECT 1 FROM active_materials m WHERE m.id=v.material_id));
-- Preferences contain only independently confirmed presentation enums, never copied source prose.
-- Source-bound candidates carry all versions as experience_evidence and use scrub_experience_material.
CREATE FUNCTION scrub_feedback_material(target uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t uuid;
BEGIN
 UPDATE feedback_entries f SET scrubbed=true WHERE EXISTS(SELECT 1 FROM feedback_source_versions s JOIN material_versions v ON v.id=s.version_id WHERE s.feedback_id=f.id AND v.material_id=target);
 UPDATE feedback_versions v SET assessment='{}'::jsonb WHERE EXISTS(SELECT 1 FROM feedback_entries f WHERE f.id=v.feedback_id AND f.scrubbed);
 FOR t IN SELECT DISTINCT s.task_id FROM feedback_task_sources s JOIN material_versions v ON v.id=s.version_id WHERE v.material_id=target LOOP
  UPDATE conversation_tasks SET prompt='内容已按来源生命周期清理',supplemental_input='',reply=NULL,web_sources='[]',skills='[]',lease_token=NULL,lease_until=NULL,error_code='SOURCE_REMOVED',status=CASE WHEN status IN ('QUEUED','RUNNING','PAUSED','WAITING_INPUT','WAITING_CAPABILITY') THEN 'CANCELLED' ELSE status END,revision=revision+1 WHERE id=t;
  UPDATE conversation_attempts SET input='内容已按来源生命周期清理',snapshot='{}'::jsonb WHERE task_id=t;
  UPDATE conversation_artifacts SET content=''::bytea,filename='removed',sha256='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' WHERE task_id=t;
  UPDATE private_document_versions SET title='内容已清理',body='' WHERE document_id IN(SELECT id FROM private_documents WHERE source_task_id=t);
  DELETE FROM private_document_exports WHERE document_id IN(SELECT id FROM private_documents WHERE source_task_id=t);
 END LOOP;
END $$;
