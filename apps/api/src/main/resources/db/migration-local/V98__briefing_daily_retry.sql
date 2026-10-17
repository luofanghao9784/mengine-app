-- One explicitly requested retry per local day; the original failed run remains immutable evidence.
CREATE TABLE briefing_daily_retries (
 policy_id uuid NOT NULL REFERENCES briefing_daily_schedules(policy_id),local_day date NOT NULL,
 scheduled_for timestamptz NOT NULL,batch_id uuid REFERENCES briefing_generation_batches(id),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(policy_id,local_day),
 FOREIGN KEY(policy_id,local_day) REFERENCES briefing_daily_runs(policy_id,local_day)
);
