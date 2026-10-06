package com.dreamcore.workspace.identity;

import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Fixed operational vocabulary only: never return task, file, person or business identifiers. */
@Service
public class EngineTelemetryService {
 public record Channel(String code,long running,long queued,long waiting,long failed,long unknown,long completedRecent,Instant lastCompletedAt) {}
 public record Snapshot(UUID tenantId,Instant checkedAt,int recentSeconds,String evolution,List<Channel> channels) {}
 public record TenantRunning(UUID tenantId,String tenantName,long running) {}
 public record TenantDistribution(Instant checkedAt,List<TenantRunning> tenants,long otherTenants,long otherRunning) {}
 public static final int TENANT_LIMIT=10;
 // Same record classification as the snapshot; general adjustment has no tenant and stays out of the distribution.
 private static final String UNITS="""
    SELECT 'COLLECTION' code,tenant_id,status state,finished_at done FROM collection_runs
    UNION ALL SELECT 'KNOWLEDGE',tenant_id,CASE status WHEN 'READY' THEN 'SUCCEEDED' WHEN 'PARTIAL' THEN 'PARTIAL' WHEN 'UNSUPPORTED' THEN 'FAILED' ELSE status END,finished_at FROM knowledge_runs
    UNION ALL SELECT CASE WHEN mode='SOURCE_LOOKUP' THEN 'RETRIEVAL' WHEN status='RUNNING' AND EXISTS(
      SELECT 1 FROM conversation_live_output o WHERE o.task_id=t.id AND o.attempt_number=t.attempt AND o.state='STREAMING') THEN 'RESPONSE' ELSE 'TASK' END,
      tenant_id,status,finished_at FROM conversation_tasks t
    UNION ALL SELECT 'EXPORT',tenant_id,CASE state WHEN 'GENERATING' THEN 'RUNNING' WHEN 'READY' THEN 'SUCCEEDED' ELSE state END,generated_at FROM export_batches
    UNION ALL SELECT 'COMPANY',tenant_id,CASE state WHEN 'CLAIMED' THEN 'RUNNING' WHEN 'DISPATCHED' THEN 'RUNNING' WHEN 'RETURNED' THEN 'SUCCEEDED' ELSE state END,finished_at FROM company_analysis_attempts
    UNION ALL SELECT 'EXPERIENCE',i.tenant_id,CASE WHEN a.outcome IN('CREATED','UPDATED','DUPLICATE') THEN 'SUCCEEDED' WHEN a.outcome='CONFLICT' THEN 'FAILED' WHEN a.outcome='SOURCE_UNAVAILABLE' THEN 'CANCELLED' ELSE CASE i.state WHEN 'RETRY_WAIT' THEN 'WAITING_CAPABILITY' WHEN 'QUALIFIED' THEN 'WAITING_CAPABILITY' WHEN 'REJECTED' THEN 'CANCELLED' ELSE i.state END END,coalesce(a.created_at,i.updated_at) FROM experience_analysis_items i LEFT JOIN experience_admissions a ON a.run_id=i.run_id
    UNION ALL SELECT 'GENERALIZATION',tenant_id,CASE state WHEN 'RETRY_WAIT' THEN 'WAITING_CAPABILITY' WHEN 'ADMITTED' THEN 'SUCCEEDED' WHEN 'DUPLICATE' THEN 'SUCCEEDED' WHEN 'QUALIFIED' THEN 'WAITING_CAPABILITY' WHEN 'REJECTED' THEN 'CANCELLED' WHEN 'CONFLICT' THEN 'WAITING_CAPABILITY' ELSE state END,updated_at FROM experience_generalization_sources
    UNION ALL SELECT 'GENERAL_ADJUSTMENT',NULL::uuid,CASE state WHEN 'RETRY_WAIT' THEN 'WAITING_CAPABILITY' WHEN 'UNCERTAIN' THEN 'RESULT_UNKNOWN' WHEN 'PUBLISHING' THEN 'RUNNING' WHEN 'ADMITTED' THEN 'SUCCEEDED' WHEN 'REJECTED' THEN 'CANCELLED' WHEN 'CONFLICT' THEN 'WAITING_CAPABILITY' ELSE state END,updated_at FROM general_experience_adjustments
 """;
 private final JdbcTemplate db; private final IdentityService identities;
 public EngineTelemetryService(JdbcTemplate db,IdentityService identities){this.db=db;this.identities=identities;}
 @Transactional public Snapshot read(UUID actor,UUID tenant,boolean platform){
  if(platform) identities.platform(actor); else identities.member(actor,tenant,true);
  db.execute("SET LOCAL statement_timeout='3s'");
  // One statement snapshot. All current active work is counted, including jobs older than the recent window.
  // A streaming task belongs to output only; no duplicate processing/output concurrency.
  var rows=db.query("""
   WITH scope AS (SELECT ?::uuid tenant), units AS (
   """+UNITS+"""
   ), codes AS (SELECT unnest(ARRAY['COLLECTION','KNOWLEDGE','RETRIEVAL','TASK','COMPANY','EXPERIENCE','GENERALIZATION','GENERAL_ADJUSTMENT','RESPONSE','EXPORT']) code), filtered AS MATERIALIZED (
    SELECT u.* FROM units u,scope s WHERE s.tenant IS NULL OR u.tenant_id=s.tenant
   ) SELECT c.code,statement_timestamp() checked_at,
     count(*) FILTER(WHERE u.state='RUNNING') running,
     count(*) FILTER(WHERE u.state='QUEUED') queued,
     count(*) FILTER(WHERE u.state IN('PAUSED','WAITING_INPUT','WAITING_CAPABILITY','PARTIAL')) waiting,
     count(*) FILTER(WHERE u.state IN('FAILED','INTERRUPTED')) failed,
     count(*) FILTER(WHERE u.state IN('UNKNOWN','RESULT_UNKNOWN')) unknown,
     count(*) FILTER(WHERE u.state='SUCCEEDED' AND u.done>=statement_timestamp()-interval '5 minutes' AND u.done<=statement_timestamp()) completed,
     max(u.done) FILTER(WHERE u.state='SUCCEEDED' AND u.done<=statement_timestamp()) last_done
   FROM codes c LEFT JOIN filtered u ON u.code=c.code GROUP BY c.code ORDER BY array_position(ARRAY['COLLECTION','KNOWLEDGE','RETRIEVAL','TASK','COMPANY','EXPERIENCE','GENERALIZATION','GENERAL_ADJUSTMENT','RESPONSE','EXPORT'],c.code)
   """,(r,n)->Map.entry(r.getTimestamp("checked_at").toInstant(),new Channel(r.getString("code"),r.getLong("running"),r.getLong("queued"),r.getLong("waiting"),r.getLong("failed"),r.getLong("unknown"),r.getLong("completed"),r.getTimestamp("last_done")==null?null:r.getTimestamp("last_done").toInstant())),tenant);
  if(platform) identities.platform(actor); else identities.member(actor,tenant,true);
  // Method engineering and experience maintenance are not an autonomous evolution executor.
  return new Snapshot(tenant,rows.getFirst().getKey(),300,"NOT_CONNECTED",rows.stream().map(Map.Entry::getValue).filter(c->tenant==null || !c.code().equals("GENERAL_ADJUSTMENT")).toList());
 }
 /** Platform only: running counts per tenant, with no channel, task, person or content detail. */
 @Transactional public TenantDistribution tenants(UUID actor){
  identities.platform(actor);
  db.execute("SET LOCAL statement_timeout='3s'");
  var checked=db.queryForObject("SELECT statement_timestamp()",java.sql.Timestamp.class).toInstant();
  var rows=db.query("WITH units AS ("+UNITS+"""
   ) SELECT t.id,t.name,count(*) running FROM units u JOIN tenants t ON t.id=u.tenant_id
   WHERE u.state='RUNNING' GROUP BY t.id,t.name ORDER BY running DESC,t.name,t.id
   """,(r,n)->new TenantRunning(r.getObject("id",UUID.class),r.getString("name"),r.getLong("running")));
  identities.platform(actor);
  var rest=rows.subList(Math.min(TENANT_LIMIT,rows.size()),rows.size());
  return new TenantDistribution(checked,List.copyOf(rows.subList(0,Math.min(TENANT_LIMIT,rows.size()))),rest.size(),rest.stream().mapToLong(TenantRunning::running).sum());
 }
}
