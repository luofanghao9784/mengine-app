-- Fixed, deployment-installed recipe receipts; no new content grants.
CREATE TABLE task_reconciliation_receipts (
 task_id uuid NOT NULL REFERENCES conversation_tasks(id) ON DELETE CASCADE,
 attempt_number integer NOT NULL CHECK(attempt_number>0),
 receipt_id text NOT NULL,
 body jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(task_id,attempt_number,receipt_id)
);
