-- Only new closed-attempt notifications are enrolled. Durable business results, metering,
-- authorization/deletion evidence and idempotency keys are independent and remain intact.
CREATE TABLE operation_retention_windows (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),task_id uuid NOT NULL REFERENCES conversation_tasks(id),
 through_event bigint NOT NULL UNIQUE,closed_revision integer NOT NULL,
 original_anchor timestamptz NOT NULL,due_at timestamptz NOT NULL,policy_revision integer NOT NULL,
 state varchar(12) NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','FAILED','COMPLETE')),
 attempts integer NOT NULL DEFAULT 0,error_code varchar(60),completed_at timestamptz,
 removed_events bigint NOT NULL DEFAULT 0,removed_audit bigint NOT NULL DEFAULT 0
);
CREATE INDEX operation_retention_due ON operation_retention_windows(due_at,id) WHERE state<>'COMPLETE';
CREATE FUNCTION register_closed_operation_retention() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE policy_days integer;policy_rev integer;
BEGIN
 IF NEW.kind NOT IN ('SUCCEEDED','FAILED','CANCELLED','INTERRUPTED') THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM conversation_tasks t WHERE t.id=NEW.task_id AND t.status=NEW.kind AND t.finished_at IS NOT NULL AND NOT t.reconciliation_required) THEN RETURN NEW; END IF;
 SELECT p.days,p.revision INTO policy_days,policy_rev FROM retention_policy_versions p
 WHERE p.tenant_id=NEW.tenant_id AND p.policy_key='MINIMAL_OPERATION' AND p.effective_at<=NEW.created_at ORDER BY p.revision DESC LIMIT 1;
 INSERT INTO operation_retention_windows(tenant_id,task_id,through_event,closed_revision,original_anchor,due_at,policy_revision)
 VALUES(NEW.tenant_id,NEW.task_id,NEW.seq,NEW.revision,NEW.created_at,
 NEW.created_at+make_interval(days=>coalesce(policy_days,180)),coalesce(policy_rev,0));
 RETURN NEW;
END $$;
CREATE TRIGGER closed_operation_retention AFTER INSERT ON conversation_events FOR EACH ROW EXECUTE FUNCTION register_closed_operation_retention();
