-- Existing enterprises keep their state and owner history. New interactive openings start pending.
ALTER TABLE tenants DROP CONSTRAINT tenants_status_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_status_check CHECK(status IN ('ACTIVE','SUSPENDED','PENDING'));

CREATE FUNCTION require_pending_opening_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='PENDING' AND NEW.status<>'PENDING' AND NOT EXISTS
 (SELECT 1 FROM tenant_governance g JOIN tenant_memberships m ON m.tenant_id=g.tenant_id AND m.account_id=g.owner_id
  WHERE g.tenant_id=NEW.id AND m.status='ACTIVE' AND m.role='TENANT_ADMIN') THEN
  RAISE EXCEPTION 'Initial owner must be activated with the enterprise';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER pending_opening_owner AFTER UPDATE ON tenants
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD.status='PENDING' AND NEW.status<>'PENDING') EXECUTE FUNCTION require_pending_opening_owner();
