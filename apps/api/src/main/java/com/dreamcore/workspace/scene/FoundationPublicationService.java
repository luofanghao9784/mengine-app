package com.dreamcore.workspace.scene;

import com.dreamcore.workspace.collection.DatasetField;
import com.dreamcore.workspace.collection.NativeGovernanceDeployment;
import com.dreamcore.workspace.collection.NativeMaterialGovernance;
import com.dreamcore.workspace.governance.GovernanceReferencePolicy;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

@Service
public class FoundationPublicationService {
   private final NativeGovernanceDeployment datasets;
   private final NativeMaterialGovernance materials;
   private final JdbcTemplate db;
   private final JsonMapper json = new JsonMapper();
   @org.springframework.beans.factory.annotation.Autowired private com.dreamcore.workspace.governance.GovernanceModelService governance;

   public FoundationPublicationService(NativeGovernanceDeployment datasets, NativeMaterialGovernance materials, JdbcTemplate db) {
      this.datasets = datasets;
      this.materials = materials;
      this.db = db;
   }

   public Map<String, FoundationPublicationService.Entry> current(UUID actor, UUID tenant, String asset) {
      LinkedHashMap<String, Map.Entry<UUID, List<DatasetField>>> candidates = new LinkedHashMap<>();
      if (asset == null || asset.startsWith("dataset-")) {
         for (NativeGovernanceDeployment.Published p : this.datasets.currentFor(actor, tenant, asset == null ? null : UUID.fromString(asset.substring(8)))) {
            candidates.put("dataset-" + p.datasetId(), Map.entry(p.releaseId(), p.fields()));
         }
      }

      if (asset == null || asset.startsWith("material-")) {
         for (NativeMaterialGovernance.Published p : this.materials.currentFor(actor, tenant, asset == null ? null : UUID.fromString(asset.substring(9)))) {
            candidates.put("material-" + p.materialId(), Map.entry(p.releaseId(), List.of()));
         }
      }

      if (candidates.isEmpty()) {
         return Map.of();
      }

      List<UUID> ids = candidates.values().stream().map(Map.Entry::getKey).distinct().toList();
      ArrayList<Object> args = new ArrayList<>();
      args.add(tenant);
      args.addAll(ids);
      List<Map<String, Object>> rows = this.db
         .queryForList(
            "SELECT j.id,j.actor_id,j.kind,j.input::text,j.output::text,coalesce(d.created_at,m.created_at) published_at FROM governance_model_jobs j JOIN governance_model_dispatch x ON x.job_id=j.id LEFT JOIN native_governance_releases d ON d.id=j.id LEFT JOIN native_material_releases m ON m.id=j.id WHERE j.tenant_id=? AND j.state='DRAFT_READY' AND x.state='SUCCEEDED' AND j.input->>'contractVersion'='2.0' AND j.id IN ("
               + String.join(",", Collections.nCopies(ids.size(), "?"))
               + ")",
            args.toArray()
         );
      rows = new ArrayList<>(rows);
      rows.addAll(db.queryForList("SELECT d.id,d.recipient_id actor_id,'DATASET' kind,'{}' input,'{}' output,d.created_at published_at FROM source_contract_publications p JOIN native_governance_releases d ON d.id=p.release_id WHERE p.tenant_id=? AND d.id IN (" + String.join(",", Collections.nCopies(ids.size(), "?")) + ")",args.toArray()));
      LinkedHashMap<String, FoundationPublicationService.Entry> result = new LinkedHashMap<>();

      for (Map<String, Object> r : rows) {
         JsonNode input = this.json.readTree(r.get("input").toString()).path("context");
         JsonNode output = this.json.readTree(r.get("output").toString());

         for (Map.Entry<String, Map.Entry<UUID, List<DatasetField>>> c : candidates.entrySet()) {
            if (c.getValue().getKey().equals(r.get("id"))) {
               List<String> unknown = c.getValue().getValue().stream().filter(f -> "UNKNOWN".equals(f.status())).map(DatasetField::column).toList();
               String parsing = "MATERIAL".equals(r.get("kind")) ? input.path("parserStatus").asText() : "READY";
               ArrayList<String> warnings = new ArrayList<>();
               ArrayList<String> limitations = new ArrayList<>();
               if (!unknown.isEmpty()) {
                  warnings.add("字段口径待确认：" + String.join("、", unknown));
               }

               if ("PARTIAL".equals(parsing)) {
                  warnings.add("原资料仅部分解析；知识只覆盖已解析且有引用的内容");
                  JsonNode parser = input.path("parserWarnings");
                  if (!parser.isMissingNode() && !parser.isNull()) {
                     limitations.add("解析限制：" + parser.asText(parser.toString()));
                  }
               }

               JsonNode currentSource = "DATASET".equals(r.get("kind"))
                   ? this.json.valueToTree(this.governance.currentDatasetSource(actor, tenant, UUID.fromString(c.getKey().substring(8)))) : input;
               JsonNode checks = currentSource.path("checks");
               if ("DATASET".equals(r.get("kind")) && !"CHECKED".equals(checks.path("state").asText())) {
                  warnings.add(switch(checks.path("state").asText()) {
                      case "SOURCE_CONTRACT_REQUIRED" -> "MISMATCH".equals(checks.path("sourceContract").path("state").asText())
                          ? "当前来源定义与本批身份、字段、范围或摘要不一致；需重新采集，自动分析暂停"
                          : "当前批次缺少有效来源定义；等待采集端补齐后重新采集";
                      case "NO_SOURCE_CONSTRAINTS" -> "CHECKED".equals(checks.path("exportValidation").path("state").asText())
                          ? "导出与接收已核验；尚无已确认业务规则，待补充来源声明后逐批检查"
                          : "尚无已确认业务规则；导出接收依据也待补齐";
                      default -> "来源检查未完成；请核对具体检查项与依据";
                  });
               }
               if ("CHECKED".equals(checks.path("sourceContract").path("state").asText()))
                  limitations.add("本批已接收并核对来源定义第 " + checks.path("sourceContract").path("definitionVersion").asInt()
                      + " 版；业务规则由梦擎对当前记录独立复核，定义接收不代表全部记录合格");
               JsonNode export = checks.path("exportValidation");
               String exportSummary = "";
               if ("CHECKED".equals(export.path("state").asText())) {
                  exportSummary = "已核验导出接收：" + export.path("rowCount").asLong() + " 条、"
                      + export.path("columnCount").asInt() + " 列逐值摘要一致；采集候选键缺失 "
                      + export.path("missingKeys").asLong() + "、重复 " + export.path("duplicateKeys").asLong()
                      + "；不等同源系统主键或财务正确性";
                  limitations.add(exportSummary);
               } else if (Set.of("MISMATCH", "STALE", "VIOLATIONS").contains(export.path("state").asText())) {
                  warnings.add("导出接收检查未通过或依据已过期；不能采用旧核验结论");
               } else if ("DATASET".equals(r.get("kind"))) {
                  warnings.add("缺少当前快照导出接收依据；自动分析等待采集核验，已发布字段口径保留");
               }

               if (checks.path("nonNullViolations").asLong() > 0L || checks.path("duplicatePrimaryKeys").asLong() > 0L) {
                  warnings.add("结构检查存在非空或主键异常；未将原始记录判定全部合格");
               }
               JsonNode valueChecks = checks.path("valueValidation");
               if ("VIOLATIONS".equals(valueChecks.path("state").asText())) {
                  warnings.add("已声明字段规则存在异常：" + valueChecks.path("violations").asLong() + " 项，需按检查结果处理");
               }
               if (!valueChecks.isMissingNode() && !"NOT_PROVIDED".equals(valueChecks.path("state").asText())) {
                  exportSummary += (exportSummary.isEmpty() ? "已核验来源约束：" : "；") + "已声明字段规则 " + valueChecks.path("rules").size() + " 项，异常 " + valueChecks.path("violations").asLong()
                      + "；声明主键重复 " + checks.path("duplicatePrimaryKeys").asLong() + "，必填缺失 " + checks.path("nonNullViolations").asLong();
                  limitations.add("检查范围：字段类型、已声明分类/状态格式和部署声明的唯一键；未核验银行到账或未声明的跨表勾稽。");
               }

               for (JsonNode fk : checks.path("foreignKeys")) {
                  if (fk.path("unmatched").asLong() > 0L) {
                     warnings.add("关联检查存在未匹配记录：" + fk.path("constraint").asText());
                  }

                  if (!"CHECKED".equals(fk.path("state").asText())) {
                     warnings.add("关联检查未覆盖：" + fk.path("constraint").asText());
                  }
               }

               // A published definition is shared with source readers; its author's private model draft is not.
               UUID subject = this.db.queryForObject("SELECT headquarters_permission_actor(?,?)",UUID.class,actor,tenant);
               if (!"DATASET".equals(r.get("kind")) || subject.equals(r.get("actor_id")))
                  for (JsonNode limit : output.path("limitations")) limitations.add(limit.asText());

               int count = output.path("knowledge").size();
               if (GovernanceReferencePolicy.hasPublication(count, r)) {
                  String at = ((Timestamp)r.get("published_at")).toInstant().toString();
                  result.put(
                     c.getKey(),
                     new FoundationPublicationService.Entry(
                        (UUID)r.get("id"),
                        at,
                        r.get("kind").toString(),
                        c.getValue().getValue(),
                        count,
                        parsing,
                        unknown,
                        List.copyOf(warnings),
                        List.copyOf(limitations),
                        exportSummary,
                        "DATASET".equals(r.get("kind")) && currentSource.path("rowCount").canConvertToLong() ? currentSource.path("rowCount").asLong() : null,
                        valueChecks.path("rules").isArray() && valueChecks.path("rules").size() > 0 ? valueChecks.path("rules").size() : null,
                        valueChecks.path("rules").isArray() && valueChecks.path("rules").size() > 0
                            ? (int)java.util.stream.StreamSupport.stream(valueChecks.path("rules").spliterator(), false).filter(rule -> "CHECKED".equals(rule.path("state").asText())).count() : null,
                        valueChecks.path("violations").canConvertToLong() && valueChecks.path("rules").size() > 0 ? valueChecks.path("violations").asLong() : null
                     )
                  );
               }
            }
         }
      }

      return result;
   }

   public void apply(ObjectNode asset, FoundationPublicationService.Entry p) {
      if (p != null) {
         asset.put("available", true);
         asset.put("availabilityKind", "PUBLISHED_KNOWLEDGE");
         asset.put("availableKnowledgeCount", p.knowledgeCount());
         asset.put("availabilityScope", p.scope());
         asset.put("publicationId", p.releaseId().toString());
         asset.put("publishedAt", p.at());
         asset.put("unknownFieldCount", p.unknown().size());
         asset.set("unknownFields", this.json.valueToTree(p.unknown()));
         asset.set("limitations", this.json.valueToTree(p.limitations()));
         asset.put("exportValidationSummary", p.exportSummary());
         asset.set("issues", this.json.valueToTree(p.warnings()));
         asset.set("stageStates", this.json.valueToTree(p.stages()));
         asset.put("gate", 4);
         asset.put("needsAttention", !p.warnings().isEmpty());
         asset.put("checksPassed", p.warnings().isEmpty());
         asset.put("automaticAnalysisReady", "DATASET".equals(p.kind()) && p.warnings().isEmpty());
         asset.put("label", "已发布治理知识" + (p.warnings().isEmpty() ? "" : " · 保留待核实项与解析限制"));
         if (p.queryableRecords() != null) asset.put("queryableRecords", p.queryableRecords());
         if (p.declaredRules() != null) {
            asset.putObject("ruleStats").put("total", p.declaredRules()).put("passed", p.passedRules()).put("violations", p.ruleViolations())
                .put("scope", "当前快照已声明的字段值规则；异常项按单元格与规则计数，不表示记录已隔离或银行到账已核实");
         }
         asset.putNull("ready");
         asset.putNull("quality");
         asset.putNull("isolated");
         if ("DATASET".equals(p.kind())) {
            asset.put("dictionaryStatus", p.unknown().isEmpty() ? "governed" : "partial");
         }

         GovernanceReferencePolicy.applyPublication(asset);
      }
   }

   public FoundationProcessingService.Result apply(FoundationProcessingService.Result r, FoundationPublicationService.Entry p) {
      if (p == null) {
         return r;
      }

      List<FoundationProcessingService.Field> fields = "DATASET".equals(p.kind())
         ? p.fields().stream().map(f -> new FoundationProcessingService.Field(f.column(), f.type(), f.meaning(), f.unit(), f.status(), f.evidence())).toList()
         : r.fields();
      ArrayList<FoundationProcessingService.Stage> stages = new ArrayList<>(r.stages());
      stages.set(
         2,
         new FoundationProcessingService.Stage(
            "dictionary",
            "DATASET".equals(p.kind()) ? "字段口径" : "知识口径",
            p.stages().get(2),
            p.at(),
            p.unknown().isEmpty() ? "已发布的治理解释；不改写来源数据" : "未知字段仍待确认，不用于推定业务事实",
            p.unknown(),
            p.fields().stream().map(DatasetField::column).toList()
         )
      );
      stages.set(3, new FoundationProcessingService.Stage("checks", "治理检查", p.stages().get(3), p.at(), "原生任务完成引用和格式校验；不等于全部原始记录质量合格", p.warnings(), List.of()));
      stages.set(4, new FoundationProcessingService.Stage("available", "治理后 AI 可用", "READY", p.at(), p.scope(), p.limitations(), List.of()));
      FoundationProcessingService.Stage publication = new FoundationProcessingService.Stage(
         "publication",
         GovernanceReferencePolicy.publicationLabel("正式知识发布", p.kind()),
         "PUBLISHED",
         p.at(),
         "按当前来源、企业背景和接收权限核验发布回执",
         List.of(p.releaseId().toString()),
         List.of()
      );
      if (stages.size() > 5) {
         stages.set(5, publication);
      } else {
         stages.add(publication);
      }

      ArrayList<FoundationProcessingService.History> history = new ArrayList<>(r.history());
      history.add(0, new FoundationProcessingService.History(p.releaseId().toString(), "治理知识发布", "PUBLISHED", p.at(), p.at(), p.scope()));
      ArrayList<String> notes = new ArrayList<>(r.notes());
      notes.addAll(p.warnings());
      notes.addAll(p.limitations());
      return new FoundationProcessingService.Result(
         r.assetId(),
         r.name(),
         r.version(),
         r.revision(),
         r.recordKind(),
         r.recordCount(),
         fields,
         r.records(),
         r.offset(),
         r.hasMore(),
         stages,
         history,
         notes
      );
   }

   public record Entry(
      UUID releaseId,
      String at,
      String kind,
      List<DatasetField> fields,
      int knowledgeCount,
      String parsing,
      List<String> unknown,
      List<String> warnings,
      List<String> limitations,
      String exportSummary,
      Long queryableRecords,
      Integer declaredRules,
      Integer passedRules,
      Long ruleViolations
   ) {
      public List<String> stages() {
         return List.of("READY", this.parsing, this.unknown.isEmpty() ? "READY" : "PARTIAL", this.warnings.isEmpty() ? "READY" : "ATTENTION", "READY");
      }

      public String scope() {
         return GovernanceReferencePolicy.scope(this.knowledgeCount + " 篇已发布治理知识；原始记录未判定全部合格", this.kind);
      }
   }
}
