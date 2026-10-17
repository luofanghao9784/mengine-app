-- Library ACL is independent of placement. Existing space grants stay dynamic;
-- existing readers keep download, while editing does not imply destructive actions.
-- Explicit rollout gate: no existing tenant is silently switched during schema migration.
CREATE TABLE library_permission_rollouts (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id), enabled boolean NOT NULL DEFAULT false
);
CREATE FUNCTION library_permissions_enabled(tenant uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT enabled FROM library_permission_rollouts WHERE tenant_id=tenant),false)
$$;
CREATE TABLE library_departments (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 name varchar(180) NOT NULL, revision integer NOT NULL DEFAULT 0,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,name)
);
CREATE TABLE library_department_members (
 tenant_id uuid NOT NULL, department_id uuid NOT NULL, account_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,department_id,account_id),
 FOREIGN KEY(tenant_id,department_id) REFERENCES library_departments(tenant_id,id),
 FOREIGN KEY(tenant_id,account_id) REFERENCES tenant_memberships(tenant_id,account_id)
);
CREATE TABLE library_policies (
 tenant_id uuid NOT NULL REFERENCES tenants(id), object_kind varchar(12) NOT NULL CHECK(object_kind IN('WORKSPACE','FOLDER','MATERIAL')),
 object_id uuid NOT NULL, workspace_id uuid NOT NULL, inherit boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,object_kind,object_id),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id)
);
CREATE TABLE library_grants (
 tenant_id uuid NOT NULL, object_kind varchar(12) NOT NULL, object_id uuid NOT NULL,
 principal_kind varchar(12) NOT NULL CHECK(principal_kind IN('ACCOUNT','DEPARTMENT')), principal_id uuid NOT NULL,
 content varchar(8) NOT NULL CHECK(content IN('NONE','READ','EDIT')),
 download varchar(8) NOT NULL CHECK(download IN('ALLOW','DENY','INHERIT')),
 manage_files boolean NOT NULL DEFAULT false,
 role_department_id uuid,
 PRIMARY KEY(tenant_id,object_kind,object_id,principal_kind,principal_id),
 FOREIGN KEY(tenant_id,object_kind,object_id) REFERENCES library_policies(tenant_id,object_kind,object_id),
 FOREIGN KEY(tenant_id,role_department_id) REFERENCES library_departments(tenant_id,id),
 CHECK(role_department_id IS NULL OR principal_kind='ACCOUNT'),
 CHECK(content<>'NONE' OR NOT manage_files)
);
CREATE TABLE library_change_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id), request_id uuid NOT NULL, fingerprint text NOT NULL,
 receipt jsonb NOT NULL, PRIMARY KEY(actor_id,request_id)
);
CREATE TABLE library_events (
 id bigserial PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 workspace_id uuid, object_kind varchar(16) NOT NULL, object_id uuid NOT NULL,
 actor_id uuid, action varchar(80) NOT NULL, outcome varchar(24) NOT NULL,
 before_value jsonb, after_value jsonb, occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX library_events_object ON library_events(tenant_id,object_kind,object_id,id DESC);
CREATE FUNCTION library_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Library audit records are append-only'; END $$;
CREATE TRIGGER library_event_immutable BEFORE UPDATE OR DELETE ON library_events FOR EACH ROW EXECUTE FUNCTION library_event_immutable();

-- read=1, edit=2, download=4, delegated move/delete=8. Management of ACL is separate.
CREATE FUNCTION library_mask(actor uuid, tenant uuid, kind text, target uuid) RETURNS integer LANGUAGE plpgsql STABLE AS $$
DECLARE space uuid; current_kind text:=kind; current_id uuid:=target; parent uuid; w record; p record; g record;
 allowed integer:=0; denied boolean:=false; download_denied boolean:=false; depth integer:=0; permission uuid;
BEGIN
 permission:=headquarters_permission_actor(actor,tenant);
 IF NOT EXISTS(SELECT 1 FROM tenant_memberships m JOIN accounts a ON a.id=m.account_id JOIN tenants t ON t.id=m.tenant_id
   WHERE m.tenant_id=tenant AND m.account_id=permission AND m.status='ACTIVE' AND a.status='ACTIVE' AND t.status='ACTIVE') THEN RETURN 0; END IF;
 IF kind='WORKSPACE' THEN space:=target;
 ELSIF kind='FOLDER' THEN SELECT workspace_id INTO space FROM material_folders WHERE tenant_id=tenant AND id=target;
 ELSIF kind='MATERIAL' THEN SELECT workspace_id INTO space FROM materials WHERE tenant_id=tenant AND id=target;
 ELSE RETURN 0; END IF;
 SELECT * INTO w FROM workspaces WHERE tenant_id=tenant AND id=space AND NOT archived;
 IF NOT FOUND OR NOT departure_content_readable(permission,tenant,space) THEN RETURN 0; END IF;
 IF w.kind='PERSONAL' THEN RETURN CASE WHEN w.owner_id=permission THEN 15 ELSE 0 END; END IF;
 IF NOT library_permissions_enabled(tenant) THEN
   SELECT * INTO g FROM workspace_members WHERE tenant_id=tenant AND workspace_id=space AND account_id=permission;
   RETURN CASE WHEN NOT FOUND THEN 0 WHEN g.can_maintain THEN 15 ELSE 5 END;
 END IF;
 LOOP
   depth:=depth+1; IF depth>34 THEN RETURN 0; END IF;
   SELECT * INTO p FROM library_policies WHERE tenant_id=tenant AND object_kind=current_kind AND object_id=current_id;
   FOR g IN SELECT a.* FROM library_grants a WHERE a.tenant_id=tenant AND a.object_kind=current_kind AND a.object_id=current_id AND
     ((a.principal_kind='ACCOUNT' AND a.principal_id=permission) OR (a.principal_kind='DEPARTMENT' AND EXISTS(
       SELECT 1 FROM library_department_members d WHERE d.tenant_id=tenant AND d.department_id=a.principal_id AND d.account_id=permission)))
     AND (a.role_department_id IS NULL OR EXISTS(SELECT 1 FROM library_department_members d WHERE d.tenant_id=tenant AND d.department_id=a.role_department_id AND d.account_id=permission))
   LOOP
     IF g.content='NONE' THEN denied:=true;
     ELSE allowed:=allowed | CASE WHEN g.content='EDIT' THEN 3 ELSE 1 END;
       IF g.manage_files THEN allowed:=allowed | 8; END IF;
     END IF;
     IF g.download='ALLOW' THEN allowed:=allowed | 4; END IF;
     IF g.download='DENY' THEN download_denied:=true; END IF;
   END LOOP;
   IF p.inherit=false THEN EXIT; END IF;
   IF current_kind='WORKSPACE' THEN
     SELECT * INTO g FROM workspace_members WHERE tenant_id=tenant AND workspace_id=space AND account_id=permission;
     IF FOUND THEN allowed:=allowed | CASE WHEN g.can_maintain THEN 7 ELSE 5 END; END IF;
     EXIT;
   ELSIF current_kind='MATERIAL' THEN SELECT folder_id INTO parent FROM materials WHERE tenant_id=tenant AND id=current_id;
   ELSE SELECT parent_id INTO parent FROM material_folders WHERE tenant_id=tenant AND id=current_id; END IF;
   current_kind:=CASE WHEN parent IS NULL THEN 'WORKSPACE' ELSE 'FOLDER' END;
   current_id:=coalesce(parent,space);
 END LOOP;
 IF denied OR (allowed & 1)=0 THEN RETURN 0; END IF;
 IF download_denied THEN allowed:=allowed & ~4; END IF;
 RETURN allowed;
END $$;
CREATE FUNCTION library_can_manage(actor uuid, tenant uuid, space uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM tenant_memberships m JOIN accounts a ON a.id=m.account_id JOIN workspaces w ON w.tenant_id=m.tenant_id
  WHERE m.tenant_id=tenant AND w.id=space AND m.account_id=actor AND m.status='ACTIVE' AND a.status='ACTIVE' AND NOT w.archived
  AND ((w.kind='PERSONAL' AND w.owner_id=actor) OR (w.kind='SHARED' AND (m.role='TENANT_ADMIN' OR (w.responsibility_confirmed AND w.owner_id=actor)))))
$$;
-- Evidence of the confirmed migration; no rewriting of legacy grants or file versions.
INSERT INTO library_events(tenant_id,workspace_id,object_kind,object_id,action,outcome,after_value)
 SELECT tenant_id,id,'WORKSPACE',id,'PERMISSION_MODEL_MIGRATION','SUCCESS',
 '{"legacyDownload":"preserved","legacyEdit":"preserved","moveDelete":"administratorOrDelegate"}'::jsonb FROM workspaces WHERE kind='SHARED';

-- Project existing authoritative file events into a single object-local timeline.
CREATE FUNCTION library_project_identity_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE material uuid; space uuid; folder uuid;
BEGIN
 IF NEW.tenant_id IS NULL OR NEW.target_id IS NULL THEN RETURN NEW; END IF;
 SELECT m.id,m.workspace_id INTO material,space FROM materials m WHERE m.tenant_id=NEW.tenant_id AND m.id=NEW.target_id;
 IF material IS NULL THEN
   SELECT v.material_id,v.workspace_id INTO material,space FROM material_versions v WHERE v.tenant_id=NEW.tenant_id AND v.id=NEW.target_id;
 END IF;
 IF material IS NOT NULL THEN
   INSERT INTO library_events(tenant_id,workspace_id,object_kind,object_id,actor_id,action,outcome)
   VALUES(NEW.tenant_id,space,'MATERIAL',material,NEW.actor_id,NEW.action,NEW.outcome);
 ELSE
   SELECT f.id,f.workspace_id INTO folder,space FROM material_folders f WHERE f.tenant_id=NEW.tenant_id AND f.id=NEW.target_id;
   IF folder IS NOT NULL THEN
     INSERT INTO library_events(tenant_id,workspace_id,object_kind,object_id,actor_id,action,outcome)
     VALUES(NEW.tenant_id,space,'FOLDER',folder,NEW.actor_id,NEW.action,NEW.outcome);
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER library_identity_event AFTER INSERT ON identity_audit FOR EACH ROW EXECUTE FUNCTION library_project_identity_event();

-- Recheck actual fixed material dependencies at task history and delivery boundaries.
CREATE FUNCTION library_task_materials_readable(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS (
  SELECT 1 FROM (
   SELECT s.task_id,c.version_id FROM conversation_sources s JOIN knowledge_chunks c ON c.id=s.chunk_id
   UNION SELECT task_id,version_id FROM conversation_originals
   UNION SELECT g.task_id,c.version_id FROM conversation_agent_grants g JOIN knowledge_chunks c ON c.id=g.chunk_id
   UNION SELECT task_id,version_id FROM feedback_task_sources
   UNION SELECT task_id,version_id FROM task_context_materials
  ) dep JOIN conversation_tasks t ON t.id=dep.task_id JOIN material_versions v ON v.id=dep.version_id
  WHERE t.id=target AND (library_mask(t.requested_by,t.tenant_id,'MATERIAL',v.material_id)&1)=0
 )
$$;
DO $$ DECLARE prior text; BEGIN
 prior:=regexp_replace(pg_get_viewdef('readable_source_tasks'::regclass,true), ';\s*$', '');
 EXECUTE 'CREATE OR REPLACE VIEW readable_source_tasks AS SELECT prior.id FROM ('||prior||') prior WHERE library_task_materials_readable(prior.id)';
END $$;
