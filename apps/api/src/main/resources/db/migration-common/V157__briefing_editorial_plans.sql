-- One immutable reader-scoped plan can drive several independently validated card tasks.
CREATE TABLE briefing_editorial_batches (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 owner_id uuid NOT NULL REFERENCES accounts(id),
 body jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE briefing_editorial_tasks (
 task_id uuid PRIMARY KEY REFERENCES conversation_tasks(id) ON DELETE CASCADE,
 batch_id uuid NOT NULL REFERENCES briefing_editorial_batches(id),
 selected_index integer NOT NULL CHECK(selected_index>=0),
 UNIQUE(batch_id,selected_index)
);
