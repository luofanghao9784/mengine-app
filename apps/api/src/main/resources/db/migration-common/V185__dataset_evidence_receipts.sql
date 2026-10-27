-- Deterministic evidence only. Authorization is deliberately not cached.
CREATE TABLE dataset_evidence_receipts (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 dataset_id uuid NOT NULL REFERENCES business_datasets(id) ON DELETE CASCADE,
 snapshot_id uuid NOT NULL REFERENCES dataset_snapshots(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('CHECKS','PREFLIGHT','INSIGHT_FACTS')),
 input_hash text NOT NULL,
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,dataset_id,snapshot_id,kind,input_hash)
);
CREATE FUNCTION scrub_dataset_evidence_receipts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.scrubbed THEN DELETE FROM dataset_evidence_receipts WHERE snapshot_id=NEW.id; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dataset_evidence_scrub AFTER UPDATE OF scrubbed ON dataset_snapshots
 FOR EACH ROW EXECUTE FUNCTION scrub_dataset_evidence_receipts();
