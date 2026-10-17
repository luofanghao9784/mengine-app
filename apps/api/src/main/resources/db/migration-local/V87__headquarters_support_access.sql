-- A platform session grants one explicit tenant context, without creating a membership.
CREATE TABLE headquarters_support_access (
 id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES accounts(id),tenant_id uuid NOT NULL REFERENCES tenants(id),
 session_hash text NOT NULL,mode text NOT NULL CHECK(mode IN ('ADJUSTMENT','TEST')),
 created_at timestamptz NOT NULL DEFAULT now(),closed_at timestamptz
);
CREATE TABLE headquarters_support_events (
 id bigserial PRIMARY KEY,access_id uuid REFERENCES headquarters_support_access(id),
 actor_id uuid NOT NULL REFERENCES accounts(id),tenant_id uuid NOT NULL REFERENCES tenants(id),mode text NOT NULL,
 action text NOT NULL,outcome text NOT NULL,http_status integer,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE headquarters_support_changes (
 id bigserial PRIMARY KEY,access_id uuid NOT NULL REFERENCES headquarters_support_access(id),
 table_name text NOT NULL,object_id text NOT NULL,operation text NOT NULL,
 before_state jsonb,after_state jsonb,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX headquarters_support_objects ON headquarters_support_changes(table_name,object_id);
-- Permission projection is limited to the transaction's explicit support context.
-- The supplied principal is never changed in created_by/changed_by/audit columns.
CREATE FUNCTION headquarters_permission_actor(principal uuid,tenant uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT g.owner_id FROM headquarters_support_access s
 JOIN platform_sessions p ON p.token_hash=s.session_hash AND p.account_id=s.actor_id AND p.expires_at>now()
 JOIN platform_accounts pa ON pa.account_id=s.actor_id AND pa.credential_version=p.credential_version
 JOIN accounts a ON a.id=s.actor_id AND a.status='ACTIVE'
 JOIN tenant_governance g ON g.tenant_id=s.tenant_id
 JOIN tenant_memberships m ON m.tenant_id=s.tenant_id AND m.account_id=g.owner_id AND m.status='ACTIVE'
 JOIN accounts o ON o.id=g.owner_id AND o.status='ACTIVE'
 WHERE s.id=nullif(current_setting('dreamcore.support_access',true),'')::uuid
 AND s.actor_id=principal AND s.tenant_id=tenant AND s.closed_at IS NULL
 AND EXISTS(SELECT 1 FROM platform_roles r WHERE r.account_id=s.actor_id AND r.role='PLATFORM_ADMIN')),principal);
$$;
-- Only identifiers and management states enter this journal. Content, names, phone numbers,
-- prompts, model output, passwords, tokens and connection secrets are never copied.
CREATE FUNCTION headquarters_support_metadata(value jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(jsonb_object_agg(key,val),'{}'::jsonb) FROM jsonb_each(value) AS e(key,val)
 WHERE key IN ('id','tenant_id','workspace_id','account_id','owner_id','requested_by','created_by',
 'material_id','version_id','source_id','run_id','task_id','entry_id','status','state','role','revision',
 'management_version','enabled','can_maintain','number','kind','size_bytes','generation','days',
 'collection_enabled','responsibility_confirmed','purpose','execution_class');
$$;
CREATE FUNCTION headquarters_support_journal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE context_id uuid; before_row jsonb; after_row jsonb; row_data jsonb; scope_id uuid;
BEGIN
 context_id:=nullif(current_setting('dreamcore.support_access',true),'')::uuid;
 IF TG_OP<>'INSERT' THEN before_row:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN after_row:=to_jsonb(NEW); END IF;
 row_data:=coalesce(after_row,before_row);
 IF context_id IS NULL AND TG_OP='INSERT' THEN
  SELECT c.access_id INTO context_id FROM headquarters_support_changes c JOIN headquarters_support_access s ON s.id=c.access_id
  WHERE c.operation='INSERT' AND s.tenant_id=(row_data->>'tenant_id')::uuid AND c.object_id IN
  (SELECT value FROM jsonb_each_text(row_data) WHERE key IN ('source_id','source_version','run_id','task_id','entry_id','material_id','version_id','adjustment_id','general_suggestion_id'))
  ORDER BY c.id LIMIT 1;
 END IF;
 IF context_id IS NULL THEN RETURN coalesce(NEW,OLD); END IF;
 SELECT tenant_id INTO scope_id FROM headquarters_support_access WHERE id=context_id;
 IF scope_id IS NULL OR ((row_data->>'tenant_id')::uuid IS DISTINCT FROM scope_id AND NOT (TG_TABLE_NAME='identity_audit' AND row_data->>'tenant_id' IS NULL)) THEN
  RAISE EXCEPTION 'Support tenant scope mismatch';
 END IF;
 INSERT INTO headquarters_support_changes(access_id,table_name,object_id,operation,before_state,after_state)
 VALUES(context_id,TG_TABLE_NAME,coalesce(row_data->>'id',row_data->>'account_id',row_data->>'workspace_id',row_data->>'source_id',scope_id::text),TG_OP,
 headquarters_support_metadata(before_row),headquarters_support_metadata(after_row));
 RETURN coalesce(NEW,OLD);
END $$;
DO $$ DECLARE tab record; BEGIN
 FOR tab IN SELECT table_name FROM information_schema.columns WHERE table_schema=current_schema() AND column_name='tenant_id'
 AND table_name NOT LIKE 'headquarters_support_%' AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE')
 LOOP EXECUTE format('CREATE TRIGGER headquarters_support_journal AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION headquarters_support_journal()',tab.table_name); END LOOP;
END $$;

-- Support operators are not members. These columns denote actual request actors, not tenant ownership.
ALTER TABLE export_batches DROP CONSTRAINT export_batches_tenant_id_owner_id_fkey;
ALTER TABLE export_batches ADD CONSTRAINT export_batch_actual_actor FOREIGN KEY(owner_id) REFERENCES accounts(id);
ALTER TABLE experience_adjustments DROP CONSTRAINT experience_adjustments_tenant_id_actor_id_fkey;
ALTER TABLE experience_adjustments ADD CONSTRAINT experience_adjustment_actual_actor FOREIGN KEY(actor_id) REFERENCES accounts(id);
ALTER TABLE general_experience_suggestions DROP CONSTRAINT general_experience_suggestions_tenant_id_actor_id_fkey;
ALTER TABLE general_experience_suggestions ADD CONSTRAINT general_suggestion_actual_actor FOREIGN KEY(actor_id) REFERENCES accounts(id);

ALTER TABLE experience_intake_sources DROP CONSTRAINT experience_intake_sources_tenant_id_owner_id_fkey;
ALTER TABLE experience_intake_sources ADD CONSTRAINT experience_intake_actual_actor FOREIGN KEY(owner_id) REFERENCES accounts(id);
CREATE FUNCTION headquarters_source_permission_actor(principal uuid,tenant uuid,source uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT g.owner_id FROM headquarters_support_changes c
 JOIN headquarters_support_access s ON s.id=c.access_id AND s.actor_id=principal AND s.tenant_id=tenant AND s.closed_at IS NULL
 JOIN platform_sessions p ON p.token_hash=s.session_hash AND p.account_id=principal AND p.expires_at>now()
 JOIN platform_accounts pa ON pa.account_id=principal AND pa.credential_version=p.credential_version
 JOIN accounts a ON a.id=principal AND a.status='ACTIVE'
 JOIN tenant_governance g ON g.tenant_id=tenant
 JOIN tenant_memberships m ON m.tenant_id=tenant AND m.account_id=g.owner_id AND m.status='ACTIVE'
 JOIN accounts o ON o.id=g.owner_id AND o.status='ACTIVE'
 WHERE c.object_id=source::text AND EXISTS(SELECT 1 FROM platform_roles r WHERE r.account_id=principal AND r.role='PLATFORM_ADMIN')
 ORDER BY c.id LIMIT 1),principal);
$$;
-- Keep fixed source/actor identity predicates intact; adapt only authorization checks.
DO $$ DECLARE fn record; definition text; permission text; BEGIN
 FOR fn IN SELECT oid FROM pg_proc WHERE pronamespace=current_schema()::regnamespace AND proname IN ('experience_intake_available','experience_intake_available_before_general','experience_intake_available_before_adjustment') LOOP
  definition:=pg_get_functiondef(fn.oid);permission:='headquarters_source_permission_actor(i.owner_id,i.tenant_id,i.id)';
  definition:=replace(definition,'m.account_id=i.owner_id','m.account_id='||permission);
  definition:=replace(definition,'w.owner_id=i.owner_id','w.owner_id='||permission);
  definition:=replace(definition,'g.account_id=i.owner_id','g.account_id='||permission);
  definition:=replace(definition,'departure_content_readable(i.owner_id,','departure_content_readable('||permission||',');
  EXECUTE definition;
 END LOOP;
END $$;

CREATE FUNCTION headquarters_support_revoke() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE visit headquarters_support_access%ROWTYPE;
BEGIN
 FOR visit IN UPDATE headquarters_support_access SET closed_at=now() WHERE closed_at IS NULL AND
 ((TG_TABLE_NAME='platform_sessions' AND session_hash=to_jsonb(OLD)->>'token_hash') OR
 (TG_TABLE_NAME='platform_roles' AND actor_id=(to_jsonb(OLD)->>'account_id')::uuid) OR
 (TG_TABLE_NAME='accounts' AND actor_id=(to_jsonb(OLD)->>'id')::uuid AND to_jsonb(NEW)->>'status'<>'ACTIVE') OR
 (TG_TABLE_NAME='platform_accounts' AND actor_id=(to_jsonb(OLD)->>'account_id')::uuid)) RETURNING * LOOP
  INSERT INTO headquarters_support_events(access_id,actor_id,tenant_id,mode,action,outcome)
  VALUES(visit.id,visit.actor_id,visit.tenant_id,visit.mode,'INVALIDATED','DENIED');
 END LOOP;
 RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER headquarters_session_revoke AFTER DELETE ON platform_sessions FOR EACH ROW EXECUTE FUNCTION headquarters_support_revoke();
CREATE TRIGGER headquarters_role_revoke AFTER DELETE ON platform_roles FOR EACH ROW EXECUTE FUNCTION headquarters_support_revoke();
CREATE TRIGGER headquarters_account_revoke AFTER UPDATE OF status ON accounts FOR EACH ROW WHEN(OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION headquarters_support_revoke();
CREATE TRIGGER headquarters_credentials_revoke AFTER UPDATE OF credential_version ON platform_accounts FOR EACH ROW WHEN(OLD.credential_version IS DISTINCT FROM NEW.credential_version) EXECUTE FUNCTION headquarters_support_revoke();
