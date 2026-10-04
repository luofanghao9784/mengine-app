-- A manual stop is not direct source erasure of the same entry's version history.
-- Real source erasure, including cross-entry cascades, still invalidates all dependent versions.
CREATE OR REPLACE FUNCTION erase_invalid_automatic_experience() RETURNS trigger LANGUAGE plpgsql AS $$
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
   FOR target IN SELECT d.version_id FROM experience_automatic_dependencies d JOIN experience_versions parent ON parent.id=d.dependency_version JOIN experience_versions v ON v.id=d.version_id WHERE parent.entry_id=NEW.id AND v.entry_id<>NEW.id AND NOT v.scrubbed LOOP
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
