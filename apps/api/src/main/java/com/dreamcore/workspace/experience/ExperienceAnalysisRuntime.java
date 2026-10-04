package com.dreamcore.workspace.experience;
import com.dreamcore.workspace.identity.IdentityException;
import java.net.*;import java.net.http.*;import java.nio.ByteBuffer;import java.time.Duration;import java.util.*;import java.util.concurrent.*;import java.util.function.BooleanSupplier;
import org.springframework.beans.factory.annotation.Value;import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/** Internal fixed-source extraction/verification transport. Never a public source read or admission endpoint. */
@Component
public class ExperienceAnalysisRuntime {
 public record Descriptor(String contractVersion,String engineVersion,boolean configured,String executionClass) {}
 public record Input(UUID id,String kind,String text,boolean complete) {}
 public record Existing(UUID versionId,String title,String summary,List<String> steps,List<String> applicable,List<String> excluded) {}
 public record Job(UUID id,UUID lease,UUID tenant,UUID source,List<Input> inputs,List<Existing> existing,List<String> protectedValues,@com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL) String scope) {
  public Job(UUID id,UUID lease,UUID tenant,UUID source,List<Input> inputs,List<Existing> existing,List<String> protectedValues){this(id,lease,tenant,source,inputs,existing,protectedValues,null);}
  public static Job platform(UUID id,UUID lease,UUID source,List<Input> inputs,List<Existing> existing,List<String> protectedValues){return new Job(id,lease,null,source,inputs,existing,protectedValues,"PLATFORM");}
 }
 public record Evidence(UUID inputId,String quote) {}
 public record Candidate(UUID targetVersionId,String title,String summary,List<String> steps,List<String> applicable,List<String> excluded,List<String> tags,List<Evidence> evidence) {}
 public record Review(Map<String,String> checks,String basis,List<Evidence> evidence) {}
 public record Stage(String stage,String modelName,Integer modelCalls,Long inputTokens,Long outputTokens) {}
 public record Result(String contractVersion,String engineVersion,String executionClass,UUID runId,UUID lease,UUID source,Boolean admitted,String outcome,String code,Candidate candidate,Review review,List<Stage> stages,@com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL) String scope) {
  public Result(String contractVersion,String engineVersion,String executionClass,UUID runId,UUID lease,UUID source,Boolean admitted,String outcome,String code,Candidate candidate,Review review,List<Stage> stages){this(contractVersion,engineVersion,executionClass,runId,lease,source,admitted,outcome,code,candidate,review,stages,null);}
 }
 public static class Failure extends RuntimeException {public final String code;public final boolean sent;public Failure(String code,boolean sent){super(code);this.code=code;this.sent=sent;}}
 private final URI base;private final String token,mode;private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).followRedirects(HttpClient.Redirect.NEVER).build();private final JsonMapper json=new JsonMapper();
 public ExperienceAnalysisRuntime(@Value("${dreamcore.engine.base-url}") String base,@Value("${dreamcore.tasks.engine-token:}") String token,@Value("${dreamcore.tasks.agent-mode:off}") String mode){
  this.base=URI.create(base);this.token=token;this.mode=mode;
  if(!Set.of("http","https").contains(this.base.getScheme())||this.base.getHost()==null||this.base.getUserInfo()!=null||this.base.getQuery()!=null||this.base.getFragment()!=null||!Set.of("","/").contains(this.base.getPath()))throw new IllegalArgumentException("Invalid engine endpoint");
 }
 public boolean configured(){return token.length()>=32&&Set.of("live","verification").contains(mode);}
 private HttpRequest.Builder request(String path){return HttpRequest.newBuilder(base.resolve(path)).header("Authorization","Bearer "+token).timeout(Duration.ofSeconds(3));}
 private HttpResponse<byte[]> send(HttpRequest r)throws Exception{return http.send(r,ignored->new Body());}
 public Descriptor preflight(){
  if(!configured())throw new Failure("MODEL_NOT_CONFIGURED",false);
  try{var response=send(request("/internal/v1/experience/runtime").GET().build());if(response.statusCode()!=200)throw new Failure("EXPERIENCE_ENGINE_UNAVAILABLE",false);var d=json.readValue(response.body(),Descriptor.class);
   if(!"1.0".equals(d.contractVersion())||d.engineVersion()==null||!d.engineVersion().matches("[A-Za-z0-9.\\-]{1,64}")||!d.configured()||!mode.equals(d.executionClass()))throw new Failure("EXPERIENCE_ENGINE_INCOMPATIBLE",false);return d;
  }catch(Failure f){throw f;}catch(Exception e){if(e instanceof InterruptedException)Thread.currentThread().interrupt();throw new Failure("EXPERIENCE_ENGINE_UNAVAILABLE",false);}
 }
 public Result execute(Job job,Descriptor descriptor,BooleanSupplier active){
  if(!configured())throw new Failure("MODEL_NOT_CONFIGURED",false);
  if(descriptor==null||!descriptor.configured()||!mode.equals(descriptor.executionClass())||!"1.0".equals(descriptor.contractVersion()))throw new Failure("EXPERIENCE_ENGINE_INCOMPATIBLE",false);
  if(!validJob(job))throw new Failure("INVALID_EXPERIENCE_REQUEST",false);
  CompletableFuture<HttpResponse<byte[]>> future=null;
  try{
   if(!active.getAsBoolean())throw new Failure("EXPERIENCE_SOURCE_CHANGED",false);
   var req=request("/internal/v1/experience/results").timeout(Duration.ofSeconds(95)).header("Content-Type","application/json").header("X-Dreamcore-Engine-Version",descriptor.engineVersion()).POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("contractVersion","1.0","job",job)))).build();
   future=http.sendAsync(req,ignored->new Body());long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(97);
   while(System.nanoTime()<until){
    if(!active.getAsBoolean()){cancel(job.id(),job.lease());throw new Failure("EXPERIENCE_SOURCE_CHANGED",true);}
    try{var response=future.get(300,TimeUnit.MILLISECONDS);
     if(response.statusCode()==200)return validate(response.body(),job,descriptor.engineVersion());
     if(response.statusCode()==409 && "EXPERIENCE_ATTEMPT_CONFLICT".equals(json.readTree(response.body()).path("code").asString()))throw new Failure("EXPERIENCE_RESULT_UNKNOWN",true);
     if(Set.of(400,401,403,409,413,429,503).contains(response.statusCode()))throw new Failure(response.statusCode()==429?"ENGINE_BUSY":"EXPERIENCE_ENGINE_UNAVAILABLE",false);
     throw new Failure("EXPERIENCE_RESULT_UNKNOWN",true);
    }catch(TimeoutException waiting){}
   }
   throw new Failure("EXPERIENCE_RESULT_UNKNOWN",true);
  }catch(Failure f){throw f;}catch(Exception e){if(e instanceof InterruptedException)Thread.currentThread().interrupt();throw new Failure(future==null?"EXPERIENCE_ENGINE_UNAVAILABLE":"EXPERIENCE_RESULT_UNKNOWN",future!=null);}
  finally{if(future!=null&&!future.isDone())future.cancel(true);}
 }
 public Result recover(Job job,String version){
  if(!validJob(job))throw new Failure("INVALID_EXPERIENCE_REQUEST",false);
  try{var response=send(request("/internal/v1/experience/results/"+job.id()+"/"+job.lease()).GET().build());if(response.statusCode()==202)return null;if(response.statusCode()!=200)throw new Failure("EXPERIENCE_RESULT_UNKNOWN",true);return validate(response.body(),job,version);}
  catch(Failure f){throw f;}catch(Exception e){if(e instanceof InterruptedException)Thread.currentThread().interrupt();throw new Failure("EXPERIENCE_RESULT_UNKNOWN",true);}
 }
 public void cancel(UUID run,UUID lease){try{send(request("/internal/v1/experience/results/"+run+"/"+lease).DELETE().build());}catch(Exception ignored){if(ignored instanceof InterruptedException)Thread.currentThread().interrupt();}}
 private static final Set<String> CHECKS=Set.of("grounded","reusable","bounded","privacySafe","novel");
 private static boolean text(String s,int size){return s!=null&&!s.isBlank()&&s.length()<=size;}
 private static boolean texts(List<String> s,int min,int max,int size){return s!=null&&s.size()>=min&&s.size()<=max&&s.stream().allMatch(v->text(v,size))&&new HashSet<>(s).size()==s.size();}
 private static boolean validJob(Job j){
  if(j==null||j.id()==null||j.lease()==null||j.source()==null||!ExperienceProcessingScope.valid(j.tenant(),j.scope())||!texts(j.protectedValues(),0,100,300)||j.inputs()==null||j.inputs().isEmpty()||j.inputs().size()>8||j.existing()==null||j.existing().size()>5)return false;
  if(j.inputs().stream().anyMatch(i->i==null||i.id()==null||i.kind()==null||!Set.of("TASK_INPUT","TASK_RESULT","FEEDBACK","EXECUTION_RECORD","SOURCE_EXCERPT").contains(i.kind())||!text(i.text(),8000))||j.inputs().stream().map(Input::id).distinct().count()!=j.inputs().size())return false;
  if(j.existing().stream().anyMatch(e->e==null||e.versionId()==null||!text(e.title(),160)||!text(e.summary(),600)||!texts(e.steps(),1,10,800)||!texts(e.applicable(),1,8,300)||!texts(e.excluded(),1,8,300))||j.existing().stream().map(Existing::versionId).distinct().count()!=j.existing().size())return false;
  return !"PLATFORM".equals(j.scope())||(j.existing().size()==1&&j.inputs().stream().allMatch(i->i.complete()&&Set.of("SOURCE_EXCERPT","FEEDBACK").contains(i.kind()))&&Set.of("SOURCE_EXCERPT","FEEDBACK").stream().allMatch(k->j.inputs().stream().anyMatch(i->k.equals(i.kind()))));
 }
 private boolean evidence(List<Evidence> refs,Job job){return refs!=null&&!refs.isEmpty()&&refs.size()<=8&&refs.stream().allMatch(e->e!=null&&e.inputId()!=null&&text(e.quote(),1000)&&job.inputs().stream().anyMatch(i->i.id().equals(e.inputId())&&i.text().contains(e.quote())));}
 private boolean candidate(Candidate c,Job job){return c!=null&&(c.targetVersionId()==null||job.existing().stream().anyMatch(e->e.versionId().equals(c.targetVersionId())))&&(!"PLATFORM".equals(job.scope())||Objects.equals(c.targetVersionId(),job.existing().getFirst().versionId()))&&text(c.title(),160)&&text(c.summary(),600)&&texts(c.steps(),1,10,800)&&texts(c.applicable(),1,8,300)&&texts(c.excluded(),1,8,300)&&texts(c.tags(),1,10,50)&&evidence(c.evidence(),job);}
 private boolean review(Review r,Job job){return r!=null&&r.checks()!=null&&r.checks().keySet().equals(CHECKS)&&r.checks().values().stream().allMatch(v->Set.of("PASS","FAIL","UNKNOWN").contains(v))&&Set.of("OBSERVED_EXECUTION","FEEDBACK_CORRECTION","REPORTED_ONLY","INSUFFICIENT").contains(r.basis())&&evidence(r.evidence(),job);}
 private static String normalized(String s){return java.text.Normalizer.normalize(s,java.text.Normalizer.Form.NFKC).replaceAll("[\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u206f\\ufeff]","").toLowerCase(Locale.ROOT);}
 private boolean protectedContent(Candidate c,Job job){
  String body=normalized(json.writeValueAsString(List.of(c.title(),c.summary(),c.steps(),c.applicable(),c.excluded(),c.tags())));
  return job.protectedValues().stream().anyMatch(v->body.contains(normalized(v)))||java.util.regex.Pattern.compile("[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}|https?://|\\b(?:bearer\\s+|sk-)[a-z0-9_-]{12,}|\\b1[3-9]\\d{9}\\b|\\b\\d{17}[\\dx]\\b|[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}",java.util.regex.Pattern.CASE_INSENSITIVE).matcher(body).find();
 }
 public Result validateReceipt(Result result,Job job,String version){
  if(!validJob(job))throw new Failure("INVALID_EXPERIENCE_REQUEST",false);
  return validate(json.writeValueAsBytes(result),job,version);
 }
 private Result validate(byte[] body,Job job,String version){
  try{if(json.readTree(body).has("scope")!=(job.scope()!=null))throw new Failure("EXPERIENCE_RESULT_UNKNOWN",true);var r=json.readValue(body,Result.class);
   if(!"1.0".equals(r.contractVersion())||!job.id().equals(r.runId())||!job.lease().equals(r.lease())||!job.source().equals(r.source())||!Objects.equals(job.scope(),r.scope())||!mode.equals(r.executionClass())||!Objects.equals(version,r.engineVersion())||!Boolean.FALSE.equals(r.admitted())||!Set.of("QUALIFIED","SKIPPED","REJECTED","FAILED","CANCELLED").contains(r.outcome())||r.stages()==null||r.stages().isEmpty()||r.stages().size()>2)throw new Failure("EXPERIENCE_RESULT_UNKNOWN",true);
   for(int n=0;n<r.stages().size();n++){var s=r.stages().get(n);if(s==null||!Objects.equals(n==0?"EXTRACT":"VERIFY",s.stage())||!text(s.modelName(),200)||s.modelCalls()==null||s.modelCalls()<0||s.modelCalls()>6||(s.inputTokens()==null)!=(s.outputTokens()==null)||s.inputTokens()!=null&&(s.inputTokens()<0||s.outputTokens()<0))throw new Failure("EXPERIENCE_RESULT_UNKNOWN",true);}
   if(r.outcome().equals("QUALIFIED")){
    if(r.code()!=null||r.stages().size()!=2||r.stages().stream().anyMatch(s->s.modelCalls()==0)||!candidate(r.candidate(),job)||protectedContent(r.candidate(),job)||!review(r.review(),job)||r.review().checks().values().stream().anyMatch(v->!v.equals("PASS")))throw new Failure("EXPERIENCE_RESULT_UNKNOWN",true);
    boolean observed=r.review().basis().equals("OBSERVED_EXECUTION")&&r.review().evidence().stream().anyMatch(e->job.inputs().stream().anyMatch(i->i.id().equals(e.inputId())&&i.kind().equals("EXECUTION_RECORD")));
    boolean corrected=r.review().basis().equals("FEEDBACK_CORRECTION")&&r.review().evidence().stream().anyMatch(e->job.inputs().stream().anyMatch(i->i.id().equals(e.inputId())&&i.kind().equals("FEEDBACK")))&&r.review().evidence().stream().anyMatch(e->job.inputs().stream().anyMatch(i->i.id().equals(e.inputId())&&!i.kind().equals("FEEDBACK")));
    if(!observed&&!corrected)throw new Failure("EXPERIENCE_RESULT_UNKNOWN",true);
   }else{
    if(r.candidate()!=null)throw new Failure("EXPERIENCE_RESULT_UNKNOWN",true);
    if(r.outcome().equals("REJECTED")){if(!Set.of("PROTECTED_CONTENT","QUALITY_NOT_ESTABLISHED").contains(r.code())||r.review()!=null&&!review(r.review(),job))throw new Failure("EXPERIENCE_RESULT_UNKNOWN",true);}
    else if(r.review()!=null)throw new Failure("EXPERIENCE_RESULT_UNKNOWN",true);
    if(r.outcome().equals("SKIPPED")&&(r.stages().size()!=1||!Set.of("NO_REUSABLE_METHOD","DUPLICATE","PREFERENCE_ONLY","PRODUCT_ISSUE","INSUFFICIENT_EVIDENCE").contains(r.code()))||r.outcome().equals("FAILED")&&!"EXPERIENCE_ANALYSIS_FAILED".equals(r.code())||r.outcome().equals("CANCELLED")&&!"CANCELLED".equals(r.code()))throw new Failure("EXPERIENCE_RESULT_UNKNOWN",true);
   }
   return r;
  }catch(Failure f){throw f;}catch(Exception e){throw new Failure("EXPERIENCE_RESULT_UNKNOWN",true);}
 }
 private static class Body implements HttpResponse.BodySubscriber<byte[]> {
  final HttpResponse.BodySubscriber<byte[]> delegate=HttpResponse.BodySubscribers.ofByteArray();Flow.Subscription subscription;int bytes;
  public CompletionStage<byte[]> getBody(){return delegate.getBody();}public void onSubscribe(Flow.Subscription s){subscription=s;delegate.onSubscribe(s);}
  public void onNext(List<ByteBuffer> parts){for(var b:parts){bytes+=b.remaining();if(bytes>131072){subscription.cancel();delegate.onError(new IllegalStateException("Result limit"));return;}}delegate.onNext(parts);}
  public void onError(Throwable t){delegate.onError(t);}public void onComplete(){delegate.onComplete();}
 }
}
