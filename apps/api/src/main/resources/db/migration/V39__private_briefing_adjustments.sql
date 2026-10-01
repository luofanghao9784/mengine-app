-- Explicit private work for a card; never an automatic new business result or standing preference.
-- Normal public submits remain limited to 2000; captured adjustment context is bounded at 12000.
ALTER TABLE conversation_tasks ALTER COLUMN prompt TYPE varchar(12000);
ALTER TABLE conversations ADD COLUMN purpose varchar(24) NOT NULL DEFAULT 'BUSINESS'
 CHECK (purpose IN ('BUSINESS','BRIEFING_ADJUSTMENT'));
CREATE TABLE feedback_adjustment_threads (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),owner_id uuid NOT NULL REFERENCES accounts(id),
 card_kind varchar(16) NOT NULL CHECK(card_kind IN ('BRIEFING','PUBLICATION')),card_id uuid NOT NULL,
 conversation_id uuid NOT NULL UNIQUE REFERENCES conversations(id),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,owner_id,card_kind,card_id)
);
CREATE TABLE feedback_adjustment_messages (
 id uuid PRIMARY KEY,thread_id uuid NOT NULL REFERENCES feedback_adjustment_threads(id),ordinal integer NOT NULL CHECK(ordinal>0),
 task_id uuid NOT NULL UNIQUE REFERENCES conversation_tasks(id),feedback_version_id uuid NOT NULL REFERENCES feedback_versions(id),
 source_target jsonb NOT NULL,snapshot jsonb NOT NULL,request_text text NOT NULL CHECK(length(request_text)<=2000),
 history_task_ids uuid[] NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),scrubbed boolean NOT NULL DEFAULT false,
 UNIQUE(thread_id,ordinal)
);
-- Actual copied task/history dependencies, not assertions that an agent invoked a history tool.
-- Material references are also inserted into feedback_task_sources, so all existing read/claim/finish gates apply.
CREATE TABLE adjustment_task_dependencies (
 task_id uuid NOT NULL REFERENCES conversation_tasks(id),source_task_id uuid NOT NULL REFERENCES conversation_tasks(id),
 source_revision integer NOT NULL,source_attempt integer NOT NULL,PRIMARY KEY(task_id,source_task_id),CHECK(task_id<>source_task_id)
);
CREATE INDEX adjustment_dependencies_source ON adjustment_task_dependencies(source_task_id);

CREATE OR REPLACE FUNCTION object_is_active_internal(target_kind text,target_id uuid,visited text[]) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN (target_kind||':'||target_id::text)=ANY(visited) THEN false ELSE NOT EXISTS(SELECT 1 FROM object_lifecycle l WHERE l.kind=target_kind AND l.object_id=target_id AND (l.state<>'ACTIVE' OR (NOT l.is_formal AND l.policy_due<=now())))
 AND NOT EXISTS(SELECT 1 FROM lifecycle_object_sources s JOIN object_lifecycle_scopes fence ON fence.tenant_id=s.tenant_id
  AND (fence.owner_id IS NULL OR fence.owner_id=s.owner_id) WHERE s.kind=target_kind AND s.object_id=target_id AND fence.state NOT IN('RESTORED'))
 AND NOT EXISTS(SELECT 1 FROM lifecycle_object_sources s WHERE s.kind=target_kind AND s.object_id=target_id AND s.parent_id IS NOT NULL AND NOT object_is_active_internal(s.parent_kind,s.parent_id,array_append(visited,target_kind||':'||target_id::text)))
 AND NOT EXISTS(SELECT 1 FROM private_documents d WHERE target_kind='DOCUMENT' AND d.id=target_id AND d.source_artifact_id IS NOT NULL AND NOT object_is_active_internal('ARTIFACT',d.source_artifact_id,array_append(visited,target_kind||':'||target_id::text)))
 AND NOT EXISTS(SELECT 1 FROM adjustment_task_dependencies dep JOIN conversation_tasks src ON src.id=dep.source_task_id
  JOIN conversations c ON c.id=src.conversation_id JOIN workspaces w ON w.id=c.workspace_id
  JOIN conversation_tasks dst ON dst.id=dep.task_id
  WHERE target_kind='TASK' AND dep.task_id=target_id AND
   (src.tenant_id<>dst.tenant_id OR c.owner_id<>dst.requested_by OR
    NOT ((w.kind='PERSONAL' AND w.owner_id=dst.requested_by) OR (w.kind='SHARED' AND EXISTS(SELECT 1 FROM workspace_members g WHERE g.workspace_id=w.id AND g.account_id=dst.requested_by))) OR
    NOT object_is_active_internal('TASK',src.id,array_append(visited,target_kind||':'||target_id::text))))
 AND NOT EXISTS(SELECT 1 FROM task_context_reads r WHERE target_kind='TASK' AND r.task_id=target_id
  AND ((r.kind='HISTORY' AND r.reference_id<>target_id AND NOT object_is_active_internal('TASK',r.reference_id,array_append(visited,target_kind||':'||target_id::text)))
    OR (r.kind='EXPERIENCE' AND NOT EXISTS(SELECT 1 FROM experience_versions ev WHERE ev.entry_id=r.reference_id AND ev.id::text=r.version_key AND object_is_active_internal('EXPERIENCE_VERSION',ev.id,array_append(visited,target_kind||':'||target_id::text)))))) END;
$$;

CREATE OR REPLACE FUNCTION scrub_lifecycle_object_internal(target_kind text,target uuid,visited text[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE child uuid; ref uuid; n integer; at timestamptz; cache record; bytes_removed bigint;
BEGIN
 IF (target_kind||':'||target::text)=ANY(visited) THEN RETURN; END IF;
 visited:=array_append(visited,target_kind||':'||target::text);
 INSERT INTO object_lifecycle(kind,object_id,tenant_id,workspace_id,owner_id,parent_kind,parent_id,original_anchor)
 SELECT kind,object_id,tenant_id,workspace_id,owner_id,parent_kind,parent_id,original_anchor FROM lifecycle_object_sources
 WHERE kind=target_kind AND object_id=target ON CONFLICT(kind,object_id) DO NOTHING;
 IF target_kind='EXPERIENCE_VERSION' THEN
  UPDATE experience_versions SET scrubbed=true,content='{}'::jsonb,search_terms='{}',tags='{}' WHERE id=target;
  UPDATE experience_entries SET status='WITHDRAWN',published_version=NULL,revision=revision+1,updated_at=now() WHERE published_version=target;
  UPDATE experience_uses SET conditions='',adjustments='',context_key='purged:'||id::text WHERE version_id=target;
  UPDATE experience_feedback SET note='' WHERE use_id IN(SELECT id FROM experience_uses WHERE version_id=target);
  UPDATE task_context_reviews SET conditions='',adjustments='',scrubbed=true WHERE version_id=target;
  FOR child IN SELECT DISTINCT task_id FROM task_context_reads WHERE kind='EXPERIENCE' AND version_key=target::text LOOP PERFORM scrub_lifecycle_object_internal('TASK',child,visited);END LOOP;
 ELSIF target_kind='FEEDBACK_VERSION' THEN
  SELECT feedback_id,revision INTO ref,n FROM feedback_versions WHERE id=target;
  UPDATE feedback_versions SET assessment='{}'::jsonb WHERE id=target;
  -- Expiry of an older revision cannot erase a newer submitted revision.
  FOR child IN SELECT v.id FROM evaluation_asset_versions v WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(v.evidence->'items') e WHERE e->>'kind'='FEEDBACK' AND e->>'id'=ref::text AND (e->>'revision')::integer=n) LOOP
   PERFORM scrub_lifecycle_evaluation_version(child);
  END LOOP;
  FOR child IN SELECT (receipt->>'targetVersion')::uuid FROM feedback_actions a WHERE feedback_id=ref AND feedback_revision=n AND kind='EXPERIENCE_CANDIDATE'
   AND NOT EXISTS(SELECT 1 FROM experience_events e WHERE e.version_id=(a.receipt->>'targetVersion')::uuid AND e.action='PUBLISHED') LOOP
   PERFORM scrub_lifecycle_object_internal('EXPERIENCE_VERSION',child,visited);
  END LOOP;
  -- PREFERENCE actions store independently confirmed presentation enums; retain their profile entries.
 ELSIF target_kind='EVALUATION_VERSION' THEN
  PERFORM scrub_lifecycle_evaluation_version(target);
 ELSIF target_kind='EVALUATION_RUN' THEN
  UPDATE evaluation_findings SET note='' WHERE run_id=target;
  UPDATE evaluation_issues SET scrubbed=true,title='内容已清理',impact='',next_action='' WHERE evaluation_id=target;
  UPDATE evaluation_issue_events SET note='' WHERE issue_id IN(SELECT id FROM evaluation_issues WHERE evaluation_id=target);
 ELSIF target_kind='ARTIFACT' THEN
  UPDATE conversation_artifacts SET content=''::bytea,filename='removed',sha256='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' WHERE id=target;
  FOR child IN SELECT id FROM private_documents WHERE source_artifact_id=target LOOP PERFORM scrub_lifecycle_object_internal('DOCUMENT',child,visited);END LOOP;
 ELSIF target_kind='EXPORT_CACHE' THEN
  SELECT * INTO cache FROM object_lifecycle WHERE kind=target_kind AND object_id=target;
  DELETE FROM private_document_exports WHERE document_id=cache.parent_id AND version=(cache.details->>'version')::integer AND format=cache.details->>'format' AND created_at=cache.original_anchor;
 ELSIF target_kind='DOCUMENT' THEN
  UPDATE private_document_versions SET title='内容已清理',body='' WHERE document_id=target;
  DELETE FROM private_document_exports WHERE document_id=target;
  UPDATE object_lifecycle SET state='PURGED',revision=revision+1,completed_at=coalesce(completed_at,now()),error_code=NULL WHERE kind='EXPORT_CACHE' AND parent_id=target AND state<>'PURGED';
  -- Only private export packages depend on this private document; enterprise publication copies are independent.
  FOR child IN SELECT DISTINCT b.id FROM export_batches b JOIN export_batch_items i ON i.batch_id=b.id WHERE b.scope='PRIVATE' AND i.object_id=target LOOP
   SELECT coalesce(sum(octet_length(content)),0) INTO bytes_removed FROM export_archive_chunks WHERE batch_id=child;
   DELETE FROM export_archive_chunks WHERE batch_id=child;
   UPDATE export_batch_items SET title=NULL,archive_path=NULL,sha256=NULL WHERE batch_id=child;
   UPDATE export_batches SET state='REVOKED',revision=revision+1,lease_token=NULL,lease_until=NULL,cleanup_state='COMPLETE',cleanup_reason='SOURCE_PURGED',cleaned_at=coalesce(cleaned_at,now()),removed_bytes=removed_bytes+bytes_removed WHERE id=child;
  END LOOP;
 ELSIF target_kind='TASK' THEN
  FOR child IN SELECT task_id FROM adjustment_task_dependencies WHERE source_task_id=target LOOP PERFORM scrub_lifecycle_object_internal('TASK',child,visited);END LOOP;
  UPDATE feedback_adjustment_messages SET request_text='',snapshot='{}'::jsonb,scrubbed=true WHERE task_id=target;
  PERFORM scrub_evaluation_task(target);
  FOR child IN SELECT DISTINCT task_id FROM task_context_reads WHERE kind='HISTORY' AND reference_id=target AND task_id<>target LOOP PERFORM scrub_lifecycle_object_internal('TASK',child,visited);END LOOP;
  FOR child IN SELECT v.id FROM experience_versions v WHERE v.access_mode='SOURCE_BOUND' AND EXISTS(SELECT 1 FROM experience_evidence e WHERE e.version_id=v.id AND e.task_id=target) LOOP PERFORM scrub_lifecycle_object_internal('EXPERIENCE_VERSION',child,visited);END LOOP;
  FOR child IN SELECT v.id FROM feedback_versions v JOIN feedback_entries f ON f.id=v.feedback_id WHERE f.task_id=target LOOP PERFORM scrub_lifecycle_object_internal('FEEDBACK_VERSION',child,visited);END LOOP;
  UPDATE feedback_entries SET scrubbed=true WHERE task_id=target;
  UPDATE experience_uses SET conditions='',adjustments='',context_key='purged:'||id::text WHERE task_id=target;
  UPDATE experience_feedback SET note='' WHERE use_id IN(SELECT id FROM experience_uses WHERE task_id=target);
  UPDATE task_context_reviews SET conditions='',adjustments='',scrubbed=true WHERE task_id=target;
  UPDATE conversation_tasks SET prompt='内容已按对象生命周期清理',supplemental_input='',public_query=NULL,reply=NULL,required_input=NULL,web_sources='[]',skills='[]',tool_receipts='[]',lease_token=NULL,lease_until=NULL,error_code='OBJECT_REMOVED',status=CASE WHEN status IN('QUEUED','RUNNING','PAUSED','WAITING_INPUT','WAITING_CAPABILITY') THEN 'CANCELLED' ELSE status END,revision=revision+1 WHERE id=target;
  UPDATE conversation_attempts SET input='内容已按对象生命周期清理',snapshot='{}'::jsonb WHERE task_id=target;
  UPDATE agent_attempt_usage SET status='INTERRUPTED',finished_at=coalesce(finished_at,now()) WHERE task_id=target AND status='RUNNING';
  FOR child IN SELECT id FROM conversation_artifacts WHERE task_id=target LOOP PERFORM scrub_lifecycle_object_internal('ARTIFACT',child,visited);END LOOP;
  FOR child IN SELECT id FROM private_documents WHERE source_task_id=target LOOP PERFORM scrub_lifecycle_object_internal('DOCUMENT',child,visited);END LOOP;
  -- A conversation title can contain the original private task prompt.
  UPDATE conversations SET title='会话内容已部分清理' WHERE id=(SELECT conversation_id FROM conversation_tasks WHERE id=target);
 ELSE RAISE EXCEPTION 'unsupported object lifecycle kind';
 END IF;
 UPDATE object_lifecycle SET state='PURGED',revision=revision+1,completed_at=coalesce(completed_at,now()),changed_at=now(),error_code=NULL WHERE kind=target_kind AND object_id=target AND state<>'PURGED';
END $$;

-- Explicit material cleanup adapter; callers retain the current tenant/lifecycle transaction.
CREATE FUNCTION scrub_adjustment_material(material_key uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE child uuid;
BEGIN
 FOR child IN SELECT DISTINCT s.task_id FROM feedback_task_sources s JOIN material_versions v ON v.id=s.version_id
  WHERE v.material_id=material_key AND EXISTS(SELECT 1 FROM feedback_adjustment_messages m WHERE m.task_id=s.task_id)
 LOOP PERFORM scrub_lifecycle_object('TASK',child); END LOOP;
END $$;
