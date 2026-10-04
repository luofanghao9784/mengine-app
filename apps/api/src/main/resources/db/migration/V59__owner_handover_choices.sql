-- Pending legacy requests retain the former administrator role by default.
ALTER TABLE governance_handovers ADD COLUMN previous_owner_role varchar(16) NOT NULL DEFAULT 'TENANT_ADMIN'
 CHECK(previous_owner_role IN ('TENANT_ADMIN','MEMBER'));
ALTER TABLE governance_handovers DROP CONSTRAINT governance_handovers_status_check;
ALTER TABLE governance_handovers ADD CONSTRAINT governance_handovers_status_check
 CHECK(status IN ('PENDING','ACCEPTED','CANCELLED','REJECTED'));
ALTER TABLE governance_handovers ADD COLUMN closed_at timestamptz;
ALTER TABLE governance_handovers ADD COLUMN closed_by uuid REFERENCES accounts(id);
