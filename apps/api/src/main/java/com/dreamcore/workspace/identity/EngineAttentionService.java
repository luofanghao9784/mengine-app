package com.dreamcore.workspace.identity;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class EngineAttentionService {
   private final JdbcTemplate db;
   private final IdentityService identities;
   private static final String UNITS = "SELECT id,tenant_id,CASE WHEN mode='SOURCE_LOOKUP' THEN 'RETRIEVAL' ELSE 'TASK' END channel,status state,\nCASE WHEN origin='SYSTEM_BRIEFING' THEN '自动画报任务' ELSE '员工会话任务' END title,\ncoalesce(error_code,wait_reason,'') code,coalesce(required_input,'') note,created_at at FROM engine_unarchived_tasks\nUNION ALL SELECT id,tenant_id,'BRIEFING',status,'自动分析待执行',coalesce(reason,''),'',created_at FROM briefing_generation_batches WHERE task_id IS NULL\nUNION ALL SELECT id,tenant_id,'KNOWLEDGE',CASE WHEN status='UNSUPPORTED' THEN 'FAILED' ELSE status END,'资料解析',\nCASE status WHEN 'UNSUPPORTED' THEN 'UNSUPPORTED_FORMAT' WHEN 'PARTIAL' THEN 'PARTIAL_PARSE' ELSE 'PARSE_FAILED' END,'',created_at FROM engine_unarchived_knowledge\nUNION ALL SELECT id,tenant_id,'COLLECTION',status,'数据库取数',coalesce(reason,''),'',created_at FROM engine_unarchived_collections\nUNION ALL SELECT id,tenant_id,'SCENE_KNOWLEDGE',state,'业务知识与星图',coalesce(error_code,''),'',created_at FROM engine_unarchived_scenes WHERE operation='/scene-knowledge/sync'\nUNION ALL SELECT run_id,tenant_id,'COMPANY',state,'企业信息分析',coalesce(error_code,''),'',created_at FROM engine_unarchived_company_attempts\nUNION ALL SELECT chunk_id,tenant_id,'COMPANY_RETRY',CASE WHEN state='QUEUED' THEN 'QUEUED' ELSE 'WAITING_CAPABILITY' END,'企业分析等待重试',coalesce(error_code,''),'',updated_at FROM engine_unarchived_company_items WHERE state IN ('RETRY_WAIT','QUEUED')\nUNION ALL SELECT i.source_id,i.tenant_id,'EXPERIENCE',CASE WHEN a.outcome='CONFLICT' THEN 'FAILED' WHEN a.outcome IN ('CREATED','UPDATED','DUPLICATE') THEN 'SUCCEEDED' WHEN a.outcome='SOURCE_UNAVAILABLE' THEN 'CANCELLED' WHEN i.state IN ('RETRY_WAIT','QUALIFIED') THEN 'WAITING_CAPABILITY' ELSE i.state END,'经验提炼与核验',coalesce(i.error_code,''),'',i.updated_at FROM experience_analysis_items i LEFT JOIN experience_admissions a ON a.run_id=i.run_id\nUNION ALL SELECT version_id,tenant_id,'GENERALIZATION',CASE WHEN state IN ('RETRY_WAIT','QUALIFIED','CONFLICT') THEN 'WAITING_CAPABILITY' ELSE state END,'通用经验清洗',coalesce(error_code,''),'',updated_at FROM experience_generalization_sources\nUNION ALL SELECT id,NULL::uuid,'GENERAL_ADJUSTMENT',CASE WHEN state='UNCERTAIN' THEN 'RESULT_UNKNOWN' WHEN state IN ('RETRY_WAIT','CONFLICT') THEN 'WAITING_CAPABILITY' ELSE state END,'总库调整核验',coalesce(error_code,''),'',updated_at FROM general_experience_adjustments\nUNION ALL SELECT id,tenant_id,'EXPORT',state,'成果导出',coalesce(error_code,''),'',created_at FROM export_batches\n";
   private static final String FILTER = "FROM units u LEFT JOIN tenants t ON t.id=u.tenant_id\nWHERE u.state IN ('FAILED','INTERRUPTED','UNKNOWN','RESULT_UNKNOWN','PARTIAL','PAUSED','WAITING_INPUT','WAITING_CAPABILITY','QUEUED','WAITING_DATA','WAITING_RESOURCE')\nAND (?::uuid IS NULL OR u.tenant_id=?::uuid)\nAND (?='ALL' OR (?='FAILED' AND u.state IN ('FAILED','INTERRUPTED')) OR (?='UNKNOWN' AND u.state IN ('UNKNOWN','RESULT_UNKNOWN')) OR (?='WAITING' AND u.state IN ('PARTIAL','PAUSED','WAITING_INPUT','WAITING_CAPABILITY','QUEUED','WAITING_DATA','WAITING_RESOURCE')))\n";

   public EngineAttentionService(JdbcTemplate db, IdentityService identities) {
      this.db = db;
      this.identities = identities;
   }

   @Transactional(isolation = Isolation.REPEATABLE_READ, readOnly = true)
   public EngineAttentionService.Page read(UUID actor, UUID tenant, String state, int offset) {
      this.identities.platform(actor);
      if (Set.of("ALL", "FAILED", "UNKNOWN", "WAITING").contains(state) && offset >= 0 && offset <= 100000) {
         this.db.execute("SET LOCAL statement_timeout='5s'");
         Object[] args = new Object[]{tenant, tenant, state, state, state, state};
         long total = (Long)this.db
            .queryForObject(
               "WITH units AS (SELECT id,tenant_id,CASE WHEN mode='SOURCE_LOOKUP' THEN 'RETRIEVAL' ELSE 'TASK' END channel,status state,\nCASE WHEN origin='SYSTEM_BRIEFING' THEN '自动画报任务' ELSE '员工会话任务' END title,\ncoalesce(error_code,wait_reason,'') code,coalesce(required_input,'') note,created_at at FROM engine_unarchived_tasks\nUNION ALL SELECT id,tenant_id,'BRIEFING',status,'自动分析待执行',coalesce(reason,''),'',created_at FROM briefing_generation_batches WHERE task_id IS NULL\nUNION ALL SELECT id,tenant_id,'KNOWLEDGE',CASE WHEN status='UNSUPPORTED' THEN 'FAILED' ELSE status END,'资料解析',\nCASE status WHEN 'UNSUPPORTED' THEN 'UNSUPPORTED_FORMAT' WHEN 'PARTIAL' THEN 'PARTIAL_PARSE' ELSE 'PARSE_FAILED' END,'',created_at FROM engine_unarchived_knowledge\nUNION ALL SELECT id,tenant_id,'COLLECTION',status,'数据库取数',coalesce(reason,''),'',created_at FROM engine_unarchived_collections\nUNION ALL SELECT id,tenant_id,'SCENE_KNOWLEDGE',state,'业务知识与星图',coalesce(error_code,''),'',created_at FROM engine_unarchived_scenes WHERE operation='/scene-knowledge/sync'\nUNION ALL SELECT run_id,tenant_id,'COMPANY',state,'企业信息分析',coalesce(error_code,''),'',created_at FROM engine_unarchived_company_attempts\nUNION ALL SELECT chunk_id,tenant_id,'COMPANY_RETRY',CASE WHEN state='QUEUED' THEN 'QUEUED' ELSE 'WAITING_CAPABILITY' END,'企业分析等待重试',coalesce(error_code,''),'',updated_at FROM engine_unarchived_company_items WHERE state IN ('RETRY_WAIT','QUEUED')\nUNION ALL SELECT i.source_id,i.tenant_id,'EXPERIENCE',CASE WHEN a.outcome='CONFLICT' THEN 'FAILED' WHEN a.outcome IN ('CREATED','UPDATED','DUPLICATE') THEN 'SUCCEEDED' WHEN a.outcome='SOURCE_UNAVAILABLE' THEN 'CANCELLED' WHEN i.state IN ('RETRY_WAIT','QUALIFIED') THEN 'WAITING_CAPABILITY' ELSE i.state END,'经验提炼与核验',coalesce(i.error_code,''),'',i.updated_at FROM experience_analysis_items i LEFT JOIN experience_admissions a ON a.run_id=i.run_id\nUNION ALL SELECT version_id,tenant_id,'GENERALIZATION',CASE WHEN state IN ('RETRY_WAIT','QUALIFIED','CONFLICT') THEN 'WAITING_CAPABILITY' ELSE state END,'通用经验清洗',coalesce(error_code,''),'',updated_at FROM experience_generalization_sources\nUNION ALL SELECT id,NULL::uuid,'GENERAL_ADJUSTMENT',CASE WHEN state='UNCERTAIN' THEN 'RESULT_UNKNOWN' WHEN state IN ('RETRY_WAIT','CONFLICT') THEN 'WAITING_CAPABILITY' ELSE state END,'总库调整核验',coalesce(error_code,''),'',updated_at FROM general_experience_adjustments\nUNION ALL SELECT id,tenant_id,'EXPORT',state,'成果导出',coalesce(error_code,''),'',created_at FROM export_batches\n) SELECT count(*) FROM units u LEFT JOIN tenants t ON t.id=u.tenant_id\nWHERE u.state IN ('FAILED','INTERRUPTED','UNKNOWN','RESULT_UNKNOWN','PARTIAL','PAUSED','WAITING_INPUT','WAITING_CAPABILITY','QUEUED','WAITING_DATA','WAITING_RESOURCE')\nAND (?::uuid IS NULL OR u.tenant_id=?::uuid)\nAND (?='ALL' OR (?='FAILED' AND u.state IN ('FAILED','INTERRUPTED')) OR (?='UNKNOWN' AND u.state IN ('UNKNOWN','RESULT_UNKNOWN')) OR (?='WAITING' AND u.state IN ('PARTIAL','PAUSED','WAITING_INPUT','WAITING_CAPABILITY','QUEUED','WAITING_DATA','WAITING_RESOURCE')))\n",
               Long.class,
               args
            );
         List<EngineAttentionService.Item> rows = this.db
            .query(
               "WITH units AS (SELECT id,tenant_id,CASE WHEN mode='SOURCE_LOOKUP' THEN 'RETRIEVAL' ELSE 'TASK' END channel,status state,\nCASE WHEN origin='SYSTEM_BRIEFING' THEN '自动画报任务' ELSE '员工会话任务' END title,\ncoalesce(error_code,wait_reason,'') code,coalesce(required_input,'') note,created_at at FROM engine_unarchived_tasks\nUNION ALL SELECT id,tenant_id,'BRIEFING',status,'自动分析待执行',coalesce(reason,''),'',created_at FROM briefing_generation_batches WHERE task_id IS NULL\nUNION ALL SELECT id,tenant_id,'KNOWLEDGE',CASE WHEN status='UNSUPPORTED' THEN 'FAILED' ELSE status END,'资料解析',\nCASE status WHEN 'UNSUPPORTED' THEN 'UNSUPPORTED_FORMAT' WHEN 'PARTIAL' THEN 'PARTIAL_PARSE' ELSE 'PARSE_FAILED' END,'',created_at FROM engine_unarchived_knowledge\nUNION ALL SELECT id,tenant_id,'COLLECTION',status,'数据库取数',coalesce(reason,''),'',created_at FROM engine_unarchived_collections\nUNION ALL SELECT id,tenant_id,'SCENE_KNOWLEDGE',state,'业务知识与星图',coalesce(error_code,''),'',created_at FROM engine_unarchived_scenes WHERE operation='/scene-knowledge/sync'\nUNION ALL SELECT run_id,tenant_id,'COMPANY',state,'企业信息分析',coalesce(error_code,''),'',created_at FROM engine_unarchived_company_attempts\nUNION ALL SELECT chunk_id,tenant_id,'COMPANY_RETRY',CASE WHEN state='QUEUED' THEN 'QUEUED' ELSE 'WAITING_CAPABILITY' END,'企业分析等待重试',coalesce(error_code,''),'',updated_at FROM engine_unarchived_company_items WHERE state IN ('RETRY_WAIT','QUEUED')\nUNION ALL SELECT i.source_id,i.tenant_id,'EXPERIENCE',CASE WHEN a.outcome='CONFLICT' THEN 'FAILED' WHEN a.outcome IN ('CREATED','UPDATED','DUPLICATE') THEN 'SUCCEEDED' WHEN a.outcome='SOURCE_UNAVAILABLE' THEN 'CANCELLED' WHEN i.state IN ('RETRY_WAIT','QUALIFIED') THEN 'WAITING_CAPABILITY' ELSE i.state END,'经验提炼与核验',coalesce(i.error_code,''),'',i.updated_at FROM experience_analysis_items i LEFT JOIN experience_admissions a ON a.run_id=i.run_id\nUNION ALL SELECT version_id,tenant_id,'GENERALIZATION',CASE WHEN state IN ('RETRY_WAIT','QUALIFIED','CONFLICT') THEN 'WAITING_CAPABILITY' ELSE state END,'通用经验清洗',coalesce(error_code,''),'',updated_at FROM experience_generalization_sources\nUNION ALL SELECT id,NULL::uuid,'GENERAL_ADJUSTMENT',CASE WHEN state='UNCERTAIN' THEN 'RESULT_UNKNOWN' WHEN state IN ('RETRY_WAIT','CONFLICT') THEN 'WAITING_CAPABILITY' ELSE state END,'总库调整核验',coalesce(error_code,''),'',updated_at FROM general_experience_adjustments\nUNION ALL SELECT id,tenant_id,'EXPORT',state,'成果导出',coalesce(error_code,''),'',created_at FROM export_batches\n) SELECT u.*,coalesce(t.name,'平台总库') tenant_name FROM units u LEFT JOIN tenants t ON t.id=u.tenant_id\nWHERE u.state IN ('FAILED','INTERRUPTED','UNKNOWN','RESULT_UNKNOWN','PARTIAL','PAUSED','WAITING_INPUT','WAITING_CAPABILITY','QUEUED','WAITING_DATA','WAITING_RESOURCE')\nAND (?::uuid IS NULL OR u.tenant_id=?::uuid)\nAND (?='ALL' OR (?='FAILED' AND u.state IN ('FAILED','INTERRUPTED')) OR (?='UNKNOWN' AND u.state IN ('UNKNOWN','RESULT_UNKNOWN')) OR (?='WAITING' AND u.state IN ('PARTIAL','PAUSED','WAITING_INPUT','WAITING_CAPABILITY','QUEUED','WAITING_DATA','WAITING_RESOURCE')))\n ORDER BY u.at DESC,u.channel,u.id LIMIT 20 OFFSET "
                  + offset,
               (r, n) -> new EngineAttentionService.Item(
                  r.getObject("id", UUID.class),
                  r.getObject("tenant_id", UUID.class),
                  r.getString("tenant_name"),
                  r.getString("channel"),
                  r.getString("state"),
                  r.getString("title"),
                  this.safeCode(r.getString("code")),
                  r.getString("note"),
                  r.getTimestamp("at").toInstant().toString(),
                  List.of()
               ),
               args
            );
         List<EngineAttentionService.Item> items = rows.stream()
            .map(r -> new EngineAttentionService.Item(r.id, r.tenantId, r.tenantName, r.channel, r.state, r.title, r.code, r.note, r.at, this.sources(r)))
            .toList();
         List<Map<String, Object>> tenants = this.db
            .queryForList(
               "WITH units AS (SELECT id,tenant_id,CASE WHEN mode='SOURCE_LOOKUP' THEN 'RETRIEVAL' ELSE 'TASK' END channel,status state,\nCASE WHEN origin='SYSTEM_BRIEFING' THEN '自动画报任务' ELSE '员工会话任务' END title,\ncoalesce(error_code,wait_reason,'') code,coalesce(required_input,'') note,created_at at FROM engine_unarchived_tasks\nUNION ALL SELECT id,tenant_id,'BRIEFING',status,'自动分析待执行',coalesce(reason,''),'',created_at FROM briefing_generation_batches WHERE task_id IS NULL\nUNION ALL SELECT id,tenant_id,'KNOWLEDGE',CASE WHEN status='UNSUPPORTED' THEN 'FAILED' ELSE status END,'资料解析',\nCASE status WHEN 'UNSUPPORTED' THEN 'UNSUPPORTED_FORMAT' WHEN 'PARTIAL' THEN 'PARTIAL_PARSE' ELSE 'PARSE_FAILED' END,'',created_at FROM engine_unarchived_knowledge\nUNION ALL SELECT id,tenant_id,'COLLECTION',status,'数据库取数',coalesce(reason,''),'',created_at FROM engine_unarchived_collections\nUNION ALL SELECT id,tenant_id,'SCENE_KNOWLEDGE',state,'业务知识与星图',coalesce(error_code,''),'',created_at FROM engine_unarchived_scenes WHERE operation='/scene-knowledge/sync'\nUNION ALL SELECT run_id,tenant_id,'COMPANY',state,'企业信息分析',coalesce(error_code,''),'',created_at FROM engine_unarchived_company_attempts\nUNION ALL SELECT chunk_id,tenant_id,'COMPANY_RETRY',CASE WHEN state='QUEUED' THEN 'QUEUED' ELSE 'WAITING_CAPABILITY' END,'企业分析等待重试',coalesce(error_code,''),'',updated_at FROM engine_unarchived_company_items WHERE state IN ('RETRY_WAIT','QUEUED')\nUNION ALL SELECT i.source_id,i.tenant_id,'EXPERIENCE',CASE WHEN a.outcome='CONFLICT' THEN 'FAILED' WHEN a.outcome IN ('CREATED','UPDATED','DUPLICATE') THEN 'SUCCEEDED' WHEN a.outcome='SOURCE_UNAVAILABLE' THEN 'CANCELLED' WHEN i.state IN ('RETRY_WAIT','QUALIFIED') THEN 'WAITING_CAPABILITY' ELSE i.state END,'经验提炼与核验',coalesce(i.error_code,''),'',i.updated_at FROM experience_analysis_items i LEFT JOIN experience_admissions a ON a.run_id=i.run_id\nUNION ALL SELECT version_id,tenant_id,'GENERALIZATION',CASE WHEN state IN ('RETRY_WAIT','QUALIFIED','CONFLICT') THEN 'WAITING_CAPABILITY' ELSE state END,'通用经验清洗',coalesce(error_code,''),'',updated_at FROM experience_generalization_sources\nUNION ALL SELECT id,NULL::uuid,'GENERAL_ADJUSTMENT',CASE WHEN state='UNCERTAIN' THEN 'RESULT_UNKNOWN' WHEN state IN ('RETRY_WAIT','CONFLICT') THEN 'WAITING_CAPABILITY' ELSE state END,'总库调整核验',coalesce(error_code,''),'',updated_at FROM general_experience_adjustments\nUNION ALL SELECT id,tenant_id,'EXPORT',state,'成果导出',coalesce(error_code,''),'',created_at FROM export_batches\n) SELECT DISTINCT t.id::text id,t.name FROM units u JOIN tenants t ON t.id=u.tenant_id WHERE u.state IN ('FAILED','INTERRUPTED','UNKNOWN','RESULT_UNKNOWN','PARTIAL','PAUSED','WAITING_INPUT','WAITING_CAPABILITY','QUEUED','WAITING_DATA','WAITING_RESOURCE') UNION SELECT t.id::text id,t.name FROM tenants t JOIN scene_bindings b ON b.tenant_id=t.id ORDER BY name,id"
            );
         this.identities.platform(actor);
         return new EngineAttentionService.Page(items, total, offset, offset + items.size() < total, tenants);
      } else {
         throw IdentityException.invalid();
      }
   }

   private String safeCode(String code) {
      return code != null && code.matches("[A-Z][A-Z0-9_]{0,79}") ? code : "";
   }

   private List<EngineAttentionService.Source> sources(EngineAttentionService.Item item) {
      UUID id = item.id;
      UUID tenant = item.tenantId;
      if (tenant == null) {
         return List.of();
      }

      if (Set.of("TASK", "RETRIEVAL").contains(item.channel)) {
         return this.db
            .query(
               "WITH refs AS (\n SELECT p.material_id,p.version_id,'任务固定版本' relation FROM conversation_task_material_versions p WHERE p.task_id=?\n UNION SELECT c.material_id,c.version_id,'检索命中来源' FROM conversation_sources p JOIN knowledge_chunks c ON c.id=p.chunk_id WHERE p.task_id=?\n UNION SELECT m.id,v.id,'画报选取（不代表已读取）' FROM briefing_generation_batches b CROSS JOIN LATERAL jsonb_array_elements(b.source_versions) x\n  JOIN materials m ON m.id::text=x->>'materialId' AND m.tenant_id=b.tenant_id\n  JOIN material_versions v ON v.id::text=x->>'versionId' AND v.material_id=m.id WHERE b.task_id=?\n), ds AS (\n SELECT dataset_id,snapshot_id,'任务已读取 · 尝试 '||attempt_number relation FROM task_dataset_reads WHERE task_id=?\n UNION SELECT dataset_id,snapshot_id,CASE WHEN invalidated THEN '画报选取 · 已失效' ELSE '画报选取（不代表已计算）' END FROM briefing_dataset_selections WHERE task_id=?\n) SELECT DISTINCT 'MATERIAL' kind,m.id,m.name,'V'||v.number version,refs.relation,m.current_version=v.number AND m.in_library current\n FROM refs JOIN materials m ON m.id=refs.material_id AND m.tenant_id=? JOIN material_versions v ON v.id=refs.version_id AND v.material_id=m.id\nUNION SELECT 'DATASET',d.id,d.name,'快照 V'||s.version||' · '||s.id,ds.relation,d.current_snapshot=s.id AND d.status='ACTIVE'\n FROM ds JOIN business_datasets d ON d.id=ds.dataset_id AND d.tenant_id=? JOIN dataset_snapshots s ON s.id=ds.snapshot_id AND s.dataset_id=d.id\nORDER BY kind,name,version,relation\n",
               (r, n) -> this.source(r),
               new Object[]{id, id, id, id, id, tenant, tenant}
            );
      }

      String refs = switch (item.channel) {
         case "KNOWLEDGE" -> "SELECT material_id,version_id FROM knowledge_runs WHERE id=?";
         case "COMPANY" -> "SELECT c.material_id,c.version_id FROM company_inference_inputs i JOIN knowledge_chunks c ON c.id=i.chunk_id WHERE i.run_id=?";
         case "COMPANY_RETRY" -> "SELECT material_id,version_id FROM knowledge_chunks WHERE id=?";
         default -> null;
      };
      if (refs != null) {
         return this.db
            .query(
               "WITH refs AS ("
                  + refs
                  + ") SELECT DISTINCT 'MATERIAL' kind,m.id,m.name,'V'||v.number version,'处理来源' relation,m.current_version=v.number AND m.in_library current FROM refs JOIN materials m ON m.id=refs.material_id AND m.tenant_id=? JOIN material_versions v ON v.id=refs.version_id AND v.material_id=m.id ORDER BY m.name,version",
               (r, n) -> this.source(r),
               new Object[]{id, tenant}
            );
      } else {
         return item.channel.equals("COLLECTION")
            ? this.db
               .query(
                  "SELECT 'CONNECTION' kind,c.id,c.name,'执行 '||r.execution_epoch version,'取数连接（失败时可能未产出快照）' relation,c.status='READY' current FROM engine_unarchived_collections r JOIN data_connections c ON c.id=r.connection_id AND c.tenant_id=r.tenant_id WHERE r.id=? AND r.tenant_id=?",
                  (r, n) -> this.source(r),
                  new Object[]{id, tenant}
               )
            : List.of();
      }
   }

   private EngineAttentionService.Source source(ResultSet r) throws SQLException {
      return new EngineAttentionService.Source(
         r.getString("kind"), r.getObject("id", UUID.class), r.getString("name"), r.getString("version"), r.getString("relation"), r.getBoolean("current")
      );
   }

   public record Item(
      UUID id,
      UUID tenantId,
      String tenantName,
      String channel,
      String state,
      String title,
      String code,
      String note,
      String at,
      List<EngineAttentionService.Source> sources
   ) {
   }

   public record Page(List<EngineAttentionService.Item> items, long total, int offset, boolean hasMore, List<Map<String, Object>> tenants) {
   }

   public record Source(String kind, UUID id, String name, String version, String relationship, boolean current) {
   }
}
