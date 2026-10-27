package com.dreamcore.workspace.conversation;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import com.dreamcore.workspace.identity.IdentityException;
import tools.jackson.databind.json.JsonMapper;

@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class NativeConversationInteractionController {
 private final NativeConversationService sessions;private final NativeConversationStream stream;private final NativeRuntimeClient runtime;
 private final NativeConversationFeedback feedback;private final String controlToken;
 private final JsonMapper json=new JsonMapper();
 private final ScheduledExecutorService timer=Executors.newScheduledThreadPool(2);
 private final ConcurrentHashMap<UUID,AtomicInteger> connections=new ConcurrentHashMap<>();
 public NativeConversationInteractionController(NativeConversationService sessions,NativeConversationStream stream,NativeRuntimeClient runtime,NativeConversationFeedback feedback,@org.springframework.beans.factory.annotation.Value("${dreamcore.native.control-token:}") String controlToken){this.controlToken=controlToken;this.feedback=feedback;this.sessions=sessions;this.stream=stream;this.runtime=runtime;}
 @jakarta.annotation.PreDestroy void close(){timer.shutdownNow();}
 private UUID actor(Authentication a){return UUID.fromString(a.getName());}
 private UUID key(Map<String,Object> body){try{return UUID.fromString((String)body.get("requestId"));}catch(Exception e){throw IdentityException.invalid();}}
 private String value(Map<String,Object> b,String k,int max){if(!(b.get(k) instanceof String s)||s.isBlank()||s.length()>max)throw IdentityException.invalid();return s;}
 private void fields(Map<String,Object> b,String... allowed){if(!Set.of(allowed).containsAll(b.keySet()))throw IdentityException.invalid();key(b);}
 private Object dispatch(Authentication auth,UUID tenant,UUID id,String action,Map<String,Object> body){
  UUID actor=actor(auth),key=key(body);sessions.require(actor,tenant,id,true);runtime.available();
  var prior=stream.claim(actor,tenant,id,key,action,body);if(prior!=null)return prior;
  boolean handedOff=false;
  try{
   var grant=sessions.grant(actor,tenant,id);handedOff=true;
   var result=runtime.command(id,grant.token(),action,body);
   stream.complete(actor,tenant,id,key,result);return result;
  }catch(RuntimeException e){
   if(!handedOff||e instanceof NativeRuntimeClient.NotDispatched)stream.releaseUndispatched(actor,tenant,id,key);
   if(e instanceof NativeRuntimeClient.NotDispatched)throw new IdentityException(503,"NATIVE_RUNTIME_NOT_DISPATCHED");
   throw e;
  }
 }
 @GetMapping("/api/v1/tenants/{tenant}/native-conversations/{id}/history") public Object history(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@RequestParam(defaultValue="0") long after,@RequestParam(defaultValue="200") int limit){var items=stream.history(actor(auth),tenant,id,after,limit);return Map.of("items",items,"hasMore",items.size()==limit);}
 @GetMapping("/api/v1/tenants/{tenant}/native-conversations/{id}/status") public Object status(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id){return stream.status(actor(auth),tenant,id);}
 @GetMapping(value="/api/v1/tenants/{tenant}/native-conversations/{id}/events",produces="text/event-stream") public SseEmitter events(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@RequestParam(defaultValue="0") long after,@RequestHeader(value="Last-Event-ID",required=false) String last){
  UUID actor=actor(auth);long cursor=after;
  try{if(last!=null)cursor=Math.max(cursor,Long.parseLong(last));}catch(Exception e){throw IdentityException.invalid();}
  stream.history(actor,tenant,id,cursor,1);
  var count=connections.computeIfAbsent(actor,k->new AtomicInteger());if(count.incrementAndGet()>4){count.decrementAndGet();throw new IdentityException(429,"NATIVE_STREAM_LIMIT");}
  var emitter=new SseEmitter(25000L);var position=new AtomicLong(cursor);var closed=new AtomicBoolean();var scheduled=new AtomicReference<ScheduledFuture<?>>();
  Runnable cleanup=()->{if(closed.compareAndSet(false,true)){count.decrementAndGet();var future=scheduled.get();if(future!=null)future.cancel(false);}};
  emitter.onCompletion(cleanup);emitter.onTimeout(()->{cleanup.run();emitter.complete();});emitter.onError(e->cleanup.run());
  var future=timer.scheduleWithFixedDelay(()->{
   if(closed.get())return;
   try{
    for(var event:stream.events(actor,tenant,id,position.get(),200)){
     long seq=((Number)event.get("seq")).longValue();emitter.send(SseEmitter.event().id(Long.toString(seq)).name("status".equals(event.get("type"))?"status":"message").data(event));position.set(seq);
    }
    emitter.send(SseEmitter.event().comment("keepalive"));
   }catch(Exception e){cleanup.run();emitter.complete();}
  },0,1,TimeUnit.SECONDS);scheduled.set(future);if(closed.get())future.cancel(false);return emitter;
 }
 @PostMapping("/api/v1/tenants/{tenant}/native-conversations/{id}/messages") public Object message(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@RequestBody Map<String,Object> body){
  fields(body,"requestId","text","materials");value(body,"text",100000);
  var refs=new ArrayList<NativeConversationService.Reference>();
  try{Object raw=body.getOrDefault("materials",List.of());if(!(raw instanceof List<?> list)||list.size()>20)throw IdentityException.invalid();for(Object r:list)refs.add(json.convertValue(r,NativeConversationService.Reference.class));}catch(Exception e){throw IdentityException.invalid();}
  sessions.references(actor(auth),tenant,id,refs);return dispatch(auth,tenant,id,"messages",body);
 }
 @PostMapping("/api/v1/tenants/{tenant}/native-conversations/{id}/turn/stop") public Object stop(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@RequestBody Map<String,Object> body){fields(body,"requestId");return dispatch(auth,tenant,id,"turn-stop",body);}
 @PostMapping("/api/v1/tenants/{tenant}/native-conversations/{id}/questions/{callId}/answer") public Object answer(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@PathVariable String callId,@RequestBody Map<String,Object> body){
  fields(body,"requestId","answers");if(callId.length()>200||!(body.get("answers") instanceof List<?> answers)||answers.size()>20||json.writeValueAsString(answers).length()>50000)throw IdentityException.invalid();
  var command=new LinkedHashMap<>(body);command.put("callId",callId);return dispatch(auth,tenant,id,"answer",command);
 }
 @PostMapping("/api/v1/tenants/{tenant}/native-conversations/{id}/approvals/{approvalId}") public Object approve(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@PathVariable String approvalId,@RequestBody Map<String,Object> body){
  fields(body,"requestId","decision");if(approvalId.length()>200||!Set.of("ALLOW_ONCE","REJECT").contains(value(body,"decision",20)))throw IdentityException.invalid();
  var command=new LinkedHashMap<>(body);command.put("approvalId",approvalId);return dispatch(auth,tenant,id,"approval",command);
 }
 @PostMapping("/api/v1/tenants/{tenant}/native-conversations/{id}/plans/{callId}/review") public Object plan(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@PathVariable String callId,@RequestBody Map<String,Object> body){
  fields(body,"requestId","decision","comment");if(callId.length()>200||!Set.of("APPROVE","REVISE").contains(value(body,"decision",20))||body.containsKey("comment")&&(!(body.get("comment") instanceof String s)||s.length()>10000))throw IdentityException.invalid();
  var command=new LinkedHashMap<>(body);command.put("callId",callId);return dispatch(auth,tenant,id,"plan-review",command);
 }
 @PostMapping("/api/v1/tenants/{tenant}/native-conversations/{id}/feedback") public Object feedback(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@RequestBody Map<String,Object> body){fields(body,"requestId","messageKey","value");return feedback.rate(actor(auth),tenant,id,key(body),value(body,"messageKey",30),value(body,"value",10));}
 @GetMapping("/api/v1/tenants/{tenant}/native-conversations/{id}/feedback") public Object feedbackList(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id){return feedback.list(actor(auth),tenant,id);}
 @PostMapping("/internal/v1/native-conversations/{id}/events-write") public Object ingest(@PathVariable UUID id,@RequestHeader(value="Authorization",required=false) String token,@RequestBody NativeConversationStream.Ingest body,@RequestHeader(value="X-Dreamcore-Control",required=false) String control){if(controlToken.length()<32||!controlToken.equals(control)||token==null||!token.startsWith("Bearer "))throw new IdentityException(403,"NATIVE_ACCESS_DENIED");return stream.append(id,token.substring(7),body);}
}
