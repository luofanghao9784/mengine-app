package com.dreamcore.workspace.identity;

import com.dreamcore.workspace.conversation.ConversationService;
import com.dreamcore.workspace.plans.PlanSchedule;
import java.sql.Timestamp;
import java.time.*;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class TenantServiceRuntime {
    private final JdbcTemplate db; private final ConversationService conversations; private final com.dreamcore.workspace.briefing.BriefingGenerationService briefings;
    public TenantServiceRuntime(JdbcTemplate db,ConversationService conversations,com.dreamcore.workspace.briefing.BriefingGenerationService briefings){this.db=db;this.conversations=conversations;this.briefings=briefings;}
    /** Caller owns tenant FOR UPDATE. Worker paths acquire tenant before their task/plan locks. */
    public void suspend(UUID tenant,Instant now){
        briefings.settleBeforeSuspension(tenant);
        conversations.suspendTenant(tenant);
        // A batch did not finish generating; preserve the actual task state/receipts separately.
        db.update("UPDATE briefing_generation_batches SET status='FAILED',reason='TENANT_SERVICE_SUSPENDED',finished_at=? WHERE tenant_id=? AND status IN ('QUEUED','RUNNING','WAITING_DATA','WAITING_RESOURCE','WAITING_CAPABILITY')",Timestamp.from(now),tenant);
    }
    public void resume(UUID tenant,Instant now){
        for(var c:db.queryForList("SELECT id,frequency,daily_time,time_zone FROM data_connections WHERE tenant_id=? AND auto_enabled ORDER BY id FOR UPDATE",tenant)) {
            Instant next=com.dreamcore.workspace.collection.CollectionSchedule.next(now,(String)c.get("frequency"),(String)c.get("daily_time"),(String)c.get("time_zone"));
            db.update("UPDATE data_connections SET next_due=? WHERE id=?",Timestamp.from(next),c.get("id"));
        }
        for(var p:db.queryForList("SELECT id,daily_time,time_zone FROM ongoing_plans WHERE tenant_id=? AND status='ACTIVE' ORDER BY id FOR UPDATE",tenant)){
            Instant next=p.get("daily_time")==null?null:PlanSchedule.next(now,LocalTime.parse((String)p.get("daily_time")),ZoneId.of((String)p.get("time_zone")));
            db.update("UPDATE ongoing_plans p SET next_due=?,observed_event=(SELECT coalesce(max(sequence),0) FROM ongoing_plan_material_events e WHERE e.tenant_id=p.tenant_id AND e.workspace_id=p.workspace_id),retry_requested=false,checked_at=NULL WHERE id=?",next==null?null:Timestamp.from(next),p.get("id"));
        }
        db.update("UPDATE task_plan_checks SET state='CANCELLED' WHERE tenant_id=? AND state='PENDING' AND check_at<=?",tenant,Timestamp.from(now));
        var local=now.atZone(ZoneId.of("Asia/Shanghai"));
        db.update("UPDATE briefing_generation_policies SET service_resume_pending=true,info_day=CASE WHEN ? THEN ? ELSE info_day END,checked_at=NULL WHERE tenant_id=?",local.getHour()>=9,java.sql.Date.valueOf(local.toLocalDate()),tenant);
    }
}
