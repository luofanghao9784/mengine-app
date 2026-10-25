-- Populated spaces can now be reversibly removed. Task history and feedback must
-- honor the removed workspace even where the legacy file-permission rollout is off.
CREATE INDEX workspaces_archived_library ON workspaces(tenant_id) WHERE archived;
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('library_task_materials_readable(uuid)'::regprocedure);
 IF position('IF NOT FOUND THEN RETURN false; END IF;' in definition)=0 THEN RAISE EXCEPTION 'Unexpected task source evaluator'; END IF;
 definition:=replace(definition,'IF NOT FOUND THEN RETURN false; END IF;',
 'IF NOT FOUND THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM workspaces w WHERE w.tenant_id=t.tenant_id AND w.archived) AND (
   EXISTS(SELECT 1 FROM conversation_tasks c JOIN workspaces w ON w.id=c.workspace_id WHERE c.id=target AND w.archived)
   OR EXISTS(SELECT 1 FROM library_task_versions(target) s JOIN material_versions v ON v.id=s.version_id JOIN workspaces w ON w.id=v.workspace_id WHERE w.archived)
 ) THEN RETURN false; END IF;');
 EXECUTE definition;
 definition:=pg_get_functiondef('library_dispatch_task_readable(uuid)'::regprocedure);
 IF position('IF NOT FOUND THEN RETURN false; END IF;' in definition)=0 THEN RAISE EXCEPTION 'Unexpected task dispatcher'; END IF;
 EXECUTE replace(definition,'IF NOT FOUND THEN RETURN false; END IF;','IF NOT FOUND THEN RETURN false; END IF; IF NOT library_task_materials_readable(target) THEN RETURN false; END IF;');
 definition:=regexp_replace(pg_get_viewdef('readable_feedback'::regclass,true), ';\s*$', '');
 EXECUTE 'CREATE OR REPLACE VIEW readable_feedback AS SELECT original.id FROM ('||definition||') original JOIN feedback_entries entry ON entry.id=original.id
 WHERE NOT EXISTS(SELECT 1 FROM workspaces w WHERE w.id=entry.workspace_id AND w.archived)
 AND NOT EXISTS(SELECT 1 FROM feedback_source_versions s JOIN material_versions v ON v.id=s.version_id JOIN workspaces w ON w.id=v.workspace_id WHERE s.feedback_id=entry.id AND w.archived)';
END $$;
