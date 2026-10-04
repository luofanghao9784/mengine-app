-- Internal source intake is not experience admission or a human review queue.
CREATE TABLE experience_intake_sources (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, owner_id uuid NOT NULL, workspace_id uuid NOT NULL,
 kind varchar(16) NOT NULL CHECK(kind IN ('TASK','FEEDBACK')),
 source_id uuid NOT NULL, source_revision integer NOT NULL CHECK(source_revision>=0), source_attempt integer NOT NULL CHECK(source_attempt>=0),
 task_id uuid REFERENCES conversation_tasks(id), feedback_id uuid REFERENCES feedback_entries(id),
 state varchar(24) NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','SOURCE_UNAVAILABLE')),
 reason varchar(40), checked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), invalidated_at timestamptz,
 FOREIGN KEY(tenant_id,owner_id) REFERENCES tenant_memberships(tenant_id,account_id),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id),
 UNIQUE(kind,source_id,source_revision,source_attempt),
 CHECK((kind='TASK' AND task_id IS NOT NULL AND source_id=task_id AND feedback_id IS NULL)
  OR (kind='FEEDBACK' AND feedback_id IS NOT NULL AND source_id=feedback_id))
);
CREATE INDEX experience_intake_pending ON experience_intake_sources(checked_at NULLS FIRST,created_at,id) WHERE state='PENDING';
CREATE FUNCTION experience_intake_available(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE i experience_intake_sources%ROWTYPE;
BEGIN
 SELECT * INTO i FROM experience_intake_sources WHERE id=target AND state='PENDING';
 IF NOT FOUND THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM tenants tenant
  JOIN accounts a ON a.id=i.owner_id AND a.status='ACTIVE'
  JOIN tenant_memberships m ON m.tenant_id=tenant.id AND m.account_id=a.id AND m.status='ACTIVE'
  JOIN workspaces w ON w.id=i.workspace_id AND w.tenant_id=tenant.id
  WHERE tenant.id=i.tenant_id AND tenant.status IN ('ACTIVE','SUSPENDED')
   AND ((w.kind='PERSONAL' AND w.owner_id=i.owner_id) OR EXISTS(SELECT 1 FROM workspace_members g WHERE g.workspace_id=w.id AND g.tenant_id=w.tenant_id AND g.account_id=i.owner_id)))
  OR NOT departure_content_readable(i.owner_id,i.tenant_id,i.workspace_id) THEN RETURN false; END IF;
 IF i.kind='TASK' THEN
  RETURN EXISTS(SELECT 1 FROM conversation_tasks t WHERE t.id=i.task_id AND t.tenant_id=i.tenant_id
   AND t.requested_by=i.owner_id AND t.workspace_id=i.workspace_id AND t.revision=i.source_revision AND t.attempt=i.source_attempt
   AND t.execution_class='live' AND t.status='SUCCEEDED' AND object_is_active('TASK',t.id)
   AND EXISTS(SELECT 1 FROM readable_source_tasks r WHERE r.id=i.task_id)
   AND EXISTS(SELECT 1 FROM conversation_attempts run WHERE run.task_id=t.id AND run.attempt_number=t.attempt AND run.status='SUCCEEDED' AND run.provenance='RECORDED'));
 END IF;
 RETURN EXISTS(SELECT 1 FROM feedback_entries f JOIN feedback_versions v ON v.feedback_id=f.id AND v.revision=f.revision
  WHERE f.id=i.feedback_id AND f.tenant_id=i.tenant_id AND f.actor_id=i.owner_id AND f.workspace_id=i.workspace_id
   AND f.revision=i.source_revision AND f.attempt=i.source_attempt AND v.status='ACTIVE' AND NOT f.scrubbed
   AND (f.task_id IS NULL OR f.snapshot->>'executionClass'='live') AND object_is_active('FEEDBACK_VERSION',v.id)
   AND EXISTS(SELECT 1 FROM readable_feedback r WHERE r.id=i.feedback_id)
   AND NOT EXISTS(SELECT 1 FROM document_publications pub JOIN private_documents doc ON doc.id=pub.document_id
    JOIN conversation_tasks origin ON origin.id=doc.source_task_id WHERE pub.id=f.publication_id AND origin.execution_class='verification'));
END $$;
-- Keep transient permission revocation from reviving an old pending source.
CREATE FUNCTION fence_experience_intake() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='workspace_members' THEN
  UPDATE experience_intake_sources SET state='SOURCE_UNAVAILABLE',reason='AUTHORITY_CHANGED',invalidated_at=now()
   WHERE tenant_id=OLD.tenant_id AND owner_id=OLD.account_id AND state='PENDING';
 ELSIF TG_TABLE_NAME='tenant_memberships' THEN
  UPDATE experience_intake_sources SET state='SOURCE_UNAVAILABLE',reason='AUTHORITY_CHANGED',invalidated_at=now()
   WHERE tenant_id=OLD.tenant_id AND owner_id=OLD.account_id AND state='PENDING';
 ELSIF TG_TABLE_NAME='accounts' THEN
  IF NEW.status<>OLD.status THEN UPDATE experience_intake_sources SET state='SOURCE_UNAVAILABLE',reason='AUTHORITY_CHANGED',invalidated_at=now()
   WHERE owner_id=OLD.id AND state='PENDING'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER experience_intake_workspace AFTER DELETE OR UPDATE ON workspace_members FOR EACH ROW EXECUTE FUNCTION fence_experience_intake();
CREATE TRIGGER experience_intake_membership AFTER DELETE OR UPDATE ON tenant_memberships FOR EACH ROW EXECUTE FUNCTION fence_experience_intake();
CREATE TRIGGER experience_intake_account AFTER UPDATE OF status ON accounts FOR EACH ROW EXECUTE FUNCTION fence_experience_intake();
