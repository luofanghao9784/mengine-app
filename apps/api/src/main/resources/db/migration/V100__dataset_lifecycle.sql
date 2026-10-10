ALTER TABLE business_datasets ADD COLUMN lifecycle_revision bigint NOT NULL DEFAULT 0 CHECK(lifecycle_revision>=0);
-- Deployment cannot silently reactivate an explicitly withdrawn or erased identity.
CREATE FUNCTION guard_withdrawn_dataset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='WITHDRAWN' AND OLD.lifecycle_revision>0 AND NEW.status='ACTIVE' THEN
  RAISE EXCEPTION 'withdrawn dataset requires a new deployment identity';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER withdrawn_dataset_guard BEFORE UPDATE OF status ON business_datasets FOR EACH ROW EXECUTE FUNCTION guard_withdrawn_dataset();
