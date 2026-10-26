package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import java.util.*;
import java.nio.file.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import static org.junit.jupiter.api.Assertions.*;

/** Opt-in real isolated Docker + SDK + bridge + PostgreSQL test; synthetic model only. */
@org.springframework.boot.test.context.SpringBootTest(webEnvironment=org.springframework.boot.test.context.SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"server.address=0.0.0.0","dreamcore.knowledge.enabled=true","dreamcore.tasks.enabled=true"})
@EnabledIfEnvironmentVariable(named="NATIVE_SDK_IMAGE",matches="sha256:[a-f0-9]{64}")
class NativeSdkContainerIT extends NativeConversationIntegrationTest {
 private static final String CONTROL=UUID.randomUUID().toString()+UUID.randomUUID();
 @org.springframework.test.context.DynamicPropertySource static void properties(org.springframework.test.context.DynamicPropertyRegistry registry){registry.add("dreamcore.native.control-token",()->CONTROL);}
 @Autowired NativeConversationStream stream;
 @Test void realContainerEventsBudgetColdReadAndScope()throws Exception{
  var s=open();var grant=nativeSessions.grant(owner,tenant,s.id());
  Path root=Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();
  int hostPort;try(var socket=new java.net.ServerSocket(0)){hostPort=socket.getLocalPort();}
  String base="http://127.0.0.1:"+hostPort,context=System.getenv().getOrDefault("DREAMCORE_NATIVE_DOCKER_CONTEXT","colima-dh120"),ledger="dh-b123-test-"+s.id();
  String control=CONTROL;
  var builder=new ProcessBuilder("node",root.resolve("engine/scripts/native-web-host.mjs").toString());
  builder.environment().putAll(Map.of("DREAMCORE_NATIVE_CONTROL_TOKEN",control,"DREAMCORE_NATIVE_IMAGE",System.getenv("NATIVE_SDK_IMAGE"),"DREAMCORE_NATIVE_PLATFORM_URL","http://127.0.0.1:"+port,"DREAMCORE_NATIVE_PLATFORM_CONTAINER_URL","http://"+System.getenv().getOrDefault("NATIVE_SDK_PLATFORM_HOST","host.docker.internal")+":"+port,"DREAMCORE_NATIVE_PUBLIC_URL",base,"DREAMCORE_NATIVE_APP_ORIGIN","http://enterprise.test","DREAMCORE_NATIVE_SYNTHETIC","true","DREAMCORE_NATIVE_LEDGER_VOLUME",ledger));
  Path log=Files.createTempFile("dh-sdk-host-",".log");builder.redirectErrorStream(true).redirectOutput(log.toFile());var host=builder.start();
  try{
   long deadline=System.currentTimeMillis()+10000;while(System.currentTimeMillis()<deadline&&!Files.readString(log).contains("ready"))Thread.sleep(50);
   assertTrue(host.isAlive(),Files.readString(log));
   var client=new NativeRuntimeClient(base,control);
   var receipt=client.command(s.id(),grant.token(),"messages",Map.of("requestId",UUID.randomUUID().toString(),"text","Synthetic SDK enterprise conversation","materials",List.of()));assertEquals(true,receipt.get("accepted"));
   deadline=System.currentTimeMillis()+20000;List<Map<String,Object>> events=List.of();
   while(System.currentTimeMillis()<deadline){events=stream.history(owner,tenant,s.id(),0,500);if(events.stream().anyMatch(e->"assistant/message".equals(e.get("type")))&&Boolean.TRUE.equals(stream.status(owner,tenant,s.id()).get("available")))break;Thread.sleep(100);}
   assertTrue(events.stream().anyMatch(e->"assistant/message".equals(e.get("type"))),"No mirrored native response");assertTrue(events.stream().anyMatch(e->"session.status".equals(e.get("type"))));
   assertEquals(true,stream.status(owner,tenant,s.id()).get("available"));assertEquals("SYNTHETIC",stream.status(owner,tenant,s.id()).get("executionClass"));
   var forbidden=new ProcessBuilder("docker","--context",context,"exec","dh120-web-"+s.id().toString().replace("-",""),"node","-e","Promise.all(['/control/approval','/notification'].map(path=>fetch('http://enterprise-bridge:18190'+path,{method:'POST',headers:{authorization:'Bearer '+process.env.DREAMCORE_NATIVE_CAPABILITY,'x-dreamcore-bridge':process.env.DREAMCORE_NATIVE_CAPABILITY},body:'{}'}).then(r=>r.status))).then(s=>{console.log(s.join(','));process.exit(s.every(x=>x===403)?0:1)})").redirectErrorStream(true).start();assertTrue(forbidden.waitFor(10,java.util.concurrent.TimeUnit.SECONDS));assertEquals(0,forbidden.exitValue(),new String(forbidden.getInputStream().readAllBytes()));
   denied(()->stream.history(other,tenant,s.id(),0,500));
   assertEquals(true,client.command(s.id(),grant.token(),"turn-stop",Map.of("requestId",UUID.randomUUID().toString())).get("accepted"));
   host.destroy();assertTrue(host.waitFor(20,java.util.concurrent.TimeUnit.SECONDS));assertFalse(stream.history(owner,tenant,s.id(),0,500).isEmpty());
  }catch(Exception e){
   String diagnostic=Files.readString(log);for(String prefix:List.of("dh120-web-","dh120-bridge-")){var logs=new ProcessBuilder("docker","--context",context,"logs",prefix+s.id().toString().replace("-","")).redirectErrorStream(true).start();diagnostic+="\n"+new String(logs.getInputStream().readAllBytes());}
   throw new AssertionError(diagnostic,e);
  }finally{
   if(host.isAlive()){host.destroy();if(!host.waitFor(20,java.util.concurrent.TimeUnit.SECONDS))host.destroyForcibly();}
   new ProcessBuilder("docker","--context",context,"volume","rm","dh120-data-"+s.id().toString().replace("-",""),ledger).redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.DISCARD).start().waitFor(10,java.util.concurrent.TimeUnit.SECONDS);
   Files.deleteIfExists(log);
  }
 }
}
