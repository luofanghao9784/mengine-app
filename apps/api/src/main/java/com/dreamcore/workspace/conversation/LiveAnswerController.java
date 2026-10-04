package com.dreamcore.workspace.conversation;

import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.IdentityService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class LiveAnswerController {
 private final LiveAnswerService service;private final IdentityService identities;
 private final ConcurrentHashMap<UUID,Set<SseEmitter>> connections=new ConcurrentHashMap<>();
 public LiveAnswerController(LiveAnswerService service,IdentityService identities){this.service=service;this.identities=identities;}
 private UUID token(String auth){try{return UUID.fromString(auth.substring("Bearer ".length()));}catch(Exception e){throw new IdentityException(403,"TASK_ACCESS_DENIED");}}
 @PostMapping("/internal/v1/agent-access/{task}/answer") public Map<String,Boolean> publish(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth,@RequestBody LiveAnswerService.Update value){if(auth==null||!auth.startsWith("Bearer "))throw new IdentityException(403,"TASK_ACCESS_DENIED");service.publish(task,token(auth),value);return Map.of("accepted",true);}
 @GetMapping("/api/v1/tenants/{tenant}/conversations/{conversation}/answer-snapshot") public ResponseEntity<?> snapshot(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID conversation){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("items",service.snapshot(UUID.fromString(auth.getName()),tenant,conversation)));}
 @GetMapping(value="/api/v1/tenants/{tenant}/conversations/{conversation}/answer-stream",produces=MediaType.TEXT_EVENT_STREAM_VALUE)
 public ResponseEntity<SseEmitter> stream(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID conversation,HttpServletRequest request){
  UUID actor=UUID.fromString(auth.getName());service.snapshot(actor,tenant,conversation);
  var session=request.getSession(false);if(session==null)throw new IdentityException(401,"AUTHENTICATION_REQUIRED");
  var emitter=new SseEmitter(35000L);var stopped=new AtomicBoolean(false);
  connections.compute(actor,(id,set)->{if(set==null)set=ConcurrentHashMap.newKeySet();if(set.size()>=4)throw new IdentityException(429,"TOO_MANY_STREAMS");set.add(emitter);return set;});
  Runnable cleanup=()->{stopped.set(true);connections.computeIfPresent(actor,(id,set)->{set.remove(emitter);return set.isEmpty()?null:set;});};
  emitter.onCompletion(cleanup);emitter.onTimeout(cleanup);emitter.onError(e->cleanup.run());
  Thread.startVirtualThread(()->{
   try{
    List<LiveAnswerService.Item> previous=null;long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(30);int ticks=0;
    while(!stopped.get()&&System.nanoTime()<end){
     Object context=session.getAttribute("SPRING_SECURITY_CONTEXT");
     if(!(context instanceof SecurityContext security)||security.getAuthentication()==null||!actor.toString().equals(security.getAuthentication().getName()))throw new IdentityException(401,"AUTHENTICATION_REQUIRED");
     Object credential=session.getAttribute("CREDENTIAL_VERSION");
     if(!identities.validSession(actor,credential instanceof Number n?n.longValue():0))throw new IdentityException(401,"AUTHENTICATION_REQUIRED");
     var current=service.snapshot(actor,tenant,conversation);
     // Full, versioned snapshots make reconnects idempotent, including after a missed final event.
     if(!current.equals(previous)){emitter.send(SseEmitter.event().name("answer").data(Map.of("items",current)));previous=current;}
     else if(++ticks%40==0)emitter.send(SseEmitter.event().comment("keepalive"));
     Thread.sleep(250);
    }
    emitter.complete();
   }catch(IdentityException e){try{emitter.send(SseEmitter.event().name("denied").data(Map.of("code",e.code)));}catch(Exception ignored){}emitter.complete();}
   catch(Exception e){emitter.complete();}finally{cleanup.run();}
  });
  return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header("X-Accel-Buffering","no").body(emitter);
 }
}
