package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.*;
import com.dreamcore.workspace.knowledge.*;
import org.springframework.mock.web.MockMultipartFile;
import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.zip.*;
import java.io.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=live","dreamcore.tasks.artifact-transfer-enabled=true","dreamcore.tasks.ppt-renderer-enabled=true","dreamcore.tasks.initial-delay-ms=3600000","dreamcore.knowledge.enabled=true","dreamcore.knowledge.initial-delay-ms=3600000"})
@org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable(named="DREAMCORE_PPT_ACCEPTANCE",matches="synthetic|live")
class PresentationAcceptanceTest {
 @Autowired PresentationWorkflow presentations;@Autowired ConversationService conversations;@Autowired AgentTaskService agents;@Autowired ArtifactTransferService transfers;@Autowired JdbcTemplate db;@Autowired MaterialService materials;@Autowired KnowledgeService knowledge;@Autowired PasswordEncoder passwords;@LocalServerPort int port;
 UUID tenant,owner,other,space;JsonMapper json=new JsonMapper();
 @BeforeEach void setup(){tenant=UUID.randomUUID();owner=UUID.randomUUID();other=UUID.randomUUID();space=UUID.randomUUID();for(UUID u:List.of(owner,other))db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",u,u+"@example.test","合成PPT测试",passwords.encode("synthetic-presentation-test"));db.update("INSERT INTO tenants(id,name) VALUES (?,'合成PPT企业')",tenant);for(UUID u:List.of(owner,other))db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,u);db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'合成共享空间','SHARED')",space,tenant,owner);db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true),(?,?,?,false)",tenant,space,owner,tenant,space,other);}
 @AfterEach void stop(){db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('RUNNING','QUEUED')",tenant);db.update("UPDATE knowledge_runs SET status='CANCELLED' WHERE tenant_id=? AND status IN ('RUNNING','QUEUED')",tenant);}
 Path root(){Path p=Path.of("").toAbsolutePath();return p.endsWith("api")?p.getParent().getParent():p;}
 AgentResult execute(ConversationService.Job job,UUID source,int pages,String theme,Path output)throws Exception{
  Path input=output.resolve("attempt-"+job.token()+".json"),result=output.resolve("result-"+job.token()+".json");
  var request=new LinkedHashMap<String,Object>();request.put("platformBaseUrl","http://127.0.0.1:"+port);request.put("taskId",job.id());request.put("attemptId",job.token());request.put("prompt",job.prompt());request.put("sourceId",source);request.put("pages",pages);request.put("theme",theme);
  Files.writeString(input,json.writeValueAsString(request));Files.setPosixFilePermissions(input,java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));
  try{
   var pb=new ProcessBuilder("python3",root().resolve("scripts/local/ppt_acceptance.py").toString(),"attempt","--mode",System.getenv("DREAMCORE_PPT_ACCEPTANCE"),"--input",input.toString(),"--output",result.toString(),"--config",System.getenv("DREAMCORE_PPT_MODEL_CONFIG"));
   pb.directory(root().toFile()).redirectErrorStream(true).redirectOutput(output.resolve("attempt.log").toFile());var process=pb.start();
   if(!process.waitFor(75,TimeUnit.SECONDS)){process.destroyForcibly();fail("PPT acceptance attempt timed out");}
   assertEquals(0,process.exitValue(),"Engine attempt failed; supplier output is not included.");
   return json.readValue(Files.readString(result),AgentResult.class);
  }finally{Files.deleteIfExists(input);Files.deleteIfExists(result);}
 }
 @Test void threeIsolatedCases()throws Exception{
  Path output=Path.of(System.getenv("DREAMCORE_PPT_ACCEPTANCE_OUTPUT"));var reports=new ArrayList<Map<String,Object>>();
  String source="合成季度经营数据：一月营收120万元、客户40；二月营收150万元、客户45；三月营收180万元、客户52。以上均为演练数据。资料没有成本、利润、续费率或客户满意度数据，不能推导这些指标。";
  try{
   boolean sourceUploaded=false;
   for(int scenario=0;scenario<3;scenario++){
    String name=List.of("proposal-4","source-review-6","data-analysis-8").get(scenario);if(System.getenv("DREAMCORE_PPT_ACCEPTANCE_CASE")!=null&&!name.equals(System.getenv("DREAMCORE_PPT_ACCEPTANCE_CASE")))continue;int pages=4+scenario*2;String theme=scenario==1?"ink":"ocean";Path caseDir=Files.createDirectory(output.resolve(name));
    if(scenario>0&&!sourceUploaded){sourceUploaded=true;materials.upload(owner,tenant,space,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","revenue.txt","text/plain",source.getBytes(java.nio.charset.StandardCharsets.UTF_8)));var parse=knowledge.claim();knowledge.finish(parse,new DocumentParser.Result("synthetic-fixture","READY",List.of(),List.of(new DocumentParser.Fragment("L1",source,"TEXT"))));}
    String prompt=scenario==0?"这是合成验收。面向十人运营团队，制作四页知识分享会实施方案PPT。仅基于本请求，不检索资料；方案建议与待确认事项分开，不编造既有业务数据。":"这是合成验收。读取营收资料，面向业务负责人制作"+pages+"页季度复盘PPT；包含原生明细表和原生营收柱状图，保留资料里的月份、营收和单位。不要编造成本、利润或其他未提供指标；建议与资料事实分开。";
    var detail=presentations.submit(owner,tenant,null,new ConversationController.Send(UUID.randomUUID(),space,prompt,"AGENT",null,List.of(),"AUTHORIZED_LIBRARY",null,new PresentationWorkflow.Options(pages,theme)));
    var job=conversations.claim();assertNotNull(job);assertEquals(detail.tasks().getLast().id(),job.id());UUID sourceId=scenario==0?null:agents.search(job.id(),job.token(),"营收").getFirst().id();
    var report=new LinkedHashMap<String,Object>();reports.add(report);report.put("case",name);report.put("status","started");
    var draftResult=execute(job,sourceId,pages,theme,caseDir);report.put("modelName",draftResult.modelName());report.put("draftTools",draftResult.tools());report.put("draftOutcome",draftResult.outcome());report.put("draftModelCalls",draftResult.modelCalls());report.put("draftUsage",draftResult.usage());
    assertEquals("WAITING_INPUT",draftResult.outcome());assertTrue(draftResult.artifacts().isEmpty());agents.finish(job,draftResult);
    var draft=presentations.read(owner,tenant,job.conversation(),job.id());Files.writeString(caseDir.resolve("draft.json"),json.writeValueAsString(draft));
    var spec=json.readTree(json.writeValueAsString(draft.get("spec")));assertEquals(pages,spec.get("slides").size());assertEquals(theme,spec.get("theme").asString());
    if(scenario>0){assertTrue(draftResult.sourceIds().contains(sourceId));boolean table=false,chart=false;for(var slide:spec.get("slides")){table|="table".equals(slide.get("kind").asString());chart|="chart".equals(slide.get("kind").asString());}assertTrue(table&&chart,"Source scenarios require native table and chart");}
    if(scenario>0&&"live".equals(System.getenv("DREAMCORE_PPT_ACCEPTANCE"))){
     var visibleFields=new StringBuilder();
     for(var slide:spec.get("slides"))for(String key:List.of("title","subtitle","bullets","rows","headers","labels","values","series","unit"))if(slide.has(key))visibleFields.append(slide.get(key)).append(' ');
     String visible=visibleFields.toString();
     assertFalse(java.util.regex.Pattern.compile("20[0-9]{2}年").matcher(visible).find(),"Fixture supplies no year; invented year blocks confirmation");
     assertFalse(visible.contains("137"),"Monthly customer counts do not establish a quarterly distinct total");
     assertTrue(visible.contains("演练")||visible.contains("合成"),"Preserve synthetic-data label");
    }
    var edits=new ArrayList<PresentationWorkflow.Edit>();for(int n=0;n<pages;n++)edits.add(new PresentationWorkflow.Edit(n,n==0?"验收确认标题":spec.get("slides").get(n).get("title").asString()));
    var waiting=conversations.detail(owner,tenant,job.conversation(),0,20).tasks().getLast();
    presentations.confirm(owner,tenant,job.conversation(),job.id(),new PresentationWorkflow.Confirm(UUID.randomUUID(),waiting.revision(),(Integer)draft.get("revision"),spec.get("title").asString(),theme,edits));
    var confirmed=presentations.read(owner,tenant,job.conversation(),job.id());var next=conversations.claim();assertNotNull(next);assertEquals(job.id(),next.id());
    var rendered=execute(next,sourceId,pages,theme,caseDir);report.put("renderTools",rendered.tools());report.put("renderArtifactCount",rendered.artifacts().size());report.put("renderOutcome",rendered.outcome());report.put("renderModelCalls",rendered.modelCalls());report.put("renderUsage",rendered.usage());assertEquals("COMPLETE",rendered.outcome());assertEquals(2,rendered.artifacts().size());agents.finish(next,rendered);
    for(var artifact:rendered.artifacts()){
     var bytes=agents.download(owner,tenant,next.conversation(),next.id(),artifact.uploadId()).bytes();Files.write(caseDir.resolve(artifact.name()),bytes);
     if(artifact.name().endsWith(".json")){var content=json.readTree(bytes);var saved=json.valueToTree(confirmed.get("spec"));for(String key:List.of("title","theme","slides"))assertEquals(saved.get(key),content.get(key),"Rendered source must match confirmed draft");}
    }
    report.put("status","pipeline_passed");report.put("contentReview","pending");report.put("layoutReview","pending");
   }
  }finally{Files.writeString(output.resolve("report.json"),json.writeValueAsString(Map.of("mode",System.getenv("DREAMCORE_PPT_ACCEPTANCE"),"modelWasReal","live".equals(System.getenv("DREAMCORE_PPT_ACCEPTANCE")),"cases",reports,"qualityAccepted",false)));}
 }
}
