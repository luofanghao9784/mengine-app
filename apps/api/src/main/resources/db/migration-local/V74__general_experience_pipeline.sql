-- Preserve a bounded provenance fact before private candidate receipts are erased. Never infer old facts.
ALTER TABLE experience_versions ADD COLUMN automatic_basis varchar(24) CHECK(automatic_basis IN ('OBSERVED_EXECUTION','FEEDBACK_CORRECTION'));
ALTER TABLE experience_versions ADD COLUMN automatic_steps jsonb CHECK(automatic_steps IS NULL OR jsonb_typeof(automatic_steps)='array');
CREATE TABLE experience_generalization_sources (
 version_id uuid PRIMARY KEY REFERENCES experience_versions(id),tenant_id uuid NOT NULL REFERENCES tenants(id),
 workspace_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES accounts(id),
 state varchar(24) NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','RUNNING','RETRY_WAIT','QUALIFIED','SKIPPED','REJECTED','FAILED','UNKNOWN','ADMITTED','DUPLICATE','CONFLICT','SOURCE_UNAVAILABLE')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),run_id uuid,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 error_code varchar(64),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id)
);
CREATE TABLE experience_generalization_runs (
 id uuid PRIMARY KEY,source_id uuid NOT NULL REFERENCES experience_generalization_sources(version_id),tenant_id uuid NOT NULL REFERENCES tenants(id),
 lease uuid NOT NULL,lease_until timestamptz NOT NULL,state varchar(24) NOT NULL CHECK(state IN ('CLAIMED','DISPATCHED','RETURNED','FAILED','UNKNOWN','CANCELLED')),
 job_hash varchar(64) NOT NULL,engine_version varchar(64),execution_class varchar(16) CHECK(execution_class IN ('live','verification')),
 outcome varchar(24),code varchar(64),stages jsonb,method jsonb,privacy jsonb,quality jsonb,
 invalidated boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz
);
ALTER TABLE experience_generalization_sources ADD FOREIGN KEY(run_id) REFERENCES experience_generalization_runs(id);
CREATE INDEX generalization_pending ON experience_generalization_sources(state,next_attempt_at,tenant_id);
CREATE UNIQUE INDEX generalization_one_tenant ON experience_generalization_runs(tenant_id) WHERE state IN ('CLAIMED','DISPATCHED');
-- General assets contain cleaned methods only. Source linkage remains in separate internal tables.
CREATE TABLE general_experience_entries (
 id uuid PRIMARY KEY,revision integer NOT NULL DEFAULT 1,status varchar(16) NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN ('AVAILABLE','STOPPED','WITHDRAWN')),
 published_version uuid,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE general_experience_versions (
 id uuid PRIMARY KEY,entry_id uuid NOT NULL REFERENCES general_experience_entries(id),number integer NOT NULL,
 method jsonb,content_fingerprint varchar(64) NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(entry_id,number)
);
ALTER TABLE general_experience_entries ADD FOREIGN KEY(published_version) REFERENCES general_experience_versions(id);
CREATE INDEX general_experience_fingerprint ON general_experience_versions(content_fingerprint);
CREATE TABLE general_experience_origins (
 version_id uuid PRIMARY KEY REFERENCES general_experience_versions(id),source_version uuid NOT NULL REFERENCES experience_generalization_sources(version_id)
);
CREATE INDEX general_experience_source ON general_experience_origins(source_version);
CREATE TABLE general_experience_admissions (
 run_id uuid PRIMARY KEY REFERENCES experience_generalization_runs(id),outcome varchar(24) NOT NULL CHECK(outcome IN ('CREATED','DUPLICATE','CONFLICT','SOURCE_UNAVAILABLE')),
 entry_id uuid REFERENCES general_experience_entries(id),version_id uuid REFERENCES general_experience_versions(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION generalization_source_available(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE s experience_generalization_sources%ROWTYPE;
BEGIN
 SELECT * INTO s FROM experience_generalization_sources WHERE version_id=target AND state<>'SOURCE_UNAVAILABLE';
 IF NOT FOUND THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM tenants t JOIN tenant_memberships m ON m.tenant_id=t.id AND m.account_id=s.actor_id AND m.status='ACTIVE'
 JOIN accounts a ON a.id=m.account_id AND a.status='ACTIVE' JOIN workspaces w ON w.id=s.workspace_id AND w.tenant_id=t.id
 WHERE t.id=s.tenant_id AND t.status IN ('ACTIVE','SUSPENDED') AND ((w.kind='PERSONAL' AND w.owner_id=s.actor_id) OR EXISTS(SELECT 1 FROM workspace_members g WHERE g.workspace_id=w.id AND g.account_id=s.actor_id)))
 OR NOT departure_content_readable(s.actor_id,s.tenant_id,s.workspace_id) THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM experience_versions v JOIN experience_entries e ON e.id=v.entry_id
 WHERE v.id=target AND e.tenant_id=s.tenant_id AND e.workspace_id=s.workspace_id AND v.created_by=s.actor_id
 AND EXISTS(SELECT 1 FROM experience_admissions admission JOIN experience_analysis_runs run ON run.id=admission.run_id WHERE admission.version_id=v.id AND admission.outcome IN ('CREATED','UPDATED') AND run.execution_class='live' AND run.outcome='QUALIFIED')
 AND v.origin='AUTOMATIC' AND v.evaluation='AUTOMATIC_CHECKED' AND v.automatic_basis IS NOT NULL AND v.automatic_steps IS NOT NULL AND v.content->>'kind'='METHOD'
 AND NOT v.scrubbed AND NOT e.automation_stopped AND object_is_active('EXPERIENCE_VERSION',v.id)
 AND (s.state IN ('ADMITTED','DUPLICATE') OR (e.status='PUBLISHED' AND e.published_version=v.id))
 AND NOT EXISTS(SELECT 1 FROM experience_evidence r WHERE r.version_id=v.id AND NOT EXISTS(
 SELECT 1 FROM workspaces w WHERE w.id=r.source_workspace_id AND w.tenant_id=e.tenant_id
 AND ((w.kind='PERSONAL' AND w.owner_id=s.actor_id) OR (w.kind='SHARED' AND EXISTS(SELECT 1 FROM workspace_members g WHERE g.workspace_id=w.id AND g.account_id=s.actor_id)))
 AND ((r.kind='MATERIAL_VERSION' AND EXISTS(SELECT 1 FROM material_versions mv JOIN active_materials am ON am.id=mv.material_id WHERE mv.id=r.material_version_id AND mv.tenant_id=e.tenant_id AND mv.workspace_id=w.id))
 OR (r.kind='TASK' AND EXISTS(SELECT 1 FROM conversation_tasks task JOIN conversations c ON c.id=task.conversation_id WHERE task.id=r.task_id AND task.tenant_id=e.tenant_id AND task.workspace_id=w.id AND c.owner_id=s.actor_id AND EXISTS(SELECT 1 FROM readable_source_tasks rt WHERE rt.id=task.id))))))) THEN RETURN false; END IF;
 -- Traverse exact version dependencies, never use a latest-version replacement or inferred evidence basis.
 RETURN NOT EXISTS(WITH RECURSIVE deps(id) AS(SELECT target UNION SELECT d.dependency_version FROM experience_automatic_dependencies d JOIN deps p ON p.id=d.version_id)
 SELECT 1 FROM deps d JOIN experience_versions v ON v.id=d.id WHERE v.scrubbed OR NOT object_is_active('EXPERIENCE_VERSION',v.id)
 OR (v.origin='AUTOMATIC' AND NOT EXISTS(SELECT 1 FROM experience_automatic_sources a WHERE a.version_id=v.id))
 OR EXISTS(SELECT 1 FROM experience_automatic_sources a WHERE a.version_id=v.id AND NOT experience_intake_available(a.source_id)));
END $$;
CREATE FUNCTION general_experience_available(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM general_experience_versions v JOIN general_experience_entries e ON e.id=v.entry_id
 JOIN general_experience_origins o ON o.version_id=v.id
 WHERE v.id=target AND e.status='AVAILABLE' AND e.published_version=v.id AND v.method IS NOT NULL AND generalization_source_available(o.source_version))
$$;
CREATE FUNCTION fence_general_experience() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='experience_generalization_sources' THEN
  IF NEW.state='SOURCE_UNAVAILABLE' AND OLD.state<>'SOURCE_UNAVAILABLE' THEN
   UPDATE experience_generalization_runs SET invalidated=true,method=NULL,privacy=NULL,quality=NULL,
    state=CASE WHEN state IN ('CLAIMED','DISPATCHED') THEN 'CANCELLED' ELSE state END,code='GENERALIZATION_SOURCE_CHANGED',finished_at=coalesce(finished_at,now()) WHERE source_id=NEW.version_id;
   UPDATE general_experience_versions SET method=NULL WHERE id IN (SELECT version_id FROM general_experience_origins WHERE source_version=NEW.version_id);
   UPDATE general_experience_entries SET status='WITHDRAWN',revision=revision+1,updated_at=now() WHERE published_version IN (SELECT version_id FROM general_experience_origins WHERE source_version=NEW.version_id) AND status<>'WITHDRAWN';
  END IF;
 ELSIF TG_TABLE_NAME='experience_entries' THEN
  UPDATE experience_generalization_sources SET state='SOURCE_UNAVAILABLE',error_code='GENERALIZATION_SOURCE_CHANGED',updated_at=now()
  WHERE state<>'SOURCE_UNAVAILABLE' AND version_id IN (SELECT id FROM experience_versions WHERE entry_id=NEW.id) AND NOT generalization_source_available(version_id);
 ELSIF TG_TABLE_NAME='experience_versions' THEN
  UPDATE experience_generalization_sources SET state='SOURCE_UNAVAILABLE',error_code='GENERALIZATION_SOURCE_CHANGED',updated_at=now()
  WHERE state<>'SOURCE_UNAVAILABLE' AND version_id=NEW.id AND NOT generalization_source_available(version_id);
 ELSE
  UPDATE experience_generalization_sources SET state='SOURCE_UNAVAILABLE',error_code='GENERALIZATION_SOURCE_CHANGED',updated_at=now()
  WHERE state<>'SOURCE_UNAVAILABLE' AND NOT generalization_source_available(version_id);
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER generalization_source_invalidated AFTER UPDATE OF state ON experience_generalization_sources FOR EACH ROW EXECUTE FUNCTION fence_general_experience();
CREATE TRIGGER generalization_entry_changed AFTER UPDATE ON experience_entries FOR EACH ROW EXECUTE FUNCTION fence_general_experience();
CREATE TRIGGER generalization_version_changed AFTER UPDATE OF scrubbed ON experience_versions FOR EACH ROW EXECUTE FUNCTION fence_general_experience();
CREATE TRIGGER generalization_membership_changed AFTER DELETE OR UPDATE ON workspace_members FOR EACH ROW EXECUTE FUNCTION fence_general_experience();
CREATE TRIGGER generalization_tenant_member_changed AFTER DELETE OR UPDATE ON tenant_memberships FOR EACH ROW EXECUTE FUNCTION fence_general_experience();
CREATE TRIGGER generalization_account_changed AFTER UPDATE OF status ON accounts FOR EACH ROW EXECUTE FUNCTION fence_general_experience();
CREATE TRIGGER generalization_tenant_changed AFTER UPDATE OF status ON tenants FOR EACH ROW EXECUTE FUNCTION fence_general_experience();
CREATE TRIGGER generalization_lifecycle_changed AFTER UPDATE OF state ON object_lifecycle FOR EACH ROW EXECUTE FUNCTION fence_general_experience();
CREATE TRIGGER generalization_departure_changed AFTER INSERT OR UPDATE OF state ON departure_executions FOR EACH ROW EXECUTE FUNCTION fence_general_experience();
CREATE TRIGGER generalization_material_state_changed AFTER INSERT OR UPDATE OF state ON content_lifecycle FOR EACH ROW EXECUTE FUNCTION fence_general_experience();
CREATE TRIGGER generalization_material_scope_changed AFTER UPDATE OF workspace_id,in_library ON materials FOR EACH ROW EXECUTE FUNCTION fence_general_experience();
CREATE FUNCTION scrub_automatic_experience_steps() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.scrubbed THEN NEW.automatic_steps=NULL; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER automatic_steps_scrubbed BEFORE UPDATE OF scrubbed ON experience_versions FOR EACH ROW EXECUTE FUNCTION scrub_automatic_experience_steps();
CREATE TRIGGER generalization_workspace_owner_changed AFTER UPDATE OF owner_id ON workspaces FOR EACH ROW EXECUTE FUNCTION fence_general_experience();
