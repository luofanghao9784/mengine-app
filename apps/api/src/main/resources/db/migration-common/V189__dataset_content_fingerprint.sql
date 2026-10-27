-- Reuse existing version-bound evidence and scrub cleanup; never persist authorization.
ALTER TABLE dataset_evidence_receipts DROP CONSTRAINT dataset_evidence_receipts_kind_check;
ALTER TABLE dataset_evidence_receipts ADD CONSTRAINT dataset_evidence_receipts_kind_check
 CHECK (kind IN ('CHECKS','PREFLIGHT','INSIGHT_FACTS','CONTENT_FINGERPRINT'));
