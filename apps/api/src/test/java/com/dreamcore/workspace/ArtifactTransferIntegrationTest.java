package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.*;
import java.net.*;
import java.net.http.*;
import java.security.MessageDigest;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.tasks.artifact-transfer-enabled=true","dreamcore.tasks.initial-delay-ms=3600000"})
class ArtifactTransferIntegrationTest {
 @Autowired ConversationService conversations;@Autowired AgentTaskService agents;@Autowired ArtifactTransferService transfers;@Autowired JdbcTemplate db;@LocalServerPort int port;
 UUID tenant,owner,other,space;JsonMapper json=new JsonMapper();
 @BeforeEach void setup(){tenant=UUID.randomUUID();owner=UUID.randomUUID();other=UUID.randomUUID();space=UUID.randomUUID();for(UUID u:List.of(owner,other))db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",u,u+"@example.test","合成成果测试","unused-synthetic-hash");db.update("INSERT INTO tenants(id,name) VALUES (?,'合成成果企业')",tenant);for(UUID u:List.of(owner,other))db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,u);db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'合成共享空间','SHARED')",space,tenant,owner);db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true),(?,?,?,false)",tenant,space,owner,tenant,space,other);}
 @AfterEach void stop(){db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('RUNNING','QUEUED')",tenant);}
 ConversationService.Job job(){conversations.submit(owner,tenant,null,space,UUID.randomUUID(),"生成合成成果","AGENT");var j=conversations.claim();assertEquals(tenant,j.tenant());agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("run_javascript")));agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"run_javascript","STARTED"));agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"run_javascript","succeeded"));return j;}
 void denied(int code,Runnable r){assertEquals(code,assertThrows(IdentityException.class,r::run).status);}
 String hash(byte[] bytes){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}catch(Exception e){throw new RuntimeException(e);}}
 ArtifactTransferService.Prepare prepare(byte[] b){return new ArtifactTransferService.Prepare(UUID.randomUUID(),"report.html","text/html",b.length,hash(b));}
 ArtifactTransferService.Chunk part(int offset,byte[] b){return new ArtifactTransferService.Chunk(offset,Base64.getEncoder().encodeToString(b));}
 AgentResult result(ConversationService.Job j,List<AgentResult.Artifact> files){return new AgentResult("1.5","0.11.0",j.id(),j.token(),"AGENT","verification","synthetic","合成成果已生成",List.of(),List.of(new AgentResult.Tool("code","run_javascript","succeeded")),files,1,null,List.of(),List.of(),List.of(),"COMPLETE",null);}
 UUID stage(ConversationService.Job j,byte[] bytes){var r=transfers.prepare(j.id(),j.token(),prepare(bytes));for(int o=0;o<bytes.length;o+=ArtifactTransferService.CHUNK_BYTES)transfers.chunk(j.id(),j.token(),r.uploadId(),part(o,Arrays.copyOfRange(bytes,o,Math.min(bytes.length,o+ArtifactTransferService.CHUNK_BYTES))));transfers.complete(j.id(),j.token(),r.uploadId());return r.uploadId();}
 @Test void largeFilePublishesAtomicallyAndKeepsOwnerOnlyDownload(){
  var j=job();byte[] bytes=new byte[600000];Arrays.fill(bytes,(byte)42);UUID id=stage(j,bytes);
  denied(404,()->agents.download(owner,tenant,j.conversation(),j.id(),id));
  denied(502,()->agents.finish(j,result(j,List.of(new AgentResult.Artifact("report.html",hash(bytes),"bad",id)))));
  assertEquals("READY",db.queryForObject("SELECT state FROM conversation_artifact_transfers WHERE id=?",String.class,id));
  agents.finish(j,result(j,List.of(new AgentResult.Artifact("report.html",hash(bytes),null,id))));
  assertArrayEquals(bytes,agents.download(owner,tenant,j.conversation(),j.id(),id).bytes());
  denied(404,()->agents.download(other,tenant,j.conversation(),j.id(),id));denied(403,()->agents.download(owner,UUID.randomUUID(),j.conversation(),j.id(),id));
  assertEquals(0,db.queryForObject("SELECT octet_length(content) FROM conversation_artifact_transfers WHERE id=?",Integer.class,id));transfers.cleanup();assertArrayEquals(bytes,agents.download(owner,tenant,j.conversation(),j.id(),id).bytes());
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);denied(404,()->agents.download(owner,tenant,j.conversation(),j.id(),id));
 }
 @Test void retransmissionConflictIncompleteHashAndLegacyLimits(){
  var j=job();byte[] bytes="test".getBytes();var body=prepare(bytes);var r=transfers.prepare(j.id(),j.token(),body);assertEquals(r,transfers.prepare(j.id(),j.token(),body));
  denied(409,()->transfers.prepare(j.id(),j.token(),new ArtifactTransferService.Prepare(body.clientKey(),"other.html","text/html",bytes.length,body.sha256())));
  denied(409,()->transfers.complete(j.id(),j.token(),r.uploadId()));denied(409,()->transfers.chunk(j.id(),j.token(),r.uploadId(),part(1,new byte[]{1})));
  var chunk=part(0,bytes);assertEquals(transfers.chunk(j.id(),j.token(),r.uploadId(),chunk),transfers.chunk(j.id(),j.token(),r.uploadId(),chunk));denied(409,()->transfers.chunk(j.id(),j.token(),r.uploadId(),part(0,new byte[]{1})));
  assertEquals("READY",transfers.complete(j.id(),j.token(),r.uploadId()).state());assertEquals("READY",transfers.complete(j.id(),j.token(),r.uploadId()).state());
  var bad=transfers.prepare(j.id(),j.token(),new ArtifactTransferService.Prepare(UUID.randomUUID(),"bad.html","text/html",4,"0".repeat(64)));transfers.chunk(j.id(),j.token(),bad.uploadId(),chunk);denied(422,()->transfers.complete(j.id(),j.token(),bad.uploadId()));
  byte[] oversized=new byte[65537];denied(502,()->agents.finish(j,result(j,List.of(new AgentResult.Artifact("legacy.txt",hash(oversized),Base64.getEncoder().encodeToString(oversized))))));
 }
 @Test void attemptStopExpiryAndMembershipFenceEveryTransfer(){
  var j=job();var r=transfers.prepare(j.id(),j.token(),prepare(new byte[]{1}));
  denied(403,()->transfers.chunk(j.id(),UUID.randomUUID(),r.uploadId(),part(0,new byte[]{1})));
  var otherJob=job();denied(404,()->transfers.chunk(otherJob.id(),otherJob.token(),r.uploadId(),part(0,new byte[]{1})));
  db.update("UPDATE conversation_attempts SET stop_requested=true WHERE task_id=?",j.id());denied(403,()->transfers.complete(j.id(),j.token(),r.uploadId()));db.update("UPDATE conversation_attempts SET stop_requested=false WHERE task_id=?",j.id());
  db.update("UPDATE conversation_artifact_transfers SET expires_at=now()-interval '1 second' WHERE id=?",r.uploadId());denied(404,()->transfers.chunk(j.id(),j.token(),r.uploadId(),part(0,new byte[]{1})));
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);denied(404,()->transfers.prepare(j.id(),j.token(),prepare(new byte[]{2})));transfers.cleanup();assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_artifact_transfers WHERE id=?",Integer.class,r.uploadId()));
 }
 @Test void aggregateBudgetNamesAndLeaseCannotBeBypassed(){
  var j=job();var r=transfers.prepare(j.id(),j.token(),new ArtifactTransferService.Prepare(UUID.randomUUID(),"max.html","text/html",ArtifactTransferService.MAX_BYTES,"a".repeat(64)));
  denied(422,()->transfers.prepare(j.id(),j.token(),new ArtifactTransferService.Prepare(UUID.randomUUID(),"next.html","text/html",1,"b".repeat(64))));
  denied(400,()->transfers.prepare(j.id(),j.token(),new ArtifactTransferService.Prepare(UUID.randomUUID(),"../bad.html","text/html",1,"b".repeat(64))));
  db.update("UPDATE conversation_tasks SET lease_until=now()-interval '1 second' WHERE id=?",j.id());denied(403,()->transfers.chunk(j.id(),j.token(),r.uploadId(),part(0,new byte[]{1})));transfers.cleanup();assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_artifact_transfers WHERE id=?",Integer.class,r.uploadId()));
 }
 HttpResponse<String> post(ConversationService.Job j,String action,Object body,UUID bearer) throws Exception{return HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/internal/v1/agent-access/"+j.id()+"/artifacts/"+action)).header("Authorization","Bearer "+bearer).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build(),HttpResponse.BodyHandlers.ofString());}
 @Test void httpUsesAttemptBearerAndNoStoreAndRejectsCallerScope() throws Exception {
  var j=job();byte[] bytes=new byte[600000];Arrays.fill(bytes,(byte)42);var body=prepare(bytes);assertEquals(403,post(j,"prepare",body,UUID.randomUUID()).statusCode());var r=post(j,"prepare",body,j.token());assertEquals(200,r.statusCode(),r.body());assertTrue(r.headers().firstValue("cache-control").orElseThrow().contains("no-store"));String id=json.readTree(r.body()).get("uploadId").asString();for(int o=0;o<bytes.length;o+=ArtifactTransferService.CHUNK_BYTES){var response=post(j,id+"/chunk",part(o,Arrays.copyOfRange(bytes,o,Math.min(bytes.length,o+ArtifactTransferService.CHUNK_BYTES))),j.token());assertEquals(200,response.statusCode(),response.body());}assertEquals(200,post(j,id+"/complete",Map.of(),j.token()).statusCode());
  assertEquals(400,post(j,"prepare",Map.of("tenantId",tenant),j.token()).statusCode());
 }
}
