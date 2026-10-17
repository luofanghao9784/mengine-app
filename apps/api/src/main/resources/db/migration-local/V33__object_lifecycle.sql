-- Only newly inserted objects receive automatic retention. No legacy content backfill.
CREATE TABLE object_lifecycle (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind varchar(24) NOT NULL, object_id uuid NOT NULL,
 tenant_id uuid REFERENCES tenants(id),workspace_id uuid REFERENCES workspaces(id),owner_id uuid REFERENCES accounts(id),
 parent_kind varchar(24),parent_id uuid,original_anchor timestamptz NOT NULL,
 state varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK(state IN('ACTIVE','DISABLED','TRASHED','ISOLATED','PURGE_PENDING','PURGE_FAILED','PURGED')),
 revision integer NOT NULL DEFAULT 1,prior_state varchar(20),is_formal boolean NOT NULL DEFAULT true,
 policy_key varchar(40),policy_revision integer,policy_due timestamptz,policy_pending boolean NOT NULL DEFAULT false,
 trash_anchor timestamptz,trash_policy_revision integer,trash_due timestamptz,
 scope_execution uuid,scope_due timestamptz,details jsonb NOT NULL DEFAULT '{}',
 attempts integer NOT NULL DEFAULT 0,error_code varchar(64),completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),changed_at timestamptz NOT NULL DEFAULT now(),UNIQUE(kind,object_id)
);
CREATE INDEX object_lifecycle_due ON object_lifecycle(state,policy_due,trash_due,scope_due);
CREATE INDEX object_lifecycle_scope ON object_lifecycle(tenant_id,workspace_id,owner_id,created_at,id);
CREATE TABLE object_lifecycle_events (
 id uuid PRIMARY KEY,object_record uuid NOT NULL REFERENCES object_lifecycle(id),revision integer NOT NULL,
 action varchar(32) NOT NULL,actor_id uuid REFERENCES accounts(id),created_at timestamptz NOT NULL,
 UNIQUE(object_record,revision)
);
CREATE TABLE object_lifecycle_scopes (
 execution_id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),owner_id uuid REFERENCES accounts(id),
 effective_at timestamptz NOT NULL,deadline timestamptz NOT NULL,state varchar(16) NOT NULL CHECK(state IN('ISOLATING','ISOLATED','PURGING','COMPLETE','RESTORING','RESTORED')),
 discovery_complete boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),CHECK(deadline>=effective_at)
);
CREATE INDEX object_lifecycle_scope_fence ON object_lifecycle_scopes(tenant_id,owner_id,state);
CREATE TABLE object_lifecycle_scope_items (
 execution_id uuid NOT NULL REFERENCES object_lifecycle_scopes(execution_id),object_record uuid NOT NULL REFERENCES object_lifecycle(id),
 PRIMARY KEY(execution_id,object_record)
);
-- Metadata only: no body, title, filename, model prompt, assessment or personal preferences.
CREATE VIEW lifecycle_object_sources AS
 SELECT 'TASK'::varchar(24) kind,t.id object_id,t.tenant_id,t.workspace_id,c.owner_id,NULL::varchar(24) parent_kind,NULL::uuid parent_id,t.created_at original_anchor
 FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id
 UNION ALL SELECT 'DOCUMENT',d.id,d.tenant_id,d.workspace_id,d.owner_id,'TASK',d.source_task_id,d.created_at FROM private_documents d
 UNION ALL SELECT 'ARTIFACT',a.id,a.tenant_id,a.workspace_id,c.owner_id,'TASK',a.task_id,t.created_at FROM conversation_artifacts a JOIN conversation_tasks t ON t.id=a.task_id JOIN conversations c ON c.id=t.conversation_id
 UNION ALL SELECT 'EXPERIENCE_VERSION',v.id,e.tenant_id,e.workspace_id,CASE WHEN w.kind='PERSONAL' THEN w.owner_id END,NULL,NULL,v.created_at FROM experience_versions v JOIN experience_entries e ON e.id=v.entry_id JOIN workspaces w ON w.id=e.workspace_id
 UNION ALL SELECT 'FEEDBACK_VERSION',v.id,f.tenant_id,f.workspace_id,f.actor_id,'TASK',f.task_id,v.created_at FROM feedback_versions v JOIN feedback_entries f ON f.id=v.feedback_id
 UNION ALL SELECT 'EVALUATION_VERSION',v.id,a.tenant_id,a.workspace_id,CASE WHEN w.kind='PERSONAL' THEN w.owner_id END,NULL,NULL,v.created_at FROM evaluation_asset_versions v JOIN evaluation_assets a ON a.id=v.asset_id LEFT JOIN workspaces w ON w.id=a.workspace_id
 UNION ALL SELECT 'EVALUATION_RUN',r.id,r.tenant_id,r.workspace_id,CASE WHEN w.kind='PERSONAL' THEN w.owner_id END,NULL,NULL,r.created_at FROM evaluation_runs r LEFT JOIN workspaces w ON w.id=r.workspace_id
 UNION ALL SELECT 'EXPORT_CACHE',l.object_id,l.tenant_id,l.workspace_id,l.owner_id,l.parent_kind,l.parent_id,l.original_anchor FROM object_lifecycle l WHERE l.kind='EXPORT_CACHE';
CREATE FUNCTION object_is_active_internal(target_kind text,target_id uuid,visited text[]) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN (target_kind||':'||target_id::text)=ANY(visited) THEN false ELSE NOT EXISTS(SELECT 1 FROM object_lifecycle l WHERE l.kind=target_kind AND l.object_id=target_id AND (l.state<>'ACTIVE' OR (NOT l.is_formal AND l.policy_due<=now())))
 AND NOT EXISTS(SELECT 1 FROM lifecycle_object_sources s JOIN object_lifecycle_scopes fence ON fence.tenant_id=s.tenant_id
  AND (fence.owner_id IS NULL OR fence.owner_id=s.owner_id) WHERE s.kind=target_kind AND s.object_id=target_id AND fence.state NOT IN('RESTORED'))
 AND NOT EXISTS(SELECT 1 FROM lifecycle_object_sources s WHERE s.kind=target_kind AND s.object_id=target_id AND s.parent_id IS NOT NULL AND NOT object_is_active_internal(s.parent_kind,s.parent_id,array_append(visited,target_kind||':'||target_id::text)))
 AND NOT EXISTS(SELECT 1 FROM private_documents d WHERE target_kind='DOCUMENT' AND d.id=target_id AND d.source_artifact_id IS NOT NULL AND NOT object_is_active_internal('ARTIFACT',d.source_artifact_id,array_append(visited,target_kind||':'||target_id::text)))
 AND NOT EXISTS(SELECT 1 FROM task_context_reads r WHERE target_kind='TASK' AND r.task_id=target_id
  AND ((r.kind='HISTORY' AND r.reference_id<>target_id AND NOT object_is_active_internal('TASK',r.reference_id,array_append(visited,target_kind||':'||target_id::text)))
    OR (r.kind='EXPERIENCE' AND NOT EXISTS(SELECT 1 FROM experience_versions ev WHERE ev.entry_id=r.reference_id AND ev.id::text=r.version_key AND object_is_active_internal('EXPERIENCE_VERSION',ev.id,array_append(visited,target_kind||':'||target_id::text)))))) END;
$$;
CREATE FUNCTION object_is_active(target_kind text,target_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT object_is_active_internal(target_kind,target_id,ARRAY[]::text[]); $$;
CREATE FUNCTION register_lifecycle_object() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text:=TG_ARGV[0]; p text:=NULL; s record;
BEGIN
 IF k='EXPORT_CACHE' THEN
  INSERT INTO object_lifecycle(kind,object_id,tenant_id,workspace_id,owner_id,parent_kind,parent_id,original_anchor,is_formal,policy_key,policy_pending,details)
  SELECT k,gen_random_uuid(),d.tenant_id,d.workspace_id,d.owner_id,'DOCUMENT',d.id,NEW.created_at,false,'EXPORT_PACKAGE',true,
   jsonb_build_object('version',NEW.version,'format',NEW.format) FROM private_documents d WHERE d.id=NEW.document_id;
 ELSE
  SELECT * INTO s FROM lifecycle_object_sources WHERE kind=k AND object_id=NEW.id;
  IF k='EXPERIENCE_VERSION' THEN p:='EXPERIENCE_CANDIDATE'; END IF;
  IF k='FEEDBACK_VERSION' THEN p:='RAW_FEEDBACK'; END IF;
  INSERT INTO object_lifecycle(kind,object_id,tenant_id,workspace_id,owner_id,parent_kind,parent_id,original_anchor,is_formal,policy_key,policy_pending)
   VALUES(k,s.object_id,s.tenant_id,s.workspace_id,s.owner_id,s.parent_kind,s.parent_id,s.original_anchor,p IS NULL,p,p IS NOT NULL);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lifecycle_new_task AFTER INSERT ON conversation_tasks FOR EACH ROW EXECUTE FUNCTION register_lifecycle_object('TASK');
CREATE TRIGGER lifecycle_new_document AFTER INSERT ON private_documents FOR EACH ROW EXECUTE FUNCTION register_lifecycle_object('DOCUMENT');
CREATE TRIGGER lifecycle_new_artifact AFTER INSERT ON conversation_artifacts FOR EACH ROW EXECUTE FUNCTION register_lifecycle_object('ARTIFACT');
CREATE TRIGGER lifecycle_new_experience AFTER INSERT ON experience_versions FOR EACH ROW EXECUTE FUNCTION register_lifecycle_object('EXPERIENCE_VERSION');
CREATE TRIGGER lifecycle_new_feedback AFTER INSERT ON feedback_versions FOR EACH ROW EXECUTE FUNCTION register_lifecycle_object('FEEDBACK_VERSION');
CREATE TRIGGER lifecycle_new_evaluation_version AFTER INSERT ON evaluation_asset_versions FOR EACH ROW EXECUTE FUNCTION register_lifecycle_object('EVALUATION_VERSION');
CREATE TRIGGER lifecycle_new_evaluation_run AFTER INSERT ON evaluation_runs FOR EACH ROW EXECUTE FUNCTION register_lifecycle_object('EVALUATION_RUN');
CREATE TRIGGER lifecycle_new_export_cache AFTER INSERT ON private_document_exports FOR EACH ROW EXECUTE FUNCTION register_lifecycle_object('EXPORT_CACHE');
CREATE FUNCTION lifecycle_experience_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.published_version IS NOT NULL THEN
  IF NOT object_is_active('EXPERIENCE_VERSION',NEW.published_version) THEN RAISE EXCEPTION 'experience version lifecycle unavailable'; END IF;
  UPDATE object_lifecycle SET is_formal=true,policy_pending=false WHERE kind='EXPERIENCE_VERSION' AND object_id=NEW.published_version;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lifecycle_published_experience BEFORE UPDATE OF published_version ON experience_entries FOR EACH ROW EXECUTE FUNCTION lifecycle_experience_publication();
-- Preserve V31's full source authorization, adding the independent object fence.
CREATE OR REPLACE VIEW readable_source_tasks AS
 SELECT t.id FROM conversation_tasks t WHERE object_is_active('TASK',t.id) AND NOT EXISTS (
 SELECT 1 FROM (
  SELECT s.task_id,c.version_id FROM conversation_sources s JOIN knowledge_chunks c ON c.id=s.chunk_id
  UNION SELECT task_id,version_id FROM conversation_originals
  UNION SELECT g.task_id,c.version_id FROM conversation_agent_grants g JOIN knowledge_chunks c ON c.id=g.chunk_id
  UNION SELECT task_id,version_id FROM feedback_task_sources
  UNION SELECT task_id,version_id FROM task_context_materials
 ) dependency JOIN material_versions v ON v.id=dependency.version_id
 WHERE dependency.task_id=t.id AND NOT EXISTS (
  SELECT 1 FROM active_materials m JOIN workspaces w ON w.tenant_id=m.tenant_id AND w.id=m.workspace_id
  WHERE m.id=v.material_id AND m.tenant_id=t.tenant_id AND
   ((w.kind='PERSONAL' AND w.owner_id=t.requested_by) OR (w.kind='SHARED' AND EXISTS (
    SELECT 1 FROM workspace_members g WHERE g.tenant_id=w.tenant_id AND g.workspace_id=w.id AND g.account_id=t.requested_by)))
 )
);
CREATE OR REPLACE VIEW readable_feedback AS SELECT f.id FROM feedback_entries f
 JOIN feedback_versions current_version ON current_version.feedback_id=f.id AND current_version.revision=f.revision
 WHERE NOT f.scrubbed AND object_is_active('FEEDBACK_VERSION',current_version.id)
 AND NOT EXISTS(SELECT 1 FROM feedback_source_versions s JOIN material_versions v ON v.id=s.version_id WHERE s.feedback_id=f.id
 AND NOT EXISTS(SELECT 1 FROM active_materials m WHERE m.id=v.material_id));
-- Shared erasure primitives used by online workers and authoritative backup restoration.
-- They retain object IDs, FK provenance, outcomes, denominators and idempotency facts.
CREATE FUNCTION scrub_lifecycle_evaluation_version(target uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE evaluation_asset_versions SET scrubbed=true,content='{}'::jsonb WHERE id=target;
 UPDATE evaluation_findings f SET note='' WHERE f.sample_version=target OR EXISTS(SELECT 1 FROM evaluation_runs r WHERE r.id=f.run_id AND r.standard_version=target);
 UPDATE evaluation_issues i SET scrubbed=true,title='内容已清理',impact='',next_action=''
 WHERE sample_version=target OR EXISTS(SELECT 1 FROM evaluation_runs r WHERE r.id=i.evaluation_id AND r.standard_version=target)
 OR EXISTS(SELECT 1 FROM evaluation_run_samples r WHERE r.run_id=i.evaluation_id AND r.version_id=target);
 UPDATE evaluation_issue_events e SET note='' WHERE EXISTS(SELECT 1 FROM evaluation_issues i WHERE i.id=e.issue_id AND i.scrubbed);
END $$;
CREATE FUNCTION scrub_lifecycle_object_internal(target_kind text,target uuid,visited text[]) RETURNS void LANGUAGE plpgsql AS $$
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

CREATE FUNCTION scrub_lifecycle_object(target_kind text,target uuid) RETURNS void LANGUAGE sql AS $$ SELECT scrub_lifecycle_object_internal(target_kind,target,ARRAY[]::text[]); $$;
