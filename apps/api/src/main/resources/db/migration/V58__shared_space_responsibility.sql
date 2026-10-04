-- Legacy owner_id is not evidence of an explicitly accepted management responsibility.
-- Preserve old content grants; only a new explicit assignment enables scoped management.
ALTER TABLE workspaces ADD COLUMN responsibility_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE workspaces ADD COLUMN description varchar(500) NOT NULL DEFAULT '';
ALTER TABLE workspaces ADD CONSTRAINT shared_responsibility CHECK(NOT responsibility_confirmed OR kind='SHARED');
CREATE TABLE workspace_owner_changes (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 workspace_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES accounts(id),
 previous_owner uuid REFERENCES accounts(id),
 next_owner uuid NOT NULL REFERENCES accounts(id),
 previous_access varchar(10) NOT NULL CHECK(previous_access IN('READ','MAINTAIN','REMOVE','NONE')),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id)
);
