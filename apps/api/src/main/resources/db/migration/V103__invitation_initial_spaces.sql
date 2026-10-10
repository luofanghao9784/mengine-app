CREATE TABLE invitation_space_plans (
 invitation_id uuid PRIMARY KEY REFERENCES invitations(id),
 fingerprint char(64) NOT NULL
);
CREATE TABLE invitation_initial_spaces (
 invitation_id uuid NOT NULL REFERENCES invitation_space_plans(invitation_id),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 workspace_id uuid NOT NULL,
 PRIMARY KEY(invitation_id,workspace_id)
);
