-- Classify by durable generation ownership, never by a prompt/title prefix.
ALTER TABLE conversation_tasks ADD COLUMN origin varchar(24) NOT NULL DEFAULT 'USER'
 CHECK (origin IN ('USER','SYSTEM_BRIEFING'));
UPDATE conversation_tasks t SET origin='SYSTEM_BRIEFING'
 WHERE EXISTS(SELECT 1 FROM briefing_generation_batches b WHERE b.task_id=t.id
 AND b.tenant_id=t.tenant_id AND b.owner_id=t.requested_by AND b.workspace_id=t.workspace_id);

ALTER TABLE conversations DROP CONSTRAINT conversations_purpose_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_purpose_check
 CHECK (purpose IN ('BUSINESS','BRIEFING_ADJUSTMENT','BRIEFING_GENERATION'));
UPDATE conversations c SET purpose='BRIEFING_GENERATION',title='画报生成记录'
 WHERE c.purpose='BUSINESS'
 AND EXISTS(SELECT 1 FROM conversation_tasks t WHERE t.conversation_id=c.id AND t.origin='SYSTEM_BRIEFING')
 AND NOT EXISTS(SELECT 1 FROM conversation_tasks t WHERE t.conversation_id=c.id AND t.origin='USER');

-- A legacy source conversation may already contain genuine follow-up work.
-- Keep it visible, title it from the first user request and sort by user activity.
UPDATE conversations c SET title=(SELECT left(t.prompt,80) FROM conversation_tasks t
 WHERE t.conversation_id=c.id AND t.origin='USER' ORDER BY t.created_at,t.id LIMIT 1),
 updated_at=(SELECT max(t.created_at) FROM conversation_tasks t WHERE t.conversation_id=c.id AND t.origin='USER')
 WHERE c.purpose='BUSINESS'
 AND EXISTS(SELECT 1 FROM conversation_tasks t WHERE t.conversation_id=c.id AND t.origin='SYSTEM_BRIEFING')
 AND EXISTS(SELECT 1 FROM conversation_tasks t WHERE t.conversation_id=c.id AND t.origin='USER');
CREATE INDEX conversation_user_tasks ON conversation_tasks(conversation_id,created_at,id) WHERE origin='USER';
