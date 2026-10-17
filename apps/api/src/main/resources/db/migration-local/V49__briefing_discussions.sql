-- A private discussion references a delivered card; generation history stays in its source conversation.
CREATE TABLE briefing_discussions (
 conversation_id uuid PRIMARY KEY REFERENCES conversations(id),
 source_task_id uuid NOT NULL REFERENCES conversation_tasks(id),
 source_revision integer NOT NULL CHECK(source_revision>=0),
 source_attempt integer NOT NULL CHECK(source_attempt>=0),
 owner_id uuid NOT NULL REFERENCES accounts(id),
 UNIQUE(owner_id,source_task_id,source_revision,source_attempt)
);
DO $$ DECLARE prior text; BEGIN
 prior := regexp_replace(pg_get_viewdef('readable_source_tasks'::regclass,true), ';\s*$', '');
 EXECUTE 'CREATE OR REPLACE VIEW readable_source_tasks AS SELECT prior.id FROM (' || prior || ') prior
 WHERE NOT EXISTS (SELECT 1 FROM conversation_tasks target JOIN briefing_discussions d ON d.conversation_id=target.conversation_id
 WHERE target.id=prior.id AND NOT EXISTS (SELECT 1 FROM conversation_tasks source JOIN (' || prior || ') readable ON readable.id=source.id
 WHERE source.id=d.source_task_id AND source.revision=d.source_revision AND source.attempt=d.source_attempt AND source.status=''SUCCEEDED''))';
END $$;
