-- Publication is not a library permission and is never included in library_mask.
CREATE TABLE scene_publication_configs (
 tenant_id uuid PRIMARY KEY REFERENCES scene_bindings(tenant_id),
 revision integer NOT NULL DEFAULT 1,
 workspaces jsonb NOT NULL DEFAULT '[]',
 updated_at timestamptz NOT NULL DEFAULT now()
);
