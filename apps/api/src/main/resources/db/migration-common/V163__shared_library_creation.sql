-- WS-02/WS-06/WS-16: new employee-created spaces opt into ACL without migrating legacy spaces.
ALTER TABLE workspaces ADD COLUMN library_acl_enabled boolean NOT NULL DEFAULT false;
CREATE INDEX workspaces_scoped_library_acl ON workspaces(tenant_id) WHERE library_acl_enabled;
CREATE FUNCTION library_workspace_permissions_enabled(tenant uuid,space uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT library_permissions_enabled(tenant) OR EXISTS(SELECT 1 FROM workspaces w WHERE w.tenant_id=tenant AND w.id=space AND w.library_acl_enabled)
$$;
CREATE FUNCTION library_any_permissions_enabled(tenant uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT library_permissions_enabled(tenant) OR EXISTS(SELECT 1 FROM workspaces w WHERE w.tenant_id=tenant AND w.library_acl_enabled)
$$;
-- Follow derived publications too: a copy into a legacy space must not bypass its sources.
CREATE FUNCTION library_material_has_scoped_sources(target uuid,visited uuid[] DEFAULT ARRAY[]::uuid[]) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE dependency uuid;
BEGIN
 IF target=ANY(visited) OR cardinality(visited)>32 THEN RETURN true; END IF;
 IF EXISTS(SELECT 1 FROM materials m JOIN workspaces w ON w.id=m.workspace_id WHERE m.id=target AND w.library_acl_enabled) THEN RETURN true; END IF;
 FOR dependency IN SELECT mv.material_id FROM document_publications p JOIN private_documents d ON d.id=p.document_id
  CROSS JOIN LATERAL library_task_versions(d.source_task_id) s JOIN material_versions mv ON mv.id=s.version_id WHERE p.material_id=target LOOP
  IF library_material_has_scoped_sources(dependency,array_append(visited,target)) THEN RETURN true; END IF;
 END LOOP;
 RETURN false;
END $$;
CREATE FUNCTION library_task_has_scoped_sources(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM library_task_versions(target) s JOIN material_versions v ON v.id=s.version_id WHERE library_material_has_scoped_sources(v.material_id))
$$;
CREATE FUNCTION library_experience_permissions_enabled(tenant uuid,version uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT library_permissions_enabled(tenant) OR EXISTS(SELECT 1 FROM experience_evidence e LEFT JOIN material_versions v ON v.id=e.material_version_id
  WHERE e.version_id=version AND (library_material_has_scoped_sources(v.material_id) OR (e.kind='TASK' AND library_task_has_scoped_sources(e.task_id))))
$$;
DO $$ DECLARE definition text; fn record; BEGIN
 definition:=pg_get_functiondef('library_projected_mask(uuid,uuid,text,uuid,text,uuid,uuid,boolean)'::regprocedure);
 IF position('NOT library_permissions_enabled(tenant)' in definition)=0 THEN RAISE EXCEPTION 'Unexpected library evaluator'; END IF;
 EXECUTE replace(definition,'NOT library_permissions_enabled(tenant)','NOT library_workspace_permissions_enabled(tenant,space)');
 definition:=pg_get_functiondef('library_file_mask_before_scene(uuid,uuid,uuid,uuid[],text,uuid,uuid,boolean)'::regprocedure);
 IF position('NOT library_permissions_enabled(tenant)' in definition)=0 THEN RAISE EXCEPTION 'Unexpected source evaluator'; END IF;
 EXECUTE replace(definition,'library_permissions_enabled(tenant)','(library_permissions_enabled(tenant) OR (library_any_permissions_enabled(tenant) AND library_material_has_scoped_sources(target)))');
 definition:=pg_get_functiondef('library_task_materials_readable(uuid)'::regprocedure);
 EXECUTE replace(definition,'library_permissions_enabled(t.tenant_id)','(library_permissions_enabled(t.tenant_id) OR (library_any_permissions_enabled(t.tenant_id) AND library_task_has_scoped_sources(target)))');
 FOR fn IN SELECT oid FROM pg_proc WHERE pronamespace=current_schema()::regnamespace AND proname IN ('experience_intake_available','experience_intake_available_before_general','experience_intake_available_before_adjustment') LOOP
  definition:=pg_get_functiondef(fn.oid);
  EXECUTE replace(definition,'library_permissions_enabled(e.tenant_id)','library_experience_permissions_enabled(e.tenant_id,v.id)');
 END LOOP;
 definition:=regexp_replace(pg_get_viewdef('readable_feedback'::regclass,true), ';\s*$', '');
 IF position('library_permissions_enabled(f.tenant_id)' in definition)=0 THEN RAISE EXCEPTION 'Unexpected feedback evaluator'; END IF;
 definition:=replace(definition,'library_permissions_enabled(f.tenant_id)','(library_permissions_enabled(f.tenant_id) OR EXISTS(SELECT 1 FROM feedback_source_versions scoped JOIN material_versions mv ON mv.id=scoped.version_id WHERE scoped.feedback_id=f.id AND library_material_has_scoped_sources(mv.material_id)))');
 EXECUTE 'CREATE OR REPLACE VIEW readable_feedback AS '||definition;
END $$;
