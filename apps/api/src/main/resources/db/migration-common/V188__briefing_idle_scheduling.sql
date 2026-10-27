-- Scheduling hints only: never store an authorization decision here.
ALTER TABLE briefing_generation_policies
    ADD COLUMN next_idle_check_at timestamptz,
    ADD COLUMN idle_check_seconds integer NOT NULL DEFAULT 0
        CHECK (idle_check_seconds BETWEEN 0 AND 60);
CREATE INDEX briefing_generation_open_policy_idx
    ON briefing_generation_batches (policy_id,tenant_id,id)
    WHERE status IN ('QUEUED','RUNNING','WAITING_DATA','WAITING_RESOURCE','WAITING_CAPABILITY');
