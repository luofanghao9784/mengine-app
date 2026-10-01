CREATE TABLE publication_preferences (
 tenant_id uuid NOT NULL REFERENCES tenants(id),actor_id uuid NOT NULL REFERENCES accounts(id),material_id uuid NOT NULL REFERENCES materials(id),
 pinned boolean NOT NULL DEFAULT false,revision integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,actor_id,material_id)
);
