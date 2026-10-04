-- Private platform proposals are separate from tenant intake and source evidence.
CREATE TABLE general_experience_adjustments (
 id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES accounts(id),request_id uuid NOT NULL,request_hash varchar(64) NOT NULL,
 entry_id uuid NOT NULL REFERENCES general_experience_entries(id),version_id uuid NOT NULL REFERENCES general_experience_versions(id),
 expected_revision integer NOT NULL CHECK(expected_revision>0),content text,
 phase varchar(16) NOT NULL DEFAULT 'EXTRACT' CHECK(phase IN ('EXTRACT','GENERALIZE')),
 state varchar(24) NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','RETRY_WAIT','RUNNING','UNCERTAIN','PUBLISHING','ADMITTED','SKIPPED','REJECTED','FAILED','UNKNOWN','UNAVAILABLE','CONFLICT')),
 run_id uuid,extraction_run uuid,result_version uuid REFERENCES general_experience_versions(id),
 attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),error_code varchar(64),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_id,request_id),CHECK(content IS NULL OR length(content) BETWEEN 1 AND 12000)
);
CREATE UNIQUE INDEX general_adjustment_one_pending ON general_experience_adjustments(entry_id) WHERE state IN ('QUEUED','RETRY_WAIT','RUNNING','UNCERTAIN','PUBLISHING');
CREATE TABLE general_experience_adjustment_runs (
 id uuid PRIMARY KEY,proposal_id uuid NOT NULL REFERENCES general_experience_adjustments(id),phase varchar(16) NOT NULL CHECK(phase IN ('EXTRACT','GENERALIZE')),
 lease uuid NOT NULL,lease_until timestamptz NOT NULL,job_hash varchar(64) NOT NULL,
 state varchar(16) NOT NULL CHECK(state IN ('CLAIMED','DISPATCHED','RETURNED','FAILED','UNKNOWN','CANCELLED')),
 engine_version varchar(64),execution_class varchar(16) CHECK(execution_class IN ('live','verification')),
 outcome varchar(24),receipt jsonb,stages jsonb,created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz
);
ALTER TABLE general_experience_adjustments ADD FOREIGN KEY(run_id) REFERENCES general_experience_adjustment_runs(id);
ALTER TABLE general_experience_adjustments ADD FOREIGN KEY(extraction_run) REFERENCES general_experience_adjustment_runs(id);
-- Adjusted general methods retain an exact earlier general version, not a fabricated enterprise origin.
CREATE TABLE general_experience_version_dependencies (
 version_id uuid PRIMARY KEY REFERENCES general_experience_versions(id),base_version uuid NOT NULL REFERENCES general_experience_versions(id),
 adjustment_id uuid NOT NULL UNIQUE REFERENCES general_experience_adjustments(id),CHECK(version_id<>base_version)
);
CREATE INDEX general_version_dependents ON general_experience_version_dependencies(base_version);
CREATE OR REPLACE FUNCTION general_experience_history_readable(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE current_id uuid:=target; seen uuid[]:='{}'; v record; d record; origin uuid;
BEGIN
 LOOP
  IF current_id=ANY(seen) THEN RETURN false; END IF; seen:=array_append(seen,current_id);
  SELECT x.entry_id,x.number INTO v FROM general_experience_versions x JOIN general_experience_entries e ON e.id=x.entry_id
   WHERE x.id=current_id AND x.method IS NOT NULL AND e.status IN ('AVAILABLE','STOPPED');
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT source_version INTO origin FROM general_experience_origins WHERE version_id=current_id;
  IF FOUND THEN
   IF EXISTS(SELECT 1 FROM general_experience_version_dependencies WHERE version_id=current_id) THEN RETURN false; END IF;
   RETURN generalization_source_available(origin);
  END IF;
  SELECT p.base_version INTO d FROM general_experience_version_dependencies p
   JOIN general_experience_versions b ON b.id=p.base_version AND b.entry_id=v.entry_id AND b.number<v.number
   JOIN general_experience_adjustments a ON a.id=p.adjustment_id AND a.entry_id=v.entry_id AND a.version_id=b.id AND a.result_version=current_id AND a.state='ADMITTED'
   JOIN general_experience_adjustment_runs x ON x.id=a.extraction_run AND x.proposal_id=a.id AND x.phase='EXTRACT' AND x.execution_class='live' AND x.outcome='QUALIFIED'
   JOIN general_experience_adjustment_runs g ON g.id=a.run_id AND g.proposal_id=a.id AND g.phase='GENERALIZE' AND g.execution_class='live' AND g.outcome='QUALIFIED'
   WHERE p.version_id=current_id;
  IF NOT FOUND THEN RETURN false; END IF; current_id:=d.base_version;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION general_experience_available(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM general_experience_versions v JOIN general_experience_entries e ON e.id=v.entry_id
  WHERE v.id=target AND e.status='AVAILABLE' AND e.published_version=v.id AND v.method IS NOT NULL) THEN RETURN false; END IF;
 RETURN general_experience_history_readable(target);
END $$;
CREATE FUNCTION platform_general_adjustment_available(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE a general_experience_adjustments%ROWTYPE;
BEGIN
 SELECT * INTO a FROM general_experience_adjustments WHERE id=target AND state IN ('QUEUED','RETRY_WAIT','RUNNING','UNCERTAIN','PUBLISHING');
 IF NOT FOUND OR a.content IS NULL THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM accounts x JOIN platform_accounts p ON p.account_id=x.id JOIN platform_roles r ON r.account_id=x.id AND r.role='PLATFORM_ADMIN' WHERE x.id=a.actor_id AND x.status='ACTIVE') THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM general_experience_entries e WHERE e.id=a.entry_id AND e.revision=a.expected_revision AND e.published_version=a.version_id AND e.status='AVAILABLE') THEN RETURN false; END IF;
 RETURN general_experience_available(a.version_id);
END $$;
CREATE FUNCTION clear_platform_general_adjustment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state NOT IN ('QUEUED','RETRY_WAIT','RUNNING','UNCERTAIN','PUBLISHING') THEN
  NEW.content:=NULL;
  UPDATE general_experience_adjustment_runs SET receipt=NULL,
   state=CASE WHEN state IN ('CLAIMED','DISPATCHED') THEN 'CANCELLED' ELSE state END,
   finished_at=coalesce(finished_at,now()) WHERE proposal_id=NEW.id;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER general_adjustment_terminal BEFORE UPDATE OF state ON general_experience_adjustments FOR EACH ROW EXECUTE FUNCTION clear_platform_general_adjustment();
CREATE FUNCTION fence_platform_general_adjustments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE general_experience_adjustments SET state='UNAVAILABLE',error_code='GENERAL_ADJUSTMENT_SOURCE_CHANGED',updated_at=clock_timestamp()
 WHERE state IN ('QUEUED','RETRY_WAIT','RUNNING','UNCERTAIN','PUBLISHING') AND NOT platform_general_adjustment_available(id);
 RETURN NULL;
END $$;
CREATE TRIGGER general_adjustment_entry_fence AFTER UPDATE OF status,published_version,revision ON general_experience_entries FOR EACH ROW EXECUTE FUNCTION fence_platform_general_adjustments();
CREATE TRIGGER general_adjustment_role_fence AFTER DELETE OR UPDATE ON platform_roles FOR EACH ROW EXECUTE FUNCTION fence_platform_general_adjustments();
CREATE TRIGGER general_adjustment_account_fence AFTER UPDATE OF status ON accounts FOR EACH ROW EXECUTE FUNCTION fence_platform_general_adjustments();
CREATE TRIGGER general_adjustment_platform_fence AFTER DELETE ON platform_accounts FOR EACH ROW EXECUTE FUNCTION fence_platform_general_adjustments();
CREATE FUNCTION erase_general_adjustment_descendants() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.method IS NOT NULL AND NEW.method IS NULL THEN
  UPDATE general_experience_versions SET method=NULL WHERE method IS NOT NULL AND id IN (
   WITH RECURSIVE dependencies(id) AS (SELECT NEW.id UNION SELECT d.version_id FROM general_experience_version_dependencies d JOIN dependencies p ON p.id=d.base_version)
   SELECT id FROM dependencies);
  UPDATE general_experience_entries SET status='WITHDRAWN',revision=revision+1,updated_at=clock_timestamp()
   WHERE status<>'WITHDRAWN' AND published_version IN (SELECT id FROM general_experience_versions WHERE method IS NULL);
  UPDATE general_experience_adjustments SET state='UNAVAILABLE',error_code='GENERAL_ADJUSTMENT_SOURCE_CHANGED',updated_at=clock_timestamp()
   WHERE state IN ('QUEUED','RETRY_WAIT','RUNNING','UNCERTAIN','PUBLISHING') AND NOT platform_general_adjustment_available(id);
 END IF; RETURN NULL;
END $$;
CREATE TRIGGER general_adjustment_source_erased AFTER UPDATE OF method ON general_experience_versions FOR EACH ROW EXECUTE FUNCTION erase_general_adjustment_descendants();
