CREATE TABLE native_schedules (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES native_conversations(id),
 request_id uuid NOT NULL, fingerprint text NOT NULL, configuration jsonb NOT NULL,
 record jsonb, next_due timestamptz, state text NOT NULL DEFAULT 'ACTIVE', reason text,
 observed_event bigint NOT NULL DEFAULT 0, last_dispatch_at timestamptz,
 legacy_plan_id uuid UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(session_id,request_id)
);
CREATE TABLE native_schedule_runs (
 id uuid PRIMARY KEY, schedule_id uuid NOT NULL REFERENCES native_schedules(id),
 session_id uuid NOT NULL REFERENCES native_conversations(id), trigger_key text NOT NULL,
 configuration jsonb NOT NULL, state text NOT NULL DEFAULT 'READY', reason text, receipt jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), dispatched_at timestamptz, finished_at timestamptz,
 UNIQUE(schedule_id,trigger_key)
);
CREATE INDEX native_schedule_due ON native_schedules(next_due) WHERE state='ACTIVE';
