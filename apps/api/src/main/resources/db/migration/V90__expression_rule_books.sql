-- Text expression rules keep immutable HQ revisions; tenant/personal use authorized profile versions.
CREATE TABLE expression_rule_books (
 target varchar(16) NOT NULL CHECK(target IN ('ALL','BRIEFING')),
 revision integer NOT NULL CHECK(revision>0),
 body text NOT NULL CHECK(length(body)<=4000),
 changed_by uuid NOT NULL REFERENCES accounts(id),
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 request_id uuid NOT NULL UNIQUE,
 PRIMARY KEY(target,revision)
);
-- A task uses one rule snapshot throughout retries and generation phases.
CREATE TABLE expression_rule_task_snapshots (
 task_id uuid PRIMARY KEY REFERENCES conversation_tasks(id),
 rules jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
