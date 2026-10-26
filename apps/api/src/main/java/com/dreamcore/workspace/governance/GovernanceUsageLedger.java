package com.dreamcore.workspace.governance;

import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Durable model dispatch accounting. Unknown costs are retained, never represented as free calls. */
@Service
public class GovernanceUsageLedger {
    private final JdbcTemplate db;
    public GovernanceUsageLedger(JdbcTemplate db) { this.db=db; }
    public void start(UUID job, int revision, UUID lease) {
        db.update("INSERT INTO governance_model_usage(job_id,revision,tenant_id,execution_class,state,dispatch_token) SELECT j.id,?,j.tenant_id,CASE WHEN d.executor='SYSTEM_MODEL' THEN 'live' ELSE 'unknown' END,'PENDING',? FROM governance_model_jobs j JOIN governance_model_dispatch d ON d.job_id=j.id WHERE j.id=? ON CONFLICT(job_id,revision) DO UPDATE SET dispatch_token=excluded.dispatch_token WHERE governance_model_usage.state='PENDING'",revision,lease,job);
    }
    public void returned(UUID job,int revision,Map<?,?> result) {
        Long calls=number(result.get("modelCalls"),100),in=number(result.get("inputTokens"),100000000),out=number(result.get("outputTokens"),100000000);
        if((in==null)!=(out==null)){in=null;out=null;}
        String model=result.get("modelName") instanceof String s && s.length()<=200?s:null;
        db.update("UPDATE governance_model_usage SET state='RETURNED',model_name=?,model_calls=?,input_tokens=?,output_tokens=?,reported_at=now() WHERE job_id=? AND revision=? AND state IN ('PENDING','UNKNOWN')",model,calls,in,out,job,revision);
    }
    public void unknown(UUID job, UUID lease) {
        db.update("UPDATE governance_model_usage SET state='UNKNOWN',reported_at=now() WHERE job_id=? AND dispatch_token=? AND state='PENDING'",job,lease);
    }
    public void expire() {
        db.update("UPDATE governance_model_usage u SET state='UNKNOWN',reported_at=now() FROM governance_model_dispatch d WHERE u.job_id=d.job_id AND u.state='PENDING' AND d.state IN ('FAILED','STALE')");
    }
    private Long number(Object value,long max) {
        if(!(value instanceof Number n))return null;
        try {long v=new java.math.BigDecimal(n.toString()).longValueExact();return v>=0&&v<=max?v:null;}
        catch(ArithmeticException|NumberFormatException bad){return null;}
    }
}
