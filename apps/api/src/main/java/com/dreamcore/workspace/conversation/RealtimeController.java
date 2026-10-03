package com.dreamcore.workspace.conversation;

import java.util.*;
import java.nio.charset.StandardCharsets;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;
import com.dreamcore.workspace.identity.IdentityException;
import tools.jackson.databind.json.JsonMapper;

@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class RealtimeController {
    private final ConversationRealtime live;private final JsonMapper json=new JsonMapper();
    public RealtimeController(ConversationRealtime live){this.live=live;}
    private UUID attempt(String auth){try{if(auth==null||!auth.startsWith("Bearer "))throw new IllegalArgumentException();return UUID.fromString(auth.substring(7));}catch(Exception e){throw IdentityException.denied();}}
    @PostMapping("/internal/v1/agent-access/{task}/live/open") public Object open(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth){return live.open(task,attempt(auth));}
    @PostMapping("/internal/v1/agent-access/{task}/live/control") public Object control(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth){return live.control(task,attempt(auth));}
    @PostMapping("/internal/v1/agent-access/{task}/live/output") public Object output(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth,@RequestBody ConversationRealtime.Output body){live.output(task,attempt(auth),body);return Map.of("accepted",true);}
    @PostMapping("/internal/v1/agent-access/{task}/live/started") public Object started(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth){live.started(task,attempt(auth));return Map.of("accepted",true);}
    @PostMapping("/internal/v1/agent-access/{task}/live/applied") public Object applied(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth,@RequestBody ConversationRealtime.Applied body){live.applied(task,attempt(auth),body);return Map.of("accepted",true);}
    @PostMapping("/internal/v1/agent-access/{task}/live/question") public Object question(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth,@RequestBody ConversationRealtime.Question body){live.question(task,attempt(auth),body);return Map.of("accepted",true);}
    @PostMapping("/internal/v1/agent-access/{task}/live/stopped") public Object stopped(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth){live.stopped(task,attempt(auth));return Map.of("accepted",true);}
    @PostMapping("/api/v1/tenants/{tenant}/conversations/{conversation}/tasks/{task}/inputs") public Object input(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID conversation,@PathVariable UUID task,@RequestBody ConversationRealtime.Input body){return live.input(UUID.fromString(auth.getName()),tenant,conversation,task,body);}
    @GetMapping("/api/v1/tenants/{tenant}/conversations/{conversation}/live") public ResponseEntity<?> snapshot(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID conversation){return ResponseEntity.ok().cacheControl(CacheControl.noStore().cachePrivate()).body(live.snapshot(UUID.fromString(auth.getName()),tenant,conversation));}
    @GetMapping(value="/api/v1/tenants/{tenant}/conversations/{conversation}/stream",produces=MediaType.TEXT_EVENT_STREAM_VALUE)
    public ResponseEntity<StreamingResponseBody> stream(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID conversation,jakarta.servlet.http.HttpServletResponse response,jakarta.servlet.http.HttpServletRequest request){
        UUID actor=UUID.fromString(auth.getName());live.snapshot(actor,tenant,conversation);
        var session=request.getSession(false);String sessionId=session.getId();
        Object savedVersion=session.getAttribute("CREDENTIAL_VERSION");long credentialVersion=savedVersion instanceof Number n?n.longValue():0;
        StreamingResponseBody body=out->{String last="";long end=System.nanoTime()+25_000_000_000L;
            while(System.nanoTime()<end){
                try {
                    if(!live.sessionActive(actor,sessionId,credentialVersion))throw IdentityException.denied();
                    String value=json.writeValueAsString(live.snapshot(actor,tenant,conversation));
                    if(!value.equals(last)){out.write(("data: "+value+"\n\n").getBytes(StandardCharsets.UTF_8));last=value;}
                    else out.write(": keepalive\n\n".getBytes(StandardCharsets.UTF_8));
                    out.flush();response.flushBuffer();Thread.sleep(300);
                }catch(IdentityException denied){out.write("event: unavailable\ndata: {}\n\n".getBytes(StandardCharsets.UTF_8));out.flush();response.flushBuffer();return;}
                catch(InterruptedException interrupted){Thread.currentThread().interrupt();return;}
            }
        };
        return ResponseEntity.ok().contentType(MediaType.TEXT_EVENT_STREAM).cacheControl(CacheControl.noStore().cachePrivate()).header("X-Accel-Buffering","no").body(body);
    }
}
