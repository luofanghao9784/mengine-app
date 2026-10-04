-- Preserve genuine timing for new tool receipts. Never infer historical starts from terminal receipts.
ALTER TABLE conversation_tool_receipts ADD COLUMN started_at timestamptz;
ALTER TABLE conversation_tool_receipts ADD COLUMN finished_at timestamptz;
ALTER TABLE conversation_tool_receipts ADD CONSTRAINT tool_observed_timing CHECK(finished_at IS NULL OR started_at IS NULL OR finished_at>=started_at);
CREATE INDEX tool_usage_started ON conversation_tool_receipts(started_at) WHERE started_at IS NOT NULL;
CREATE INDEX model_usage_started ON agent_model_requests(started_at);
-- Capture the descriptor actually accepted for each new dispatch. Legacy class remains unknown.
ALTER TABLE company_analysis_attempts ADD COLUMN execution_class varchar(16) CHECK(execution_class IN ('live','verification'));
