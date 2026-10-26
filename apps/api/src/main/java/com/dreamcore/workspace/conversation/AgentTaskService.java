package com.dreamcore.workspace.conversation;

import com.dreamcore.workspace.audience.WorkAudienceService;
import com.dreamcore.workspace.briefing.BriefingFlowGuard;
import com.dreamcore.workspace.context.TaskContextGuard;
import com.dreamcore.workspace.identity.IdentityAudit;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.IdentityService;
import com.dreamcore.workspace.knowledge.KnowledgeService;
import com.dreamcore.workspace.knowledge.WikiGraphService;
import com.dreamcore.workspace.knowledge.WikiInsightService;
import com.dreamcore.workspace.knowledge.WikiLearningService;
import com.dreamcore.workspace.news.NewsSearchPolicy;
import com.dreamcore.workspace.news.NewsSourceCatalog;
import com.dreamcore.workspace.preferences.ExpressionPreferences;
import com.dreamcore.workspace.preferences.ExpressionRuleBooks;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class AgentTaskService {
   @Autowired
   private WikiLearningService wikiLearning;
   @Autowired
   private WikiGraphService wikiGraph;
   @Autowired
   private WikiInsightService wikiInsight;
   @org.springframework.beans.factory.annotation.Autowired
   private com.dreamcore.workspace.knowledge.DatasetBusinessKnowledgeService datasetInsight;
   private final JdbcTemplate db;
   private final ConversationService conversations;
   private final KnowledgeService knowledge;
   private final AgentSettings settings;
   private final TransactionTemplate transactions;
   private final IdentityAudit audit;
   private final DatasetCalculationService datasets;
   private final TableCalculationService tables;
   private final BriefingContentService briefings;
   @Autowired
   private BriefingFlowGuard briefingFlow;
   private final TaskOriginals originals;
   private final AgentUsageLedger usage;
   private final TaskContextGuard contextGuard;
   private final ExpressionPreferences expressionPreferences;
   private final ExpressionRuleBooks expressionRuleBooks;
   @Autowired
   private NewsSourceCatalog newsCatalog;
   @Autowired
   private NewsSearchPolicy newsSearch;
   @Autowired
   private ArtifactTransferService artifactTransfers;
   @Autowired
   private PresentationWorkflow presentations;
   @Autowired
   private WorkAudienceService workAudience;
   private final JsonMapper json = new JsonMapper();
   private static final Set<String> REGISTERED_TOOLS = Set.of(
      "request_briefing_evidence",
      "select_briefing_topic",
      "deliver_briefing",
      "compare_table",
      "compare_dataset",
      "search_sources",
      "run_javascript",
      "find_skills",
      "activate_skill",
      "read_skill_resource",
      "render_presentation",
      "public_search",
      "read_public_page",
      "candidate_tool",
      "list_originals",
      "read_original",
      "process_original",
      "ask_user",
      "task_control",
      "task_context",
      "task_plan",
      "task_preference",
      "manage_plan"
   );

   public AgentTaskService(
      JdbcTemplate db,
      ConversationService conversations,
      KnowledgeService knowledge,
      AgentSettings settings,
      PlatformTransactionManager manager,
      IdentityAudit audit,
      TaskOriginals originals,
      AgentUsageLedger usage,
      TaskContextGuard contextGuard,
      TableCalculationService tables,
      BriefingContentService briefings,
      DatasetCalculationService datasets,
      ExpressionPreferences expressionPreferences,
      ExpressionRuleBooks expressionRuleBooks
   ) {
      this.expressionRuleBooks = expressionRuleBooks;
      this.expressionPreferences = expressionPreferences;
      this.datasets = datasets;
      this.briefings = briefings;
      this.tables = tables;
      this.contextGuard = contextGuard;
      this.usage = usage;
      this.originals = originals;
      this.transactions = new TransactionTemplate(manager);
      this.audit = audit;
      this.db = db;
      this.conversations = conversations;
      this.knowledge = knowledge;
      this.settings = settings;
   }

   private IdentityException denied() {
      return new IdentityException(403, "TASK_ACCESS_DENIED");
   }

   ConversationService.Job authorized(UUID task, UUID attempt) {
      if (this.settings.enabled() && attempt != null) {
         List<Map<String, Object>> rows = this.db
            .queryForList(
               "SELECT * FROM conversation_tasks WHERE id=? AND lease_token=? AND mode='AGENT' AND status='RUNNING' AND lease_until>now()",
               new Object[]{task, attempt}
            );
         if (rows.isEmpty()) {
            throw this.denied();
         }

         Map<String, Object> row = rows.getFirst();
         if (!this.settings.mode().equals(row.get("execution_class"))) {
            throw this.denied();
         }

         if (row.get("public_query") != null && !this.settings.publicWebEnabled()) {
            throw this.denied();
         }

         ConversationService.Job job = new ConversationService.Job(
            task,
            (UUID)row.get("tenant_id"),
            (UUID)row.get("workspace_id"),
            (UUID)row.get("conversation_id"),
            (UUID)row.get("requested_by"),
            (String)row.get("prompt"),
            attempt,
            "AGENT"
         );
         this.conversations.require(job.actor(), job.tenant(), job.conversation(), false);
         this.conversations.requireReadable(job.id());
         if (!this.conversations.owned(job)) {
            throw this.denied();
         }

         this.workAudience.task(task);
         this.contextGuard.requireCurrent(task);
         if ("news:topic-search:v1".equals(row.get("public_query"))) {
            this.newsSearch.requireCurrent(task, job.tenant());
         } else if (this.newsCatalog != null
            && Boolean.TRUE
               .equals(
                  this.db
                     .queryForObject(
                        "SELECT EXISTS(SELECT 1 FROM briefing_generation_batches WHERE task_id=? AND business_type='INFO')", Boolean.class, new Object[]{task}
                     )
               )
            && this.newsCatalog.selectedSources(job.tenant()).stream().noneMatch(source -> source.url().equals(row.get("public_query")))) {
            throw this.denied();
         }

         if (this.db.queryForObject("SELECT lease_until>clock_timestamp() FROM conversation_tasks WHERE id=?", Boolean.class, new Object[]{task})
            != Boolean.TRUE) {
            throw this.denied();
         }

         List<TaskOriginals.File> selected = this.originals.list(job.actor(), job.tenant(), job.space(), job.id());
         List<UUID> selectedIds = selected.stream().map(TaskOriginals.File::versionId).toList();

         for (UUID id : this.grants(job)) {
            KnowledgeService.Chunk citation = this.knowledge.citation(job.actor(), job.tenant(), id);
            if ("WORKSPACE".equals(this.scope(task)) && !citation.workspaceId().equals(job.space())
               || ("SELECTED".equals(this.scope(task)) || "WORKSPACE".equals(this.scope(task)) && !selectedIds.isEmpty())
                  && !selectedIds.contains(citation.versionId())) {
               throw this.denied();
            }
         }

         return job;
      } else {
         throw this.denied();
      }
   }

   private String scope(UUID task) {
      return (String)this.db.queryForObject("SELECT source_scope FROM conversation_tasks WHERE id=?", String.class, new Object[]{task});
   }

   private List<UUID> grants(ConversationService.Job job) {
      return this.db
         .queryForList(
            "SELECT chunk_id FROM conversation_agent_grants WHERE task_id=? AND attempt_id=? ORDER BY chunk_id",
            UUID.class,
            new Object[]{job.id(), job.token()}
         );
   }

   @Transactional
   public Map<String, Object> check(UUID task, UUID attempt) {
      ConversationService.Job preferenceJob = this.authorized(task, attempt);
      if (this.datasetInsight.ownsTask(task)) {
         return Map.of("allowed", true, "executionClass", this.settings.mode(), "datasetInsight", this.datasetInsight.context(preferenceJob));
      }
      if (this.wikiInsight.ownsTask(task)) {
         return Map.of("allowed", true, "executionClass", this.settings.mode(), "wikiInsight", this.wikiInsight.context(preferenceJob));
      }

      if (this.wikiGraph.ownsTask(task)) {
         return Map.of("allowed", true, "executionClass", this.settings.mode(), "wikiGraph", this.wikiGraph.context(preferenceJob));
      }

      if (this.wikiLearning.ownsTask(task)) {
         return Map.of("allowed", true, "executionClass", this.settings.mode(), "wikiLearning", this.wikiLearning.context(preferenceJob));
      }

      String query = (String)this.db.queryForObject("SELECT public_query FROM conversation_tasks WHERE id=?", String.class, new Object[]{task});
      LinkedHashMap<String, Object> response = new LinkedHashMap<>(
         Map.of(
            "allowed",
            true,
            "executionClass",
            this.settings.mode(),
            "publicQuery",
            query == null ? "" : query,
            "candidateTrialsAllowed",
            this.settings.candidateTrialsEnabled() && query != null && !"news:topic-search:v1".equals(query),
            "contextVersion",
            "1.0",
            "taskWorkVersion",
            "1.0",
            "tableComparisonVersion",
            this.tables.available() ? "1.0" : "",
            "briefingContentVersion",
            "1.0",
            "planManagementVersion",
            "1.0",
            "planAllowed",
            this.db.queryForObject("SELECT EXISTS(SELECT 1 FROM ongoing_plan_runs WHERE task_id=?)", Boolean.class, new Object[]{task})
         )
      );
      response.put("contextRejectionVersion", "1.0");
      response.put("artifactTransferVersion", this.artifactTransfers.available() ? "1.0" : "");
      response.put("presentationRendererVersion", this.artifactTransfers.presentationAvailable() ? "1.0" : "");
      if (this.artifactTransfers.presentationAvailable()) {
         response.put("presentationWorkflow", this.presentations.context(preferenceJob));
      }

      response.put(
         "newsSeen",
         this.db
            .queryForList(
               "SELECT url,sha256 FROM news_article_deliveries WHERE tenant_id=? AND owner_id=? ORDER BY created_at DESC LIMIT 200",
               new Object[]{preferenceJob.tenant(), preferenceJob.actor()}
            )
      );
      response.put("briefingBusinessPlanVersion", "1.0");
      response.put(
         "briefingRequestedType",
         this.db
            .queryForList(
               "SELECT business_type FROM briefing_generation_batches WHERE task_id=? AND business_type IS NOT NULL", String.class, new Object[]{task}
            )
            .stream()
            .findFirst()
            .orElse("")
      );
      response.put("editorialPlanVersion", "1.0");
      response.put("briefingEvidenceSupplementVersion", "1.0");
      response.put("briefingTextCalculationVersion", "1.0");
      response.put("briefingSupportingCalculationsVersion", "1.0");
      response.put(
         "editorialBatchId",
         this.db
            .queryForList(
               "SELECT selection_id::text FROM briefing_generation_batches WHERE task_id=? AND selection_id IS NOT NULL", String.class, new Object[]{task}
            )
            .stream()
            .findFirst()
            .orElse("")
      );
      response.put(
         "editorialRequestedTypes",
         this.db
            .queryForList(
               "SELECT coalesce(b.business_type,'AUTO') FROM briefing_generation_batches b WHERE b.selection_id=(SELECT selection_id FROM briefing_generation_batches WHERE task_id=?) ORDER BY b.selection_index",
               String.class,
               new Object[]{task}
            )
      );
      response.put(
         "pendingEditorialPlans",
         this.db
            .queryForList(
               "SELECT (b.body || jsonb_build_object('assignedIndices',(SELECT coalesce(jsonb_agg(t.selected_index),'[]'::jsonb) FROM briefing_editorial_tasks t WHERE t.batch_id=b.id)))::text FROM briefing_editorial_batches b WHERE b.tenant_id=? AND b.owner_id=? AND b.body->'plan'->>'audienceKey'=? AND b.created_at>now()-interval '1 day' AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.body->'plan'->'items') WITH ORDINALITY AS i(item,n) WHERE i.item->>'decision'='EMIT' AND NOT EXISTS(SELECT 1 FROM briefing_editorial_tasks t WHERE t.batch_id=b.id AND t.selected_index=i.n-1)) ORDER BY b.created_at DESC LIMIT 3",
               String.class,
               new Object[]{preferenceJob.tenant(), preferenceJob.actor(), this.workAudience.task(task).key()}
            )
            .stream()
            .map(x -> this.json.readTree(x))
            .toList()
      );
      response.put("topicStrategyVersion", "1.0");
      response.put(
         "topicSelectionRecorded",
         this.db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_topic_selections WHERE task_id=?)", Boolean.class, new Object[]{task})
      );
      List<Map<String, Object>> topicRows = this.db
         .queryForList("SELECT candidates::text,selected_index FROM briefing_topic_selections WHERE task_id=?", new Object[]{task});
      if (!topicRows.isEmpty()) {
         Map<String, Object> topic = topicRows.getFirst();
         response.put(
            "topicSelection",
            Map.of("candidates", this.json.readValue(topic.get("candidates").toString(), List.class), "selectedIndex", topic.get("selected_index"))
         );
      }

      response.put("datasetComparisonVersion", "1.0");
      response.put("datasetContextVersion", "1.0");
      response.put("generalExperienceVersion", "1.0");
      response.put("realtimeVersion", "1.0");
      response.put("answerStreamVersion", "1.0");
      response.put("expressionRuleBooks", this.expressionRuleBooks.taskSnapshot(preferenceJob.actor(), preferenceJob.tenant(), task));
      response.put("expressionPreferences", this.expressionPreferences.effective(preferenceJob.actor(), preferenceJob.tenant()));
      response.put("workAudience", this.workAudience.task(task));
      response.put(
         "briefingGeneration",
         this.db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_generation_batches WHERE task_id=?)", Boolean.class, new Object[]{task})
      );
      if ("news:topic-search:v1".equals(query)) {
         response.put("newsSearch", this.newsSearch.scope(task));
      }

      return response;
   }

   @Transactional
   public Object selectNewsQuery(UUID task, UUID attempt, String topic) {
      this.authorized(task, attempt);
      return this.newsSearch.select(task, topic);
   }

   @Transactional
   public Map<String, Object> selectTopic(UUID task, UUID attempt, AgentTaskService.TopicSelection body) {
      ConversationService.Job job = this.authorized(task, attempt);
      if (!Boolean.TRUE
         .equals(
            this.db
               .queryForObject(
                  "SELECT EXISTS(SELECT 1 FROM briefing_generation_batches WHERE task_id=?) OR EXISTS(SELECT 1 FROM conversation_attempts WHERE task_id=? AND provenance='EXTERNAL_DEPLOYMENT' AND allowed_tools @> '[\"select_briefing_topic\"]'::jsonb)",
                  Boolean.class,
                  new Object[]{task, task}
               )
         )) {
         throw this.denied();
      }

      if (body != null
         && body.candidates() != null
         && !body.candidates().isEmpty()
         && body.candidates().size() <= 10
         && body.selectedIndex() != null
         && body.selectedIndex() >= 0
         && body.selectedIndex() < body.candidates().size()) {
         for (AgentTaskService.TopicCandidate c : body.candidates()) {
            if (c == null || c.businessType() == null || !Set.of("DATA", "INSIGHT", "SUGGESTION", "INFO", "RESULT").contains(c.businessType())) {
               throw IdentityException.invalid();
            }

            for (String text : new String[]{c.question(), c.evidenceNeeded(), c.difference()}) {
               if (text == null || text.isBlank() || text.length() > 500 || text.indexOf(0) >= 0) {
                  throw IdentityException.invalid();
               }
            }

            if (c.businessType().equals("DATA") && !c.requiresCalculation()) {
               throw IdentityException.invalid();
            }
         }

         for (AgentTaskService.TopicCandidate c : body.candidates()) {
            if (c.destination() != null) {
               if (!Set.of("BRIEFING", "KNOWLEDGE_DRAFT", "GOVERNANCE_REVIEW", "NO_OUTPUT").contains(c.destination())) {
                  throw IdentityException.invalid();
               }

               for (String text : new String[]{c.goal(), c.userValue()}) {
                  if (text == null || text.isBlank() || text.length() > 500) {
                     throw IdentityException.invalid();
                  }
               }
            }
         }

         List<String> requested = this.db
            .queryForList(
               "SELECT business_type FROM briefing_generation_batches WHERE task_id=? AND business_type IS NOT NULL", String.class, new Object[]{task}
            );
         if (!requested.isEmpty() && !requested.getFirst().equals(body.candidates().get(body.selectedIndex()).businessType())) {
            throw new IdentityException(422, "BRIEFING_TYPE_MISMATCH");
         }

         List<UUID> selectionIds = this.db
            .queryForList("SELECT selection_id FROM briefing_generation_batches WHERE task_id=? AND selection_id IS NOT NULL", UUID.class, new Object[]{task});
         if (selectionIds.isEmpty() || body.editorialPlan() != null && selectionIds.getFirst().equals(body.editorialPlan().batchId())) {
            WorkAudienceService.Context audience = this.workAudience.task(task);
            BriefingEditorialPlan.validate(body.editorialPlan(), body.candidates(), body.selectedIndex(), audience);
            String batchBody = this.json.writeValueAsString(Map.of("plan", body.editorialPlan(), "candidates", body.candidates()));
            this.db
               .update(
                  "INSERT INTO briefing_editorial_batches(id,tenant_id,owner_id,body) VALUES (?,?,?,?::jsonb) ON CONFLICT DO NOTHING",
                  new Object[]{body.editorialPlan().batchId(), job.tenant(), job.actor(), batchBody}
               );
            Map<String, Object> batch = this.db
               .queryForMap(
                  "SELECT tenant_id,owner_id,body::text FROM briefing_editorial_batches WHERE id=? FOR UPDATE", new Object[]{body.editorialPlan().batchId()}
               );
            if (job.tenant().equals(batch.get("tenant_id"))
               && job.actor().equals(batch.get("owner_id"))
               && this.json.readTree(batch.get("body").toString()).equals(this.json.readTree(batchBody))) {
               List<UUID> claimed = this.db
                  .queryForList(
                     "SELECT task_id FROM briefing_editorial_tasks WHERE batch_id=? AND selected_index=?",
                     UUID.class,
                     new Object[]{body.editorialPlan().batchId(), body.selectedIndex()}
                  );
               if (!claimed.isEmpty() && !task.equals(claimed.getFirst())) {
                  throw new IdentityException(409, "BRIEFING_TOPIC_ALREADY_ASSIGNED");
               }

               this.db
                  .update(
                     "INSERT INTO briefing_editorial_tasks(task_id,batch_id,selected_index) VALUES (?,?,?) ON CONFLICT DO NOTHING",
                     new Object[]{task, body.editorialPlan().batchId(), body.selectedIndex()}
                  );
               Map<String, Object> binding = this.db
                  .queryForMap("SELECT batch_id,selected_index FROM briefing_editorial_tasks WHERE task_id=?", new Object[]{task});
               if (body.editorialPlan().batchId().equals(binding.get("batch_id")) && body.selectedIndex().equals(binding.get("selected_index"))) {
                  String value = this.json.writeValueAsString(body.candidates());
                  this.db
                     .update(
                        "INSERT INTO briefing_topic_selections(task_id,candidates,selected_index,strategy_version) VALUES (?,?::jsonb,?,'1.0.0') ON CONFLICT DO NOTHING",
                        new Object[]{task, value, body.selectedIndex()}
                     );
                  Map<String, Object> stored = this.db
                     .queryForMap("SELECT candidates::text,selected_index FROM briefing_topic_selections WHERE task_id=?", new Object[]{task});
                  if (this.json.readTree(stored.get("candidates").toString()).equals(this.json.readTree(value))
                     && body.selectedIndex().equals(stored.get("selected_index"))) {
                     return Map.of("recorded", true, "selectedIndex", body.selectedIndex(), "strategyVersion", "1.0.0", "proposalOnly", true);
                  } else {
                     throw new IdentityException(409, "TASK_STATE_CHANGED");
                  }
               } else {
                  throw new IdentityException(409, "BRIEFING_BATCH_CHANGED");
               }
            } else {
               throw new IdentityException(409, "BRIEFING_BATCH_CHANGED");
            }
         } else {
            throw new IdentityException(422, "BRIEFING_BATCH_ID_REQUIRED");
         }
      } else {
         throw IdentityException.invalid();
      }
   }

   @Transactional
   public Object proposePresentation(UUID task, UUID attempt, Map<String, Object> spec) {
      ConversationService.Job job = this.authorized(task, attempt);
      if (this.artifactTransfers.presentationAvailable()
         && Boolean.TRUE
            .equals(
               this.db
                  .queryForObject(
                     "SELECT jsonb_exists(allowed_tools,'render_presentation') FROM conversation_attempts WHERE task_id=? AND attempt_id=?",
                     Boolean.class,
                     new Object[]{task, attempt}
                  )
            )) {
         return this.presentations.propose(job, spec);
      } else {
         throw this.denied();
      }
   }

   @Transactional
   public Map<String, Object> openExecution(UUID task, UUID attempt, AgentTaskService.ExecutionOpen body) {
      this.authorized(task, attempt);
      if (body == null
         || !Set.of("1.5", "1.6").contains(body.contractVersion() == null ? "" : body.contractVersion())
         || body.tools() == null
         || body.tools().isEmpty() && !this.wikiLearning.ownsTask(task) && !this.wikiGraph.ownsTask(task) && !this.wikiInsight.ownsTask(task) && !this.datasetInsight.ownsTask(task)
         || body.tools().size() > 20
         || new HashSet<>(body.tools()).size() != body.tools().size()
         || body.tools().stream().anyMatch(t -> t == null || !REGISTERED_TOOLS.contains(t))) {
         throw new IdentityException(502, "TASK_RUNTIME_INCOMPATIBLE");
      } else if ((this.wikiLearning.ownsTask(task) || this.wikiGraph.ownsTask(task) || this.wikiInsight.ownsTask(task) || this.datasetInsight.ownsTask(task)) && !body.tools().isEmpty()) {
         throw this.denied();
      } else if (!this.settings.mode().equals("verification")
         && body.tools().stream().anyMatch(t -> Set.of("candidate_tool", "run_javascript", "list_originals", "read_original", "process_original").contains(t))) {
         throw this.denied();
      } else if (body.tools().contains("task_plan")
         && (Integer)this.db.queryForObject("SELECT count(*) FROM ongoing_plan_runs WHERE task_id=?", Integer.class, new Object[]{task}) == 0) {
         throw this.denied();
      } else if (body.contractVersion().equals("1.5") && body.tools().stream().anyMatch(t -> Set.of("task_plan", "task_preference", "manage_plan").contains(t))
         )
       {
         throw this.denied();
      } else if (body.tools().contains("render_presentation") && !this.artifactTransfers.presentationAvailable()) {
         throw this.denied();
      } else {
         String policy = body.contractVersion().equals("1.6") ? "SCOPED_PRIVATE_V2" : "READ_ONLY_PRIVATE_V1";
         Map<String, Object> row = this.db
            .queryForMap(
               "SELECT execution_policy,allowed_tools FROM conversation_attempts WHERE task_id=? AND attempt_id=? FOR UPDATE", new Object[]{task, attempt}
            );
         String encoded = this.json.writeValueAsString(body.tools().stream().sorted().toList());
         if (row.get("execution_policy") == null
            || policy.equals(row.get("execution_policy")) && this.json.readTree(row.get("allowed_tools").toString()).equals(this.json.readTree(encoded))) {
            this.db
               .update(
                  "UPDATE conversation_attempts SET execution_policy=?,allowed_tools=CAST(? AS jsonb) WHERE task_id=? AND attempt_id=?",
                  new Object[]{policy, encoded, task, attempt}
               );
            return Map.of("accepted", true, "policy", policy);
         } else {
            throw new IdentityException(409, "TASK_STATE_CHANGED");
         }
      }
   }

   @Transactional
   public void toolReceipt(UUID task, UUID attempt, AgentTaskService.ToolReceipt body) {
      this.authorized(task, attempt);
      if (body != null
         && body.sequence() != null
         && body.sequence() >= 1
         && body.sequence() <= 8
         && body.name() != null
         && body.status() != null
         && Set.of("STARTED", "succeeded", "failed").contains(body.status())
         && (body.rejection() == null || "CONTEXT_ARGUMENTS".equals(body.rejection()) && "task_context".equals(body.name()) && "failed".equals(body.status()))) {
         Map<String, Object> row = this.db
            .queryForMap(
               "SELECT attempt_number,allowed_tools,execution_policy FROM conversation_attempts WHERE task_id=? AND attempt_id=? AND execution_policy IN ('READ_ONLY_PRIVATE_V1','SCOPED_PRIVATE_V2')",
               new Object[]{task, attempt}
            );
         if (!Arrays.asList((String[])this.json.readValue(row.get("allowed_tools").toString(), String[].class)).contains(body.name())) {
            throw this.denied();
         }

         List<Map<String, Object>> found = this.db
            .queryForList(
               "SELECT name,status,rejection FROM conversation_tool_receipts WHERE task_id=? AND attempt_number=? AND sequence=?",
               new Object[]{task, row.get("attempt_number"), body.sequence()}
            );
         if (found.isEmpty()) {
            if (Boolean.TRUE
               .equals(
                  this.db
                     .queryForObject(
                        "SELECT stop_requested FROM conversation_attempts WHERE task_id=? AND attempt_id=?", Boolean.class, new Object[]{task, attempt}
                     )
               )) {
               throw new IdentityException(409, "TASK_STOPPING");
            }

            if (!body.status().equals("STARTED")
               || body.sequence()
                  != 1
                     + (Integer)this.db
                        .queryForObject(
                           "SELECT count(*) FROM conversation_tool_receipts WHERE task_id=? AND attempt_number=?",
                           Integer.class,
                           new Object[]{task, row.get("attempt_number")}
                        )) {
               throw new IdentityException(409, "TASK_STATE_CHANGED");
            }

            this.db
               .update(
                  "INSERT INTO conversation_tool_receipts(task_id,attempt_number,sequence,name,status,started_at) VALUES (?,?,?,?,'STARTED',clock_timestamp())",
                  new Object[]{task, row.get("attempt_number"), body.sequence(), body.name()}
               );
         } else {
            Map<String, Object> prior = found.getFirst();
            if (!body.name().equals(prior.get("name")) || !body.status().equals(prior.get("status")) && !"STARTED".equals(prior.get("status"))
               || body.status().equals(prior.get("status")) && !Objects.equals(body.rejection(), prior.get("rejection"))) {
               throw new IdentityException(409, "TASK_STATE_CHANGED");
            }

            if (!body.status().equals(prior.get("status"))) {
               this.db
                  .update(
                     "UPDATE conversation_tool_receipts SET status=?,rejection=?,received_at=clock_timestamp(),finished_at=greatest(clock_timestamp(),started_at) WHERE task_id=? AND attempt_number=? AND sequence=?",
                     new Object[]{body.status(), body.rejection(), task, row.get("attempt_number"), body.sequence()}
                  );
            }
         }
      } else {
         throw IdentityException.invalid();
      }
   }

   @Transactional
   public Map<String, Object> openUsage(UUID task, UUID attempt) {
      this.authorized(task, attempt);
      return this.usage.open(task, attempt);
   }

   @Transactional
   public void startUsage(UUID task, UUID attempt, AgentUsageLedger.Start request) {
      this.authorized(task, attempt);
      if (Boolean.TRUE
         .equals(
            this.db
               .queryForObject("SELECT stop_requested FROM conversation_attempts WHERE task_id=? AND attempt_id=?", Boolean.class, new Object[]{task, attempt})
         )) {
         throw new IdentityException(409, "TASK_STOPPING");
      }

      this.usage.start(task, attempt, request);
   }

   @Transactional
   public List<AgentTaskService.Input> search(UUID task, UUID attempt, String query) {
      return this.searchResult(task, attempt, query).items();
   }

   @Transactional
   public AgentTaskService.SearchResult searchResult(UUID task, UUID attempt, String query) {
      ConversationService.Job job = this.authorized(task, attempt);
      if (query == null) {
         throw IdentityException.invalid();
      }

      if ((Integer)this.db
            .queryForObject(
               "SELECT count(*) FROM conversation_agent_grants g JOIN knowledge_chunks c ON c.id=g.chunk_id LEFT JOIN conversation_task_material_versions p ON p.task_id=g.task_id AND p.attempt_id=g.attempt_id AND p.material_id=c.material_id WHERE g.task_id=? AND g.attempt_id=? AND (p.material_id IS NULL OR p.version_id<>c.version_id OR p.run_id<>c.run_id)",
               Integer.class,
               new Object[]{task, attempt}
            )
         > 0) {
         throw new IdentityException(409, "TASK_SOURCE_UNAVAILABLE");
      }

      HashSet<UUID> known = new HashSet<>(this.grants(job));
      ArrayList<AgentTaskService.Input> result = new ArrayList<>();
      ArrayList<KnowledgeService.Chunk> included = new ArrayList<>();
      List<UUID> selected = this.originals.list(job.actor(), job.tenant(), job.space(), job.id()).stream().map(TaskOriginals.File::versionId).toList();
      String scope = this.scope(task);
      boolean briefingOverview = query.isBlank()
         && !selected.isEmpty()
         && Boolean.TRUE
            .equals(this.db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_generation_batches WHERE task_id=?)", Boolean.class, new Object[]{task}));
      int limit = briefingOverview ? 6 : 10;
      KnowledgeService.Results found = "WORKSPACE".equals(scope)
         ? this.knowledge.searchForAttempt(job.actor(), job.tenant(), job.space(), query, 3, selected.isEmpty() ? null : selected, task, attempt)
         : this.knowledge
            .searchClientTask(
               job.actor(),
               job.tenant(),
               job.space(),
               query,
               limit,
               !"SELECTED".equals(scope) && (!query.isBlank() || selected.isEmpty()) ? null : selected,
               task,
               attempt,
               job.conversation()
            );
      boolean more = found.hasMore();

      for (KnowledgeService.Chunk chunk : found.items()) {
         if (known.size() >= 10 && !known.contains(chunk.id())) {
            more = true;
         } else {
            known.add(chunk.id());
            included.add(chunk);
            result.add(new AgentTaskService.Input(chunk.id(), chunk.filename(), chunk.version(), chunk.locator(), chunk.content()));
         }
      }

      KnowledgeService.Coverage coverage;
      for (coverage = found.coverage().limited(10);
         !result.isEmpty() && this.json.writeValueAsBytes(new AgentTaskService.SearchResult(result, found.matchStatus(), coverage, more)).length > 61440;
         more = true
      ) {
         result.removeLast();
         included.removeLast();
      }

      for (KnowledgeService.Chunk chunk : included) {
         this.db
            .update(
               "INSERT INTO conversation_task_material_versions(tenant_id,workspace_id,task_id,attempt_id,material_id,version_id,run_id) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
               new Object[]{job.tenant(), chunk.workspaceId(), task, attempt, chunk.materialId(), chunk.versionId(), chunk.runId()}
            );
         this.db
            .update(
               "INSERT INTO conversation_agent_grants(tenant_id,workspace_id,task_id,attempt_id,chunk_id) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING",
               new Object[]{job.tenant(), job.space(), task, attempt, chunk.id()}
            );
         known.add(chunk.id());
      }

      return new AgentTaskService.SearchResult(List.copyOf(result), found.matchStatus(), coverage, more);
   }

   @Transactional
   public List<TaskOriginals.File> originals(UUID task, UUID attempt) {
      ConversationService.Job j = this.authorized(task, attempt);
      return this.originals.list(j.actor(), j.tenant(), j.space(), j.id());
   }

   @Transactional
   public TaskOriginals.Content readOriginal(UUID task, UUID attempt, UUID version) {
      ConversationService.Job j = this.authorized(task, attempt);
      TaskOriginals.Content content = this.originals.read(j, version);
      this.authorized(task, attempt);
      return content;
   }

   public Map<String, Object> compareTable(UUID task, UUID attempt, TableCalculationService.Request request) {
      TableCalculationService.Input input = (TableCalculationService.Input)this.transactions
         .execute(
            tx -> {
               ConversationService.Job job = this.authorized(task, attempt);
               if ((Integer)this.db
                     .queryForObject(
                        "SELECT count(*) FROM conversation_attempts WHERE task_id=? AND attempt_id=? AND allowed_tools @> '[\"compare_table\"]'::jsonb",
                        Integer.class,
                        new Object[]{task, attempt}
                     )
                  != 1) {
                  throw this.denied();
               } else if ((Integer)this.db
                     .queryForObject(
                        "SELECT count(*) FROM conversation_tool_receipts WHERE task_id=? AND attempt_number=(SELECT attempt FROM conversation_tasks WHERE id=?) AND name='compare_table' AND status='STARTED'",
                        Integer.class,
                        new Object[]{task, task}
                     )
                  == 0) {
                  throw this.denied();
               } else {
                  return this.tables.input(job, request);
               }
            }
         );
      Map<String, Object> result = this.tables.compute(input);
      return (Map<String, Object>)this.transactions.execute(tx -> {
         ConversationService.Job job = this.authorized(task, attempt);
         this.tables.input(job, request);
         return this.tables.save(job, input, result);
      });
   }

   @Transactional
   public Map<String, Object> compareDataset(UUID task, UUID attempt, DatasetCalculationService.Request request) {
      ConversationService.Job job = this.authorized(task, attempt);
      if ((Integer)this.db
               .queryForObject(
                  "SELECT count(*) FROM conversation_attempts WHERE task_id=? AND attempt_id=? AND allowed_tools @> '[\"compare_dataset\"]'::jsonb",
                  Integer.class,
                  new Object[]{task, attempt}
               )
            == 1
         && (Integer)this.db
               .queryForObject(
                  "SELECT count(*) FROM conversation_tool_receipts WHERE task_id=? AND attempt_number=(SELECT attempt FROM conversation_tasks WHERE id=?) AND name='compare_dataset' AND status='STARTED'",
                  Integer.class,
                  new Object[]{task, task}
               )
            != 0) {
         Map<String, Object> result = this.datasets.calculate(job, request);
         this.authorized(task, attempt);
         return result;
      } else {
         throw this.denied();
      }
   }

   @Transactional
   public Map<String, Object> deliverBriefing(UUID task, UUID attempt, BriefingContentService.Request request) {
      ConversationService.Job job = this.authorized(task, attempt);
      if ((Integer)this.db
               .queryForObject(
                  "SELECT count(*) FROM conversation_attempts WHERE task_id=? AND attempt_id=? AND allowed_tools @> '[\"deliver_briefing\"]'::jsonb",
                  Integer.class,
                  new Object[]{task, attempt}
               )
            != 1
         || (Integer)this.db
               .queryForObject(
                  "SELECT count(*) FROM conversation_tool_receipts WHERE task_id=? AND attempt_number=(SELECT attempt FROM conversation_tasks WHERE id=?) AND name='deliver_briefing' AND status='STARTED'",
                  Integer.class,
                  new Object[]{task, task}
               )
            == 0) {
         throw this.denied();
      }

      if (!this.briefings.statusOnly(request)
         || !Boolean.TRUE
            .equals(this.db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_generation_batches WHERE task_id=?)", Boolean.class, new Object[]{task}))) {
         List<String> routing = this.db
            .queryForList("SELECT candidates->selected_index->>'destination' FROM briefing_topic_selections WHERE task_id=?", String.class, new Object[]{task});
         if (!routing.isEmpty() && routing.getFirst() != null && !routing.getFirst().equals("BRIEFING")) {
            throw new IdentityException(422, "BRIEFING_DESTINATION_MISMATCH");
         }

         List<Map<String, Object>> editorial = this.db
            .queryForList(
               "SELECT b.body::text,e.selected_index FROM briefing_editorial_tasks e JOIN briefing_editorial_batches b ON b.id=e.batch_id WHERE e.task_id=?",
               new Object[]{task}
            );
         if (editorial.isEmpty()
            && Boolean.TRUE
               .equals(
                  this.db
                     .queryForObject(
                        "SELECT EXISTS(SELECT 1 FROM briefing_generation_batches WHERE task_id=?) OR EXISTS(SELECT 1 FROM conversation_attempts WHERE task_id=? AND provenance='EXTERNAL_DEPLOYMENT')",
                        Boolean.class,
                        new Object[]{task, task}
                     )
               )) {
            throw new IdentityException(422, "BRIEFING_EDITORIAL_PLAN_REQUIRED");
         }

         JsonNode editorialBody = editorial.isEmpty() ? null : this.json.readTree(editorial.getFirst().get("body").toString());
         int editorialIndex = editorial.isEmpty() ? 0 : (Integer)editorial.getFirst().get("selected_index");
         if (editorialBody != null) {
            BriefingEditorialPlan.delivery(
               (BriefingEditorialPlan.Item)this.json
                  .treeToValue(editorialBody.path("plan").path("items").get(editorialIndex), BriefingEditorialPlan.Item.class),
               (AgentTaskService.TopicCandidate)this.json
                  .treeToValue(editorialBody.path("candidates").get(editorialIndex), AgentTaskService.TopicCandidate.class),
               request
            );
         }

         BriefingContentService.Document doc;
         try {
            doc = this.briefings.create(job, request);
         } catch (BriefingContentService.NoUsefulData empty) {
            this.audit.record(job.actor(), job.tenant(), "TASK_BRIEFING_SKIPPED", job.token(), "SUCCESS");
            return Map.of("contractVersion", "1.0", "status", "NO_NEW_CONTENT", "reason", "NO_USEFUL_CONTENT");
         }

         if (doc != null && editorialBody != null) {
            BriefingEditorialPlan.Item item = (BriefingEditorialPlan.Item)this.json
               .treeToValue(editorialBody.path("plan").path("items").get(editorialIndex), BriefingEditorialPlan.Item.class);
            if ("COMPARISON".equals(item.shape()) && (doc.content().chart() == null || doc.content().chart().rows().size() < 2)
               || "SINGLE_FACT".equals(item.shape()) && (doc.content().chart() == null || doc.content().chart().rows().size() != 1)) {
               throw new IdentityException(422, "BRIEFING_COMPONENT_DATA_MISMATCH");
            }
         }

         if (doc == null) {
            this.audit.record(job.actor(), job.tenant(), "TASK_BRIEFING_DUPLICATE", job.token(), "SUCCESS");
            return Map.of("contractVersion", "1.0", "status", "NO_NEW_CONTENT", "reason", "DUPLICATE_CONTENT");
         } else {
            return Map.of(
               "contractVersion",
               "1.0",
               "status",
               "PREPARED",
               "artifactId",
               doc.artifactId(),
               "title",
               doc.content().title(),
               "visibility",
               "PRIVATE_AFTER_TASK_SUCCEEDS"
            );
         }
      } else {
         if (this.grants(job).isEmpty()
            && !Boolean.TRUE
               .equals(
                  this.db
                     .queryForObject(
                        "SELECT EXISTS(SELECT 1 FROM task_dataset_reads WHERE task_id=? AND attempt_number=(SELECT attempt FROM conversation_tasks WHERE id=?))",
                        Boolean.class,
                        new Object[]{job.id(), job.id()}
                     )
               )) {
            throw new IdentityException(422, "BRIEFING_SOURCES_REQUIRED");
         }

         this.audit.record(job.actor(), job.tenant(), "TASK_BRIEFING_SKIPPED", job.token(), "SUCCESS");
         return Map.of("contractVersion", "1.0", "status", "NO_NEW_CONTENT", "reason", "NO_USEFUL_CONTENT");
      }
   }

   @Transactional
   public BriefingContentService.Document briefing(UUID actor, UUID tenant, UUID conversation, UUID task, int revision, int attempt) {
      ConversationService.Detail detail = this.conversations.taskDetail(actor, tenant, conversation, task);
      ConversationService.Task value = detail.tasks().getFirst();
      if (value.revision() == revision && value.attempt() == attempt && "SUCCEEDED".equals(value.status()) && !value.sourcesUnavailable()) {
         BriefingContentService.Document doc = this.briefings.find(task, attempt);
         if (doc == null) {
            throw new IdentityException(404, "BRIEFING_NOT_FOUND");
         }

         this.artifact(actor, tenant, conversation, task, doc.artifactId(), false);
         return doc;
      } else {
         throw new IdentityException(409, "BRIEFING_VERSION_UNAVAILABLE");
      }
   }

   @Transactional
   public AgentTaskService.Discussion discussion(UUID actor, UUID tenant, UUID sourceConversation, UUID sourceTask, int revision, int attempt) {
      BriefingContentService.Document doc = this.briefing(actor, tenant, sourceConversation, sourceTask, revision, attempt);
      ConversationService.Conversation source = this.conversations.require(actor, tenant, sourceConversation, false);
      List<UUID> existing = this.db
         .queryForList(
            "SELECT conversation_id FROM briefing_discussions WHERE owner_id=? AND source_task_id=? AND source_revision=? AND source_attempt=?",
            UUID.class,
            new Object[]{actor, sourceTask, revision, attempt}
         );
      UUID destination = existing.isEmpty() ? null : existing.getFirst();
      if (destination != null) {
         this.conversations.require(actor, tenant, destination, false);
      }

      return new AgentTaskService.Discussion(
         destination, doc.content().title(), new ConversationService.BriefingReference(sourceConversation, sourceTask, source.workspaceId(), revision, attempt)
      );
   }

   @Transactional
   public ConversationService.Detail sendDiscussion(
      UUID actor,
      UUID tenant,
      UUID draft,
      ConversationService.BriefingReference source,
      UUID space,
      UUID request,
      String prompt,
      String mode,
      String publicQuery,
      List<TaskOriginals.Selection> selected,
      String sourceScope
   ) {
      if (source != null
         && source.conversationId() != null
         && source.taskId() != null
         && source.workspaceId() != null
         && source.taskRevision() >= 0
         && source.attempt() >= 0) {
         String key = "briefing-discussion:" + tenant + ":" + actor + ":" + source.taskId() + ":" + source.taskRevision() + ":" + source.attempt();
         this.db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", new Object[]{key});
         AgentTaskService.Discussion opened = this.discussion(actor, tenant, source.conversationId(), source.taskId(), source.taskRevision(), source.attempt());
         if (opened.briefingContext().workspaceId().equals(source.workspaceId()) && (space == null || space.equals(source.workspaceId()))) {
            UUID destination = opened.conversationId();
            if (destination != null && draft != null && !destination.equals(draft)) {
               throw new IdentityException(409, "CONVERSATION_PURPOSE_MISMATCH");
            }

            if (destination == null) {
               if (draft != null) {
                  ConversationService.Conversation candidate = this.conversations.require(actor, tenant, draft, true);
                  if (!candidate.workspaceId().equals(source.workspaceId())
                     || !Boolean.TRUE
                        .equals(
                           this.db
                              .queryForObject(
                                 "SELECT purpose='BUSINESS' AND NOT EXISTS(SELECT 1 FROM conversation_tasks t WHERE t.conversation_id=c.id) FROM conversations c WHERE c.id=?",
                                 Boolean.class,
                                 new Object[]{draft}
                              )
                        )) {
                     throw new IdentityException(409, "CONVERSATION_PURPOSE_MISMATCH");
                  }

                  destination = draft;
               } else {
                  destination = this.conversations
                     .draft(actor, tenant, source.workspaceId(), UUID.nameUUIDFromBytes(key.getBytes(StandardCharsets.UTF_8)))
                     .id();
               }

               this.db
                  .update(
                     "INSERT INTO briefing_discussions VALUES(?,?,?,?,?)",
                     new Object[]{destination, source.taskId(), source.taskRevision(), source.attempt(), actor}
                  );
               this.db
                  .update(
                     "UPDATE conversations SET title=? WHERE id=?",
                     new Object[]{opened.title().substring(0, Math.min(80, opened.title().length())), destination}
                  );
            }

            return this.conversations.submitClient(actor, tenant, destination, source.workspaceId(), request, prompt, mode, publicQuery, selected, sourceScope);
         } else {
            throw IdentityException.invalid();
         }
      } else {
         throw IdentityException.invalid();
      }
   }

   public boolean active(ConversationService.Job job) {
      try {
         return Boolean.TRUE.equals(this.transactions.execute(status -> {
            this.authorized(job.id(), job.token());
            return true;
         }));
      } catch (IdentityException error) {
         return false;
      }
   }

   private void incompatible() {
      throw new IdentityException(502, "TASK_RUNTIME_INCOMPATIBLE");
   }

   @Transactional
   public void finish(ConversationService.Job expected, AgentResult r) {
      ConversationService.Job job = this.authorized(expected.id(), expected.token());
      Map<String, Object> stop = this.db
         .queryForMap("SELECT stop_requested,stop_action FROM conversation_attempts WHERE task_id=? AND attempt_id=?", new Object[]{job.id(), job.token()});
      if (Boolean.TRUE.equals(stop.get("stop_requested"))) {
         String next = "PAUSE".equals(stop.get("stop_action")) ? "PAUSED" : "CANCELLED";
         this.db
            .update(
               "UPDATE conversation_tasks SET status=?,revision=revision+1,lease_token=NULL,lease_until=NULL,finished_at=now() WHERE id=?",
               new Object[]{next, job.id()}
            );
         this.conversations.archive(job.id());
         this.usage.terminal(job.id(), job.token(), next);
         this.conversations
            .event(
               job.tenant(),
               job.space(),
               job.conversation(),
               job.id(),
               next,
               (Integer)this.db.queryForObject("SELECT revision FROM conversation_tasks WHERE id=?", Integer.class, new Object[]{job.id()})
            );
      } else {
         if (r == null
            || !"1.4".equals(r.contractVersion()) && !"1.5".equals(r.contractVersion())
            || !job.id().equals(r.taskId())
            || !job.token().equals(r.attemptId())
            || !"AGENT".equals(r.mode())
            || !this.settings.mode().equals(r.executionClass())
            || r.engineVersion() == null
            || !r.engineVersion().matches("[A-Za-z0-9.\\-]{1,64}")
            || r.modelName() == null
            || !r.modelName().matches("[A-Za-z0-9._\\-]{1,80}")
            || r.text() == null
            || r.text().isBlank()
            || r.text().length() > 16000
            || r.modelCalls() < 1
            || r.modelCalls() > 8
            || r.sourceIds() == null
            || r.sourceIds().size() > (this.wikiLearning.ownsTask(job.id()) ? 128 : 10)
            || new HashSet<>(r.sourceIds()).size() != r.sourceIds().size()
            || !new HashSet<>(r.sourceIds()).equals(new HashSet<>(this.grants(job)))
            || r.originalIds() == null
            || r.originalIds().size() > 3
            || new HashSet<>(r.originalIds()).size() != r.originalIds().size()
            || !new HashSet<>(r.originalIds()).equals(new HashSet<>(this.originals.readIds(job.id(), job.token())))
            || r.tools() == null
            || r.tools().size() > 8
            || r.artifacts() == null
            || r.artifacts().size() > 8) {
            this.incompatible();
         }

         if (r.usage() != null
            && (r.usage().inputTokens() < 0L || r.usage().outputTokens() < 0L || r.usage().inputTokens() > 1000000L || r.usage().outputTokens() > 1000000L)) {
            this.incompatible();
         }

         String outcome = "1.4".equals(r.contractVersion()) ? "COMPLETE" : r.outcome();
         if (outcome == null
            || !Set.of("COMPLETE", "PARTIAL", "WAITING_INPUT", "WAITING_CAPABILITY").contains(outcome)
            || r.requiredInput() != null && r.requiredInput().length() > 1000
            || "WAITING_INPUT".equals(outcome) && (r.requiredInput() == null || r.requiredInput().isBlank())) {
            this.incompatible();
         }

         if ("1.4".equals(r.contractVersion())
            && (
               r.outcome() != null
                  || r.requiredInput() != null
                  || r.tools()
                     .stream()
                     .anyMatch(
                        t -> t != null
                           && (
                              !"succeeded".equals(t.status())
                                 || Set.of("ask_user", "task_control", "task_context", "task_plan", "task_preference", "manage_plan")
                                    .contains(t.name() == null ? "" : t.name())
                           )
                     )
            )) {
            this.incompatible();
         }

         boolean terminalProof = this.briefings
                  .find(job.id(), (Integer)this.db.queryForObject("SELECT attempt FROM conversation_tasks WHERE id=?", Integer.class, new Object[]{job.id()}))
               != null
            || Boolean.TRUE
               .equals(
                  this.db
                     .queryForObject(
                        "SELECT EXISTS(SELECT 1 FROM identity_audit WHERE tenant_id=? AND target_id=? AND action IN ('TASK_BRIEFING_DUPLICATE','TASK_BRIEFING_SKIPPED') AND outcome='SUCCESS')",
                        Boolean.class,
                        new Object[]{job.tenant(), job.token()}
                     )
               );
         boolean recoveredDelivery = "1.5".equals(r.contractVersion())
            && Boolean.TRUE
               .equals(
                  this.db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_generation_batches WHERE task_id=?)", Boolean.class, new Object[]{job.id()})
               )
            && terminalProof
            && !r.tools().isEmpty()
            && r.tools().getLast() != null
            && "deliver_briefing".equals(r.tools().getLast().name())
            && "succeeded".equals(r.tools().getLast().status())
            && Boolean.TRUE
               .equals(
                  this.db
                     .queryForObject(
                        "SELECT coalesce((SELECT name='deliver_briefing' AND status='succeeded' FROM conversation_tool_receipts WHERE task_id=? AND attempt_number=(SELECT attempt FROM conversation_tasks WHERE id=?) ORDER BY sequence DESC LIMIT 1),false)",
                        Boolean.class,
                        new Object[]{job.id(), job.id()}
                     )
               )
            && this.recoverableNativeToolFailures(job.id())
            && r.tools()
               .stream()
               .allMatch(t -> t != null && ("succeeded".equals(t.status()) || ("deliver_briefing".equals(t.name()) || "task_context".equals(t.name())) && "failed".equals(t.status())));
         if ("COMPLETE".equals(outcome) && r.tools().stream().anyMatch(t -> t != null && !"succeeded".equals(t.status())) && !recoveredDelivery) {
            this.incompatible();
         }

         if (Set.of("WAITING_INPUT", "WAITING_CAPABILITY").contains(outcome)
            && r.tools()
               .stream()
               .noneMatch(
                  t -> t != null
                     && (
                        "render_presentation".equals(t.name()) && "WAITING_INPUT".equals(outcome) && this.presentations.draft(job.id())
                           || "task_control".equals(t.name())
                           || "WAITING_INPUT".equals(outcome)
                              && "ask_user".equals(t.name())
                              && Boolean.TRUE
                                 .equals(
                                    this.db
                                       .queryForObject(
                                          "SELECT EXISTS(SELECT 1 FROM conversation_live_questions WHERE task_id=? AND attempt_number=(SELECT attempt FROM conversation_tasks WHERE id=?) AND blocking)",
                                          Boolean.class,
                                          new Object[]{job.id(), job.id()}
                                       )
                                 )
                     )
                     && "succeeded".equals(t.status())
               )) {
            this.incompatible();
         }

         if ("1.5".equals(r.contractVersion())) {
            List<Map<String, Object>> stored = this.db
               .queryForList(
                  "SELECT name,status FROM conversation_tool_receipts WHERE task_id=? AND attempt_number=(SELECT attempt FROM conversation_tasks WHERE id=?) ORDER BY sequence",
                  new Object[]{job.id(), job.id()}
               );
            List<String> expectedTools = r.tools().stream().map(t -> t == null ? "invalid" : t.name() + "/" + t.status()).sorted().toList();
            if (!stored.stream().map(t -> t.get("name") + "/" + t.get("status")).sorted().toList().equals(expectedTools)
               || (Integer)this.db
                     .queryForObject(
                        "SELECT count(*) FROM conversation_attempts WHERE task_id=? AND attempt_id=? AND execution_policy IN ('READ_ONLY_PRIVATE_V1','SCOPED_PRIVATE_V2')",
                        Integer.class,
                        new Object[]{job.id(), job.token()}
                     )
                  != 1) {
               this.incompatible();
            }
         }

         if ("COMPLETE".equals(outcome)
            && Boolean.TRUE
               .equals(this.db.queryForObject("SELECT EXISTS(SELECT 1 FROM conversation_presentations WHERE task_id=?)", Boolean.class, new Object[]{job.id()}))
            && r.tools().stream().noneMatch(t -> t != null && "render_presentation".equals(t.name()) && "succeeded".equals(t.status()))) {
            this.incompatible();
         }

         this.wikiLearning.validateResult(job, r);
         this.wikiGraph.validateResult(job, r);
         this.wikiInsight.validateResult(job, r);
         this.datasetInsight.validateResult(job, r);
         this.usage.validateResult(job.id(), job.token(), r.modelCalls(), r.usage());
         HashSet<String> calls = new HashSet<>();
         boolean code = false;

         for (AgentResult.Tool tool : r.tools()) {
            if (tool == null
               || tool.callId() == null
               || !tool.callId().matches("[!-~]{1,128}")
               || !calls.add(tool.callId())
               || tool.status() == null
               || !Set.of("succeeded", "failed").contains(tool.status())
               || tool.name() == null
               || !Set.of(
                     "request_briefing_evidence",
                     "select_briefing_topic",
                     "deliver_briefing",
                     "compare_table",
                     "compare_dataset",
                     "search_sources",
                     "run_javascript",
                     "find_skills",
                     "activate_skill",
                     "read_skill_resource",
                     "render_presentation",
                     "public_search",
                     "read_public_page",
                     "candidate_tool",
                     "list_originals",
                     "read_original",
                     "process_original",
                     "ask_user",
                     "task_control",
                     "task_context",
                     "task_plan",
                     "task_preference",
                     "manage_plan"
                  )
                  .contains(tool.name())) {
               this.incompatible();
            }

            if ("candidate_tool".equals(tool.name())) {
               if (!this.settings.candidateTrialsEnabled()
                  || !this.settings.mode().equals("verification")
                  || this.db.queryForObject("SELECT public_query IS NOT NULL FROM conversation_tasks WHERE id=?", Boolean.class, new Object[]{job.id()})
                     != Boolean.TRUE
                  || r.skills() == null
                  || r.skills().stream().noneMatch(s -> s != null && "candidate-trials".equals(s.id()))) {
                  this.incompatible();
               }

               code = code || "succeeded".equals(tool.status());
            }

            if ("process_original".equals(tool.name())) {
               if (!this.settings.mode().equals("verification")
                  || r.originalIds().isEmpty()
                  || r.skills() == null
                  || r.skills().stream().noneMatch(s -> s != null && "file-processing".equals(s.id()))) {
                  this.incompatible();
               }

               code = code || "succeeded".equals(tool.status());
            }

            if ("render_presentation".equals(tool.name())) {
               if (!this.artifactTransfers.presentationAvailable()
                  || !"1.5".equals(r.contractVersion())
                  || r.skills() == null
                  || r.skills().stream().noneMatch(v -> v != null && "pptx-generator".equals(v.id()) && "1.0.0".equals(v.version()))) {
                  this.incompatible();
               }

               if ("succeeded".equals(tool.status())) {
                  if ("WAITING_INPUT".equals(outcome) && this.presentations.draft(job.id()) && r.artifacts().isEmpty()) {
                     continue;
                  }

                  if (!this.presentations.confirmed(job.id())) {
                     this.incompatible();
                  }

                  if (r.artifacts().size() != 2
                     || r.artifacts().stream().anyMatch(a -> a == null || a.uploadId() == null || a.contentBase64() != null)
                     || !r.artifacts()
                        .stream()
                        .map(AgentResult.Artifact::name)
                        .collect(Collectors.toSet())
                        .equals(Set.of("presentation.pptx", "presentation-source.json"))) {
                     this.incompatible();
                  }

                  code = true;
               }
            }

            if ("run_javascript".equals(tool.name())) {
               if (!this.settings.mode().equals("verification")) {
                  this.incompatible();
               }

               code = code || "succeeded".equals(tool.status());
            }
         }

         if (!r.originalIds().isEmpty() && r.tools().stream().noneMatch(t -> "read_original".equals(t.name()))) {
            this.incompatible();
         }

         if (!r.artifacts().isEmpty() && !code) {
            this.incompatible();
         }

         if (r.tools().stream().anyMatch(t -> "deliver_briefing".equals(t.name()) && "succeeded".equals(t.status()))
            && this.briefings
                  .find(job.id(), (Integer)this.db.queryForObject("SELECT attempt FROM conversation_tasks WHERE id=?", Integer.class, new Object[]{job.id()}))
               == null
            && !Boolean.TRUE
               .equals(
                  this.db
                     .queryForObject(
                        "SELECT EXISTS(SELECT 1 FROM identity_audit WHERE tenant_id=? AND target_id=? AND action IN ('TASK_BRIEFING_DUPLICATE','TASK_BRIEFING_SKIPPED') AND outcome='SUCCESS')",
                        Boolean.class,
                        new Object[]{job.tenant(), job.token()}
                     )
               )) {
            this.incompatible();
         }

         this.validateResearch(job, r);
         int total = (Integer)this.db
            .queryForObject(
               "SELECT coalesce(sum(octet_length(content)),0) FROM conversation_artifacts WHERE task_id=? AND attempt_number=(SELECT attempt FROM conversation_tasks WHERE id=?)",
               Integer.class,
               new Object[]{job.id(), job.id()}
            );
         if (r.artifacts().size()
               + (Integer)this.db
                  .queryForObject(
                     "SELECT count(*) FROM conversation_artifacts WHERE task_id=? AND attempt_number=(SELECT attempt FROM conversation_tasks WHERE id=?)",
                     Integer.class,
                     new Object[]{job.id(), job.id()}
                  )
            > 8) {
            this.incompatible();
         }

         ArrayList<ArtifactTransferService.File> files = new ArrayList<>();
         HashSet<UUID> transferIds = new HashSet<>();
         HashSet<String> names = new HashSet<>();
         int inlineBytes = 0;

         try {
            for (AgentResult.Artifact artifact : r.artifacts()) {
               if (artifact == null
                  || artifact.name() == null
                  || !artifact.name().matches("[A-Za-z0-9][A-Za-z0-9._-]{0,79}")
                  || !names.add(artifact.name().toLowerCase(Locale.ROOT))
                  || artifact.sha256() == null
                  || !artifact.sha256().matches("[0-9a-f]{64}")) {
                  this.incompatible();
               }

               if (Boolean.TRUE
                  .equals(
                     this.db
                        .queryForObject(
                           "SELECT EXISTS(SELECT 1 FROM conversation_artifacts WHERE task_id=? AND attempt_number=(SELECT attempt FROM conversation_tasks WHERE id=?) AND lower(filename)=lower(?))",
                           Boolean.class,
                           new Object[]{job.id(), job.id(), artifact.name()}
                        )
                  )) {
                  this.incompatible();
               }

               if (artifact.uploadId() != null) {
                  if (!"1.5".equals(r.contractVersion()) || artifact.contentBase64() != null || !transferIds.add(artifact.uploadId())) {
                     this.incompatible();
                  }

                  ArtifactTransferService.File file = this.artifactTransfers
                     .resolve(job.id(), job.token(), artifact.uploadId(), artifact.name(), artifact.sha256());
                  total += file.bytes().length;
                  files.add(file);
               } else {
                  if (artifact.contentBase64() == null || artifact.contentBase64().length() > 90000) {
                     this.incompatible();
                  }

                  byte[] bytes = Base64.getDecoder().decode(artifact.contentBase64());
                  total += bytes.length;
                  inlineBytes += bytes.length;
                  if (inlineBytes > 65536
                     || !Base64.getEncoder().encodeToString(bytes).equals(artifact.contentBase64())
                     || !HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)).equals(artifact.sha256())) {
                     this.incompatible();
                  }

                  files.add(new ArtifactTransferService.File(UUID.randomUUID(), artifact.name(), artifact.sha256(), bytes));
               }

               if (total > 20971520) {
                  this.incompatible();
               }
            }
         } catch (IdentityException error) {
            throw error;
         } catch (Exception error) {
            this.incompatible();
         }

         if (transferIds.isEmpty() && total > 65536) {
            this.incompatible();
         }

         int ordinal = 0;

         for (UUID source : r.sourceIds()) {
            this.db
               .update(
                  "INSERT INTO conversation_sources(tenant_id,workspace_id,task_id,chunk_id,ordinal,attempt_number) VALUES (?,?,?,?,?,(SELECT attempt FROM conversation_tasks WHERE id=?))",
                  new Object[]{job.tenant(), job.space(), job.id(), source, ordinal++, job.id()}
               );
         }

         for (ArtifactTransferService.File file : files) {
            this.db
               .update(
                  "INSERT INTO conversation_artifacts(id,tenant_id,workspace_id,task_id,filename,sha256,content,attempt_number,transferred) VALUES (?,?,?,?,?,?,?,(SELECT attempt FROM conversation_tasks WHERE id=?),?)",
                  new Object[]{
                     file.id(), job.tenant(), job.space(), job.id(), file.filename(), file.sha256(), file.bytes(), job.id(), transferIds.contains(file.id())
                  }
               );
            if (transferIds.contains(file.id())) {
               this.artifactTransfers.published(job.id(), job.token(), file.id());
            }
         }

         String state = "COMPLETE".equals(outcome) ? "SUCCEEDED" : outcome;
         String waitReason = "WAITING_INPUT".equals(state)
            ? (this.presentations.draft(job.id()) ? "PRESENTATION_CONFIRMATION" : "INPUT_REQUIRED")
            : ("WAITING_CAPABILITY".equals(state) ? "CAPABILITY_UNAVAILABLE" : null);
         this.db
            .update(
               "UPDATE conversation_tasks SET status=?,wait_reason=?,required_input=?,revision=revision+1,reply=?,model_name=?,model_calls=?,token_usage=CAST(? AS jsonb),tool_receipts=CAST(? AS jsonb),engine_version=?,web_sources=CAST(? AS jsonb),skills=CAST(? AS jsonb),lease_token=NULL,lease_until=NULL,finished_at=now() WHERE id=?",
               new Object[]{
                  state,
                  waitReason,
                  r.requiredInput(),
                  r.text(),
                  r.modelName(),
                  r.modelCalls(),
                  this.json.writeValueAsString(r.usage()),
                  this.json.writeValueAsString(r.tools()),
                  r.engineVersion(),
                  this.json.writeValueAsString(r.webSources()),
                  this.json.writeValueAsString(r.skills()),
                  job.id()
               }
            );
         if ("SUCCEEDED".equals(state)
            && (Boolean)this.db
               .queryForObject(
                  "SELECT EXISTS(SELECT 1 FROM briefing_generation_batches WHERE task_id=? AND business_type='INFO')", Boolean.class, new Object[]{job.id()}
               )) {
            for (AgentResult.WebSource source : r.webSources()) {
               if ("PAGE".equals(source.kind())) {
                  this.db
                     .update(
                        "INSERT INTO news_article_deliveries(tenant_id,owner_id,url,sha256,task_id,published_at,retrieved_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
                        new Object[]{
                           job.tenant(),
                           job.actor(),
                           source.url(),
                           source.sha256(),
                           job.id(),
                           source.publishedAt() == null ? null : Timestamp.from(source.publishedAt()),
                           Timestamp.from(source.retrievedAt())
                        }
                     );
               }
            }
         }

         this.conversations.archive(job.id());
         if ("SUCCEEDED".equals(state) && this.briefingFlow != null) {
            this.briefingFlow.retain(job.id());
         }

         this.usage.terminal(job.id(), job.token(), state);
         int revision = (Integer)this.db.queryForObject("SELECT revision FROM conversation_tasks WHERE id=?", Integer.class, new Object[]{job.id()});
         this.conversations.event(job.tenant(), job.space(), job.conversation(), job.id(), state, revision);
         this.audit.record(job.actor(), job.tenant(), state.equals("SUCCEEDED") ? "TASK_COMPLETE" : "TASK_" + state, job.id(), "SUCCESS");
      }
   }

   private void validateResearch(ConversationService.Job job, AgentResult result) {
      if (result.webSources() == null || result.webSources().size() > 3 || result.skills() == null || result.skills().size() > 8) {
         this.incompatible();
      }

      boolean publicAllowed = this.settings.publicWebEnabled()
         && (Boolean)this.db.queryForObject("SELECT public_query IS NOT NULL FROM conversation_tasks WHERE id=?", Boolean.class, new Object[]{job.id()});
      if (!publicAllowed
         && (!result.webSources().isEmpty() || result.tools().stream().anyMatch(t -> Set.of("public_search", "read_public_page").contains(t.name())))) {
         this.incompatible();
      }

      HashSet<String> skills = new HashSet<>();

      for (AgentResult.Skill skill : result.skills()) {
         if (skill == null
            || skill.id() == null
            || !skill.id().matches("[a-z][a-z0-9-]{0,63}")
            || !skills.add(skill.id())
            || skill.version() == null
            || !skill.version().matches("[0-9]{1,8}\\.[0-9]{1,8}\\.[0-9]{1,8}")
            || skill.sha256() == null
            || !skill.sha256().matches("[a-f0-9]{64}")
            || "public-research".equals(skill.id()) && !publicAllowed
            || "candidate-trials".equals(skill.id()) && (!publicAllowed || !this.settings.candidateTrialsEnabled())) {
            this.incompatible();
         }
      }

      if (result.tools().stream().anyMatch(t -> "read_skill_resource".equals(t.name())) && skills.isEmpty()) {
         this.incompatible();
      }

      if (!skills.isEmpty() && result.tools().stream().noneMatch(t -> "activate_skill".equals(t.name()))) {
         this.incompatible();
      }

      if (!result.webSources().isEmpty() && (!skills.contains("public-research") || result.tools().stream().noneMatch(t -> "public_search".equals(t.name())))) {
         this.incompatible();
      }

      if (result.tools().stream().anyMatch(t -> Set.of("public_search", "read_public_page").contains(t.name())) && !skills.contains("public-research")) {
         this.incompatible();
      }

      HashSet<UUID> ids = new HashSet<>();

      for (AgentResult.WebSource source : result.webSources()) {
         if (source != null && source.image() != null && !NewsImage.valid(source.image())) {
            this.incompatible();
         }

         if (source != null && source.publishedAt() != null && source.publishedAt().isAfter(Instant.now().plusSeconds(86400L))) {
            this.incompatible();
         }

         if (source == null
            || source.id() == null
            || !ids.add(source.id())
            || source.url() == null
            || source.url().length() > 2048
            || source.title() == null
            || source.title().length() > 160
            || source.excerpt() == null
            || source.excerpt().length() > 4000
            || source.sha256() == null
            || !source.sha256().equals(IdentityService.hash(source.excerpt()))
            || source.retrievedAt() == null
            || source.retrievedAt().isAfter(Instant.now().plusSeconds(60L))
            || source.kind() == null
            || !Set.of("SEARCH", "PAGE").contains(source.kind())) {
            this.incompatible();
         }

         try {
            URI uri = URI.create(source.url());
            if (!"https".equals(uri.getScheme())
               || uri.getHost() == null
               || uri.getUserInfo() != null
               || uri.getFragment() != null
               || uri.getPort() != -1 && uri.getPort() != 443) {
               this.incompatible();
            }
         } catch (IllegalArgumentException error) {
            this.incompatible();
         }

         if ("PAGE".equals(source.kind()) && result.tools().stream().noneMatch(t -> "read_public_page".equals(t.name()))) {
            this.incompatible();
         }
      }
   }

   @Transactional
   public AgentTaskService.Download download(UUID actor, UUID tenant, UUID conversation, UUID task, UUID artifact) {
      return this.artifact(actor, tenant, conversation, task, artifact, true);
   }

   private AgentTaskService.Download artifact(UUID actor, UUID tenant, UUID conversation, UUID task, UUID artifact, boolean download) {
      ConversationService.Conversation context = this.conversations.require(actor, tenant, conversation, false);
      this.conversations.requireReadable(task);
      if (download
         && !Boolean.TRUE.equals(this.db.queryForObject("SELECT library_task_sources_allowed(?,?,?,true)", Boolean.class, new Object[]{actor, tenant, task}))) {
         throw new IdentityException(403, "LIBRARY_DOWNLOAD_DENIED");
      }

      List<AgentTaskService.Download> rows = this.db
         .query(
            "SELECT a.filename,a.sha256,a.content FROM conversation_artifacts a JOIN conversation_tasks t ON t.id=a.task_id WHERE a.tenant_id=? AND a.workspace_id=? AND a.task_id=? AND a.id=? AND object_is_active('ARTIFACT',a.id) AND t.conversation_id=? AND EXISTS(SELECT 1 FROM conversation_attempts h WHERE h.task_id=t.id AND h.attempt_number=a.attempt_number AND h.status IN ('SUCCEEDED','PARTIAL','WAITING_INPUT','WAITING_CAPABILITY'))",
            (rs, n) -> new AgentTaskService.Download(rs.getString(1), rs.getString(2), rs.getBytes(3)),
            new Object[]{tenant, context.workspaceId(), task, artifact, conversation}
         );
      if (rows.isEmpty()) {
         throw new IdentityException(404, "ARTIFACT_NOT_FOUND");
      }

      for (UUID id : this.db.queryForList("SELECT chunk_id FROM conversation_sources WHERE task_id=?", UUID.class, new Object[]{task})) {
         this.knowledge.citation(actor, tenant, id);
      }

      this.originals.list(actor, tenant, context.workspaceId(), task);
      return rows.getFirst();
   }

   public record Discussion(UUID conversationId, String title, ConversationService.BriefingReference briefingContext) {
   }

   public record Download(String filename, String sha256, byte[] bytes) {
   }

   public record ExecutionOpen(String contractVersion, List<String> tools) {
   }

   public record Input(UUID id, String filename, int version, String locator, String content) {
   }

   public record SearchResult(List<AgentTaskService.Input> items, String matchStatus, KnowledgeService.Coverage coverage, boolean hasMore) {
   }

   /** Only persisted engine receipts can classify a pre-invocation argument rejection. */
   private boolean recoverableNativeToolFailures(UUID task) {
      var receipts = this.db.queryForList("SELECT x.name,x.status,x.rejection FROM conversation_tool_receipts x JOIN conversation_tasks t ON t.id=x.task_id AND t.attempt=x.attempt_number WHERE x.task_id=? ORDER BY x.sequence", task);
      for (int i = 0; i < receipts.size(); i++) {
         var failed = receipts.get(i);
         if ("succeeded".equals(failed.get("status"))) continue;
         if (!"failed".equals(failed.get("status"))) return false;
         if ("deliver_briefing".equals(failed.get("name"))) continue;
         if (!"task_context".equals(failed.get("name")) || !"CONTEXT_ARGUMENTS".equals(failed.get("rejection"))) return false;
         boolean corrected = false;
         for (int next = i + 1; next < receipts.size(); next++)
            if ("task_context".equals(receipts.get(next).get("name")) && "succeeded".equals(receipts.get(next).get("status"))) { corrected = true; break; }
         if (!corrected) return false;
      }
      return true;
   }

   public record ToolReceipt(Integer sequence, String name, String status, String rejection) {
      public ToolReceipt(Integer sequence, String name, String status) { this(sequence, name, status, null); }
   }

   public record TopicCandidate(
      String question,
      String evidenceNeeded,
      boolean requiresCalculation,
      String difference,
      String businessType,
      String goal,
      String destination,
      String userValue
   ) {
      public TopicCandidate(String question, String evidenceNeeded, boolean requiresCalculation, String difference, String businessType) {
         this(question, evidenceNeeded, requiresCalculation, difference, businessType, null, null, null);
      }
   }

   public record TopicSelection(List<AgentTaskService.TopicCandidate> candidates, Integer selectedIndex, BriefingEditorialPlan.Plan editorialPlan) {
      public TopicSelection(List<AgentTaskService.TopicCandidate> candidates, Integer selectedIndex) {
         this(candidates, selectedIndex, null);
      }
   }
}
