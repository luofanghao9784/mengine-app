package com.dreamcore.workspace;

import com.dreamcore.workspace.conversation.EngineTaskRuntime;
import com.dreamcore.workspace.identity.IdentityException;
import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.*;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

class RuntimeCompatibilityTest {
    HttpServer server;String endpoint;String token="synthetic-compatibility-01234567890123456789";
    AtomicInteger posts=new AtomicInteger();Object descriptor;int runtimeStatus=200;Object legacy;
    @BeforeEach void start() throws Exception {
        descriptor=descriptor("agent-verification","1.4");
        legacy=Map.of("contractVersion","1.0","engineVersion","0.9.0","runtimeMode","agent-verification","capabilities",List.of("source-lookup","agent-task"));
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/",e->{
            assertEquals("Bearer "+token,e.getRequestHeaders().getFirst("Authorization"));
            boolean runtime=e.getRequestURI().getPath().equals("/internal/v1/runtime");
            Object body=runtime?descriptor:legacy;int status=runtime?runtimeStatus:200;
            if(e.getRequestMethod().equals("POST")){posts.incrementAndGet();body=Map.of("code","FIXTURE_POST");status=503;}
            byte[] bytes=(body instanceof String s?s:new JsonMapper().writeValueAsString(body)).getBytes(StandardCharsets.UTF_8);
            e.sendResponseHeaders(status,bytes.length);e.getResponseBody().write(bytes);e.close();
        });server.start();endpoint="http://127.0.0.1:"+server.getAddress().getPort();
    }
    @AfterEach void stop(){server.stop(0);}
    Map<String,Object> descriptor(String mode,String protocol){return new HashMap<>(Map.of("contractVersion","1.0","engineVersion","0.9.1","runtimeMode",mode,"protocols",Map.of("sourceLookup","1.0","agentTask",protocol,"platformCallbacks","1.3")));}
    EngineTaskRuntime runtime(boolean legacy){return new EngineTaskRuntime(endpoint,token,"verification",legacy);}
    IdentityException agent(boolean legacy){return assertThrows(IdentityException.class,()->runtime(legacy).executeAgent(UUID.randomUUID(),UUID.randomUUID(),"private prompt",()->true));}
    @Test void meteringCallbackVersionIsAcceptedButUnknownVersionsAreNot(){
        var v=descriptor("agent-verification","1.4");v.put("protocols",Map.of("sourceLookup","1.0","agentTask","1.4","platformCallbacks","1.4"));descriptor=v;
        agent(false);assertEquals(1,posts.get());
        v.put("protocols",Map.of("sourceLookup","1.0","agentTask","1.4","platformCallbacks","1.5"));
        assertEquals("TASK_RUNTIME_INCOMPATIBLE",agent(false).code);assertEquals(1,posts.get());
    }
    @Test void incompatibleAgentProtocolNeverSendsPrompt(){descriptor=descriptor("agent-verification","2.0");assertEquals("TASK_RUNTIME_INCOMPATIBLE",agent(false).code);assertEquals(0,posts.get());}
    @Test void wrongExecutionClassNeverCallsModel(){descriptor=descriptor("agent-live","1.4");assertEquals("TASK_RUNTIME_INCOMPATIBLE",agent(false).code);assertEquals(0,posts.get());}
    @Test void missingRuntimeDoesNotImplicitlyEnableLegacy(){runtimeStatus=404;agent(false);assertEquals(0,posts.get());}
    @Test void optedInExactLegacyCanDispatch(){runtimeStatus=404;agent(true);assertEquals(1,posts.get());}
    @Test void legacyFallbackNeverAcceptsAnotherReleaseOrMasksServerFailure(){
        runtimeStatus=404;legacy=Map.of("contractVersion","1.0","engineVersion","0.8.0","runtimeMode","agent-verification","capabilities",List.of("source-lookup","agent-task"));agent(true);assertEquals(0,posts.get());
        runtimeStatus=500;agent(true);assertEquals(0,posts.get());
    }
    @Test void malformedOrMissingModeIsRejectedBeforeDispatch(){
        descriptor="{broken";assertEquals("TASK_RUNTIME_INCOMPATIBLE",agent(false).code);
        var malformed=descriptor("agent-verification","1.4");malformed.remove("runtimeMode");descriptor=malformed;
        assertEquals("TASK_RUNTIME_INCOMPATIBLE",agent(false).code);assertEquals(0,posts.get());
    }
    @Test void supportedSourceLookupDoesNotRequireAgentProtocol(){
        descriptor=descriptor("local-retrieval","2.0");
        assertThrows(IdentityException.class,()->runtime(false).execute(UUID.randomUUID(),UUID.randomUUID(),List.of()));assertEquals(1,posts.get());
    }
    @Test void cancellationBeforeProbeSendsNothing(){
        assertEquals(403,assertThrows(IdentityException.class,()->runtime(false).executeAgent(UUID.randomUUID(),UUID.randomUUID(),"private",()->false)).status);assertEquals(0,posts.get());
    }
    @Test void validRuntimeStillRejectsAReplyFromDifferentRelease(){
        server.removeContext("/");
        server.createContext("/internal/v1/runtime",e->{byte[] bytes=new JsonMapper().writeValueAsBytes(descriptor);e.sendResponseHeaders(200,bytes.length);e.getResponseBody().write(bytes);e.close();});
        UUID task=UUID.randomUUID(),attempt=UUID.randomUUID();
        server.createContext("/internal/v1/source-results",e->{assertEquals("0.9.1",e.getRequestHeaders().getFirst("X-Dreamcore-Engine-Version"));byte[] bytes=new JsonMapper().writeValueAsBytes(Map.of("contractVersion","1.0","engineVersion","0.9.0","taskId",task,"attemptId",attempt,"mode","SOURCE_LOOKUP","summaryCode","NO_SOURCES","sourceIds",List.of()));e.sendResponseHeaders(200,bytes.length);e.getResponseBody().write(bytes);e.close();});
        assertEquals("TASK_RUNTIME_INCOMPATIBLE",assertThrows(IdentityException.class,()->runtime(false).execute(task,attempt,List.of())).code);
    }
}
