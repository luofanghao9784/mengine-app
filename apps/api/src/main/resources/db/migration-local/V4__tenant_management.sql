ALTER TABLE tenant_memberships ADD COLUMN management_version bigint NOT NULL DEFAULT 0 CHECK (management_version >= 0);
ALTER TABLE workspaces ADD COLUMN management_version bigint NOT NULL DEFAULT 0 CHECK (management_version >= 0);
ALTER TABLE tenants ADD COLUMN settings_version bigint NOT NULL DEFAULT 0 CHECK (settings_version >= 0);
-- Preserve access previously granted through shared-space ownership; new spaces require explicit grants.
INSERT INTO workspace_members(tenant_id,workspace_id,account_id)
SELECT tenant_id,id,owner_id FROM workspaces WHERE kind='SHARED' ON CONFLICT DO NOTHING;
ALTER TABLE identity_audit ADD COLUMN related_account_id uuid REFERENCES accounts(id);
CREATE INDEX identity_audit_tenant_recent ON identity_audit(tenant_id,created_at DESC,id DESC);
