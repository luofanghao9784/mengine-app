package com.dreamcore.workspace.identity;

import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Read-only, privacy-limited metering facts. No prices or quota policies are inferred from execution limits. */
@Service
public class UsageService {
 public record ModelGroup(String purpose,String executionClass,String basis,long units,long reportedUnits,long unknownCallUnits,long pendingUnits,Long modelCalls,Long inputTokens,Long outputTokens) {}
 public record Day(String date,long workRequests,Long maintenanceCalls,long unknownMaintenanceRuns,Long inputTokens,Long outputTokens) {}
 public record ToolGroup(String executionClass,long starts,long succeeded,long failed,long pending,long timed,Long elapsedMillis) {}
 public record Storage(long originals,long versions,long registeredBytes) {}
 public record Coverage(long unmeteredWorkAttempts,long legacyToolReceipts,String evaluation,String evolution) {}
 public record Quota(String state,String unit,Long limit,Long remaining) {}
 public record Overview(UUID tenantId,String period,String timeZone,Instant from,Instant until,Instant checkedAt,List<ModelGroup> groups,List<Day> days,List<ToolGroup> tools,Storage storage,Coverage coverage,Quota quota) {}
 public record Cost(String state,String currency,Long verifiedMinor,Long estimatedMinor,String sharedAllocation) {}
 public record Platform(Overview usage,Cost cost) {}
 public record Window(String period,String zone,Instant from,Instant end) {}
 private final JdbcTemplate db;private final IdentityService identities;private final ZoneId zone;private final JsonMapper json=new JsonMapper();
 public UsageService(JdbcTemplate db,IdentityService identities,@Value("${dreamcore.operations.time-zone:Asia/Shanghai}") String zone){this.db=db;this.identities=identities;this.zone=ZoneId.of(zone);}
 public static Window window(String period,Instant end,ZoneId zone){
  ZonedDateTime current=end.atZone(zone);LocalDate from=switch(period){case "THIS_MONTH"->current.toLocalDate().withDayOfMonth(1);case "LAST_MONTH"->current.toLocalDate().withDayOfMonth(1).minusMonths(1);case "LAST_30_DAYS"->current.toLocalDate().minusDays(29);default->throw IdentityException.invalid();};
  Instant until=period.equals("LAST_MONTH")?current.toLocalDate().withDayOfMonth(1).atStartOfDay(zone).toInstant():end;
  return new Window(period,zone.getId(),from.atStartOfDay(zone).toInstant(),until);
 }
 @Transactional public Platform platform(UUID actor,UUID tenant,String period){
  identities.platform(actor);if(tenant!=null&&db.queryForList("SELECT id FROM tenants WHERE id=? FOR SHARE",tenant).isEmpty())throw new IdentityException(404,"TENANT_NOT_FOUND");
  var usage=project(tenant,period);identities.platform(actor);return new Platform(usage,new Cost("NOT_CONNECTED",null,null,null,"NOT_CONFIGURED"));
 }
 @Transactional public Overview tenant(UUID actor,UUID tenant,String period){identities.member(actor,tenant,true);var result=project(tenant,period);identities.member(actor,tenant,true);return result;}
 private Overview project(UUID tenant,String period){
  Instant checked=Instant.now();Window w=window(period,checked,zone);db.execute("SET LOCAL statement_timeout='3s'");
  // A single statement/snapshot for every panel. Work is request-start based; maintenance uses run-start cohorts.
  return db.queryForObject("""
   WITH bounds AS (SELECT ?::timestamptz start_at,?::timestamptz end_at,?::uuid tenant,?::text zone),
   work AS MATERIALIZED (
    SELECT a.tenant_id,a.execution_class,r.started_at,r.outcome,1::bigint calls,r.input_tokens,r.output_tokens
    FROM agent_model_requests r JOIN agent_attempt_usage a USING(task_id,attempt_id) CROSS JOIN bounds b
    WHERE r.started_at>=b.start_at AND r.started_at<b.end_at AND (b.tenant IS NULL OR a.tenant_id=b.tenant)
   ), maintenance_raw AS (
    SELECT tenant_id,execution_class,created_at,state,stages FROM experience_analysis_runs
    UNION ALL SELECT tenant_id,execution_class,created_at,state,stages FROM experience_generalization_runs
    UNION ALL SELECT NULL::uuid,execution_class,created_at,state,stages FROM general_experience_adjustment_runs
   ), maintenance AS MATERIALIZED (
    SELECT m.tenant_id,m.execution_class,m.created_at started_at,m.state,
      totals.calls,totals.input_tokens,totals.output_tokens,totals.complete
    FROM maintenance_raw m CROSS JOIN bounds b LEFT JOIN LATERAL (
     SELECT sum((s->>'modelCalls')::bigint)::bigint calls,sum((s->>'inputTokens')::bigint)::bigint input_tokens,sum((s->>'outputTokens')::bigint)::bigint output_tokens,
      count(*)>0 AND count(*)=count(s->>'inputTokens') complete FROM jsonb_array_elements(m.stages) s
    ) totals ON true WHERE m.created_at>=b.start_at AND m.created_at<b.end_at AND (b.tenant IS NULL OR m.tenant_id=b.tenant)
    UNION ALL SELECT a.tenant_id,a.execution_class,a.created_at,a.state,a.model_calls::bigint,a.input_tokens,a.output_tokens,a.input_tokens IS NOT NULL
     FROM company_analysis_attempts a CROSS JOIN bounds b WHERE a.created_at>=b.start_at AND a.created_at<b.end_at AND (b.tenant IS NULL OR a.tenant_id=b.tenant)
   ), units AS MATERIALIZED (
    SELECT 'WORK' purpose,execution_class,'REQUEST_STARTED' basis,started_at,calls,input_tokens,output_tokens,input_tokens IS NOT NULL complete,outcome='PENDING' pending FROM work
    UNION ALL SELECT 'MAINTENANCE',coalesce(execution_class,'unknown'),'RUN_STARTED',started_at,calls,input_tokens,output_tokens,complete,state IN ('CLAIMED','DISPATCHED','UNKNOWN') FROM maintenance
   ), grouped AS (
    SELECT purpose,execution_class AS "executionClass",basis,count(*) units,count(*) FILTER(WHERE complete) AS "reportedUnits",count(*) FILTER(WHERE calls IS NULL) AS "unknownCallUnits",count(*) FILTER(WHERE pending) AS "pendingUnits",
     sum(calls) AS "modelCalls",sum(input_tokens) AS "inputTokens",sum(output_tokens) AS "outputTokens" FROM units GROUP BY purpose,execution_class,basis
   ), calendar AS (
    SELECT to_char(d,'YYYY-MM-DD') AS day_key FROM bounds b,LATERAL generate_series((b.start_at AT TIME ZONE b.zone)::date::timestamp,((b.end_at-interval '1 microsecond') AT TIME ZONE b.zone)::date::timestamp,interval '1 day') d
   ), daily AS (
    SELECT to_char(u.started_at AT TIME ZONE b.zone,'YYYY-MM-DD') AS day_key,count(*) FILTER(WHERE purpose='WORK') work,
      CASE WHEN count(*) FILTER(WHERE purpose='MAINTENANCE')=0 THEN 0 ELSE sum(calls) FILTER(WHERE purpose='MAINTENANCE') END maintenance,
      count(*) FILTER(WHERE purpose='MAINTENANCE' AND calls IS NULL) unknown,sum(input_tokens) input,sum(output_tokens) output
    FROM units u CROSS JOIN bounds b WHERE execution_class='live' GROUP BY 1
   ), days AS (
    SELECT c.day_key AS date,coalesce(d.work,0) AS "workRequests",CASE WHEN d.day_key IS NULL THEN 0 ELSE d.maintenance END AS "maintenanceCalls",coalesce(d.unknown,0) AS "unknownMaintenanceRuns",d.input AS "inputTokens",d.output AS "outputTokens"
    FROM calendar c LEFT JOIN daily d USING(day_key)
   ), tool_records AS MATERIALIZED (
    SELECT coalesce(a.execution_class,'unknown') execution_class,r.status,r.started_at,r.finished_at
    FROM conversation_tool_receipts r JOIN conversation_tasks t ON t.id=r.task_id LEFT JOIN agent_attempt_usage a ON a.task_id=r.task_id AND a.attempt_number=r.attempt_number CROSS JOIN bounds b
    WHERE r.started_at>=b.start_at AND r.started_at<b.end_at AND (b.tenant IS NULL OR t.tenant_id=b.tenant)
   ), tools AS (
    SELECT execution_class AS "executionClass",count(*) starts,count(*) FILTER(WHERE status='succeeded') succeeded,count(*) FILTER(WHERE status='failed') failed,count(*) FILTER(WHERE status='STARTED') pending,
     count(finished_at) timed,sum(floor(extract(epoch FROM (finished_at-started_at))*1000)::bigint) AS "elapsedMillis" FROM tool_records GROUP BY execution_class
   ), storage AS (
    SELECT count(DISTINCT material_id) originals,count(*) versions,coalesce(sum(size_bytes),0) bytes FROM material_versions v CROSS JOIN bounds b
    WHERE (b.tenant IS NULL OR v.tenant_id=b.tenant) AND NOT EXISTS(SELECT 1 FROM content_cleanup_blobs c WHERE c.object_id=v.object_id AND c.deleted_at IS NOT NULL)
   )
   SELECT coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY purpose,"executionClass") FROM grouped g),'[]') groups,
    coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY date) FROM days d),'[]') days,coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY "executionClass") FROM tools t),'[]') tools,storage.*,
    (SELECT count(*) FROM agent_attempt_usage a CROSS JOIN bounds b WHERE a.started_at>=b.start_at AND a.started_at<b.end_at AND NOT a.metering_enabled AND (b.tenant IS NULL OR a.tenant_id=b.tenant)) unmetered,
    (SELECT count(*) FROM conversation_tool_receipts r JOIN conversation_tasks t ON t.id=r.task_id CROSS JOIN bounds b WHERE r.started_at IS NULL AND r.received_at>=b.start_at AND r.received_at<b.end_at AND (b.tenant IS NULL OR t.tenant_id=b.tenant)) legacy_tools
   FROM storage
   """,(r,n)->new Overview(tenant,period,w.zone(),w.from(),w.end(),checked,
    Arrays.asList(json.readValue(r.getString("groups"),ModelGroup[].class)),Arrays.asList(json.readValue(r.getString("days"),Day[].class)),Arrays.asList(json.readValue(r.getString("tools"),ToolGroup[].class)),
    new Storage(r.getLong("originals"),r.getLong("versions"),r.getLong("bytes")),new Coverage(r.getLong("unmetered"),r.getLong("legacy_tools"),"NOT_CONNECTED","NOT_ENABLED"),new Quota("NOT_CONFIGURED",null,null,null)),Timestamp.from(w.from()),Timestamp.from(w.end()),tenant,w.zone());
 }
}
