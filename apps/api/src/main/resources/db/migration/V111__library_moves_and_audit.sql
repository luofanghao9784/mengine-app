ALTER TABLE identity_audit ADD COLUMN request_id uuid;
-- Trace request attempts separately from committed operations; historical facts retain original time.
ALTER TABLE library_events ADD COLUMN request_id uuid, ADD COLUMN version_id uuid,
 ADD COLUMN execution_source varchar(12) NOT NULL DEFAULT 'HUMAN' CHECK(execution_source IN('HUMAN','AI','SYSTEM')),
 ADD COLUMN http_status integer, ADD COLUMN identity_audit_id bigint;
CREATE UNIQUE INDEX library_event_identity ON library_events(identity_audit_id) WHERE identity_audit_id IS NOT NULL;
CREATE TABLE library_move_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id), request_id uuid NOT NULL,
 tenant_id uuid NOT NULL REFERENCES tenants(id), fingerprint text NOT NULL, receipt jsonb NOT NULL,
 PRIMARY KEY(actor_id,request_id)
);
CREATE FUNCTION library_projected_mask(actor uuid, tenant uuid, kind text, target uuid, moving_kind text DEFAULT NULL, moving_id uuid DEFAULT NULL, destination uuid DEFAULT NULL, force_inherit boolean DEFAULT false) RETURNS integer LANGUAGE plpgsql STABLE AS $$
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
   IF p.inherit=false AND NOT (coalesce(current_kind=moving_kind AND current_id=moving_id,false) AND force_inherit) THEN EXIT; END IF;
   IF current_kind='WORKSPACE' THEN
     SELECT * INTO g FROM workspace_members WHERE tenant_id=tenant AND workspace_id=space AND account_id=permission;
     IF FOUND THEN allowed:=allowed | CASE WHEN g.can_maintain THEN 7 ELSE 5 END; END IF;
     EXIT;
   ELSIF current_kind=moving_kind AND current_id=moving_id THEN parent:=destination;
   ELSIF current_kind='MATERIAL' THEN SELECT folder_id INTO parent FROM materials WHERE tenant_id=tenant AND id=current_id;
   ELSE SELECT parent_id INTO parent FROM material_folders WHERE tenant_id=tenant AND id=current_id; END IF;
   current_kind:=CASE WHEN parent IS NULL THEN 'WORKSPACE' ELSE 'FOLDER' END;
   current_id:=coalesce(parent,space);
 END LOOP;
 IF denied OR (allowed & 1)=0 THEN RETURN 0; END IF;
 IF download_denied THEN allowed:=allowed & ~4; END IF;
 RETURN allowed;
END $$;
CREATE OR REPLACE FUNCTION library_mask(actor uuid, tenant uuid, kind text, target uuid) RETURNS integer LANGUAGE sql STABLE AS $$
 SELECT library_projected_mask(actor,tenant,kind,target)
$$;
CREATE OR REPLACE FUNCTION library_project_identity_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE material uuid; space uuid; folder uuid; version uuid;
BEGIN
 IF NEW.tenant_id IS NULL OR NEW.target_id IS NULL THEN RETURN NEW; END IF;
 SELECT m.id,m.workspace_id INTO material,space FROM materials m WHERE m.tenant_id=NEW.tenant_id AND m.id=NEW.target_id;
 IF material IS NULL THEN
   SELECT v.material_id,v.workspace_id,v.id INTO material,space,version FROM material_versions v WHERE v.tenant_id=NEW.tenant_id AND v.id=NEW.target_id;
 END IF;
 IF material IS NOT NULL THEN
   INSERT INTO library_events(tenant_id,workspace_id,object_kind,object_id,actor_id,action,outcome,identity_audit_id,execution_source,occurred_at,request_id,version_id)
   VALUES(NEW.tenant_id,space,'MATERIAL',material,NEW.actor_id,NEW.action,NEW.outcome,NEW.id,CASE WHEN NEW.action LIKE 'TASK_%' THEN 'AI' WHEN NEW.actor_id IS NULL OR NEW.action LIKE 'KNOWLEDGE_%' THEN 'SYSTEM' ELSE 'HUMAN' END,NEW.created_at,NEW.request_id,version);
 ELSE
   SELECT f.id,f.workspace_id INTO folder,space FROM material_folders f WHERE f.tenant_id=NEW.tenant_id AND f.id=NEW.target_id;
   IF folder IS NOT NULL THEN
     INSERT INTO library_events(tenant_id,workspace_id,object_kind,object_id,actor_id,action,outcome,identity_audit_id,execution_source,occurred_at,request_id,version_id)
     VALUES(NEW.tenant_id,space,'FOLDER',folder,NEW.actor_id,NEW.action,NEW.outcome,NEW.id,CASE WHEN NEW.action LIKE 'TASK_%' THEN 'AI' WHEN NEW.actor_id IS NULL OR NEW.action LIKE 'KNOWLEDGE_%' THEN 'SYSTEM' ELSE 'HUMAN' END,NEW.created_at,NEW.request_id,version);
   END IF;
 END IF;
 RETURN NEW;
END $$;

INSERT INTO library_events(tenant_id,workspace_id,object_kind,object_id,actor_id,action,outcome,occurred_at,identity_audit_id,execution_source,version_id)
SELECT a.tenant_id,coalesce(m.workspace_id,v.workspace_id,f.workspace_id),
 CASE WHEN f.id IS NOT NULL THEN 'FOLDER' ELSE 'MATERIAL' END,coalesce(m.id,v.material_id,f.id),
 a.actor_id,a.action,a.outcome,a.created_at,a.id,
 CASE WHEN a.action LIKE 'TASK_%' THEN 'AI' WHEN a.actor_id IS NULL OR a.action LIKE 'KNOWLEDGE_%' THEN 'SYSTEM' ELSE 'HUMAN' END,v.id
FROM identity_audit a
LEFT JOIN materials m ON m.tenant_id=a.tenant_id AND m.id=a.target_id
LEFT JOIN material_versions v ON v.tenant_id=a.tenant_id AND v.id=a.target_id
LEFT JOIN material_folders f ON f.tenant_id=a.tenant_id AND f.id=a.target_id
WHERE coalesce(m.id,v.material_id,f.id) IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM library_events e WHERE e.tenant_id=a.tenant_id AND e.object_id=coalesce(m.id,v.material_id,f.id)
 AND e.action=a.action AND e.actor_id IS NOT DISTINCT FROM a.actor_id AND e.occurred_at=a.created_at
) ON CONFLICT DO NOTHING;
