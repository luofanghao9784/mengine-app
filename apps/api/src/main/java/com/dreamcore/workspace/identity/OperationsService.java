package com.dreamcore.workspace.identity;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Aggregate operational facts only. Never project task identifiers, content or raw diagnostic text. */
@Service
public class OperationsService {
    public record Tasks(long total, long queued, long running, long succeeded, long failed, long cancelled, long interrupted, long paused, long waitingInput, long waitingCapability, long partial, long resultUnknown, long retryStarts) {}
    public record Storage(long materials, long versions, long originalBytes) {}
    public record ModelUsage(String executionClass, long succeededTasks, long reportedTasks, long modelCalls, Long inputTokens, Long outputTokens) {}
    public record AttemptUsage(String executionClass,long attempts,long meteredAttempts,long running,long succeeded,long failed,long cancelled,long interrupted,long paused, long waitingInput, long waitingCapability, long partial, long resultUnknown,long requests,long pendingRequests,long reportedRequests,Long inputTokens,Long outputTokens) {}
    public record Failure(String code, long tasks, Instant lastOccurredAt) {}
    public record Overview(UUID tenantId, int days, Instant from, Instant checkedAt, Tasks tasks, Storage storage,
                           List<ModelUsage> models, List<Failure> errors, List<AttemptUsage> attemptUsage) {}
    private final JdbcTemplate db;
    private final IdentityService identities;
    private final JsonMapper json = new JsonMapper();
    public OperationsService(JdbcTemplate db, IdentityService identities) { this.db=db; this.identities=identities; }

    @Transactional
    public Overview platform(UUID actor, UUID tenant, int days) {
        identities.platform(actor);
        if(tenant!=null && !Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM tenants WHERE id=?)",Boolean.class,tenant)))
            throw new IdentityException(404,"TENANT_NOT_FOUND");
        var result=project(tenant,days);
        identities.platform(actor);
        return result;
    }
    @Transactional
    public Overview tenant(UUID actor, UUID tenant, int days) {
        // The same tenant lock/recheck as the existing administrative reads. Platform role is not membership.
        identities.member(actor,tenant,true);
        var result=project(tenant,days);
        identities.member(actor,tenant,true);
        return result;
    }
    private Overview project(UUID tenant, int days) {
        if(days!=7 && days!=30) throw IdentityException.invalid();
        Instant end=Instant.now(), from=end.minus(days,ChronoUnit.DAYS);
        var args=new ArrayList<Object>(List.of(Timestamp.from(from),Timestamp.from(end)));
        String taskScope=tenant==null?"":" AND tenant_id=?";
        if(tenant!=null)args.add(tenant);
        String storageScope=" WHERE NOT EXISTS(SELECT 1 FROM content_cleanup_blobs b WHERE b.object_id=material_versions.object_id AND b.deleted_at IS NOT NULL)"+(tenant==null?"":" AND tenant_id=?");
        if(tenant!=null)args.add(tenant);
        args.add(Timestamp.from(from));args.add(Timestamp.from(end));if(tenant!=null)args.add(tenant);
        // All aggregates use one SQL statement/snapshot, independent of concurrent task transitions.
        String sql="""
            WITH cohort AS MATERIALIZED (
              SELECT status,mode,execution_class,attempt,model_calls,token_usage,error_code,created_at,finished_at
              FROM conversation_tasks WHERE created_at>=? AND created_at<? %s
            ), totals AS (
              SELECT count(*) total,
                count(*) FILTER(WHERE status='QUEUED') queued, count(*) FILTER(WHERE status='RUNNING') running,
                count(*) FILTER(WHERE status='SUCCEEDED') succeeded, count(*) FILTER(WHERE status='FAILED') failed,
                count(*) FILTER(WHERE status='CANCELLED') cancelled, count(*) FILTER(WHERE status='INTERRUPTED') interrupted,
                count(*) FILTER(WHERE status='PAUSED') AS "paused", count(*) FILTER(WHERE status='WAITING_INPUT') AS "waitingInput", count(*) FILTER(WHERE status='WAITING_CAPABILITY') AS "waitingCapability", count(*) FILTER(WHERE status='PARTIAL') AS "partial", count(*) FILTER(WHERE status='RESULT_UNKNOWN') AS "resultUnknown",
                coalesce(sum(greatest(attempt-1,0)),0) retry_starts FROM cohort
            ), model_totals AS (
              SELECT execution_class AS "executionClass",count(*) AS "succeededTasks",
                count(*) FILTER(WHERE jsonb_typeof(token_usage)='object') AS "reportedTasks",
                coalesce(sum(model_calls),0) AS "modelCalls",
                sum((token_usage->>'inputTokens')::bigint) AS "inputTokens",
                sum((token_usage->>'outputTokens')::bigint) AS "outputTokens"
              FROM cohort WHERE mode='AGENT' AND status='SUCCEEDED' GROUP BY execution_class
            ), errors AS (
              SELECT CASE WHEN error_code IN ('TASK_SOURCE_UNAVAILABLE','TASK_RUNTIME_INCOMPATIBLE',
                'TASK_RUNTIME_UNAVAILABLE','TASK_MODEL_FAILED','TASK_LIMIT','TASK_TOOL_FAILED','MODEL_NOT_CONFIGURED',
                'PUBLIC_WEB_NOT_CONFIGURED','TASK_FILE_UNSUPPORTED','TASK_FILE_ENCODING','TASK_FILE_INVALID',
                'TASK_FILE_LIMIT','TASK_FILE_DATA','TASK_INTERRUPTED','TASK_RESULT_UNKNOWN','TASK_PLAN_STOPPED','TASK_PLAN_EXPIRED') THEN error_code ELSE 'OTHER' END code,
                count(*) tasks,max(coalesce(finished_at,created_at)) AS "lastOccurredAt"
              FROM cohort WHERE status IN ('FAILED','INTERRUPTED','RESULT_UNKNOWN') GROUP BY 1
            ), storage AS (
              SELECT count(DISTINCT material_id) materials,count(*) versions,coalesce(sum(size_bytes),0) original_bytes
              FROM material_versions %s
            ), attempt_totals AS (
              SELECT a.execution_class AS "executionClass",count(*) AS attempts,
                count(*) FILTER(WHERE a.metering_enabled) AS "meteredAttempts",
                count(*) FILTER(WHERE a.status='RUNNING') AS running,
                count(*) FILTER(WHERE a.status='SUCCEEDED') AS succeeded,
                count(*) FILTER(WHERE a.status='FAILED') AS failed,
                count(*) FILTER(WHERE a.status='CANCELLED') AS cancelled,
                count(*) FILTER(WHERE a.status='INTERRUPTED') AS interrupted,
                count(*) FILTER(WHERE a.status='PAUSED') AS "paused", count(*) FILTER(WHERE a.status='WAITING_INPUT') AS "waitingInput", count(*) FILTER(WHERE a.status='WAITING_CAPABILITY') AS "waitingCapability", count(*) FILTER(WHERE a.status='PARTIAL') AS "partial", count(*) FILTER(WHERE a.status='RESULT_UNKNOWN') AS "resultUnknown",
                coalesce(sum(r.requests),0) AS requests,coalesce(sum(r.pending),0) AS "pendingRequests",
                coalesce(sum(r.reported),0) AS "reportedRequests",
                sum(r.input) AS "inputTokens",sum(r.output) AS "outputTokens"
              FROM agent_attempt_usage a LEFT JOIN LATERAL (
                SELECT count(*) AS requests,count(*) FILTER(WHERE outcome='PENDING') AS pending,
                  count(input_tokens) AS reported,sum(input_tokens) AS input,sum(output_tokens) AS output
                FROM agent_model_requests WHERE attempt_id=a.attempt_id
              ) r ON true
              WHERE a.started_at>=? AND a.started_at<? %s GROUP BY a.execution_class
            )
            SELECT totals.*,storage.*,
              coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m."executionClass") FROM model_totals m),'[]') models,
              coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.tasks DESC,e.code) FROM errors e),'[]') errors,
              coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a."executionClass") FROM attempt_totals a),'[]') attempt_usage
            FROM totals CROSS JOIN storage
            """.formatted(taskScope,storageScope,taskScope);
        db.execute("SET LOCAL statement_timeout='3s'");
        return db.queryForObject(sql,(r,n)->new Overview(tenant,days,from,end,
            new Tasks(r.getLong("total"),r.getLong("queued"),r.getLong("running"),r.getLong("succeeded"),r.getLong("failed"),r.getLong("cancelled"),r.getLong("interrupted"),r.getLong("paused"),r.getLong("waitingInput"),r.getLong("waitingCapability"),r.getLong("partial"),r.getLong("resultUnknown"),r.getLong("retry_starts")),
            new Storage(r.getLong("materials"),r.getLong("versions"),r.getLong("original_bytes")),
            Arrays.asList(json.readValue(r.getString("models"),ModelUsage[].class)),
            Arrays.asList(json.readValue(r.getString("errors"),Failure[].class)),
            Arrays.asList(json.readValue(r.getString("attempt_usage"),AttemptUsage[].class))),args.toArray());
    }
}
