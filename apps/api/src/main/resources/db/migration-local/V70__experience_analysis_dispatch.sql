-- Internal automatic-processing ledger. No public candidate or human-review endpoint.
CREATE TABLE experience_analysis_items (
 source_id uuid PRIMARY KEY REFERENCES experience_intake_sources(id),tenant_id uuid NOT NULL REFERENCES tenants(id),
 state varchar(24) NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','RUNNING','RETRY_WAIT','QUALIFIED','SKIPPED','REJECTED','FAILED','UNKNOWN','SOURCE_UNAVAILABLE')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),run_id uuid,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),error_code varchar(64)
);
CREATE INDEX experience_analysis_pending ON experience_analysis_items(state,next_attempt_at,tenant_id);
CREATE TABLE experience_analysis_runs (
 id uuid PRIMARY KEY,source_id uuid NOT NULL REFERENCES experience_intake_sources(id),tenant_id uuid NOT NULL REFERENCES tenants(id),
 lease uuid NOT NULL,lease_until timestamptz NOT NULL,state varchar(24) NOT NULL CHECK(state IN ('CLAIMED','DISPATCHED','RETURNED','FAILED','UNKNOWN','CANCELLED')),
 job_hash varchar(64) NOT NULL,manifest jsonb NOT NULL,engine_version varchar(64),execution_class varchar(16),
 outcome varchar(24),code varchar(64),stages jsonb,candidate jsonb,review jsonb,evidence jsonb,
 invalidated boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
 CHECK(execution_class IS NULL OR execution_class IN ('live','verification'))
);
ALTER TABLE experience_analysis_items ADD FOREIGN KEY(run_id) REFERENCES experience_analysis_runs(id);
CREATE UNIQUE INDEX experience_analysis_one_tenant ON experience_analysis_runs(tenant_id) WHERE state IN ('CLAIMED','DISPATCHED');
-- Candidates contain generated methods only. Quotes/raw inputs are never persisted here.
-- The only persisted source content references are IDs, hashes and UTF-16 spans.
CREATE FUNCTION invalidate_experience_analysis() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='experience_intake_sources' THEN
  IF NEW.state='SOURCE_UNAVAILABLE' THEN
   UPDATE experience_analysis_runs SET invalidated=true,candidate=NULL,review=NULL,evidence=NULL,
    state=CASE WHEN state IN ('CLAIMED','DISPATCHED') THEN 'CANCELLED' ELSE state END,
    code='EXPERIENCE_SOURCE_CHANGED',finished_at=coalesce(finished_at,now()) WHERE source_id=NEW.id;
   UPDATE experience_analysis_items SET state='SOURCE_UNAVAILABLE',error_code='EXPERIENCE_SOURCE_CHANGED',updated_at=now() WHERE source_id=NEW.id;
  END IF;
 ELSIF TG_TABLE_NAME='conversation_tasks' THEN
  IF NEW.revision<>OLD.revision OR NEW.attempt<>OLD.attempt OR NEW.prompt IS DISTINCT FROM OLD.prompt OR NEW.reply IS DISTINCT FROM OLD.reply THEN
   UPDATE experience_intake_sources SET state='SOURCE_UNAVAILABLE',reason='SOURCE_CHANGED',invalidated_at=now()
    WHERE task_id=OLD.id AND state='PENDING';
  END IF;
 ELSIF TG_TABLE_NAME='feedback_entries' THEN
  IF NEW.revision<>OLD.revision OR NEW.scrubbed THEN
   UPDATE experience_intake_sources SET state='SOURCE_UNAVAILABLE',reason='SOURCE_CHANGED',invalidated_at=now()
    WHERE feedback_id=OLD.id AND state='PENDING';
  END IF;
 ELSIF TG_TABLE_NAME='object_lifecycle' THEN
  IF NEW.state<>'ACTIVE' THEN
   UPDATE experience_intake_sources i SET state='SOURCE_UNAVAILABLE',reason='SOURCE_CHANGED',invalidated_at=now()
    WHERE i.state='PENDING' AND ((NEW.kind='TASK' AND task_id=NEW.object_id)
     OR (NEW.kind='FEEDBACK_VERSION' AND EXISTS(SELECT 1 FROM feedback_versions v WHERE v.id=NEW.object_id AND v.feedback_id=i.feedback_id AND v.revision=i.source_revision)));
  END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER experience_analysis_invalidated AFTER UPDATE OF state ON experience_intake_sources FOR EACH ROW EXECUTE FUNCTION invalidate_experience_analysis();
CREATE TRIGGER experience_analysis_task_changed AFTER UPDATE ON conversation_tasks FOR EACH ROW EXECUTE FUNCTION invalidate_experience_analysis();
CREATE TRIGGER experience_analysis_feedback_changed AFTER UPDATE ON feedback_entries FOR EACH ROW EXECUTE FUNCTION invalidate_experience_analysis();
CREATE TRIGGER experience_analysis_object_changed AFTER UPDATE OF state ON object_lifecycle FOR EACH ROW EXECUTE FUNCTION invalidate_experience_analysis();
