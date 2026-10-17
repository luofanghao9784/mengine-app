-- Effective facts are separate from V29 preparation. Non-CANCELLED facts are permanent restore guards.
CREATE TABLE departure_executions (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), kind varchar(24) NOT NULL CHECK(kind IN('MEMBER_OFFBOARD','TENANT_EXIT')),
 target_account_id uuid REFERENCES accounts(id), state varchar(24) NOT NULL CHECK(state IN('ISOLATING','ISOLATED','EXPORT_WINDOW','RESTORING','CLEANING','COMPLETE','FAILED','CANCELLED')),
 revision integer NOT NULL DEFAULT 1, requested_by uuid NOT NULL REFERENCES accounts(id), reason varchar(500) NOT NULL,
 policy_key varchar(40) NOT NULL, policy_revision integer NOT NULL, effective_at timestamptz NOT NULL, deadline timestamptz NOT NULL,
 prior_member_status varchar(16), stopped_member_version bigint, prior_tenant_status varchar(16) NOT NULL,
 stop_complete boolean NOT NULL DEFAULT false, isolation_complete boolean NOT NULL DEFAULT false, materials_complete boolean NOT NULL DEFAULT false,
 objects_complete boolean NOT NULL DEFAULT false, completed_at timestamptz, cancelled_at timestamptz,
 error_code varchar(80), worker_attempts integer NOT NULL DEFAULT 0, checked_at timestamptz,
 backup_state varchar(24) NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK(backup_state='PENDING_VERIFICATION'),
 CHECK((kind='MEMBER_OFFBOARD' AND target_account_id IS NOT NULL) OR (kind='TENANT_EXIT' AND target_account_id IS NULL)),
 CHECK(deadline>effective_at), UNIQUE(tenant_id,id)
);
CREATE UNIQUE INDEX departure_one_effective_target ON departure_executions(tenant_id,kind,coalesce(target_account_id,'00000000-0000-0000-0000-000000000000'::uuid)) WHERE state<>'CANCELLED';
CREATE INDEX departure_worker_due ON departure_executions(checked_at NULLS FIRST,effective_at) WHERE state NOT IN('COMPLETE','CANCELLED');
CREATE TABLE departure_export_grants (
 execution_id uuid NOT NULL,tenant_id uuid NOT NULL,account_id uuid NOT NULL,workspace_id uuid NOT NULL,
 PRIMARY KEY(execution_id,account_id,workspace_id), FOREIGN KEY(tenant_id,execution_id) REFERENCES departure_executions(tenant_id,id),
 FOREIGN KEY(tenant_id,account_id) REFERENCES tenant_memberships(tenant_id,account_id),FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id)
);
CREATE TABLE departure_events (
 id uuid PRIMARY KEY,execution_id uuid NOT NULL REFERENCES departure_executions(id),revision integer NOT NULL,
 action varchar(40) NOT NULL,state varchar(24) NOT NULL,actor_id uuid REFERENCES accounts(id),created_at timestamptz NOT NULL,
 UNIQUE(execution_id,revision)
);
CREATE TABLE departure_materials (
 execution_id uuid NOT NULL REFERENCES departure_executions(id),object_kind varchar(16) NOT NULL CHECK(object_kind IN('MATERIAL','FOLDER')),
 object_id uuid NOT NULL,workspace_id uuid NOT NULL,prior_state varchar(16) NOT NULL,prior_purge_after timestamptz,
 applied_revision integer,cleanup_job_id uuid,state varchar(16) NOT NULL CHECK(state IN('DISCOVERED','ISOLATED','QUEUED','PURGED','RESTORED','SKIPPED')),
 PRIMARY KEY(execution_id,object_kind,object_id)
);
CREATE INDEX departure_material_pending ON departure_materials(execution_id,state,object_kind,object_id);
CREATE TABLE departure_handovers (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),workspace_id uuid NOT NULL,object_kind varchar(24) NOT NULL CHECK(object_kind IN('WORKSPACE_OWNER','SOURCE_CONTACT')),
 object_id uuid NOT NULL,from_account_id uuid NOT NULL REFERENCES accounts(id),to_account_id uuid NOT NULL REFERENCES accounts(id),
 actor_id uuid NOT NULL REFERENCES accounts(id),resulting_revision bigint NOT NULL,created_at timestamptz NOT NULL,
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id)
);
-- Frozen metadata inventory is distinct from temporary zip chunks and from source business content.
CREATE TABLE departure_export_sets (
 id uuid PRIMARY KEY,execution_id uuid NOT NULL,tenant_id uuid NOT NULL,owner_id uuid NOT NULL REFERENCES accounts(id),workspace_id uuid NOT NULL,
 include_history boolean NOT NULL,state varchar(16) NOT NULL DEFAULT 'READY' CHECK(state IN('READY','EXPIRED','REVOKED')),
 item_count bigint NOT NULL,created_at timestamptz NOT NULL,revision integer NOT NULL DEFAULT 1,
 FOREIGN KEY(tenant_id,execution_id) REFERENCES departure_executions(tenant_id,id),FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id)
);
CREATE INDEX departure_export_owner ON departure_export_sets(tenant_id,owner_id,created_at DESC,id);
CREATE TABLE departure_export_parts (
 id uuid PRIMARY KEY,set_id uuid NOT NULL REFERENCES departure_export_sets(id),number integer NOT NULL,
 state varchar(16) NOT NULL CHECK(state IN('QUEUED','GENERATING','READY','PARTIAL','FAILED','EXPIRED','REVOKED','REMOVED')),
 revision integer NOT NULL DEFAULT 1,request_count integer NOT NULL CHECK(request_count BETWEEN 1 AND 50),
 lease_token uuid,lease_until timestamptz,generation uuid,created_at timestamptz NOT NULL,generated_at timestamptz,expires_at timestamptz,
 bytes bigint NOT NULL DEFAULT 0,sha256 varchar(64),error_code varchar(80),cleanup_state varchar(16) NOT NULL DEFAULT 'NONE' CHECK(cleanup_state IN('NONE','PENDING','FAILED','COMPLETE')),
 cleanup_attempts integer NOT NULL DEFAULT 0,cleaned_at timestamptz,removed_bytes bigint NOT NULL DEFAULT 0,
 UNIQUE(set_id,number)
);
CREATE TABLE departure_export_items (
 set_id uuid NOT NULL REFERENCES departure_export_sets(id),ordinal bigint NOT NULL,kind varchar(24) NOT NULL CHECK(kind IN('MATERIAL_VERSION','EXPERIENCE_VERSION')),
 object_id uuid NOT NULL,version_id uuid NOT NULL,version integer NOT NULL,size_bytes bigint NOT NULL,
 part_id uuid REFERENCES departure_export_parts(id),state varchar(16) NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','INCLUDED','FAILED')),
 filename varchar(250),sha256 varchar(64),error_code varchar(80),PRIMARY KEY(set_id,ordinal),UNIQUE(set_id,kind,version_id)
);
CREATE INDEX departure_export_unassigned ON departure_export_items(set_id,ordinal) WHERE part_id IS NULL;
CREATE INDEX departure_export_part_items ON departure_export_items(part_id,ordinal);
CREATE TABLE departure_archive_chunks (
 part_id uuid NOT NULL REFERENCES departure_export_parts(id),generation uuid NOT NULL,ordinal integer NOT NULL CHECK(ordinal>=0),content bytea NOT NULL,
 PRIMARY KEY(part_id,ordinal),CHECK(octet_length(content) BETWEEN 1 AND 65536)
);
-- Last line of defense: ordinary reactivation cannot bypass effective departure facts.
CREATE FUNCTION guard_departure_member_activation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='ACTIVE' AND EXISTS(SELECT 1 FROM departure_executions e WHERE e.tenant_id=NEW.tenant_id AND e.state<>'CANCELLED' AND (e.kind='TENANT_EXIT' OR e.target_account_id=NEW.account_id)) THEN
  RAISE EXCEPTION 'DEPARTURE_REACTIVATION_BLOCKED' USING ERRCODE='23514';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER departure_member_activation BEFORE INSERT OR UPDATE OF status ON tenant_memberships FOR EACH ROW EXECUTE FUNCTION guard_departure_member_activation();
CREATE FUNCTION guard_departure_tenant_activation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='ACTIVE' AND OLD.status<>'ACTIVE' AND EXISTS(SELECT 1 FROM departure_executions e WHERE e.tenant_id=NEW.id AND e.kind='TENANT_EXIT' AND e.state<>'CANCELLED') THEN
  RAISE EXCEPTION 'DEPARTURE_REACTIVATION_BLOCKED' USING ERRCODE='23514';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER departure_tenant_activation BEFORE UPDATE OF status ON tenants FOR EACH ROW EXECUTE FUNCTION guard_departure_tenant_activation();
CREATE FUNCTION scrub_departure_object(object_kind text,target uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p uuid;removed bigint;
BEGIN
 FOR p IN SELECT DISTINCT i.part_id FROM departure_export_items i WHERE i.part_id IS NOT NULL AND i.kind=object_kind AND i.object_id=target LOOP
  PERFORM id FROM departure_export_parts WHERE id=p FOR UPDATE;
  SELECT coalesce(sum(octet_length(content)),0) INTO removed FROM departure_archive_chunks WHERE part_id=p;
  DELETE FROM departure_archive_chunks WHERE part_id=p;
  UPDATE departure_export_items SET filename=NULL,sha256=NULL,error_code='DEPARTURE_EXPORT_SOURCE_REMOVED' WHERE part_id=p;
  UPDATE departure_export_parts SET state='REVOKED',revision=revision+1,lease_token=NULL,lease_until=NULL,cleanup_state='COMPLETE',cleaned_at=now(),removed_bytes=removed_bytes+removed,error_code='DEPARTURE_EXPORT_SOURCE_REMOVED' WHERE id=p;
 END LOOP;
END $$;
CREATE FUNCTION scrub_departure_material(target uuid) RETURNS void LANGUAGE sql AS $$ SELECT scrub_departure_object('MATERIAL_VERSION',target) $$;
CREATE FUNCTION scrub_departure_experience(target uuid) RETURNS void LANGUAGE sql AS $$ SELECT scrub_departure_object('EXPERIENCE_VERSION',target) $$;

-- Additional restriction only; callers MUST preserve original tenant/workspace/content authorization.
-- Used before pagination/counting so revoked scopes never leak via totals or hasMore.
CREATE FUNCTION departure_content_readable(actor uuid,tenant uuid,workspace uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM departure_executions WHERE tenant_id=tenant AND kind='MEMBER_OFFBOARD' AND target_account_id=actor AND state<>'CANCELLED')
 AND (NOT EXISTS(SELECT 1 FROM departure_executions WHERE tenant_id=tenant AND kind='TENANT_EXIT' AND state<>'CANCELLED')
 OR EXISTS(SELECT 1 FROM departure_executions e JOIN departure_export_grants d ON d.execution_id=e.id
  JOIN tenant_memberships m ON m.tenant_id=e.tenant_id AND m.account_id=d.account_id
  JOIN accounts a ON a.id=d.account_id JOIN tenants t ON t.id=e.tenant_id
  JOIN workspaces w ON w.tenant_id=e.tenant_id AND w.id=d.workspace_id
  JOIN workspace_members g ON g.tenant_id=e.tenant_id AND g.workspace_id=w.id AND g.account_id=d.account_id
  WHERE e.tenant_id=tenant AND e.kind='TENANT_EXIT' AND e.state='EXPORT_WINDOW' AND e.deadline>clock_timestamp()
   AND d.account_id=actor AND d.workspace_id=workspace AND m.status='ACTIVE' AND a.status='ACTIVE' AND t.status='ACTIVE' AND w.kind='SHARED'
   AND EXISTS(SELECT 1 FROM governance_capabilities c WHERE c.tenant_id=e.tenant_id AND c.account_id=d.account_id AND c.capability='BULK_EXPORT' AND (c.workspace_id IS NULL OR c.workspace_id=w.id))))
$$;
CREATE FUNCTION scrub_departure_experience_version(target uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE entry_id uuid;
BEGIN
 FOR entry_id IN SELECT DISTINCT object_id FROM departure_export_items WHERE kind='EXPERIENCE_VERSION' AND version_id=target LOOP
  PERFORM scrub_departure_experience(entry_id);
 END LOOP;
END $$;
-- Explicit version-key hooks for integration; above helpers accept parent material/entry ids.
CREATE FUNCTION scrub_departure_material_version(target uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE material_id uuid;
BEGIN
 FOR material_id IN SELECT DISTINCT object_id FROM departure_export_items WHERE kind='MATERIAL_VERSION' AND version_id=target LOOP
  PERFORM scrub_departure_material(material_id);
 END LOOP;
END $$;
CREATE FUNCTION departure_experience_scrubbed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM scrub_departure_experience_version(NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER departure_experience_scrub AFTER UPDATE OF scrubbed ON experience_versions
 FOR EACH ROW WHEN(NEW.scrubbed AND NOT OLD.scrubbed) EXECUTE FUNCTION departure_experience_scrubbed();
