package com.dreamcore.workspace.scene;

import com.dreamcore.workspace.collection.CollectionService;
import com.dreamcore.workspace.collection.DatasetField;
import com.dreamcore.workspace.collection.NativeMaterialGovernance;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.IdentityService;
import com.dreamcore.workspace.knowledge.KnowledgeService;
import com.dreamcore.workspace.material.MaterialAccess;
import com.dreamcore.workspace.material.MaterialService;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class FoundationProcessingService {
   private final JdbcTemplate db;
   private final CollectionService collections;
   private final MaterialService materials;
   private final MaterialAccess access;
   private final IdentityService identities;
   private final KnowledgeService knowledge;
   @Autowired
   private NativeMaterialGovernance materialGovernance;
   @Autowired
   private FoundationPublicationService publications;
   @Autowired
   private com.dreamcore.workspace.governance.GovernanceModelService governanceJobs;
   private final Environment environment;

   public FoundationProcessingService(
      JdbcTemplate db,
      CollectionService collections,
      MaterialService materials,
      MaterialAccess access,
      IdentityService identities,
      KnowledgeService knowledge,
      Environment environment
   ) {
      this.db = db;
      this.collections = collections;
      this.materials = materials;
      this.access = access;
      this.identities = identities;
      this.knowledge = knowledge;
      this.environment = environment;
   }

   private IdentityException missing() {
      return new IdentityException(404, "FOUNDATION_ASSET_NOT_FOUND");
   }

   private String time(Object value) {
      return value instanceof Timestamp t ? t.toInstant().toString() : (value == null ? null : value.toString());
   }

   private FoundationProcessingService.Stage stage(String key, String name, String state, Object at, String detail, List<String> outputs, List<String> fields) {
      return new FoundationProcessingService.Stage(key, name, state, this.time(at), detail, outputs, fields);
   }

   private void revision(String expected, String actual) {
      if (expected != null && !expected.equals(actual)) {
         throw new IdentityException(409, "FOUNDATION_VERSION_CHANGED");
      }
   }

   @Transactional(isolation = Isolation.REPEATABLE_READ)
   public FoundationProcessingService.Result read(UUID actor, UUID tenant, String asset, int offset, int limit, String expected) {
      this.identities.member(actor, tenant, false);
      if (asset != null
         && asset.length() <= 200
         && offset >= 0
         && offset <= 100000
         && limit >= 1
         && limit <= 20
         && (expected == null || expected.length() <= 160)) {
         String kind;
         UUID target;
         try {
            if (asset.startsWith("dataset-")) {
               kind = "TABLE";
               target = UUID.fromString(asset.substring(8));
            } else if (!asset.startsWith("material-") && !asset.startsWith("file-")) {
               List<Map<String, Object>> links = this.db
                  .queryForList("SELECT kind,target_id FROM scene_asset_links WHERE tenant_id=? AND source_id=? AND active", new Object[]{tenant, asset});
               if (links.size() != 1) {
                  throw this.missing();
               }

               kind = links.getFirst().get("kind").toString();
               target = (UUID)links.getFirst().get("target_id");
            } else {
               kind = "DOCUMENT";
               target = UUID.fromString(asset.substring(asset.indexOf(45) + 1));
            }
         } catch (IllegalArgumentException invalid) {
            throw IdentityException.invalid();
         }

         if ("TABLE".equals(kind)) {
            return this.dataset(actor, tenant, asset, target, offset, limit, expected);
         }

         List<Map<String, Object>> scopes = this.db
            .queryForList("SELECT workspace_id FROM active_materials WHERE tenant_id=? AND id=?", new Object[]{tenant, target});
         if (scopes.isEmpty()) {
            throw this.missing();
         }

         UUID workspace = (UUID)scopes.getFirst().get("workspace_id");
         this.access.requireObject(actor, tenant, workspace, "MATERIAL", target, false);
         this.access.requireMaterialActive(tenant, workspace, target);
         List<Map<String, Object>> admitted = this.db
            .queryForList(
               "SELECT f.dataset_id FROM file_table_sources f JOIN material_versions v ON v.id=f.version_id JOIN active_materials m ON m.id=f.material_id AND m.current_version=v.number WHERE f.tenant_id=? AND f.material_id=? AND f.state='READY' AND f.dataset_id IS NOT NULL",
               new Object[]{tenant, target}
            );
         if (admitted.isEmpty()) {
            return this.document(actor, tenant, workspace, asset, target, offset, limit, expected);
         }

         FoundationProcessingService.Result table = this.dataset(actor, tenant, asset, (UUID)admitted.getFirst().get("dataset_id"), offset, limit, null);
         MaterialService.Detail original = this.materials.detail(actor, tenant, workspace, target, 0, 1);
         MaterialService.Version version = original.versions().getFirst();
         String stamp = IdentityService.hash(version.id() + ":" + table.revision());
         this.revision(expected, stamp);
         ArrayList<FoundationProcessingService.Stage> stages = new ArrayList<>(table.stages());
         stages.set(
            0,
            this.stage(
               "received",
               "原件接入",
               "READY",
               version.createdAt(),
               "保留原件权限与文件版本；表格快照为该版本的派生产物",
               List.of(version.filename(), "来源文件 v" + version.number()),
               List.of()
            )
         );
         ArrayList<FoundationProcessingService.History> history = new ArrayList<>(table.history());

         for (Map<String, Object> run : this.db
            .queryForList(
               "SELECT id,status,generation,created_at,finished_at FROM knowledge_runs WHERE tenant_id=? AND version_id=? ORDER BY generation DESC LIMIT 20",
               new Object[]{tenant, version.id()}
            )) {
            history.add(
               new FoundationProcessingService.History(
                  run.get("id").toString(),
                  "原件解析",
                  run.get("status").toString(),
                  this.time(run.get("created_at")),
                  this.time(run.get("finished_at")),
                  "文件 v" + version.number() + " · 第 " + run.get("generation") + " 次解析"
               )
            );
         }

         history.sort(Comparator.comparing(FoundationProcessingService.History::createdAt).reversed());
         return new FoundationProcessingService.Result(
            asset,
            original.document().name(),
            version.number(),
            stamp,
            table.recordKind(),
            table.recordCount(),
            table.fields(),
            table.records(),
            offset,
            table.hasMore(),
            stages,
            history,
            table.notes()
         );
      } else {
         throw IdentityException.invalid();
      }
   }

   static List<String> datasetStageStates(boolean collected, List<DatasetField> fields) {
      boolean explained = collected && !fields.isEmpty() && fields.stream().allMatch(f -> "SOURCE_DOCUMENTED".equals(f.status()));
      return List.of(
         collected ? "READY" : "WAITING",
         collected ? "READY" : "WAITING",
         explained ? "READY" : (collected && !fields.isEmpty() ? "PARTIAL" : "WAITING"),
         "WAITING",
         "WAITING"
      );
   }

   private FoundationProcessingService.Result dataset(UUID actor, UUID tenant, String asset, UUID id, int offset, int limit, String expected) {
      CollectionService.Preview preview = this.collections.preview(actor, tenant, id, offset, limit);
      CollectionService.Dataset d = preview.dataset();
      Map<String, Object> heads = this.db
         .queryForMap("SELECT current_snapshot,field_definitions::text FROM business_datasets WHERE tenant_id=? AND id=?", new Object[]{tenant, id});
      FoundationPublicationService.Entry published = this.publications.current(actor, tenant, "dataset-" + id).get("dataset-" + id);
      String stamp = IdentityService.hash(
         "" + heads.get("current_snapshot") + heads.get("field_definitions") + (published == null ? "" : published.releaseId())
      );
      this.revision(expected, stamp);
      ArrayList<FoundationProcessingService.Field> fields = new ArrayList<>();

      for (String column : d.columns()) {
         DatasetField f = d.fieldDefinitions().stream().filter(x -> column.equals(x.column())).findFirst().orElse(null);
         fields.add(
            new FoundationProcessingService.Field(
               column,
               f == null ? "未标注" : f.type(),
               f == null ? "尚未提供业务含义" : f.meaning(),
               f == null ? "" : f.unit(),
               "SOURCE_COLUMN",
               f == null ? "来源列名；尚无字段说明" : f.evidence()
            )
         );
      }

      boolean ready = d.version() != null;
      List<String> states = datasetStageStates(ready, d.fieldDefinitions());
      List<FoundationProcessingService.History> history = this.db
         .queryForList(
            "SELECT r.id,r.status,r.created_at,r.finished_at,s.version,s.row_count FROM dataset_snapshots s JOIN collection_runs r ON r.id=s.run_id WHERE s.tenant_id=? AND s.dataset_id=? ORDER BY s.version DESC LIMIT 20",
            new Object[]{tenant, id}
         )
         .stream()
         .map(
            r -> new FoundationProcessingService.History(
               r.get("id").toString(),
               "数据采集",
               r.get("status").toString(),
               this.time(r.get("created_at")),
               this.time(r.get("finished_at")),
               "快照 v" + r.get("version") + " · " + r.get("row_count") + " 条记录"
            )
         )
         .toList();
      List<FoundationProcessingService.Stage> stages = List.of(
         this.stage(
            "received",
            "数据接入",
            ready ? "READY" : "WAITING",
            d.collectedAt(),
            "按来源授权范围采集并保存独立快照",
            ready ? List.of("数据快照 v" + d.version()) : List.of(),
            List.of()
         ),
         this.stage(
            "structure",
            "解析与结构化",
            ready ? "READY" : "WAITING",
            d.collectedAt(),
            "沿用来源字段，将记录按列保存；没有新增推测字段",
            List.of((d.rowCount() == null ? 0 : d.rowCount()) + " 条记录", fields.size() + " 个来源字段"),
            d.columns()
         ),
         this.stage(
            "dictionary",
            "字段口径",
            states.get(2),
            null,
            "字段解释随部署定义保存；推断或未知项仍需核实，未单独记录生成时间",
            List.of(d.fieldDefinitions().size() + " 项字段说明"),
            d.fieldDefinitions().stream().map(DatasetField::column).toList()
         ),
         this.stage("checks", "治理检查", states.get(3), null, "采集结构校验不等于治理检查；尚无当前快照的治理检查回执", List.of(), List.of()),
         this.stage("available", "治理后 AI 可用", states.get(4), null, "原始快照可按权限读取；尚无通过治理检查并发布的记录范围，不计入治理后AI可用", List.of(), List.of())
      );
      if (ready && published == null) {
         var status = this.governanceJobs.datasetStatus(actor, tenant, id);
         String state = status.get("state").toString();
         String dictionaryState = switch (state) {
            case "WAITING_MODEL", "VALIDATING" -> "RUNNING";
            case "DRAFT_READY" -> "READY";
            case "FAILED" -> "FAILED";
            default -> "WAITING";
         };
         var updated = new ArrayList<>(stages);
         updated.set(2, this.stage("dictionary", "字段口径", dictionaryState, null, status.get("message").toString(), List.of(), d.columns()));
         if ("DRAFT_READY".equals(state)) updated.set(3, this.stage("checks", "治理检查", "PARTIAL", null,
            "草稿格式和引用已检查，仍待核对并发布；没有来源约束的检查项与未知字段不能视为已通过", List.of("治理草稿"), List.of()));
         stages = List.copyOf(updated);
      }
      return this.publications
         .apply(
            new FoundationProcessingService.Result(
               asset,
               d.name(),
               d.version() == null ? 0 : d.version(),
               stamp,
               "DATASET_ROWS",
               d.rowCount() == null ? 0 : d.rowCount(),
               fields,
               preview.rows(),
               offset,
               preview.hasMore(),
               stages,
               history,
               List.of("字段来自来源表或原文件表头；字段含义的解释不改写原始记录。", "记录分页读取，空值与重复值按来源保留。")
            ),
            published
         );
   }

   private FoundationProcessingService.Result document(
      UUID actor, UUID tenant, UUID workspace, String asset, UUID material, int offset, int limit, String expected
   ) {
      MaterialService.Detail m = this.materials.detail(actor, tenant, workspace, material, 0, 1);
      MaterialService.Version current = m.versions().getFirst();
      MaterialService.Pipeline pipeline = this.materials.pipeline(actor, tenant, workspace, material);
      KnowledgeService.Analysis analysis = this.knowledge.analysis(actor, tenant, workspace, material, current.id(), offset, limit);
      List<Map<String, Object>> runs = this.db
         .queryForList(
            "SELECT id,generation,status,parser_version,created_at,finished_at FROM knowledge_runs WHERE tenant_id=? AND version_id=? ORDER BY generation DESC LIMIT 20",
            new Object[]{tenant, current.id()}
         );
      Map<String, Object> latest = runs.isEmpty() ? null : runs.getFirst();
      Object runId = latest == null ? null : latest.get("id");
      FoundationPublicationService.Entry publication = this.publications.current(actor, tenant, "material-" + material).get("material-" + material);
      String stamp = IdentityService.hash(current.id() + ":" + runId + (publication == null ? "" : publication.releaseId()));
      this.revision(expected, stamp);
      int count = runId == null
         ? 0
         : (Integer)this.db
            .queryForObject(
               "SELECT count(*) FROM knowledge_chunks WHERE tenant_id=? AND version_id=? AND run_id=?",
               Integer.class,
               new Object[]{tenant, current.id(), runId}
            );
      List<FoundationProcessingService.Field> fields = List.of(
         new FoundationProcessingService.Field("id", "UUID", "解析记录标识", "", "PARSER_OUTPUT", "knowledge_chunks.id"),
         new FoundationProcessingService.Field("ordinal", "INTEGER", "片段顺序，从 0 开始", "", "PARSER_OUTPUT", "knowledge_chunks.ordinal"),
         new FoundationProcessingService.Field("locator", "TEXT", "原文位置，例如页码、段落或表格范围", "", "PARSER_OUTPUT", "解析器定位结果"),
         new FoundationProcessingService.Field("method", "ENUM", "处理方式：TEXT 文本、TABLE 表格、OCR 识别", "", "PARSER_OUTPUT", "解析器处理结果"),
         new FoundationProcessingService.Field("content", "TEXT", "该记录保存的正文片段", "", "PARSER_OUTPUT", "解析后的来源内容"),
         new FoundationProcessingService.Field("material_id", "UUID", "来源资料标识", "", "SOURCE_METADATA", "绑定原资料"),
         new FoundationProcessingService.Field("version_id", "UUID", "来源文件版本标识", "", "SOURCE_METADATA", "绑定确切文件版本"),
         new FoundationProcessingService.Field("run_id", "UUID", "产生该记录的解析批次标识", "", "SOURCE_METADATA", "绑定确切解析任务")
      );
      HashMap<UUID, Integer> ordinals = new HashMap<>();
      if (this.parsedStatus(analysis.status())) {
         for (Map<String, Object> row : this.db
            .queryForList(
               "SELECT id,ordinal FROM knowledge_chunks WHERE tenant_id=? AND run_id=? ORDER BY ordinal LIMIT ? OFFSET ?",
               new Object[]{tenant, runId, limit, offset}
            )) {
            ordinals.put((UUID)row.get("id"), (Integer)row.get("ordinal"));
         }
      }

      List<List<String>> records = analysis.chunks()
         .stream()
         .map(
            c -> List.of(
               c.id().toString(),
               String.valueOf(ordinals.get(c.id())),
               c.locator(),
               c.method(),
               c.content(),
               c.materialId().toString(),
               c.versionId().toString(),
               c.runId().toString()
            )
         )
         .toList();
      List<Map<String, Object>> governance = this.db
         .queryForList(
            "SELECT id,checked_at,tags,review_at,revision FROM material_governance_reports WHERE tenant_id=? AND version_id=? AND (run_id IS NULL OR run_id=?::uuid) ORDER BY revision DESC LIMIT 20",
            new Object[]{tenant, current.id(), runId}
         );
      Map<String, Object> report = governance.isEmpty() ? null : governance.getFirst();
      boolean parsed = Set.of("READY", "PARTIAL").contains(analysis.status());
      boolean indexed = parsed && count > 0 && this.searchReady(tenant, material);
      boolean published = "PUBLISHED".equals(pipeline.publication())
         || this.materialGovernance.currentFor(actor, tenant, material).stream().anyMatch(p -> p.materialId().equals(material));
      boolean usable = indexed && "CHECKED".equals(pipeline.governance()) && pipeline.issues() == 0 && published;
      boolean tagged = report != null
         && (Boolean)this.db
            .queryForObject("SELECT cardinality(tags)>0 FROM material_governance_reports WHERE id=?", Boolean.class, new Object[]{report.get("id")});
      List<FoundationProcessingService.Stage> stages = List.of(
         this.stage(
            "received",
            "数据接入",
            "READY",
            current.createdAt(),
            "来源原件已保存，保留版本与校验依据",
            List.of(current.filename(), "来源版本 v" + current.number()),
            List.of("material_id", "version_id")
         ),
         this.stage(
            "structure",
            "解析与结构化",
            analysis.status(),
            latest == null ? null : latest.get("finished_at"),
            "解析器将正文拆成带位置与来源版本的片段记录",
            List.of(count + " 条解析记录", analysis.parserVersion() == null ? "尚无解析器回执" : "解析器 " + analysis.parserVersion()),
            parsed ? fields.stream().map(FoundationProcessingService.Field::name).toList() : List.of()
         ),
         this.stage(
            "dictionary",
            "标注与口径",
            tagged ? "READY" : "WAITING",
            report == null ? null : report.get("checked_at"),
            "资料标签与复核信息来自治理记录；尚未生成额外业务实体字段",
            report == null ? List.of() : List.of("标签 " + report.get("tags"), "复核日期 " + report.get("review_at")),
            report == null ? List.of() : List.of("tags", "review_at")
         ),
         this.stage(
            "checks",
            "治理检查",
            "CHECKED".equals(pipeline.governance()) ? (pipeline.issues() == 0 ? "READY" : "ATTENTION") : "WAITING",
            report == null ? null : report.get("checked_at"),
            "按当前版本与解析批次核对规则，检查不改变原资料权限",
            report == null ? List.of() : List.of(pipeline.issues() + " 项需关注"),
            List.of()
         ),
         this.stage(
            "available",
            "治理后 AI 可用",
            usable ? "READY" : "WAITING",
            null,
            "原文可检索不等于治理完成；须通过当前治理检查且已发布知识，每次读取仍核验权限",
            indexed ? List.of(count + " 条原文解析记录可按权限检索；不代表治理合格记录") : List.of(),
            List.of()
         ),
         this.stage("publication", "正式知识发布", published ? "PUBLISHED" : pipeline.publication(), null, "独立于解析和检索，由来源版本绑定的 Wiki 发布记录确定", List.of(), List.of())
      );
      ArrayList<FoundationProcessingService.History> history = new ArrayList<>();

      for (Map<String, Object> r : runs) {
         history.add(
            new FoundationProcessingService.History(
               r.get("id").toString(),
               "内容解析",
               r.get("status").toString(),
               this.time(r.get("created_at")),
               this.time(r.get("finished_at")),
               "第 " + r.get("generation") + " 次解析 · " + (r.get("parser_version") == null ? "尚无解析器回执" : r.get("parser_version"))
            )
         );
      }

      for (Map<String, Object> r : governance) {
         history.add(
            new FoundationProcessingService.History(
               r.get("id").toString(), "治理检查", "CHECKED", this.time(r.get("checked_at")), this.time(r.get("checked_at")), "治理报告第 " + r.get("revision") + " 版"
            )
         );
      }

      history.sort(Comparator.comparing(FoundationProcessingService.History::createdAt).reversed());
      return this.publications
         .apply(
            new FoundationProcessingService.Result(
               asset,
               m.document().name(),
               current.number(),
               stamp,
               "DOCUMENT_CHUNKS",
               count,
               parsed ? fields : List.of(),
               records,
               offset,
               analysis.hasMore(),
               stages,
               history,
               List.of("文档当前的结构化产物是正文片段记录；没有把片段冒充会员、订单等业务实体。", "展示当前文件版本的最新解析结果；历史解析批次单独保留。")
            ),
            publication
         );
   }

   private boolean parsedStatus(String state) {
      return Set.of("READY", "PARTIAL").contains(state);
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
                  "SELECT count(*)>0 AND bool_and(NOT ? OR (coalesce(i.state='READY',false) AND i.remote_id IS NOT NULL AND coalesce(t.enabled,false)))\nFROM active_materials m JOIN material_versions v ON v.material_id=m.id AND v.number=m.current_version\nJOIN LATERAL(SELECT id FROM knowledge_runs WHERE version_id=v.id ORDER BY generation DESC LIMIT 1) r ON true\nJOIN knowledge_chunks c ON c.run_id=r.id LEFT JOIN knowledge_remote_index i ON i.chunk_id=c.id AND i.tenant_id=c.tenant_id\nLEFT JOIN knowledge_index_targets t ON t.tenant_id=i.tenant_id AND t.knowledge_base_id=i.knowledge_base_id\nWHERE m.tenant_id=? AND m.id=?\n",
                  Boolean.class,
                  new Object[]{remote, tenant, material}
               )
         );
   }

   public record Field(String name, String type, String meaning, String unit, String origin, String evidence) {
   }

   public record History(String id, String stage, String state, String createdAt, String finishedAt, String detail) {
   }

   public record Result(
      String assetId,
      String name,
      int version,
      String revision,
      String recordKind,
      int recordCount,
      List<FoundationProcessingService.Field> fields,
      List<List<String>> records,
      int offset,
      boolean hasMore,
      List<FoundationProcessingService.Stage> stages,
      List<FoundationProcessingService.History> history,
      List<String> notes
   ) {
   }

   public record Stage(String key, String name, String state, String at, String detail, List<String> outputs, List<String> fields) {
   }
}
