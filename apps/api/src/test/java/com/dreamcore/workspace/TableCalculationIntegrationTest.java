package com.dreamcore.workspace;

import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.knowledge.*;
import com.dreamcore.workspace.material.*;
import com.dreamcore.workspace.identity.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.net.*;
import java.net.http.*;
import java.util.*;
import java.util.zip.*;
import java.io.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=live","dreamcore.tasks.initial-delay-ms=3600000","dreamcore.knowledge.enabled=true","dreamcore.knowledge.initial-delay-ms=3600000"})
class TableCalculationIntegrationTest {
    @DynamicPropertySource static void paths(DynamicPropertyRegistry r){Path root=Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();String parser=root.resolve("workers/parser").toString();r.add("dreamcore.knowledge.parser-root",()->parser);}
    @Autowired AgentTaskService agents;@Autowired JdbcTemplate db;@Autowired ConversationService conversations;@Autowired KnowledgeService knowledge;@Autowired MaterialService materials;@Autowired PasswordEncoder passwords;
    @MockitoSpyBean LocalTableCalculator calculator;
    @Autowired com.dreamcore.workspace.briefing.BriefingService briefingPage;
    @Autowired com.dreamcore.workspace.recommendation.RecommendationService recommendations;
    @Autowired com.dreamcore.workspace.context.TaskContextService context;
    @LocalServerPort int port;
    UUID tenant,owner,reader,space,personal;
    final JsonMapper json=new JsonMapper();
    @BeforeEach void fixture(){
        tenant=UUID.randomUUID();owner=UUID.randomUUID();reader=UUID.randomUUID();space=UUID.randomUUID();personal=UUID.randomUUID();
        for(UUID id:List.of(owner,reader))db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",id,id+"@example.test","合成计算测试",passwords.encode("synthetic-table-password"));
        db.update("INSERT INTO tenants(id,name) VALUES (?,'合成计算企业')",tenant);
        for(UUID id:List.of(owner,reader))db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,id);
        db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'共享底表','SHARED'),(?,?,?,'个人底表','PERSONAL')",space,tenant,owner,personal,tenant,owner);
        db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true),(?,?,?,false)",tenant,space,owner,tenant,space,reader);
    }
    @AfterEach void cleanup(){db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);db.update("UPDATE knowledge_runs SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);}
    void denied(int status,Runnable action){assertEquals(status,assertThrows(IdentityException.class,action::run).status);}
    byte[] workbook(String amount,boolean formula){
        String ns="http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        var files=new LinkedHashMap<String,String>();
        files.put("xl/workbook.xml","<workbook xmlns='"+ns+"' xmlns:r='http://schemas.openxmlformats.org/officeDocument/2006/relationships'><sheets><sheet name='经营' sheetId='1' r:id='rId1'/></sheets></workbook>");
        files.put("xl/_rels/workbook.xml.rels","<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'><Relationship Id='rId1' Target='worksheets/sheet1.xml'/></Relationships>");
        String[][] data={{"期间","门店","金额"},{"前期","甲","0.10"},{"前期","甲","0.20"},{"本期","甲",amount},{"前期","乙","0.40"},{"本期","乙","0.50"}};
        StringBuilder sheet=new StringBuilder("<worksheet xmlns='"+ns+"'><sheetData>");
        for(int r=0;r<data.length;r++){sheet.append("<row r='").append(r+1).append("'>");for(int c=0;c<3;c++){String ref=""+(char)('A'+c)+(r+1);if(r>0&&c==2)sheet.append("<c r='").append(ref).append("'>").append(formula&&r==3?"<f>1+1</f>":"").append("<v>").append(data[r][c]).append("</v></c>");else sheet.append("<c r='").append(ref).append("' t='inlineStr'><is><t>").append(data[r][c]).append("</t></is></c>");}sheet.append("</row>");}
        files.put("xl/worksheets/sheet1.xml",sheet.append("</sheetData></worksheet>").toString());
        try(var out=new ByteArrayOutputStream();var zip=new ZipOutputStream(out)){for(var e:files.entrySet()){zip.putNextEntry(new ZipEntry(e.getKey()));zip.write(e.getValue().getBytes(StandardCharsets.UTF_8));zip.closeEntry();}zip.finish();return out.toByteArray();}catch(Exception e){throw new RuntimeException(e);}
    }
    UUID upload(UUID location,UUID material,Integer version,String amount,boolean formula){
        var m=materials.upload(owner,tenant,location,null,material,version,UUID.randomUUID(),new MockMultipartFile("file","经营.xlsx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",workbook(amount,formula)));
        var parse=knowledge.claim();knowledge.finish(parse,new DocumentParser.Result("synthetic-table","READY",List.of(),List.of(new DocumentParser.Fragment("经营 A1:C6","经营期间门店金额 A1:C6，金额单位为元，前期与本期为合成完整期间","TABLE"))));return m.id();
    }
    ConversationService.Job start(UUID location){conversations.submit(owner,tenant,null,location,UUID.randomUUID(),"计算经营对比","AGENT");var j=conversations.claim();agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("search_sources","compare_table","deliver_briefing")));return j;}
    UUID grant(ConversationService.Job j){agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"search_sources","STARTED"));UUID id=agents.search(j.id(),j.token(),"经营").getFirst().id();agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"search_sources","succeeded"));agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(2,"compare_table","STARTED"));return id;}
    TableCalculationService.Request request(UUID id){return new TableCalculationService.Request(id,"经营","A1:C6","B","A","C","前期","本期");}
    int artifacts(ConversationService.Job j){return db.queryForObject("SELECT count(*) FROM conversation_artifacts WHERE task_id=?",Integer.class,j.id());}
    void finish(ConversationService.Job j,UUID source){agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(2,"compare_table","succeeded"));agents.finish(j,new AgentResult("1.5","0.12.2",j.id(),j.token(),"AGENT","live","synthetic-recipe","计算已完成",List.of(source),List.of(new AgentResult.Tool("s","search_sources","succeeded"),new AgentResult.Tool("c","compare_table","succeeded")),List.of(),3,null,List.of(),List.of(),List.of(),"COMPLETE",null));}

    @Test void exactPinnedVersionHasIdempotentPrivateReceiptAndRemainsDownloadableOnlyAfterFinish(){
        UUID material=upload(space,null,null,"0.60",false);var j=start(space);UUID source=grant(j);
        assertEquals("1.0",agents.check(j.id(),j.token()).get("tableComparisonVersion"));
        upload(space,material,1,"999",false);
        var result=agents.compareTable(j.id(),j.token(),request(source));var tree=json.valueToTree(result);
        assertEquals("COMPUTED",tree.get("status").asText());assertEquals(1,tree.get("source").get("version").asInt());
        var row=tree.get("calculation").get("rows").get(0);assertEquals("0.30",row.get("baseline").asText());assertEquals("0.60",row.get("current").asText());assertEquals("100.00",row.get("changePercent").asText());assertEquals(2,row.get("baselineRank").asInt());assertEquals(1,row.get("currentRank").asInt());
        assertEquals(result,agents.compareTable(j.id(),j.token(),request(source)));assertEquals(1,artifacts(j));
        UUID artifact=UUID.fromString(tree.get("artifact").get("id").asText());denied(404,()->agents.download(owner,tenant,j.conversation(),j.id(),artifact));
        finish(j,source);var downloaded=agents.download(owner,tenant,j.conversation(),j.id(),artifact);var receipt=json.readTree(downloaded.bytes());
        assertEquals(5,receipt.get("calculation").get("inputs").size());assertEquals(receipt.get("source").get("sha256").asText(),receipt.get("calculation").get("inputSha256").asText());
        denied(404,()->agents.download(reader,tenant,j.conversation(),j.id(),artifact));
        db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);denied(404,()->agents.download(owner,tenant,j.conversation(),j.id(),artifact));
    }
    @Test void sourceAndCapabilityMustBelongToCurrentSpaceAndAttemptAndToolMustBeStarted(){
        upload(space,null,null,"0.60",false);UUID source=knowledge.search(owner,tenant,space,"经营",0,10).items().getFirst().id();var j=start(personal);
        denied(403,()->agents.compareTable(j.id(),j.token(),request(source)));agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"compare_table","STARTED"));denied(403,()->agents.compareTable(j.id(),j.token(),request(source)));
        assertEquals(0,artifacts(j));db.update("UPDATE conversation_tasks SET lease_until=now()-interval '1 second' WHERE id=?",j.id());denied(403,()->agents.compareTable(j.id(),j.token(),request(source)));
    }
    @Test void twoStartedComparisonCallsDoNotInvalidateTheirSharedAttempt(){
        upload(personal,null,null,"0.60",false);var j=start(personal);UUID source=grant(j);agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(3,"compare_table","STARTED"));
        assertEquals("COMPUTED",agents.compareTable(j.id(),j.token(),request(source)).get("status"));assertEquals(1,artifacts(j));
    }
    @Test void calculationFailureNeverCreatesReceipt(){
        upload(personal,null,null,"0.60",true);var j=start(personal);UUID source=grant(j);var result=agents.compareTable(j.id(),j.token(),request(source));assertEquals("FAILED",result.get("status"));assertEquals("FORMULA_NOT_SUPPORTED:C4",result.get("code"));assertEquals(0,artifacts(j));
    }
    @Test void cancellationWhileWorkerRunsCannotPublishItsResult(){
        upload(personal,null,null,"0.60",false);var j=start(personal);UUID source=grant(j);
        doAnswer(call->{var result=call.callRealMethod();conversations.action(owner,tenant,j.conversation(),j.id(),UUID.randomUUID(),1,"CANCEL");return result;}).when(calculator).calculate(any(),any());
        denied(403,()->agents.compareTable(j.id(),j.token(),request(source)));assertEquals(0,artifacts(j));
    }
    @Test void revocationWhileWorkerRunsCannotPublishItsResult(){
        upload(space,null,null,"0.60",false);var j=start(space);UUID source=grant(j);
        doAnswer(call->{var result=call.callRealMethod();db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);return result;}).when(calculator).calculate(any(),any());
        denied(404,()->agents.compareTable(j.id(),j.token(),request(source)));assertEquals(0,artifacts(j));
    }
    @Test void callbackIsNoStoreAttemptBoundedAndRejectsPathsAndForgedIdentity() throws Exception{
        upload(personal,null,null,"0.60",false);var j=start(personal);UUID source=grant(j);var http=HttpClient.newHttpClient();var uri=URI.create("http://127.0.0.1:"+port+"/internal/v1/agent-access/"+j.id()+"/compare-table");
        for(UUID token:List.of(UUID.randomUUID(),j.token())){var r=http.send(HttpRequest.newBuilder(uri).header("Authorization","Bearer "+token).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(request(source)))).build(),HttpResponse.BodyHandlers.ofString());assertEquals(token.equals(j.token())?200:403,r.statusCode());if(r.statusCode()==200)assertTrue(r.headers().firstValue("cache-control").orElseThrow().contains("no-store"));}
        String forged=json.writeValueAsString(request(source)).replace("}",",\"path\":\"/etc/private\"}");var r=http.send(HttpRequest.newBuilder(uri).header("Authorization","Bearer "+j.token()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(forged)).build(),HttpResponse.BodyHandlers.ofString());assertEquals(400,r.statusCode());
    }
    BriefingContentService.Request cardRequest(UUID id){return new BriefingContentService.Request(id,"两期收款变化与门店表现","本期甲店收款增加，已按相同范围计算并核对排名。",List.of("甲店本期收款为零点六元，比前期零点三元增长百分之一百。","数据仅支持观察已发生的收款变化，具体经营原因仍需进一步核实。"));}
    UUID computed(ConversationService.Job j,UUID source){var result=agents.compareTable(j.id(),j.token(),request(source));agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(2,"compare_table","succeeded"));agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(3,"deliver_briefing","STARTED"));return UUID.fromString(json.valueToTree(result).path("artifact").path("id").asText());}
    void finishCard(ConversationService.Job j,UUID source){agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(3,"deliver_briefing","succeeded"));agents.finish(j,new AgentResult("1.5","0.13.0",j.id(),j.token(),"AGENT","live","synthetic-recipe","画报已生成。",List.of(source),List.of(new AgentResult.Tool("s","search_sources","succeeded"),new AgentResult.Tool("c","compare_table","succeeded"),new AgentResult.Tool("b","deliver_briefing","succeeded")),List.of(),4,null,List.of(),List.of(),List.of(),"COMPLETE",null));}
    @Test void generatedCardIsIndependentFromReplyWithExactChartAndPrivateVersionedRead(){
        upload(space,null,null,"0.60",false);var j=start(space);UUID source=grant(j),calculation=computed(j,source);var request=cardRequest(calculation);
        var made=agents.deliverBriefing(j.id(),j.token(),request);assertEquals("PREPARED",made.get("status"));assertEquals(made,agents.deliverBriefing(j.id(),j.token(),request));assertEquals(2,artifacts(j));
        assertTrue(recommendations.list(owner,tenant,null,0,20,null,true).items().isEmpty());denied(409,()->agents.briefing(owner,tenant,j.conversation(),j.id(),1,1));
        finishCard(j,source);var task=conversations.taskDetail(owner,tenant,j.conversation(),j.id()).tasks().getFirst();var doc=agents.briefing(owner,tenant,j.conversation(),j.id(),task.revision(),1);
        assertEquals(request.title(),doc.content().title());assertEquals("0.60",doc.content().chart().rows().getFirst().current());assertEquals(2,doc.content().chart().rows().getFirst().baselineRank());assertEquals(1,doc.content().chart().rows().getFirst().currentRank());assertEquals(calculation,doc.content().calculationArtifactId());
        var page=recommendations.list(owner,tenant,null,0,20,null,true);assertEquals(1,page.items().size());assertEquals(request.title(),page.items().getFirst().content().title());assertEquals(doc,page.items().getFirst().briefing());assertNotEquals(task.reply(),page.items().getFirst().content().excerpt());
        assertEquals(doc,briefingPage.list(owner,tenant,null,"LATEST",null,"Asia/Shanghai",0,20,true).items().getFirst().briefing());
        denied(404,()->agents.briefing(reader,tenant,j.conversation(),j.id(),task.revision(),1));denied(409,()->agents.briefing(owner,tenant,j.conversation(),j.id(),task.revision()+1,1));
        db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);assertTrue(recommendations.list(owner,tenant,null,0,20,null,true).items().isEmpty());denied(404,()->agents.briefing(owner,tenant,j.conversation(),j.id(),task.revision(),1));
    }
    @Test void unsupportedIncompleteOrForgedDeliveriesCannotBecomeCards(){
        upload(personal,null,null,"0.60",false);var j=start(personal);UUID source=grant(j),calc=computed(j,source);
        denied(403,()->agents.deliverBriefing(j.id(),j.token(),cardRequest(UUID.randomUUID())));
        denied(422,()->agents.deliverBriefing(j.id(),j.token(),new BriefingContentService.Request(calc,"测试不完整画报","这是一段未说完整的分析结论但是没有结束",cardRequest(calc).analysis())));
        assertEquals(1,artifacts(j));
        // The final reply alone, or a claimed succeeded tool receipt, cannot fabricate a persisted card.
        denied(502,()->finishCard(j,source));assertTrue(recommendations.list(owner,tenant,null,0,20,null,true).items().isEmpty());
    }
    @Test void plainSuccessfulConversationDoesNotEnterGeneratedFeed(){
        upload(personal,null,null,"0.60",false);var j=start(personal);UUID source=grant(j);agents.compareTable(j.id(),j.token(),request(source));finish(j,source);
        assertEquals(1,recommendations.list(owner,tenant,null,0,20,null).items().size());assertTrue(recommendations.list(owner,tenant,null,0,20,null,true).items().isEmpty());assertTrue(briefingPage.list(owner,tenant,null,"LATEST",null,"Asia/Shanghai",0,20,true).items().isEmpty());
    }
    @Test void cancellationAfterPreparingCardNeverMakesItVisible(){
        upload(personal,null,null,"0.60",false);var j=start(personal);UUID source=grant(j),calc=computed(j,source);agents.deliverBriefing(j.id(),j.token(),cardRequest(calc));
        conversations.action(owner,tenant,j.conversation(),j.id(),UUID.randomUUID(),1,"CANCEL");assertTrue(recommendations.list(owner,tenant,null,0,20,null,true).items().isEmpty());denied(403,()->agents.deliverBriefing(j.id(),j.token(),cardRequest(calc)));
    }

    @Test void cardDiscussionIsPreparedOnceAndUsesCardWithoutGenerationHistory(){
        upload(space,null,null,"0.60",false);var j=start(space);UUID source=grant(j),calc=computed(j,source);agents.deliverBriefing(j.id(),j.token(),cardRequest(calc));finishCard(j,source);
        var original=conversations.taskDetail(owner,tenant,j.conversation(),j.id()).tasks().getFirst();
        var discussion=agents.discussion(owner,tenant,j.conversation(),j.id(),original.revision(),original.attempt());
        assertNull(discussion.conversationId());assertEquals(cardRequest(calc).title(),discussion.title());assertEquals(j.id(),discussion.briefingContext().taskId());
        assertNull(agents.discussion(owner,tenant,j.conversation(),j.id(),original.revision(),original.attempt()).conversationId());
        denied(404,()->agents.discussion(reader,tenant,j.conversation(),j.id(),original.revision(),original.attempt()));
        denied(409,()->agents.discussion(owner,tenant,j.conversation(),j.id(),original.revision()+1,original.attempt()));
        var sent=agents.sendDiscussion(owner,tenant,null,discussion.briefingContext(),space,UUID.randomUUID(),"解释这张画报","AGENT",null,List.of(),null);var next=conversations.claim();
        assertEquals(sent.conversation().id(),agents.discussion(owner,tenant,j.conversation(),j.id(),original.revision(),original.attempt()).conversationId());
        var request=new com.dreamcore.workspace.context.TaskContextService.Request("bootstrap",null,null,null,null,null,null,null,null,null,null);
        var result=json.valueToTree(context.context(next.id(),next.token(),request)).path("result").path("latestBriefing");
        assertEquals(cardRequest(calc).title(),result.path("title").asText());assertEquals("0.60",result.path("chart").path("rows").get(0).path("current").asText());
        var history=new com.dreamcore.workspace.context.TaskContextService.Request("history",null,"",0,null,null,null,null,null,null,null);
        assertEquals(0,json.valueToTree(context.context(next.id(),next.token(),history)).path("result").path("items").size());
        assertEquals(1,conversations.detail(owner,tenant,j.conversation(),0,20).tasks().size());
        db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
        assertThrows(IdentityException.class,()->context.context(next.id(),next.token(),request));
        assertThrows(IdentityException.class,()->conversations.detail(owner,tenant,sent.conversation().id(),0,20));
    }

    @Test void continuationReceivesActualGeneratedContentAndTracksSourceRevocation(){
        upload(space,null,null,"0.60",false);var j=start(space);UUID source=grant(j),calc=computed(j,source);agents.deliverBriefing(j.id(),j.token(),cardRequest(calc));finishCard(j,source);
        conversations.submit(owner,tenant,j.conversation(),space,UUID.randomUUID(),"继续解释画报变化","AGENT");var next=conversations.claim();
        var request=new com.dreamcore.workspace.context.TaskContextService.Request("bootstrap",null,null,null,null,null,null,null,null,null,null);
        var result=json.valueToTree(context.context(next.id(),next.token(),request)).path("result").path("latestBriefing");
        assertEquals(cardRequest(calc).title(),result.path("title").asText());assertEquals("0.60",result.path("chart").path("rows").get(0).path("current").asText());
        assertEquals(1,db.queryForObject("SELECT count(*) FROM task_context_materials WHERE task_id=?",Integer.class,next.id()));
        assertEquals(1,recommendations.list(owner,tenant,null,0,20,null,true).items().size());
        db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
        assertThrows(IdentityException.class,()->context.context(next.id(),next.token(),request));
    }

    @Test void retryCanCreateNewBriefingButCannotReusePreviousAttemptCalculation(){
        upload(personal,null,null,"0.60",false);var first=start(personal);UUID source=grant(first),oldCalc=computed(first,source);agents.deliverBriefing(first.id(),first.token(),cardRequest(oldCalc));
        conversations.action(owner,tenant,first.conversation(),first.id(),UUID.randomUUID(),1,"CANCEL");
        int rev=conversations.taskDetail(owner,tenant,first.conversation(),first.id()).tasks().getFirst().revision();
        conversations.action(owner,tenant,first.conversation(),first.id(),UUID.randomUUID(),rev,"RETRY");var next=conversations.claim();agents.openExecution(next.id(),next.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("search_sources","compare_table","deliver_briefing")));
        UUID newSource=grant(next),newCalc=computed(next,newSource);denied(403,()->agents.deliverBriefing(next.id(),next.token(),cardRequest(oldCalc)));
        assertEquals("PREPARED",agents.deliverBriefing(next.id(),next.token(),cardRequest(newCalc)).get("status"));finishCard(next,newSource);
        assertEquals(1,recommendations.list(owner,tenant,null,0,20,null,true).items().size());
    }

}
