-- Service state is separate from identity revocation and formal tenant exit.
ALTER TABLE tenants ADD COLUMN service_public_reason varchar(1000);
ALTER TABLE tenants ADD COLUMN service_changed_at timestamptz;
ALTER TABLE tenants ADD COLUMN service_resumed_at timestamptz;
CREATE TABLE tenant_service_changes (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), actor_id uuid NOT NULL REFERENCES platform_accounts(account_id),
 status varchar(16) NOT NULL CHECK(status IN ('ACTIVE','SUSPENDED')),
 internal_reason varchar(1000) NOT NULL, public_reason varchar(1000) NOT NULL,
 version bigint NOT NULL, changed_at timestamptz NOT NULL, UNIQUE(tenant_id,version)
);
ALTER TABLE briefing_generation_policies ADD COLUMN service_resume_pending boolean NOT NULL DEFAULT false;

-- A temporary service suspension fences execution, not the member's delegation.
-- Account/member/space revocation retains the original authority fence.
DROP TRIGGER plan_tenant_disabled ON tenants;
CREATE FUNCTION fence_plan_tenant_service() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status='SUSPENDED' THEN
  UPDATE ongoing_plans SET execution_epoch=execution_epoch+1,
    runtime_state=CASE WHEN status='ACTIVE' THEN 'WAITING_TIME' ELSE runtime_state END,
    reason=CASE WHEN status='ACTIVE' THEN 'TENANT_SERVICE_SUSPENDED' ELSE reason END,
    updated_at=now()
  WHERE tenant_id=NEW.id AND status IN ('ACTIVE','PAUSED');
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER plan_tenant_disabled AFTER UPDATE OF status ON tenants FOR EACH ROW EXECUTE FUNCTION fence_plan_tenant_service();
