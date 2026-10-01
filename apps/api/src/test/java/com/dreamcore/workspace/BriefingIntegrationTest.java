package com.dreamcore.workspace;

import com.dreamcore.workspace.briefing.BriefingService;
import com.dreamcore.workspace.briefing.BriefingLayoutService;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.tasks.initial-delay-ms=3600000","dreamcore.knowledge.initial-delay-ms=3600000"})
class BriefingIntegrationTest {
    @Autowired BriefingService briefing;
    @Autowired BriefingLayoutService layout;
    @Autowired ConversationService conversations;
    @Autowired AgentTaskService agents;
    @Autowired JdbcTemplate db;
    @Autowired PasswordEncoder passwords;
    UUID tenant, other, owner, reader, admin, space, personal;
    @BeforeEach void fixture(){
        tenant=UUID.randomUUID();other=UUID.randomUUID();owner=UUID.randomUUID();reader=UUID.randomUUID();admin=UUID.randomUUID();space=UUID.randomUUID();personal=UUID.randomUUID();
        for(UUID actor:List.of(owner,reader,admin))db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",actor,actor+"@example.test","合成画报测试",passwords.encode("synthetic-briefing-password"));
        db.update("INSERT INTO tenants(id,name) VALUES (?,'画报测试'),(?,'其他企业')",tenant,other);
        for(UUID actor:List.of(owner,reader,admin))db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,actor,actor.equals(admin)?"TENANT_ADMIN":"MEMBER");
        db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'共享资料','SHARED'),(?,?,?,'个人资料','PERSONAL')",space,tenant,admin,personal,tenant,owner);
        db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,false),(?,?,?,false)",tenant,space,owner,tenant,space,reader);
    }
    @AfterEach void cleanup(){db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);}
    void denied(int status,Runnable action){assertEquals(status,assertThrows(IdentityException.class,action::run).status);}
    BriefingService.Page list(){return briefing.list(owner,tenant,null,"LATEST",null,"Asia/Shanghai",0,20);}
    ConversationService.Detail success(UUID actor,UUID location,UUID conversation,String reply,String finishedAt){
        var submitted=conversations.submit(actor,tenant,conversation,location,UUID.randomUUID(),"合成画报任务","AGENT");
        var job=conversations.claim();assertNotNull(job);assertEquals(submitted.tasks().getLast().id(),job.id());
        agents.finish(job,new AgentResult("1.4","0.8.0",job.id(),job.token(),"AGENT","verification","local-verification",reply,List.of(),List.of(),List.of(),1,null,List.of(),List.of(),List.of()));
        if(finishedAt!=null)db.update("UPDATE conversation_tasks SET finished_at=? WHERE id=?",Timestamp.from(Instant.parse(finishedAt)),job.id());
        return conversations.detail(actor,tenant,submitted.conversation().id(),0,20);
    }
    @Test void latestSuccessfulResultReplacesCardButFailureAndLookupDoNot(){
        var d=success(owner,space,null,"第一次成果","2026-09-22T08:00:00Z");UUID id=d.conversation().id();
        success(owner,space,id,"最新成果","2026-09-23T08:00:00Z");
        var failed=conversations.submit(owner,tenant,id,null,UUID.randomUUID(),"失败任务","AGENT");
        conversations.action(owner,tenant,id,failed.tasks().getLast().id(),UUID.randomUUID(),0,"CANCEL");
        var lookup=conversations.submit(owner,tenant,null,personal,UUID.randomUUID(),"资料","SOURCE_LOOKUP");var job=conversations.claim();
        conversations.finish(job,new TaskRuntime.Result("1.0","0.8.0",job.id(),job.token(),"SOURCE_LOOKUP","NO_SOURCES",List.of()));
        var page=list();assertEquals(1,page.items().size());assertEquals("最新成果",page.items().getFirst().excerpt());assertEquals(id,page.items().getFirst().conversationId());
        assertNotEquals(lookup.conversation().id(),page.items().getFirst().conversationId());
        assertEquals("verification",page.items().getFirst().executionClass());
    }
    @Test void calendarDayUsesZoneAndImmutableTaskRatherThanCurrentReply(){
        var first=success(owner,space,null,"北京时间 22 日末","2026-09-22T15:59:59Z");UUID conversation=first.conversation().id(),anchor=first.tasks().getLast().id();
        success(owner,space,conversation,"北京时间 23 日初","2026-09-22T16:00:00Z");
        var old=briefing.list(owner,tenant,null,"LATEST","2026-09-22","Asia/Shanghai",0,20);
        assertEquals(anchor,old.items().getFirst().taskId());assertEquals("北京时间 22 日末",old.items().getFirst().excerpt());
        assertEquals("北京时间 23 日初",briefing.list(owner,tenant,null,"LATEST","2026-09-22","UTC",0,20).items().getFirst().excerpt());
        assertEquals("北京时间 23 日初",briefing.list(owner,tenant,null,"LATEST","2026-09-23","Asia/Shanghai",0,20).items().getFirst().excerpt());
        assertTrue(briefing.list(owner,tenant,null,"LATEST","2026-09-24","Asia/Shanghai",0,20).items().isEmpty());
        for(String invalid:List.of("2026-02-30","22/09/2026","2026-9-22","0000-01-01","+999999999-12-31"))denied(400,()->briefing.list(owner,tenant,null,"LATEST",invalid,"UTC",0,20));
        denied(400,()->briefing.list(owner,tenant,null,"LATEST",null,"unknown/zone",0,20));
    }
    @Test void focusHideRestoreResizePersistAndWritesAreIdempotentAndRevisionChecked(){
        UUID id=success(owner,space,null,"成果",null).conversation().id(),key=UUID.randomUUID();
        assertEquals(0,list().items().getFirst().preference().revision());
        var saved=briefing.update(owner,tenant,id,key,0,true,false,"WIDE");assertEquals(1,saved.revision());
        assertEquals(saved,briefing.update(owner,tenant,id,key,0,true,false,"WIDE"));
        denied(409,()->briefing.update(owner,tenant,id,key,0,false,false,"WIDE"));
        denied(409,()->briefing.update(owner,tenant,id,UUID.randomUUID(),0,false,false,"STANDARD"));
        assertEquals(id,briefing.list(owner,tenant,null,"FOCUSED",null,"UTC",0,20).items().getFirst().conversationId());
        briefing.update(owner,tenant,id,UUID.randomUUID(),1,true,true,"WIDE");assertTrue(list().items().isEmpty());
        assertTrue(briefing.list(owner,tenant,null,"FOCUSED",null,"UTC",0,20).items().isEmpty());
        var hidden=briefing.list(owner,tenant,null,"HIDDEN",null,"UTC",0,20).items().getFirst();assertEquals(2,hidden.preference().revision());
        briefing.update(owner,tenant,id,UUID.randomUUID(),2,true,false,"STANDARD");
        success(owner,space,id,"后续成果",null);assertTrue(list().items().getFirst().preference().pinned());assertEquals(3,list().items().getFirst().preference().revision());
        assertEquals("STANDARD",list().items().getFirst().preference().size());
    }
    @Test void sameSpaceMemberAndTenantAdminCannotReadOrModifyOwnersPrivateCards(){
        UUID id=success(owner,space,null,"仅我可见",null).conversation().id();
        for(UUID actor:List.of(reader,admin)){
            assertTrue(briefing.list(actor,tenant,null,"LATEST",null,"UTC",0,20).items().isEmpty());
            denied(404,()->briefing.update(actor,tenant,id,UUID.randomUUID(),0,true,false,"WIDE"));
            denied(404,()->conversations.historical(actor,tenant,id,list().items().getFirst().taskId()));
        }
        denied(403,()->briefing.list(owner,other,null,"LATEST",null,"UTC",0,20));
        denied(403,()->briefing.update(owner,other,id,UUID.randomUUID(),0,true,false,"WIDE"));
    }
    @Test void concurrentPreferenceUpdatesCannotSilentlyOverwriteEachOther() throws Exception {
        UUID id=success(owner,space,null,"并发编辑",null).conversation().id();
        var start=new java.util.concurrent.CountDownLatch(1);
        try(var pool=java.util.concurrent.Executors.newFixedThreadPool(2)){
            var results=new ArrayList<java.util.concurrent.Future<Integer>>();
            for(boolean pin:List.of(true,false))results.add(pool.submit(()->{start.await();try{briefing.update(owner,tenant,id,UUID.randomUUID(),0,pin,false,"WIDE");return 200;}catch(IdentityException e){return e.status;}}));
            start.countDown();var statuses=new ArrayList<Integer>();for(var result:results)statuses.add(result.get(5,java.util.concurrent.TimeUnit.SECONDS));
            Collections.sort(statuses);assertEquals(List.of(200,409),statuses);assertEquals(1,list().items().getFirst().preference().revision());
        }
    }
    @Test void revocationHidesBothCurrentAndOldCardsAndInvalidatesPreferenceReplay(){
        var done=success(owner,space,null,"旧成果","2026-09-22T08:00:00Z");UUID id=done.conversation().id(),key=UUID.randomUUID();
        briefing.update(owner,tenant,id,key,0,true,false,"WIDE");
        db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
        assertTrue(list().items().isEmpty());assertTrue(briefing.list(owner,tenant,null,"LATEST","2026-09-22","UTC",0,20).items().isEmpty());
        denied(404,()->briefing.list(owner,tenant,space,"LATEST",null,"UTC",0,20));
        denied(404,()->briefing.update(owner,tenant,id,key,0,true,false,"WIDE"));
        denied(404,()->conversations.historical(owner,tenant,id,done.tasks().getLast().id()));
        db.update("UPDATE tenants SET status='SUSPENDED' WHERE id=?",tenant);denied(403,this::list);
    }
    @Test void membershipRevocationRejectsFeedAndHistory(){
        var done=success(owner,personal,null,"个人成果",null);
        db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,owner);
        denied(403,this::list);denied(403,()->conversations.historical(owner,tenant,done.conversation().id(),done.tasks().getLast().id()));
    }
    @Test void paginationFiltersBeforePagingAndBoundsUnicodeExcerpt(){
        UUID shared=success(owner,space,null,"😀".repeat(610),"2026-09-23T08:00:00Z").conversation().id();
        UUID privateId=success(owner,personal,null,"个人成果","2026-09-23T09:00:00Z").conversation().id();
        success(reader,space,null,"他人最新成果","2026-09-23T10:00:00Z");
        var first=briefing.list(owner,tenant,null,"LATEST",null,"UTC",0,1);assertEquals(privateId,first.items().getFirst().conversationId());assertTrue(first.hasMore());
        var second=briefing.list(owner,tenant,null,"LATEST",null,"UTC",1,1);assertEquals(shared,second.items().getFirst().conversationId());assertFalse(second.hasMore());
        assertEquals(600,second.items().getFirst().excerpt().codePointCount(0,second.items().getFirst().excerpt().length()));assertTrue(second.items().getFirst().truncated());
        assertEquals(List.of(shared),briefing.list(owner,tenant,space,"LATEST",null,"UTC",0,20).items().stream().map(BriefingService.Card::conversationId).toList());
        denied(400,()->briefing.list(owner,tenant,null,"LATEST",null,"UTC",0,31));
    }
    @Test void historicalAnchorSurvivesMoreThanOnePageAndRejectsForeignOrUnfinishedTasks(){
        var first=success(owner,personal,null,"不可被替换的旧回复",null);UUID id=first.conversation().id(),anchor=first.tasks().getLast().id();
        for(int n=0;n<21;n++)success(owner,personal,id,"后续回复 "+n,null);
        assertFalse(conversations.detail(owner,tenant,id,0,20).tasks().stream().anyMatch(t->t.id().equals(anchor)));
        var historical=conversations.historical(owner,tenant,id,anchor);assertEquals(1,historical.tasks().size());assertEquals(anchor,historical.tasks().getFirst().id());assertEquals("不可被替换的旧回复",historical.tasks().getFirst().reply());
        var other=success(owner,personal,null,"另一个会话",null);denied(404,()->conversations.historical(owner,tenant,id,other.tasks().getLast().id()));
        var queued=conversations.submit(owner,tenant,id,null,UUID.randomUUID(),"尚未完成","AGENT");denied(404,()->conversations.historical(owner,tenant,id,queued.tasks().getLast().id()));
    }
    List<UUID> focused(){return briefing.list(owner,tenant,null,"FOCUSED",null,"UTC",0,20).items().stream().map(BriefingService.Card::conversationId).toList();}
    UUID pinned(UUID location,String finished){UUID id=success(owner,location,null,"布局合成成果",finished).conversation().id();briefing.update(owner,tenant,id,UUID.randomUUID(),0,true,false,"STANDARD");return id;}
    @Test void manualFocusOrderSurvivesNewResultsWithoutChangingLatestOrContent(){
        UUID a=pinned(personal,"2026-09-21T08:00:00Z"),b=pinned(personal,"2026-09-23T08:00:00Z"),c=pinned(personal,"2026-09-22T08:00:00Z");
        assertEquals(List.of(a,b,c),focused());var before=list().items();
        layout.move(owner,tenant,UUID.randomUUID(),layout.get(owner,tenant).revision(),c,a,"BEFORE");
        assertEquals(List.of(c,a,b),focused());assertEquals(before,list().items());
        success(owner,personal,a,"较新的内容保留手动位置","2026-09-24T08:00:00Z");
        assertEquals(List.of(c,a,b),focused());assertEquals(a,list().items().getFirst().conversationId());
        assertEquals(List.of(c,a),briefing.list(owner,tenant,null,"FOCUSED",null,"UTC",0,2).items().stream().map(BriefingService.Card::conversationId).toList());
        assertEquals(List.of(a),briefing.list(owner,tenant,null,"FOCUSED","2026-09-24","UTC",0,20).items().stream().map(BriefingService.Card::conversationId).toList());
    }
    @Test void layoutReplayIsHistoricalAndCurrentAuthorityStillApplies(){
        UUID a=pinned(personal,null),b=pinned(space,null),key=UUID.randomUUID();int initial=layout.get(owner,tenant).revision();
        var first=layout.move(owner,tenant,key,initial,b,a,"BEFORE");
        layout.move(owner,tenant,UUID.randomUUID(),first.currentRevision(),a,b,"BEFORE");
        var replay=layout.move(owner,tenant,key,initial,b,a,"BEFORE");
        assertEquals(first.id(),replay.id());assertEquals(first.appliedRevision(),replay.appliedRevision());assertTrue(replay.currentRevision()>first.appliedRevision());assertEquals(List.of(a,b),focused());
        denied(409,()->layout.move(owner,tenant,key,initial,a,b,"BEFORE"));
        denied(404,()->layout.move(reader,tenant,UUID.randomUUID(),0,b,a,"BEFORE"));
        denied(403,()->layout.get(owner,other));
        db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
        denied(404,()->layout.move(owner,tenant,key,initial,b,a,"BEFORE"));assertEquals(List.of(a),focused());
    }
    @Test void changedPreferenceAndConcurrentLayoutCannotSilentlyOverwrite() throws Exception {
        UUID a=pinned(personal,null),b=pinned(personal,null),c=pinned(personal,null);int initial=layout.get(owner,tenant).revision();
        briefing.update(owner,tenant,c,UUID.randomUUID(),1,true,false,"WIDE");
        denied(409,()->layout.move(owner,tenant,UUID.randomUUID(),initial,b,a,"BEFORE"));
        int revision=layout.get(owner,tenant).revision();var start=new java.util.concurrent.CountDownLatch(1);
        try(var pool=java.util.concurrent.Executors.newFixedThreadPool(2)){
            var results=new ArrayList<java.util.concurrent.Future<Integer>>();for(UUID id:List.of(b,c))results.add(pool.submit(()->{start.await();try{layout.move(owner,tenant,UUID.randomUUID(),revision,id,a,"BEFORE");return 200;}catch(IdentityException e){return e.status;}}));
            start.countDown();var statuses=new ArrayList<Integer>();for(var result:results)statuses.add(result.get(5,java.util.concurrent.TimeUnit.SECONDS));Collections.sort(statuses);assertEquals(List.of(200,409),statuses);
        }
    }
    @Test void repeatedFractionalMovesRebaseWithoutLosingDistinctPositions(){
        UUID a=pinned(personal,null),b=pinned(personal,null),c=pinned(personal,null);
        for(int i=0;i<100;i++)layout.move(owner,tenant,UUID.randomUUID(),layout.get(owner,tenant).revision(),i%2==0?a:c,b,"BEFORE");
        assertEquals(List.of(a,c,b),focused());
        assertEquals(3,db.queryForObject("SELECT count(DISTINCT focus_position) FROM briefing_preferences WHERE tenant_id=? AND owner_id=?",Integer.class,tenant,owner));
        for(int i=0;i<100;i++)layout.move(owner,tenant,UUID.randomUUID(),layout.get(owner,tenant).revision(),i%2==0?a:c,b,"AFTER");
        assertEquals(List.of(b,c,a),focused());
        assertEquals(3,db.queryForObject("SELECT count(DISTINCT focus_position) FROM briefing_preferences WHERE tenant_id=? AND owner_id=?",Integer.class,tenant,owner));
    }
}
