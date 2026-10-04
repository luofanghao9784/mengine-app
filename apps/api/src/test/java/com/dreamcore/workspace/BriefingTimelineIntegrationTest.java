package com.dreamcore.workspace;

import com.dreamcore.workspace.briefing.BriefingService;
import com.dreamcore.workspace.identity.IdentityException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** Isolated synthetic persisted deliveries; inherited tests also protect the existing feed. */
class BriefingTimelineIntegrationTest extends BriefingIntegrationTest {
    UUID card(UUID actor, UUID location, String title, String at) throws Exception {
        var detail=success(actor,location,null,"合成日期摘要："+title,at);
        UUID task=detail.tasks().getLast().id(),artifact=UUID.randomUUID();
        byte[] content=("""
            {"schemaVersion":"briefing-text-v1","businessType":"INSIGHT","title":"%s","summary":"合成来源支持的日期分组摘要。","analysis":["第一段合成分析。","第二段合成分析。"],"chart":null,"source":null,"calculationArtifactId":null,"calculationSha256":null,"generatedAt":"2026-09-23T08:00:00Z"}
            """).formatted(title).getBytes(StandardCharsets.UTF_8);
        String sha=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        db.update("INSERT INTO conversation_artifacts(id,tenant_id,workspace_id,task_id,filename,sha256,content,attempt_number) VALUES (?,?,?,?,?,?,?,1)",artifact,tenant,location,task,"briefing-text-synthetic.json",sha,content);
        db.update("INSERT INTO identity_audit(actor_id,tenant_id,action,target_id,outcome) VALUES (?,?,'TASK_BRIEFING_CREATED',?,'SUCCESS')",actor,tenant,artifact);
        db.update("INSERT INTO conversation_tool_receipts(task_id,attempt_number,sequence,name,status) VALUES (?,1,1,'deliver_briefing','succeeded')",task);
        return task;
    }
    void preference(UUID task,boolean pinned,boolean hidden){
        UUID location=db.queryForObject("SELECT workspace_id FROM conversation_tasks WHERE id=?",UUID.class,task);
        db.update("INSERT INTO briefing_card_preferences(task_id,tenant_id,workspace_id,owner_id,pinned,hidden) VALUES (?,?,?,?,?,?)",task,tenant,location,owner,pinned,hidden);
    }
    BriefingService.Timeline timeline(String zone,int offset,int limit,Instant asOf){return briefing.timeline(owner,tenant,zone,offset,limit,asOf);}
    @Test void summaryCountsWholeDaySelectsOldPinnedCardAndExpansionHasNoLossOrDuplicates() throws Exception {
        UUID pin=card(owner,personal,"较早但关注的主题","2026-09-23T00:00:00Z");preference(pin,true,false);
        for(int i=0;i<25;i++)card(owner,personal,"独立主题"+i,"2026-09-23T08:00:"+String.format("%02d",i)+"Z");
        var page=timeline("UTC",0,20,null);assertEquals(1,page.items().size());var day=page.items().getFirst();
        assertEquals(26,day.total());assertEquals(3,day.items().size());assertEquals(pin,day.items().getFirst().taskId());
        var all=new ArrayList<UUID>(day.items().stream().map(BriefingService.Card::taskId).toList());
        var more=briefing.timelineDay(owner,tenant,day.date(),"UTC",3,20,page.asOf());assertTrue(more.hasMore());
        all.addAll(more.items().stream().map(BriefingService.Card::taskId).toList());
        var tail=briefing.timelineDay(owner,tenant,day.date(),"UTC",23,20,page.asOf());assertFalse(tail.hasMore());
        all.addAll(tail.items().stream().map(BriefingService.Card::taskId).toList());assertEquals(26,new HashSet<>(all).size());
        assertEquals(all.subList(0,3),briefing.timelineDay(owner,tenant,day.date(),"UTC",0,3,page.asOf()).items().stream().map(BriefingService.Card::taskId).toList());
    }
    @Test void distinctTitlesAreSelectedBeforeRepeatedTopicButAllDeliveriesRemainAvailable() throws Exception {
        card(owner,personal,"不同主题甲","2026-09-23T00:00:00Z");card(owner,personal,"不同主题乙","2026-09-23T01:00:00Z");
        for(int i=0;i<5;i++)card(owner,personal,"重复主题","2026-09-23T08:00:0"+i+"Z");
        var day=timeline("UTC",0,20,null).items().getFirst();assertEquals(7,day.total());
        assertEquals(3,day.items().stream().map(BriefingService.Card::title).distinct().count());
        assertEquals(4,briefing.timelineDay(owner,tenant,day.date(),"UTC",3,20,null).items().size());
    }
    @Test void dayPagingSkipsEmptyDaysUsesLocalMidnightAndKeepsSnapshot() throws Exception {
        card(owner,personal,"午夜前","2026-09-22T15:59:59Z");card(owner,personal,"午夜后","2026-09-22T16:00:00Z");
        card(owner,personal,"较早日期","2026-09-20T08:00:00Z");
        Instant cut=Instant.parse("2026-09-22T16:00:00Z");
        var first=timeline("Asia/Shanghai",0,1,cut);assertTrue(first.hasMore());assertEquals("2026-09-23",first.items().getFirst().date());
        var second=timeline("Asia/Shanghai",1,1,first.asOf());assertEquals("2026-09-22",second.items().getFirst().date());
        var third=timeline("Asia/Shanghai",2,1,first.asOf());assertEquals("2026-09-20",third.items().getFirst().date());assertFalse(third.hasMore());
        card(owner,personal,"快照后完成","2026-09-23T08:00:00Z");assertEquals(1,timeline("Asia/Shanghai",0,1,cut).items().getFirst().total());
        assertEquals(2,timeline("UTC",0,20,cut).items().getFirst().total());
    }
    @Test void countsSummariesAndExpansionEnforceCurrentOwnerWorkspaceAndVisibility() throws Exception {
        UUID visible=card(owner,personal,"可读主题","2026-09-23T08:00:00Z");
        UUID hidden=card(owner,personal,"隐藏主题","2026-09-23T08:01:00Z");preference(hidden,false,true);
        card(reader,space,"他人的私有卡","2026-09-23T08:02:00Z");card(owner,space,"即将撤权","2026-09-23T08:03:00Z");
        var before=timeline("UTC",0,20,null);assertEquals(2,before.items().getFirst().total());
        db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
        var after=timeline("UTC",0,20,before.asOf());assertEquals(1,after.items().getFirst().total());assertEquals(visible,after.items().getFirst().items().getFirst().taskId());
        assertEquals(1,briefing.timelineDay(owner,tenant,"2026-09-23","UTC",0,20,before.asOf()).items().size());
        denied(403,()->briefing.timeline(owner,other,"UTC",0,20,null));
        db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,owner);
        denied(403,()->briefing.timelineDay(owner,tenant,"2026-09-23","UTC",0,20,before.asOf()));
    }
    @org.springframework.beans.factory.annotation.Autowired com.dreamcore.workspace.feedback.FeedbackService feedback;
    @Test void deliveredCardFeedbackUsesCardPreferenceWhileLegacyFeedbackRetainsConversationPreference() throws Exception {
        UUID task=card(owner,space,"关注后仍可评价","2026-09-23T08:00:00Z");preference(task,true,false);
        int revision=db.queryForObject("SELECT revision FROM conversation_tasks WHERE id=?",Integer.class,task);
        var target=new com.dreamcore.workspace.feedback.FeedbackService.Target("BRIEFING",task,revision,1,"briefing-basic-v1",1);
        assertNull(feedback.lookup(owner,tenant,target).feedback());
        var saved=feedback.create(owner,tenant,UUID.randomUUID(),target,new com.dreamcore.workspace.feedback.FeedbackService.Assessment("USEFUL",List.of(),""));
        assertEquals(saved.id(),feedback.lookup(owner,tenant,target).feedback().id());
        denied(409,()->feedback.lookup(owner,tenant,new com.dreamcore.workspace.feedback.FeedbackService.Target("BRIEFING",task,revision,1,"briefing-basic-v1",0)));
        denied(404,()->feedback.lookup(reader,tenant,target));
        var legacy=success(owner,personal,null,"旧成果评价",null);UUID oldTask=legacy.tasks().getLast().id();
        var oldTarget=new com.dreamcore.workspace.feedback.FeedbackService.Target("BRIEFING",oldTask,legacy.tasks().getLast().revision(),1,"briefing-basic-v1",0);
        assertNull(feedback.lookup(owner,tenant,oldTarget).feedback());
        db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
        denied(404,()->feedback.lookup(owner,tenant,target));
    }
    @Test void invalidDayZonePagingAndFutureSnapshotAreRejected(){
        denied(400,()->timeline("not/a-zone",0,20,null));denied(400,()->timeline("UTC",0,31,null));
        denied(400,()->timeline("UTC",-1,20,null));denied(400,()->timeline("UTC",0,20,Instant.now().plusSeconds(30)));
        denied(400,()->briefing.timelineDay(owner,tenant,"2026-02-30","UTC",0,20,null));
    }
}
