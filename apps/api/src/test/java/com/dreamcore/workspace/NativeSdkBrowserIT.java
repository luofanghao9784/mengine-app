package com.dreamcore.workspace;
import java.util.*;
import java.nio.file.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import static org.junit.jupiter.api.Assertions.*;

/** Browser -> real platform -> isolated Docker SDK. Only the LLM is synthetic. */
@org.springframework.boot.test.context.SpringBootTest(webEnvironment=org.springframework.boot.test.context.SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"server.address=0.0.0.0","dreamcore.knowledge.enabled=true","dreamcore.tasks.enabled=true"})
@EnabledIfEnvironmentVariable(named="NATIVE_BROWSER_IMAGE",matches="sha256:[a-f0-9]{64}")
class NativeSdkBrowserIT extends NativeConversationIntegrationTest {
 private static final String CONTROL=UUID.randomUUID().toString()+UUID.randomUUID();
 private static final int HOST_PORT=freePort();
 private static int freePort(){try(var s=new java.net.ServerSocket(0)){return s.getLocalPort();}catch(Exception e){throw new RuntimeException(e);}}
 @org.springframework.test.context.DynamicPropertySource static void properties(org.springframework.test.context.DynamicPropertyRegistry registry){registry.add("dreamcore.native.control-token",()->CONTROL);registry.add("dreamcore.native.web-url",()->"http://127.0.0.1:"+HOST_PORT);}
 @Autowired org.springframework.security.crypto.password.PasswordEncoder passwords;
 @Autowired com.dreamcore.workspace.conversation.NativeSchedules schedules;
 @Autowired com.dreamcore.workspace.conversation.NativeAttachments attachments;
 @Autowired com.dreamcore.workspace.conversation.NativeEnterpriseSkills skills;
 @Autowired com.dreamcore.workspace.conversation.NativePluginPolicy plugins;
 @Autowired com.dreamcore.workspace.conversation.NativeRuntimeClient runtime;

 @Test void fullBrowserAcceptance()throws Exception{
  db.update("UPDATE accounts SET username='sdkbrowser',password_hash=? WHERE id=?",passwords.encode("Synthetic-browser-12345"),owner);
  var refs=new ArrayList<Map<String,Object>>();
  for(int i=1;i<=2;i++){
   var f=materials.upload(owner,tenant,space,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","browser-source-"+i+".txt","text/plain",("BROWSER_EVIDENCE_"+i).getBytes()));
   var version=materials.detail(owner,tenant,space,f.id(),0,20).versions().getFirst();refs.add(Map.of("materialId",f.id(),"versionId",version.id()));
  }
  UUID forbiddenSpace=UUID.randomUUID();
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'其他员工私人','PERSONAL')",forbiddenSpace,tenant,other);
  var forbidden=materials.upload(other,tenant,forbiddenSpace,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","forbidden.txt","text/plain","private".getBytes()));
  UUID forbiddenVersion=materials.detail(other,tenant,forbiddenSpace,forbidden.id(),0,20).versions().getFirst().id();
  Path root=Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();
  Path dir=root.resolve(".local/native-sdk-browser");Files.createDirectories(dir);
  Files.writeString(dir.resolve("ready.json"),new tools.jackson.databind.json.JsonMapper().writeValueAsString(Map.of("port",port,"tenant",tenant,"space",space,"target",target,"refs",refs,"forbidden",Map.of("materialId",forbidden.id(),"versionId",forbiddenVersion))));
  String ledger="dh-browser-"+tenant,base="http://127.0.0.1:"+HOST_PORT;
  var builder=new ProcessBuilder("node",root.resolve("engine/scripts/native-web-host.mjs").toString());
  builder.environment().putAll(Map.of("DREAMCORE_NATIVE_CONTROL_TOKEN",CONTROL,"DREAMCORE_NATIVE_IMAGE",System.getenv("NATIVE_BROWSER_IMAGE"),"DREAMCORE_NATIVE_PLATFORM_URL","http://127.0.0.1:"+port,"DREAMCORE_NATIVE_PLATFORM_CONTAINER_URL","http://"+System.getenv("NATIVE_SDK_PLATFORM_HOST")+":"+port,"DREAMCORE_NATIVE_PUBLIC_URL",base,"DREAMCORE_NATIVE_APP_ORIGIN","http://127.0.0.1:5217","DREAMCORE_NATIVE_SYNTHETIC","true","DREAMCORE_NATIVE_LEDGER_VOLUME",ledger));
  builder.redirectErrorStream(true).redirectOutput(dir.resolve("host.log").toFile());var host=builder.start();
  try{
   Thread.sleep(1000);assertTrue(host.isAlive());
   var browser=new ProcessBuilder("node",root.resolve("scripts/review/native-sdk-browser.mjs").toString()).directory(root.toFile()).redirectErrorStream(true).redirectOutput(dir.resolve("browser.log").toFile()).start();
   try { assertTrue(browser.waitFor(12,java.util.concurrent.TimeUnit.MINUTES));assertEquals(0,browser.exitValue(),Files.readString(dir.resolve("browser.log"))); } finally {browser.destroyForcibly();}
   assertTrue(db.queryForObject("SELECT count(*) FROM native_conversation_publications WHERE session_id IN (SELECT id FROM native_conversations WHERE tenant_id=?)",Integer.class,tenant)>0);
   // B4/B5/B7: real platform wakeup -> isolated SDK, private file/image, slash skill, terminal receipt and reclaim.
   db.update("UPDATE tenant_memberships SET role='TENANT_ADMIN' WHERE tenant_id=? AND account_id=?",tenant,owner);
   skills.put(owner,tenant,"evidence-review",new com.dreamcore.workspace.conversation.NativeEnterpriseSkills.Put("---\nname: evidence-review\ndescription: Synthetic review\n---\nReview synthetic evidence.",true,List.of()));
   var parent=open();var png=new java.io.ByteArrayOutputStream();javax.imageio.ImageIO.write(new java.awt.image.BufferedImage(2,2,java.awt.image.BufferedImage.TYPE_INT_RGB),"png",png);
   attachments.upload(owner,tenant,parent.id(),UUID.randomUUID(),new MockMultipartFile("file","pixel.png","image/png",png.toByteArray()));
   attachments.upload(owner,tenant,parent.id(),UUID.randomUUID(),new MockMultipartFile("file","private.txt","text/plain","PRIVATE_SCHEDULE_FILE".getBytes()));
   @SuppressWarnings("unchecked") var schedule=(Map<String,Object>)schedules.create(owner,tenant,parent.id(),UUID.randomUUID(),new com.dreamcore.workspace.conversation.NativeSchedules.Config("定时容器验收","/evidence-review BROWSER_HELLO",Map.of("kind","at","at",java.time.Instant.now().plusSeconds(2).truncatedTo(java.time.temporal.ChronoUnit.MILLIS).toString()),false,60,2,2,java.time.Instant.now().plusSeconds(120)));
   UUID sid=(UUID)schedule.get("id");Thread.sleep(2100);schedules.tick(sid);
   for(int i=0;i<60;i++){schedules.tick(sid);if(db.queryForObject("SELECT count(*) FROM native_schedule_runs WHERE schedule_id=? AND state='SUCCEEDED'",Integer.class,sid)>0)break;Thread.sleep(500);}
   assertEquals("SUCCEEDED",db.queryForObject("SELECT state FROM native_schedule_runs WHERE schedule_id=?",String.class,sid));
   UUID scheduledSession=db.queryForObject("SELECT session_id FROM native_schedule_runs WHERE schedule_id=?",UUID.class,sid);
   assertTrue(db.queryForObject("SELECT count(*) FROM native_conversation_events WHERE session_id=? AND event->'data'->'source'->>'kind'='skill-invocation'",Integer.class,scheduledSession)>0);
   assertTrue(db.queryForObject("SELECT count(*) FROM native_conversation_events WHERE session_id=? AND event->>'type'='user/message' AND event::text LIKE '%image%'",Integer.class,scheduledSession)>0);
   // B6: a live root is recreated after a policy change, without the disabled enterprise tools.
   var probe=open();var grant=nativeSessions.grant(owner,tenant,probe.id());
   runtime.command(probe.id(),grant.token(),"messages",Map.of("requestId",UUID.randomUUID().toString(),"text","BROWSER_CAPABILITIES"));
   String before=waitReply(probe.id(),0);assertTrue(before.contains("enterprise_read"),before);
   long replies=db.queryForObject("SELECT count(*) FROM native_conversation_events WHERE session_id=? AND event->>'type'='assistant/message'",Long.class,probe.id());
   plugins.toggle(owner,tenant,"enterprise-data",new com.dreamcore.workspace.conversation.NativePluginPolicy.Toggle(false,0));
   runtime.command(probe.id(),grant.token(),"messages",Map.of("requestId",UUID.randomUUID().toString(),"text","BROWSER_CAPABILITIES"));
   String after=waitReply(probe.id(),replies);assertFalse(after.contains("enterprise_read"),after);runtime.reclaim(probe.id());
   Files.writeString(dir.resolve("backend-slices.txt"),"B4 real scheduled run SUCCEEDED; container reclaimed. B5 slash skill injected. B7 private image admitted. B6 live policy reload removed enterprise_read.\n");

  }finally{
   host.destroy();if(!host.waitFor(20,java.util.concurrent.TimeUnit.SECONDS))host.destroyForcibly();
   for(var id:db.queryForList("SELECT id FROM native_conversations WHERE tenant_id=?",UUID.class,tenant))new ProcessBuilder("docker","--context","colima-dh120","volume","rm","dh120-data-"+id.toString().replace("-","")).redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectErrorStream(true).start().waitFor();
   new ProcessBuilder("docker","--context","colima-dh120","volume","rm",ledger).redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectErrorStream(true).start().waitFor();
  }
 }
 private String waitReply(UUID id,long prior)throws Exception{
  for(int i=0;i<80;i++){var rows=db.queryForList("SELECT event::text FROM native_conversation_events WHERE session_id=? AND event->>'type'='assistant/message' ORDER BY seq",String.class,id);if(rows.size()>prior)return rows.getLast();Thread.sleep(250);}throw new AssertionError("No native reply");
 }

}
