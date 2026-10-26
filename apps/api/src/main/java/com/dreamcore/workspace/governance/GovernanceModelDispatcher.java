package com.dreamcore.workspace.governance;

import com.dreamcore.workspace.identity.IdentityException;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpRequest.BodyPublishers;
import java.net.http.HttpResponse.BodyHandlers;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

@Component
public class GovernanceModelDispatcher {
   private final JdbcTemplate db;
   private final GovernanceModelService jobs;
   private final GovernanceUsageLedger usage;
   private final JsonMapper json = new JsonMapper();
   private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5L)).build();
   @Value("${dreamcore.governance.dispatch-enabled:false}")
   private boolean enabled;
   @Value("${dreamcore.engine.base-url:http://127.0.0.1:18182}")
   private String base;
   @Value("${dreamcore.tasks.engine-token:}")
   private String token;
   private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
      Thread t = new Thread(r, "governance-model-dispatch");
      t.setDaemon(true);
      return t;
   });
   private final AtomicBoolean busy = new AtomicBoolean();

   public GovernanceModelDispatcher(JdbcTemplate db, GovernanceModelService jobs, GovernanceUsageLedger usage) {
      this.db = db;
      this.jobs = jobs;
      this.usage = usage;
   }

   @PreDestroy
   public void close() {
      this.worker.shutdownNow();
   }

   @Scheduled(fixedDelay = 5000L)
   public void tick() {
      if (this.enabled && this.busy.compareAndSet(false, true)) {
         this.worker.submit(() -> {
            try {
               int i = 0;

               while (i < 4 && this.once()) {
                  i++;
               }
            } finally {
               this.busy.set(false);
            }
         });
      }
   }

   public boolean once() {
      if (this.token != null && this.token.length() >= 32) {
         // A process crash may lose the reply of a paid call. Do not replay an expired execution lease.
         this.db.update("WITH uncertain AS (UPDATE governance_model_dispatch SET state='FAILED',error_code='EXECUTION_OUTCOME_UNKNOWN',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE state='RUNNING' AND lease_until<now() RETURNING job_id) UPDATE governance_model_jobs SET state='FAILED',error_code='EXECUTION_OUTCOME_UNKNOWN',revision=revision+1,updated_at=now() WHERE state='WAITING_MODEL' AND id IN (SELECT job_id FROM uncertain)");
         this.usage.expire();
         UUID lease = UUID.randomUUID();
         List<Map<String, Object>> rows = this.db
            .queryForList(
               "UPDATE governance_model_dispatch SET state='RUNNING',lease_token=?,lease_until=now()+interval '90 seconds',attempts=attempts+1,updated_at=now() WHERE job_id=(SELECT job_id FROM governance_model_dispatch WHERE state IN ('PENDING','WAITING_MODEL') AND next_attempt<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_attempt,created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING job_id",
               new Object[]{lease}
            );
         if (rows.isEmpty()) {
            return false;
         }

         UUID id = (UUID)rows.getFirst().get("job_id");

         try {
            Map<String, Object> identity = this.db.queryForMap("SELECT actor_id,tenant_id FROM governance_model_jobs WHERE id=?", new Object[]{id});
            UUID actor = (UUID)identity.get("actor_id");
            UUID tenant = (UUID)identity.get("tenant_id");
            Map<String, Object> job = this.jobs.detail(actor, tenant, id);
            if (!Boolean.TRUE.equals(job.get("sourceCurrent"))) {
               this.finish(id, lease, "STALE", "SOURCE_CHANGED", null);
               return true;
            }

            if ("DRAFT_READY".equals(job.get("state"))) {
               this.finish(id, lease, "SUCCEEDED", null, null);
               return true;
            }

            if (!"WAITING_MODEL".equals(job.get("state"))) {
               this.finish(id, lease, "FAILED", "JOB_NOT_WAITING", null);
               return true;
            }

            Map<String, Object> input = (Map<String, Object>)job.get("request");
            Map<String, Object> envelope = new java.util.LinkedHashMap<>(input);
            envelope.put("attempt", job.get("revision"));
            HttpRequest request = HttpRequest.newBuilder(URI.create(this.base + "/internal/v1/governance-model"))
               .timeout(Duration.ofSeconds(65L))
               .header("Authorization", "Bearer " + this.token)
               .header("Content-Type", "application/json")
               .POST(BodyPublishers.ofString(this.json.writeValueAsString(envelope)))
               .build();
            this.usage.start(id, ((Number)job.get("revision")).intValue(), lease);
            HttpResponse<String> response = this.http.send(request, BodyHandlers.ofString());
            if (response.statusCode() == 202) {
               this.finish(id, lease, "WAITING_MODEL", null, null);
               return true;
            }

            if (response.statusCode() != 200) {
               this.finish(id, lease, "FAILED", "ENGINE_RESPONSE_" + response.statusCode(), null);
               return true;
            }

            if (response.body().length() > 262144) {
               throw new IllegalStateException("MODEL_OUTPUT_LIMIT");
            }

            Map result = (Map)this.json.readValue(response.body(), Map.class);
            if (!id.toString().equals(result.get("jobId"))
               || !Objects.equals(input.get("inputHash"), result.get("inputHash"))
               || !Objects.equals(input.get("executor"), result.get("executor"))
               || !"2.0".equals(result.get("contractVersion"))) {
               throw new IllegalStateException("ENGINE_RESPONSE_MISMATCH");
            }

            if ((Integer)this.db
                  .queryForObject("SELECT count(*) FROM governance_model_dispatch WHERE job_id=? AND lease_token=?", Integer.class, new Object[]{id, lease})
               == 0) {
               return true;
            }

            this.usage.returned(id, ((Number)job.get("revision")).intValue(), result);
            Map<String, Object> saved = this.jobs
               .engineAnswer(
                  actor,
                  tenant,
                  id,
                  new GovernanceModelService.Answer(
                     UUID.randomUUID(),
                     ((Number)job.get("revision")).intValue(),
                     input.get("inputHash").toString(),
                     result.get("executor").toString(),
                     (Map<String, Object>)result.get("output")
                  )
               );
            this.finish(
               id,
               lease,
               "DRAFT_READY".equals(saved.get("state")) ? "SUCCEEDED" : saved.get("state").toString(),
               Objects.toString(saved.get("error_code"), null),
               Objects.toString(result.get("modelName"), null)
            );
         } catch (IdentityException e) {
            this.finish(id, lease, e.status == 409 ? "STALE" : "FAILED", e.code, null);
         } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            this.finish(id, lease, "FAILED", "TRANSPORT_INTERRUPTED", null);
         } catch (IOException e) {
            // The paid call may have completed. Require an explicit retry, never silently call again.
            this.finish(id, lease, "FAILED", "TRANSPORT_UNAVAILABLE", null);
         } catch (Exception e) {
            this.finish(id, lease, "FAILED", "DISPATCH_FAILED", null);
         }

         return true;
      } else {
         return false;
      }
   }

   private void finish(UUID id, UUID lease, String state, String code, String model) {
      int changed = this.db
         .update(
            "UPDATE governance_model_dispatch SET state=?,error_code=?,model_name=COALESCE(?,model_name),lease_token=NULL,lease_until=NULL,next_attempt=now()+interval '15 seconds',updated_at=now() WHERE job_id=? AND lease_token=?",
            new Object[]{state, code, model, id, lease}
         );
      if (changed == 1 && Set.of("FAILED", "STALE").contains(state)) {
         this.usage.unknown(id, lease);
         this.db
            .update(
               "UPDATE governance_model_jobs SET state=?,error_code=?,revision=revision+1,updated_at=now() WHERE id=? AND state='WAITING_MODEL'",
               new Object[]{state, code, id}
            );
      }
   }
}
