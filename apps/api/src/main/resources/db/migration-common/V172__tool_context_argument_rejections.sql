-- Trusted engine classification of a task_context rejection before invoking the platform.
-- The failed receipt is retained; remote, permission, response and unknown errors remain failures.
ALTER TABLE conversation_tool_receipts ADD COLUMN rejection varchar(32);
ALTER TABLE conversation_tool_receipts ADD CONSTRAINT tool_context_argument_rejection
 CHECK (rejection IS NULL OR (rejection='CONTEXT_ARGUMENTS' AND name='task_context' AND status='failed'));
