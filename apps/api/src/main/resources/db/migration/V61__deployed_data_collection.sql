-- Deployment owns routes, approved datasets and external access. Customer UI only controls schedules.
CREATE TABLE data_connections (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), name varchar(160) NOT NULL,
 route_label varchar(500) NOT NULL, access_summary varchar(1000) NOT NULL,
 status varchar(20) NOT NULL CHECK(status IN ('READY','UNAVAILABLE','UNCONFIGURED')),
 auto_enabled boolean NOT NULL DEFAULT false,
 frequency varchar(20) CHECK(frequency IN ('QUARTER_HOUR','HOURLY','DAILY')),
 daily_time varchar(5), time_zone varchar(80) NOT NULL,
 next_due timestamptz, revision bigint NOT NULL DEFAULT 0, execution_epoch bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), CHECK(NOT auto_enabled OR frequency IS NOT NULL),
 CHECK((frequency='DAILY' AND daily_time IS NOT NULL) OR (frequency IS DISTINCT FROM 'DAILY' AND daily_time IS NULL))
);
CREATE TABLE collection_runs (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, connection_id uuid NOT NULL, execution_epoch bigint NOT NULL,
 trigger_kind varchar(16) NOT NULL CHECK(trigger_kind IN ('MANUAL','SCHEDULED')),
 requested_by uuid REFERENCES accounts(id), status varchar(16) NOT NULL CHECK(status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','INTERRUPTED')),
 reason varchar(80), lease_token uuid, lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
 FOREIGN KEY(tenant_id,connection_id) REFERENCES data_connections(tenant_id,id), UNIQUE(tenant_id,connection_id,id),
 CHECK((trigger_kind='MANUAL' AND requested_by IS NOT NULL) OR (trigger_kind='SCHEDULED' AND requested_by IS NULL))
);
CREATE UNIQUE INDEX one_active_collection_run ON collection_runs(connection_id) WHERE status IN ('QUEUED','RUNNING');
CREATE INDEX collection_run_history ON collection_runs(connection_id,created_at DESC,id);
CREATE TABLE business_datasets (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, connection_id uuid NOT NULL, workspace_id uuid NOT NULL,
 dataset_key varchar(160) NOT NULL, name varchar(160) NOT NULL, description varchar(1000) NOT NULL DEFAULT '',
 column_names jsonb NOT NULL CHECK(jsonb_typeof(column_names)='array' AND jsonb_array_length(column_names) BETWEEN 1 AND 100),
 status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','WITHDRAWN')),
 current_snapshot uuid, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,connection_id) REFERENCES data_connections(tenant_id,id),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id),
 UNIQUE(tenant_id,connection_id,id)
);
CREATE UNIQUE INDEX active_deployed_dataset_key ON business_datasets(connection_id,dataset_key) WHERE status='ACTIVE';
CREATE TABLE dataset_snapshots (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, connection_id uuid NOT NULL, dataset_id uuid NOT NULL, run_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0), data_rows jsonb NOT NULL CHECK(jsonb_typeof(data_rows)='array'),
 row_count integer NOT NULL CHECK(row_count>=0), coverage_through timestamptz, collected_at timestamptz NOT NULL,
 FOREIGN KEY(tenant_id,connection_id,dataset_id) REFERENCES business_datasets(tenant_id,connection_id,id),
 FOREIGN KEY(tenant_id,connection_id,run_id) REFERENCES collection_runs(tenant_id,connection_id,id),
 UNIQUE(dataset_id,version), UNIQUE(dataset_id,run_id), UNIQUE(dataset_id,id)
);
ALTER TABLE business_datasets ADD FOREIGN KEY(id,current_snapshot) REFERENCES dataset_snapshots(dataset_id,id);

-- Scope/schema changes must deploy a new dataset identity: historical snapshots cannot gain a new audience.
CREATE FUNCTION guard_dataset_deployment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.tenant_id,NEW.connection_id,NEW.workspace_id,NEW.dataset_key,NEW.column_names)
   IS DISTINCT FROM (OLD.tenant_id,OLD.connection_id,OLD.workspace_id,OLD.dataset_key,OLD.column_names) THEN
   RAISE EXCEPTION 'dataset scope and schema are immutable; withdraw and deploy a new identity';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM workspaces WHERE tenant_id=NEW.tenant_id AND id=NEW.workspace_id AND kind='SHARED') THEN
   RAISE EXCEPTION 'deployed datasets require an explicit shared workspace';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dataset_deployment_guard BEFORE INSERT OR UPDATE ON business_datasets FOR EACH ROW EXECUTE FUNCTION guard_dataset_deployment();
CREATE FUNCTION fence_collection_deployment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE connection uuid;
BEGIN
 connection=CASE WHEN TG_OP='DELETE' THEN OLD.connection_id ELSE NEW.connection_id END;
 UPDATE data_connections SET execution_epoch=execution_epoch+1 WHERE id=connection;
 UPDATE collection_runs SET status='INTERRUPTED',reason='DEPLOYMENT_CHANGED',finished_at=now(),lease_token=NULL,lease_until=NULL
   WHERE connection_id=connection AND status IN ('QUEUED','RUNNING');
 RETURN NULL;
END $$;
CREATE TRIGGER dataset_deployment_fence AFTER INSERT OR DELETE OR UPDATE OF status ON business_datasets FOR EACH ROW EXECUTE FUNCTION fence_collection_deployment();
CREATE FUNCTION fence_collection_connection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.tenant_id,NEW.id) IS DISTINCT FROM (OLD.tenant_id,OLD.id) THEN RAISE EXCEPTION 'connection identity is immutable'; END IF;
 IF NEW.status IS DISTINCT FROM OLD.status THEN
   NEW.execution_epoch=OLD.execution_epoch+1;
   UPDATE collection_runs SET status='INTERRUPTED',reason='CONNECTION_UNAVAILABLE',finished_at=now(),lease_token=NULL,lease_until=NULL
     WHERE connection_id=OLD.id AND status IN ('QUEUED','RUNNING');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER connection_deployment_fence BEFORE UPDATE ON data_connections FOR EACH ROW EXECUTE FUNCTION fence_collection_connection();

CREATE FUNCTION fence_collection_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status='SUSPENDED' THEN
  UPDATE data_connections SET execution_epoch=execution_epoch+1 WHERE tenant_id=NEW.id;
  UPDATE collection_runs SET status='INTERRUPTED',reason='TENANT_SERVICE_SUSPENDED',finished_at=now(),lease_token=NULL,lease_until=NULL
    WHERE tenant_id=NEW.id AND status IN ('QUEUED','RUNNING');
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER collection_tenant_fence AFTER UPDATE OF status ON tenants FOR EACH ROW EXECUTE FUNCTION fence_collection_tenant();
CREATE FUNCTION fence_collection_requester() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='accounts' THEN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status<>'ACTIVE' THEN
   UPDATE collection_runs SET status='INTERRUPTED',reason='AUTHORIZATION_REVOKED',finished_at=now(),lease_token=NULL,lease_until=NULL
     WHERE requested_by=NEW.id AND status IN ('QUEUED','RUNNING');
  END IF;
 ELSE
  IF TG_OP='DELETE' OR NEW.status<>'ACTIVE' OR (NEW.role<>'TENANT_ADMIN' AND NOT EXISTS(SELECT 1 FROM tenant_governance WHERE tenant_id=OLD.tenant_id AND owner_id=OLD.account_id)) THEN
   UPDATE collection_runs SET status='INTERRUPTED',reason='AUTHORIZATION_REVOKED',finished_at=now(),lease_token=NULL,lease_until=NULL
     WHERE tenant_id=OLD.tenant_id AND requested_by=OLD.account_id AND status IN ('QUEUED','RUNNING');
  END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER collection_account_fence AFTER UPDATE OF status ON accounts FOR EACH ROW EXECUTE FUNCTION fence_collection_requester();
CREATE TRIGGER collection_member_fence AFTER DELETE OR UPDATE OF status,role ON tenant_memberships FOR EACH ROW EXECUTE FUNCTION fence_collection_requester();
CREATE FUNCTION fence_collection_departure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state<>'CANCELLED' AND (TG_OP='INSERT' OR OLD.state='CANCELLED') THEN
  IF NEW.kind='TENANT_EXIT' THEN
   UPDATE data_connections SET execution_epoch=execution_epoch+1 WHERE tenant_id=NEW.tenant_id;
   UPDATE collection_runs SET status='INTERRUPTED',reason='TENANT_EXITING',finished_at=now(),lease_token=NULL,lease_until=NULL
     WHERE tenant_id=NEW.tenant_id AND status IN ('QUEUED','RUNNING');
  ELSE
   UPDATE collection_runs SET status='INTERRUPTED',reason='AUTHORIZATION_REVOKED',finished_at=now(),lease_token=NULL,lease_until=NULL
     WHERE tenant_id=NEW.tenant_id AND requested_by=NEW.target_account_id AND status IN ('QUEUED','RUNNING');
  END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER collection_departure_fence AFTER INSERT OR UPDATE OF state ON departure_executions FOR EACH ROW EXECUTE FUNCTION fence_collection_departure();
