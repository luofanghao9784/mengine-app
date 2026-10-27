CREATE TABLE native_plugin_policy (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id), revision bigint NOT NULL DEFAULT 0,
 enabled jsonb NOT NULL DEFAULT '{}'::jsonb, changed_by uuid REFERENCES accounts(id),updated_at timestamptz NOT NULL DEFAULT now()
);

-- Terminal execution and host cleanup are separate receipts; retry cleanup after host outages.
ALTER TABLE native_schedule_runs ADD COLUMN reclaimed boolean NOT NULL DEFAULT false;
