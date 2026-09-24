ALTER TABLE conversation_tasks ADD COLUMN public_query varchar(2048);
ALTER TABLE conversation_tasks ADD COLUMN web_sources jsonb NOT NULL DEFAULT '[]';
ALTER TABLE conversation_tasks ADD COLUMN skills jsonb NOT NULL DEFAULT '[]';
ALTER TABLE conversation_tasks ADD CONSTRAINT public_query_requires_agent CHECK(public_query IS NULL OR mode='AGENT');
