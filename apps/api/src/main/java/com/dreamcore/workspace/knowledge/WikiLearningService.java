package com.dreamcore.workspace.knowledge;

import com.dreamcore.workspace.conversation.AgentResult;
import com.dreamcore.workspace.conversation.ConversationService;
import com.dreamcore.workspace.conversation.TaskOriginals;
import com.dreamcore.workspace.identity.IdentityAudit;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.IdentityService;
import com.dreamcore.workspace.material.MaterialAccess;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class WikiLearningService {
   private final JdbcTemplate db;
   private final IdentityService identities;
   private final MaterialAccess access;
   private final ConversationService conversations;
   private final IdentityAudit audit;
   private final JsonMapper json = new JsonMapper();

   public WikiLearningService(JdbcTemplate db, IdentityService identities, MaterialAccess access, ConversationService conversations, IdentityAudit audit) {
      this.db = db;
      this.identities = identities;
      this.access = access;
      this.conversations = conversations;
      this.audit = audit;
   }

   private IdentityException missing() {
      return new IdentityException(404, "MATERIAL_NOT_FOUND");
   }

   private IdentityException changed() {
      return new IdentityException(409, "WIKI_SOURCE_CHANGED");
   }

   private Map<String, Object> material(UUID actor, UUID tenant, UUID id) {
      this.identities.member(actor, tenant, false);
      List<Map<String, Object>> rows = this.db
         .queryForList(
            "SELECT m.*,v.id version_id,v.filename,v.number version FROM active_materials m JOIN workspaces w ON w.id=m.workspace_id AND w.tenant_id=m.tenant_id JOIN material_versions v ON v.material_id=m.id AND v.number=m.current_version WHERE m.id=? AND m.tenant_id=? AND w.kind='SHARED' AND m.in_library",
            new Object[]{id, tenant}
         );
      if (rows.isEmpty()) {
         throw this.missing();
      }

      Map<String, Object> row = rows.getFirst();
      this.access.requireObject(actor, tenant, (UUID)row.get("workspace_id"), "MATERIAL", id, false);
      return row;
   }

   WikiLearningService.Source source(UUID actor, UUID tenant, UUID material, UUID version, UUID run) {
      Map<String, Object> m = this.material(actor, tenant, material);
      if (!version.equals(m.get("version_id"))) {
         throw this.changed();
      }

      List<Map<String, Object>> runs = this.db
         .queryForList("SELECT id,generation,status FROM knowledge_runs WHERE version_id=? ORDER BY generation DESC LIMIT 1", new Object[]{version});
      if (!runs.isEmpty() && Set.of("READY", "PARTIAL").contains(runs.getFirst().get("status"))) {
         Map<String, Object> r = runs.getFirst();
         if (run != null && !run.equals(r.get("id"))) {
            throw this.changed();
         } else {
            List<WikiLearningService.Fragment> chunks = this.db
               .query(
                  "SELECT id,locator,content FROM knowledge_chunks WHERE run_id=? ORDER BY ordinal,id LIMIT 129",
                  (rs, n) -> new WikiLearningService.Fragment(rs.getObject("id", UUID.class), rs.getString("locator"), rs.getString("content")),
                  new Object[]{r.get("id")}
               );
            long characters = chunks.stream().mapToLong(c -> c.content().length()).sum();
            if (chunks.size() > 128 || characters > 32768L) {
               throw new IdentityException(409, "WIKI_SOURCE_PARTITION_REQUIRED");
            } else if (chunks.isEmpty()) {
               throw new IdentityException(409, "WIKI_SOURCE_NOT_READY");
            } else {
               return new WikiLearningService.Source(
                  material, version, (UUID)r.get("id"), (Integer)r.get("generation"), (String)m.get("filename"), (Integer)m.get("version"), chunks
               );
            }
         }
      } else {
         throw this.changed();
      }
   }

   @Transactional
   public WikiLearningService.Draft start(UUID actor, UUID tenant, UUID material, WikiLearningService.Start body) {
      if (body != null && body.requestId() != null && body.versionId() != null && body.generation() != null && body.generation() >= 1) {
         this.material(actor, tenant, material);
         this.db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", new Object[]{"wiki-learning:" + tenant + ":" + actor + ":" + material});
         String fingerprint = IdentityService.hash(tenant + "\n" + material + "\n" + body.versionId() + "\n" + body.generation());
         UUID prior = this.identities.priorRequest(actor, body.requestId(), "WIKI_LEARN", fingerprint);
         if (prior != null) {
            return this.detail(actor, tenant, prior);
         }

         WikiLearningService.Source s = this.source(actor, tenant, material, body.versionId(), null);
         if (s.generation() != body.generation()) {
            throw this.changed();
         }

         if (Boolean.TRUE
            .equals(
               this.db
                  .queryForObject(
                     "SELECT EXISTS(SELECT 1 FROM wiki_learning_drafts w JOIN conversation_tasks t ON t.id=w.task_id WHERE w.tenant_id=? AND w.actor_id=? AND w.material_id=? AND t.status IN ('QUEUED','RUNNING','WAITING_CAPABILITY','PAUSED','WAITING_INPUT','RESULT_UNKNOWN'))",
                     Boolean.class,
                     new Object[]{tenant, actor, material}
                  )
            )) {
            throw new IdentityException(409, "WIKI_LEARNING_BUSY");
         }

         List<UUID> personal = this.db
            .queryForList(
               "SELECT id FROM workspaces WHERE tenant_id=? AND owner_id=? AND kind='PERSONAL' AND NOT archived", UUID.class, new Object[]{tenant, actor}
            );
         if (personal.size() != 1) {
            throw new IdentityException(409, "PERSONAL_WORKSPACE_REQUIRED");
         }

         ConversationService.Detail task = this.conversations
            .submitClient(
               actor,
               tenant,
               null,
               personal.getFirst(),
               UUID.randomUUID(),
               "学习所选资料，生成本人核对的 Wiki 草稿，保留原文依据。只使用所选资料。",
               "AGENT",
               null,
               List.of(new TaskOriginals.Selection(material, s.versionId())),
               "SELECTED"
            );
         UUID id = UUID.randomUUID();
         UUID taskId = task.tasks().getFirst().id();
         this.db
            .update(
               "INSERT INTO wiki_learning_drafts(id,tenant_id,actor_id,material_id,version_id,run_id,task_id,conversation_id) VALUES (?,?,?,?,?,?,?,?)",
               new Object[]{id, tenant, actor, material, s.versionId(), s.runId(), taskId, task.conversation().id()}
            );
         this.identities.remember(actor, body.requestId(), "WIKI_LEARN", fingerprint, id);
         this.audit.record(actor, tenant, "WIKI_LEARNING_SUBMIT", id, "SUCCESS");
         return this.detail(actor, tenant, id);
      } else {
         throw IdentityException.invalid();
      }
   }

   public boolean ownsTask(UUID task) {
      return Boolean.TRUE
         .equals(this.db.queryForObject("SELECT EXISTS(SELECT 1 FROM wiki_learning_drafts WHERE task_id=?)", Boolean.class, new Object[]{task}));
   }

   public WikiLearningService.Source context(ConversationService.Job job) {
      List<Map<String, Object>> rows = this.db
         .queryForList("SELECT * FROM wiki_learning_drafts WHERE task_id=? AND tenant_id=? AND actor_id=?", new Object[]{job.id(), job.tenant(), job.actor()});
      if (rows.isEmpty()) {
         throw this.missing();
      }

      Map<String, Object> row = rows.getFirst();
      WikiLearningService.Source s = this.source(job.actor(), job.tenant(), (UUID)row.get("material_id"), (UUID)row.get("version_id"), (UUID)row.get("run_id"));
      UUID space = (UUID)this.db.queryForObject("SELECT workspace_id FROM materials WHERE id=?", UUID.class, new Object[]{s.materialId()});
      this.db
         .update(
            "INSERT INTO conversation_task_material_versions(tenant_id,workspace_id,task_id,attempt_id,material_id,version_id,run_id) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
            new Object[]{job.tenant(), space, job.id(), job.token(), s.materialId(), s.versionId(), s.runId()}
         );

      for (WikiLearningService.Fragment c : s.fragments()) {
         this.db
            .update(
               "INSERT INTO conversation_agent_grants(tenant_id,workspace_id,task_id,attempt_id,chunk_id) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING",
               new Object[]{job.tenant(), job.space(), job.id(), job.token(), c.id()}
            );
      }

      return s;
   }

   public WikiLearningService.Article validate(String raw, WikiLearningService.Source source) {
      try {
         JsonNode node = this.json.readTree(raw);
         if (!node.isObject() || node.size() != 4 || !node.has("title") || !node.has("intro") || !node.has("content") || !node.has("evidence")) {
            throw IdentityException.invalid();
         }

         if (node.get("title").isString() && node.get("intro").isString() && node.get("content").isString() && node.get("evidence").isArray()) {
            for (JsonNode e : node.get("evidence")) {
               if (!e.isObject() || e.size() != 2 || !e.has("chunkId") || !e.has("quote") || !e.get("chunkId").isString() || !e.get("quote").isString()) {
                  throw IdentityException.invalid();
               }
            }

            WikiLearningService.Article article = (WikiLearningService.Article)this.json.readValue(raw, WikiLearningService.Article.class);
            this.text(article.title(), 80);
            this.text(article.intro(), 250);
            this.text(article.content(), 1500);
            if (article.evidence() != null && !article.evidence().isEmpty() && article.evidence().size() <= 4) {
               for (WikiLearningService.Evidence e : article.evidence()) {
                  if (e != null && e.chunkId() != null) {
                     this.text(e.quote(), 200);
                     if (e.quote().length() >= 6 && !source.fragments().stream().noneMatch(c -> c.id().equals(e.chunkId()) && c.content().contains(e.quote()))) {
                        continue;
                     }

                     throw IdentityException.invalid();
                  }

                  throw IdentityException.invalid();
               }

               return article;
            } else {
               throw IdentityException.invalid();
            }
         } else {
            throw IdentityException.invalid();
         }
      } catch (Exception error) {
         throw new IdentityException(502, "WIKI_RESULT_INVALID");
      }
   }

   private void text(String value, int max) {
      if (value == null
         || value.isBlank()
         || value.length() > max
         || value.codePoints().anyMatch(c -> Character.isISOControl(c) && c != 10 && c != 13 && c != 9)) {
         throw IdentityException.invalid();
      }
   }

   public void validateResult(ConversationService.Job job, AgentResult result) {
      if (this.ownsTask(job.id())) {
         if ("1.5".equals(result.contractVersion())
            && "COMPLETE".equals(result.outcome())
            && result.tools().isEmpty()
            && result.artifacts().isEmpty()
            && result.webSources() != null
            && result.webSources().isEmpty()
            && result.skills() != null
            && result.skills().isEmpty()
            && result.originalIds().isEmpty()) {
            this.validate(result.text(), this.context(job));
         } else {
            throw new IdentityException(502, "WIKI_RESULT_INVALID");
         }
      }
   }

   @Transactional
   public WikiLearningService.Draft detail(UUID actor, UUID tenant, UUID id) {
      this.identities.member(actor, tenant, false);
      List<Map<String, Object>> rows = this.db
         .queryForList(
            "SELECT w.*,t.status,t.execution_class,t.model_name,t.reply FROM wiki_learning_drafts w JOIN conversation_tasks t ON t.id=w.task_id WHERE w.id=? AND w.tenant_id=? AND w.actor_id=? AND object_is_active('TASK',t.id)",
            new Object[]{id, tenant, actor}
         );
      if (rows.isEmpty()) {
         throw this.missing();
      }

      Map<String, Object> r = rows.getFirst();
      Map<String, Object> m = this.material(actor, tenant, (UUID)r.get("material_id"));
      ConversationService.Detail guarded = this.conversations.taskDetail(actor, tenant, (UUID)r.get("conversation_id"), (UUID)r.get("task_id"));
      if (guarded.tasks().stream().noneMatch(t -> t.id().equals(r.get("task_id")) && !t.sourcesUnavailable())) {
         throw this.missing();
      }

      String status = (String)r.get("status");
      WikiLearningService.Article article = null;

      try {
         WikiLearningService.Source s = this.source(actor, tenant, (UUID)r.get("material_id"), (UUID)r.get("version_id"), (UUID)r.get("run_id"));
         if (status.equals("SUCCEEDED")) {
            article = this.validate((String)r.get("reply"), s);
         }
      } catch (IdentityException e) {
         if (!e.code.equals("WIKI_SOURCE_CHANGED") && !e.code.equals("WIKI_SOURCE_NOT_READY")) {
            throw e;
         }

         status = "SOURCE_CHANGED";
      }

      return new WikiLearningService.Draft(
         id,
         tenant,
         (UUID)r.get("material_id"),
         (UUID)r.get("version_id"),
         (UUID)r.get("conversation_id"),
         (UUID)r.get("task_id"),
         (String)m.get("name"),
         (Integer)this.db.queryForObject("SELECT number FROM material_versions WHERE id=?", Integer.class, new Object[]{r.get("version_id")}),
         status,
         (String)r.get("execution_class"),
         (String)r.get("model_name"),
         article
      );
   }

   @Transactional
   public WikiLearningService.Page list(UUID actor, UUID tenant, int offset) {
      if (offset >= 0 && offset <= 100000) {
         this.identities.member(actor, tenant, false);
         List<UUID> ids = this.db
            .queryForList(
               "SELECT w.id FROM wiki_learning_drafts w JOIN active_materials m ON m.id=w.material_id JOIN workspaces s ON s.id=m.workspace_id JOIN conversations c ON c.id=w.conversation_id WHERE w.tenant_id=? AND w.actor_id=? AND c.trashed_at IS NULL AND s.kind='SHARED' AND m.in_library AND object_is_active('TASK',w.task_id) AND (library_mask(?,w.tenant_id,'MATERIAL',m.id)&1)=1 ORDER BY w.created_at DESC,w.id LIMIT 21 OFFSET ?",
               UUID.class,
               new Object[]{tenant, actor, actor, offset}
            );
         return new WikiLearningService.Page(ids.stream().limit(20L).map(id -> this.detail(actor, tenant, id)).toList(), ids.size() > 20);
      } else {
         throw IdentityException.invalid();
      }
   }

   public record Article(String title, String intro, String content, List<WikiLearningService.Evidence> evidence) {
   }

   public record Draft(
      UUID id,
      UUID tenantId,
      UUID materialId,
      UUID versionId,
      UUID conversationId,
      UUID taskId,
      String sourceName,
      int sourceVersion,
      String status,
      String executionClass,
      String modelName,
      WikiLearningService.Article article
   ) {
   }

   public record Evidence(UUID chunkId, String quote) {
   }

   public record Fragment(UUID id, String locator, String content) {
   }

   public record Page(List<WikiLearningService.Draft> items, boolean hasMore) {
   }

   public record Source(UUID materialId, UUID versionId, UUID runId, int generation, String filename, int version, List<WikiLearningService.Fragment> fragments) {
   }

   public record Start(UUID requestId, UUID versionId, Integer generation) {
   }
}
