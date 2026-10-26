package com.dreamcore.workspace.scene;

import com.dreamcore.workspace.collection.NativeGovernanceDeployment;
import com.dreamcore.workspace.collection.NativeMaterialGovernance;
import com.dreamcore.workspace.governance.GovernanceReferencePolicy;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.IdentityService;
import com.dreamcore.workspace.knowledge.WikiArticleService;
import com.dreamcore.workspace.material.MaterialService;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

@Service
public class NativeKnowledgeService {
   @Autowired
   private NativeGovernanceDeployment governance;
   @Autowired
   private NativeMaterialGovernance materialGovernance;
   @Autowired
   private com.dreamcore.workspace.knowledge.DatasetKnowledgeService datasetKnowledge;
   @Autowired
   private com.dreamcore.workspace.knowledge.DatasetBusinessKnowledgeService businessKnowledge;
   private final MaterialService materials;
   private final WikiArticleService articles;
   private final IdentityService identities;
   private final JsonMapper json = new JsonMapper();

   public NativeKnowledgeService(MaterialService materials, WikiArticleService articles, IdentityService identities) {
      this.materials = materials;
      this.articles = articles;
      this.identities = identities;
   }

   private Map<String, Object> card(String id, String name, String group, String why, String content, List<?> rows, List<String> actions) {
      return Map.of(
         "id",
         id,
         "name",
         name,
         "group",
         group,
         "why",
         why,
         "side",
         group,
         "tone",
         "plain",
         "verdict",
         content,
         "kvHead",
         List.of("项", "内容", "状态"),
         "kv",
         rows,
         "actions",
         actions
      );
   }

   private List<MaterialService.Entry> sources(UUID actor, UUID tenant) {
      ArrayList<MaterialService.Entry> out = new ArrayList<>();

      for (int offset = 0; offset <= 9900; offset += 100) {
         MaterialService.Page page = this.materials.list(actor, tenant, null, null, "", offset, 100);

         for (MaterialService.Entry entry : page.items()) {
            if ("DOCUMENT".equals(entry.kind())) {
               out.add(entry);
            }
         }

         if (!page.hasMore()) {
            return out;
         }
      }

      throw new IdentityException(409, "SCENE_ASSET_LIMIT");
   }

   @Transactional
   public JsonNode snapshot(UUID actor, UUID tenant) {
      this.identities.member(actor, tenant, false);
      ArrayList<Map<String, Object>> items = new ArrayList<>();
      ArrayList<Map<String, Object>> waiting = new ArrayList<>();
      HashSet<UUID> published = new HashSet<>();

      for (int offset = 0; offset <= 9980; offset += 20) {
         WikiArticleService.Page page = this.articles.list(actor, tenant, false, offset);

         for (WikiArticleService.Item a : page.items()) {
            if (!a.sourceChanged() && a.article() != null) {
               published.add(a.materialId());
               items.add(
                  this.card(
                     "article-" + a.id(),
                     a.article().title(),
                     "已发布资料知识",
                     a.article().intro(),
                     a.article().content(),
                     List.of(List.of("来源", a.sourceName(), "v" + a.sourceVersion(), "plain")),
                     List.of("查看来源", "重新核验")
                  )
               );
            }
         }

         if (!page.hasMore()) {
            break;
         }

         if (offset == 9980) {
            throw new IdentityException(409, "SCENE_ASSET_LIMIT");
         }
      }

      List<NativeGovernanceDeployment.Published> governed = (List<NativeGovernanceDeployment.Published>)GovernanceReferencePolicy.referenceCards(
         this.governance, actor, tenant
      );

      for (NativeGovernanceDeployment.Published g : governed) {
         items.add(
            this.card(
               "deployment-" + g.releaseId() + "-" + g.datasetId(),
               "数据治理参考知识",
               "Codex首期部署成果",
               "绑定数据快照与企业背景；仅当前授权接收人可读",
               g.knowledge(),
               List.of(List.of("依据", String.join("；", g.evidence()), "当前版本", "plain")),
               List.of()
            )
         );
      }

      for (NativeMaterialGovernance.Published m : this.materialGovernance.current(actor, tenant)) {
         published.add(m.materialId());
         items.add(
            this.card(
               "material-deployment-" + m.releaseId() + "-" + m.materialId(),
               m.title(),
               "Codex首期资料成果",
               "绑定原件、解析版本、企业背景及当前权限",
               m.content(),
               List.of(),
               List.of()
            )
         );
      }

      var businessArticles=this.businessKnowledge.current(actor,tenant);
      for(var article:businessArticles) {
         items.add(this.card("deployment-business-"+article.id(),article.title(),"AI 经营知识",
            "覆盖当前获权数据集；计算事实、AI 解读与建议分开展示",article.content(),List.of(),List.of()));
      }

      var automatic = this.datasetKnowledge.current(actor, tenant);
      for (var article : automatic) {
         items.add(this.card("deployment-auto-" + article.id(), article.title(), "数据口径知识",
            "已确认口径自动整理；来源与权限持续核验", article.content(),
            List.of(List.of("依据", "已发布数据口径 " + article.releaseId(), "当前有效", "plain")), List.of()));
      }

      List<MaterialService.Entry> sourceList = this.sources(actor, tenant);

      for (MaterialService.Entry s : sourceList) {
         if (!published.contains(s.id())) {
            waiting.add(
               this.card(
                  "material-" + s.id(),
                  s.name(),
                  "资料来源待发布",
                  "尚无当前有效的已发布知识",
                  "此项是获权资料来源，不是已发布知识。解析、学习草稿和确认发布是不同步骤。",
                  List.of(List.of("来源空间", s.workspaceName(), "v" + s.version(), "plain")),
                  List.of("查看来源", "重新核验")
               )
            );
         }
      }

      LinkedHashMap<String, Integer> kinds = new LinkedHashMap<>();

      for (Map<String, Object> i : items) {
         kinds.put(i.get("id").toString(), i.get("id").toString().startsWith("deployment-") ? 0 : 1);
      }

      ObjectNode out = this.json.createObjectNode();
      out.set("items", this.json.valueToTree(items));
      out.set("relations", this.json.createArrayNode());
      out.set("sourceKind", this.json.valueToTree(kinds));
      int pendingReview = this.governance.pendingReview(actor, tenant);
      out.put("pending", pendingReview);
      out.put("failed", 0);
      out.put("busy", false);
      out.put("available", true);
      out.put("needsGraph", false);
      out.put("scopeRevision", IdentityService.hash(this.json.writeValueAsString(List.of(items, waiting))));
      out.set(
         "tabs",
         this.json
            .valueToTree(
               List.of(
                  Map.of("label", "全部 " + items.size(), "items", items),
                  Map.of("label", "资料来源待发布 " + waiting.size(), "items", waiting),
                  Map.of(
                     "label",
                     "来自资料 " + items.stream().filter(i -> !i.get("id").toString().startsWith("deployment-")).count(),
                     "items",
                     items.stream().filter(i -> !i.get("id").toString().startsWith("deployment-")).toList()
                  ),
                  Map.of("label", "来自数据 " + (governed.size() + automatic.size() + businessArticles.size()), "items", items.stream().filter(i -> i.get("id").toString().startsWith("deployment-")).toList())
               )
            )
      );
      out.set(
         "stats",
         this.json
            .valueToTree(
               Map.of(
                  "title",
                  "知识构成",
                  "rows",
                  List.<List<String>>of(
                     List.of("已发布知识", String.valueOf(items.size())),
                     List.of("获权资料来源", String.valueOf(sourceList.size())),
                     List.of("待发布来源", String.valueOf(waiting.size()))
                  )
               )
            )
      );
      out.set(
         "aside",
         this.json.valueToTree(Map.of("title", "当前服务", "rows", List.<List<String>>of(List.of("数据来源", "平台原生资料、已发布知识与已确认数据口径"), List.of("核验", "已启用企业由后台自动整理数据口径知识；本页刷新权限和版本"))))
      );
      out.put("status", items.size() + " 条已发布知识 · " + waiting.size() + " 份资料待发布 · " + pendingReview + " 项数据成果待复核");
      return out;
   }

   @Transactional
   public JsonNode source(UUID actor, UUID tenant, String id) {
      this.identities.member(actor, tenant, false);

      UUID material;
      try {
         if (id.startsWith("article-")) {
            WikiArticleService.Item a = this.articles.detail(actor, tenant, UUID.fromString(id.substring(8)));
            if (a.archived() || a.sourceChanged()) {
               throw new IdentityException(404, "MATERIAL_NOT_FOUND");
            }

            material = a.materialId();
         } else {
            if (!id.startsWith("material-")) {
               throw new IllegalArgumentException();
            }

            material = UUID.fromString(id.substring(9));
         }
      } catch (IllegalArgumentException e) {
         throw new IdentityException(404, "MATERIAL_NOT_FOUND");
      }

      MaterialService.Entry s = this.sources(actor, tenant)
         .stream()
         .filter(x -> x.id().equals(material))
         .findFirst()
         .orElseThrow(() -> new IdentityException(404, "MATERIAL_NOT_FOUND"));
      MaterialService.Detail detail = this.materials.detail(actor, tenant, s.workspaceId(), s.id(), 0, 1);
      return this.json
         .valueToTree(
            this.card(
               id,
               s.name(),
               "资料来源",
               "当前获权资料版本",
               "来源元数据；此处不展示或下载原文，不代表已生成知识。",
               List.of(
                  List.of("空间", s.workspaceName(), "当前授权", "plain"),
                  List.of("版本", "v" + s.version(), detail.versions().isEmpty() ? "未知" : detail.versions().getFirst().id().toString(), "plain")
               ),
               List.of("返回知识")
            )
         );
   }
}
