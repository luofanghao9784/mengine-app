package com.dreamcore.workspace.profile;
import com.dreamcore.workspace.identity.IdentityException;
import java.net.*;import java.net.http.*;import java.nio.ByteBuffer;import java.time.Duration;import java.util.*;import java.util.concurrent.*;import java.util.function.BooleanSupplier;
import org.springframework.beans.factory.annotation.Value;import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/** Dedicated optional engine protocol. No model credentials or customer session cross this boundary. */
@Component
public class CompanyAnalysisRuntime {
 public record Descriptor(String contractVersion,String engineVersion,boolean configured,String executionClass) {}
 public record Result(String contractVersion,String engineVersion,UUID runId,UUID lease,String outcome,String code,List<CompanyInferenceService.Candidate> candidates,String modelName,Integer modelCalls,Long inputTokens,Long outputTokens) {}
 public static class Failure extends RuntimeException {public final String code;public final boolean sent;public Failure(String code,boolean sent){super(code);this.code=code;this.sent=sent;}}
 private final URI base;private final String token,mode;private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).followRedirects(HttpClient.Redirect.NEVER).build();private final JsonMapper json=new JsonMapper();
 public CompanyAnalysisRuntime(@Value("${dreamcore.engine.base-url}") String base,@Value("${dreamcore.tasks.engine-token:}") String token,@Value("${dreamcore.tasks.agent-mode:off}") String mode){
  this.base=URI.create(base);this.token=token;this.mode=mode;
  if(!Set.of("http","https").contains(this.base.getScheme())||this.base.getHost()==null||this.base.getUserInfo()!=null||this.base.getQuery()!=null||this.base.getFragment()!=null||!Set.of("","/").contains(this.base.getPath()))throw new IllegalArgumentException("Invalid engine endpoint");
 }
 public boolean configured(){return token.length()>=32&&Set.of("live","verification").contains(mode);}
 private HttpRequest.Builder request(String path){return HttpRequest.newBuilder(base.resolve(path)).header("Authorization","Bearer "+token).timeout(Duration.ofSeconds(3));}
 private HttpResponse<byte[]> send(HttpRequest r)throws Exception{return http.send(r,ignored->new Body());}
 public Descriptor preflight(){
  if(!configured())throw new Failure("MODEL_NOT_CONFIGURED",false);
  try{var response=send(request("/internal/v1/company-information/runtime").GET().build());if(response.statusCode()!=200)throw new Failure("COMPANY_ENGINE_UNAVAILABLE",false);var d=json.readValue(response.body(),Descriptor.class);
   if(!"1.0".equals(d.contractVersion())||d.engineVersion()==null||!d.engineVersion().matches("[A-Za-z0-9.\\-]{1,64}")||!d.configured()||!mode.equals(d.executionClass()))throw new Failure("COMPANY_ENGINE_INCOMPATIBLE",false);return d;
  }catch(Failure f){throw f;}catch(Exception e){if(e instanceof InterruptedException)Thread.currentThread().interrupt();throw new Failure("COMPANY_ENGINE_UNAVAILABLE",false);}
 }
 public Result execute(CompanyInferenceService.Job job,Descriptor descriptor,BooleanSupplier active){
  CompletableFuture<HttpResponse<byte[]>> future=null;
  try{
   if(!active.getAsBoolean())throw new Failure("COMPANY_SOURCE_CHANGED",false);
   var req=request("/internal/v1/company-information/results").timeout(Duration.ofSeconds(65)).header("Content-Type","application/json").header("X-Dreamcore-Engine-Version",descriptor.engineVersion()).POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("contractVersion","1.0","job",job)))).build();
   future=http.sendAsync(req,ignored->new Body());long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(67);
   while(System.nanoTime()<until){
    if(!active.getAsBoolean()){cancel(job.id(),job.lease());throw new Failure("COMPANY_SOURCE_CHANGED",true);}
    try{var response=future.get(300,TimeUnit.MILLISECONDS);
     if(response.statusCode()==200)return validate(response.body(),job.id(),job.lease(),descriptor.engineVersion());
     if(response.statusCode()==409 && "COMPANY_ATTEMPT_CONFLICT".equals(json.readTree(response.body()).path("code").asString()))throw new Failure("COMPANY_RESULT_UNKNOWN",true);
     if(Set.of(400,401,403,409,413,429,503).contains(response.statusCode()))throw new Failure(response.statusCode()==429?"ENGINE_BUSY":"COMPANY_ENGINE_UNAVAILABLE",false);
     throw new Failure("COMPANY_RESULT_UNKNOWN",true);
    }catch(TimeoutException waiting){}
   }
   throw new Failure("COMPANY_RESULT_UNKNOWN",true);
  }catch(Failure f){throw f;}catch(Exception e){if(e instanceof InterruptedException)Thread.currentThread().interrupt();throw new Failure(future==null?"COMPANY_ENGINE_UNAVAILABLE":"COMPANY_RESULT_UNKNOWN",future!=null);}
  finally{if(future!=null&&!future.isDone())future.cancel(true);}
 }
 public Result recover(UUID run,UUID lease,String version){
  try{var response=send(request("/internal/v1/company-information/results/"+run+"/"+lease).GET().build());if(response.statusCode()==202)return null;if(response.statusCode()==404&&"COMPANY_RESULT_PENDING".equals(json.readTree(response.body()).path("code").asString()))throw new Failure("COMPANY_RESULT_LOST",true);if(response.statusCode()!=200)throw new Failure("COMPANY_RESULT_UNKNOWN",true);return validate(response.body(),run,lease,version);}
  catch(Failure f){throw f;}catch(Exception e){if(e instanceof InterruptedException)Thread.currentThread().interrupt();throw new Failure("COMPANY_RESULT_UNKNOWN",true);}
 }
 public void cancel(UUID run,UUID lease){try{send(request("/internal/v1/company-information/results/"+run+"/"+lease).DELETE().build());}catch(Exception ignored){if(ignored instanceof InterruptedException)Thread.currentThread().interrupt();}}
 private Result validate(byte[] body,UUID id,UUID lease,String version){
  try{var r=json.readValue(body,Result.class);
   if(!"1.0".equals(r.contractVersion())||!id.equals(r.runId())||!lease.equals(r.lease())||!Objects.equals(version,r.engineVersion())||!Set.of("COMPLETE","FAILED","CANCELLED").contains(Objects.toString(r.outcome(),""))||r.candidates()==null||r.candidates().size()>12||!"COMPLETE".equals(r.outcome())&&!r.candidates().isEmpty()||r.modelName()==null||r.modelName().isBlank()||r.modelName().length()>200||r.modelCalls()==null||r.modelCalls()<0||r.modelCalls()>8||(r.inputTokens()==null)!=(r.outputTokens()==null)||r.inputTokens()!=null&&(r.inputTokens()<0||r.outputTokens()<0)||"COMPLETE".equals(r.outcome())&&r.modelCalls()==0)throw new Failure("COMPANY_RESULT_UNKNOWN",true);return r;
  }catch(Failure f){throw f;}catch(Exception e){throw new Failure("COMPANY_RESULT_UNKNOWN",true);}
 }
 private static class Body implements HttpResponse.BodySubscriber<byte[]> {
  final HttpResponse.BodySubscriber<byte[]> delegate=HttpResponse.BodySubscribers.ofByteArray();Flow.Subscription subscription;int bytes;
  public CompletionStage<byte[]> getBody(){return delegate.getBody();}public void onSubscribe(Flow.Subscription s){subscription=s;delegate.onSubscribe(s);}
  public void onNext(List<ByteBuffer> parts){for(var b:parts){bytes+=b.remaining();if(bytes>131072){subscription.cancel();delegate.onError(new IllegalStateException("Result limit"));return;}}delegate.onNext(parts);}
  public void onError(Throwable t){delegate.onError(t);}public void onComplete(){delegate.onComplete();}
 }
}
