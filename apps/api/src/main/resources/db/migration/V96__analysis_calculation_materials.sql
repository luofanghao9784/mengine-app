-- First material-pool slice: server-computed artifacts, private until explicit publication.
-- Keep content in the existing lifecycle-controlled artifact store; do not duplicate private bytes.
CREATE TABLE analysis_computation_receipts (
 artifact_id uuid PRIMARY KEY REFERENCES conversation_artifacts(id),
 sha256 char(64) NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION guard_analysis_computation_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Computation receipts are immutable'; END $$;
CREATE TRIGGER analysis_computation_receipt_guard BEFORE UPDATE ON analysis_computation_receipts
 FOR EACH ROW EXECUTE FUNCTION guard_analysis_computation_receipt();
CREATE TABLE analysis_materials (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), owner_id uuid NOT NULL REFERENCES accounts(id),
 current_version integer NOT NULL DEFAULT 0 CHECK(current_version>=0),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE TABLE analysis_material_versions (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, material_id uuid NOT NULL, number integer NOT NULL CHECK(number>0),
 artifact_id uuid NOT NULL REFERENCES analysis_computation_receipts(artifact_id), source_task_id uuid NOT NULL REFERENCES conversation_tasks(id),
 dataset_id uuid NOT NULL, snapshot_id uuid NOT NULL, input_fingerprint char(64) NOT NULL,
 artifact_sha256 char(64) NOT NULL, request_fingerprint char(64) NOT NULL, recipe_version varchar(80) NOT NULL,
 dependency_scope varchar(20) NOT NULL DEFAULT 'WHOLE_DATASET' CHECK(dependency_scope='WHOLE_DATASET'),
 generated_at timestamptz NOT NULL, retained_at timestamptz NOT NULL DEFAULT now(), valid_until timestamptz NOT NULL,
 FOREIGN KEY(tenant_id,material_id) REFERENCES analysis_materials(tenant_id,id),
 FOREIGN KEY(dataset_id,snapshot_id) REFERENCES dataset_snapshots(dataset_id,id),
 UNIQUE(material_id,number), UNIQUE(tenant_id,artifact_id), UNIQUE(tenant_id,id),
 CHECK(valid_until>generated_at)
);
CREATE TABLE analysis_material_observations (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, version_id uuid NOT NULL,
 dataset_id uuid NOT NULL, snapshot_id uuid NOT NULL,
 checked_at timestamptz NOT NULL DEFAULT now(), coverage_through timestamptz,
 input_fingerprint char(64) NOT NULL,
 result varchar(20) NOT NULL CHECK(result IN ('UNCHANGED','CHANGED')),
 FOREIGN KEY(tenant_id,version_id) REFERENCES analysis_material_versions(tenant_id,id),
 FOREIGN KEY(dataset_id,snapshot_id) REFERENCES dataset_snapshots(dataset_id,id),
 UNIQUE(version_id,snapshot_id)
);
CREATE INDEX analysis_material_owner ON analysis_materials(tenant_id,owner_id,id);
CREATE INDEX analysis_material_dependency ON analysis_material_versions(dataset_id,snapshot_id);
CREATE FUNCTION guard_analysis_material_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Analysis evidence records are immutable'; END IF;
 IF TG_TABLE_NAME='analysis_material_versions' THEN
  IF NOT EXISTS(SELECT 1 FROM analysis_materials m
    JOIN conversation_tasks t ON t.tenant_id=m.tenant_id AND t.requested_by=m.owner_id
    JOIN conversation_artifacts a ON a.task_id=t.id AND a.tenant_id=t.tenant_id AND a.attempt_number=t.attempt
    JOIN task_dataset_reads pin ON pin.task_id=t.id AND pin.attempt_number=t.attempt
    JOIN dataset_snapshots s ON s.id=pin.snapshot_id AND s.tenant_id=m.tenant_id
    WHERE m.id=NEW.material_id AND m.tenant_id=NEW.tenant_id AND t.id=NEW.source_task_id
      AND t.status='SUCCEEDED' AND a.id=NEW.artifact_id AND a.sha256=NEW.artifact_sha256
      AND pin.dataset_id=NEW.dataset_id AND s.id=NEW.snapshot_id) THEN
   RAISE EXCEPTION 'Analysis material requires same-tenant completed task evidence';
  END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM analysis_material_versions v JOIN dataset_snapshots s ON s.dataset_id=v.dataset_id
    WHERE v.id=NEW.version_id AND v.tenant_id=NEW.tenant_id AND s.id=NEW.snapshot_id
      AND s.dataset_id=NEW.dataset_id AND s.tenant_id=NEW.tenant_id
      AND s.coverage_through IS NOT DISTINCT FROM NEW.coverage_through
      AND ((NEW.result='UNCHANGED')=(NEW.input_fingerprint=v.input_fingerprint))) THEN
   RAISE EXCEPTION 'Observation does not match material evidence';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER analysis_version_guard BEFORE INSERT OR UPDATE ON analysis_material_versions
 FOR EACH ROW EXECUTE FUNCTION guard_analysis_material_record();
CREATE TRIGGER analysis_observation_guard BEFORE INSERT OR UPDATE ON analysis_material_observations
 FOR EACH ROW EXECUTE FUNCTION guard_analysis_material_record();
CREATE FUNCTION guard_analysis_material_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.tenant_id,NEW.owner_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.owner_id,OLD.created_at)
  OR NEW.current_version<>OLD.current_version+1
  OR NOT EXISTS(SELECT 1 FROM analysis_material_versions WHERE material_id=NEW.id AND number=NEW.current_version) THEN
  RAISE EXCEPTION 'Invalid material identity or version transition';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER analysis_material_identity_guard BEFORE UPDATE ON analysis_materials
 FOR EACH ROW EXECUTE FUNCTION guard_analysis_material_identity();
