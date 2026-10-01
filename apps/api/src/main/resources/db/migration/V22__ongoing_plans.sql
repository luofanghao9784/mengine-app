-- Personal delegations. Management roles do not confer plan ownership or execution authority.
CREATE TABLE ongoing_plans (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL, owner_id uuid NOT NULL,
 revision integer NOT NULL DEFAULT 1, execution_epoch bigint NOT NULL DEFAULT 0,
 status varchar(32) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','PAUSED','STOPPED','EXPIRED','AUTHORIZATION_REQUIRED')),
 runtime_state varchar(32) NOT NULL DEFAULT 'IDLE', reason varchar(64),
 goal varchar(160) NOT NULL, purpose varchar(1000) NOT NULL, query text NOT NULL,
 behavior varchar(20) NOT NULL CHECK(behavior IN ('SOURCE_LOOKUP','ANALYZE')),
 material_events boolean NOT NULL, daily_time varchar(5), time_zone varchar(80) NOT NULL,
 min_interval_seconds integer NOT NULL CHECK(min_interval_seconds BETWEEN 60 AND 86400),
 max_runs_per_day integer NOT NULL CHECK(max_runs_per_day BETWEEN 1 AND 24),
 max_total_runs integer NOT NULL CHECK(max_total_runs BETWEEN 1 AND 10000),
 expires_at timestamptz NOT NULL, notify boolean NOT NULL DEFAULT true,
 next_due timestamptz, observed_event bigint NOT NULL DEFAULT 0, last_source_key varchar(64),
 last_dispatch_at timestamptz, checked_at timestamptz, retry_requested boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id),
 FOREIGN KEY(tenant_id,owner_id) REFERENCES tenant_memberships(tenant_id,account_id),
 UNIQUE(tenant_id,id), CHECK(material_events OR daily_time IS NOT NULL)
);
CREATE INDEX ongoing_plan_scan ON ongoing_plans(checked_at) WHERE status IN ('ACTIVE','AUTHORIZATION_REQUIRED');
CREATE INDEX ongoing_plan_owner ON ongoing_plans(tenant_id,owner_id,created_at DESC);
CREATE TABLE ongoing_plan_versions (
 plan_id uuid NOT NULL REFERENCES ongoing_plans(id), revision integer NOT NULL, configuration jsonb NOT NULL,
 changed_by uuid NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(plan_id,revision)
);
CREATE TABLE ongoing_plan_runs (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, plan_id uuid NOT NULL, owner_id uuid NOT NULL REFERENCES accounts(id),
 plan_revision integer NOT NULL, execution_epoch bigint NOT NULL,
 trigger_key varchar(180) NOT NULL, trigger_kind varchar(24) NOT NULL, scheduled_for timestamptz,
 missed_slots integer NOT NULL DEFAULT 0, event_through bigint NOT NULL, source_key varchar(64) NOT NULL,
 source_versions jsonb NOT NULL, conversation_id uuid NOT NULL, task_id uuid NOT NULL UNIQUE,
 status varchar(32) NOT NULL DEFAULT 'QUEUED', error_code varchar(64),
 created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 FOREIGN KEY(tenant_id,plan_id) REFERENCES ongoing_plans(tenant_id,id),
 FOREIGN KEY(plan_id,plan_revision) REFERENCES ongoing_plan_versions(plan_id,revision),
 FOREIGN KEY(task_id) REFERENCES conversation_tasks(id),
 UNIQUE(plan_id,trigger_key)
);
CREATE INDEX ongoing_plan_run_history ON ongoing_plan_runs(plan_id,created_at DESC);
CREATE INDEX ongoing_plan_run_budget ON ongoing_plan_runs(owner_id,created_at);
CREATE TABLE ongoing_plan_receipts (
 actor_id uuid NOT NULL, request_id uuid NOT NULL, receipt jsonb NOT NULL,
 PRIMARY KEY(actor_id,request_id), FOREIGN KEY(actor_id,request_id) REFERENCES identity_requests(actor_id,request_id)
);
-- Committed material-version facts survive worker restarts; repeated deliveries share one version identity.
CREATE TABLE ongoing_plan_material_events (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
 material_id uuid NOT NULL, version_id uuid NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,workspace_id,material_id,version_id) REFERENCES material_versions(tenant_id,workspace_id,material_id,id)
);
CREATE INDEX ongoing_plan_material_event_scope ON ongoing_plan_material_events(tenant_id,workspace_id,sequence);
INSERT INTO ongoing_plan_material_events(tenant_id,workspace_id,material_id,version_id)
 SELECT tenant_id,workspace_id,material_id,id FROM material_versions ORDER BY created_at,id;
CREATE FUNCTION record_plan_material_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO ongoing_plan_material_events(tenant_id,workspace_id,material_id,version_id)
 VALUES(NEW.tenant_id,NEW.workspace_id,NEW.material_id,NEW.id) ON CONFLICT(version_id) DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER plan_material_version_insert AFTER INSERT ON material_versions FOR EACH ROW EXECUTE FUNCTION record_plan_material_event();
-- A brief revoke followed by regrant must not revive an old delegation. These triggers only fence plans;
-- they never grant access, read business content, touch task locks, or restart work.
CREATE FUNCTION fence_plan_authority() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='workspace_members' THEN
  UPDATE ongoing_plans SET status='AUTHORIZATION_REQUIRED',runtime_state='NEEDS_ATTENTION',reason='AUTHORIZATION_REVOKED',execution_epoch=execution_epoch+1,revision=revision+1,updated_at=now() WHERE tenant_id=OLD.tenant_id AND workspace_id=OLD.workspace_id AND owner_id=OLD.account_id AND status IN ('ACTIVE','PAUSED');
  RETURN NULL;
 END IF;
 IF TG_TABLE_NAME='accounts' AND NEW.status<>OLD.status AND NEW.status<>'ACTIVE' THEN
  UPDATE ongoing_plans SET status='AUTHORIZATION_REQUIRED',runtime_state='NEEDS_ATTENTION',reason='AUTHORIZATION_REVOKED',execution_epoch=execution_epoch+1,revision=revision+1,updated_at=now() WHERE owner_id=NEW.id AND status IN ('ACTIVE','PAUSED');
 ELSIF TG_TABLE_NAME='tenants' AND NEW.status<>OLD.status AND NEW.status<>'ACTIVE' THEN
  UPDATE ongoing_plans SET status='AUTHORIZATION_REQUIRED',runtime_state='NEEDS_ATTENTION',reason='AUTHORIZATION_REVOKED',execution_epoch=execution_epoch+1,revision=revision+1,updated_at=now() WHERE tenant_id=NEW.id AND status IN ('ACTIVE','PAUSED');
 ELSIF TG_TABLE_NAME='tenant_memberships' AND NEW.status<>OLD.status AND NEW.status<>'ACTIVE' THEN
  UPDATE ongoing_plans SET status='AUTHORIZATION_REQUIRED',runtime_state='NEEDS_ATTENTION',reason='AUTHORIZATION_REVOKED',execution_epoch=execution_epoch+1,revision=revision+1,updated_at=now() WHERE tenant_id=NEW.tenant_id AND owner_id=NEW.account_id AND status IN ('ACTIVE','PAUSED');
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER plan_account_disabled AFTER UPDATE OF status ON accounts FOR EACH ROW EXECUTE FUNCTION fence_plan_authority();
CREATE TRIGGER plan_tenant_disabled AFTER UPDATE OF status ON tenants FOR EACH ROW EXECUTE FUNCTION fence_plan_authority();
CREATE TRIGGER plan_member_disabled AFTER UPDATE OF status ON tenant_memberships FOR EACH ROW EXECUTE FUNCTION fence_plan_authority();
CREATE TRIGGER plan_space_revoked AFTER DELETE ON workspace_members FOR EACH ROW EXECUTE FUNCTION fence_plan_authority();
