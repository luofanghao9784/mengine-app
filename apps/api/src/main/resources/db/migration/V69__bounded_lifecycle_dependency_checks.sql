-- Evaluate recursion only after selecting the target's actual dependencies.
-- SQL predicate order is not a recursion boundary: a correlated scan can otherwise
-- evaluate recursive functions against unrelated rows before applying its filters.
CREATE OR REPLACE FUNCTION object_is_active_internal(k text,target uuid,visited text[])
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE dep record; next_visited text[]; version_id uuid;
BEGIN
 IF k IS NULL OR target IS NULL OR (k||':'||target::text)=ANY(visited) THEN RETURN false; END IF;
 next_visited:=array_append(visited,k||':'||target::text);
 IF EXISTS(SELECT 1 FROM object_lifecycle l WHERE l.kind=k AND l.object_id=target
  AND (l.state<>'ACTIVE' OR (NOT l.is_formal AND l.policy_due<=now()))) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM lifecycle_object_sources s JOIN object_lifecycle_scopes fence ON fence.tenant_id=s.tenant_id
  AND (fence.owner_id IS NULL OR fence.owner_id=s.owner_id)
  WHERE s.kind=k AND s.object_id=target AND fence.state<>'RESTORED') THEN RETURN false; END IF;
 FOR dep IN SELECT s.parent_kind,s.parent_id FROM lifecycle_object_sources s
  WHERE s.kind=k AND s.object_id=target AND s.parent_id IS NOT NULL LOOP
  IF NOT object_is_active_internal(dep.parent_kind,dep.parent_id,next_visited) THEN RETURN false; END IF;
 END LOOP;
 IF k='DOCUMENT' THEN
  FOR dep IN SELECT d.source_artifact_id FROM private_documents d WHERE d.id=target AND d.source_artifact_id IS NOT NULL LOOP
   IF NOT object_is_active_internal('ARTIFACT',dep.source_artifact_id,next_visited) THEN RETURN false; END IF;
  END LOOP;
 END IF;
 IF k='PROFILE_VERSION' AND NOT EXISTS(SELECT 1 FROM profile_versions v WHERE v.id=target AND NOT v.scrubbed) THEN RETURN false; END IF;
 IF k='METHOD_VERSION' AND NOT EXISTS(SELECT 1 FROM method_versions v WHERE v.id=target AND NOT v.scrubbed) THEN RETURN false; END IF;
 IF k='TASK' THEN
  FOR dep IN SELECT src.id,src.tenant_id,dst.tenant_id destination_tenant,c.owner_id,dst.requested_by,
    w.id workspace_id,w.kind,w.owner_id workspace_owner
   FROM adjustment_task_dependencies d JOIN conversation_tasks src ON src.id=d.source_task_id
   JOIN conversations c ON c.id=src.conversation_id JOIN workspaces w ON w.id=c.workspace_id
   JOIN conversation_tasks dst ON dst.id=d.task_id WHERE d.task_id=target LOOP
   IF dep.tenant_id<>dep.destination_tenant OR dep.owner_id<>dep.requested_by
    OR NOT ((dep.kind='PERSONAL' AND dep.workspace_owner=dep.requested_by) OR (dep.kind='SHARED'
     AND EXISTS(SELECT 1 FROM workspace_members g WHERE g.workspace_id=dep.workspace_id AND g.account_id=dep.requested_by)))
    THEN RETURN false; END IF;
   IF NOT object_is_active_internal('TASK',dep.id,next_visited) THEN RETURN false; END IF;
  END LOOP;
  FOR dep IN SELECT r.kind,r.reference_id,r.version_key FROM task_context_reads r WHERE r.task_id=target LOOP
   IF dep.kind='HISTORY' AND dep.reference_id<>target THEN
    IF NOT object_is_active_internal('TASK',dep.reference_id,next_visited) THEN RETURN false; END IF;
   ELSIF dep.kind='EXPERIENCE' THEN
    SELECT v.id INTO version_id FROM experience_versions v WHERE v.entry_id=dep.reference_id AND v.id::text=dep.version_key;
    IF NOT FOUND THEN RETURN false; END IF;
    IF NOT object_is_active_internal('EXPERIENCE_VERSION',version_id,next_visited) THEN RETURN false; END IF;
   ELSIF dep.kind='PROFILE' THEN
    SELECT v.id INTO version_id FROM profile_versions v WHERE v.entry_id=dep.reference_id AND v.revision::text=dep.version_key AND NOT v.scrubbed;
    IF NOT FOUND THEN RETURN false; END IF;
    IF NOT object_is_active_internal('PROFILE_VERSION',version_id,next_visited) THEN RETURN false; END IF;
   END IF;
  END LOOP;
 END IF;
 RETURN true;
END $$;
