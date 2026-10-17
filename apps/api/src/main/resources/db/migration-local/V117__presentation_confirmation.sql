-- Private task-owned draft. Confirming and resuming are one transaction.
CREATE TABLE conversation_presentations (
 task_id uuid PRIMARY KEY REFERENCES conversation_tasks(id),
 send_request uuid UNIQUE,
 options jsonb NOT NULL DEFAULT '{}'::jsonb,
 spec jsonb,
 state text NOT NULL DEFAULT 'REQUESTED' CHECK (state IN ('REQUESTED','DRAFT','CONFIRMED')),
 revision integer NOT NULL DEFAULT 0,
 proposed_attempt uuid,
 confirmed_request uuid,
 confirmation_hash text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((state='REQUESTED')=(spec IS NULL))
);
