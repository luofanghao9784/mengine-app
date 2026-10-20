ALTER TABLE work_role_profiles ADD COLUMN goals jsonb NOT NULL DEFAULT '{"governance":"","stage":"","followUp":""}'::jsonb CHECK(jsonb_typeof(goals)='object');
-- Profile revision already participates in work_audience_key; save increments it on goal changes.
