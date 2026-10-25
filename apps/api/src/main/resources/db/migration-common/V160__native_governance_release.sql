-- Separate immutable interpretation artifacts; raw collection identities and schedules never change.
CREATE TABLE native_governance_releases (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 recipient_id uuid NOT NULL REFERENCES accounts(id),
 fingerprint text NOT NULL,
 package jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX native_governance_tenant ON native_governance_releases(tenant_id,created_at DESC);
