-- System-owned composition is fixed before claim, and retains every source in the existing fence.
CREATE TABLE governed_fusion_task_plans (
 task_id uuid PRIMARY KEY REFERENCES conversation_tasks(id),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 recipe jsonb NOT NULL,
 recipe_sha256 char(64) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION guard_governed_fusion_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' OR NOT EXISTS(
  SELECT 1 FROM conversation_tasks t JOIN briefing_generation_batches b ON b.task_id=t.id
  WHERE t.id=NEW.task_id AND t.tenant_id=NEW.tenant_id AND b.tenant_id=t.tenant_id
   AND t.status='QUEUED' AND t.source_scope='SELECTED' AND coalesce(b.business_type,'DATA')='DATA'
 ) THEN RAISE EXCEPTION 'Fusion plan must be fixed before briefing claim'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER governed_fusion_plan_guard BEFORE INSERT OR UPDATE ON governed_fusion_task_plans
 FOR EACH ROW EXECUTE FUNCTION guard_governed_fusion_plan();
CREATE TABLE governed_fusion_receipts (
 artifact_id uuid PRIMARY KEY REFERENCES conversation_artifacts(id),
 task_id uuid NOT NULL REFERENCES governed_fusion_task_plans(task_id),
 attempt_number integer NOT NULL,
 evidence jsonb NOT NULL,
 evidence_sha256 char(64) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
