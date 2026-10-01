package com.dreamcore.workspace.conversation;

import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Metadata only. A late receipt capability grants no task execution or content access. */
@Service
public class AgentUsageLedger {
    public record Start(Integer sequence,Integer maxOutputTokens) {}
    public record Receipt(Integer sequence,String outcome,Long inputTokens,Long outputTokens) {}
    private final JdbcTemplate db;
    public AgentUsageLedger(JdbcTemplate db){this.db=db;}
    void claim(ConversationService.Job job,int number,String executionClass){
        if(!"AGENT".equals(job.mode()))return;
        db.update("INSERT INTO agent_attempt_usage(attempt_id,task_id,tenant_id,workspace_id,attempt_number,execution_class,status) VALUES (?,?,?,?,?,?,'RUNNING')",job.token(),job.id(),job.tenant(),job.space(),number,executionClass);
    }
    void terminal(UUID task,UUID attempt,String state){
        db.update("UPDATE agent_attempt_usage SET status=?,finished_at=now() WHERE task_id=? AND attempt_id=? AND status='RUNNING'",state,task,attempt);
    }
    void expired(UUID task){
        db.update("UPDATE agent_attempt_usage a SET status=t.status,finished_at=now() FROM conversation_tasks t WHERE a.task_id=? AND a.task_id=t.id AND a.status='RUNNING'",task);
    }
    void validateResult(UUID task,UUID attempt,int calls,AgentResult.Usage usage){
        var rows=db.queryForList("SELECT metering_enabled FROM agent_attempt_usage WHERE task_id=? AND attempt_id=?",task,attempt);
        if(rows.isEmpty() || !Boolean.TRUE.equals(rows.getFirst().get("metering_enabled")))return;
        var totals=db.queryForMap("SELECT count(*) calls,count(*) FILTER(WHERE outcome='RETURNED') returned,count(input_tokens) reported,coalesce(sum(input_tokens),0)::bigint input,coalesce(sum(output_tokens),0)::bigint output FROM agent_model_requests WHERE attempt_id=?",attempt);
        long count=((Number)totals.get("calls")).longValue(),reported=((Number)totals.get("reported")).longValue();
        if(count!=calls || ((Number)totals.get("returned")).longValue()!=count ||
            (reported==count ? usage==null || usage.inputTokens()!=((Number)totals.get("input")).longValue() || usage.outputTokens()!=((Number)totals.get("output")).longValue() : usage!=null))
            throw new IdentityException(502,"TASK_RUNTIME_INCOMPATIBLE");
    }
    Map<String,Object> open(UUID task,UUID attempt){
        if(db.update("UPDATE agent_attempt_usage SET metering_enabled=true WHERE task_id=? AND attempt_id=? AND status='RUNNING'",task,attempt)!=1)throw denied();
        return Map.of("contractVersion","1.0","maxModelCalls",8,"maxOutputTokens",2048);
    }
    void start(UUID task,UUID attempt,Start request){
        if(request==null || request.sequence()==null || request.maxOutputTokens()==null || request.sequence()<1 || request.sequence()>8 || request.maxOutputTokens()<1 || request.maxOutputTokens()>2048)throw new IdentityException(409,"TASK_LIMIT");
        // Caller has locked/authorized the live task first. Serialize all reservations for this attempt.
        if(db.queryForList("SELECT attempt_id FROM agent_attempt_usage WHERE task_id=? AND attempt_id=? AND status='RUNNING' AND metering_enabled FOR UPDATE",task,attempt).isEmpty())throw denied();
        int count=db.queryForObject("SELECT count(*) FROM agent_model_requests WHERE attempt_id=?",Integer.class,attempt);
        if(request.sequence()!=count+1 || db.queryForObject("SELECT count(*) FROM agent_model_requests WHERE attempt_id=? AND outcome='PENDING'",Integer.class,attempt)>0)throw new IdentityException(409,"TASK_STATE_CHANGED");
        db.update("INSERT INTO agent_model_requests(task_id,attempt_id,sequence,max_output_tokens) VALUES (?,?,?,?)",task,attempt,request.sequence(),request.maxOutputTokens());
    }
    @Transactional public void finish(UUID task,UUID attempt,Receipt receipt){
        if(receipt==null || receipt.sequence()==null || receipt.sequence()<1 || receipt.sequence()>8 || receipt.outcome()==null || !Set.of("RETURNED","FAILED","CANCELLED").contains(receipt.outcome()) || (receipt.inputTokens()==null)!=(receipt.outputTokens()==null) || receipt.inputTokens()!=null && (receipt.inputTokens()<0 || receipt.outputTokens()<0 || receipt.inputTokens()>1000000 || receipt.outputTokens()>1000000))throw IdentityException.invalid();
        // No membership/content reads. Only an existing reservation, with its original short-lived token.
        var rows=db.queryForList("SELECT r.* FROM agent_model_requests r JOIN agent_attempt_usage a USING(task_id,attempt_id) WHERE r.task_id=? AND r.attempt_id=? AND r.sequence=? AND a.receipt_until>clock_timestamp() FOR UPDATE OF r",task,attempt,receipt.sequence());
        if(rows.isEmpty())throw denied();var row=rows.getFirst();
        // Recheck expiry after a possible lock wait. Identical delivery is idempotent; changes are rejected.
        if(!Boolean.TRUE.equals(db.queryForObject("SELECT receipt_until>clock_timestamp() FROM agent_attempt_usage WHERE attempt_id=?",Boolean.class,attempt)))throw denied();
        if(!"PENDING".equals(row.get("outcome"))){
            if(!Objects.equals(row.get("outcome"),receipt.outcome()) || !Objects.equals(row.get("input_tokens"),receipt.inputTokens()) || !Objects.equals(row.get("output_tokens"),receipt.outputTokens()))throw new IdentityException(409,"TASK_STATE_CHANGED");
            return;
        }
        db.update("UPDATE agent_model_requests SET outcome=?,input_tokens=?,output_tokens=?,reported_at=now() WHERE attempt_id=? AND sequence=?",receipt.outcome(),receipt.inputTokens(),receipt.outputTokens(),attempt,receipt.sequence());
    }
    private IdentityException denied(){return new IdentityException(403,"TASK_ACCESS_DENIED");}
}
