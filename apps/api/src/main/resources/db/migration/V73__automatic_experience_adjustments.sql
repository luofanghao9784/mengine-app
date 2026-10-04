-- User corrections are fixed private inputs to automatic checking, not approved versions.
CREATE TABLE experience_adjustments (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,workspace_id uuid NOT NULL,actor_id uuid NOT NULL,
 entry_id uuid NOT NULL REFERENCES experience_entries(id),version_id uuid NOT NULL REFERENCES experience_versions(id),
 expected_revision integer NOT NULL,content jsonb,finished boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES tenant_memberships(tenant_id,account_id)
);
CREATE UNIQUE INDEX experience_adjustment_pending ON experience_adjustments(entry_id) WHERE NOT finished;
ALTER TABLE experience_intake_sources ADD COLUMN adjustment_id uuid REFERENCES experience_adjustments(id);
ALTER TABLE experience_intake_sources DROP CONSTRAINT experience_intake_sources_kind_check;
ALTER TABLE experience_intake_sources DROP CONSTRAINT experience_intake_sources_check;
ALTER TABLE experience_intake_sources ADD CHECK(kind IN('TASK','FEEDBACK','ADJUSTMENT'));
ALTER TABLE experience_intake_sources ADD CHECK(
 (kind='TASK' AND task_id IS NOT NULL AND source_id=task_id AND feedback_id IS NULL AND adjustment_id IS NULL)
 OR (kind='FEEDBACK' AND feedback_id IS NOT NULL AND source_id=feedback_id AND adjustment_id IS NULL)
 OR (kind='ADJUSTMENT' AND adjustment_id IS NOT NULL AND source_id=adjustment_id AND id=adjustment_id AND task_id IS NULL AND feedback_id IS NULL));
CREATE OR REPLACE FUNCTION experience_intake_available(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE i experience_intake_sources%ROWTYPE; correction experience_adjustments%ROWTYPE;
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
 IF i.kind='ADJUSTMENT' THEN
  SELECT * INTO correction FROM experience_adjustments WHERE id=i.adjustment_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT correction.finished AND (correction.content IS NULL OR NOT EXISTS(SELECT 1 FROM governance_capabilities g WHERE g.tenant_id=i.tenant_id AND g.workspace_id=i.workspace_id AND g.account_id=i.owner_id AND g.capability='EXPERIENCE_MAINTAIN')
    OR NOT EXISTS(SELECT 1 FROM experience_entries e WHERE e.id=correction.entry_id AND e.status='PUBLISHED' AND e.published_version=correction.version_id AND e.revision=correction.expected_revision AND NOT e.automation_stopped)) THEN RETURN false; END IF;
  RETURN EXISTS(SELECT 1 FROM experience_entries e JOIN experience_versions v ON v.entry_id=e.id WHERE e.id=correction.entry_id AND e.tenant_id=i.tenant_id AND e.workspace_id=i.workspace_id AND v.id=correction.version_id AND NOT EXISTS(SELECT 1 FROM experience_evidence proof LEFT JOIN conversation_tasks source_task ON source_task.id=proof.task_id LEFT JOIN document_publications publication ON publication.material_version_id=proof.material_version_id LEFT JOIN private_documents document ON document.id=publication.document_id LEFT JOIN conversation_tasks published_task ON published_task.id=document.source_task_id WHERE proof.version_id=v.id AND (source_task.execution_class='verification' OR published_task.execution_class='verification')) AND NOT v.scrubbed AND object_is_active('EXPERIENCE_VERSION',v.id) AND (v.access_mode='INDEPENDENT_COPY' OR
 NOT EXISTS (SELECT 1 FROM experience_evidence r WHERE r.version_id=v.id AND NOT (
 EXISTS(SELECT 1 FROM workspaces w LEFT JOIN workspace_members g ON g.workspace_id=w.id AND g.tenant_id=w.tenant_id AND g.account_id=i.owner_id
 WHERE w.id=r.source_workspace_id AND w.tenant_id=e.tenant_id AND ((w.kind='PERSONAL' AND w.owner_id=i.owner_id) OR (w.kind='SHARED' AND g.account_id IS NOT NULL))
 AND ((r.kind='MATERIAL_VERSION' AND EXISTS(SELECT 1 FROM material_versions mv JOIN active_materials am ON am.id=mv.material_id WHERE mv.id=r.material_version_id AND mv.tenant_id=e.tenant_id AND mv.workspace_id=w.id))
 OR (r.kind='TASK' AND EXISTS(SELECT 1 FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id WHERE t.id=r.task_id AND t.tenant_id=e.tenant_id AND t.workspace_id=w.id AND c.owner_id=i.owner_id AND EXISTS(SELECT 1 FROM readable_source_tasks rt WHERE rt.id=t.id)))))))
 ));
 END IF;
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

CREATE FUNCTION fence_experience_adjustments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='experience_entries' THEN
  IF NEW.revision<>OLD.revision OR NEW.published_version IS DISTINCT FROM OLD.published_version OR NEW.automation_stopped THEN
   UPDATE experience_intake_sources i SET state='SOURCE_UNAVAILABLE',reason='SOURCE_CHANGED',invalidated_at=now()
    FROM experience_adjustments a WHERE i.adjustment_id=a.id AND a.entry_id=NEW.id AND NOT a.finished AND i.state='PENDING';
  END IF;
 ELSIF TG_TABLE_NAME='experience_versions' THEN
  IF NEW.scrubbed AND NOT OLD.scrubbed THEN
   UPDATE experience_intake_sources i SET state='SOURCE_UNAVAILABLE',reason='SOURCE_CHANGED',invalidated_at=now()
    FROM experience_adjustments a WHERE i.adjustment_id=a.id AND a.version_id=NEW.id AND i.state='PENDING';
  END IF;
 ELSIF TG_TABLE_NAME='object_lifecycle' THEN
  IF NEW.kind='EXPERIENCE_VERSION' AND NEW.state<>'ACTIVE' THEN
   UPDATE experience_intake_sources i SET state='SOURCE_UNAVAILABLE',reason='SOURCE_CHANGED',invalidated_at=now()
    FROM experience_adjustments a WHERE i.adjustment_id=a.id AND a.version_id=NEW.object_id AND i.state='PENDING';
  END IF;
 ELSIF TG_TABLE_NAME='governance_capabilities' THEN
  IF OLD.capability='EXPERIENCE_MAINTAIN' THEN
   UPDATE experience_intake_sources i SET state='SOURCE_UNAVAILABLE',reason='AUTHORITY_CHANGED',invalidated_at=now()
    FROM experience_adjustments a WHERE i.adjustment_id=a.id AND NOT a.finished AND i.tenant_id=OLD.tenant_id AND i.owner_id=OLD.account_id AND i.workspace_id=OLD.workspace_id AND i.state='PENDING';
  END IF;
 ELSIF TG_TABLE_NAME='experience_intake_sources' THEN
  IF NEW.kind='ADJUSTMENT' AND NEW.state='SOURCE_UNAVAILABLE' THEN
   UPDATE experience_adjustments SET finished=true,content=NULL WHERE id=NEW.adjustment_id;
  END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER adjustment_entry_changed AFTER UPDATE ON experience_entries FOR EACH ROW EXECUTE FUNCTION fence_experience_adjustments();
CREATE TRIGGER adjustment_version_changed AFTER UPDATE OF scrubbed ON experience_versions FOR EACH ROW EXECUTE FUNCTION fence_experience_adjustments();
CREATE TRIGGER adjustment_lifecycle_changed AFTER UPDATE OF state ON object_lifecycle FOR EACH ROW EXECUTE FUNCTION fence_experience_adjustments();
CREATE TRIGGER adjustment_authority_changed AFTER DELETE OR UPDATE ON governance_capabilities FOR EACH ROW EXECUTE FUNCTION fence_experience_adjustments();
CREATE TRIGGER adjustment_source_changed AFTER UPDATE OF state ON experience_intake_sources FOR EACH ROW EXECUTE FUNCTION fence_experience_adjustments();
