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
class PresentationIntegrationTest {
 @Autowired PresentationWorkflow presentations;@Autowired ConversationService conversations;@Autowired AgentTaskService agents;@Autowired ArtifactTransferService transfers;@Autowired JdbcTemplate db;@Autowired MaterialService materials;@Autowired KnowledgeService knowledge;@Autowired PasswordEncoder passwords;@LocalServerPort int port;
 UUID tenant,owner,other,space;JsonMapper json=new JsonMapper();
 @BeforeEach void setup(){tenant=UUID.randomUUID();owner=UUID.randomUUID();other=UUID.randomUUID();space=UUID.randomUUID();for(UUID u:List.of(owner,other))db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",u,u+"@example.test","合成PPT测试",passwords.encode("synthetic-presentation-test"));db.update("INSERT INTO tenants(id,name) VALUES (?,'合成PPT企业')",tenant);for(UUID u:List.of(owner,other))db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,u);db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'合成共享空间','SHARED')",space,tenant,owner);db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true),(?,?,?,false)",tenant,space,owner,tenant,space,other);}
 @AfterEach void stop(){db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('RUNNING','QUEUED')",tenant);db.update("UPDATE knowledge_runs SET status='CANCELLED' WHERE tenant_id=? AND status IN ('RUNNING','QUEUED')",tenant);}
 ConversationService.Job job(){conversations.submit(owner,tenant,null,space,UUID.randomUUID(),"根据营收资料生成六页PPT","AGENT");var j=conversations.claim();assertEquals(tenant,j.tenant());return j;}
 void denied(int code,Runnable r){assertEquals(code,assertThrows(IdentityException.class,r::run).status);}
 @Test void realRendererToRealPlatformProducesDownloadableEditablePptx() throws Exception {
  String source="合成季度经营数据：一月营收120万元、客户40；二月营收150万元、客户45；三月营收180万元、客户52。重点客户试点已完成，进入续约讨论。";
  materials.upload(owner,tenant,space,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","revenue.txt","text/plain",source.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
  var parse=knowledge.claim();knowledge.finish(parse,new DocumentParser.Result("synthetic","READY",List.of(),List.of(new DocumentParser.Fragment("L1",source,"TEXT"))));
  var j=job();UUID sourceId=agents.search(j.id(),j.token(),"营收").getFirst().id();
  assertEquals("1.0",agents.check(j.id(),j.token()).get("presentationRendererVersion"));
  Path root=Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();
  Path resultFile=Files.createTempFile("dreamcore-ppt-result-",".json"),log=Files.createTempFile("dreamcore-ppt-engine-",".log");
  try{
   var process=new ProcessBuilder("node",root.resolve("engine/tests/fixtures/presentation-platform.mjs").toString(),"http://127.0.0.1:"+port,j.id().toString(),j.token().toString(),sourceId.toString(),resultFile.toString()).directory(root.toFile()).redirectErrorStream(true).redirectOutput(log.toFile()).start();
   if(!process.waitFor(60,TimeUnit.SECONDS)){process.destroyForcibly();fail("PPT integration timed out");}
   assertEquals(0,process.exitValue(),Files.readString(log));
   var draftResult=json.readValue(Files.readString(resultFile),AgentResult.class);
   assertEquals("WAITING_INPUT",draftResult.outcome());assertTrue(draftResult.artifacts().isEmpty());agents.finish(j,draftResult);
   var waiting=conversations.detail(owner,tenant,j.conversation(),0,20).tasks().getLast();
   var draft=presentations.read(owner,tenant,j.conversation(),j.id());assertEquals("DRAFT",draft.get("state"));
   denied(404,()->presentations.read(other,tenant,j.conversation(),j.id()));
   denied(409,()->conversations.action(owner,tenant,j.conversation(),j.id(),UUID.randomUUID(),waiting.revision(),"RESUME","跳过确认直接生成"));
   var spec=json.readTree(json.writeValueAsString(draft.get("spec")));var edits=new ArrayList<PresentationWorkflow.Edit>();
   for(int n=0;n<6;n++)edits.add(new PresentationWorkflow.Edit(n,n==0?"用户确认后的标题":spec.get("slides").get(n).get("title").asString()));
   var confirmation=new PresentationWorkflow.Confirm(UUID.randomUUID(),waiting.revision(),(Integer)draft.get("revision"),"用户确认的演示","ink",edits);
   denied(404,()->presentations.confirm(other,tenant,j.conversation(),j.id(),confirmation));
   presentations.confirm(owner,tenant,j.conversation(),j.id(),confirmation);
   presentations.confirm(owner,tenant,j.conversation(),j.id(),confirmation); // Exact replay must not enqueue twice.
   assertEquals("CONFIRMED",presentations.read(owner,tenant,j.conversation(),j.id()).get("state"));
   var renderJob=conversations.claim();assertEquals(j.id(),renderJob.id());
   var rendering=new ProcessBuilder("node",root.resolve("engine/tests/fixtures/presentation-platform.mjs").toString(),"http://127.0.0.1:"+port,renderJob.id().toString(),renderJob.token().toString(),sourceId.toString(),resultFile.toString()).directory(root.toFile()).redirectErrorStream(true).redirectOutput(log.toFile()).start();
   if(!rendering.waitFor(60,TimeUnit.SECONDS)){rendering.destroyForcibly();fail("confirmed rendering timed out");}
   assertEquals(0,rendering.exitValue(),Files.readString(log));
   var result=json.readValue(Files.readString(resultFile),AgentResult.class);assertEquals("COMPLETE",result.outcome(),Files.readString(log)+Files.readString(resultFile));assertEquals(2,result.artifacts().size());assertTrue(result.tools().stream().anyMatch(t->t.name().equals("render_presentation")&&t.status().equals("succeeded")));assertTrue(result.sourceIds().contains(sourceId));
   UUID id=result.artifacts().stream().filter(a->a.name().equals("presentation.pptx")).findFirst().orElseThrow().uploadId();
   denied(404,()->agents.download(owner,tenant,renderJob.conversation(),renderJob.id(),id));agents.finish(renderJob,result);
   byte[] bytes=agents.download(owner,tenant,renderJob.conversation(),renderJob.id(),id).bytes();assertTrue(bytes.length>10000);
   Map<String,String> parts=new HashMap<>();try(var zip=new ZipInputStream(new ByteArrayInputStream(bytes))){ZipEntry entry;while((entry=zip.getNextEntry())!=null){byte[] part=zip.readAllBytes();if(entry.getName().endsWith(".xml"))parts.put(entry.getName(),new String(part,java.nio.charset.StandardCharsets.UTF_8));}}
   assertTrue(parts.get("ppt/slides/slide1.xml").contains("用户确认后的标题"));assertEquals(6,parts.keySet().stream().filter(n->n.matches("ppt/slides/slide[0-9]+.xml")).count());assertTrue(parts.get("ppt/slides/slide3.xml").contains("<a:tbl>"));assertTrue(parts.get("ppt/slides/slide4.xml").contains("<c:chart"));assertTrue(parts.get("ppt/charts/chart1.xml").contains(">180<"));
   denied(404,()->agents.download(other,tenant,renderJob.conversation(),renderJob.id(),id));
   var http=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();String base="http://127.0.0.1:"+port;
   var csrf=json.readTree(http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());
   assertEquals(200,http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/login")).header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("email",owner+"@example.test","password","synthetic-presentation-test")))).build(),HttpResponse.BodyHandlers.ofString()).statusCode());
   var confirmCsrf=json.readTree(http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());
   var replay=http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/tenants/"+tenant+"/conversations/"+j.conversation()+"/tasks/"+j.id()+"/presentation/confirm")).header(confirmCsrf.get("headerName").asString(),confirmCsrf.get("token").asString()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(confirmation))).build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,replay.statusCode(),replay.body());
   var download=http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/tenants/"+tenant+"/conversations/"+renderJob.conversation()+"/tasks/"+renderJob.id()+"/artifacts/"+id)).GET().build(),HttpResponse.BodyHandlers.ofByteArray());assertEquals(200,download.statusCode());assertArrayEquals(bytes,download.body());assertTrue(download.headers().firstValue("content-disposition").orElseThrow().startsWith("attachment;"));
   Path output=root.resolve(".local/ppt-renderer");Files.createDirectories(output);Files.write(output.resolve("verified-presentation.pptx"),download.body());
   UUID content=result.artifacts().stream().filter(a->a.name().endsWith(".json")).findFirst().orElseThrow().uploadId();Files.write(output.resolve("verified-presentation-source.json"),agents.download(owner,tenant,renderJob.conversation(),renderJob.id(),content).bytes());
   db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);denied(404,()->agents.download(owner,tenant,renderJob.conversation(),renderJob.id(),id));
  }finally{Files.deleteIfExists(resultFile);Files.deleteIfExists(log);}
 }
 @Test void typedRendererDoesNotEnableLiveJavascriptAndNeedsSkillProof(){
  var j=job();denied(403,()->agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("run_javascript"))));
  agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("render_presentation")));agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"render_presentation","STARTED"));agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"render_presentation","succeeded"));
  var forged=new AgentResult("1.5","test",j.id(),j.token(),"AGENT","live","synthetic","不能伪造成功",List.of(),List.of(new AgentResult.Tool("render","render_presentation","succeeded")),List.of(),1,null,List.of(),List.of(),List.of(),"COMPLETE",null);denied(502,()->agents.finish(j,forged));
 }
 @Test void selectedSkillPersistsOptionsAndRejectsWrongOutlineOrUnconfirmedUpload(){
  UUID request=UUID.randomUUID();var options=new PresentationWorkflow.Options(2,"ink");
  var body=new ConversationController.Send(request,space,"合成演示主题","AGENT",null,List.of(),"AUTHORIZED_LIBRARY",null,options);
  var submitted=presentations.submit(owner,tenant,null,body);UUID task=submitted.tasks().getLast().id();
  assertEquals(task,presentations.submit(owner,tenant,null,body).tasks().getLast().id());
  assertEquals(1,db.queryForObject("SELECT count(*) FROM conversation_tasks WHERE tenant_id=?",Integer.class,tenant));
  denied(409,()->presentations.submit(owner,tenant,null,new ConversationController.Send(request,space,"合成演示主题","AGENT",null,List.of(),"AUTHORIZED_LIBRARY",null,new PresentationWorkflow.Options(3,"ink"))));
  var j=conversations.claim();assertEquals(task,j.id());agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("render_presentation")));
  denied(403,()->transfers.prepare(j.id(),j.token(),new ArtifactTransferService.Prepare(UUID.randomUUID(),"presentation.pptx","application/vnd.openxmlformats-officedocument.presentationml.presentation",100,"a".repeat(64))));
  var slide=Map.<String,Object>of("kind","cover","title","内容","sourceIds",List.of());
  var spec=Map.<String,Object>of("title","合成演示","theme","ink","slides",List.of(slide,slide));
  denied(422,()->agents.proposePresentation(j.id(),j.token(),Map.of("title","合成演示","theme","ocean","slides",List.of(slide,slide))));
  denied(403,()->agents.proposePresentation(j.id(),j.token(),Map.of("title","合成演示","theme","ink","slides",List.of(Map.of("kind","cover","title","伪造引用","sourceIds",List.of(UUID.randomUUID().toString())),slide))));
  var invalid=new HashMap<>(spec);invalid.put("script","alert(1)");denied(400,()->agents.proposePresentation(j.id(),j.token(),invalid));
  agents.proposePresentation(j.id(),j.token(),spec);
  assertEquals("DRAFT",presentations.read(owner,tenant,j.conversation(),task).get("state"));
 }
 @Test void confirmationRejectsStaleRevisionDuplicatePagesAndRevokedMember(){
  var j=job();agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("render_presentation")));
  var slide=Map.<String,Object>of("kind","cover","title","内容","sourceIds",List.of());
  agents.proposePresentation(j.id(),j.token(),Map.of("title","合成演示","theme","ocean","slides",List.of(slide,slide)));
  db.update("UPDATE conversation_tasks SET status='WAITING_INPUT',lease_token=NULL,lease_until=NULL,revision=2 WHERE id=?",j.id());
  var edits=List.of(new PresentationWorkflow.Edit(1,"先展示第二页"),new PresentationWorkflow.Edit(0,"后展示第一页"));
  denied(409,()->presentations.confirm(owner,tenant,j.conversation(),j.id(),new PresentationWorkflow.Confirm(UUID.randomUUID(),1,1,"标题","ink",edits)));
  denied(400,()->presentations.confirm(owner,tenant,j.conversation(),j.id(),new PresentationWorkflow.Confirm(UUID.randomUUID(),2,1,"标题","ink",List.of(edits.getFirst(),edits.getFirst()))));
  assertEquals("DRAFT",presentations.read(owner,tenant,j.conversation(),j.id()).get("state"));
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
  denied(404,()->presentations.confirm(owner,tenant,j.conversation(),j.id(),new PresentationWorkflow.Confirm(UUID.randomUUID(),2,1,"标题","ink",edits)));
  assertEquals("DRAFT",db.queryForObject("SELECT state FROM conversation_presentations WHERE task_id=?",String.class,j.id()));
 }

}
