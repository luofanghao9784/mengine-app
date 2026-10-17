-- On-demand context is reference data, never a new source of authorization.
CREATE TABLE task_context_reads (
 task_id uuid NOT NULL REFERENCES conversation_tasks(id), attempt_number integer NOT NULL,
 kind varchar(16) NOT NULL CHECK(kind IN ('PROFILE','HISTORY','EXPERIENCE')),
 reference_id uuid NOT NULL, version_key varchar(64) NOT NULL, content_hash varchar(64) NOT NULL,
 read_parts smallint NOT NULL DEFAULT 0 CHECK(read_parts BETWEEN 0 AND 3),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(task_id,attempt_number,kind,reference_id),
 FOREIGN KEY(task_id,attempt_number) REFERENCES conversation_attempts(task_id,attempt_number)
);
CREATE TABLE task_context_materials (
 task_id uuid NOT NULL REFERENCES conversation_tasks(id), attempt_number integer NOT NULL,
 version_id uuid NOT NULL REFERENCES material_versions(id),
 PRIMARY KEY(task_id,attempt_number,version_id),
 FOREIGN KEY(task_id,attempt_number) REFERENCES conversation_attempts(task_id,attempt_number)
);
CREATE INDEX task_context_materials_version ON task_context_materials(version_id);
CREATE TABLE task_context_reviews (
 id uuid PRIMARY KEY, task_id uuid NOT NULL, attempt_number integer NOT NULL,
 version_id uuid NOT NULL REFERENCES experience_versions(id), request_id uuid NOT NULL,
 request_hash varchar(64) NOT NULL, decision varchar(24) NOT NULL CHECK(decision IN ('DIRECT','ADAPTED','UNKNOWN','NOT_APPLICABLE')),
 conditions varchar(1000) NOT NULL, adjustments varchar(1000) NOT NULL,
 use_id uuid REFERENCES experience_uses(id), created_at timestamptz NOT NULL DEFAULT now(), scrubbed boolean NOT NULL DEFAULT false,
 UNIQUE(task_id,attempt_number,request_id),
 FOREIGN KEY(task_id,attempt_number) REFERENCES conversation_attempts(task_id,attempt_number)
);
-- Preserve every earlier source predicate, including feedback correction dependencies from V23.
DO $$ DECLARE prior text; BEGIN
 prior := regexp_replace(pg_get_viewdef('readable_source_tasks'::regclass,true), ';\s*$', '');
 EXECUTE 'CREATE OR REPLACE VIEW readable_source_tasks AS SELECT prior.id FROM (' || prior || ') prior
 WHERE NOT EXISTS (SELECT 1 FROM task_context_materials d
 JOIN conversation_tasks t ON t.id=d.task_id JOIN material_versions v ON v.id=d.version_id
 WHERE d.task_id=prior.id AND NOT EXISTS (
 SELECT 1 FROM active_materials m JOIN workspaces w ON w.id=m.workspace_id AND w.tenant_id=m.tenant_id
 WHERE m.id=v.material_id AND m.tenant_id=t.tenant_id AND
 ((w.kind=''PERSONAL'' AND w.owner_id=t.requested_by) OR
 (w.kind=''SHARED'' AND EXISTS(SELECT 1 FROM workspace_members a WHERE a.tenant_id=w.tenant_id AND a.workspace_id=w.id AND a.account_id=t.requested_by)))))';
END $$;
-- Called by lifecycle cleanup after it has identified all derived tasks. Identifiers remain for fencing.
CREATE FUNCTION scrub_task_context_material(target uuid) RETURNS void LANGUAGE sql AS $$
 UPDATE task_context_reviews r SET conditions='',adjustments='',scrubbed=true
 WHERE EXISTS(SELECT 1 FROM task_context_materials d JOIN material_versions v ON v.id=d.version_id
 WHERE d.task_id=r.task_id AND v.material_id=target);
$$;
