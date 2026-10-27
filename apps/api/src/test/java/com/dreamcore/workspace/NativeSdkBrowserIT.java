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
  }finally{
   host.destroy();if(!host.waitFor(20,java.util.concurrent.TimeUnit.SECONDS))host.destroyForcibly();
   for(var id:db.queryForList("SELECT id FROM native_conversations WHERE tenant_id=?",UUID.class,tenant))new ProcessBuilder("docker","--context","colima-dh120","volume","rm","dh120-data-"+id.toString().replace("-","")).redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectErrorStream(true).start().waitFor();
   new ProcessBuilder("docker","--context","colima-dh120","volume","rm",ledger).redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectErrorStream(true).start().waitFor();
  }
 }
}
