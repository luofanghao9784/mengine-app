-- Narrow task-token writes. No new delegation, recipient, workspace or arbitrary profile text.
CREATE TABLE task_plan_checks (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), owner_id uuid NOT NULL REFERENCES accounts(id),
 task_id uuid NOT NULL REFERENCES conversation_tasks(id), attempt_number integer NOT NULL,
 plan_id uuid NOT NULL REFERENCES ongoing_plans(id), execution_epoch bigint NOT NULL,
 request_id uuid NOT NULL, request_hash varchar(64) NOT NULL, accepted_revision integer NOT NULL,
 check_at timestamptz NOT NULL, reason varchar(500) NOT NULL,
 state varchar(16) NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','DISPATCHED','CANCELLED')),
 dispatched_task_id uuid REFERENCES conversation_tasks(id), created_at timestamptz NOT NULL DEFAULT now(), scrubbed boolean NOT NULL DEFAULT false,
 UNIQUE(owner_id,request_id), FOREIGN KEY(task_id,attempt_number) REFERENCES conversation_attempts(task_id,attempt_number)
);
CREATE UNIQUE INDEX task_plan_single_pending ON task_plan_checks(plan_id) WHERE state='PENDING';
CREATE INDEX task_plan_checks_task ON task_plan_checks(task_id,created_at);
CREATE TABLE task_preference_saves (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), owner_id uuid NOT NULL REFERENCES accounts(id),
 task_id uuid NOT NULL REFERENCES conversation_tasks(id), attempt_number integer NOT NULL,
 request_id uuid NOT NULL, request_hash varchar(64) NOT NULL,
 category varchar(32) NOT NULL CHECK(category IN ('RESPONSE_LENGTH','RESPONSE_FORMAT','TONE')),
 choice varchar(32) NOT NULL,
 profile_id uuid NOT NULL REFERENCES profile_entries(id), profile_revision integer NOT NULL,
 evidence_source varchar(16) NOT NULL CHECK(evidence_source IN ('PROMPT','SUPPLEMENT')),
 evidence_offset integer NOT NULL CHECK(evidence_offset>=0), evidence_length integer NOT NULL CHECK(evidence_length BETWEEN 1 AND 200), evidence_sha varchar(64) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,request_id), FOREIGN KEY(task_id,attempt_number) REFERENCES conversation_attempts(task_id,attempt_number),
 CHECK((category='RESPONSE_LENGTH' AND choice IN ('CONCISE','DETAILED')) OR (category='RESPONSE_FORMAT' AND choice IN ('PARAGRAPHS','BULLETS')) OR (category='TONE' AND choice IN ('DIRECT','FRIENDLY')))
);
CREATE INDEX task_preference_saves_task ON task_preference_saves(task_id,created_at);
-- Metadata holds no user quotation. Independent enum preferences remain in ordinary profile lifecycle.
CREATE FUNCTION scrub_task_work_task(target uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE task_plan_checks SET reason='',scrubbed=true,state=CASE WHEN state='PENDING' THEN 'CANCELLED' ELSE state END WHERE task_id=target;
END $$;
CREATE FUNCTION scrub_task_work_scope(target_tenant uuid,target_owner uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE affected integer;
BEGIN
 UPDATE task_plan_checks SET reason='',scrubbed=true,state=CASE WHEN state='PENDING' THEN 'CANCELLED' ELSE state END WHERE id IN
 (SELECT id FROM task_plan_checks WHERE tenant_id=target_tenant AND (target_owner IS NULL OR owner_id=target_owner) AND (reason<>'' OR NOT scrubbed OR state='PENDING') ORDER BY id LIMIT 100);
 GET DIAGNOSTICS affected=ROW_COUNT; RETURN affected;
END $$;
CREATE FUNCTION task_work_source_scrub() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.error_code IN ('SOURCE_REMOVED','OBJECT_REMOVED') THEN PERFORM scrub_task_work_task(NEW.id); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task_work_source_scrub AFTER UPDATE OF error_code ON conversation_tasks FOR EACH ROW EXECUTE FUNCTION task_work_source_scrub();
-- A control change never revives an old scheduled check. Own schedule changes revision only, not epoch.
CREATE FUNCTION task_work_plan_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status<>'ACTIVE' OR NEW.execution_epoch<>OLD.execution_epoch THEN
  UPDATE task_plan_checks SET state='CANCELLED' WHERE plan_id=NEW.id AND state='PENDING';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task_work_plan_fence AFTER UPDATE OF status,execution_epoch ON ongoing_plans FOR EACH ROW EXECUTE FUNCTION task_work_plan_fence();
