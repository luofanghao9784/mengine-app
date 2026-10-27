CREATE TABLE native_enterprise_skills (
 tenant_id uuid NOT NULL REFERENCES tenants(id), name text NOT NULL,
 description text NOT NULL, content text NOT NULL, markdown text NOT NULL,
 published boolean NOT NULL DEFAULT false, audience uuid[] NOT NULL DEFAULT '{}',
 revision bigint NOT NULL DEFAULT 1, reviewed_by uuid NOT NULL REFERENCES accounts(id),
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,name)
);
