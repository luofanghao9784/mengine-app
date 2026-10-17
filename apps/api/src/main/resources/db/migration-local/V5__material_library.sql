-- Existing access grants remain read-only. Maintenance is an explicit, separate permission.
ALTER TABLE workspace_members ADD COLUMN can_maintain boolean NOT NULL DEFAULT false;
CREATE TABLE material_folders (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    parent_id uuid,
    name varchar(180) NOT NULL,
    created_by uuid NOT NULL REFERENCES accounts(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id,workspace_id,id),
    FOREIGN KEY (tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id),
    FOREIGN KEY (tenant_id,workspace_id,parent_id) REFERENCES material_folders(tenant_id,workspace_id,id),
    CHECK (parent_id IS DISTINCT FROM id)
);
CREATE UNIQUE INDEX material_folder_names ON material_folders(tenant_id,workspace_id,parent_id,name) NULLS NOT DISTINCT;
CREATE TABLE materials (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    folder_id uuid,
    name varchar(180) NOT NULL,
    current_version integer NOT NULL DEFAULT 1 CHECK (current_version>0),
    created_by uuid NOT NULL REFERENCES accounts(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id,workspace_id,id),
    FOREIGN KEY (tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id),
    FOREIGN KEY (tenant_id,workspace_id,folder_id) REFERENCES material_folders(tenant_id,workspace_id,id)
);
CREATE TABLE material_versions (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    material_id uuid NOT NULL,
    number integer NOT NULL CHECK (number>0),
    filename varchar(180) NOT NULL,
    size_bytes bigint NOT NULL CHECK (size_bytes>=0),
    sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    object_id uuid NOT NULL UNIQUE,
    created_by uuid NOT NULL REFERENCES accounts(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id,workspace_id,material_id,number),
    FOREIGN KEY (tenant_id,workspace_id,material_id) REFERENCES materials(tenant_id,workspace_id,id)
);
ALTER TABLE materials ADD CONSTRAINT material_current_version FOREIGN KEY (tenant_id,workspace_id,id,current_version)
    REFERENCES material_versions(tenant_id,workspace_id,material_id,number) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX material_listing ON materials(tenant_id,workspace_id,folder_id,updated_at DESC,id);
CREATE INDEX material_version_history ON material_versions(tenant_id,workspace_id,material_id,number DESC);
