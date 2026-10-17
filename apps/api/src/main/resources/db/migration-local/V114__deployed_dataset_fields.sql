-- Field interpretations are authored by deployment tooling, not an in-product model.
ALTER TABLE business_datasets ADD COLUMN field_definitions jsonb NOT NULL DEFAULT '[]'
 CHECK(jsonb_typeof(field_definitions)='array' AND jsonb_array_length(field_definitions)<=100);
CREATE FUNCTION guard_dataset_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.scrubbed THEN
  NEW.field_definitions='[]'::jsonb;
 ELSIF NEW.field_definitions IS DISTINCT FROM OLD.field_definitions THEN
  RAISE EXCEPTION 'field meaning changes require a new dataset identity; historical inputs are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dataset_fields_guard BEFORE UPDATE ON business_datasets FOR EACH ROW EXECUTE FUNCTION guard_dataset_fields();
