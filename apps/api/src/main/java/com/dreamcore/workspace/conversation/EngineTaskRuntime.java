package com.dreamcore.workspace.conversation;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.engine.RuntimeCompatibility;
import com.dreamcore.workspace.engine.EngineGateway;
import java.net.*;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.nio.ByteBuffer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;
@Component
public class EngineTaskRuntime implements TaskRuntime {
    @org.springframework.beans.factory.annotation.Autowired(required=false) private com.dreamcore.workspace.engine.ExecutionReceipts receipts;
    private final String executionClass;private final boolean legacy090;
    private final URI uri;private final String token;private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).followRedirects(HttpClient.Redirect.NEVER).build();
    private final JsonMapper json=new JsonMapper();
    public EngineTaskRuntime(@Value("${dreamcore.engine.base-url}") String base,@Value("${dreamcore.tasks.engine-token:}") String token,@Value("${dreamcore.tasks.agent-mode:off}") String executionClass,@Value("${dreamcore.engine.legacy-090-enabled:false}") boolean legacy090) {
        URI parsed=URI.create(base);if(!Set.of("http","https").contains(parsed.getScheme()) || parsed.getHost()==null || parsed.getUserInfo()!=null || parsed.getQuery()!=null || parsed.getFragment()!=null || !(parsed.getPath().isEmpty() || parsed.getPath().equals("/")))throw new IllegalArgumentException("Invalid engine endpoint");
        this.uri=parsed.resolve("/internal/v1/source-results");this.token=token;this.executionClass=executionClass;this.legacy090=legacy090;
    }
    private HttpResponse<byte[]> probe(String path) throws Exception {
        var request=HttpRequest.newBuilder(uri.resolve(path)).timeout(Duration.ofSeconds(2)).header("Authorization","Bearer "+token).GET().build();
        var future=http.sendAsync(request,info->new BoundedBody());
        try{return future.get(3,TimeUnit.SECONDS);}finally{if(!future.isDone())future.cancel(true);}
    }
    private RuntimeCompatibility.Descriptor compatible(boolean agent) throws Exception {
        var response=probe("/internal/v1/runtime");
        RuntimeCompatibility.Descriptor descriptor;
        if(response.statusCode()==404 && legacy090){
            var legacy=probe("/internal/v1/capabilities");
            if(legacy.statusCode()!=200)throw RuntimeCompatibility.incompatible();
            try{descriptor=RuntimeCompatibility.legacy090(json.readValue(legacy.body(),EngineGateway.Capabilities.class));}
            catch(IdentityException e){throw e;}catch(RuntimeException e){throw RuntimeCompatibility.incompatible();}
        }else{
            if(response.statusCode()==404)throw RuntimeCompatibility.incompatible();
            if(response.statusCode()!=200)throw new IdentityException(503,"TASK_RUNTIME_UNAVAILABLE");
            try{descriptor=json.readValue(response.body(),RuntimeCompatibility.Descriptor.class);}
            catch(RuntimeException e){throw RuntimeCompatibility.incompatible();}
        }
        RuntimeCompatibility.require(descriptor,agent,executionClass);return descriptor;
    }
    public Result execute(UUID task,UUID attempt,List<UUID> sources) {
        if(token.length()<32)throw new IdentityException(503,"TASK_RUNTIME_UNAVAILABLE");
        try {
            String version=compatible(false).engineVersion();
            var request=HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(5)).header("Authorization","Bearer "+token).header("Content-Type","application/json").header("X-Dreamcore-Engine-Version",version)
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("contractVersion","1.0","taskId",task,"attemptId",attempt,"sourceIds",sources)))).build();
            var future=http.sendAsync(request,info->new BoundedBody());
            HttpResponse<byte[]> response;
            try {response=future.get(6,TimeUnit.SECONDS);} finally {if(!future.isDone())future.cancel(true);}
            byte[] body=response.body();
            if(response.statusCode()!=200)throw new IdentityException(response.statusCode()==409?502:503,response.statusCode()==409?"TASK_RUNTIME_INCOMPATIBLE":"TASK_RUNTIME_UNAVAILABLE");
            if(body.length>16384)throw new IdentityException(502,"TASK_RUNTIME_INCOMPATIBLE");
            Result result=json.readValue(body,Result.class);
            if(!"1.0".equals(result.contractVersion()) || !task.equals(result.taskId()) || !attempt.equals(result.attemptId()) || !"SOURCE_LOOKUP".equals(result.mode()) || !version.equals(result.engineVersion()) || !sources.equals(result.sourceIds()) || !(sources.isEmpty()?"NO_SOURCES":"SOURCES_FOUND").equals(result.summaryCode()))throw new IdentityException(502,"TASK_RUNTIME_INCOMPATIBLE");
            return result;
        } catch(IdentityException error){throw error;}
        catch(Exception error){if(error instanceof InterruptedException)Thread.currentThread().interrupt();throw new IdentityException(503,"TASK_RUNTIME_UNAVAILABLE");}
    }
    private static class BoundedBody implements HttpResponse.BodySubscriber<byte[]> {
        private final HttpResponse.BodySubscriber<byte[]> delegate=HttpResponse.BodySubscribers.ofByteArray();
        private Flow.Subscription subscription;private int total;private final int limit;
        BoundedBody(){this(16384);}BoundedBody(int limit){this.limit=limit;}
        public CompletionStage<byte[]> getBody(){return delegate.getBody();}
        public void onSubscribe(Flow.Subscription subscription){this.subscription=subscription;delegate.onSubscribe(subscription);}
        public void onNext(List<ByteBuffer> buffers){for(var buffer:buffers){total+=buffer.remaining();if(total>limit){subscription.cancel();delegate.onError(new IllegalStateException("Engine response too large"));return;}}delegate.onNext(buffers);}
        public void onError(Throwable error){delegate.onError(error);}public void onComplete(){delegate.onComplete();}
    }

    public AgentResult executeAgent(UUID task,UUID attempt,String prompt,java.util.function.BooleanSupplier active) {
        if(token.length()<32)throw new IdentityException(503,"TASK_RUNTIME_UNAVAILABLE");
        CompletableFuture<HttpResponse<byte[]>> future=null;String expectedVersion=null;
        try {
            if(!active.getAsBoolean())throw new IdentityException(403,"TASK_SOURCE_UNAVAILABLE");
            var descriptor=compatible(true);String version=descriptor.engineVersion();expectedVersion=version;String protocol=descriptor.protocols().get("agentTask");
            if(protocol.equals("1.4") && prompt.length()>2000)throw new IdentityException(503,"TASK_RUNTIME_INCOMPATIBLE");
            var request=HttpRequest.newBuilder(uri.resolve("/internal/v1/agent-results")).timeout(Duration.ofSeconds(60)).header("Authorization","Bearer "+token).header("Content-Type","application/json").header("X-Dreamcore-Engine-Version",version)
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("contractVersion",protocol,"taskId",task,"attemptId",attempt,"prompt",prompt)))).build();
            if(!active.getAsBoolean())throw new IdentityException(403,"TASK_SOURCE_UNAVAILABLE");
            future=http.sendAsync(request,info->new BoundedBody(262144));long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(62);
            while(true){
                if(!active.getAsBoolean())throw new IdentityException(403,"TASK_SOURCE_UNAVAILABLE");
                if(System.nanoTime()>deadline)throw new IdentityException(503,"TASK_RESULT_UNKNOWN");
                try{
                    var response=future.get(300,TimeUnit.MILLISECONDS);
                    if(response.statusCode()!=200){
                        String code="TASK_RESULT_UNKNOWN";
                        try{String remote=json.readTree(response.body()).path("code").asString();if(Set.of("TASK_RUNTIME_INCOMPATIBLE","TASK_MODEL_FAILED","TASK_LIMIT","TASK_TOOL_FAILED","MODEL_NOT_CONFIGURED","PUBLIC_WEB_NOT_CONFIGURED","TASK_FILE_UNSUPPORTED","TASK_FILE_ENCODING","TASK_FILE_INVALID","TASK_FILE_LIMIT","TASK_FILE_DATA").contains(remote))code=remote;}catch(Exception ignored){}
                        throw new IdentityException(503,code);
                    }
                    var result=json.readValue(response.body(),AgentResult.class);
                    if(!task.equals(result.taskId()) || !attempt.equals(result.attemptId()) || !version.equals(result.engineVersion()))throw new IdentityException(502,"TASK_RESULT_UNKNOWN");
                    return result;
                }catch(TimeoutException waiting){}
            }
        }catch(IdentityException error){
            if("TASK_RESULT_UNKNOWN".equals(error.code) && receipts!=null && active.getAsBoolean()){
                String saved=receipts.result("AGENT",task,attempt);
                if(saved!=null){var result=json.readValue(saved,AgentResult.class);if(task.equals(result.taskId())&&attempt.equals(result.attemptId())&&Objects.equals(expectedVersion,result.engineVersion()))return result;}
            }
            throw error;
        }
        catch(Exception error){
            if(error instanceof InterruptedException)Thread.currentThread().interrupt();
            if(future!=null && receipts!=null && active.getAsBoolean()){
                try{String saved=receipts.result("AGENT",task,attempt);if(saved!=null){var result=json.readValue(saved,AgentResult.class);if(task.equals(result.taskId())&&attempt.equals(result.attemptId())&&Objects.equals(expectedVersion,result.engineVersion()))return result;}}catch(Exception unavailable){}
            }
            throw new IdentityException(503,future==null?"TASK_RUNTIME_UNAVAILABLE":"TASK_RESULT_UNKNOWN");
        }
        finally{if(future!=null && !future.isDone())future.cancel(true);}
    }

    public record TitleResult(String contractVersion,UUID conversationId,UUID requestId,String title,String modelName,Long inputTokens,Long outputTokens) {}
    public TitleResult executeTitle(ConversationTitles.Job job,java.util.function.BooleanSupplier active) {
        if(token.length()<32)throw new IdentityException(503,"TASK_RUNTIME_UNAVAILABLE");
        CompletableFuture<HttpResponse<byte[]>> future=null;
        try {
            if(!active.getAsBoolean())throw new IdentityException(403,"TASK_SOURCE_UNAVAILABLE");
            String version=compatible(true).engineVersion();
            var request=HttpRequest.newBuilder(uri.resolve("/internal/v1/conversation-title")).timeout(Duration.ofSeconds(18))
                .header("Authorization","Bearer "+token).header("Content-Type","application/json").header("X-Dreamcore-Engine-Version",version)
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("contractVersion","1.0","conversationId",job.conversation(),"requestId",job.request(),"prompt",job.prompt())))).build();
            if(!active.getAsBoolean())throw new IdentityException(403,"TASK_SOURCE_UNAVAILABLE");
            future=http.sendAsync(request,info->new BoundedBody());
            long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(20);
            while(true){
                if(!active.getAsBoolean())throw new IdentityException(403,"TASK_SOURCE_UNAVAILABLE");
                if(System.nanoTime()>deadline)throw new IdentityException(503,"TITLE_TIMEOUT");
                try{
                    var response=future.get(300,TimeUnit.MILLISECONDS);
                    if(response.statusCode()!=200)throw new IdentityException(503,"TITLE_UNAVAILABLE");
                    return json.readValue(response.body(),TitleResult.class);
                }catch(TimeoutException waiting){}
            }
        }catch(IdentityException error){throw error;}
        catch(Exception error){if(error instanceof InterruptedException)Thread.currentThread().interrupt();throw new IdentityException(503,"TITLE_UNAVAILABLE");}
        finally{if(future!=null&&!future.isDone())future.cancel(true);}
    }

}
