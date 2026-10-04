package com.dreamcore.workspace.departure;

import com.dreamcore.workspace.retention.RetentionClock;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Deadline-only cleanup of business text outside the file and object lifecycle executors.
 * The departure guard, original deadlines, identity/audit/usage facts and request keys remain.
 * Each pass is bounded; only a later pass with no remaining changes reports completion. */
@Service
public class DepartureResidualCleanup {
 private static final String REMOVED="内容已按退出期限清理";
 private final JdbcTemplate db; private final RetentionClock clock;
 public DepartureResidualCleanup(JdbcTemplate db,RetentionClock clock){this.db=db;this.clock=clock;}
 private int update(String table,String assignments,String condition,UUID tenant,UUID account){
  return db.update("UPDATE "+table+" SET "+assignments+" WHERE ctid IN (SELECT x.ctid FROM "+table+" x WHERE "+condition+" LIMIT 100)",tenant,account,account);
 }
 private String privateScope(String alias,String owner){return alias+".tenant_id=? AND (?::uuid IS NULL OR "+alias+"."+owner+"=?)";}
 private String workspaceScope(String alias){return alias+".tenant_id=? AND (?::uuid IS NULL OR EXISTS(SELECT 1 FROM workspaces w WHERE w.id="+alias+".workspace_id AND w.tenant_id="+alias+".tenant_id AND w.kind='PERSONAL' AND w.owner_id=?))";}
 @Transactional public boolean clean(UUID tenant,UUID account){
  db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",tenant);
  if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM departure_executions WHERE tenant_id=? AND target_account_id IS NOT DISTINCT FROM ?::uuid AND state IN('CLEANING','COMPLETE') AND stop_complete AND deadline<=?)",Boolean.class,tenant,account,java.sql.Timestamp.from(clock.now()))))return false;
  int changed=0;
  changed+=db.queryForObject("SELECT scrub_task_work_scope(?,?)",Integer.class,tenant,account);
  changed+=db.queryForObject("SELECT scrub_forwarding_scope(?,?)",Integer.class,tenant,account);
  String profiles="EXISTS(SELECT 1 FROM profile_entries e WHERE e.id=x.entry_id AND e.tenant_id=? AND (?::uuid IS NULL OR coalesce(e.account_id,(SELECT w.owner_id FROM workspaces w WHERE w.id=e.workspace_id AND w.tenant_id=e.tenant_id AND w.kind='PERSONAL'))=?))";
  changed+=update("profile_versions","value='',provenance='',status='WITHDRAWN'",profiles+" AND (x.value<>'' OR x.provenance<>'' OR x.status<>'WITHDRAWN')",tenant,account);
  changed+=update("profile_entries","entry_key='removed-'||id::text", "x.tenant_id=? AND (?::uuid IS NULL OR coalesce(x.account_id,(SELECT w.owner_id FROM workspaces w WHERE w.id=x.workspace_id AND w.tenant_id=x.tenant_id AND w.kind='PERSONAL'))=?) AND x.entry_key<>'removed-'||x.id::text",tenant,account);
  changed+=update("ongoing_plans","goal='"+REMOVED+"',purpose='',query='',status='STOPPED',runtime_state='IDLE',notify=false,retry_requested=false,next_due=NULL",privateScope("x","owner_id")+" AND (x.goal<>'"+REMOVED+"' OR x.purpose<>'' OR x.query<>'' OR x.status<>'STOPPED' OR x.notify OR x.retry_requested OR x.next_due IS NOT NULL)",tenant,account);
  String plans="EXISTS(SELECT 1 FROM ongoing_plans p WHERE p.id=x.plan_id AND p.tenant_id=? AND (?::uuid IS NULL OR p.owner_id=?))";
  changed+=update("ongoing_plan_versions","configuration=configuration||jsonb_build_object('goal','"+REMOVED+"','purpose','','query','')",plans+" AND (x.configuration->>'goal' IS DISTINCT FROM '"+REMOVED+"' OR x.configuration->>'purpose' IS DISTINCT FROM '' OR x.configuration->>'query' IS DISTINCT FROM '')",tenant,account);
  changed+=update("ongoing_plan_receipts","receipt=jsonb_set(receipt,'{configuration}',coalesce(receipt->'configuration','{}'::jsonb)||jsonb_build_object('goal','"+REMOVED+"','purpose','','query',''))","EXISTS(SELECT 1 FROM identity_requests r JOIN ongoing_plans p ON p.id=r.target_id WHERE r.actor_id=x.actor_id AND r.request_id=x.request_id AND p.tenant_id=? AND (?::uuid IS NULL OR p.owner_id=?)) AND (x.receipt#>>'{configuration,goal}' IS DISTINCT FROM '"+REMOVED+"' OR x.receipt#>>'{configuration,purpose}' IS DISTINCT FROM '' OR x.receipt#>>'{configuration,query}' IS DISTINCT FROM '')",tenant,account);
  changed+=update("business_sources","name='"+REMOVED+"',description='',status='PAUSED'",workspaceScope("x")+" AND (x.name<>'"+REMOVED+"' OR x.description<>'' OR x.status<>'PAUSED')",tenant,account);
  changed+=update("business_source_config_versions","settings=settings||jsonb_build_object('name','"+REMOVED+"','description','')","EXISTS(SELECT 1 FROM business_sources b WHERE b.id=x.source_id AND "+workspaceScope("b")+") AND (x.settings->>'name' IS DISTINCT FROM '"+REMOVED+"' OR x.settings->>'description' IS DISTINCT FROM '')",tenant,account);
  changed+=update("business_source_submissions","note=''",workspaceScope("x")+" AND x.note<>''",tenant,account);
  // Collected datasets belong to shared enterprise spaces, never to an offboarding member.
  if(account==null){
   changed+=db.update("UPDATE dataset_snapshots SET data_rows='[]'::jsonb,scrubbed=true WHERE id IN (SELECT id FROM dataset_snapshots WHERE tenant_id=? AND NOT scrubbed ORDER BY id LIMIT 100)",tenant);
   changed+=db.update("UPDATE business_datasets d SET name=?,description='',dataset_key='removed-'||d.id::text,column_names='[\"已清理\"]'::jsonb,status='WITHDRAWN',scrubbed=true WHERE d.id IN (SELECT x.id FROM business_datasets x WHERE x.tenant_id=? AND NOT x.scrubbed AND NOT EXISTS(SELECT 1 FROM dataset_snapshots s WHERE s.dataset_id=x.id AND NOT s.scrubbed) ORDER BY x.id LIMIT 100)",REMOVED,tenant);
   changed+=db.update("UPDATE data_connections c SET name=?,route_label='',access_summary='',status='UNCONFIGURED',auto_enabled=false,next_due=NULL,revision=revision+1 WHERE c.id IN (SELECT x.id FROM data_connections x WHERE x.tenant_id=? AND (x.name<>? OR x.route_label<>'' OR x.access_summary<>'' OR x.status<>'UNCONFIGURED' OR x.auto_enabled OR x.next_due IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM business_datasets d WHERE d.connection_id=x.id AND NOT d.scrubbed) ORDER BY x.id LIMIT 100)",REMOVED,tenant,REMOVED);
  }
  changed+=update("conversations","title='"+REMOVED+"'",privateScope("x","owner_id")+" AND x.title<>'"+REMOVED+"'",tenant,account);
  changed+=update("conversation_tasks","public_query=NULL",privateScope("x","requested_by")+" AND x.public_query IS NOT NULL",tenant,account);
  changed+=update("knowledge_runs","warnings=''",workspaceScope("x")+" AND x.warnings<>''",tenant,account);
  changed+=update("document_publications","filename='removed'",workspaceScope("x")+" AND x.filename<>'removed'",tenant,account);
  changed+=update("recommendation_presentations","presentation='{}'::jsonb",privateScope("x","actor_id")+" AND x.presentation<>'{}'::jsonb",tenant,account);
  changed+=update("recommendation_settings","enabled=false",privateScope("x","actor_id")+" AND x.enabled",tenant,account);
  // Keep the settings receipt shape and revision for idempotency; remove the old preference value.
  changed+=update("recommendation_receipts","receipt=jsonb_set(receipt,'{enabled}','false'::jsonb)","EXISTS(SELECT 1 FROM identity_requests r WHERE r.actor_id=x.actor_id AND r.request_id=x.request_id AND r.target_id=? AND (?::uuid IS NULL OR r.actor_id=?)) AND x.receipt->>'enabled'='true'",tenant,account);
  changed+=update("evaluation_issues","title='内容已清理',impact='',next_action='',scrubbed=true",workspaceScope("x")+" AND (NOT x.scrubbed OR x.title<>'内容已清理' OR x.impact<>'' OR x.next_action<>'')",tenant,account);
  changed+=update("evaluation_issue_events","note=''","EXISTS(SELECT 1 FROM evaluation_issues i WHERE i.id=x.issue_id AND "+workspaceScope("i")+") AND x.note<>''",tenant,account);
  // Owner-private temporary batches are disposable even when the exported source was shared.
  var batches=db.queryForList("SELECT id FROM export_batches x WHERE "+privateScope("x","owner_id")+" AND (x.cleanup_state<>'COMPLETE' OR EXISTS(SELECT 1 FROM export_archive_chunks c WHERE c.batch_id=x.id) OR EXISTS(SELECT 1 FROM export_batch_items i WHERE i.batch_id=x.id AND (i.title IS NOT NULL OR i.archive_path IS NOT NULL OR i.sha256 IS NOT NULL))) ORDER BY x.id LIMIT 5 FOR UPDATE",UUID.class,tenant,account,account);
  for(UUID id:batches){long bytes=db.queryForObject("SELECT coalesce(sum(octet_length(content)),0) FROM export_archive_chunks WHERE batch_id=?",Long.class,id);db.update("DELETE FROM export_archive_chunks WHERE batch_id=?",id);db.update("UPDATE export_batch_items SET title=NULL,archive_path=NULL,sha256=NULL WHERE batch_id=?",id);db.update("UPDATE export_batches SET state='REVOKED',revision=revision+1,lease_token=NULL,lease_until=NULL,cleanup_state='COMPLETE',cleanup_reason='DEPARTURE',cleaned_at=coalesce(cleaned_at,now()),removed_bytes=removed_bytes+? WHERE id=?",bytes,id);changed++;}
  return changed==0;
 }
}
