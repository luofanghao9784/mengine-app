package com.dreamcore.workspace.experience;
import java.net.*;import java.net.http.*;import java.nio.ByteBuffer;import java.time.Duration;import java.util.*;import java.util.concurrent.*;import java.util.function.BooleanSupplier;
import org.springframework.beans.factory.annotation.Value;import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/** Internal fixed-method cleaning, privacy and general quality transport. Never exposes tenant originals to general-library readers. */
@Component
public class ExperienceGeneralizationRuntime {
 public record Descriptor(String contractVersion,String engineVersion,boolean configured,String executionClass) {}
 public record Method(String title,String summary,List<String> steps,List<String> applicable,List<String> excluded,List<String> tags,String basis) {}
 public record Job(UUID id,UUID lease,UUID tenant,UUID source,Method original,List<String> protectedValues) {}
 public record Stage(String stage,String modelName,Integer modelCalls,Long inputTokens,Long outputTokens) {}
 public record Result(String contractVersion,String engineVersion,String executionClass,UUID runId,UUID lease,UUID source,Boolean admitted,String outcome,String code,Method method,Map<String,String> privacy,Map<String,String> quality,List<Stage> stages) {}
 public static class Failure extends RuntimeException {public final String code;public final boolean sent;public Failure(String code,boolean sent){super(code);this.code=code;this.sent=sent;}}
 private final URI base;private final String token,mode;private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).followRedirects(HttpClient.Redirect.NEVER).build();private final JsonMapper json=new JsonMapper();
 public ExperienceGeneralizationRuntime(@Value("${dreamcore.engine.base-url}") String base,@Value("${dreamcore.tasks.engine-token:}") String token,@Value("${dreamcore.tasks.agent-mode:off}") String mode){
  this.base=URI.create(base);this.token=token;this.mode=mode;
  if(!Set.of("http","https").contains(this.base.getScheme())||this.base.getHost()==null||this.base.getUserInfo()!=null||this.base.getQuery()!=null||this.base.getFragment()!=null||!Set.of("","/").contains(this.base.getPath()))throw new IllegalArgumentException("Invalid engine endpoint");
 }
 public boolean configured(){return token.length()>=32&&Set.of("live","verification").contains(mode);}
 private HttpRequest.Builder request(String path){return HttpRequest.newBuilder(base.resolve(path)).header("Authorization","Bearer "+token).timeout(Duration.ofSeconds(3));}
 private HttpResponse<byte[]> send(HttpRequest r)throws Exception{return http.send(r,ignored->new Body());}
 public Descriptor preflight(){
  if(!configured())throw new Failure("MODEL_NOT_CONFIGURED",false);
  try{var response=send(request("/internal/v1/experience-generalization/runtime").GET().build());if(response.statusCode()!=200)throw new Failure("GENERALIZATION_ENGINE_UNAVAILABLE",false);var d=json.readValue(response.body(),Descriptor.class);
   if(!"1.0".equals(d.contractVersion())||d.engineVersion()==null||!d.engineVersion().matches("[A-Za-z0-9.\\-]{1,64}")||!d.configured()||!mode.equals(d.executionClass()))throw new Failure("GENERALIZATION_ENGINE_INCOMPATIBLE",false);return d;
  }catch(Failure f){throw f;}catch(Exception e){if(e instanceof InterruptedException)Thread.currentThread().interrupt();throw new Failure("GENERALIZATION_ENGINE_UNAVAILABLE",false);}
 }
 public Result execute(Job job,Descriptor descriptor,BooleanSupplier active){
  if(!configured())throw new Failure("MODEL_NOT_CONFIGURED",false);
  if(descriptor==null||!descriptor.configured()||!mode.equals(descriptor.executionClass())||!"1.0".equals(descriptor.contractVersion()))throw new Failure("GENERALIZATION_ENGINE_INCOMPATIBLE",false);
  if(job==null||job.id()==null||job.lease()==null||job.tenant()==null||job.source()==null||!validMethod(job.original())||!texts(job.protectedValues(),0,100,300))throw new Failure("INVALID_GENERALIZATION_REQUEST",false);
  CompletableFuture<HttpResponse<byte[]>> future=null;
  try{
   if(!active.getAsBoolean())throw new Failure("GENERALIZATION_SOURCE_CHANGED",false);
   var req=request("/internal/v1/experience-generalization/results").timeout(Duration.ofSeconds(140)).header("Content-Type","application/json").header("X-Dreamcore-Engine-Version",descriptor.engineVersion()).POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("contractVersion","1.0","job",job)))).build();
   future=http.sendAsync(req,ignored->new Body());long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(142);
   while(System.nanoTime()<until){
    if(!active.getAsBoolean()){cancel(job.id(),job.lease());throw new Failure("GENERALIZATION_SOURCE_CHANGED",true);}
    try{var response=future.get(300,TimeUnit.MILLISECONDS);
     if(response.statusCode()==200)return validate(response.body(),job,descriptor.engineVersion(),mode);
     if(response.statusCode()==409 && "GENERALIZATION_ATTEMPT_CONFLICT".equals(json.readTree(response.body()).path("code").asString()))throw new Failure("GENERALIZATION_RESULT_UNKNOWN",true);
     if(Set.of(400,401,403,409,413,429,503).contains(response.statusCode()))throw new Failure(response.statusCode()==429?"ENGINE_BUSY":"GENERALIZATION_ENGINE_UNAVAILABLE",false);
     throw new Failure("GENERALIZATION_RESULT_UNKNOWN",true);
    }catch(TimeoutException waiting){}
   }
   throw new Failure("GENERALIZATION_RESULT_UNKNOWN",true);
  }catch(Failure f){throw f;}catch(Exception e){if(e instanceof InterruptedException)Thread.currentThread().interrupt();throw new Failure(future==null?"GENERALIZATION_ENGINE_UNAVAILABLE":"GENERALIZATION_RESULT_UNKNOWN",future!=null);}
  finally{if(future!=null&&!future.isDone())future.cancel(true);}
 }
 public Result recover(Job job,String version){
  try{var response=send(request("/internal/v1/experience-generalization/results/"+job.id()+"/"+job.lease()).GET().build());if(response.statusCode()==202)return null;if(response.statusCode()!=200)throw new Failure("GENERALIZATION_RESULT_UNKNOWN",true);return validate(response.body(),job,version,mode);}
  catch(Failure f){throw f;}catch(Exception e){if(e instanceof InterruptedException)Thread.currentThread().interrupt();throw new Failure("GENERALIZATION_RESULT_UNKNOWN",true);}
 }
 public void cancel(UUID run,UUID lease){try{send(request("/internal/v1/experience-generalization/results/"+run+"/"+lease).DELETE().build());}catch(Exception ignored){if(ignored instanceof InterruptedException)Thread.currentThread().interrupt();}}
 public static final Set<String> PRIVACY=Set.of("identifiersRemoved","combinationsSafe","sourceSupported","conditionsPreserved","claimsPreserved");
 public static final Set<String> QUALITY=Set.of("reusable","bounded","clear","evidenceHonest","nonIdentifying");
 private static final List<String> STAGES=List.of("CLEAN","PRIVACY","QUALITY");
 private static boolean text(String s,int size){return s!=null&&!s.isBlank()&&s.length()<=size;}
 private static boolean texts(List<String> s,int min,int max,int size){return s!=null&&s.size()>=min&&s.size()<=max&&s.stream().allMatch(v->text(v,size))&&new HashSet<>(s).size()==s.size();}
 public static boolean validMethod(Method m){return m!=null&&text(m.title(),160)&&text(m.summary(),600)&&texts(m.steps(),1,10,800)&&texts(m.applicable(),1,8,300)&&texts(m.excluded(),1,8,300)&&texts(m.tags(),1,10,40)&&m.basis()!=null&&Set.of("OBSERVED_EXECUTION","FEEDBACK_CORRECTION").contains(m.basis());}
 private static boolean checks(Map<String,String> c,Set<String> keys){return c!=null&&c.keySet().equals(keys)&&c.values().stream().allMatch(v->v!=null&&Set.of("PASS","FAIL","UNKNOWN").contains(v));}
 private static boolean passed(Map<String,String> c){return c!=null&&c.values().stream().allMatch("PASS"::equals);}
 private static String normalized(String s){return java.text.Normalizer.normalize(s,java.text.Normalizer.Form.NFKC).replaceAll("[\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u206f\\ufeff]","").toLowerCase(Locale.ROOT);}
 public boolean protectedContent(Method m,List<String> values){
  String body=normalized(json.writeValueAsString(m));
  return values.stream().anyMatch(v->body.contains(normalized(v)))||java.util.regex.Pattern.compile("[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}|https?://|\\b(?:bearer\\s+|sk-)[a-z0-9_-]{12,}|\\b1[3-9]\\d{9}\\b|\\b\\d{17}[\\dx]\\b|[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}",java.util.regex.Pattern.CASE_INSENSITIVE).matcher(body).find();
 }
 private static boolean exact(tools.jackson.databind.JsonNode node,Set<String> names){return node!=null&&node.isObject()&&node.size()==names.size()&&names.stream().allMatch(node::has);}
 public Result validateReceipt(Result result,Job job,String version,String expectedMode){return validate(json.writeValueAsBytes(result),job,version,expectedMode);}
 private Result validate(byte[] body,Job job,String version,String expectedMode){
  try{
   var tree=json.readTree(body);
   if(!exact(tree,Set.of("contractVersion","engineVersion","executionClass","runId","lease","source","admitted","outcome","code","method","privacy","quality","stages")))throw new Failure("GENERALIZATION_RESULT_UNKNOWN",true);
   if(!tree.path("method").isNull()&&!exact(tree.get("method"),Set.of("title","summary","steps","applicable","excluded","tags","basis")))throw new Failure("GENERALIZATION_RESULT_UNKNOWN",true);
   if(!tree.path("stages").isArray())throw new Failure("GENERALIZATION_RESULT_UNKNOWN",true);
   for(var stage:tree.get("stages"))if(!exact(stage,Set.of("stage","modelName","modelCalls","inputTokens","outputTokens")))throw new Failure("GENERALIZATION_RESULT_UNKNOWN",true);
   var r=json.readValue(body,Result.class);
   if(!"1.0".equals(r.contractVersion())||!job.id().equals(r.runId())||!job.lease().equals(r.lease())||!job.source().equals(r.source())||!expectedMode.equals(r.executionClass())||!Objects.equals(version,r.engineVersion())||!Boolean.FALSE.equals(r.admitted())||!Set.of("QUALIFIED","SKIPPED","REJECTED","FAILED","CANCELLED").contains(r.outcome())||r.stages()==null||r.stages().isEmpty()||r.stages().size()>3)throw new Failure("GENERALIZATION_RESULT_UNKNOWN",true);
   for(int n=0;n<r.stages().size();n++){var s=r.stages().get(n);if(s==null||!Objects.equals(STAGES.get(n),s.stage())||!text(s.modelName(),200)||s.modelCalls()==null||s.modelCalls()<0||s.modelCalls()>6||(s.inputTokens()==null)!=(s.outputTokens()==null)||s.inputTokens()!=null&&(s.inputTokens()<0||s.outputTokens()<0))throw new Failure("GENERALIZATION_RESULT_UNKNOWN",true);}
   if(r.privacy()!=null&&(!checks(r.privacy(),PRIVACY)||r.stages().size()<2)||r.quality()!=null&&(!checks(r.quality(),QUALITY)||r.stages().size()!=3||!passed(r.privacy())))throw new Failure("GENERALIZATION_RESULT_UNKNOWN",true);
   if(r.outcome().equals("QUALIFIED")){
    if(r.code()!=null||r.stages().size()!=3||r.stages().stream().anyMatch(s->s.modelCalls()==0)||!validMethod(r.method())||!r.method().basis().equals(job.original().basis())||protectedContent(r.method(),job.protectedValues())||!checks(r.privacy(),PRIVACY)||!checks(r.quality(),QUALITY)||!passed(r.privacy())||!passed(r.quality()))throw new Failure("GENERALIZATION_RESULT_UNKNOWN",true);
   }else{
    if(r.method()!=null)throw new Failure("GENERALIZATION_RESULT_UNKNOWN",true);
    switch(r.outcome()){
     case "SKIPPED" -> {if(r.stages().size()!=1||r.privacy()!=null||r.quality()!=null||!Set.of("REQUIRES_PRIVATE_CONTEXT","INSUFFICIENT_EVIDENCE","NO_GENERAL_VALUE").contains(r.code()))throw new Failure("GENERALIZATION_RESULT_UNKNOWN",true);}
     case "REJECTED" -> {if(!Set.of("PROTECTED_CONTENT","PRIVACY_NOT_ESTABLISHED","QUALITY_NOT_ESTABLISHED").contains(r.code())||r.code().equals("PRIVACY_NOT_ESTABLISHED")&&(!checks(r.privacy(),PRIVACY)||passed(r.privacy())||r.stages().size()!=2||r.quality()!=null)||r.code().equals("QUALITY_NOT_ESTABLISHED")&&(!checks(r.quality(),QUALITY)||passed(r.quality())||r.stages().size()!=3))throw new Failure("GENERALIZATION_RESULT_UNKNOWN",true);}
     case "FAILED" -> {if(!"GENERALIZATION_FAILED".equals(r.code()))throw new Failure("GENERALIZATION_RESULT_UNKNOWN",true);}
     case "CANCELLED" -> {if(!"CANCELLED".equals(r.code()))throw new Failure("GENERALIZATION_RESULT_UNKNOWN",true);}
    }
   }return r;
  }catch(Failure f){throw f;}catch(Exception e){throw new Failure("GENERALIZATION_RESULT_UNKNOWN",true);}
 }
 private static class Body implements HttpResponse.BodySubscriber<byte[]> {
  final HttpResponse.BodySubscriber<byte[]> delegate=HttpResponse.BodySubscribers.ofByteArray();Flow.Subscription subscription;int bytes;
  public CompletionStage<byte[]> getBody(){return delegate.getBody();}public void onSubscribe(Flow.Subscription s){subscription=s;delegate.onSubscribe(s);}
  public void onNext(List<ByteBuffer> parts){for(var b:parts){bytes+=b.remaining();if(bytes>131072){subscription.cancel();delegate.onError(new IllegalStateException("Result limit"));return;}}delegate.onNext(parts);}
  public void onError(Throwable t){delegate.onError(t);}public void onComplete(){delegate.onComplete();}
 }
}
