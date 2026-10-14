ALTER TABLE scene_asset_links ADD COLUMN active boolean NOT NULL DEFAULT true;
CREATE TABLE scene_asset_revisions (
 tenant_id uuid NOT NULL REFERENCES scene_bindings(tenant_id),target_id uuid NOT NULL,
 kind varchar(16) NOT NULL,revision text NOT NULL,metadata jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,target_id,kind,revision)
);
INSERT INTO scene_asset_revisions(tenant_id,target_id,kind,revision,metadata) SELECT tenant_id,target_id,kind,revision,metadata FROM scene_asset_links;
ALTER TABLE scene_bindings ADD COLUMN source_revision text;
