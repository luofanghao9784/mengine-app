CREATE TABLE experience_entries (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
 revision integer NOT NULL DEFAULT 1, latest_number integer NOT NULL DEFAULT 1,
 status varchar(16) NOT NULL DEFAULT 'CANDIDATE' CHECK(status IN ('CANDIDATE','PUBLISHED','WITHDRAWN')),
 published_version uuid, created_by uuid NOT NULL REFERENCES accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id), UNIQUE(tenant_id,workspace_id,id)
);
CREATE INDEX experience_scope ON experience_entries(tenant_id,workspace_id,updated_at DESC,id);
CREATE TABLE experience_versions (
 id uuid PRIMARY KEY, entry_id uuid NOT NULL REFERENCES experience_entries(id), number integer NOT NULL,
 schema_version integer NOT NULL DEFAULT 1, content jsonb NOT NULL,
 access_mode varchar(20) NOT NULL CHECK(access_mode IN ('SOURCE_BOUND','INDEPENDENT_COPY')),
 search_terms text[] NOT NULL, tags text[] NOT NULL, scrubbed boolean NOT NULL DEFAULT false,
 created_by uuid NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(entry_id,number), UNIQUE(entry_id,id)
);
ALTER TABLE experience_entries ADD CONSTRAINT experience_published_version FOREIGN KEY(id,published_version) REFERENCES experience_versions(entry_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX experience_search ON experience_versions USING gin(search_terms);
CREATE INDEX experience_tags ON experience_versions USING gin(tags);
CREATE TABLE experience_evidence (
 version_id uuid NOT NULL REFERENCES experience_versions(id), kind varchar(20) NOT NULL CHECK(kind IN ('MATERIAL_VERSION','TASK')),
 reference_id uuid NOT NULL, source_workspace_id uuid NOT NULL,
 material_version_id uuid, task_id uuid,
 PRIMARY KEY(version_id,kind,reference_id),
 CHECK((kind='MATERIAL_VERSION' AND material_version_id=reference_id AND task_id IS NULL) OR (kind='TASK' AND task_id=reference_id AND material_version_id IS NULL))
);
CREATE INDEX experience_material_evidence ON experience_evidence(material_version_id) WHERE material_version_id IS NOT NULL;
CREATE TABLE experience_events (
 id uuid PRIMARY KEY, entry_id uuid NOT NULL REFERENCES experience_entries(id), version_id uuid,
 revision integer NOT NULL, action varchar(16) NOT NULL CHECK(action IN ('CREATED','REVISED','PUBLISHED','WITHDRAWN')),
 actor_id uuid NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE experience_uses (
 id uuid PRIMARY KEY, entry_id uuid NOT NULL REFERENCES experience_entries(id), version_id uuid NOT NULL REFERENCES experience_versions(id),
 actor_id uuid NOT NULL REFERENCES accounts(id), task_id uuid, context_key varchar(100) NOT NULL,
 decision varchar(20) NOT NULL CHECK(decision IN ('DIRECT','ADAPTED','UNKNOWN','NOT_APPLICABLE')),
 adopted boolean NOT NULL, conditions varchar(2000) NOT NULL, adjustments varchar(2000) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(actor_id,version_id,context_key),
 CHECK(NOT adopted OR decision IN ('DIRECT','ADAPTED'))
);
CREATE UNIQUE INDEX experience_task_use ON experience_uses(actor_id,version_id,task_id) WHERE task_id IS NOT NULL;
CREATE TABLE experience_feedback (
 id uuid PRIMARY KEY, use_id uuid NOT NULL REFERENCES experience_uses(id),
 result varchar(16) NOT NULL CHECK(result IN ('UNKNOWN','COMPLETED','FAILED','CORRECTED')),
 note varchar(2000) NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
-- Called by lifecycle cleanup before removing original content. Independent, explicitly authored copies survive.
CREATE FUNCTION scrub_experience_material(target uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE experience_versions v SET content='{}'::jsonb,search_terms='{}',tags='{}',scrubbed=true
 WHERE v.access_mode='SOURCE_BOUND' AND EXISTS(SELECT 1 FROM experience_evidence e JOIN material_versions m ON m.id=e.material_version_id WHERE e.version_id=v.id AND m.material_id=target);
 UPDATE experience_entries e SET status='WITHDRAWN',published_version=NULL,revision=revision+1,updated_at=now()
 WHERE EXISTS(SELECT 1 FROM experience_versions v WHERE v.id=e.published_version AND v.scrubbed);
 UPDATE experience_uses u SET conditions='',adjustments='',context_key='purged:'||u.id::text
 WHERE EXISTS(SELECT 1 FROM experience_versions v WHERE v.id=u.version_id AND v.scrubbed);
 UPDATE experience_feedback f SET note='' WHERE EXISTS(SELECT 1 FROM experience_uses u JOIN experience_versions v ON v.id=u.version_id WHERE u.id=f.use_id AND v.scrubbed);
END $$;
CREATE INDEX experience_event_history ON experience_events(entry_id,revision DESC,id);
CREATE INDEX experience_use_history ON experience_uses(entry_id,actor_id,created_at DESC,id);
CREATE INDEX experience_feedback_history ON experience_feedback(use_id,created_at DESC,id);
