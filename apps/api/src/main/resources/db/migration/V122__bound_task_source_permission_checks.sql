-- Resolve the exact source objects before running recursive permission checks.
-- The previous SQL anti-join could evaluate library_mask for unrelated active
-- materials (thousands of calls for a small feed). Keep the same fail-closed
-- checks, including missing versions, recycled materials and download rights.
CREATE OR REPLACE FUNCTION library_task_sources_allowed(actor uuid,tenant uuid,target uuid,download boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE source record; required integer:=CASE WHEN download THEN 5 ELSE 1 END;
BEGIN
 FOR source IN
  SELECT DISTINCT m.id
  FROM library_task_versions(target) s
  LEFT JOIN material_versions v ON v.id=s.version_id AND v.tenant_id=tenant
  LEFT JOIN active_materials m ON m.id=v.material_id AND m.tenant_id=tenant
 LOOP
  IF source.id IS NULL THEN RETURN false; END IF;
  IF (library_mask(actor,tenant,'MATERIAL',source.id)&required)<>required THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
