-- Operator-only external generation is distinct from metered runtime model execution.
ALTER TABLE conversation_attempts DROP CONSTRAINT conversation_attempts_provenance_check;
ALTER TABLE conversation_attempts ADD CONSTRAINT conversation_attempts_provenance_check
 CHECK (provenance IN ('RECORDED','LEGACY_CURRENT_ONLY','EXTERNAL_DEPLOYMENT'));
CREATE TABLE briefing_bootstrap_receipts (
 tenant_id uuid NOT NULL REFERENCES tenants(id), request_id uuid NOT NULL, owner_id uuid NOT NULL REFERENCES accounts(id),
 payload_sha256 varchar(64) NOT NULL, receipt jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,request_id)
);
