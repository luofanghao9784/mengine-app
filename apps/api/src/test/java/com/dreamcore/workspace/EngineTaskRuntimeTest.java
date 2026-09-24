package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.IdentityException;
import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.util.*;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.*;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;
class EngineTaskRuntimeTest {
    HttpServer server;String endpoint;String token="synthetic-test-token-01234567890123456789";UUID task=UUID.randomUUID(),attempt=UUID.randomUUID(),source=UUID.randomUUID();
    @BeforeEach void start() throws Exception {server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);endpoint="http://127.0.0.1:"+server.getAddress().getPort();server.createContext("/internal/v1/runtime", e->{byte[] bytes="{\"contractVersion\":\"1.0\",\"engineVersion\":\"0.2.0\",\"runtimeMode\":\"local-retrieval\",\"protocols\":{\"sourceLookup\":\"1.0\",\"agentTask\":\"1.4\",\"platformCallbacks\":\"1.3\"}}".getBytes(StandardCharsets.UTF_8);e.sendResponseHeaders(200,bytes.length);e.getResponseBody().write(bytes);e.close();});server.start();}
    @AfterEach void stop(){server.stop(0);}
    Map<String,Object> result(){return new HashMap<>(Map.of("contractVersion","1.0","engineVersion","0.2.0","taskId",task,"attemptId",attempt,"mode","SOURCE_LOOKUP","summaryCode","SOURCES_FOUND","sourceIds",List.of(source)));}
    void respond(int status,Object body){server.createContext("/internal/v1/source-results",e->{var json=new JsonMapper();assertEquals("Bearer "+token,e.getRequestHeaders().getFirst("Authorization"));var in=json.readTree(e.getRequestBody().readAllBytes());assertEquals(task.toString(),in.get("taskId").asString());assertEquals(attempt.toString(),in.get("attemptId").asString());byte[] bytes=(body instanceof String s?s:json.writeValueAsString(body)).getBytes(StandardCharsets.UTF_8);e.sendResponseHeaders(status,bytes.length);e.getResponseBody().write(bytes);e.close();});}
    @Test void validResponseBindsTaskAttemptAndSources(){respond(200,result());var r=new EngineTaskRuntime(endpoint,token,"off",false).execute(task,attempt,List.of(source));assertEquals(List.of(source),r.sourceIds());assertEquals(attempt,r.attemptId());}
    @Test void foreignAttemptIsRejected(){var body=result();body.put("attemptId",UUID.randomUUID());respond(200,body);assertEquals(502,assertThrows(IdentityException.class,()->new EngineTaskRuntime(endpoint,token,"off",false).execute(task,attempt,List.of(source))).status);}
    @Test void injectedSourcesAreRejected(){var body=result();body.put("sourceIds",List.of(UUID.randomUUID()));respond(200,body);assertEquals(502,assertThrows(IdentityException.class,()->new EngineTaskRuntime(endpoint,token,"off",false).execute(task,attempt,List.of(source))).status);}
    @Test void overlargeAndUnavailableResponsesAreNotSuccess(){respond(200,"x".repeat(20000));assertThrows(IdentityException.class,()->new EngineTaskRuntime(endpoint,token,"off",false).execute(task,attempt,List.of(source)));}
    @Test void noCredentialsMakesNoRequest(){assertEquals(503,assertThrows(IdentityException.class,()->new EngineTaskRuntime(endpoint,"","off",false).execute(task,attempt,List.of())).status);}
    @Test void unsafeEndpointConfigurationRejected(){for(String url:List.of("file:///tmp/runtime","http://user:pass@localhost","http://localhost/path","http://localhost/?secret=x"))assertThrows(IllegalArgumentException.class,()->new EngineTaskRuntime(url,token,"off",false));}
    @Test void stalledBodyHasBoundedDeadline() throws Exception {
        var release=new java.util.concurrent.CountDownLatch(1);
        server.createContext("/internal/v1/source-results",e->{e.getRequestBody().readAllBytes();e.sendResponseHeaders(200,100);e.getResponseBody().write('{');e.getResponseBody().flush();try{release.await(10,java.util.concurrent.TimeUnit.SECONDS);}catch(InterruptedException interrupted){Thread.currentThread().interrupt();}finally{e.close();}});
        long start=System.nanoTime();try{assertThrows(IdentityException.class,()->new EngineTaskRuntime(endpoint,token,"off",false).execute(task,attempt,List.of(source)));assertTrue(java.time.Duration.ofNanos(System.nanoTime()-start).toMillis()<8000);}finally{release.countDown();}
    }

}
