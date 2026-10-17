ALTER TABLE tenants ADD COLUMN management_version bigint NOT NULL DEFAULT 0 CHECK (management_version >= 0);
ALTER TABLE invitations ADD CONSTRAINT invitations_tenant_id_unique UNIQUE (tenant_id, id);
CREATE TABLE tenant_initial_admin (
    tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
    invitation_id uuid NOT NULL UNIQUE,
    FOREIGN KEY (tenant_id, invitation_id) REFERENCES invitations(tenant_id, id)
);
INSERT INTO tenant_initial_admin(tenant_id, invitation_id)
SELECT DISTINCT ON (tenant_id) tenant_id, id FROM invitations
WHERE role='TENANT_ADMIN' ORDER BY tenant_id, created_at, id;
