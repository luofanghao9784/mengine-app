package com.dreamcore.workspace.identity;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.Map.Entry;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class EngineTelemetryService {
   public static final int TENANT_LIMIT = 10;
   private static final String UNITS = "   SELECT 'COLLECTION' code,tenant_id,status state,finished_at done FROM engine_unarchived_collections\n   UNION ALL SELECT 'KNOWLEDGE',tenant_id,CASE status WHEN 'READY' THEN 'SUCCEEDED' WHEN 'PARTIAL' THEN 'PARTIAL' WHEN 'UNSUPPORTED' THEN 'FAILED' ELSE status END,finished_at FROM engine_unarchived_knowledge\n   UNION ALL SELECT CASE WHEN mode='SOURCE_LOOKUP' THEN 'RETRIEVAL' WHEN status='RUNNING' AND EXISTS(\n     SELECT 1 FROM conversation_live_output o WHERE o.task_id=t.id AND o.attempt_number=t.attempt AND o.state='STREAMING') THEN 'RESPONSE' ELSE 'TASK' END,\n     tenant_id,status,finished_at FROM engine_unarchived_tasks t\n   UNION ALL SELECT 'EXPORT',tenant_id,CASE state WHEN 'GENERATING' THEN 'RUNNING' WHEN 'READY' THEN 'SUCCEEDED' ELSE state END,generated_at FROM export_batches\n   UNION ALL SELECT 'SCENE_KNOWLEDGE',tenant_id,state,finished_at FROM engine_unarchived_scenes WHERE operation='/scene-knowledge/sync'\n   UNION ALL SELECT 'SCENE_KNOWLEDGE',tenant_id,CASE state WHEN 'WAITING_MODEL' THEN 'WAITING_CAPABILITY' WHEN 'VALIDATING' THEN 'RUNNING' WHEN 'DRAFT_READY' THEN 'SUCCEEDED' WHEN 'STALE' THEN 'WAITING_CAPABILITY' ELSE state END,updated_at FROM engine_unarchived_governance_jobs\n   UNION ALL SELECT 'COMPANY',tenant_id,CASE state WHEN 'RETRY_WAIT' THEN 'WAITING_CAPABILITY' ELSE state END,NULL::timestamptz FROM engine_unarchived_company_items WHERE state IN ('QUEUED','RETRY_WAIT')\n   UNION ALL SELECT 'COMPANY',tenant_id,CASE state WHEN 'CLAIMED' THEN 'RUNNING' WHEN 'DISPATCHED' THEN 'RUNNING' WHEN 'RETURNED' THEN 'SUCCEEDED' ELSE state END,finished_at FROM engine_unarchived_company_attempts\n   UNION ALL SELECT 'EXPERIENCE',i.tenant_id,CASE WHEN a.outcome IN('CREATED','UPDATED','DUPLICATE') THEN 'SUCCEEDED' WHEN a.outcome='CONFLICT' THEN 'FAILED' WHEN a.outcome='SOURCE_UNAVAILABLE' THEN 'CANCELLED' ELSE CASE i.state WHEN 'RETRY_WAIT' THEN 'WAITING_CAPABILITY' WHEN 'QUALIFIED' THEN 'WAITING_CAPABILITY' WHEN 'REJECTED' THEN 'CANCELLED' ELSE i.state END END,coalesce(a.created_at,i.updated_at) FROM experience_analysis_items i LEFT JOIN experience_admissions a ON a.run_id=i.run_id\n   UNION ALL SELECT 'GENERALIZATION',tenant_id,CASE state WHEN 'RETRY_WAIT' THEN 'WAITING_CAPABILITY' WHEN 'ADMITTED' THEN 'SUCCEEDED' WHEN 'DUPLICATE' THEN 'SUCCEEDED' WHEN 'QUALIFIED' THEN 'WAITING_CAPABILITY' WHEN 'REJECTED' THEN 'CANCELLED' WHEN 'CONFLICT' THEN 'WAITING_CAPABILITY' ELSE state END,updated_at FROM experience_generalization_sources\n   UNION ALL SELECT 'GENERAL_ADJUSTMENT',NULL::uuid,CASE state WHEN 'RETRY_WAIT' THEN 'WAITING_CAPABILITY' WHEN 'UNCERTAIN' THEN 'RESULT_UNKNOWN' WHEN 'PUBLISHING' THEN 'RUNNING' WHEN 'ADMITTED' THEN 'SUCCEEDED' WHEN 'REJECTED' THEN 'CANCELLED' WHEN 'CONFLICT' THEN 'WAITING_CAPABILITY' ELSE state END,updated_at FROM general_experience_adjustments\n";
   private final JdbcTemplate db;
   private final IdentityService identities;

   public EngineTelemetryService(JdbcTemplate db, IdentityService identities) {
      this.db = db;
      this.identities = identities;
   }

   @Transactional
   public EngineTelemetryService.Snapshot read(UUID actor, UUID tenant, boolean platform) {
      if (platform) {
         this.identities.platform(actor);
      } else {
         this.identities.member(actor, tenant, true);
      }

      this.db.execute("SET LOCAL statement_timeout='3s'");
      List<Entry<Instant, EngineTelemetryService.Channel>> rows = this.db
         .query(
            "WITH scope AS (SELECT ?::uuid tenant), units AS (\n   SELECT 'COLLECTION' code,tenant_id,status state,finished_at done FROM engine_unarchived_collections\n   UNION ALL SELECT 'KNOWLEDGE',tenant_id,CASE status WHEN 'READY' THEN 'SUCCEEDED' WHEN 'PARTIAL' THEN 'PARTIAL' WHEN 'UNSUPPORTED' THEN 'FAILED' ELSE status END,finished_at FROM engine_unarchived_knowledge\n   UNION ALL SELECT CASE WHEN mode='SOURCE_LOOKUP' THEN 'RETRIEVAL' WHEN status='RUNNING' AND EXISTS(\n     SELECT 1 FROM conversation_live_output o WHERE o.task_id=t.id AND o.attempt_number=t.attempt AND o.state='STREAMING') THEN 'RESPONSE' ELSE 'TASK' END,\n     tenant_id,status,finished_at FROM engine_unarchived_tasks t\n   UNION ALL SELECT 'EXPORT',tenant_id,CASE state WHEN 'GENERATING' THEN 'RUNNING' WHEN 'READY' THEN 'SUCCEEDED' ELSE state END,generated_at FROM export_batches\n   UNION ALL SELECT 'SCENE_KNOWLEDGE',tenant_id,state,finished_at FROM engine_unarchived_scenes WHERE operation='/scene-knowledge/sync'\n   UNION ALL SELECT 'SCENE_KNOWLEDGE',tenant_id,CASE state WHEN 'WAITING_MODEL' THEN 'WAITING_CAPABILITY' WHEN 'VALIDATING' THEN 'RUNNING' WHEN 'DRAFT_READY' THEN 'SUCCEEDED' WHEN 'STALE' THEN 'WAITING_CAPABILITY' ELSE state END,updated_at FROM engine_unarchived_governance_jobs\n   UNION ALL SELECT 'COMPANY',tenant_id,CASE state WHEN 'RETRY_WAIT' THEN 'WAITING_CAPABILITY' ELSE state END,NULL::timestamptz FROM engine_unarchived_company_items WHERE state IN ('QUEUED','RETRY_WAIT')\n   UNION ALL SELECT 'COMPANY',tenant_id,CASE state WHEN 'CLAIMED' THEN 'RUNNING' WHEN 'DISPATCHED' THEN 'RUNNING' WHEN 'RETURNED' THEN 'SUCCEEDED' ELSE state END,finished_at FROM engine_unarchived_company_attempts\n   UNION ALL SELECT 'EXPERIENCE',i.tenant_id,CASE WHEN a.outcome IN('CREATED','UPDATED','DUPLICATE') THEN 'SUCCEEDED' WHEN a.outcome='CONFLICT' THEN 'FAILED' WHEN a.outcome='SOURCE_UNAVAILABLE' THEN 'CANCELLED' ELSE CASE i.state WHEN 'RETRY_WAIT' THEN 'WAITING_CAPABILITY' WHEN 'QUALIFIED' THEN 'WAITING_CAPABILITY' WHEN 'REJECTED' THEN 'CANCELLED' ELSE i.state END END,coalesce(a.created_at,i.updated_at) FROM experience_analysis_items i LEFT JOIN experience_admissions a ON a.run_id=i.run_id\n   UNION ALL SELECT 'GENERALIZATION',tenant_id,CASE state WHEN 'RETRY_WAIT' THEN 'WAITING_CAPABILITY' WHEN 'ADMITTED' THEN 'SUCCEEDED' WHEN 'DUPLICATE' THEN 'SUCCEEDED' WHEN 'QUALIFIED' THEN 'WAITING_CAPABILITY' WHEN 'REJECTED' THEN 'CANCELLED' WHEN 'CONFLICT' THEN 'WAITING_CAPABILITY' ELSE state END,updated_at FROM experience_generalization_sources\n   UNION ALL SELECT 'GENERAL_ADJUSTMENT',NULL::uuid,CASE state WHEN 'RETRY_WAIT' THEN 'WAITING_CAPABILITY' WHEN 'UNCERTAIN' THEN 'RESULT_UNKNOWN' WHEN 'PUBLISHING' THEN 'RUNNING' WHEN 'ADMITTED' THEN 'SUCCEEDED' WHEN 'REJECTED' THEN 'CANCELLED' WHEN 'CONFLICT' THEN 'WAITING_CAPABILITY' ELSE state END,updated_at FROM general_experience_adjustments\n), codes AS (SELECT unnest(ARRAY['COLLECTION','KNOWLEDGE','RETRIEVAL','TASK','COMPANY','SCENE_KNOWLEDGE','EXPERIENCE','GENERALIZATION','GENERAL_ADJUSTMENT','RESPONSE','EXPORT']) code), filtered AS MATERIALIZED (\n SELECT u.* FROM units u,scope s WHERE s.tenant IS NULL OR u.tenant_id=s.tenant\n) SELECT c.code,statement_timestamp() checked_at,\n  count(*) FILTER(WHERE u.state='RUNNING') running,\n  count(*) FILTER(WHERE u.state='QUEUED') queued,\n  count(*) FILTER(WHERE u.state IN('PAUSED','WAITING_INPUT','WAITING_CAPABILITY','PARTIAL')) waiting,\n  count(*) FILTER(WHERE u.state IN('FAILED','INTERRUPTED')) failed,\n  count(*) FILTER(WHERE u.state IN('UNKNOWN','RESULT_UNKNOWN')) unknown,\n  count(*) FILTER(WHERE u.state='SUCCEEDED' AND u.done>=statement_timestamp()-interval '5 minutes' AND u.done<=statement_timestamp()) completed,\n  max(u.done) FILTER(WHERE u.state='SUCCEEDED' AND u.done<=statement_timestamp()) last_done\nFROM codes c LEFT JOIN filtered u ON u.code=c.code GROUP BY c.code ORDER BY array_position(ARRAY['COLLECTION','KNOWLEDGE','RETRIEVAL','TASK','COMPANY','SCENE_KNOWLEDGE','EXPERIENCE','GENERALIZATION','GENERAL_ADJUSTMENT','RESPONSE','EXPORT'],c.code)\n",
            (r, n) -> Map.entry(
               r.getTimestamp("checked_at").toInstant(),
               new EngineTelemetryService.Channel(
                  r.getString("code"),
                  r.getLong("running"),
                  r.getLong("queued"),
                  r.getLong("waiting"),
                  r.getLong("failed"),
                  r.getLong("unknown"),
                  r.getLong("completed"),
                  r.getTimestamp("last_done") == null ? null : r.getTimestamp("last_done").toInstant()
               )
            ),
            new Object[]{tenant}
         );
      if (platform) {
         this.identities.platform(actor);
      } else {
         this.identities.member(actor, tenant, true);
      }

      return new EngineTelemetryService.Snapshot(
         tenant,
         rows.getFirst().getKey(),
         300,
         "NOT_CONNECTED",
         rows.stream().map(Entry::getValue).filter(c -> tenant == null || !c.code().equals("GENERAL_ADJUSTMENT")).toList()
      );
   }

   @Transactional
   public EngineTelemetryService.TenantDistribution tenants(UUID actor) {
      this.identities.platform(actor);
      this.db.execute("SET LOCAL statement_timeout='3s'");
      Instant checked = ((Timestamp)this.db.queryForObject("SELECT statement_timestamp()", Timestamp.class)).toInstant();
      List<EngineTelemetryService.TenantRunning> rows = this.db
         .query(
            "WITH units AS (   SELECT 'COLLECTION' code,tenant_id,status state,finished_at done FROM engine_unarchived_collections\n   UNION ALL SELECT 'KNOWLEDGE',tenant_id,CASE status WHEN 'READY' THEN 'SUCCEEDED' WHEN 'PARTIAL' THEN 'PARTIAL' WHEN 'UNSUPPORTED' THEN 'FAILED' ELSE status END,finished_at FROM engine_unarchived_knowledge\n   UNION ALL SELECT CASE WHEN mode='SOURCE_LOOKUP' THEN 'RETRIEVAL' WHEN status='RUNNING' AND EXISTS(\n     SELECT 1 FROM conversation_live_output o WHERE o.task_id=t.id AND o.attempt_number=t.attempt AND o.state='STREAMING') THEN 'RESPONSE' ELSE 'TASK' END,\n     tenant_id,status,finished_at FROM engine_unarchived_tasks t\n   UNION ALL SELECT 'EXPORT',tenant_id,CASE state WHEN 'GENERATING' THEN 'RUNNING' WHEN 'READY' THEN 'SUCCEEDED' ELSE state END,generated_at FROM export_batches\n   UNION ALL SELECT 'SCENE_KNOWLEDGE',tenant_id,state,finished_at FROM engine_unarchived_scenes WHERE operation='/scene-knowledge/sync'\n   UNION ALL SELECT 'SCENE_KNOWLEDGE',tenant_id,CASE state WHEN 'WAITING_MODEL' THEN 'WAITING_CAPABILITY' WHEN 'VALIDATING' THEN 'RUNNING' WHEN 'DRAFT_READY' THEN 'SUCCEEDED' WHEN 'STALE' THEN 'WAITING_CAPABILITY' ELSE state END,updated_at FROM engine_unarchived_governance_jobs\n   UNION ALL SELECT 'COMPANY',tenant_id,CASE state WHEN 'RETRY_WAIT' THEN 'WAITING_CAPABILITY' ELSE state END,NULL::timestamptz FROM engine_unarchived_company_items WHERE state IN ('QUEUED','RETRY_WAIT')\n   UNION ALL SELECT 'COMPANY',tenant_id,CASE state WHEN 'CLAIMED' THEN 'RUNNING' WHEN 'DISPATCHED' THEN 'RUNNING' WHEN 'RETURNED' THEN 'SUCCEEDED' ELSE state END,finished_at FROM engine_unarchived_company_attempts\n   UNION ALL SELECT 'EXPERIENCE',i.tenant_id,CASE WHEN a.outcome IN('CREATED','UPDATED','DUPLICATE') THEN 'SUCCEEDED' WHEN a.outcome='CONFLICT' THEN 'FAILED' WHEN a.outcome='SOURCE_UNAVAILABLE' THEN 'CANCELLED' ELSE CASE i.state WHEN 'RETRY_WAIT' THEN 'WAITING_CAPABILITY' WHEN 'QUALIFIED' THEN 'WAITING_CAPABILITY' WHEN 'REJECTED' THEN 'CANCELLED' ELSE i.state END END,coalesce(a.created_at,i.updated_at) FROM experience_analysis_items i LEFT JOIN experience_admissions a ON a.run_id=i.run_id\n   UNION ALL SELECT 'GENERALIZATION',tenant_id,CASE state WHEN 'RETRY_WAIT' THEN 'WAITING_CAPABILITY' WHEN 'ADMITTED' THEN 'SUCCEEDED' WHEN 'DUPLICATE' THEN 'SUCCEEDED' WHEN 'QUALIFIED' THEN 'WAITING_CAPABILITY' WHEN 'REJECTED' THEN 'CANCELLED' WHEN 'CONFLICT' THEN 'WAITING_CAPABILITY' ELSE state END,updated_at FROM experience_generalization_sources\n   UNION ALL SELECT 'GENERAL_ADJUSTMENT',NULL::uuid,CASE state WHEN 'RETRY_WAIT' THEN 'WAITING_CAPABILITY' WHEN 'UNCERTAIN' THEN 'RESULT_UNKNOWN' WHEN 'PUBLISHING' THEN 'RUNNING' WHEN 'ADMITTED' THEN 'SUCCEEDED' WHEN 'REJECTED' THEN 'CANCELLED' WHEN 'CONFLICT' THEN 'WAITING_CAPABILITY' ELSE state END,updated_at FROM general_experience_adjustments\n) SELECT t.id,t.name,count(*) running FROM units u JOIN tenants t ON t.id=u.tenant_id\nWHERE u.state='RUNNING' GROUP BY t.id,t.name ORDER BY running DESC,t.name,t.id\n",
            (r, n) -> new EngineTelemetryService.TenantRunning(r.getObject("id", UUID.class), r.getString("name"), r.getLong("running"))
         );
      this.identities.platform(actor);
      List<EngineTelemetryService.TenantRunning> rest = rows.subList(Math.min(10, rows.size()), rows.size());
      return new EngineTelemetryService.TenantDistribution(
         checked,
         List.copyOf(rows.subList(0, Math.min(10, rows.size()))),
         rest.size(),
         rest.stream().mapToLong(EngineTelemetryService.TenantRunning::running).sum()
      );
   }

   public record Channel(String code, long running, long queued, long waiting, long failed, long unknown, long completedRecent, Instant lastCompletedAt) {
   }

   public record Snapshot(UUID tenantId, Instant checkedAt, int recentSeconds, String evolution, List<EngineTelemetryService.Channel> channels) {
   }

   public record TenantDistribution(Instant checkedAt, List<EngineTelemetryService.TenantRunning> tenants, long otherTenants, long otherRunning) {
   }

   public record TenantRunning(UUID tenantId, String tenantName, long running) {
   }
}
