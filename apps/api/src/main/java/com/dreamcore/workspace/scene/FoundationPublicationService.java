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
            "SELECT j.id,j.kind,j.input::text,j.output::text,coalesce(d.created_at,m.created_at) published_at FROM governance_model_jobs j JOIN governance_model_dispatch x ON x.job_id=j.id LEFT JOIN native_governance_releases d ON d.id=j.id LEFT JOIN native_material_releases m ON m.id=j.id WHERE j.tenant_id=? AND j.state='DRAFT_READY' AND x.state='SUCCEEDED' AND j.input->>'contractVersion'='2.0' AND j.id IN ("
               + String.join(",", Collections.nCopies(ids.size(), "?"))
               + ")",
            args.toArray()
         );
      LinkedHashMap<String, FoundationPublicationService.Entry> result = new LinkedHashMap<>();

      for (Map<String, Object> r : rows) {
         JsonNode input = this.json.readTree(r.get("input").toString()).path("context");
         JsonNode output = this.json.readTree(r.get("output").toString());

         for (Map.Entry<String, Map.Entry<UUID, List<DatasetField>>> c : candidates.entrySet()) {
            if (c.getValue().getKey().equals(r.get("id"))) {
               List<String> unknown = c.getValue().getValue().stream().filter(f -> !"SOURCE_DOCUMENTED".equals(f.status())).map(DatasetField::column).toList();
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

               JsonNode checks = input.path("checks");
               if ("DATASET".equals(r.get("kind")) && !"CHECKED".equals(checks.path("state").asText())) {
                  warnings.add("来源结构约束检查范围不完整；不能判定全部记录合格");
               }

               if (checks.path("nonNullViolations").asLong() > 0L || checks.path("duplicatePrimaryKeys").asLong() > 0L) {
                  warnings.add("结构检查存在非空或主键异常；未将原始记录判定全部合格");
               }

               for (JsonNode fk : checks.path("foreignKeys")) {
                  if (fk.path("unmatched").asLong() > 0L) {
                     warnings.add("关联检查存在未匹配记录：" + fk.path("constraint").asText());
                  }

                  if (!"CHECKED".equals(fk.path("state").asText())) {
                     warnings.add("关联检查未覆盖：" + fk.path("constraint").asText());
                  }
               }

               for (JsonNode limit : output.path("limitations")) {
                  limitations.add(limit.asText());
               }

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
                        List.copyOf(limitations)
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
         asset.set("issues", this.json.valueToTree(p.warnings()));
         asset.set("stageStates", this.json.valueToTree(p.stages()));
         asset.put("gate", 4);
         asset.put("needsAttention", !p.warnings().isEmpty());
         asset.put("checksPassed", p.warnings().isEmpty());
         asset.put("label", "已发布治理知识" + (p.warnings().isEmpty() ? "" : " · 保留待核实项与解析限制"));
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
      List<String> limitations
   ) {
      public List<String> stages() {
         return List.of("READY", this.parsing, this.unknown.isEmpty() ? "READY" : "PARTIAL", this.warnings.isEmpty() ? "READY" : "ATTENTION", "READY");
      }

      public String scope() {
         return GovernanceReferencePolicy.scope(this.knowledgeCount + " 篇已发布治理知识；原始记录未判定全部合格", this.kind);
      }
   }
}
