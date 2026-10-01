CREATE TABLE conversation_plan_commands (
 task_id uuid PRIMARY KEY REFERENCES conversation_tasks(id),tenant_id uuid NOT NULL REFERENCES tenants(id),owner_id uuid NOT NULL REFERENCES accounts(id),
 plan_id uuid NOT NULL REFERENCES ongoing_plans(id),action text NOT NULL,request_hash text NOT NULL,accepted_revision integer NOT NULL,evidence_sha text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
