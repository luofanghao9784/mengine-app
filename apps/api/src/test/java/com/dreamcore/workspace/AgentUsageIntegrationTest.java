package com.dreamcore.workspace;

import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(properties={"spring.main.web-application-type=none","dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.tasks.initial-delay-ms=3600000","dreamcore.knowledge.initial-delay-ms=3600000"})
class AgentUsageIntegrationTest {
    @Autowired ConversationService tasks; @Autowired AgentTaskService agents; @Autowired AgentUsageLedger usage;
    @Autowired OperationsService operations; @Autowired JdbcTemplate db;
    UUID tenant,actor,space;
    @BeforeEach void fixture(){
        tenant=UUID.randomUUID();actor=UUID.randomUUID();space=UUID.randomUUID();
        db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,'unused')",actor,actor+"@example.test","private-name");
        db.update("INSERT INTO tenants(id,name) VALUES (?,'private-tenant')",tenant);
        db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'TENANT_ADMIN')",tenant,actor);
        db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'private-space','PERSONAL')",space,tenant,actor);
    }
    @AfterEach void clean(){db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('RUNNING','QUEUED')",tenant);}
    ConversationService.Job claim(){tasks.submit(actor,tenant,null,space,UUID.randomUUID(),"private-prompt","AGENT");return tasks.claim();}
    void start(ConversationService.Job j,int n){agents.startUsage(j.id(),j.token(),new AgentUsageLedger.Start(n,2048));}
    void receipt(ConversationService.Job j,int n,String outcome,Long input,Long output){usage.finish(j.id(),j.token(),new AgentUsageLedger.Receipt(n,outcome,input,output));}
    void action(ConversationService.Job j,String action){int revision=db.queryForObject("SELECT revision FROM conversation_tasks WHERE id=?",Integer.class,j.id());tasks.action(actor,tenant,j.conversation(),j.id(),UUID.randomUUID(),revision,action);}
    void denied(int status,Runnable run){assertEquals(status,assertThrows(IdentityException.class,run::run).status);}
    OperationsService.AttemptUsage summary(){return operations.tenant(actor,tenant,7).attemptUsage().getFirst();}
    AgentResult result(ConversationService.Job j,int calls,AgentResult.Usage tokens){return new AgentResult("1.4","0.11.0",j.id(),j.token(),"AGENT","verification","fixture","synthetic reply",List.of(),List.of(),List.of(),calls,tokens,List.of(),List.of(),List.of());}

    @Test void retryRetainsFailedAttemptAndSuccessMustMatchReceipts(){
        var old=claim();agents.openUsage(old.id(),old.token());start(old,1);receipt(old,1,"FAILED",12L,3L);tasks.fail(old,"TASK_MODEL_FAILED");
        action(old,"RETRY");var next=tasks.claim();agents.openUsage(next.id(),next.token());start(next,1);receipt(next,1,"RETURNED",null,null);
        denied(502,()->agents.finish(next,result(next,2,null)));
        denied(502,()->agents.finish(next,result(next,1,new AgentResult.Usage(0,0))));
        agents.finish(next,result(next,1,null));
        var totals=summary();assertEquals(2,totals.attempts());assertEquals(1,totals.failed());assertEquals(1,totals.succeeded());assertEquals(2,totals.requests());assertEquals(1,totals.reportedRequests());assertEquals(12,totals.inputTokens());assertEquals(0,totals.pendingRequests());
        assertEquals(1,operations.tenant(actor,tenant,7).tasks().total());
        // A foreign enterprise cannot read the aggregate; response contains no task/member/content fields.
        denied(401,()->operations.tenant(UUID.randomUUID(),tenant,7));
        String encoded=new tools.jackson.databind.json.JsonMapper().writeValueAsString(totals);assertFalse(encoded.contains("private"));assertFalse(encoded.contains(old.id().toString()));
    }
    @Test void cancelAllowsOnlyBoundedImmutableLateReceiptAcrossRetry(){
        var old=claim();agents.openUsage(old.id(),old.token());start(old,1);action(old,"CANCEL");
        action(old,"RETRY");var fresh=tasks.claim();
        denied(403,()->start(old,2));denied(403,()->agents.check(old.id(),old.token()));
        receipt(old,1,"CANCELLED",10L,0L);receipt(old,1,"CANCELLED",10L,0L);
        denied(409,()->receipt(old,1,"CANCELLED",11L,0L));
        denied(403,()->usage.finish(UUID.randomUUID(),old.token(),new AgentUsageLedger.Receipt(1,"RETURNED",0L,0L)));
        denied(403,()->receipt(fresh,1,"RETURNED",0L,0L));
        assertEquals(1,summary().cancelled());assertEquals(10,summary().inputTokens());assertEquals(1,summary().running());
        db.update("UPDATE agent_attempt_usage SET receipt_until=now()-interval '1 second' WHERE attempt_id=?",old.token());
        denied(403,()->receipt(old,1,"CANCELLED",10L,0L));
    }
    @Test void reservationsEnforceSequentialCallsAndHardOutputBound(){
        var j=claim();agents.openUsage(j.id(),j.token());
        denied(409,()->agents.startUsage(j.id(),j.token(),new AgentUsageLedger.Start(1,2049)));
        denied(409,()->start(j,2));start(j,1);denied(409,()->start(j,1));denied(409,()->start(j,2));
        receipt(j,1,"RETURNED",0L,0L);
        for(int n=2;n<=8;n++){start(j,n);receipt(j,n,"RETURNED",0L,0L);}
        agents.openUsage(j.id(),j.token()); // Reopening never resets the budget.
        denied(409,()->start(j,9));agents.finish(j,result(j,8,new AgentResult.Usage(0,0)));
        assertEquals(8,summary().requests());assertEquals(0,summary().inputTokens());assertEquals(8,summary().reportedRequests());
    }
    @Test void concurrentReservationDoesNotAuthorizeDuplicateDispatch() throws Exception {
        var j=claim();agents.openUsage(j.id(),j.token());var gate=new CountDownLatch(1);
        try(var executor=Executors.newVirtualThreadPerTaskExecutor()){
            Callable<Boolean> reserve=()->{gate.await();try{start(j,1);return true;}catch(IdentityException e){assertEquals(409,e.status);return false;}};
            var a=executor.submit(reserve);var b=executor.submit(reserve);gate.countDown();
            assertNotEquals(a.get(5,TimeUnit.SECONDS),b.get(5,TimeUnit.SECONDS));
        }
        assertEquals(1,summary().requests());assertEquals(1,summary().pendingRequests());assertNull(summary().inputTokens());
    }
    @Test void permissionRevocationStopsStartsButDoesNotDiscardExistingUsage(){
        var j=claim();agents.openUsage(j.id(),j.token());start(j,1);
        db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,actor);
        denied(403,()->start(j,2));receipt(j,1,"CANCELLED",4L,2L);
        assertEquals(4,db.queryForObject("SELECT input_tokens FROM agent_model_requests WHERE attempt_id=?",Long.class,j.token()));
        denied(403,()->operations.tenant(actor,tenant,7));
    }
    @Test void interruptedAndUnmeteredAttemptsRemainExplicitAndWindowUsesAttemptStart(){
        var j=claim();agents.openUsage(j.id(),j.token());start(j,1);
        db.update("UPDATE conversation_tasks SET lease_until=now()-interval '1 second',created_at=now()-interval '40 days' WHERE id=?",j.id());
        assertNull(tasks.claim());assertEquals(1,summary().resultUnknown());assertEquals(0,summary().interrupted());assertEquals(1,summary().pendingRequests());assertEquals(0,operations.tenant(actor,tenant,7).tasks().total());
        receipt(j,1,"FAILED",null,null);assertNull(summary().inputTokens());assertEquals(0,summary().pendingRequests());
        var legacy=claim();tasks.fail(legacy,"TASK_RUNTIME_UNAVAILABLE");assertEquals(2,summary().attempts());assertEquals(1,summary().meteredAttempts());
        db.update("UPDATE agent_attempt_usage SET started_at=now()-interval '8 days' WHERE attempt_id=?",j.token());assertEquals(1,summary().attempts());assertEquals(2,operations.tenant(actor,tenant,30).attemptUsage().getFirst().attempts());
    }
    @Test void receiptsRejectMissingHalfNegativeAndUnreservedNumbers(){
        var j=claim();agents.openUsage(j.id(),j.token());start(j,1);
        denied(400,()->receipt(j,1,"RETURNED",1L,null));denied(400,()->receipt(j,1,"RETURNED",-1L,0L));
        denied(400,()->receipt(j,1,"RETURNED",1000001L,0L));denied(400,()->receipt(j,1,"private-error",0L,0L));
        denied(403,()->receipt(j,2,"RETURNED",0L,0L));assertEquals(1,summary().pendingRequests());
    }
}
