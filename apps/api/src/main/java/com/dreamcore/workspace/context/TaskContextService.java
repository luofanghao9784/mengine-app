package com.dreamcore.workspace.context;

import com.dreamcore.workspace.conversation.AgentTaskService;
import com.dreamcore.workspace.conversation.BriefingBusinessPlan;
import com.dreamcore.workspace.conversation.BriefingContentService;
import com.dreamcore.workspace.conversation.BriefingGenerationContract;
import com.dreamcore.workspace.experience.ExperienceService;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.IdentityService;
import com.dreamcore.workspace.material.MaterialAccess;
import com.dreamcore.workspace.profile.ProfileService;
import com.dreamcore.workspace.scene.OnboardingReconciliationService;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.Map.Entry;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class TaskContextService {
   @Autowired
   private OnboardingReconciliationService reconciliation;
   private final JdbcTemplate db;
   private final AgentTaskService agents;
   private final ProfileService profiles;
   private final ExperienceService experiences;
   private final MaterialAccess materials;
   private final TaskContextGuard guard;
   private final JsonMapper json = new JsonMapper();
   private final BriefingContentService briefings;
   private final DatasetTaskContext datasets;
   private final GeneralExperienceTaskContext general;

   public TaskContextService(
      JdbcTemplate db,
      AgentTaskService agents,
      ProfileService profiles,
      ExperienceService experiences,
      MaterialAccess materials,
      TaskContextGuard guard,
      BriefingContentService briefings,
      DatasetTaskContext datasets,
      GeneralExperienceTaskContext general
   ) {
      this.general = general;
      this.datasets = datasets;
      this.briefings = briefings;
      this.db = db;
      this.agents = agents;
      this.profiles = profiles;
      this.experiences = experiences;
      this.materials = materials;
      this.guard = guard;
   }

   private IdentityException missing() {
      return new IdentityException(404, "TASK_CONTEXT_NOT_FOUND");
   }

   private String text(String s, int max, boolean required) {
      if (s == null) {
         s = "";
      }

      if (s.length() <= max && (!required || !s.isBlank()) && !s.codePoints().anyMatch(c -> Character.isISOControl(c) && c != 10 && c != 13 && c != 9)) {
         return s.strip();
      } else {
         throw IdentityException.invalid();
      }
   }

   private int offset(TaskContextService.Request r) {
      int n = r.offset() == null ? 0 : r.offset();
      if (n >= 0 && n <= 1000) {
         return n;
      } else {
         throw IdentityException.invalid();
      }
   }

   private int methodSplit(String body) {
      return body.length() > 8000 && Character.isHighSurrogate(body.charAt(7999)) ? 8001 : 8000;
   }

   private String clip(String value, int limit) {
      if (value == null) {
         return "";
      }

      if (value.length() <= limit) {
         return value;
      }

      int end = Character.isHighSurrogate(value.charAt(limit - 1)) ? limit - 1 : limit;
      return value.substring(0, end);
   }

   private Map<String, Object> map(Object... values) {
      LinkedHashMap<String, Object> out = new LinkedHashMap<>();

      for (int i = 0; i < values.length; i += 2) {
         out.put((String)values[i], values[i + 1]);
      }

      return out;
   }

   private TaskContextService.Task task(UUID task, UUID token) {
      this.agents.check(task, token);
      this.guard.requireCurrent(task);
      return (TaskContextService.Task)this.db
         .queryForObject(
            "SELECT requested_by,tenant_id,workspace_id,conversation_id,attempt FROM conversation_tasks WHERE id=?",
            (r, n) -> new TaskContextService.Task(
               task, r.getObject(1, UUID.class), r.getObject(2, UUID.class), r.getObject(3, UUID.class), r.getObject(4, UUID.class), r.getInt(5)
            ),
            new Object[]{task}
         );
   }

   @Transactional
   public Map<String, Object> context(UUID task, UUID token, TaskContextService.Request r) {
      TaskContextService.Task t = this.task(task, token);
      if (r != null && r.action() != null) {
         Object result = switch (r.action()) {
            case "bootstrap" -> this.bootstrap(t);
            case "reconciliation_catalog" -> this.reconciliationCatalog(t);
            case "reconciliation_execute" -> this.reconcile(t, token, r);
            case "briefing_plan" -> this.plan(t, token, r);
            case "dataset_search", "dataset_read" -> this.datasets.read(task, r);
            case "general_experience_search", "general_experience_read", "general_experience_use" -> this.general.read(task, r);
            case "profiles" -> this.profilesSelectedOnly(t)
               ? this.map("items", List.of(), "hasMore", false, "reason", "SELECTED_ONLY")
               : this.profileList(t, r);
            case "profile_read" -> this.profilesSelectedOnly(t) ? this.map("unavailable", true, "reason", "SELECTED_ONLY") : this.profile(t, r);
            case "history" -> this.selectedOnly(t) ? this.map("items", List.of(), "hasMore", false, "reason", "SELECTED_ONLY") : this.history(t, r);
            case "experience_search" -> this.selectedOnly(t) ? this.map("items", List.of(), "hasMore", false, "reason", "SELECTED_ONLY") : this.search(t, r);
            case "experience_read" -> this.selectedOnly(t) ? this.map("unavailable", true, "reason", "SELECTED_ONLY") : this.experience(t, r, true);
            case "experience_use" -> this.selectedOnly(t) ? this.map("unavailable", true, "reason", "SELECTED_ONLY") : this.review(t, r);
            default -> throw IdentityException.invalid();
         };
         this.agents.check(task, token);
         this.guard.requireCurrent(task);
         Map<String, Object> response = this.map("contractVersion", "1.0", "action", r.action(), "referenceOnly", true, "result", result);
         if (this.json.writeValueAsString(response).getBytes(StandardCharsets.UTF_8).length > 57344) {
            throw new IdentityException(413, "TASK_CONTEXT_LIMIT");
         } else {
            return response;
         }
      } else {
         throw IdentityException.invalid();
      }
   }

   private Object reconciliationCatalog(TaskContextService.Task t) {
      if (this.selectedOnly(t)) {
         return this.map("stores", List.of());
      }

      JsonNode result = this.json.valueToTree(this.reconciliation.catalog(t.actor(), t.tenant()));
      ArrayList<Object> stores = new ArrayList<>();
      String scope = (String)this.db.queryForObject("SELECT source_scope FROM conversation_tasks WHERE id=?", String.class, new Object[]{t.id()});

      for (JsonNode store : result.path("stores")) {
         boolean allowed = true;

         for (String id : this.reconciliation.inputs(t.tenant(), store.path("id").asText()).snapshots().keySet()) {
            if (!"AUTHORIZED_LIBRARY".equals(scope)
               && !t.space()
                  .equals(this.db.queryForObject("SELECT workspace_id FROM business_datasets WHERE id=?", UUID.class, new Object[]{UUID.fromString(id)}))) {
               allowed = false;
            }
         }

         if (allowed) {
            stores.add(store);
         }
      }

      return this.map("stores", stores, "ruleVersion", "ninepop-first-three-v1");
   }

   private Object reconcile(TaskContextService.Task t, UUID token, TaskContextService.Request r) {
      if (r.storeId() != null && r.storeId().startsWith("chain-")) {
         return this.reconcileChain(t, token, r);
      }

      if (this.profilesSelectedOnly(t)) {
         throw new IdentityException(403, "RECONCILIATION_REQUIRES_CONTEXT_SCOPE");
      }

      OnboardingReconciliationService.Inputs inputs = this.reconciliation.inputs(t.tenant(), r.storeId());

      for (Entry<String, String> pin : inputs.snapshots().entrySet()) {
         Object read = this.datasets
            .read(
               t.id(),
               new TaskContextService.Request(
                  "dataset_read", null, null, 0, UUID.fromString(pin.getKey()), UUID.fromString(pin.getValue()), null, null, null, null, null, 0, 1
               )
            );
         if (this.json.valueToTree(read).path("unavailable").asBoolean()) {
            throw this.missing();
         }
      }

      ArrayList<Object> background = new ArrayList<>();

      for (UUID version : inputs.backgrounds()) {
         List<Map<String, Object>> rows = this.db.queryForList("SELECT entry_id,revision FROM profile_versions WHERE id=?", new Object[]{version});
         if (rows.size() != 1) {
            throw this.missing();
         }

         Map<String, Object> row = rows.getFirst();
         ProfileService.Value value = this.profiles.get(t.actor(), t.tenant(), (UUID)row.get("entry_id"), null);
         if (!version.equals(value.versionId())) {
            throw new IdentityException(409, "TASK_CONTEXT_CHANGED");
         }

         background.add(this.profileValue(t, value, 1200));
      }

      AgentTaskService.SearchResult receiptsKnowledge = this.agents.searchResult(t.id(), token, "收款");
      AgentTaskService.SearchResult refundsKnowledge = this.agents.searchResult(t.id(), token, "退款");
      AgentTaskService.SearchResult voucherKnowledge = this.agents.searchResult(t.id(), token, "凭证");
      LinkedHashMap<UUID, AgentTaskService.Input> items = new LinkedHashMap<>();
      receiptsKnowledge.items().forEach(item -> items.put(item.id(), item));
      refundsKnowledge.items().forEach(item -> items.put(item.id(), item));
      voucherKnowledge.items().forEach(item -> items.put(item.id(), item));
      AgentTaskService.SearchResult knowledge = new AgentTaskService.SearchResult(
         List.copyOf(items.values()),
         items.isEmpty() ? "NO_MATCH" : "MATCHED",
         receiptsKnowledge.coverage(),
         receiptsKnowledge.hasMore() || refundsKnowledge.hasMore() || voucherKnowledge.hasMore()
      );
      Object calculation = this.reconciliation
         .execute(t.actor(), t.tenant(), new OnboardingReconciliationService.Request(r.storeId(), r.dateFrom(), r.dateTo()));
      String key = IdentityService.hash(t.id() + ":" + t.attempt() + ":" + this.json.writeValueAsString(calculation));
      Map<String, Object> result = this.map(
         "receiptId",
         key,
         "taskId",
         t.id(),
         "attempt",
         t.attempt(),
         "execution",
         "FIXED_SERVER_RULE",
         "generationContract",
         BriefingGenerationContract.value(),
         "calculation",
         calculation,
         "background",
         background,
         "knowledge",
         knowledge,
         "knowledgeRead",
         !knowledge.items().isEmpty()
      );
      this.db
         .update(
            "INSERT INTO task_reconciliation_receipts(task_id,attempt_number,receipt_id,body) VALUES (?,?,?,?::jsonb) ON CONFLICT (task_id,attempt_number,receipt_id) DO NOTHING",
            new Object[]{t.id(), t.attempt(), key, this.json.writeValueAsString(result)}
         );
      return result;
   }

   private Object plan(TaskContextService.Task t, UUID token, TaskContextService.Request r) {
      BriefingBusinessPlan.Plan plan = BriefingBusinessPlan.resolve(r.plan());
      if (!Boolean.TRUE
         .equals(this.db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_topic_selections WHERE task_id=?)", Boolean.class, new Object[]{t.id()}))) {
         throw new IdentityException(422, "BRIEFING_TOPIC_REQUIRED");
      }

      JsonNode selection = this.json
         .readTree(
            (String)this.db
               .queryForObject("SELECT (candidates->selected_index)::text FROM briefing_topic_selections WHERE task_id=?", String.class, new Object[]{t.id()})
         );
      if ("BRIEFING".equals(selection.path("destination").asText())
         && "DATA".equals(selection.path("businessType").asText())
         && selection.path("requiresCalculation").asBoolean()
         && plan.question().equals(selection.path("question").asText())) {
         List<byte[]> prior = this.db
            .queryForList(
               "SELECT content FROM conversation_artifacts WHERE task_id=? AND attempt_number=? AND filename='business-plan.json'",
               byte[].class,
               new Object[]{t.id(), t.attempt()}
            );
         byte[] bytes = this.json.writeValueAsBytes(plan);
         if (!prior.isEmpty() && !Arrays.equals(prior.getFirst(), bytes)) {
            throw new IdentityException(409, "BRIEFING_PLAN_CHANGED");
         }

         if (!prior.isEmpty()) {
            List<String> receipts = this.db
               .queryForList(
                  "SELECT body::text FROM task_reconciliation_receipts WHERE task_id=? AND attempt_number=? AND body->'calculation'->>'metric'='salesAndReceipts'",
                  String.class,
                  new Object[]{t.id(), t.attempt()}
               );
            if (receipts.size() == 1) {
               return this.map("plan", plan, "evidence", this.json.readTree(receipts.getFirst()));
            }
         }

         if (prior.isEmpty()) {
            this.db
               .update(
                  "INSERT INTO conversation_artifacts(id,tenant_id,workspace_id,task_id,filename,sha256,content,attempt_number) VALUES(?,?,?,?,?,?,?,?)",
                  new Object[]{
                     UUID.randomUUID(),
                     t.tenant(),
                     t.space(),
                     t.id(),
                     "business-plan.json",
                     IdentityService.hash(new String(bytes, StandardCharsets.UTF_8)),
                     bytes,
                     t.attempt()
                  }
               );
         }

         Object value = this.reconcileChain(
            t,
            token,
            new TaskContextService.Request(
               "reconciliation_execute",
               null,
               null,
               null,
               null,
               null,
               null,
               null,
               null,
               null,
               null,
               null,
               null,
               "chain-sales-receipts:" + String.join(",", plan.storeIds()),
               plan.dateFrom(),
               plan.dateTo()
            )
         );
         return this.map("plan", plan, "evidence", value);
      } else {
         throw new IdentityException(422, "BRIEFING_PLAN_TOPIC_MISMATCH");
      }
   }

   private Object reconcileChain(TaskContextService.Task t, UUID token, TaskContextService.Request r) {
      if (!"AUTHORIZED_LIBRARY".equals(this.db.queryForObject("SELECT source_scope FROM conversation_tasks WHERE id=?", String.class, new Object[]{t.id()}))) {
         throw new IdentityException(403, "CHAIN_SCOPE_REQUIRED");
      }

      String[] parts = r.storeId().split(":", 2);
      if (parts.length == 2 && Set.of("chain-orders", "chain-receipts", "chain-sales-receipts").contains(parts[0])) {
         List<String> ids = List.of(parts[1].split(","));
         if (ids.size() >= 2 && ids.size() <= 10 && new HashSet<>(ids).size() == ids.size()) {
            JsonNode catalog = this.json.valueToTree(this.reconciliation.catalog(t.actor(), t.tenant()));
            HashMap<String, String> names = new HashMap<>();

            for (JsonNode store : catalog.path("stores")) {
               names.put(store.path("id").asText(), store.path("name").asText());
            }

            if (!names.keySet().containsAll(ids)) {
               throw new IdentityException(403, "CHAIN_SOURCE_NOT_GRANTED");
            }

            boolean paired = parts[0].equals("chain-sales-receipts");
            String metric = parts[0].equals("chain-orders") ? "orderSalesByConfirmationDate" : "businessConfirmed";
            ArrayList<Object> proofs = new ArrayList<>();
            ArrayList<BriefingContentService.Row> rows = new ArrayList<>();
            BigDecimal total = BigDecimal.ZERO;
            BigDecimal orderTotal = BigDecimal.ZERO;
            Object background = null;
            boolean knowledge = true;

            for (String id : ids) {
               JsonNode evidence = this.json
                  .valueToTree(
                     this.reconcile(
                        t,
                        token,
                        new TaskContextService.Request(
                           "reconciliation_execute", null, null, null, null, null, null, null, null, null, null, null, null, id, r.dateFrom(), r.dateTo()
                        )
                     )
                  );
               JsonNode amount = evidence.path("calculation").path("result").path("amounts").path(metric);
               if (amount.path("unknown").asInt() != 0) {
                  throw new IdentityException(422, "CHAIN_AMOUNT_INCOMPLETE");
               }

               BigDecimal value = new BigDecimal(amount.path("cents").asText()).movePointLeft(2);
               total = total.add(value);
               JsonNode orderAmount = evidence.path("calculation").path("result").path("amounts").path("orderSalesByConfirmationDate");
               if (paired && orderAmount.path("unknown").asInt() != 0) {
                  throw new IdentityException(422, "CHAIN_AMOUNT_INCOMPLETE");
               }

               BigDecimal orderValue = new BigDecimal(orderAmount.path("cents").asText()).movePointLeft(2);
               orderTotal = orderTotal.add(orderValue);
               rows.add(
                  new BriefingContentService.Row(names.get(id), paired ? orderValue.toPlainString() : null, value.toPlainString(), null, null, null, null, null)
               );
               proofs.add(
                  this.map(
                     "storeId",
                     id,
                     "name",
                     names.get(id),
                     "receiptId",
                     evidence.path("receiptId").asText(),
                     "inputs",
                     evidence.path("calculation").path("inputs"),
                     "amount",
                     amount,
                     "orderAmount",
                     orderAmount
                  )
               );
               background = evidence.path("background");
               knowledge &= evidence.path("knowledgeRead").asBoolean();
            }

            Map<String, Object> body = this.map(
               "recipeVersion",
               "reconciliation-chain-v1",
               "metric",
               paired ? "salesAndReceipts" : metric,
               "orderTotal",
               orderTotal.toPlainString(),
               "from",
               r.dateFrom(),
               "to",
               r.dateTo(),
               "rows",
               rows,
               "total",
               total.toPlainString(),
               "proofs",
               proofs
            );
            byte[] bytes = this.json.writeValueAsBytes(body);
            String sha = IdentityService.hash(new String(bytes, StandardCharsets.UTF_8));
            UUID artifact = UUID.randomUUID();
            this.db
               .update(
                  "INSERT INTO conversation_artifacts(id,tenant_id,workspace_id,task_id,filename,sha256,content,attempt_number) VALUES (?,?,?,?,?,?,?,?)",
                  new Object[]{artifact, t.tenant(), t.space(), t.id(), "chain-calculation.json", sha, bytes, t.attempt()}
               );
            Map<String, Object> result = this.map(
               "receiptId",
               sha,
               "taskId",
               t.id(),
               "attempt",
               t.attempt(),
               "calculationArtifactId",
               artifact,
               "calculation",
               body,
               "background",
               background,
               "knowledgeRead",
               knowledge
            );
            this.db
               .update(
                  "INSERT INTO task_reconciliation_receipts(task_id,attempt_number,receipt_id,body) VALUES (?,?,?,?::jsonb)",
                  new Object[]{t.id(), t.attempt(), sha, this.json.writeValueAsString(result)}
               );
            return result;
         } else {
            throw IdentityException.invalid();
         }
      } else {
         throw IdentityException.invalid();
      }
   }

   private void record(TaskContextService.Task t, String kind, UUID ref, String version, Object content) {
      List<String> old = this.db
         .queryForList(
            "SELECT version_key FROM task_context_reads WHERE task_id=? AND attempt_number=? AND kind=? AND reference_id=?",
            String.class,
            new Object[]{t.id(), t.attempt(), kind, ref}
         );
      if (!old.isEmpty()) {
         if (!old.getFirst().equals(version)) {
            throw new IdentityException(409, "TASK_CONTEXT_CHANGED");
         }
      } else {
         if ((Integer)this.db
               .queryForObject(
                  "SELECT (SELECT count(*) FROM task_context_reads WHERE task_id=? AND attempt_number=?)+(SELECT count(*) FROM task_general_experience_reads WHERE task_id=? AND attempt_number=?)",
                  Integer.class,
                  new Object[]{t.id(), t.attempt(), t.id(), t.attempt()}
               )
            >= 32) {
            throw new IdentityException(413, "TASK_CONTEXT_LIMIT");
         }

         this.db
            .update(
               "INSERT INTO task_context_reads(task_id,attempt_number,kind,reference_id,version_key,content_hash) VALUES (?,?,?,?,?,?)",
               new Object[]{t.id(), t.attempt(), kind, ref, version, IdentityService.hash(this.json.writeValueAsString(content))}
            );
      }
   }

   private void dependencies(TaskContextService.Task target, Collection<UUID> versions) {
      for (UUID version : new LinkedHashSet<>(versions)) {
         List<UUID> rows = this.db
            .queryForList("SELECT workspace_id FROM material_versions WHERE tenant_id=? AND id=?", UUID.class, new Object[]{target.tenant(), version});
         if (rows.isEmpty()) {
            throw this.missing();
         }

         this.materials.requireVersion(target.actor(), target.tenant(), version, false);
         this.db
            .update(
               "INSERT INTO task_context_materials(task_id,attempt_number,version_id) VALUES (?,?,?) ON CONFLICT DO NOTHING",
               new Object[]{target.id(), target.attempt(), version}
            );
      }

      if ((Integer)this.db
            .queryForObject(
               "SELECT count(*) FROM task_context_materials WHERE task_id=? AND attempt_number=?", Integer.class, new Object[]{target.id(), target.attempt()}
            )
         > 256) {
         throw new IdentityException(413, "TASK_CONTEXT_LIMIT");
      }
   }

   private List<UUID> sourceVersions(UUID task) {
      LinkedHashSet<UUID> found = new LinkedHashSet<>(
         this.db
            .queryForList(
               "SELECT version_id FROM conversation_originals WHERE task_id=?\nUNION SELECT c.version_id FROM conversation_sources s JOIN knowledge_chunks c ON c.id=s.chunk_id WHERE s.task_id=?\nUNION SELECT c.version_id FROM conversation_agent_grants g JOIN knowledge_chunks c ON c.id=g.chunk_id WHERE g.task_id=?\nUNION SELECT version_id FROM task_context_materials WHERE task_id=?\n",
               UUID.class,
               new Object[]{task, task, task, task}
            )
      );
      if (Boolean.TRUE.equals(this.db.queryForObject("SELECT to_regclass('feedback_task_sources') IS NOT NULL", Boolean.class))) {
         found.addAll(this.db.queryForList("SELECT version_id FROM feedback_task_sources WHERE task_id=?", UUID.class, new Object[]{task}));
      }

      return List.copyOf(found);
   }

   private void readableTask(TaskContextService.Task t, UUID source) {
      if (!Boolean.TRUE
         .equals(
            this.db
               .queryForObject(
                  "SELECT EXISTS(SELECT 1 FROM conversation_tasks s JOIN conversations c ON c.id=s.conversation_id JOIN readable_source_tasks v ON v.id=s.id WHERE s.id=? AND s.tenant_id=? AND c.owner_id=?)",
                  Boolean.class,
                  new Object[]{source, t.tenant(), t.actor()}
               )
         )) {
         throw this.missing();
      }

      UUID space = (UUID)this.db.queryForObject("SELECT workspace_id FROM conversation_tasks WHERE id=?", UUID.class, new Object[]{source});
      this.materials.require(t.actor(), t.tenant(), space, false);
   }

   private boolean selectedOnly(TaskContextService.Task t) {
      return "SELECTED".equals(this.db.queryForObject("SELECT source_scope FROM conversation_tasks WHERE id=?", String.class, new Object[]{t.id()}));
   }

   private Object bootstrap(TaskContextService.Task t) {
      List<Map<String, Object>> previous = this.db
         .queryForList(
            "SELECT * FROM conversation_attempts WHERE task_id=? AND attempt_number<? ORDER BY attempt_number DESC LIMIT 1", new Object[]{t.id(), t.attempt()}
         );
      return this.map(
         "taskId",
         t.id(),
         "attempt",
         t.attempt(),
         "organization",
         this.map(
            "name",
            this.db.queryForObject("SELECT name FROM tenants WHERE id=?", String.class, new Object[]{t.tenant()}),
            "source",
            "CURRENT_TENANT",
            "authority",
            false
         ),
         "historyScope",
         "CURRENT_PRIVATE_CONVERSATION",
         "profileScopes",
         List.of("TENANT", "WORKSPACE", "PERSONAL"),
         "experienceScope",
         "CURRENT_WORKSPACE_PUBLISHED",
         "generalExperienceScope",
         "GENERAL_CLEANED",
         "previousAttempt",
         previous.isEmpty() ? null : this.historyItem(previous.getFirst(), false),
         "latestBriefing",
         this.selectedOnly(t) && !this.hasDiscussion(t) ? null : this.latestBriefing(t),
         "sourceScope",
         this.db.queryForObject("SELECT source_scope FROM conversation_tasks WHERE id=?", String.class, new Object[]{t.id()}),
         "selectedMaterials",
         this.db
            .queryForList(
               "SELECT v.filename,v.number AS version,v.id AS version_id FROM conversation_originals o JOIN material_versions v ON v.id=o.version_id WHERE o.task_id=? ORDER BY v.id",
               new Object[]{t.id()}
            ),
         "selectedDatasets",
         this.db
            .queryForList(
               "SELECT d.id AS dataset_id,s.id AS snapshot_id,d.name,s.version FROM briefing_dataset_selections chosen JOIN business_datasets d ON d.id=chosen.dataset_id JOIN dataset_snapshots s ON s.id=chosen.snapshot_id WHERE chosen.task_id=? AND NOT chosen.invalidated ORDER BY d.id",
               new Object[]{t.id()}
            ),
         "enterpriseBackground",
         this.enterpriseBackground(t),
         "backgroundIsAuthorization",
         false
      );
   }

   private Object enterpriseBackground(TaskContextService.Task t) {
      if (this.profilesSelectedOnly(t)) {
         return this.map("items", List.of(), "reason", "SELECTED_ONLY");
      }

      List<UUID> ids = this.db
         .queryForList(
            "SELECT e.id FROM profile_entries e JOIN profile_versions v ON v.entry_id=e.id AND v.revision=e.revision WHERE e.tenant_id=? AND e.scope='TENANT' AND e.entry_key LIKE 'company.%' AND NOT v.scrubbed AND object_is_active('PROFILE_VERSION',v.id) AND company_profile_readable(v.id) AND v.status='ACTIVE' AND (v.expires_at IS NULL OR v.expires_at>clock_timestamp()) ORDER BY CASE WHEN e.kind='GOAL' THEN 0 WHEN e.kind='FACT' THEN 1 ELSE 2 END,e.entry_key LIMIT 7",
            UUID.class,
            new Object[]{t.tenant()}
         );
      return this.map(
         "items",
         ids.stream().limit(6L).map(id -> this.profileValue(t, this.profiles.get(t.actor(), t.tenant(), id, null), 800)).toList(),
         "hasMore",
         ids.size() > 6,
         "purpose",
         "REFERENCE_FOR_JOB_RELEVANCE"
      );
   }

   private boolean hasDiscussion(TaskContextService.Task t) {
      return Boolean.TRUE
         .equals(
            this.db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_discussions WHERE conversation_id=?)", Boolean.class, new Object[]{t.conversation()})
         );
   }

   private Object latestBriefing(TaskContextService.Task current) {
      List<Map<String, Object>> found = this.db
         .queryForList(
            "SELECT t.id,t.attempt FROM conversation_tasks t JOIN readable_source_tasks readable ON readable.id=t.id WHERE t.conversation_id=? AND t.tenant_id=? AND t.status='SUCCEEDED' AND t.created_at<(SELECT created_at FROM conversation_tasks WHERE id=?) AND EXISTS (SELECT a.id,a.sha256,a.content FROM conversation_artifacts a\nWHERE a.task_id=t.id AND a.attempt_number=t.attempt AND object_is_active('ARTIFACT',a.id)\nAND EXISTS(SELECT 1 FROM identity_audit proof WHERE proof.target_id=a.id AND proof.tenant_id=a.tenant_id AND proof.action='TASK_BRIEFING_CREATED' AND proof.outcome='SUCCESS')\nAND EXISTS(SELECT 1 FROM conversation_tool_receipts tool WHERE tool.task_id=a.task_id AND tool.attempt_number=a.attempt_number AND tool.name='deliver_briefing' AND tool.status='succeeded')\nORDER BY a.id LIMIT 1\n) ORDER BY t.created_at DESC LIMIT 1",
            new Object[]{current.conversation(), current.tenant(), current.id()}
         );
      if (this.hasDiscussion(current)) {
         found = this.db
            .queryForList(
               "SELECT s.id,s.attempt FROM briefing_discussions d JOIN conversation_tasks s ON s.id=d.source_task_id JOIN readable_source_tasks r ON r.id=s.id WHERE d.conversation_id=? AND s.revision=d.source_revision AND s.attempt=d.source_attempt AND s.status='SUCCEEDED'",
               new Object[]{current.conversation()}
            );
      }

      if (found.isEmpty()) {
         return null;
      }

      Map<String, Object> row = found.getFirst();
      UUID source = (UUID)row.get("id");
      this.readableTask(current, source);
      this.dependencies(current, this.sourceVersions(source));
      BriefingContentService.Document doc = this.briefings.find(source, ((Number)row.get("attempt")).intValue());
      if (doc == null) {
         return null;
      }

      BriefingContentService.Content c = doc.content();
      BriefingContentService.Chart chart = c.chart();
      Map<String, Object> reference = this.map(
         "artifactId",
         doc.artifactId(),
         "title",
         c.title(),
         "summary",
         c.summary(),
         "analysis",
         c.analysis(),
         "source",
         c.source(),
         "datasetSource",
         c.datasetSource(),
         "datasetBasis",
         c.datasetBasis(),
         "generatedAt",
         c.generatedAt(),
         "chart",
         chart == null
            ? null
            : this.map(
               "metric",
               chart.metric(),
               "unit",
               chart.unit(),
               "baseline",
               chart.baseline(),
               "current",
               chart.current(),
               "rows",
               chart.rows().stream().limit(10L).toList(),
               "totalGroups",
               chart.rows().size(),
               "rowsTruncated",
               chart.rows().size() > 10,
               "totals",
               chart.totals()
            )
      );
      this.record(current, "HISTORY", source, row.get("attempt").toString(), reference);
      return reference;
   }

   private boolean profilesSelectedOnly(TaskContextService.Task t) {
      return this.selectedOnly(t)
         && !Boolean.TRUE
            .equals(
               this.db
                  .queryForObject(
                     "SELECT EXISTS(SELECT 1 FROM briefing_generation_batches WHERE task_id=? AND owner_id=? AND tenant_id=? AND workspace_id=?)",
                     Boolean.class,
                     new Object[]{t.id(), t.actor(), t.tenant(), t.space()}
                  )
            );
   }

   private boolean usable(ProfileService.Value v) {
      return (v.status() == ProfileService.Status.ACTIVE || v.kind() == ProfileService.Kind.INFERENCE && v.status() == ProfileService.Status.PROPOSED)
         && (v.expiresAt() == null || v.expiresAt().isAfter(Instant.now()));
   }

   private void profileScope(TaskContextService.Task t, ProfileService.Value v) {
      if ((v.scope() != ProfileService.Scope.WORKSPACE || v.subjectId().equals(t.space()))
         && (v.scope() != ProfileService.Scope.PERSONAL || v.subjectId().equals(t.actor()))) {
         if (!this.usable(v)) {
            throw this.missing();
         }
      } else {
         throw this.missing();
      }
   }

   private Object profileValue(TaskContextService.Task t, ProfileService.Value v, int limit) {
      this.profileScope(t, v);
      this.dependencies(
         t,
         this.db
            .queryForList(
               "SELECT DISTINCT c.version_id FROM company_profile_inferences p JOIN company_inference_inputs i ON i.run_id=p.run_id JOIN knowledge_chunks c ON c.id=i.chunk_id WHERE p.version_id=?",
               UUID.class,
               new Object[]{v.versionId()}
            )
      );
      this.record(t, "PROFILE", v.id(), Integer.toString(v.revision()), v);
      return this.map(
         "backgroundKnowledge",
         v.key().startsWith("company.")
            ? this.map("id", "background:" + v.id(), "sourceVersionId", v.versionId(), "revision", v.revision(), "mode", "STRUCTURED_REFERENCE")
            : null,
         "id",
         v.id(),
         "revision",
         v.revision(),
         "scope",
         v.scope(),
         "subjectId",
         v.subjectId(),
         "kind",
         v.kind(),
         "key",
         v.key(),
         "value",
         this.clip(v.value(), limit),
         "truncated",
         v.value().length() > limit,
         "provenance",
         v.provenance(),
         "effectiveStatus",
         v.effectiveStatus(),
         "expiresAt",
         v.expiresAt(),
         "authority",
         false
      );
   }

   private Object profileList(TaskContextService.Task t, TaskContextService.Request r) {
      ProfileService.Scope scope;
      try {
         scope = ProfileService.Scope.valueOf(r.scope());
      } catch (Exception e) {
         throw IdentityException.invalid();
      }

      String q = this.text(r.query(), 200, false);
      List<UUID> ids = this.db
         .queryForList(
            "SELECT e.id FROM profile_entries e JOIN profile_versions v ON v.entry_id=e.id AND v.revision=e.revision\nWHERE NOT v.scrubbed AND object_is_active('PROFILE_VERSION',v.id) AND company_profile_readable(v.id) AND e.tenant_id=? AND e.scope=? AND e.workspace_id IS NOT DISTINCT FROM ?::uuid AND e.account_id IS NOT DISTINCT FROM ?::uuid\nAND (v.status='ACTIVE' OR e.kind='INFERENCE' AND v.status='PROPOSED') AND (v.expires_at IS NULL OR v.expires_at>clock_timestamp())\nAND (?='' OR position(lower(?) in lower(e.entry_key||' '||v.value))>0) ORDER BY e.entry_key,e.id LIMIT 6 OFFSET ?\n",
            UUID.class,
            new Object[]{
               t.tenant(),
               scope.name(),
               scope == ProfileService.Scope.WORKSPACE ? t.space() : null,
               scope == ProfileService.Scope.PERSONAL ? t.actor() : null,
               q,
               q,
               this.offset(r)
            }
         );
      return this.map(
         "items",
         ids.stream().limit(5L).map(id -> this.profileValue(t, this.profiles.get(t.actor(), t.tenant(), id, null), 1200)).toList(),
         "hasMore",
         ids.size() > 5
      );
   }

   private Object profile(TaskContextService.Task t, TaskContextService.Request r) {
      if (r.referenceId() != null && r.revision() != null && r.revision() >= 1) {
         ProfileService.Value current = this.profiles.get(t.actor(), t.tenant(), r.referenceId(), null);
         if (current.revision() != r.revision()) {
            throw new IdentityException(409, "TASK_CONTEXT_CHANGED");
         } else {
            return this.profileValue(t, current, 4000);
         }
      } else {
         throw IdentityException.invalid();
      }
   }

   private Map<String, Object> historyItem(Map<String, Object> row, boolean includePrompt) {
      Map snapshot = (Map)this.json.readValue(row.get("snapshot").toString(), Map.class);
      String reply = Objects.toString(snapshot.get("reply"), "");
      String prompt = Objects.toString(row.get("input"), "");
      return this.map(
         "taskId",
         row.get("task_id"),
         "attempt",
         row.get("attempt_number"),
         "status",
         row.get("status"),
         "prompt",
         includePrompt ? this.clip(prompt, 1200) : null,
         "reply",
         this.clip(reply, 3500),
         "truncated",
         reply.length() > 3500 || includePrompt && prompt.length() > 1200,
         "waitReason",
         snapshot.get("wait_reason"),
         "requiredInput",
         snapshot.get("required_input"),
         "errorCode",
         snapshot.get("error_code"),
         "reconciliationRequired",
         snapshot.get("reconciliation_required"),
         "tools",
         snapshot.getOrDefault("tool_receipts", List.of()),
         "provenance",
         row.get("provenance"),
         "businessOutcome",
         "UNKNOWN"
      );
   }

   private Object history(TaskContextService.Task t, TaskContextService.Request r) {
      String q = this.text(r.query(), 200, false);
      List<Map<String, Object>> rows = this.db
         .queryForList(
            "SELECT h.* FROM conversation_tasks s JOIN LATERAL\n (SELECT * FROM conversation_attempts h WHERE h.task_id=s.id AND h.finished_at IS NOT NULL ORDER BY attempt_number DESC LIMIT 1) h ON true\nJOIN readable_source_tasks v ON v.id=s.id JOIN conversation_tasks current ON current.id=?\nWHERE s.conversation_id=? AND s.tenant_id=? AND s.origin='USER' AND s.id<>current.id AND s.created_at<current.created_at\nAND (?='' OR position(lower(?) in lower(h.input||' '||coalesce(h.snapshot->>'reply','')))>0)\nORDER BY s.created_at DESC,s.id DESC LIMIT 3 OFFSET ?\n",
            new Object[]{t.id(), t.conversation(), t.tenant(), q, q, this.offset(r)}
         );
      ArrayList<Object> items = new ArrayList<>();

      for (Map<String, Object> row : rows.stream().limit(2L).toList()) {
         UUID source = (UUID)row.get("task_id");
         this.readableTask(t, source);
         this.dependencies(t, this.sourceVersions(source));
         Map<String, Object> item = this.historyItem(row, true);
         this.record(t, "HISTORY", source, row.get("attempt_number").toString(), item);
         items.add(item);
      }

      return this.map("items", items, "hasMore", rows.size() > 2, "scope", "CURRENT_PRIVATE_CONVERSATION", "completeHistory", false);
   }

   private Object search(TaskContextService.Task t, TaskContextService.Request r) {
      ExperienceService.Page found = this.experiences.engineList(t.actor(), t.tenant(), t.space(), this.text(r.query(), 200, true), this.offset(r), 3);
      ArrayList<Object> items = new ArrayList<>();

      for (ExperienceService.Summary s : found.items()) {
         if (Boolean.TRUE
            .equals(this.db.queryForObject("SELECT experience_general_dependencies_current(?,?)", Boolean.class, new Object[]{t.tenant(), s.versionId()}))) {
            ExperienceService.Entry exact = this.experienceEntry(t, s.id(), s.versionId());
            this.trackExperience(t, exact);
            this.record(t, "EXPERIENCE", exact.id(), exact.version().id().toString(), exact.version());
            items.add(s);
         }
      }

      return this.map("items", items, "hasMore", found.hasMore(), "scope", "CURRENT_WORKSPACE_PUBLISHED", "applicationOutcome", "UNKNOWN");
   }

   private ExperienceService.Entry experienceEntry(TaskContextService.Task t, UUID id, UUID version) {
      if (id != null && version != null) {
         ExperienceService.Entry e = this.experiences.get(t.actor(), t.tenant(), t.space(), id, version);
         if (!Boolean.TRUE
            .equals(this.db.queryForObject("SELECT experience_general_dependencies_current(?,?)", Boolean.class, new Object[]{t.tenant(), version}))) {
            throw new IdentityException(409, "EXPERIENCE_NOT_CURRENT");
         }

         if (!e.version().origin().equals("AUTOMATIC") || !e.version().evaluation().equals("AUTOMATIC_CHECKED")) {
            throw new IdentityException(409, "EXPERIENCE_NOT_CHECKED");
         }

         if (e.status().equals("PUBLISHED") && version.equals(e.publishedVersion())) {
            if (e.version().content().accessMode().equals("SOURCE_BOUND")) {
               for (ExperienceService.Evidence ref : e.version().evidence()) {
                  if (ref.kind().equals("TASK")) {
                     this.readableTask(t, ref.referenceId());
                  }
               }
            }

            return e;
         } else {
            throw new IdentityException(409, "EXPERIENCE_NOT_CURRENT");
         }
      } else {
         throw IdentityException.invalid();
      }
   }

   private void trackExperience(TaskContextService.Task t, ExperienceService.Entry e) {
      if (e.version().content().accessMode().equals("SOURCE_BOUND")
         || Boolean.TRUE
            .equals(this.db.queryForObject("SELECT library_experience_permissions_enabled(?,?)", Boolean.class, new Object[]{t.tenant(), e.version().id()}))) {
         for (ExperienceService.Evidence ref : e.version().evidence()) {
            if (ref.kind().equals("TASK")) {
               this.datasets.inherit(t.id(), ref.referenceId());
            }
         }

         LinkedHashSet<UUID> deps = new LinkedHashSet<>();

         for (ExperienceService.Evidence ref : e.version().evidence()) {
            if (ref.kind().equals("MATERIAL_VERSION")) {
               deps.add(ref.referenceId());
            } else {
               deps.addAll(this.sourceVersions(ref.referenceId()));
            }
         }

         this.dependencies(t, deps);
      }
   }

   private Object experience(TaskContextService.Task t, TaskContextService.Request r, boolean record) {
      ExperienceService.Entry e = this.experienceEntry(t, r.referenceId(), r.versionId());
      this.trackExperience(t, e);
      if (record) {
         this.record(t, "EXPERIENCE", e.id(), e.version().id().toString(), e.version());
      }

      ExperienceService.Content c = e.version().content();
      int split = this.methodSplit(c.body());
      int offset = r.offset() == null ? 0 : r.offset();
      if ((offset == 0 || offset == split) && offset < c.body().length()) {
         this.db
            .update(
               "UPDATE task_context_reads SET read_parts=read_parts|? WHERE task_id=? AND attempt_number=? AND kind='EXPERIENCE' AND reference_id=?",
               new Object[]{offset == 0 ? 1 : 2, t.id(), t.attempt(), e.id()}
            );
         return this.map(
            "entryId",
            e.id(),
            "versionId",
            e.version().id(),
            "number",
            e.version().number(),
            "kind",
            c.kind(),
            "title",
            c.title(),
            "summary",
            c.summary(),
            "body",
            c.body().substring(offset, Math.min(c.body().length(), offset == 0 ? split : c.body().length())),
            "offset",
            offset,
            "nextOffset",
            offset == 0 && split < c.body().length() ? split : null,
            "truncated",
            offset > 0 || c.body().length() > 8000,
            "applicable",
            c.applicable(),
            "excluded",
            c.excluded(),
            "dependencies",
            c.dependencies(),
            "basis",
            c.basis(),
            "origin",
            e.version().origin(),
            "evaluation",
            e.version().evaluation(),
            "authority",
            false,
            "requiresApplicabilityCheck",
            true
         );
      } else {
         throw IdentityException.invalid();
      }
   }

   private Object review(TaskContextService.Task t, TaskContextService.Request r) {
      if (r.requestId() != null && r.decision() != null && Set.of("DIRECT", "ADAPTED", "UNKNOWN", "NOT_APPLICABLE").contains(r.decision())) {
         String conditions = this.text(r.conditions(), 1000, true);
         String adjustments = this.text(r.adjustments(), 1000, false);
         ExperienceService.Entry e = this.experienceEntry(t, r.referenceId(), r.versionId());
         this.trackExperience(t, e);
         if (!Boolean.TRUE
            .equals(
               this.db
                  .queryForObject(
                     "SELECT EXISTS(SELECT 1 FROM task_context_reads WHERE task_id=? AND attempt_number=? AND kind='EXPERIENCE' AND reference_id=? AND version_key=?)",
                     Boolean.class,
                     new Object[]{t.id(), t.attempt(), e.id(), e.version().id().toString()}
                  )
            )) {
            throw new IdentityException(409, "EXPERIENCE_READ_REQUIRED");
         }

         int parts = (Integer)this.db
            .queryForObject(
               "SELECT read_parts FROM task_context_reads WHERE task_id=? AND attempt_number=? AND kind='EXPERIENCE' AND reference_id=?",
               Integer.class,
               new Object[]{t.id(), t.attempt(), e.id()}
            );
         if ((!Set.of("DIRECT", "ADAPTED").contains(r.decision()) || (parts & 1) != 0)
            && (
               !Set.of("DIRECT", "ADAPTED").contains(r.decision())
                  || e.version().content().body().length() <= this.methodSplit(e.version().content().body())
                  || parts == 3
            )) {
            String hash = IdentityService.hash(this.json.writeValueAsString(List.of(e.id(), r.versionId(), r.decision(), conditions, adjustments)));
            List<Map<String, Object>> prior = this.db
               .queryForList(
                  "SELECT * FROM task_context_reviews WHERE task_id=? AND attempt_number=? AND request_id=?", new Object[]{t.id(), t.attempt(), r.requestId()}
               );
            if (!prior.isEmpty()) {
               if (!hash.equals(prior.getFirst().get("request_hash"))) {
                  throw new IdentityException(409, "IDEMPOTENCY_CONFLICT");
               } else {
                  return this.reviewResult(prior.getFirst());
               }
            } else {
               if ((Integer)this.db
                     .queryForObject(
                        "SELECT (SELECT count(*) FROM task_context_reviews WHERE task_id=? AND attempt_number=?)+(SELECT count(*) FROM task_general_experience_reviews WHERE task_id=? AND attempt_number=?)",
                        Integer.class,
                        new Object[]{t.id(), t.attempt(), t.id(), t.attempt()}
                     )
                  >= 8) {
                  throw new IdentityException(413, "TASK_CONTEXT_LIMIT");
               }

               UUID use = null;
               if (Set.of("DIRECT", "ADAPTED").contains(r.decision())) {
                  List<Map<String, Object>> existing = this.db
                     .queryForList(
                        "SELECT id,adopted FROM experience_uses WHERE actor_id=? AND task_id=? AND version_id=?",
                        new Object[]{t.actor(), t.id(), r.versionId()}
                     );
                  if (existing.isEmpty()) {
                     use = this.experiences
                        .recordUse(
                           t.actor(),
                           t.tenant(),
                           t.space(),
                           e.id(),
                           r.requestId(),
                           new ExperienceService.UseInput(r.versionId(), t.id(), "task:" + t.id(), r.decision(), true, conditions, adjustments)
                        )
                        .id();
                  } else if (Boolean.TRUE.equals(existing.getFirst().get("adopted"))) {
                     use = (UUID)existing.getFirst().get("id");
                  }
               }

               UUID id = UUID.randomUUID();
               this.db
                  .update(
                     "INSERT INTO task_context_reviews(id,task_id,attempt_number,version_id,request_id,request_hash,decision,conditions,adjustments,use_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
                     new Object[]{id, t.id(), t.attempt(), r.versionId(), r.requestId(), hash, r.decision(), conditions, adjustments, use}
                  );
               return this.reviewResult((Map<String, Object>)this.db.queryForList("SELECT * FROM task_context_reviews WHERE id=?", new Object[]{id}).getFirst());
            }
         } else {
            throw new IdentityException(409, "EXPERIENCE_METHOD_INCOMPLETE");
         }
      } else {
         throw IdentityException.invalid();
      }
   }

   private Object reviewResult(Map<String, Object> r) {
      return this.map(
         "id",
         r.get("id"),
         "versionId",
         r.get("version_id"),
         "attempt",
         r.get("attempt_number"),
         "decision",
         r.get("decision"),
         "conditions",
         r.get("conditions"),
         "adjustments",
         r.get("adjustments"),
         "useId",
         r.get("use_id"),
         "selectionRecorded",
         Set.of("DIRECT", "ADAPTED").contains(r.get("decision")),
         "libraryUseLinked",
         r.get("use_id") != null,
         "assessmentSource",
         "MODEL_REPORTED",
         "applicationOutcome",
         "UNKNOWN",
         "businessActionPerformed",
         false
      );
   }

   public record Request(
      String action,
      String scope,
      String query,
      Integer offset,
      UUID referenceId,
      UUID versionId,
      Integer revision,
      UUID requestId,
      String decision,
      String conditions,
      String adjustments,
      Integer columnOffset,
      Integer columnLimit,
      String storeId,
      String dateFrom,
      String dateTo,
      BriefingBusinessPlan.Request plan
   ) {
      public Request(
         String action,
         String scope,
         String query,
         Integer offset,
         UUID referenceId,
         UUID versionId,
         Integer revision,
         UUID requestId,
         String decision,
         String conditions,
         String adjustments,
         Integer columnOffset,
         Integer columnLimit,
         String storeId,
         String dateFrom,
         String dateTo
      ) {
         this(
            action,
            scope,
            query,
            offset,
            referenceId,
            versionId,
            revision,
            requestId,
            decision,
            conditions,
            adjustments,
            columnOffset,
            columnLimit,
            storeId,
            dateFrom,
            dateTo,
            null
         );
      }

      public Request(
         String action,
         String scope,
         String query,
         Integer offset,
         UUID referenceId,
         UUID versionId,
         Integer revision,
         UUID requestId,
         String decision,
         String conditions,
         String adjustments,
         Integer columnOffset,
         Integer columnLimit
      ) {
         this(
            action,
            scope,
            query,
            offset,
            referenceId,
            versionId,
            revision,
            requestId,
            decision,
            conditions,
            adjustments,
            columnOffset,
            columnLimit,
            null,
            null,
            null
         );
      }

      public Request(
         String action,
         String scope,
         String query,
         Integer offset,
         UUID referenceId,
         UUID versionId,
         Integer revision,
         UUID requestId,
         String decision,
         String conditions,
         String adjustments
      ) {
         this(action, scope, query, offset, referenceId, versionId, revision, requestId, decision, conditions, adjustments, null, null);
      }
   }

   private record Task(UUID id, UUID actor, UUID tenant, UUID space, UUID conversation, int attempt) {
   }
}
