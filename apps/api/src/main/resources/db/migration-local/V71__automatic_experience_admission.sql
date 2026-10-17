ALTER TABLE experience_versions ADD COLUMN origin varchar(16) NOT NULL DEFAULT 'MANUAL';
ALTER TABLE experience_versions ADD COLUMN evaluation varchar(24) NOT NULL DEFAULT 'NOT_EVALUATED';
ALTER TABLE experience_versions ADD COLUMN content_fingerprint varchar(64);
ALTER TABLE experience_versions ADD CHECK((origin='MANUAL' AND evaluation='NOT_EVALUATED') OR (origin='AUTOMATIC' AND evaluation='AUTOMATIC_CHECKED'));
ALTER TABLE experience_entries ADD COLUMN automation_stopped boolean NOT NULL DEFAULT false;
CREATE INDEX experience_automatic_fingerprint ON experience_versions(content_fingerprint) WHERE origin='AUTOMATIC';
CREATE TABLE experience_admissions (
 run_id uuid PRIMARY KEY REFERENCES experience_analysis_runs(id),source_id uuid NOT NULL REFERENCES experience_intake_sources(id),
 outcome varchar(24) NOT NULL CHECK(outcome IN ('CREATED','UPDATED','DUPLICATE','CONFLICT','SOURCE_UNAVAILABLE')),
 entry_id uuid REFERENCES experience_entries(id),version_id uuid REFERENCES experience_versions(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE experience_automatic_sources (
 version_id uuid NOT NULL REFERENCES experience_versions(id),source_id uuid NOT NULL REFERENCES experience_intake_sources(id),PRIMARY KEY(version_id,source_id)
);
CREATE INDEX experience_automatic_source_lookup ON experience_automatic_sources(source_id);
CREATE TABLE experience_automatic_dependencies (
 version_id uuid NOT NULL REFERENCES experience_versions(id),dependency_version uuid NOT NULL REFERENCES experience_versions(id),
 PRIMARY KEY(version_id,dependency_version),CHECK(version_id<>dependency_version)
);
CREATE INDEX experience_automatic_dependency_lookup ON experience_automatic_dependencies(dependency_version);
CREATE FUNCTION erase_invalid_automatic_experience() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 IF TG_TABLE_NAME='experience_intake_sources' THEN
  IF NEW.state='SOURCE_UNAVAILABLE' THEN
  FOR target IN SELECT s.version_id FROM experience_automatic_sources s JOIN experience_versions v ON v.id=s.version_id WHERE s.source_id=NEW.id AND NOT v.scrubbed LOOP
   PERFORM scrub_lifecycle_object('EXPERIENCE_VERSION',target);
  END LOOP;
  END IF;
 ELSIF TG_TABLE_NAME='experience_versions' THEN
  IF NEW.scrubbed AND NOT OLD.scrubbed THEN
   FOR target IN SELECT d.version_id FROM experience_automatic_dependencies d JOIN experience_versions v ON v.id=d.version_id WHERE d.dependency_version=NEW.id AND NOT v.scrubbed LOOP
    PERFORM scrub_lifecycle_object('EXPERIENCE_VERSION',target);
   END LOOP;
  END IF;
 ELSIF TG_TABLE_NAME='experience_entries' THEN
  IF NEW.automation_stopped AND NOT OLD.automation_stopped THEN
   FOR target IN SELECT d.version_id FROM experience_automatic_dependencies d JOIN experience_versions parent ON parent.id=d.dependency_version JOIN experience_versions v ON v.id=d.version_id WHERE parent.entry_id=NEW.id AND NOT v.scrubbed LOOP
    PERFORM scrub_lifecycle_object('EXPERIENCE_VERSION',target);
   END LOOP;
  END IF;
 ELSIF TG_TABLE_NAME='object_lifecycle' THEN
  IF NEW.kind='EXPERIENCE_VERSION' AND NEW.state<>'ACTIVE' THEN
   FOR target IN SELECT d.version_id FROM experience_automatic_dependencies d JOIN experience_versions v ON v.id=d.version_id WHERE d.dependency_version=NEW.object_id AND NOT v.scrubbed LOOP
    PERFORM scrub_lifecycle_object('EXPERIENCE_VERSION',target);
   END LOOP;
  END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER automatic_experience_source_erased AFTER UPDATE OF state ON experience_intake_sources FOR EACH ROW EXECUTE FUNCTION erase_invalid_automatic_experience();
CREATE TRIGGER automatic_experience_version_erased AFTER UPDATE OF scrubbed ON experience_versions FOR EACH ROW EXECUTE FUNCTION erase_invalid_automatic_experience();
CREATE TRIGGER automatic_experience_dependency_erased AFTER UPDATE OF state ON object_lifecycle FOR EACH ROW EXECUTE FUNCTION erase_invalid_automatic_experience();
CREATE TRIGGER automatic_experience_manually_stopped AFTER UPDATE OF automation_stopped ON experience_entries FOR EACH ROW EXECUTE FUNCTION erase_invalid_automatic_experience();
