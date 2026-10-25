package com.dreamcore.workspace.scene;

import com.dreamcore.workspace.collection.CollectionService;
import com.dreamcore.workspace.collection.NativeMaterialGovernance;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.IdentityService;
import com.dreamcore.workspace.material.MaterialService;
import java.io.Serializable;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

@Service
public class NativeFoundationService {
   @Autowired
   private Environment environment;
   @Autowired
   private JdbcTemplate db;
   @Autowired
   private FoundationProcessingService processing;
   private final CollectionService collections;
   private final MaterialService materials;
   private final IdentityService identities;
   @Autowired
   private NativeMaterialGovernance materialGovernance;
   @Autowired
   private FoundationPublicationService publications;
   private final JsonMapper json = new JsonMapper();

   public NativeFoundationService(CollectionService collections, MaterialService materials, IdentityService identities) {
      this.collections = collections;
      this.materials = materials;
      this.identities = identities;
   }

   @Transactional(isolation = Isolation.REPEATABLE_READ)
   public JsonNode detail(UUID actor, UUID tenant, String id) {
      FoundationProcessingService.Result result = this.processing.read(actor, tenant, id, 0, 1, null);
      JsonNode asset = null;

      for (JsonNode item : this.snapshotInside(actor, tenant, id).path("items")) {
         if (id.equals(item.path("id").asText())) {
            asset = item;
            break;
         }
      }

      if (asset == null) {
         throw new IdentityException(404, "FOUNDATION_ASSET_NOT_FOUND");
      }

      ObjectNode a = (ObjectNode)asset.deepCopy();
      a.put("fieldCount", result.fields().size());
      a.set("stageStates", this.json.valueToTree(result.stages().stream().limit(5L).map(FoundationProcessingService.Stage::state).toList()));
      ObjectNode out = this.json.createObjectNode();
      out.set("asset", a);
      out.putNull("analysis");
      out.set("audit", this.json.createArrayNode());
      out.set("findings", this.json.createArrayNode());
      ArrayNode events = this.json.createArrayNode();
      List<String> names = List.of("received", "structure-stored", "dictionary-generated", "records-checked", "published");

      for (int i = 0; i < Math.min(5, result.stages().size()); i++) {
         FoundationProcessingService.Stage s = result.stages().get(i);
         if (s.at() != null && "READY".equals(s.state())) {
            events.add(this.json.valueToTree(Map.of("event", names.get(i), "at", s.at())));
         }
      }

      out.set("events", events);
      ArrayNode batches = this.json.createArrayNode();

      for (FoundationProcessingService.History h : result.history()) {
         batches.add(
            this.json
               .valueToTree(
                  Map.of("at", h.createdAt(), "version", result.version(), "actor", "处理服务", "operation", h.stage(), "status", h.state(), "reason", h.detail())
               )
         );
      }

      out.set("batches", batches);
      if (!"table".equals(a.path("kind").asText())) {
         out.putNull("dictionary");
      } else {
         ObjectNode d = this.json.createObjectNode();
         d.put("status", a.path("dictionaryStatus").asText("waiting"));
         d.put("current", a.has("publicationId") || result.stages().get(2).state().equals("READY"));
         d.put("revision", result.version());
         d.set("at", a.path("publishedAt").isMissingNode() ? this.json.nullNode() : a.path("publishedAt"));
         d.put("provider", a.has("publicationId") ? "已发布原生治理任务" : "来源字段定义");
         d.put("tableMeaning", result.name());
         d.put("usageRules", "按来源字段和已保存说明使用；未知业务含义仍需核实。");
         d.putNull("job");
         d.set("warnings", a.path("issues").deepCopy());
         d.set("relations", this.json.createArrayNode());
         ArrayNode fields = this.json.createArrayNode();

         for (FoundationProcessingService.Field f : result.fields()) {
            ObjectNode n = this.json.createObjectNode();
            n.put("name", f.name());
            n.put("label", f.name());
            n.put("type", f.type());
            n.put("meaning", f.meaning());
            n.put("unit", f.unit());
            n.put("evidence", f.evidence());
            n.put("status", f.origin());
            n.put("rules", "");
            n.put("required", false);
            n.put("unique", false);
            n.put("sensitive", false);
            fields.add(n);
         }

         d.set("fields", fields);
         out.set("dictionary", d);
      }

      return out;
   }

   @Transactional(isolation = Isolation.REPEATABLE_READ)
   public JsonNode snapshot(UUID actor, UUID tenant) {
      return this.snapshotInside(actor, tenant, null);
   }

   private JsonNode snapshotInside(UUID actor, UUID tenant, String target) {
      this.identities.member(actor, tenant, false);
      Map<String, FoundationPublicationService.Entry> published = this.publications.current(actor, tenant, target);
      ArrayNode items = this.json.createArrayNode();
      ArrayList<UUID> visibleMaterials = new ArrayList<>();
      int datasets = 0;
      int documents = 0;
      int parsed = 0;
      int annotated = 0;
      int checked = 0;
      int usable = 0;
      int offset = 0;

      while (true) {
         CollectionService.DataPage page = this.collections.datasets(actor, tenant, "", offset, 100);

         for (CollectionService.Dataset d : page.items()) {
            if (target == null || target.equals("dataset-" + d.id())) {
               ObjectNode a = this.base(
                  "dataset-" + d.id(),
                  d.name(),
                  d.workspaceName(),
                  "table",
                  0,
                  d.version() == null ? 0 : d.version(),
                  d.collectedAt() == null ? null : d.collectedAt().toString()
               );
               boolean collected = d.version() != null;
               List<String> states = FoundationProcessingService.datasetStageStates(collected, d.fieldDefinitions());
               boolean explained = "READY".equals(states.get(2));
               if (collected) {
                  parsed++;
               }

               if (explained) {
                  annotated++;
               }

               a.set("stageStates", this.json.valueToTree(states));
               a.put("gate", collected ? (explained ? 3 : 2) : 0);
               a.put("needsAttention", collected);
               a.put("available", false);
               a.put("label", collected ? "已采集 · 待治理检查与发布" : "等待采集");
               a.put("total", d.rowCount() == null ? 0 : d.rowCount());
               a.putNull("ready");
               a.put("fieldCount", d.columns().size());
               a.put("dictionaryStatus", d.fieldDefinitions().isEmpty() ? "waiting" : (explained ? "source-defined" : "partial"));
               a.put("source", "企业业务数据");
               items.add(a);
               datasets++;
            }
         }

         if (!page.hasMore()) {
            Set<UUID> publishedMaterials = target != null && target.startsWith("dataset-")
               ? Set.of()
               : this.materialGovernance
                  .currentFor(actor, tenant, target != null && target.startsWith("material-") ? UUID.fromString(target.substring(9)) : null)
                  .stream()
                  .map(NativeMaterialGovernance.Published::materialId)
                  .collect(Collectors.toSet());
            int offsetx = 0;

            while (true) {
               MaterialService.Page pagex = this.materials.list(actor, tenant, null, null, "", offsetx, 100);

               for (MaterialService.Entry d : pagex.items()) {
                  if ("DOCUMENT".equals(d.kind()) && (target == null || target.equals("material-" + d.id()))) {
                     visibleMaterials.add(d.id());
                     ObjectNode a = this.base("material-" + d.id(), d.name(), d.workspaceName(), "document", 1, d.version(), d.updatedAt().toString());
                     MaterialService.Pipeline pipeline = this.materials.pipeline(actor, tenant, d.workspaceId(), d.id());
                     boolean ready = "READY".equals(pipeline.parsing());
                     boolean examined = "CHECKED".equals(pipeline.governance());
                     boolean readable = Set.of("READY", "PARTIAL").contains(pipeline.parsing()) && this.searchReady(tenant, d.id());
                     if (ready) {
                        parsed++;
                     }

                     if (examined) {
                        checked++;
                     }

                     boolean tagged = examined
                        && Boolean.TRUE
                           .equals(
                              this.db
                                 .queryForObject(
                                    "SELECT coalesce((SELECT cardinality(tags)>0 FROM material_governance_reports WHERE tenant_id=? AND material_id=? ORDER BY revision DESC LIMIT 1),false)",
                                    Boolean.class,
                                    new Object[]{tenant, d.id()}
                                 )
                           );
                     if (tagged) {
                        annotated++;
                     }

                     boolean hasPublication = "PUBLISHED".equals(pipeline.publication()) || publishedMaterials.contains(d.id());
                     boolean usableNow = readable && examined && pipeline.issues() == 0 && hasPublication;
                     if (usableNow) {
                        usable++;
                     }

                     a.put("gate", !ready ? 1 : (!tagged ? 2 : (examined && pipeline.issues() == 0 ? 4 : 3)));
                     a.put("available", usableNow);
                     a.put("rawSearchReady", readable);
                     a.put("needsAttention", !usableNow);
                     a.put("checksPassed", examined && pipeline.issues() == 0);
                     a.set(
                        "stageStates",
                        this.json
                           .valueToTree(
                              List.of(
                                 "READY",
                                 pipeline.parsing(),
                                 tagged ? "READY" : "WAITING",
                                 examined ? (pipeline.issues() == 0 ? "READY" : "ATTENTION") : "WAITING",
                                 usableNow ? "READY" : "WAITING"
                              )
                           )
                     );
                     a.put("label", "解析：" + pipeline.parsing() + " · 治理：" + pipeline.governance());
                     a.put("source", "企业资料库");
                     items.add(a);
                     documents++;
                  }
               }

               if (!pagex.hasMore()) {
                  parsed = 0;
                  annotated = 0;
                  checked = 0;
                  usable = 0;

                  for (JsonNode item : items) {
                     ObjectNode a = (ObjectNode)item;
                     this.publications.apply(a, published.get(a.path("id").asText()));
                     JsonNode stages = a.path("stageStates");
                     if ("READY".equals(stages.path(1).asText())) {
                        parsed++;
                     }

                     if ("READY".equals(stages.path(2).asText())) {
                        annotated++;
                     }

                     if ("READY".equals(stages.path(3).asText())) {
                        checked++;
                     }

                     if (a.path("available").asBoolean()) {
                        usable++;
                     }
                  }

                  ObjectNode out = this.json.createObjectNode();
                  out.put("nativePlatform", true);
                  out.put("at", Instant.now().toString());
                  out.set("items", items);
                  out.set("user", this.json.valueToTree(Map.of("name", "当前企业成员", "role", "member")));
                  out.set("tenant", this.json.valueToTree(Map.of("name", "企业数据基座")));
                  out.set("model", this.json.valueToTree(Map.of("configured", false, "enabled", false, "model", "")));
                  out.set("passed", this.json.valueToTree(List.of(items.size(), parsed, annotated, checked, usable)));
                  out.set(
                     "sources",
                     this.json
                        .valueToTree(
                           List.of(Map.of("name", "外部数据集", "count", datasets), Map.of("name", "内部资料库", "count", documents), Map.of("name", "外网数据集", "count", 0))
                        )
                  );
                  ObjectNode governance = this.json.createObjectNode();
                  governance.put(
                     "attention", StreamSupport.<JsonNode>stream(items.spliterator(), false).filter(ax -> ax.path("needsAttention").asBoolean()).count()
                  );
                  governance.put("isolated", 0);
                  governance.put("overdue", 0);
                  governance.put("failed", 0);
                  governance.putNull("averageQuality");
                  governance.set("departments", this.json.createArrayNode());
                  out.set("governance", governance);
                  out.putNull("auditValid");
                  out.put("canScan", false);
                  out.set(
                     "adapters",
                     this.json
                        .valueToTree(
                           List.of(
                              Map.of(
                                 "name",
                                 "Docling PDF 解析",
                                 "enabled",
                                 (Serializable)this.environment.getProperty("dreamcore.knowledge.docling-enabled", Boolean.class, false),
                                 "scope",
                                 "PDF 解析；结果仍需治理复核"
                              ),
                              Map.of(
                                 "name",
                                 "WeKnora 索引、混合检索与重排",
                                 "enabled",
                                 (Serializable)this.environment.getProperty("dreamcore.weknora.enabled", Boolean.class, false),
                                 "scope",
                                 this.indexStatus(tenant, visibleMaterials)
                              )
                           )
                        )
                  );
                  return out;
               }

               if (offsetx >= 9900) {
                  throw new IdentityException(409, "SCENE_ASSET_LIMIT");
               }

               offsetx += 100;
            }
         }

         if (offset >= 9900) {
            throw new IdentityException(409, "SCENE_ASSET_LIMIT");
         }

         offset += 100;
      }
   }

   private boolean searchReady(UUID tenant, UUID material) {
      boolean remote = (Boolean)this.environment.getProperty("dreamcore.weknora.enabled", Boolean.class, false)
         && Boolean.TRUE
            .equals(
               this.db
                  .queryForObject("SELECT EXISTS(SELECT 1 FROM knowledge_index_targets WHERE tenant_id=? AND enabled)", Boolean.class, new Object[]{tenant})
            );
      return Boolean.TRUE
         .equals(
            this.db
               .queryForObject(
                  "SELECT count(*)>0 AND bool_and(NOT ? OR (coalesce(i.state='READY',false) AND i.remote_id IS NOT NULL AND coalesce(t.enabled,false)))\nFROM active_materials m JOIN material_versions v ON v.material_id=m.id AND v.number=m.current_version\nJOIN LATERAL (SELECT id FROM knowledge_runs WHERE version_id=v.id ORDER BY generation DESC LIMIT 1) r ON true\nJOIN knowledge_chunks c ON c.run_id=r.id AND c.version_id=v.id\nLEFT JOIN knowledge_remote_index i ON i.chunk_id=c.id AND i.tenant_id=c.tenant_id\nLEFT JOIN knowledge_index_targets t ON t.tenant_id=i.tenant_id AND t.knowledge_base_id=i.knowledge_base_id\nWHERE m.tenant_id=? AND m.id=?\n",
                  Boolean.class,
                  new Object[]{remote, tenant, material}
               )
         );
   }

   private String indexStatus(UUID tenant, List<UUID> materials) {
      boolean bound = Boolean.TRUE
         .equals(
            this.db.queryForObject("SELECT EXISTS(SELECT 1 FROM knowledge_index_targets WHERE tenant_id=? AND enabled)", Boolean.class, new Object[]{tenant})
         );
      if (!bound) {
         return "企业知识库尚未绑定启用";
      }

      if (materials.isEmpty()) {
         return "企业知识库已绑定；当前没有获权资料";
      }

      ArrayList<Object> args = new ArrayList<>();
      args.add(tenant);
      args.addAll(materials);
      List<Map<String, Object>> rows = this.db
         .queryForList(
            "SELECT state,count(*) AS n FROM knowledge_remote_index WHERE tenant_id=? AND material_id IN ("
               + String.join(",", Collections.nCopies(materials.size(), "?"))
               + ") GROUP BY state ORDER BY state",
            args.toArray()
         );
      Map<String, String> labels = Map.of(
         "QUEUED",
         "排队",
         "UPLOADING",
         "上传中",
         "INDEXING",
         "索引中",
         "READY",
         "就绪",
         "FAILED",
         "失败",
         "UNKNOWN",
         "待核查",
         "DELETE_PENDING",
         "待删除",
         "DELETING",
         "删除中",
         "DELETED",
         "已删除"
      );
      return "企业知识库已绑定 · 当前获权资料的索引片段："
         + (rows.isEmpty() ? "等待建立" : String.join("、", rows.stream().map(r -> labels.get((String)r.get("state")) + " " + r.get("n")).toList()))
         + "；此为持久化任务状态，不代表实时服务健康";
   }

   private ObjectNode base(String id, String title, String space, String kind, int source, int version, String at) {
      ObjectNode a = this.json.createObjectNode();
      a.put("id", id);
      a.put("title", title);
      a.put("department", space);
      a.put("kind", kind);
      a.put("sourceKind", source);
      a.put("status", "received");
      a.put("gate", 0);
      a.put("available", false);
      a.put("needsAttention", false);
      a.put("checksPassed", false);
      a.put("paused", false);
      a.put("version", version);
      a.put("policyVersion", 0);
      a.put("updatedAt", at);
      a.putNull("reviewAt");
      a.put("quality", 0);
      a.put("classification", 0);
      a.set("issues", this.json.createArrayNode());
      a.set("tags", this.json.createArrayNode());
      a.putNull("total");
      a.putNull("ready");
      a.put("isolated", 0);
      a.put("fieldCount", 0);
      a.putNull("dictionaryStatus");
      a.set("actions", this.json.createArrayNode());
      a.put("tone", "plain");
      a.put("updatePolicy", "按原数据集与资料版本处理");
      a.putNull("sync");
      return a;
   }
}
