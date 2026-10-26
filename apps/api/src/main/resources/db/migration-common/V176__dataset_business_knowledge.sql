CREATE TABLE dataset_business_knowledge (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 actor_id uuid NOT NULL REFERENCES accounts(id),
 input_hash text NOT NULL,
 context jsonb NOT NULL,
 task_id uuid NOT NULL UNIQUE REFERENCES conversation_tasks(id),
 conversation_id uuid NOT NULL REFERENCES conversations(id),
 report jsonb,
 published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,actor_id,input_hash)
);
